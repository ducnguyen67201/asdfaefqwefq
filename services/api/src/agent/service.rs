use std::collections::BTreeSet;

use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::{PgPool, Postgres, Row, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::{AgentEnvelope, AgentStateCrypto},
    config::{AgentRuntimeConfig, CostGuardMode},
    error::{ApiError, ApiResult},
    usage::plan_for,
    validation::{js_string_len, zod_uuid},
};

use super::{cua_catalog, lifecycle, protocol, tool_catalog};

#[derive(Clone)]
pub struct AgentService {
    pool: PgPool,
    crypto: AgentStateCrypto,
    config: AgentRuntimeConfig,
    hmac_key: Vec<u8>,
    enforce_cost_guard: bool,
}
impl AgentService {
    #[must_use]
    pub fn new(
        pool: PgPool,
        crypto: AgentStateCrypto,
        config: AgentRuntimeConfig,
        hmac_key: &str,
        cost_guard_mode: CostGuardMode,
    ) -> Self {
        Self {
            pool,
            crypto,
            config,
            hmac_key: hmac_key.as_bytes().to_vec(),
            enforce_cost_guard: cost_guard_mode == CostGuardMode::Enforce,
        }
    }
    pub fn enabled_for(&self, user: &str) -> bool {
        self.rollout_enabled(
            user,
            "backend-agent-rollout",
            self.config.enabled,
            &self.config.canary_users,
            self.config.rollout_percent,
        )
    }
    fn rollout_enabled(
        &self,
        user: &str,
        label: &str,
        enabled: bool,
        canary_users: &BTreeSet<String>,
        percent: u8,
    ) -> bool {
        if !enabled {
            return false;
        }
        if canary_users.contains(user) || percent >= 100 {
            return true;
        }
        if percent == 0 {
            return false;
        }
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.hmac_key).expect("validated key");
        mac.update(format!("{label}:{user}").as_bytes());
        let bytes = mac.finalize().into_bytes();
        u32::from_be_bytes(bytes[..4].try_into().expect("four bytes")) % 10_000
            < u32::from(percent) * 100
    }
    pub async fn has_active(&self, user: &str) -> ApiResult<bool> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM agent_runs WHERE user_id=$1 AND state NOT IN('completed','blocked','failed','cancelled','expired')AND deadline_at>NOW())").bind(user).fetch_one(&self.pool).await.map_err(Into::into)
    }
    pub async fn submit_v5(&self, user: &str, plan: &str, input: &Value) -> ApiResult<Value> {
        let client = parse_uuid(input, "clientTaskId")?;
        let task = parse_uuid(input, "taskId")?;
        if input.get("protocolVersion").and_then(Value::as_i64) != Some(5)
            || input.get("protocolDigest").and_then(Value::as_str)
                != Some(protocol::v5::protocol_digest())
            || input.get("toolCatalogDigest").and_then(Value::as_str)
                != Some(protocol::v5::tool_catalog_digest())
        {
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "protocol_upgrade_required",
                "Tro and the agent backend must be upgraded before starting this task.",
            ));
        }
        let request = input
            .get("request")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| (2..=8_000).contains(&js_string_len(value)))
            .ok_or_else(invalid)?;
        let profile = input
            .get("executionProfile")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "everyday" | "workspace"))
            .ok_or_else(invalid)?;
        let workspace = input
            .get("workspaceSelectionId")
            .filter(|value| !value.is_null())
            .map(|value| value.as_str().and_then(zod_uuid).ok_or_else(invalid))
            .transpose()?;
        if (profile == "workspace") != workspace.is_some() {
            return Err(invalid());
        }
        let activity_attempt = input
            .get("activityAttemptId")
            .filter(|value| !value.is_null())
            .map(|value| value.as_str().and_then(zod_uuid).ok_or_else(invalid))
            .transpose()?;
        let activity_intent = input
            .get("activityIntent")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "work" | "help" | "check"))
            .ok_or_else(invalid)?;
        if activity_attempt.is_none() && activity_intent != "work" {
            return Err(invalid());
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('agent-runtime-submit',0))")
            .execute(&mut *tx)
            .await?;
        if let Some(row) = sqlx::query(
            "SELECT * FROM agent_runs WHERE user_id=$1 AND client_task_id=$2 FOR UPDATE",
        )
        .bind(user)
        .bind(client)
        .fetch_optional(&mut *tx)
        .await?
        {
            if row.get::<Uuid, _>("task_id") != task || row.get::<i32, _>("protocol_version") != 5 {
                tx.rollback().await?;
                return Err(ApiError::conflict(
                    "agent_run_conflict",
                    "This client task ID is already linked to another task.",
                ));
            }
            tx.commit().await?;
            let mut value = self.public_run(&row)?;
            value["newlyCreated"] = Value::Bool(false);
            value["request"] = Value::String(self.decrypt_request(&row)?);
            value["contract"] = self.decrypt_contract(&row)?;
            return self.project_v5_run(&value);
        }
        let counts=sqlx::query("SELECT COUNT(*)FILTER(WHERE user_id=$1)::bigint user_active,COUNT(*)::bigint global_active FROM agent_runs WHERE state NOT IN('completed','blocked','failed','cancelled','expired')AND deadline_at>NOW()").bind(user).fetch_one(&mut*tx).await?;
        if counts.get::<i64, _>("user_active") >= self.config.max_active_runs_per_user
            || counts.get::<i64, _>("global_active") >= self.config.max_queue_depth
        {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::TOO_MANY_REQUESTS,
                "agent_runtime_unavailable",
                "The agent queue is currently full.",
            ));
        }
        let worker = sqlx::query(
            "SELECT sdk_version,graph_version FROM agent_orchestrator_workers WHERE protocol_version=1 AND protocol_digest=$1 AND disconnected_at IS NULL AND expires_at>NOW() ORDER BY heartbeat_at DESC LIMIT 1",
        )
        .bind(super::orchestrator_protocol::protocol_digest())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            ApiError::conflict(
                "orchestrator_unavailable",
                "The OpenAI Agents SDK worker is not currently available.",
            )
        })?;
        let activity = match activity_attempt {
            Some(attempt) => Some(
                self.resolve_activity(&mut tx, user, task, attempt, activity_intent, profile)
                    .await?,
            ),
            None => None,
        };
        let turn =
            reserve_agent_turn(&mut tx, user, plan, task, client, self.enforce_cost_guard).await?;
        let run = Uuid::new_v4();
        let request_envelope = self.crypto.encrypt_json(
            &json!({"request":request}),
            &json!({"kind":"agent_run_request","runId":run,"schemaVersion":1}),
        )?;
        let contract = json!({
            "schemaVersion":10,
            "id":Uuid::new_v4(),
            "originalRequest":request,
            "runtimeKind":"openai_agents_sdk",
            "executionProfile":profile,
            "workspaceSelectionId":workspace,
            "activity":activity,
            "limits":{
                "maxImages":20,
                "maxMicroUsd":5_000_000,
                "maxMinutes":30,
                "maxModelSamples":40,
                "maxToolCalls":30
            }
        });
        let contract_envelope = self.crypto.encrypt_json(
            &contract,
            &json!({"kind":"agent_run_contract","runId":run,"schemaVersion":10}),
        )?;
        let deadline = OffsetDateTime::now_utc() + time::Duration::minutes(30);
        let payload = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(
                i64::try_from(self.config.payload_ttl_ms).unwrap_or(i64::MAX),
            );
        let row=sqlx::query("INSERT INTO agent_runs(id,user_id,task_id,client_task_id,execution_profile,workspace_selection_id,agent_turn_id,state,schema_digest,protocol_version,protocol_digest,tool_catalog_digest,request_ciphertext,request_iv,request_tag,request_key_version,contract_ciphertext,contract_iv,contract_tag,contract_key_version,deadline_at,payload_expires_at,public_summary,orchestrator_kind,orchestrator_graph_version,sdk_version)VALUES($1,$2,$3,$4,$5,$6,$7,'awaiting_orchestrator',$8,5,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'Waiting for the OpenAI Agents SDK worker.','openai_agents_sdk',$21,$22)RETURNING *")
            .bind(run).bind(user).bind(task).bind(client).bind(profile).bind(workspace).bind(turn.id)
            .bind(protocol::v5::tool_catalog_digest()).bind(protocol::v5::protocol_digest()).bind(protocol::v5::tool_catalog_digest())
            .bind(request_envelope.ciphertext).bind(request_envelope.iv).bind(request_envelope.tag).bind(i32::try_from(request_envelope.key_version).unwrap_or(i32::MAX))
            .bind(contract_envelope.ciphertext).bind(contract_envelope.iv).bind(contract_envelope.tag).bind(i32::try_from(contract_envelope.key_version).unwrap_or(i32::MAX))
            .bind(deadline).bind(payload).bind(worker.get::<String,_>("graph_version")).bind(worker.get::<String,_>("sdk_version"))
            .fetch_one(&mut*tx).await?;
        append_event(
            &mut tx,
            run,
            "run.awaiting_orchestrator",
            "Waiting for the OpenAI Agents SDK worker.",
            None,
        )
        .await?;
        tx.commit().await?;
        let mut value = self.public_run(&row)?;
        value["newlyCreated"] = Value::Bool(true);
        value["request"] = Value::String(request.to_owned());
        value["contract"] = contract;
        self.project_v5_run(&value)
    }
    pub async fn get(&self, user: &str, run: Uuid) -> ApiResult<Option<Value>> {
        let row = sqlx::query("SELECT * FROM agent_runs WHERE id=$1 AND user_id=$2")
            .bind(run)
            .bind(user)
            .fetch_optional(&self.pool)
            .await?;
        row.map(|row| {
            let mut value = self.public_run(&row)?;
            value["request"] = Value::String(
                self.decrypt_request(&row)
                    .unwrap_or_else(|_| "Expired private task content.".to_owned()),
            );
            if let Ok(contract) = self.decrypt_contract(&row) {
                value["contract"] = contract.clone();
                value["contractSchemaVersion"] = contract["schemaVersion"].clone();
                value["outcomeContract"] = contract["outcomeContract"].clone();
                value["activity"] = contract["activity"].clone();
            }
            Ok(value)
        })
        .transpose()
    }
    pub async fn list(&self, user: &str) -> ApiResult<Vec<Value>> {
        let rows = sqlx::query(
            "SELECT * FROM agent_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
        )
        .bind(user)
        .fetch_all(&self.pool)
        .await?;
        let mut values = Vec::new();
        for row in rows {
            let mut value = self.public_run(&row)?;
            value["request"] = Value::String(
                self.decrypt_request(&row)
                    .unwrap_or_else(|_| "Expired private task content.".to_owned()),
            );
            if let Ok(contract) = self.decrypt_contract(&row) {
                value["contract"] = contract.clone();
                value["contractSchemaVersion"] = contract["schemaVersion"].clone();
                value["outcomeContract"] = contract["outcomeContract"].clone();
                value["activity"] = contract["activity"].clone();
            }
            values.push(value);
        }
        Ok(values)
    }
    pub fn project_v4_run(&self, run: &Value) -> ApiResult<Value> {
        let state: protocol::AgentRunStateV4 =
            serde_json::from_value(run.get("state").cloned().ok_or_else(invalid)?)
                .map_err(ApiError::internal)?;
        let lifecycle = lifecycle::project(&state);
        let waiting_on = match run.get("state").and_then(Value::as_str) {
            Some("awaiting_worker") => json!({
                "kind":"worker",
                "since":run["updatedAt"]
            }),
            Some("awaiting_permission") => json!({
                "kind":"permission",
                "interactionId":run["permissionInteractionId"],
                "invocationId":run["permissionInvocationId"],
                "requiredPermissions":run["permissionRequirements"],
                "since":run["updatedAt"]
            }),
            _ => Value::Null,
        };
        let failure = run
            .get("failureCode")
            .and_then(Value::as_str)
            .map_or(Value::Null, |code| {
                json!({
                    "stage":run["failureStage"],
                    "code":code,
                    "message":run["publicSummary"],
                    "retryable":run["failureRetryable"].as_bool().unwrap_or(false)
                })
            });
        let projection = json!({
            "state":state,
            "runVersion":run["runVersion"],
            "phase":lifecycle.phase,
            "terminal":lifecycle.terminal,
            "availableActions":lifecycle.actions,
            "waitingOn":waiting_on,
            "failure":failure,
            "cancellationSource":run.get("cancellationSource").cloned().unwrap_or(Value::Null)
        });
        let record = json!({
            "id":run["id"],
            "taskId":run["taskId"],
            "clientTaskId":run["clientTaskId"],
            "request":run["request"],
            "executionProfile":run["executionProfile"],
            "workspaceSelectionId":run["workspaceSelectionId"],
            "protocolVersion":4,
            "protocolDigest":protocol::protocol_digest(),
            "toolCatalogDigest":protocol::tool_catalog_digest(),
            "outcomeRevision":run["outcomeRevision"],
            "publicSummary":run["publicSummary"],
            "authorityContract":run["contract"],
            "projection":projection,
            "createdAt":run["createdAt"],
            "updatedAt":run["updatedAt"],
            "newlyCreated":run.get("newlyCreated").and_then(Value::as_bool).unwrap_or(false)
        });
        let typed: protocol::AgentTaskRecordV4 =
            serde_json::from_value(record).map_err(ApiError::internal)?;
        serde_json::to_value(typed).map_err(ApiError::internal)
    }

    pub async fn get_v4(&self, user: &str, run: Uuid) -> ApiResult<Option<Value>> {
        self.get(user, run)
            .await?
            .filter(|value| value["protocolVersion"].as_i64() == Some(4))
            .map(|value| self.project_v4_run(&value))
            .transpose()
    }

    pub async fn list_v4(&self, user: &str) -> ApiResult<Vec<Value>> {
        self.list(user)
            .await?
            .iter()
            .filter(|run| run["protocolVersion"].as_i64() == Some(4))
            .map(|run| self.project_v4_run(run))
            .collect()
    }

    pub fn project_v5_run(&self, run: &Value) -> ApiResult<Value> {
        let state = run
            .get("state")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let terminal = matches!(
            state,
            "completed" | "blocked" | "failed" | "cancelled" | "expired"
        );
        let phase = match state {
            "queued" => "ready",
            "awaiting_orchestrator" | "awaiting_worker" | "recovering" => "paused",
            "running" => "running",
            "awaiting_permission" => "awaiting_permission",
            "awaiting_input" => "awaiting_input",
            "executing_tool" => "acting",
            "completed" => "completed",
            "blocked" | "expired" => "blocked",
            "failed" => "failed",
            "cancelled" => "cancelled",
            _ => return Err(ApiError::internal(anyhow::anyhow!("invalid v5 run state"))),
        };
        let actions = match state {
            "queued" | "awaiting_orchestrator" | "running" | "recovering" => {
                json!(["steer", "cancel"])
            }
            "awaiting_worker" | "executing_tool" => json!(["cancel"]),
            "awaiting_permission" => {
                json!([
                    "open_system_settings",
                    "continue_without_computer",
                    "cancel"
                ])
            }
            "awaiting_input" => json!(["respond", "cancel"]),
            "blocked" | "failed" | "expired" => json!(["retry_as_new_task"]),
            _ => json!([]),
        };
        let waiting_on = match state {
            "awaiting_orchestrator" => json!({"kind":"orchestrator","since":run["updatedAt"]}),
            "awaiting_worker" => json!({"kind":"worker","since":run["updatedAt"]}),
            "awaiting_permission" => json!({
                "kind":"permission",
                "interactionId":run["permissionInteractionId"],
                "invocationId":run["permissionInvocationId"],
                "requiredPermissions":run["permissionRequirements"],
                "since":run["updatedAt"]
            }),
            _ => Value::Null,
        };
        let failure = run
            .get("failureCode")
            .and_then(Value::as_str)
            .map_or(Value::Null, |code| {
                json!({
                    "stage":run["failureStage"],
                    "code":code,
                    "message":run["publicSummary"],
                    "retryable":run["failureRetryable"].as_bool().unwrap_or(false)
                })
            });
        let record = json!({
            "id":run["id"],
            "taskId":run["taskId"],
            "clientTaskId":run["clientTaskId"],
            "request":run["request"],
            "executionProfile":run["executionProfile"],
            "workspaceSelectionId":run["workspaceSelectionId"],
            "protocolVersion":5,
            "protocolDigest":protocol::v5::protocol_digest(),
            "toolCatalogDigest":protocol::v5::tool_catalog_digest(),
            "publicSummary":run["publicSummary"],
            "authorityContract":run["contract"],
            "projection":{
                "state":state,
                "runVersion":run["runVersion"],
                "phase":phase,
                "terminal":terminal,
                "availableActions":actions,
                "waitingOn":waiting_on,
                "failure":failure,
                "cancellationSource":run.get("cancellationSource").cloned().unwrap_or(Value::Null)
            },
            "createdAt":run["createdAt"],
            "updatedAt":run["updatedAt"],
            "newlyCreated":run.get("newlyCreated").and_then(Value::as_bool).unwrap_or(false)
        });
        let typed: protocol::v5::AgentTaskRecordV5 =
            serde_json::from_value(record).map_err(ApiError::internal)?;
        serde_json::to_value(typed).map_err(ApiError::internal)
    }

    pub async fn get_v5(&self, user: &str, run: Uuid) -> ApiResult<Option<Value>> {
        self.get(user, run)
            .await?
            .filter(|value| value["protocolVersion"].as_i64() == Some(5))
            .map(|value| self.project_v5_run(&value))
            .transpose()
    }

    pub async fn list_v5(&self, user: &str) -> ApiResult<Vec<Value>> {
        self.list(user)
            .await?
            .iter()
            .filter(|run| run["protocolVersion"].as_i64() == Some(5))
            .map(|run| self.project_v5_run(run))
            .collect()
    }

    pub async fn events_v5(&self, user: &str, run: Uuid, after: i64) -> ApiResult<Vec<Value>> {
        let record = self
            .get_v5(user, run)
            .await?
            .ok_or_else(|| ApiError::not_found("agent_run_not_found", "Agent task not found."))?;
        self.events(user, run, after)
            .await?
            .into_iter()
            .map(|event| {
                let value = json!({
                    "id":event["id"],
                    "runId":event["runId"],
                    "sequence":event["sequence"],
                    "eventType":event["type"],
                    "summary":event["summary"],
                    "finalOutput":event.get("finalOutput").cloned().unwrap_or(Value::Null),
                    "projection":record["projection"],
                    "createdAt":event["createdAt"]
                });
                let typed: protocol::v5::AgentTaskEventV5 =
                    serde_json::from_value(value).map_err(ApiError::internal)?;
                serde_json::to_value(typed).map_err(ApiError::internal)
            })
            .collect()
    }

    pub async fn events_v4(&self, user: &str, run: Uuid, after: i64) -> ApiResult<Vec<Value>> {
        let record = self.get_v4(user, run).await?.ok_or_else(|| {
            ApiError::coded(
                http::StatusCode::NOT_FOUND,
                "agent_run_not_found",
                "Agent task not found.",
            )
        })?;
        self.events(user, run, after)
            .await?
            .into_iter()
            .map(|event| {
                let value = json!({
                    "id":event["id"],
                    "runId":event["runId"],
                    "sequence":event["sequence"],
                    "eventType":event["type"],
                    "summary":event["summary"],
                    "finalOutput":event.get("finalOutput").cloned().unwrap_or(Value::Null),
                    "outcomeRevision":event.get("outcomeRevision").cloned().unwrap_or(Value::Null),
                    "outcomes":event.get("outcomes").cloned().unwrap_or_else(||json!([])),
                    "projection":record["projection"],
                    "createdAt":event["createdAt"]
                });
                let typed: protocol::AgentTaskEventV4 =
                    serde_json::from_value(value).map_err(ApiError::internal)?;
                serde_json::to_value(typed).map_err(ApiError::internal)
            })
            .collect()
    }
    pub async fn cancel(&self, user: &str, run: Uuid) -> ApiResult<Option<Value>> {
        let mut tx = self.pool.begin().await?;
        let row=sqlx::query("UPDATE agent_runs SET state='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW(),public_summary='Task cancelled.' WHERE id=$1 AND user_id=$2 AND protocol_version<>5 AND state NOT IN('completed','blocked','failed','cancelled','expired')RETURNING *").bind(run).bind(user).fetch_optional(&mut*tx).await?;
        if row.is_some() {
            sqlx::query("UPDATE agent_tool_invocations SET state=CASE WHEN state='executing'THEN'unknown'ELSE'cancelled'END,terminal_at=NOW()WHERE run_id=$1 AND state IN('requested','delivered','executing')")
                .bind(run)
                .execute(&mut *tx)
                .await?;
            append_event(&mut tx, run, "run.cancelled", "Task cancelled.", None).await?;
        }
        tx.commit().await?;
        row.map(|row| {
            let mut value = self.public_run(&row)?;
            value["request"] = Value::String(
                self.decrypt_request(&row)
                    .unwrap_or_else(|_| "Expired private task content.".to_owned()),
            );
            if let Ok(contract) = self.decrypt_contract(&row) {
                value["contract"] = contract.clone();
                value["contractSchemaVersion"] = contract["schemaVersion"].clone();
                value["outcomeContract"] = contract["outcomeContract"].clone();
                value["activity"] = contract["activity"].clone();
            }
            Ok(value)
        })
        .transpose()
    }
    pub async fn cancel_versioned(
        &self,
        user: &str,
        run: Uuid,
        input: &Value,
    ) -> ApiResult<Option<Value>> {
        let expected_version = input
            .get("expectedRunVersion")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
            .ok_or_else(invalid)?;
        let source = input
            .get("source")
            .and_then(Value::as_str)
            .filter(|value| {
                matches!(
                    *value,
                    "stop_button" | "focused_escape" | "replacement" | "sign_out" | "shutdown"
                )
            })
            .ok_or_else(invalid)?;
        let command_id = parse_uuid(input, "clientCommandId")?;
        let mut tx = self.pool.begin().await?;
        let current = sqlx::query(
            "SELECT state,run_version,protocol_version FROM agent_runs WHERE id=$1 AND user_id=$2 FOR UPDATE",
        )
        .bind(run)
        .bind(user)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(current) = current else {
            tx.rollback().await?;
            return Ok(None);
        };
        let stored_version = i64::from(current.get::<i32, _>("run_version"));
        let protocol_version = current.get::<i32, _>("protocol_version");
        if stored_version != expected_version {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "stale_run_version",
                "The agent task changed before cancellation. Refresh and try again.",
            ));
        }
        if matches!(
            current.get::<String, _>("state").as_str(),
            "completed" | "blocked" | "failed" | "cancelled" | "expired"
        ) {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "run_not_cancellable",
                "This agent task can no longer be cancelled.",
            ));
        }
        let execution_in_progress: bool = sqlx::query_scalar(
            "SELECT EXISTS(
               SELECT 1 FROM agent_tool_invocations
               WHERE run_id=$1 AND state='executing' AND tool_id<>'task.interaction'
             )",
        )
        .bind(run)
        .fetch_one(&mut *tx)
        .await?;
        let (state, summary, event) = if execution_in_progress {
            (
                "blocked",
                "A tool invocation was interrupted after dispatch, so its outcome is unknown and it will not be retried.",
                "run.blocked",
            )
        } else {
            ("cancelled", "Task cancelled.", "run.cancelled")
        };
        sqlx::query("UPDATE agent_runs SET state=$3,run_version=run_version+1,cancellation_source=$4,last_client_command_id=$5,failure_stage=CASE WHEN $6 THEN'tool_execution'ELSE NULL END,failure_code=CASE WHEN $6 THEN'tool_outcome_unknown'ELSE NULL END,failure_retryable=CASE WHEN $6 THEN FALSE ELSE NULL END,permission_interaction_id=NULL,permission_invocation_id=NULL,permission_requirements=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW(),public_summary=$7 WHERE id=$1 AND user_id=$2 AND run_version=$8").bind(run).bind(user).bind(state).bind(source).bind(command_id).bind(execution_in_progress).bind(summary).bind(i32::try_from(expected_version).unwrap_or_default()).execute(&mut*tx).await?;
        if execution_in_progress {
            sqlx::query("UPDATE agent_tool_invocations SET state=CASE WHEN state='executing'AND tool_id<>'task.interaction'THEN'unknown'ELSE'cancelled'END,terminal_at=NOW()WHERE run_id=$1 AND state IN('requested','delivered','awaiting_permission','executing')")
                .bind(run)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("UPDATE agent_tool_invocations SET state='cancelled',terminal_at=NOW()WHERE run_id=$1 AND state IN('requested','delivered','awaiting_permission','executing')")
                .bind(run)
                .execute(&mut *tx)
                .await?;
        }
        append_event(&mut tx, run, event, summary, None).await?;
        tx.commit().await?;
        if protocol_version == 5 {
            self.get_v5(user, run).await
        } else {
            self.get_v4(user, run).await
        }
    }
    pub async fn control(
        &self,
        user: &str,
        run: Uuid,
        kind: &str,
        input: &Value,
    ) -> ApiResult<Option<Value>> {
        if kind != "steering" {
            return Err(invalid());
        }
        let object = input.as_object().ok_or_else(invalid)?;
        if object.len() != 2
            || object
                .keys()
                .any(|key| !matches!(key.as_str(), "clientTurnId" | "instruction"))
            || parse_uuid(input, "clientTurnId").is_err()
            || bounded_string(input, "instruction", 8_000).is_err()
        {
            return Err(invalid());
        }
        let summary = "Steering update queued.";
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query("SELECT * FROM agent_runs WHERE id=$1 AND user_id=$2 FOR UPDATE")
            .bind(run)
            .bind(user)
            .fetch_optional(&mut *tx)
            .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(None);
        };
        if row.get::<i32, _>("protocol_version") != 5
            || row.get::<String, _>("orchestrator_kind") != "openai_agents_sdk"
            || matches!(
                row.get::<String, _>("state").as_str(),
                "completed" | "blocked" | "failed" | "cancelled" | "expired"
            )
        {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "run_not_steerable",
                "This task can no longer accept steering updates.",
            ));
        }
        let client = parse_uuid(input, "clientTurnId")?;
        let plan: String = sqlx::query_scalar("SELECT plan FROM users WHERE id=$1")
            .bind(user)
            .fetch_one(&mut *tx)
            .await?;
        let turn = reserve_agent_turn(
            &mut tx,
            user,
            &plan,
            row.get("task_id"),
            client,
            self.enforce_cost_guard,
        )
        .await?;
        if !turn.newly_created && row.get::<Option<Uuid>, _>("agent_turn_id") == Some(turn.id) {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "agent_turn_conflict",
                "The task-start turn ID cannot be reused for steering.",
            ));
        }
        if !turn.newly_created
            && let Some(event) =
                steering_event_for_turn(&self.crypto, &mut tx, run, turn.id, input).await?
        {
            tx.commit().await?;
            return Ok(Some(event));
        }
        let envelope = self.crypto.encrypt_json(
            input,
            &json!({"kind":"agent_steering","runId":run,"schemaVersion":1}),
        )?;
        let event = append_steering_event(&mut tx, run, turn.id, summary, envelope).await?;
        tx.commit().await?;
        Ok(Some(event))
    }
    pub async fn events(&self, user: &str, run: Uuid, after: i64) -> ApiResult<Vec<Value>> {
        let rows=sqlx::query("SELECT events.id,events.sequence,events.type,events.public_summary,events.payload_ciphertext,events.payload_iv,events.payload_tag,events.payload_key_version,events.created_at FROM agent_run_events events JOIN agent_runs runs ON runs.id=events.run_id WHERE runs.user_id=$1 AND runs.id=$2 AND events.sequence>$3 ORDER BY events.sequence LIMIT 500").bind(user).bind(run).bind(after).fetch_all(&self.pool).await?;
        let outcome_rows=sqlx::query("SELECT criteria.criterion_id,criteria.required,criteria.state,criteria.verifier_kind,runs.outcome_revision FROM agent_outcome_criteria criteria JOIN agent_runs runs ON runs.id=criteria.run_id WHERE criteria.run_id=$1 AND criteria.revision=runs.outcome_revision ORDER BY criteria.criterion_id LIMIT 20").bind(run).fetch_all(&self.pool).await?;
        let outcome_revision = outcome_rows
            .first()
            .map_or(1, |row| row.get::<i32, _>("outcome_revision"));
        let outcomes = outcome_rows.into_iter().map(|row|json!({"criterionId":row.get::<String,_>("criterion_id"),"required":row.get::<bool,_>("required"),"status":row.get::<String,_>("state"),"verifierKind":row.get::<String,_>("verifier_kind")})).collect::<Vec<_>>();
        let mut values = Vec::new();
        for row in rows {
            let mut value = json!({"id":row.get::<Uuid,_>("id"),"runId":run,"sequence":row.get::<i64,_>("sequence"),"type":row.get::<String,_>("type"),"summary":row.get::<String,_>("public_summary"),"createdAt":iso(row.get("created_at")),"outcomeRevision":outcome_revision,"outcomes":&outcomes});
            if value["type"] == "run.completed"
                && let Some(envelope) = row_envelope(&row, "payload")?
                && let Ok(payload) = self.crypto.decrypt_json(
                    &envelope,
                    &json!({"kind":"agent_final_output","runId":run,"schemaVersion":1}),
                )
            {
                value["finalOutput"] = payload["finalOutput"].clone();
            }
            values.push(value);
        }
        Ok(values)
    }
    pub async fn connect_worker(
        &self,
        user: &str,
        device: Uuid,
        capabilities: &Value,
    ) -> ApiResult<Value> {
        let version = capabilities["protocolVersion"].as_i64().unwrap_or_default();
        let compatible = version == 5
            && capabilities["protocolDigest"].as_str() == Some(protocol::v5::protocol_digest())
            && capabilities["toolCatalogDigest"].as_str()
                == Some(protocol::v5::tool_catalog_digest());
        if !compatible {
            tracing::warn!(
                event = "agent.protocol_mismatch",
                protocol_version = version
            );
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "tool_catalog_upgrade_required",
                "Desktop worker must upgrade before accepting tasks.",
            ));
        }
        let capabilities = validate_capabilities(capabilities)?;
        let id = Uuid::new_v4();
        let expires = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(
                i64::try_from(self.config.heartbeat_ttl_ms).unwrap_or(i64::MAX),
            );
        let row=sqlx::query("INSERT INTO agent_worker_sessions(id,user_id,device_session_id,protocol_version,schema_digest,protocol_digest,tool_catalog_digest,capabilities,expires_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING connected_at,expires_at").bind(id).bind(user).bind(device).bind(i32::try_from(version).unwrap_or_default()).bind(protocol::v5::tool_catalog_digest()).bind(protocol::v5::protocol_digest()).bind(protocol::v5::tool_catalog_digest()).bind(&capabilities).bind(expires).fetch_one(&self.pool).await?;
        Ok(
            json!({"id":id,"protocolVersion":5,"protocolDigest":protocol::v5::protocol_digest(),"toolCatalogDigest":protocol::v5::tool_catalog_digest(),"connectedAt":iso(row.get("connected_at")),"expiresAt":iso(row.get("expires_at"))}),
        )
    }
    async fn require_worker(&self, user: &str, worker: Uuid) -> ApiResult<Value> {
        sqlx::query_scalar("SELECT to_jsonb(workers) FROM agent_worker_sessions workers WHERE id=$1 AND user_id=$2 AND protocol_version=5 AND protocol_digest=$3 AND tool_catalog_digest=$4 AND disconnected_at IS NULL AND expires_at>NOW()").bind(worker).bind(user).bind(protocol::v5::protocol_digest()).bind(protocol::v5::tool_catalog_digest()).fetch_optional(&self.pool).await?.ok_or_else(||ApiError::coded(http::StatusCode::CONFLICT,"stale_worker_session","Desktop worker session is stale, incompatible, or disconnected."))
    }
    pub async fn heartbeat(&self, user: &str, worker: Uuid) -> ApiResult<Option<Value>> {
        let expires = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(
                i64::try_from(self.config.heartbeat_ttl_ms).unwrap_or(i64::MAX),
            );
        let updated = sqlx::query_scalar::<_, OffsetDateTime>("UPDATE agent_worker_sessions SET heartbeat_at=NOW(),expires_at=$3 WHERE id=$1 AND user_id=$2 AND protocol_version=5 AND protocol_digest=$4 AND tool_catalog_digest=$5 AND disconnected_at IS NULL RETURNING expires_at").bind(worker).bind(user).bind(expires).bind(protocol::v5::protocol_digest()).bind(protocol::v5::tool_catalog_digest()).fetch_optional(&self.pool).await?;
        Ok(updated.map(|expires| json!({"expiresAt":iso(expires)})))
    }
    pub async fn pending(&self, user: &str, worker: Uuid) -> ApiResult<Vec<Value>> {
        let session = self.require_worker(user, worker).await?;
        let rows=sqlx::query("SELECT invocations.*,runs.run_version FROM agent_tool_invocations invocations JOIN agent_runs runs ON runs.id=invocations.run_id WHERE runs.user_id=$1 AND invocations.executor_kind='desktop'AND invocations.state IN('requested','delivered','awaiting_permission')AND invocations.expires_at>NOW()AND(invocations.state='requested'OR invocations.worker_session_id=$2 OR NOT EXISTS(SELECT 1 FROM agent_worker_sessions previous WHERE previous.id=invocations.worker_session_id AND previous.disconnected_at IS NULL AND previous.expires_at>NOW()))ORDER BY invocations.requested_at LIMIT 100").bind(user).bind(worker).fetch_all(&self.pool).await?;
        let mut values = Vec::new();
        for row in rows {
            let id: Uuid = row.get("id");
            let run: Uuid = row.get("run_id");
            let envelope = row_envelope(&row, "request")?
                .ok_or_else(|| ApiError::internal(anyhow::anyhow!("missing invocation payload")))?;
            let input=self.crypto.decrypt_json(&envelope,&json!({"invocationId":id,"kind":"agent_tool_request","runId":run,"schemaVersion":1}))?;
            let delivered=sqlx::query("UPDATE agent_tool_invocations SET state=CASE WHEN state='awaiting_permission'THEN state ELSE'delivered'END,worker_session_id=$2,delivered_at=COALESCE(delivered_at,NOW())WHERE id=$1 AND state IN('requested','delivered','awaiting_permission')AND expires_at>NOW()AND(worker_session_id IS NULL OR worker_session_id=$2 OR NOT EXISTS(SELECT 1 FROM agent_worker_sessions previous WHERE previous.id=agent_tool_invocations.worker_session_id AND previous.disconnected_at IS NULL AND previous.expires_at>NOW()))RETURNING id").bind(id).bind(worker).fetch_optional(&self.pool).await?;
            if delivered.is_none() {
                continue;
            }
            values.push(json!({"protocolVersion":5,"protocolDigest":session["protocol_digest"],"toolCatalogDigest":session["tool_catalog_digest"],"driverCatalogDigest":input.get("driverCatalogDigest").cloned().unwrap_or(Value::Null),"invocationId":id,"runId":run,"runVersion":row.get::<i32,_>("run_version"),"callId":row.get::<String,_>("call_id"),"toolId":row.get::<String,_>("tool_id"),"operation":row.get::<String,_>("operation"),"permissionInteractionId":row.get::<Option<Uuid>,_>("permission_interaction_id"),"permissionRequirements":row.get::<Option<Value>,_>("permission_requirements").unwrap_or_else(||json!([])),"input":input["input"],"expiresAt":iso(row.get("expires_at"))}));
        }
        Ok(values)
    }
    pub async fn wait_for_permission(
        &self,
        user: &str,
        worker: Uuid,
        input: &Value,
    ) -> ApiResult<Value> {
        self.require_worker(user, worker).await?;
        let invocation_id = parse_uuid(input, "invocationId")?;
        let interaction_id = parse_uuid(input, "interactionId")?;
        let expected_version = input
            .get("expectedRunVersion")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
            .ok_or_else(invalid)?;
        let requirements = input
            .get("requiredPermissions")
            .and_then(Value::as_array)
            .filter(|items| (1..=2).contains(&items.len()))
            .ok_or_else(invalid)?;
        let requirements = requirements
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .filter(|value| matches!(*value, "accessibility" | "screen_recording"))
                    .map(ToOwned::to_owned)
                    .ok_or_else(invalid)
            })
            .collect::<ApiResult<Vec<_>>>()?;
        let mut tx = self.pool.begin().await?;
        let row=sqlx::query("SELECT invocations.state,invocations.tool_id,invocations.permission_interaction_id,runs.id AS run_id,runs.run_version FROM agent_tool_invocations invocations JOIN agent_runs runs ON runs.id=invocations.run_id WHERE invocations.id=$1 AND invocations.worker_session_id=$2 AND runs.user_id=$3 AND runs.orchestrator_kind='openai_agents_sdk'FOR UPDATE OF invocations,runs").bind(invocation_id).bind(worker).bind(user).fetch_optional(&mut*tx).await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "permission_interaction_stale",
                "This computer-permission request is stale.",
            ));
        };
        if row.get::<String, _>("state") == "awaiting_permission"
            && row.get::<Option<Uuid>, _>("permission_interaction_id") == Some(interaction_id)
        {
            tx.commit().await?;
            return Ok(
                json!({"kind":"waiting","interactionId":interaction_id,"runVersion":row.get::<i32,_>("run_version")}),
            );
        }
        if i64::from(row.get::<i32, _>("run_version")) != expected_version
            || !matches!(
                row.get::<String, _>("state").as_str(),
                "requested" | "delivered"
            )
        {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "stale_run_version",
                "The agent task changed before the permission wait was recorded.",
            ));
        }
        let tool_id = row.get::<String, _>("tool_id");
        let expected_requirements = if tool_id == "cua.driver" {
            vec!["accessibility".to_owned(), "screen_recording".to_owned()]
        } else {
            tool_catalog::by_id(&tool_id)
                .map(|tool| tool.prerequisites.clone())
                .ok_or_else(invalid)?
        };
        if expected_requirements != requirements {
            tx.rollback().await?;
            return Err(invalid());
        }
        let run_id = row.get::<Uuid, _>("run_id");
        let requirement_value = json!(requirements);
        sqlx::query("UPDATE agent_tool_invocations SET state='awaiting_permission',permission_interaction_id=$2,permission_requirements=$3 WHERE id=$1 AND state IN('requested','delivered')")
            .bind(invocation_id)
            .bind(interaction_id)
            .bind(&requirement_value)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE agent_runs SET state='awaiting_permission',permission_interaction_id=$2,permission_invocation_id=$3,permission_requirements=$4,updated_at=NOW(),public_summary='Computer permission is required before this action can run.'WHERE id=$1 AND run_version=$5 AND orchestrator_kind='openai_agents_sdk' AND lease_owner IS NOT NULL")
            .bind(run_id)
            .bind(interaction_id)
            .bind(invocation_id)
            .bind(&requirement_value)
            .bind(i32::try_from(expected_version).unwrap_or_default())
            .execute(&mut *tx)
            .await?;
        append_event(
            &mut tx,
            run_id,
            "run.awaiting_permission",
            "Computer permission is required before this action can run.",
            None,
        )
        .await?;
        tx.commit().await?;
        tracing::info!(
            event = "agent.permission_wait_started",
            %run_id,
            %invocation_id,
            %interaction_id
        );
        Ok(json!({"kind":"waiting","interactionId":interaction_id,"runVersion":expected_version}))
    }

    pub async fn decide_permission(
        &self,
        user: &str,
        worker: Uuid,
        input: &Value,
    ) -> ApiResult<Value> {
        self.require_worker(user, worker).await?;
        let invocation_id = parse_uuid(input, "invocationId")?;
        let interaction_id = parse_uuid(input, "interactionId")?;
        let expected_version = input
            .get("expectedRunVersion")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
            .ok_or_else(invalid)?;
        let decision = input
            .get("decision")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "granted" | "continue_without_computer"))
            .ok_or_else(invalid)?;
        let mut tx = self.pool.begin().await?;
        let row=sqlx::query("SELECT invocations.run_id,invocations.permission_interaction_id,runs.run_version FROM agent_tool_invocations invocations JOIN agent_runs runs ON runs.id=invocations.run_id WHERE invocations.id=$1 AND invocations.worker_session_id=$2 AND invocations.state='awaiting_permission'AND runs.user_id=$3 AND runs.state='awaiting_permission'AND runs.orchestrator_kind='openai_agents_sdk'FOR UPDATE OF invocations,runs").bind(invocation_id).bind(worker).bind(user).fetch_optional(&mut*tx).await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "permission_interaction_stale",
                "This computer-permission request is stale.",
            ));
        };
        if row.get::<Option<Uuid>, _>("permission_interaction_id") != Some(interaction_id)
            || i64::from(row.get::<i32, _>("run_version")) != expected_version
        {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "stale_run_version",
                "The agent task changed before the permission decision.",
            ));
        }
        let run_id = row.get::<Uuid, _>("run_id");
        let response = if decision == "granted" {
            sqlx::query("UPDATE agent_tool_invocations SET state='delivered',permission_interaction_id=NULL,permission_requirements=NULL WHERE id=$1 AND state='awaiting_permission'")
                .bind(invocation_id)
                .execute(&mut *tx)
                .await?;
            json!({"kind":"ready","invocationId":invocation_id,"runVersion":expected_version})
        } else {
            let durable = json!({"invocationId":invocation_id,"status":"not_executed","summary":"Computer use was skipped at the user's request.","data":null});
            let envelope = self.crypto.encrypt_json(
                &durable,
                &json!({"invocationId":invocation_id,"kind":"agent_tool_result","runId":run_id,"schemaVersion":1}),
            )?;
            sqlx::query("UPDATE agent_tool_invocations SET state='not_executed',permission_interaction_id=NULL,permission_requirements=NULL,result_ciphertext=$2,result_iv=$3,result_tag=$4,result_key_version=$5,public_summary='Computer use was skipped at the user''s request.',terminal_at=NOW()WHERE id=$1 AND state='awaiting_permission'")
                .bind(invocation_id)
                .bind(envelope.ciphertext)
                .bind(envelope.iv)
                .bind(envelope.tag)
                .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
                .execute(&mut *tx)
                .await?;
            json!({"kind":"committed","invocationId":invocation_id,"runVersion":expected_version})
        };
        sqlx::query("UPDATE agent_runs SET state=CASE WHEN $2='granted' THEN 'awaiting_worker' ELSE 'running' END,permission_interaction_id=NULL,permission_invocation_id=NULL,permission_requirements=NULL,updated_at=NOW(),public_summary=CASE WHEN $2='granted' THEN 'Computer permission is ready; resuming the same action.' ELSE 'Continuing without computer use.' END WHERE id=$1 AND run_version=$3 AND orchestrator_kind='openai_agents_sdk' AND lease_owner IS NOT NULL")
            .bind(run_id)
            .bind(decision)
            .bind(i32::try_from(expected_version).unwrap_or_default())
            .execute(&mut *tx)
            .await?;
        append_event(
            &mut tx,
            run_id,
            if decision == "granted" {
                "run.permission_ready"
            } else {
                "run.permission_skipped"
            },
            if decision == "granted" {
                "Computer permission is ready; resuming the same action."
            } else {
                "Continuing without computer use."
            },
            None,
        )
        .await?;
        tx.commit().await?;
        tracing::info!(
            event = "agent.permission_wait_resolved",
            %run_id,
            %invocation_id,
            decision
        );
        Ok(response)
    }

    pub async fn begin_execution(
        &self,
        user: &str,
        worker: Uuid,
        input: &Value,
    ) -> ApiResult<Value> {
        self.require_worker(user, worker).await?;
        let object = input.as_object().ok_or_else(invalid)?;
        if object.len() != 2
            || object
                .keys()
                .any(|key| !matches!(key.as_str(), "invocationId" | "expectedRunVersion"))
        {
            return Err(invalid());
        }
        let id = parse_uuid(input, "invocationId")?;
        let expected_run_version = input
            .get("expectedRunVersion")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
            .ok_or_else(invalid)?;
        let mut tx = self.pool.begin().await?;
        let result=sqlx::query("UPDATE agent_tool_invocations invocations SET state='executing',executing_at=NOW()FROM agent_runs runs WHERE invocations.id=$1 AND invocations.worker_session_id=$2 AND invocations.run_id=runs.id AND runs.user_id=$3 AND runs.run_version=$4 AND runs.orchestrator_kind='openai_agents_sdk' AND runs.lease_owner IS NOT NULL AND invocations.state IN('requested','delivered')AND invocations.expires_at>NOW()RETURNING invocations.id,invocations.state,invocations.run_id").bind(id).bind(worker).bind(user).bind(i32::try_from(expected_run_version).unwrap_or_default()).fetch_optional(&mut *tx).await?;
        if let Some(row) = &result {
            sqlx::query("UPDATE agent_runs SET state='executing_tool',updated_at=NOW(),public_summary='Desktop action is executing.'WHERE id=$1 AND run_version=$2 AND lease_owner IS NOT NULL")
                .bind(row.get::<Uuid, _>("run_id"))
                .bind(i32::try_from(expected_run_version).unwrap_or_default())
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(result.map_or(
            json!({"kind":"stale"}),
            |_| json!({"kind":"executing","invocationId":id}),
        ))
    }
    pub async fn record_result(&self, user: &str, worker: Uuid, input: &Value) -> ApiResult<Value> {
        self.require_worker(user, worker).await?;
        let object = input.as_object().ok_or_else(invalid)?;
        if object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "invocationId" | "status" | "summary" | "data" | "visual"
            )
        }) {
            return Err(invalid());
        }
        let id = parse_uuid(input, "invocationId")?;
        let status = input
            .get("status")
            .and_then(Value::as_str)
            .filter(|value| {
                matches!(
                    *value,
                    "confirmed" | "failed" | "denied" | "not_executed" | "unknown" | "cancelled"
                )
            })
            .ok_or_else(invalid)?;
        let summary = input
            .get("summary")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && js_string_len(value) <= 1_000)
            .ok_or_else(invalid)?;
        let durable = json!({
            "invocationId": id,
            "status": status,
            "summary": summary,
            "data": input.get("data").cloned().unwrap_or(Value::Null),
            "visual": input.get("visual").cloned().unwrap_or(Value::Null)
        });
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT invocations.run_id,invocations.state
             FROM agent_tool_invocations invocations
             JOIN agent_runs runs ON runs.id=invocations.run_id
             WHERE invocations.id=$1 AND invocations.worker_session_id=$2
               AND runs.user_id=$3 AND runs.orchestrator_kind='openai_agents_sdk'
             FOR UPDATE OF invocations,runs",
        )
        .bind(id)
        .bind(worker)
        .bind(user)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(json!({"kind":"stale"}));
        };
        let current_state = row.get::<String, _>("state");
        let permitted = current_state == "executing"
            || (matches!(current_state.as_str(), "requested" | "delivered")
                && matches!(status, "denied" | "not_executed" | "cancelled"));
        if !permitted {
            tx.rollback().await?;
            return Ok(json!({"kind":"stale"}));
        }
        let run_id: Uuid = row.get("run_id");
        let envelope = self.crypto.encrypt_json(
            &durable,
            &json!({"invocationId":id,"kind":"agent_tool_result","runId":run_id,"schemaVersion":1}),
        )?;
        sqlx::query(
            "UPDATE agent_tool_invocations
             SET state=$3,result_ciphertext=$4,result_iv=$5,result_tag=$6,
                 result_key_version=$7,public_summary=$8,terminal_at=NOW()
             WHERE id=$1 AND worker_session_id=$2",
        )
        .bind(id)
        .bind(worker)
        .bind(status)
        .bind(envelope.ciphertext)
        .bind(envelope.iv)
        .bind(envelope.tag)
        .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
        .bind(summary)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE agent_runs
             SET state='running',updated_at=NOW(),public_summary=$2
             WHERE id=$1 AND orchestrator_kind='openai_agents_sdk' AND lease_owner IS NOT NULL",
        )
        .bind(run_id)
        .bind(if status == "unknown" {
            "A desktop action has an unknown outcome; stopping without retry."
        } else {
            "Desktop result returned to the OpenAI Agents SDK."
        })
        .execute(&mut *tx)
        .await?;
        append_event(
            &mut tx,
            run_id,
            if status == "unknown" {
                "tool.unknown"
            } else {
                "tool.completed"
            },
            summary,
            None,
        )
        .await?;
        tx.commit().await?;
        Ok(json!({"kind":"committed","invocationId":id}))
    }
    pub async fn disconnect(&self, user: &str, worker: Uuid) -> ApiResult<Value> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE agent_worker_sessions SET disconnected_at=COALESCE(disconnected_at,NOW()),expires_at=NOW()WHERE id=$1 AND user_id=$2")
        .bind(worker)
        .bind(user)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE agent_tool_invocations invocations SET state='requested',worker_session_id=NULL,delivered_at=NULL,executing_at=NULL FROM agent_runs runs WHERE invocations.run_id=runs.id AND runs.user_id=$1 AND invocations.worker_session_id=$2 AND invocations.state='executing'AND invocations.tool_id='task.interaction'")
            .bind(user)
            .bind(worker)
            .execute(&mut *tx)
            .await?;
        let ambiguous=sqlx::query("UPDATE agent_tool_invocations invocations SET state='unknown',terminal_at=NOW(),public_summary='Desktop worker disconnected after execution began.'FROM agent_runs runs WHERE invocations.run_id=runs.id AND runs.user_id=$1 AND invocations.worker_session_id=$2 AND invocations.state='executing'RETURNING invocations.run_id").bind(user).bind(worker).fetch_all(&mut *tx).await?;
        let run_ids = ambiguous
            .iter()
            .map(|row| row.get::<Uuid, _>("run_id"))
            .collect::<BTreeSet<_>>();
        for run_id in &run_ids {
            let changed = sqlx::query("UPDATE agent_runs SET state='running',public_summary='A desktop action has an unknown outcome; stopping without retry.',updated_at=NOW()WHERE id=$1 AND orchestrator_kind='openai_agents_sdk' AND lease_owner IS NOT NULL AND state NOT IN('completed','blocked','failed','cancelled','expired')")
                .bind(run_id)
                .execute(&mut *tx)
                .await?
                .rows_affected();
            if changed == 1 {
                append_event(
                    &mut tx,
                    *run_id,
                    "tool.unknown",
                    "Desktop execution became unknown after the worker disconnected.",
                    None,
                )
                .await?;
            }
        }
        tx.commit().await?;
        Ok(json!({"ambiguousInvocationCount":ambiguous.len()}))
    }

    pub async fn maintain(&self) -> ApiResult<()> {
        let stale_workers = sqlx::query(
            "SELECT id,user_id FROM agent_worker_sessions
             WHERE disconnected_at IS NULL AND (expires_at<=NOW() OR protocol_version<>5 OR protocol_digest IS DISTINCT FROM $1 OR tool_catalog_digest IS DISTINCT FROM $2) LIMIT 500",
        )
        .bind(protocol::v5::protocol_digest())
        .bind(protocol::v5::tool_catalog_digest())
        .fetch_all(&self.pool)
        .await?;
        for worker in stale_workers {
            self.disconnect(worker.get("user_id"), worker.get("id"))
                .await?;
        }

        let mut tx = self.pool.begin().await?;
        let expired_runs = sqlx::query(
            "UPDATE agent_runs SET state='expired',updated_at=NOW(),lease_owner=NULL,lease_expires_at=NULL
             WHERE deadline_at<=NOW() AND state NOT IN ('completed','blocked','failed','cancelled','expired')
             RETURNING id",
        )
        .fetch_all(&mut *tx)
        .await?;
        for run in expired_runs {
            append_event(
                &mut tx,
                run.get("id"),
                "run.expired",
                "Task deadline expired.",
                None,
            )
            .await?;
        }

        let expired_tools = sqlx::query(
            "UPDATE agent_tool_invocations SET state='expired',terminal_at=NOW(),
               public_summary='Desktop invocation expired before execution.'
             WHERE executor_kind='desktop'AND expires_at<=NOW() AND state IN ('requested','delivered') RETURNING run_id",
        )
        .fetch_all(&mut *tx)
        .await?;
        let run_ids = expired_tools
            .iter()
            .map(|row| row.get::<Uuid, _>("run_id"))
            .collect::<BTreeSet<_>>();
        for run_id in run_ids {
            let changed = sqlx::query(
                "UPDATE agent_runs
                 SET state=CASE WHEN lease_owner IS NULL OR lease_expires_at<=NOW()
                                THEN 'recovering' ELSE 'running' END,
                     public_summary='A desktop invocation expired before execution.',updated_at=NOW()
                 WHERE id=$1 AND orchestrator_kind='openai_agents_sdk'
                   AND state NOT IN ('completed','blocked','failed','cancelled','expired')",
            )
            .bind(run_id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if changed == 1 {
                append_event(
                    &mut tx,
                    run_id,
                    "tool.expired",
                    "A desktop invocation expired before execution.",
                    None,
                )
                .await?;
            }
        }

        let ambiguous_connectors = sqlx::query(
            "UPDATE agent_tool_invocations SET state='unknown',terminal_at=NOW(),execution_lease_owner=NULL,execution_lease_expires_at=NULL,public_summary='Connected-app execution lease expired after dispatch.'WHERE executor_kind='connector'AND state='executing'AND execution_lease_expires_at<=NOW()RETURNING run_id",
        ).fetch_all(&mut *tx).await?;
        for run in ambiguous_connectors {
            let run_id: Uuid = run.get("run_id");
            let changed = sqlx::query("UPDATE agent_runs SET state='running',updated_at=NOW(),public_summary='A connected-app action has an unknown outcome; stopping without retry.'WHERE id=$1 AND orchestrator_kind='openai_agents_sdk' AND lease_owner IS NOT NULL")
                .bind(run_id).execute(&mut *tx).await?.rows_affected();
            if changed == 1 {
                append_event(
                    &mut tx,
                    run_id,
                    "tool.unknown",
                    "A connected-app action has an unknown outcome and will not be retried.",
                    None,
                )
                .await?;
            }
        }

        sqlx::query(
            "UPDATE agent_runs SET request_ciphertext=NULL,request_iv=NULL,request_tag=NULL,
               request_key_version=NULL,contract_ciphertext=NULL,contract_iv=NULL,contract_tag=NULL,
               contract_key_version=NULL WHERE payload_expires_at<=NOW()
               AND request_ciphertext IS NOT NULL",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE agent_tool_invocations invocations SET
               request_ciphertext=NULL,request_iv=NULL,request_tag=NULL,request_key_version=NULL,
               result_ciphertext=NULL,result_iv=NULL,result_tag=NULL,result_key_version=NULL
             FROM agent_runs runs WHERE invocations.run_id=runs.id AND runs.payload_expires_at<=NOW()
               AND (invocations.request_ciphertext IS NOT NULL OR invocations.result_ciphertext IS NOT NULL)",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE agent_run_events events SET payload_ciphertext=NULL,payload_iv=NULL,payload_tag=NULL,
               payload_key_version=NULL FROM agent_runs runs
             WHERE events.run_id=runs.id AND runs.payload_expires_at<=NOW()
               AND events.payload_ciphertext IS NOT NULL",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "DELETE FROM agent_run_checkpoints checkpoints USING agent_runs runs
             WHERE checkpoints.run_id=runs.id AND runs.payload_expires_at<=NOW()",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "DELETE FROM agent_session_items items USING agent_runs runs
             WHERE items.run_id=runs.id AND runs.payload_expires_at<=NOW()",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE agent_evidence SET detail_ciphertext=NULL,detail_iv=NULL,detail_tag=NULL,detail_key_version=NULL
             WHERE detail_expires_at<=NOW() AND detail_ciphertext IS NOT NULL",
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn resolve_activity(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        user: &str,
        task: Uuid,
        attempt: Uuid,
        purpose: &str,
        execution_profile: &str,
    ) -> ApiResult<Value> {
        let context = sqlx::query(
            r#"SELECT attempts.state,attempts.acknowledged_policy_version,
                      runs.id AS run_id,runs.state AS run_state,runs.opens_at,runs.closes_at,
                      runs.insight_policy,runs.insight_policy_version,runs.space_id,
                      versions.id AS activity_version_id,versions.definition,
                      spaces.name AS space_name
               FROM knowledge_activity_attempts attempts
               JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
               JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
               JOIN knowledge_spaces spaces ON spaces.id=runs.space_id
               WHERE attempts.id=$1 AND attempts.user_id=$2"#,
        )
        .bind(attempt)
        .bind(user)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| {
            ApiError::coded(
                http::StatusCode::NOT_FOUND,
                "activity_attempt_not_found",
                "Assigned Activity not found.",
            )
        })?;
        let now = OffsetDateTime::now_utc();
        let opens_at = context.get::<Option<OffsetDateTime>, _>("opens_at");
        let closes_at = context.get::<Option<OffsetDateTime>, _>("closes_at");
        if context.get::<String, _>("run_state") != "open"
            || opens_at.is_some_and(|value| now < value)
            || closes_at.is_some_and(|value| now >= value)
        {
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "run_not_open",
                "This Run is not open.",
            ));
        }
        if !matches!(
            context.get::<String, _>("state").as_str(),
            "assigned" | "in_progress" | "blocked" | "ready_for_review"
        ) {
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "attempt_not_active",
                "This Attempt is waiting for review or no longer active.",
            ));
        }
        let definition = context.get::<Value, _>("definition");
        let workspace_activity =
            definition.get("launchTarget").and_then(Value::as_str) == Some("workspace");
        if workspace_activity != (execution_profile == "workspace") {
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "activity_launch_mismatch",
                "Activity launch authority does not match the execution profile.",
            ));
        }
        let session = sqlx::query(
            r#"SELECT sessions.id,sessions.purpose,sessions.state
               FROM knowledge_activity_work_sessions sessions
               JOIN knowledge_activity_attempts attempts ON attempts.id=sessions.attempt_id
               WHERE sessions.task_id=$1 AND sessions.attempt_id=$2
                 AND attempts.user_id=$3"#,
        )
        .bind(task)
        .bind(attempt)
        .bind(user)
        .fetch_optional(&mut **tx)
        .await?;
        let Some(session) = session else {
            return Err(activity_session_missing());
        };
        if session.get::<String, _>("purpose") != purpose
            || !matches!(
                session.get::<String, _>("state").as_str(),
                "created" | "active" | "paused"
            )
        {
            return Err(activity_session_missing());
        }
        let activity_version = context.get::<Uuid, _>("activity_version_id");
        let sources = sqlx::query(
            r#"SELECT sources.display_name,sources.role
               FROM knowledge_activity_version_sources pinned
               JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id
               JOIN knowledge_sources sources ON sources.id=versions.source_id
               WHERE pinned.activity_version_id=$1 AND versions.state='ready'
               ORDER BY sources.virtual_path,versions.id"#,
        )
        .bind(activity_version)
        .fetch_all(&mut **tx)
        .await?;
        let source_catalog = sources
            .into_iter()
            .map(|source| {
                json!({
                    "title":source.get::<String,_>("display_name"),
                    "role":source.get::<String,_>("role")
                })
            })
            .collect::<Vec<_>>();
        let progress = sqlx::query(
            r#"SELECT COUNT(DISTINCT sessions.id)::int AS session_count,
                      COALESCE(ARRAY_AGG(DISTINCT evidence.criterion_id)
                        FILTER(WHERE evidence.result_code='passed'),'{}') AS completed_criterion_ids
               FROM knowledge_activity_attempts attempts
               LEFT JOIN knowledge_activity_work_sessions sessions ON sessions.attempt_id=attempts.id
               LEFT JOIN knowledge_activity_evidence evidence ON evidence.attempt_id=attempts.id
               WHERE attempts.id=$1"#,
        )
        .bind(attempt)
        .fetch_one(&mut **tx)
        .await?;
        let session_count = progress.get::<i32, _>("session_count");
        let completed_criterion_ids = progress.get::<Vec<String>, _>("completed_criterion_ids");
        let summary = if session_count == 0 {
            "No prior Work Sessions.".to_owned()
        } else {
            format!("This Attempt has {session_count} prior Work Session(s).")
        };
        let run_id = context.get::<Uuid, _>("run_id");
        let directive = sqlx::query(
            r#"SELECT directives.id,directives.sequence,directives.kind,directives.delivery,
                      directives.payload,directives.created_at
               FROM knowledge_run_directives directives
               JOIN knowledge_run_participations participations
                 ON participations.run_id=directives.run_id
                AND participations.attempt_id=$2 AND participations.user_id=$3
               WHERE directives.run_id=$1 AND participations.left_at IS NULL
               ORDER BY directives.sequence DESC LIMIT 1"#,
        )
        .bind(run_id)
        .bind(attempt)
        .bind(user)
        .fetch_optional(&mut **tx)
        .await?;
        let current_directive = directive
            .as_ref()
            .map(crate::classroom::directive_from_row)
            .transpose()?
            .map(serde_json::to_value)
            .transpose()
            .map_err(ApiError::internal)?;
        let insight_policy_version = context.get::<String, _>("insight_policy_version");
        let policy_acknowledged = context
            .get::<Option<String>, _>("acknowledged_policy_version")
            .as_deref()
            == Some(insight_policy_version.as_str());
        Ok(json!({
            "attemptId":attempt,
            "workSessionId":session.get::<Uuid,_>("id"),
            "activityVersionId":activity_version,
            "runId":run_id,
            "space":{
                "id":context.get::<Uuid,_>("space_id"),
                "name":context.get::<String,_>("space_name")
            },
            "activity":definition,
            "purpose":purpose,
            "currentDirective":current_directive,
            "insightPolicy":context.get::<String,_>("insight_policy"),
            "insightPolicyVersion":insight_policy_version,
            "policyAcknowledged":policy_acknowledged,
            "sourceCatalog":source_catalog,
            "priorProgress":{
                "completedCriterionIds":completed_criterion_ids,
                "sessionCount":session_count,
                "summary":summary
            }
        }))
    }
    fn decrypt_request(&self, row: &sqlx::postgres::PgRow) -> ApiResult<String> {
        let id: Uuid = row.get("id");
        let env = row_envelope(row, "request")?
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("request expired")))?;
        Ok(self.crypto.decrypt_json(
            &env,
            &json!({"kind":"agent_run_request","runId":id,"schemaVersion":1}),
        )?["request"]
            .as_str()
            .unwrap_or_default()
            .to_owned())
    }
    fn decrypt_contract(&self, row: &sqlx::postgres::PgRow) -> ApiResult<Value> {
        let id: Uuid = row.get("id");
        let env = row_envelope(row, "contract")?
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("contract expired")))?;
        let schema_version = match row.get::<i32, _>("protocol_version") {
            5 => 10,
            4 => 9,
            _ => 8,
        };
        self.crypto.decrypt_json(
            &env,
            &json!({"kind":"agent_run_contract","runId":id,"schemaVersion":schema_version}),
        )
    }
    fn public_run(&self, row: &sqlx::postgres::PgRow) -> ApiResult<Value> {
        Ok(
            json!({"id":row.get::<Uuid,_>("id"),"userId":row.get::<String,_>("user_id"),"taskId":row.get::<Uuid,_>("task_id"),"clientTaskId":row.get::<Uuid,_>("client_task_id"),"executionProfile":row.get::<String,_>("execution_profile"),"workspaceSelectionId":row.get::<Option<Uuid>,_>("workspace_selection_id"),"state":row.get::<String,_>("state"),"schemaDigest":row.get::<String,_>("schema_digest"),"protocolVersion":row.get::<i32,_>("protocol_version"),"protocolDigest":row.get::<Option<String>,_>("protocol_digest"),"toolCatalogDigest":row.get::<Option<String>,_>("tool_catalog_digest"),"runVersion":row.get::<i32,_>("run_version"),"outcomeRevision":row.get::<i32,_>("outcome_revision"),"nextSequence":row.get::<i64,_>("next_sequence"),"leaseOwner":row.get::<Option<String>,_>("lease_owner"),"leaseExpiresAt":row.get::<Option<OffsetDateTime>,_>("lease_expires_at").map(iso),"deadlineAt":iso(row.get("deadline_at")),"payloadExpiresAt":iso(row.get("payload_expires_at")),"failureStage":row.get::<Option<String>,_>("failure_stage"),"failureCode":row.get::<Option<String>,_>("failure_code"),"failureRetryable":row.get::<Option<bool>,_>("failure_retryable"),"cancellationSource":row.get::<Option<String>,_>("cancellation_source"),"permissionInteractionId":row.get::<Option<Uuid>,_>("permission_interaction_id"),"permissionInvocationId":row.get::<Option<Uuid>,_>("permission_invocation_id"),"permissionRequirements":row.get::<Option<Value>,_>("permission_requirements"),"publicSummary":row.get::<String,_>("public_summary"),"createdAt":iso(row.get("created_at")),"updatedAt":iso(row.get("updated_at"))}),
        )
    }
}
fn invalid() -> ApiError {
    ApiError::coded(
        http::StatusCode::BAD_REQUEST,
        "invalid_request",
        "Request data is invalid.",
    )
}
fn activity_session_missing() -> ApiError {
    ApiError::coded(
        http::StatusCode::CONFLICT,
        "activity_session_missing",
        "The Activity Work Session is unavailable or mismatched.",
    )
}

fn parse_uuid(value: &Value, key: &str) -> ApiResult<Uuid> {
    let value = value.get(key).and_then(Value::as_str).ok_or_else(invalid)?;
    zod_uuid(value).ok_or_else(invalid)
}

fn bounded_string<'a>(value: &'a Value, key: &str, max: usize) -> ApiResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && js_string_len(value) <= max)
        .ok_or_else(invalid)
}

fn validate_capabilities(capabilities: &Value) -> ApiResult<Value> {
    let object = capabilities.as_object().ok_or_else(invalid)?;
    let version = capabilities
        .get("protocolVersion")
        .and_then(Value::as_i64)
        .filter(|value| *value == 5)
        .ok_or_else(invalid)?;
    if object.len() != 6
        || object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "protocolVersion"
                    | "protocolDigest"
                    | "toolCatalogDigest"
                    | "maxResultBytes"
                    | "tools"
                    | "cua"
            )
        })
    {
        return Err(invalid());
    }
    let parse_digest = |key: &str| {
        capabilities
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| {
                value.len() == 64
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            })
            .ok_or_else(invalid)
    };
    let protocol_digest = parse_digest("protocolDigest")?;
    let tool_catalog_digest = parse_digest("toolCatalogDigest")?;
    let max_result_bytes = capabilities
        .get("maxResultBytes")
        .and_then(Value::as_u64)
        .filter(|value| *value == 48_000_000)
        .ok_or_else(invalid)?;
    let tools = capabilities
        .get("tools")
        .and_then(Value::as_array)
        .filter(|tools| tools.len() <= 100)
        .ok_or_else(invalid)?;
    let mut normalized_tools = Vec::with_capacity(tools.len());
    for tool in tools {
        let tool_object = tool.as_object().filter(|object| {
            object.len() == 2
                && object
                    .keys()
                    .all(|key| matches!(key.as_str(), "toolId" | "operations"))
        });
        if tool_object.is_none() {
            return Err(invalid());
        }
        let tool_id = tool
            .get("toolId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|tool_id| {
                (3..=100).contains(&js_string_len(tool_id))
                    && tool_id.split('.').count() >= 2
                    && tool_id.split('.').all(|segment| {
                        let mut bytes = segment.bytes();
                        bytes.next().is_some_and(|byte| byte.is_ascii_lowercase())
                            && bytes.all(|byte| {
                                byte.is_ascii_lowercase()
                                    || byte.is_ascii_digit()
                                    || matches!(byte, b'_' | b'-')
                            })
                    })
            })
            .ok_or_else(invalid)?;
        let operations = tool
            .get("operations")
            .and_then(Value::as_array)
            .filter(|operations| !operations.is_empty() && operations.len() <= 50)
            .ok_or_else(invalid)?
            .iter()
            .map(|operation| {
                operation
                    .as_str()
                    .map(str::trim)
                    .filter(|operation| (1..=100).contains(&js_string_len(operation)))
                    .map(ToOwned::to_owned)
                    .ok_or_else(invalid)
            })
            .collect::<ApiResult<Vec<_>>>()?;
        normalized_tools.push(json!({"toolId":tool_id,"operations":operations}));
    }
    let cua = cua_catalog::validate(capabilities.get("cua").ok_or_else(invalid)?)?;
    Ok(json!({
        "protocolVersion":version,
        "protocolDigest":protocol_digest,
        "toolCatalogDigest":tool_catalog_digest,
        "maxResultBytes":max_result_bytes,
        "tools":normalized_tools,
        "cua":cua
    }))
}

fn iso(value: OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

fn row_envelope(row: &sqlx::postgres::PgRow, prefix: &str) -> ApiResult<Option<AgentEnvelope>> {
    let ciphertext: Option<Vec<u8>> = row
        .try_get(format!("{prefix}_ciphertext").as_str())
        .ok()
        .flatten();
    let Some(ciphertext) = ciphertext else {
        return Ok(None);
    };
    Ok(Some(AgentEnvelope {
        ciphertext,
        iv: row
            .try_get(format!("{prefix}_iv").as_str())
            .map_err(ApiError::internal)?,
        tag: row
            .try_get(format!("{prefix}_tag").as_str())
            .map_err(ApiError::internal)?,
        key_version: u32::try_from(
            row.try_get::<i32, _>(format!("{prefix}_key_version").as_str())
                .map_err(ApiError::internal)?,
        )
        .map_err(ApiError::internal)?,
    }))
}

async fn append_event(
    tx: &mut Transaction<'_, Postgres>,
    run: Uuid,
    event: &str,
    summary: &str,
    envelope: Option<AgentEnvelope>,
) -> ApiResult<Value> {
    let sequence: i64 = sqlx::query_scalar(
        "UPDATE agent_runs SET next_sequence=next_sequence+1,updated_at=NOW()
         WHERE id=$1 RETURNING next_sequence-1",
    )
    .bind(run)
    .fetch_one(&mut **tx)
    .await?;
    let id = Uuid::new_v4();
    let (ciphertext, iv, tag, key_version) = envelope.map_or((None, None, None, None), |value| {
        (
            Some(value.ciphertext),
            Some(value.iv),
            Some(value.tag),
            Some(i32::try_from(value.key_version).unwrap_or(i32::MAX)),
        )
    });
    let created: OffsetDateTime = sqlx::query_scalar(
        "INSERT INTO agent_run_events(
            id,run_id,sequence,type,public_summary,payload_ciphertext,payload_iv,payload_tag,payload_key_version
         )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING created_at",
    )
    .bind(id)
    .bind(run)
    .bind(sequence)
    .bind(event)
    .bind(summary)
    .bind(ciphertext)
    .bind(iv)
    .bind(tag)
    .bind(key_version)
    .fetch_one(&mut **tx)
    .await?;
    Ok(json!({
        "id":id,
        "runId":run,
        "sequence":sequence,
        "type":event,
        "summary":summary,
        "createdAt":iso(created)
    }))
}

async fn steering_event_for_turn(
    crypto: &AgentStateCrypto,
    tx: &mut Transaction<'_, Postgres>,
    run: Uuid,
    turn: Uuid,
    expected_payload: &Value,
) -> ApiResult<Option<Value>> {
    let row = sqlx::query(
        "SELECT id,sequence,type,public_summary,payload_ciphertext,payload_iv,
                payload_tag,payload_key_version,created_at
         FROM agent_run_events WHERE run_id=$1 AND agent_turn_id=$2",
    )
    .bind(run)
    .bind(turn)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let envelope = row_envelope(&row, "payload")?
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("steering payload missing")))?;
    let payload = crypto.decrypt_json(
        &envelope,
        &json!({"kind":"agent_steering","runId":run,"schemaVersion":1}),
    )?;
    if &payload != expected_payload {
        return Err(ApiError::conflict(
            "agent_turn_conflict",
            "This user turn ID is already linked to different steering content.",
        ));
    }
    Ok(Some(json!({
        "id":row.get::<Uuid,_>("id"),
        "runId":run,
        "sequence":row.get::<i64,_>("sequence"),
        "type":row.get::<String,_>("type"),
        "summary":row.get::<String,_>("public_summary"),
        "createdAt":iso(row.get("created_at"))
    })))
}

async fn append_steering_event(
    tx: &mut Transaction<'_, Postgres>,
    run: Uuid,
    turn: Uuid,
    summary: &str,
    envelope: AgentEnvelope,
) -> ApiResult<Value> {
    let sequence: i64 = sqlx::query_scalar(
        "UPDATE agent_runs SET next_sequence=next_sequence+1,updated_at=NOW()
         WHERE id=$1 RETURNING next_sequence-1",
    )
    .bind(run)
    .fetch_one(&mut **tx)
    .await?;
    let id = Uuid::new_v4();
    let created: OffsetDateTime = sqlx::query_scalar(
        "INSERT INTO agent_run_events(
            id,run_id,sequence,type,public_summary,payload_ciphertext,payload_iv,
            payload_tag,payload_key_version,agent_turn_id
         )VALUES($1,$2,$3,'run.steering_queued',$4,$5,$6,$7,$8,$9)
         RETURNING created_at",
    )
    .bind(id)
    .bind(run)
    .bind(sequence)
    .bind(summary)
    .bind(envelope.ciphertext)
    .bind(envelope.iv)
    .bind(envelope.tag)
    .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
    .bind(turn)
    .fetch_one(&mut **tx)
    .await?;
    Ok(json!({
        "id":id,
        "runId":run,
        "sequence":sequence,
        "type":"run.steering_queued",
        "summary":summary,
        "createdAt":iso(created)
    }))
}

struct ReservedAgentTurn {
    id: Uuid,
    newly_created: bool,
}

async fn reserve_agent_turn(
    tx: &mut Transaction<'_, Postgres>,
    user: &str,
    plan: &str,
    task: Uuid,
    client: Uuid,
    enforce: bool,
) -> ApiResult<ReservedAgentTurn> {
    let allowed = plan_for(plan)?;
    let existing =
        sqlx::query("SELECT id,task_id FROM agent_turns WHERE user_id=$1 AND client_turn_id=$2")
            .bind(user)
            .bind(client)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some(existing) = existing {
        if existing.get::<Uuid, _>("task_id") != task {
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "agent_turn_conflict",
                "This user turn ID is already linked to another task.",
            ));
        }
        return Ok(ReservedAgentTurn {
            id: existing.get("id"),
            newly_created: false,
        });
    }
    let count:i64=sqlx::query_scalar("SELECT COUNT(*)::bigint FROM agent_turns WHERE user_id=$1 AND created_at>=date_trunc('week',NOW())AND status<>'released'").bind(user).fetch_one(&mut**tx).await?;
    let denied = count >= allowed.weekly_messages;
    if denied && enforce {
        return Err(ApiError::coded(
            http::StatusCode::PAYMENT_REQUIRED,
            "weekly_message_limit_reached",
            "The weekly agent message allowance has been reached.",
        ));
    }
    let id = sqlx::query_scalar("INSERT INTO agent_turns(client_turn_id,user_id,task_id,plan,would_deny)VALUES($1,$2,$3,$4,$5)RETURNING id").bind(client).bind(user).bind(task).bind(plan).bind(denied).fetch_one(&mut**tx).await?;
    Ok(ReservedAgentTurn {
        id,
        newly_created: true,
    })
}
