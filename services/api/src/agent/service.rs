use std::{collections::BTreeSet, sync::LazyLock, time::Duration};

use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use time::OffsetDateTime;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    auth::{AgentEnvelope, AgentStateCrypto},
    config::AgentRuntimeConfig,
    config::CostGuardMode,
    error::{ApiError, ApiResult},
    providers::{ProviderBody, ResponsesInput, ResponsesService},
    usage::plan_for,
    validation::{js_string_len, zod_uuid},
};

const TOOLS: &[(&str, &[&str])] = &[
    ("application.launch", &["launch"]),
    ("browser.navigate", &["open_url"]),
    (
        "browser.dom",
        &[
            "observe", "click", "fill", "press", "scroll", "read", "assert",
        ],
    ),
    (
        "computer.control",
        &["click_element", "type_text", "press_key", "scroll"],
    ),
    ("computer.observe", &["observe", "inspect_surface_region"]),
    (
        "desktop.control",
        &[
            "click",
            "type_text",
            "keypress",
            "scroll",
            "drag",
            "paste_table",
        ],
    ),
    ("desktop.observe", &["observe"]),
    ("task.interaction", &["request"]),
    ("workspace.filesystem", &["read_file", "write_file"]),
    ("workspace.terminal", &["run_command"]),
];
pub static TOOL_SCHEMA_DIGEST: LazyLock<String> = LazyLock::new(tool_schema_digest);
pub fn tool_schema_digest() -> String {
    let definitions:Vec<Value>=TOOLS.iter().map(|(tool,operations)|json!({"defaultEffectKind":if operations.iter().all(|value|matches!(*value,"launch"|"open_url"|"observe"|"inspect_surface_region"|"request")){"none"}else{"operation_specific"},"operations":operations,"toolId":tool})).collect();
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&definitions).unwrap_or_default())
    )
}
const INSTRUCTIONS: &str = "You are Tro, a general-purpose agent. Treat the original request as a checklist.\nUse only the supplied tools. Tool calls are executed by a trusted desktop worker.\nFor every tool call, declare the exact typed effect. Read, observe, and navigation use effect kind none. Private reversible creation or edits use their specific create/update/workspace effect. Sending, invitations, deletion, publish, deploy, merge, money, credentials, permissions, install, sensitive transfer, and ambiguous submit must use their matching hard-confirm or unknown effect.\nThe authenticated user instruction authorizes in-scope reversible work when the desktop host matches it. Do not ask again unless a material choice is missing; the host independently enforces exact approval for hard-confirm effects.\nNever claim a side effect succeeded without a confirmed tool result or fresh evidence.\nNever retry an action whose result is unknown.\nReturn a concise user-facing final answer only after every requested outcome is satisfied.";

#[derive(Clone)]
pub struct AgentService {
    pool: PgPool,
    crypto: AgentStateCrypto,
    responses: ResponsesService,
    config: AgentRuntimeConfig,
    allowed_models: BTreeSet<String>,
    hmac_key: Vec<u8>,
    worker_id: String,
    enforce_cost_guard: bool,
}
impl AgentService {
    #[must_use]
    pub fn new(
        pool: PgPool,
        crypto: AgentStateCrypto,
        responses: ResponsesService,
        config: AgentRuntimeConfig,
        hmac_key: &str,
        allowed_models: &BTreeSet<String>,
        cost_guard_mode: CostGuardMode,
    ) -> Self {
        Self {
            pool,
            crypto,
            responses,
            config,
            allowed_models: allowed_models.clone(),
            hmac_key: hmac_key.as_bytes().to_vec(),
            worker_id: Uuid::new_v4().to_string(),
            enforce_cost_guard: cost_guard_mode == CostGuardMode::Enforce,
        }
    }
    pub fn enabled_for(&self, user: &str) -> bool {
        if !self.config.enabled {
            return false;
        }
        if self.config.canary_users.contains(user) {
            return true;
        }
        let percent = self.config.rollout_percent;
        if percent == 0 {
            return false;
        }
        if percent >= 100 {
            return true;
        }
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.hmac_key).expect("validated key");
        mac.update(format!("backend-agent-rollout:{user}").as_bytes());
        let bytes = mac.finalize().into_bytes();
        u32::from_be_bytes(bytes[..4].try_into().expect("four bytes")) % 10_000
            < u32::from(percent) * 100
    }
    pub async fn has_active(&self, user: &str) -> ApiResult<bool> {
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM agent_runs WHERE user_id=$1 AND state NOT IN('completed','blocked','failed','cancelled','expired')AND deadline_at>NOW())").bind(user).fetch_one(&self.pool).await.map_err(Into::into)
    }
    pub async fn submit(&self, user: &str, plan: &str, input: &Value) -> ApiResult<Value> {
        let object = input.as_object().ok_or_else(invalid)?;
        if object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "clientTaskId"
                    | "taskId"
                    | "request"
                    | "autonomyMode"
                    | "executionProfile"
                    | "workspaceSelectionId"
            )
        }) {
            return Err(invalid());
        }
        let client = parse_uuid(input, "clientTaskId")?;
        let task = parse_uuid(input, "taskId")?;
        let request = input
            .get("request")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| (2..=8_000).contains(&js_string_len(value)))
            .ok_or_else(invalid)?;
        let autonomy = match input.get("autonomyMode") {
            None => "balanced",
            Some(value) => value.as_str().ok_or_else(invalid)?,
        };
        if !matches!(autonomy, "balanced" | "strict") {
            return Err(invalid());
        }
        let profile = match input.get("executionProfile") {
            None => "everyday",
            Some(value) => value.as_str().ok_or_else(invalid)?,
        };
        if !matches!(profile, "everyday" | "workspace") {
            return Err(invalid());
        }
        let workspace = match input.get("workspaceSelectionId") {
            None | Some(Value::Null) => None,
            Some(value) => Some(value.as_str().and_then(zod_uuid).ok_or_else(invalid)?),
        };
        if (profile == "workspace") != workspace.is_some() {
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
            if row.get::<Uuid, _>("task_id") != task {
                tx.rollback().await?;
                return Err(ApiError::coded(
                    http::StatusCode::CONFLICT,
                    "agent_run_conflict",
                    "This client task ID is already linked to another task.",
                ));
            }
            tx.commit().await?;
            let mut value = self.public_run(&row)?;
            value["newlyCreated"] = Value::Bool(false);
            value["request"] = Value::String(self.decrypt_request(&row)?);
            let contract = self.decrypt_contract(&row)?;
            value["contractSchemaVersion"] = contract["schemaVersion"].clone();
            value["autonomyMode"] = contract["autonomyMode"].clone();
            value["outcomeContract"] = contract["outcomeContract"].clone();
            value["intentAuthorization"] = contract["intentAuthorization"].clone();
            return Ok(value);
        }
        let counts=sqlx::query("SELECT COUNT(*)FILTER(WHERE user_id=$1)::bigint user_active,COUNT(*)::bigint global_active FROM agent_runs WHERE state NOT IN('completed','blocked','failed','cancelled','expired')AND deadline_at>NOW()").bind(user).fetch_one(&mut*tx).await?;
        if counts.get::<i64, _>("user_active") >= self.config.max_active_runs_per_user
            || counts.get::<i64, _>("global_active") >= self.config.max_queue_depth
        {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::TOO_MANY_REQUESTS,
                if counts.get::<i64, _>("user_active") >= self.config.max_active_runs_per_user {
                    "user_concurrency_limit"
                } else {
                    "global_queue_full"
                },
                if counts.get::<i64, _>("user_active") >= self.config.max_active_runs_per_user {
                    "Finish or stop an active task before starting another."
                } else {
                    "The agent queue is full; retry shortly."
                },
            ));
        }
        let turn =
            reserve_agent_turn(&mut tx, user, plan, task, client, self.enforce_cost_guard).await?;
        let run = Uuid::new_v4();
        let request_envelope = self.crypto.encrypt_json(
            &json!({"request":request}),
            &json!({"kind":"agent_run_request","runId":run,"schemaVersion":1}),
        )?;
        let outcomes = outcome_contract(request, profile);
        let contract = json!({"schemaVersion":8,"id":Uuid::new_v4(),"originalRequest":request,"runtimeKind":"openai_agents","executionProfile":profile,"autonomyMode":autonomy,"workspaceSelectionId":workspace,"outcomeContract":outcomes,"intentAuthorization":{"schemaVersion":1,"revision":1,"source":"user_instruction","grants":[]},"approvalPolicy":{"alwaysConfirmEffects":["send_communication","delete_or_archive","unexpected_overwrite","publish","deploy","merge","financial_or_trade","authentication_or_credential","system_permission","install","sensitive_transfer","unknown"]},"limits":{"maxImages":20,"maxMicroUsd":5_000_000,"maxMinutes":30,"maxModelSamples":40,"maxToolCalls":30}});
        let contract_envelope = self.crypto.encrypt_json(
            &contract,
            &json!({"kind":"agent_run_contract","runId":run,"schemaVersion":8}),
        )?;
        let deadline = OffsetDateTime::now_utc() + time::Duration::minutes(30);
        let payload = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(
                i64::try_from(self.config.payload_ttl_ms).unwrap_or(i64::MAX),
            );
        let row=sqlx::query("INSERT INTO agent_runs(id,user_id,task_id,client_task_id,execution_profile,workspace_selection_id,agent_turn_id,state,schema_digest,protocol_version,request_ciphertext,request_iv,request_tag,request_key_version,contract_ciphertext,contract_iv,contract_tag,contract_key_version,deadline_at,payload_expires_at,public_summary)VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8,2,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Task queued for the durable agent runtime.')RETURNING *").bind(run).bind(user).bind(task).bind(client).bind(profile).bind(workspace).bind(turn).bind(&*TOOL_SCHEMA_DIGEST).bind(request_envelope.ciphertext).bind(request_envelope.iv).bind(request_envelope.tag).bind(i32::try_from(request_envelope.key_version).unwrap_or(i32::MAX)).bind(contract_envelope.ciphertext).bind(contract_envelope.iv).bind(contract_envelope.tag).bind(i32::try_from(contract_envelope.key_version).unwrap_or(i32::MAX)).bind(deadline).bind(payload).fetch_one(&mut*tx).await?;
        append_session_item(
            &mut tx,
            run,
            &self.crypto,
            &json!({"role":"user","content":request}),
        )
        .await?;
        insert_criterion(&mut tx, run, &self.crypto, &outcomes).await?;
        append_event(
            &mut tx,
            run,
            "run.queued",
            "Task queued for the durable agent runtime.",
            None,
        )
        .await?;
        tx.commit().await?;
        let mut value = self.public_run(&row)?;
        value["newlyCreated"] = Value::Bool(true);
        value["request"] = Value::String(request.to_owned());
        value["outcomeContract"] = outcomes;
        value["contractSchemaVersion"] = json!(8);
        value["autonomyMode"] = Value::String(autonomy.to_owned());
        value["intentAuthorization"] = contract["intentAuthorization"].clone();
        Ok(value)
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
                value["contractSchemaVersion"] = json!(8);
                value["autonomyMode"] = contract["autonomyMode"].clone();
                value["outcomeContract"] = contract["outcomeContract"].clone();
                value["intentAuthorization"] = contract["intentAuthorization"].clone();
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
                value["contractSchemaVersion"] = contract["schemaVersion"].clone();
                value["autonomyMode"] = contract["autonomyMode"].clone();
                value["outcomeContract"] = contract["outcomeContract"].clone();
                value["intentAuthorization"] = contract["intentAuthorization"].clone();
            }
            values.push(value);
        }
        Ok(values)
    }
    pub async fn cancel(&self, user: &str, run: Uuid) -> ApiResult<Option<Value>> {
        let mut tx = self.pool.begin().await?;
        let row=sqlx::query("UPDATE agent_runs SET state='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW(),public_summary='Task cancelled.' WHERE id=$1 AND user_id=$2 AND state NOT IN('completed','failed','cancelled','expired')RETURNING *").bind(run).bind(user).fetch_optional(&mut*tx).await?;
        if row.is_some() {
            sqlx::query("UPDATE agent_tool_invocations SET state=CASE WHEN state='executing'THEN'unknown'ELSE'cancelled'END,terminal_at=NOW()WHERE run_id=$1 AND state IN('requested','delivered','executing')")
                .bind(run)
                .execute(&mut *tx)
                .await?;
            append_event(&mut tx, run, "run.cancelled", "Task cancelled.", None).await?;
        }
        tx.commit().await?;
        row.map(|row| self.public_run(&row)).transpose()
    }
    pub async fn control(
        &self,
        user: &str,
        run: Uuid,
        kind: &str,
        input: &Value,
    ) -> ApiResult<Option<Value>> {
        let object = input.as_object().ok_or_else(invalid)?;
        if kind == "steering" {
            if object.len() != 2
                || object
                    .keys()
                    .any(|key| !matches!(key.as_str(), "clientTurnId" | "instruction"))
                || parse_uuid(input, "clientTurnId").is_err()
                || bounded_string(input, "instruction", 8_000).is_err()
            {
                return Err(invalid());
            }
        } else if object.len() != 3
            || object
                .keys()
                .any(|key| !matches!(key.as_str(), "interactionId" | "actionDigest" | "decision"))
            || parse_uuid(input, "interactionId").is_err()
            || input
                .get("actionDigest")
                .and_then(Value::as_str)
                .is_none_or(|value| {
                    value.len() != 64
                        || !value
                            .bytes()
                            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
                })
            || input
                .get("decision")
                .and_then(Value::as_str)
                .is_none_or(|value| !matches!(value, "approve" | "deny"))
        {
            return Err(invalid());
        }
        let summary = if kind == "steering" {
            "Steering update queued."
        } else if input.get("decision").and_then(Value::as_str) == Some("approve") {
            "Approval granted."
        } else {
            "Approval denied."
        };
        let payload_kind = if kind == "steering" {
            "agent_steering"
        } else {
            "agent_approval_decision"
        };
        let mut tx = self.pool.begin().await?;
        let row =
            sqlx::query("SELECT id,task_id FROM agent_runs WHERE id=$1 AND user_id=$2 FOR UPDATE")
                .bind(run)
                .bind(user)
                .fetch_optional(&mut *tx)
                .await?;
        let Some(row) = row else {
            tx.rollback().await?;
            return Ok(None);
        };
        if kind == "steering" {
            let client = parse_uuid(input, "clientTurnId")?;
            let plan: String = sqlx::query_scalar("SELECT plan FROM users WHERE id=$1")
                .bind(user)
                .fetch_one(&mut *tx)
                .await?;
            reserve_agent_turn(
                &mut tx,
                user,
                &plan,
                row.get("task_id"),
                client,
                self.enforce_cost_guard,
            )
            .await?;
        }
        let envelope = self.crypto.encrypt_json(
            input,
            &json!({"kind":payload_kind,"runId":run,"schemaVersion":1}),
        )?;
        let event = append_event(
            &mut tx,
            run,
            if kind == "steering" {
                "run.steering_queued"
            } else {
                "run.approval_decided"
            },
            summary,
            Some(envelope),
        )
        .await?;
        sqlx::query("UPDATE agent_runs SET state='recovering',lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW()WHERE id=$1 AND state NOT IN('completed','blocked','failed','cancelled','expired')").bind(run).execute(&mut*tx).await?;
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
        let capabilities = validate_capabilities(capabilities)?;
        if capabilities["schemaDigest"].as_str() != Some(TOOL_SCHEMA_DIGEST.as_str()) {
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "worker_upgrade_required",
                "Desktop worker must upgrade before accepting tasks.",
            ));
        }
        let id = Uuid::new_v4();
        let expires = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(
                i64::try_from(self.config.heartbeat_ttl_ms).unwrap_or(i64::MAX),
            );
        let row=sqlx::query("INSERT INTO agent_worker_sessions(id,user_id,device_session_id,protocol_version,schema_digest,capabilities,expires_at)VALUES($1,$2,$3,2,$4,$5,$6)RETURNING connected_at,expires_at").bind(id).bind(user).bind(device).bind(&*TOOL_SCHEMA_DIGEST).bind(&capabilities).bind(expires).fetch_one(&self.pool).await?;
        sqlx::query("UPDATE agent_runs SET state='recovering',lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW(),public_summary='Desktop worker reconnected; resuming task.'WHERE user_id=$1 AND state='awaiting_worker'AND deadline_at>NOW()").bind(user).execute(&self.pool).await?;
        Ok(
            json!({"id":id,"connectedAt":iso(row.get("connected_at")),"expiresAt":iso(row.get("expires_at"))}),
        )
    }
    async fn require_worker(&self, user: &str, worker: Uuid) -> ApiResult<Value> {
        sqlx::query_scalar("SELECT to_jsonb(workers) FROM agent_worker_sessions workers WHERE id=$1 AND user_id=$2 AND disconnected_at IS NULL AND expires_at>NOW()").bind(worker).bind(user).fetch_optional(&self.pool).await?.ok_or_else(||ApiError::coded(http::StatusCode::CONFLICT,"stale_worker_session","Desktop worker session is stale or disconnected."))
    }
    pub async fn heartbeat(&self, user: &str, worker: Uuid) -> ApiResult<Option<Value>> {
        let expires = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(
                i64::try_from(self.config.heartbeat_ttl_ms).unwrap_or(i64::MAX),
            );
        let updated = sqlx::query_scalar::<_, OffsetDateTime>("UPDATE agent_worker_sessions SET heartbeat_at=NOW(),expires_at=$3 WHERE id=$1 AND user_id=$2 AND disconnected_at IS NULL RETURNING expires_at").bind(worker).bind(user).bind(expires).fetch_optional(&self.pool).await?;
        Ok(updated.map(|expires| json!({"expiresAt":iso(expires)})))
    }
    pub async fn pending(&self, user: &str, worker: Uuid) -> ApiResult<Vec<Value>> {
        let session = self.require_worker(user, worker).await?;
        let rows=sqlx::query("SELECT invocations.* FROM agent_tool_invocations invocations JOIN agent_runs runs ON runs.id=invocations.run_id WHERE runs.user_id=$1 AND invocations.state IN('requested','delivered')AND invocations.expires_at>NOW()AND(invocations.state='requested'OR invocations.worker_session_id=$2 OR NOT EXISTS(SELECT 1 FROM agent_worker_sessions previous WHERE previous.id=invocations.worker_session_id AND previous.disconnected_at IS NULL AND previous.expires_at>NOW()))ORDER BY invocations.requested_at LIMIT 100").bind(user).bind(worker).fetch_all(&self.pool).await?;
        let mut values = Vec::new();
        for row in rows {
            let id: Uuid = row.get("id");
            let run: Uuid = row.get("run_id");
            let envelope = row_envelope(&row, "request")?
                .ok_or_else(|| ApiError::internal(anyhow::anyhow!("missing invocation payload")))?;
            let input=self.crypto.decrypt_json(&envelope,&json!({"invocationId":id,"kind":"agent_tool_request","runId":run,"schemaVersion":1}))?;
            let delivered=sqlx::query("UPDATE agent_tool_invocations SET state='delivered',worker_session_id=$2,delivered_at=COALESCE(delivered_at,NOW())WHERE id=$1 AND state IN('requested','delivered')AND expires_at>NOW()AND(worker_session_id IS NULL OR worker_session_id=$2 OR NOT EXISTS(SELECT 1 FROM agent_worker_sessions previous WHERE previous.id=agent_tool_invocations.worker_session_id AND previous.disconnected_at IS NULL AND previous.expires_at>NOW()))RETURNING id").bind(id).bind(worker).fetch_optional(&self.pool).await?;
            if delivered.is_none() {
                continue;
            }
            let tool_id = row.get::<String, _>("tool_id");
            let operation = row.get::<String, _>("operation");
            let mut verifier_kinds = Vec::new();
            if tool_id == "application.launch" {
                verifier_kinds.push("application_surface");
            }
            if tool_id == "browser.dom" {
                verifier_kinds.push("browser_semantic");
            }
            if matches!(
                tool_id.as_str(),
                "workspace.filesystem" | "workspace.terminal"
            ) {
                verifier_kinds.push("filesystem_effect");
            }
            let mut filesystem_ids = Vec::new();
            if tool_id.starts_with("workspace.") {
                filesystem_ids.push("workspace-inspected");
                if matches!(operation.as_str(), "write_file" | "run_command") {
                    filesystem_ids.push("workspace-mutated");
                }
            }
            let (effect_id, _, _) = effect_criterion(&tool_id, &operation)?;
            let obligations=sqlx::query("SELECT criteria.criterion_id,criteria.verifier_kind FROM agent_outcome_criteria criteria JOIN agent_runs runs ON runs.id=criteria.run_id WHERE criteria.run_id=$1 AND criteria.revision=runs.outcome_revision AND(criteria.criterion_id=$2 OR(criteria.verifier_kind=ANY($3::text[])AND(criteria.verifier_kind<>'filesystem_effect'OR criteria.criterion_id=ANY($4::text[]))))ORDER BY(criteria.criterion_id=$2)DESC,criteria.criterion_id LIMIT 4").bind(run).bind(effect_id).bind(&verifier_kinds).bind(&filesystem_ids).fetch_all(&self.pool).await?;
            let obligations = obligations.into_iter().map(|criterion| json!({"criterionId":criterion.get::<String,_>("criterion_id"),"verifierKind":criterion.get::<String,_>("verifier_kind")})).collect::<Vec<_>>();
            values.push(json!({"protocolVersion":2,"schemaDigest":session["schema_digest"],"invocationId":id,"runId":run,"callId":row.get::<String,_>("call_id"),"toolId":tool_id,"operation":operation,"effect":input["effect"],"intentRevision":row.get::<i32,_>("intent_revision"),"approvalRequired":row.get::<bool,_>("approval_required"),"authorizationSource":row.get::<String,_>("authorization_source"),"consequential":row.get::<bool,_>("consequential"),"input":input["input"],"obligations":obligations,"expiresAt":iso(row.get("expires_at"))}));
        }
        Ok(values)
    }
    pub async fn grant_execution(
        &self,
        user: &str,
        worker: Uuid,
        input: &Value,
    ) -> ApiResult<Value> {
        self.require_worker(user, worker).await?;
        let object = input.as_object().ok_or_else(invalid)?;
        if object.len() != 6
            || object.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "invocationId"
                        | "effect"
                        | "intentRevision"
                        | "approvalRequired"
                        | "authorizationSource"
                        | "consequential"
                )
            })
        {
            return Err(invalid());
        }
        let id = parse_uuid(input, "invocationId")?;
        let effect = input.get("effect").ok_or_else(invalid)?;
        validate_effect(effect)?;
        let effect_kind = effect
            .get("kind")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let resource_kind = effect.get("resourceKind").and_then(Value::as_str);
        let intent_revision = input
            .get("intentRevision")
            .and_then(Value::as_i64)
            .filter(|value| (1..=10_000).contains(value))
            .ok_or_else(invalid)?;
        let approval_required = input
            .get("approvalRequired")
            .and_then(Value::as_bool)
            .ok_or_else(invalid)?;
        let authorization_source = input
            .get("authorizationSource")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "routine" | "user_instruction" | "exact_approval"))
            .ok_or_else(invalid)?;
        let consequential = input
            .get("consequential")
            .and_then(Value::as_bool)
            .ok_or_else(invalid)?;
        if consequential != (effect_kind != "none")
            || (authorization_source == "routine" && effect_kind != "none")
            || (authorization_source == "user_instruction" && effect_kind == "none")
            || approval_required != (authorization_source == "exact_approval")
        {
            return Err(invalid());
        }
        let result=sqlx::query("UPDATE agent_tool_invocations SET state='executing',executing_at=NOW(),effect_kind=$3,resource_kind=$4,authorization_source=$5,approval_required=$6,consequential=$7 WHERE id=$1 AND worker_session_id=$2 AND state IN('requested','delivered')AND expires_at>NOW()AND intent_revision=$8 RETURNING id,state,run_id,tool_id,operation").bind(id).bind(worker).bind(effect_kind).bind(resource_kind).bind(authorization_source).bind(approval_required).bind(consequential).bind(intent_revision).fetch_optional(&self.pool).await?;
        if let Some(row) = &result {
            let (criterion_id, _, _) = effect_criterion(
                &row.get::<String, _>("tool_id"),
                &row.get::<String, _>("operation"),
            )?;
            sqlx::query("UPDATE agent_outcome_criteria criteria SET required=TRUE,updated_at=NOW()FROM agent_runs runs WHERE runs.id=$1 AND criteria.run_id=runs.id AND criteria.revision=runs.outcome_revision AND criteria.criterion_id=$2")
                .bind(row.get::<Uuid, _>("run_id"))
                .bind(criterion_id)
                .execute(&self.pool)
                .await?;
        }
        Ok(result.map_or(
            json!({"kind":"stale"}),
            |_| json!({"kind":"granted","invocationId":id}),
        ))
    }
    pub async fn record_result(&self, user: &str, worker: Uuid, input: &Value) -> ApiResult<Value> {
        self.require_worker(user, worker).await?;
        let object = input.as_object().ok_or_else(invalid)?;
        if object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "invocationId" | "status" | "summary" | "data" | "visual" | "evidence"
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
        let evidence = match input.get("evidence") {
            Some(value) => value.as_array().map(Vec::as_slice).ok_or_else(invalid)?,
            None => &[],
        };
        if evidence.len() > 20 {
            return Err(invalid());
        }
        let durable = json!({"invocationId":id,"status":status,"summary":summary,"data":input.get("data"),"evidence":evidence});
        let mut tx = self.pool.begin().await?;
        let row=sqlx::query("SELECT run_id,call_id,consequential,state FROM agent_tool_invocations WHERE id=$1 AND worker_session_id=$2 FOR UPDATE").bind(id).bind(worker).fetch_optional(&mut *tx).await?;
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
        let run: Uuid = row.get("run_id");
        let envelope = self.crypto.encrypt_json(
            &durable,
            &json!({"invocationId":id,"kind":"agent_tool_result","runId":run,"schemaVersion":1}),
        )?;
        sqlx::query("UPDATE agent_tool_invocations SET state=$3,result_ciphertext=$4,result_iv=$5,result_tag=$6,result_key_version=$7,public_summary=$8,terminal_at=NOW()WHERE id=$1 AND worker_session_id=$2").bind(id).bind(worker).bind(status).bind(envelope.ciphertext).bind(envelope.iv).bind(envelope.tag).bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX)).bind(summary).execute(&mut *tx).await?;
        for item in evidence {
            let item_object = item.as_object().ok_or_else(invalid)?;
            if item_object.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "criterionId"
                        | "source"
                        | "status"
                        | "observationId"
                        | "observationFingerprint"
                        | "summary"
                )
            }) {
                return Err(invalid());
            }
            let criterion = bounded_string(item, "criterionId", 80)?;
            let source = item
                .get("source")
                .and_then(Value::as_str)
                .filter(|value| {
                    matches!(
                        *value,
                        "tool_result" | "fresh_observation" | "browser_dom" | "filesystem"
                    )
                })
                .ok_or_else(invalid)?;
            let evidence_status = item
                .get("status")
                .and_then(Value::as_str)
                .filter(|value| matches!(*value, "supports" | "contradicts" | "unknown"))
                .ok_or_else(invalid)?;
            let evidence_summary = bounded_string(item, "summary", 1_000)?;
            let observation_id = item
                .get("observationId")
                .map(|value| {
                    value
                        .as_str()
                        .ok_or_else(invalid)
                        .and_then(|value| zod_uuid(value).ok_or_else(invalid))
                })
                .transpose()?;
            let fingerprint = item
                .get("observationFingerprint")
                .map(|value| {
                    value
                        .as_str()
                        .filter(|value| {
                            value.len() == 64
                                && value.bytes().all(|byte| {
                                    byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()
                                })
                        })
                        .ok_or_else(invalid)
                })
                .transpose()?;
            sqlx::query("INSERT INTO agent_evidence(id,run_id,revision,criterion_id,source,status,invocation_id,observation_id,observation_fingerprint,public_summary)SELECT $1,$2,runs.outcome_revision,$3,$4,$5,$6,$7,$8,$9 FROM agent_runs runs WHERE runs.id=$2 ON CONFLICT(id)DO NOTHING").bind(Uuid::new_v4()).bind(run).bind(criterion).bind(source).bind(evidence_status).bind(id).bind(observation_id).bind(fingerprint).bind(evidence_summary).execute(&mut *tx).await?;
            sqlx::query("UPDATE agent_outcome_criteria criteria SET state=CASE WHEN $3='contradicts'THEN'failed'WHEN $3='supports'THEN'passed'WHEN $3='unknown'THEN'unknown'ELSE criteria.state END,updated_at=NOW()FROM agent_runs runs WHERE runs.id=$1 AND criteria.run_id=runs.id AND criteria.revision=runs.outcome_revision AND criteria.criterion_id=$2").bind(run).bind(criterion).bind(evidence_status).execute(&mut *tx).await?;
        }
        append_session_item(&mut tx,run,&self.crypto,&json!({"type":"function_call_output","call_id":row.get::<String,_>("call_id"),"output":serde_json::to_string(&durable).unwrap_or_default()})).await?;
        let next = if status == "unknown" && row.get::<bool, _>("consequential") {
            "blocked"
        } else {
            "verifying"
        };
        let public_summary = if next == "blocked" {
            "A consequential desktop action has an unknown outcome and will not be retried."
        } else {
            "Desktop result received; verifying task outcomes."
        };
        sqlx::query("UPDATE agent_runs SET state=$2,lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW(),public_summary=$3 WHERE id=$1").bind(run).bind(next).bind(public_summary).execute(&mut *tx).await?;
        append_event(
            &mut tx,
            run,
            if next == "blocked" {
                "run.blocked"
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
            let changed = sqlx::query("UPDATE agent_runs SET state='blocked',lease_owner=NULL,lease_expires_at=NULL,public_summary='A desktop action has an unknown outcome.',updated_at=NOW()WHERE id=$1 AND state NOT IN('completed','blocked','failed','cancelled','expired')")
                .bind(run_id)
                .execute(&mut *tx)
                .await?
                .rows_affected();
            if changed == 1 {
                append_event(
                    &mut tx,
                    *run_id,
                    "run.blocked",
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
             WHERE disconnected_at IS NULL AND expires_at<=NOW() LIMIT 500",
        )
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
             WHERE expires_at<=NOW() AND state IN ('requested','delivered') RETURNING run_id",
        )
        .fetch_all(&mut *tx)
        .await?;
        let run_ids = expired_tools
            .iter()
            .map(|row| row.get::<Uuid, _>("run_id"))
            .collect::<BTreeSet<_>>();
        for run_id in run_ids {
            let changed = sqlx::query(
                "UPDATE agent_runs SET state='blocked',lease_owner=NULL,lease_expires_at=NULL,
                   public_summary='A required desktop invocation expired.',updated_at=NOW()
                 WHERE id=$1 AND state NOT IN ('completed','blocked','failed','cancelled','expired')",
            )
            .bind(run_id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if changed == 1 {
                append_event(
                    &mut tx,
                    run_id,
                    "run.blocked",
                    "A required desktop invocation expired before execution.",
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

    pub async fn run_once(&self) -> ApiResult<bool> {
        let row=sqlx::query("WITH candidate AS(SELECT id FROM agent_runs WHERE state IN('queued','planning','recovering','verifying')AND deadline_at>NOW()AND recovery_attempt_count<6 AND(lease_expires_at IS NULL OR lease_expires_at<NOW())ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)UPDATE agent_runs runs SET state=CASE WHEN runs.lease_owner IS NULL THEN runs.state ELSE'recovering'END,lease_owner=$1,lease_expires_at=NOW()+($2*INTERVAL'1 millisecond'),recovery_attempt_count=CASE WHEN runs.lease_owner IS NULL THEN runs.recovery_attempt_count ELSE runs.recovery_attempt_count+1 END,run_version=run_version+1,updated_at=NOW()FROM candidate WHERE runs.id=candidate.id RETURNING runs.*").bind(&self.worker_id).bind(i64::try_from(self.config.lease_ms).unwrap_or(i64::MAX)).fetch_optional(&self.pool).await?;
        let Some(run) = row else { return Ok(false) };
        let user: String = run.get("user_id");
        let worker:Option<Value>=sqlx::query_scalar("SELECT capabilities FROM agent_worker_sessions WHERE user_id=$1 AND disconnected_at IS NULL AND expires_at>NOW()ORDER BY heartbeat_at DESC LIMIT 1").bind(&user).fetch_optional(&self.pool).await?;
        let Some(capabilities) = worker else {
            self.transition(
                run.get("id"),
                "awaiting_worker",
                "run.awaiting_worker",
                "Waiting for the signed-in desktop worker.",
            )
            .await?;
            return Ok(true);
        };
        if let Err(error) = self.process_run(&run, &capabilities).await {
            tracing::error!(
                event = "agent.worker.failed",
                code = error.code.unwrap_or("agent_worker_error")
            );
            self.transition(
                run.get("id"),
                "blocked",
                "run.blocked",
                "The durable agent run stopped at a safe recovery boundary.",
            )
            .await?;
        }
        Ok(true)
    }
    async fn process_run(
        &self,
        run: &sqlx::postgres::PgRow,
        capabilities: &Value,
    ) -> ApiResult<()> {
        let id: Uuid = run.get("id");
        let user: String = run.get("user_id");
        let task: Uuid = run.get("task_id");
        let turn: Uuid = run.get("agent_turn_id");
        let plan: String = sqlx::query_scalar("SELECT plan FROM users WHERE id=$1")
            .bind(&user)
            .fetch_one(&self.pool)
            .await?;
        plan_for(&plan)?;
        let request = self.decrypt_request(run)?;
        let checkpoint = sqlx::query(
            "SELECT * FROM agent_run_checkpoints WHERE run_id=$1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        let mut items = vec![json!({"role":"user","content":request})];
        if let Some(checkpoint) = checkpoint {
            let envelope = row_envelope(&checkpoint, "state")?
                .ok_or_else(|| ApiError::internal(anyhow::anyhow!("checkpoint missing")))?;
            let value=self.crypto.decrypt_json(&envelope,&json!({"graphDigest":checkpoint.get::<String,_>("graph_digest"),"kind":"agent_run_state","modelStepId":checkpoint.get::<Uuid,_>("model_step_id"),"runId":id,"runVersion":checkpoint.get::<i32,_>("run_version"),"schemaVersion":2}))?;
            items = value["items"].as_array().cloned().unwrap_or_default();
            let invocation=sqlx::query("SELECT * FROM agent_tool_invocations WHERE run_id=$1 ORDER BY requested_at DESC LIMIT 1").bind(id).fetch_optional(&self.pool).await?.ok_or_else(||ApiError::internal(anyhow::anyhow!("pending invocation missing")))?;
            let state: String = invocation.get("state");
            if !matches!(
                state.as_str(),
                "confirmed" | "failed" | "denied" | "not_executed" | "unknown" | "cancelled"
            ) {
                self.transition(
                    id,
                    "awaiting_worker",
                    "run.awaiting_worker",
                    "Waiting for the pending desktop result.",
                )
                .await?;
                return Ok(());
            }
            if state == "unknown" && invocation.get::<bool, _>("consequential") {
                self.transition(id,"blocked","run.blocked","A consequential desktop action has an unknown outcome and will not be retried.").await?;
                return Ok(());
            }
            let result=row_envelope(&invocation,"result")?.map(|env|self.crypto.decrypt_json(&env,&json!({"invocationId":invocation.get::<Uuid,_>("id"),"kind":"agent_tool_result","runId":id,"schemaVersion":1}))).transpose()?.unwrap_or_else(||json!({"status":state,"summary":invocation.get::<String,_>("public_summary")}));
            items.push(json!({"type":"function_call_output","call_id":invocation.get::<String,_>("call_id"),"output":serde_json::to_string(&result).unwrap_or_default()}));
        }
        let controls=sqlx::query("SELECT events.* FROM agent_run_events events JOIN agent_runs runs ON runs.id=events.run_id WHERE events.run_id=$1 AND events.sequence>runs.last_control_sequence AND events.type='run.steering_queued'ORDER BY events.sequence LIMIT 20").bind(id).fetch_all(&self.pool).await?;
        if !controls.is_empty() {
            let mut tx = self.pool.begin().await?;
            lock_lease(&mut tx, id, &self.worker_id, run.get("run_version")).await?;
            for control in controls {
                let envelope = row_envelope(&control, "payload")?.ok_or_else(|| {
                    ApiError::internal(anyhow::anyhow!("steering payload missing"))
                })?;
                let payload = self.crypto.decrypt_json(
                    &envelope,
                    &json!({"kind":"agent_steering","runId":id,"schemaVersion":1}),
                )?;
                let instruction = bounded_string(&payload, "instruction", 8_000)?;
                let item = json!({"role":"user","content":instruction});
                items.push(item.clone());
                append_session_item(&mut tx, id, &self.crypto, &item).await?;
                let sequence = control.get::<i64, _>("sequence");
                sqlx::query("UPDATE agent_runs SET last_control_sequence=$2,updated_at=NOW()WHERE id=$1 AND last_control_sequence<$2")
                    .bind(id)
                    .bind(sequence)
                    .execute(&mut *tx)
                    .await?;
                append_event(
                    &mut tx,
                    id,
                    "run.steering_applied",
                    "Steering applied at a safe model boundary.",
                    None,
                )
                .await?;
            }
            tx.commit().await?;
        }
        let run_version = run.get::<i32, _>("run_version");
        self.transition_leased(
            id,
            run_version,
            "planning",
            "run.planning",
            "Durable agent planning started.",
        )
        .await?;
        let tools = model_tools(capabilities)?;
        let reasoning_effort = if run.get::<String, _>("execution_profile") == "workspace" {
            "high"
        } else {
            "medium"
        };
        let model = if self.allowed_models.contains("gpt-5.6-terra") {
            "gpt-5.6-terra"
        } else if self.allowed_models.contains("gpt-5.6-luna") {
            "gpt-5.6-luna"
        } else {
            return Err(ApiError::internal(anyhow::anyhow!(
                "No allowlisted model is available for the agent route."
            )));
        };
        let body = json!({"model":model,"instructions":INSTRUCTIONS,"input":items,"tools":tools,"tool_choice":"auto","parallel_tool_calls":false,"store":false,"max_output_tokens":4000,"reasoning":{"effort":reasoning_effort}});
        let request_id = Uuid::new_v4();
        let safety = format!("{:x}", Sha256::digest(format!("trocode:{user}").as_bytes()));
        let provider_calls: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM model_budget_reservations WHERE agent_turn_id=$1 AND status<>'released'",
        )
        .bind(turn)
        .fetch_one(&self.pool)
        .await?;
        if provider_calls >= 30 {
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "agent_turn_limit_reached",
                "The durable agent reached its bounded model-turn limit.",
            ));
        }
        let renewal = self.start_lease_renewal(id, run_version);
        let response_result = self
            .responses
            .execute(ResponsesInput {
                body,
                agent_turn_id: turn,
                request_id,
                safety_identifier: &safety,
                task_id: task,
                user_id: &user,
                plan_id: &plan,
            })
            .await;
        renewal.cancel();
        let response = response_result?;
        let ProviderBody::Buffered(bytes) = response.body else {
            return Err(ApiError::internal(anyhow::anyhow!(
                "agent responses must be buffered"
            )));
        };
        let value: Value = serde_json::from_slice(&bytes).map_err(ApiError::internal)?;
        let output = value
            .get("output")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let calls: Vec<_> = output
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
            .collect();
        if calls.len() > 1 {
            return Err(ApiError::internal(anyhow::anyhow!(
                "Parallel remote tool interruptions are disabled."
            )));
        }
        if let Some(call) = calls.first() {
            self.interrupt(run, &items, call).await?;
            return Ok(());
        }
        let final_output = output
            .iter()
            .filter_map(|item| item.get("content").and_then(Value::as_array))
            .flatten()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("output_text"))
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("");
        if final_output.trim().is_empty() {
            return Err(ApiError::internal(anyhow::anyhow!(
                "Agent returned no final output."
            )));
        }
        let envelope = self.crypto.encrypt_json(
            &json!({"finalOutput":&final_output}),
            &json!({"kind":"agent_final_output","runId":id,"schemaVersion":1}),
        )?;
        let mut tx = self.pool.begin().await?;
        lock_lease(&mut tx, id, &self.worker_id, run_version).await?;
        sqlx::query("UPDATE agent_outcome_criteria SET state='passed',updated_at=NOW()WHERE run_id=$1 AND verifier_kind='assistant_output'").bind(id).execute(&mut*tx).await?;
        append_session_item(
            &mut tx,
            id,
            &self.crypto,
            &json!({"role":"assistant","content":final_output}),
        )
        .await?;
        let incomplete = sqlx::query("SELECT criterion_id,state FROM agent_outcome_criteria WHERE run_id=$1 AND revision=(SELECT outcome_revision FROM agent_runs WHERE id=$1)AND required=TRUE AND state<>'passed'ORDER BY criterion_id LIMIT 1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
        if let Some(incomplete) = incomplete {
            let criterion = incomplete.get::<String, _>("criterion_id");
            sqlx::query("UPDATE agent_runs SET state='blocked',lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW(),public_summary=$2 WHERE id=$1")
                .bind(id)
                .bind(format!("Required outcome {criterion} is not verified."))
                .execute(&mut *tx)
                .await?;
            append_event(
                &mut tx,
                id,
                "run.blocked",
                "A required outcome could not be verified from trusted evidence.",
                None,
            )
            .await?;
            tx.commit().await?;
            return Ok(());
        }
        sqlx::query("UPDATE agent_runs SET state='completed',lease_owner=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW(),public_summary='Task completed with all required outcomes verified.'WHERE id=$1").bind(id).execute(&mut*tx).await?;
        append_event(
            &mut tx,
            id,
            "run.completed",
            "Task completed with all required outcomes verified.",
            Some(envelope),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    async fn interrupt(
        &self,
        run: &sqlx::postgres::PgRow,
        items: &[Value],
        call: &Value,
    ) -> ApiResult<()> {
        let id: Uuid = run.get("id");
        let call_id = call
            .get("call_id")
            .or_else(|| call.get("callId"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && value.len() <= 255)
            .ok_or_else(invalid)?;
        let name = call
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let tool_id = name.replace("__", ".").replace('_', "-");
        let arguments: Value = serde_json::from_str(
            call.get("arguments")
                .and_then(Value::as_str)
                .unwrap_or("{}"),
        )
        .map_err(|_| invalid())?;
        let operation = arguments
            .get("operation")
            .and_then(Value::as_str)
            .filter(|op| {
                TOOLS
                    .iter()
                    .any(|(tool, ops)| *tool == tool_id && ops.contains(op))
            })
            .ok_or_else(invalid)?;
        let effect = arguments.get("effect").cloned().ok_or_else(invalid)?;
        validate_effect(&effect)?;
        let effect_kind = effect
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let consequential = effect_kind != "none";
        let invocation = Uuid::new_v4();
        let request = json!({"callId":call_id,"toolId":tool_id,"operation":operation,"effect":effect,"intentRevision":1,"approvalRequired":consequential,"authorizationSource":if consequential{"none"}else{"routine"},"consequential":consequential,"input":arguments.get("input").cloned().unwrap_or_else(||json!({}))});
        let request_envelope=self.crypto.encrypt_json(&request,&json!({"invocationId":invocation,"kind":"agent_tool_request","runId":id,"schemaVersion":1}))?;
        let mut continuation = items.to_vec();
        continuation.push(call.clone());
        let model_step = Uuid::new_v4();
        let run_version: i32 = run.get("run_version");
        let state=self.crypto.encrypt_json(&json!({"checkpointVersion":2,"items":continuation,"pendingCallId":call_id}),&json!({"graphDigest":&*TOOL_SCHEMA_DIGEST,"kind":"agent_run_state","modelStepId":model_step,"runId":id,"runVersion":run_version,"schemaVersion":2}))?;
        let expires = OffsetDateTime::now_utc() + time::Duration::minutes(5);
        let mut tx = self.pool.begin().await?;
        lock_lease(&mut tx, id, &self.worker_id, run_version).await?;
        let (criterion_id, verifier, verifier_digest) = effect_criterion(&tool_id, operation)?;
        let description = self.crypto.encrypt_json(
            &json!({"description":format!("The desktop completed {tool_id}.{operation} with a trusted result."),"verifier":verifier}),
            &json!({"criterionId":&criterion_id,"kind":"agent_outcome_criterion","runId":id,"schemaVersion":1}),
        )?;
        sqlx::query("INSERT INTO agent_outcome_criteria(run_id,revision,criterion_id,verifier_kind,verifier_digest,required,description_ciphertext,description_iv,description_tag,description_key_version)SELECT $1,runs.outcome_revision,$2,'tool_effect',$3,FALSE,$4,$5,$6,$7 FROM agent_runs runs WHERE runs.id=$1 ON CONFLICT(run_id,revision,criterion_id)DO NOTHING")
            .bind(id)
            .bind(&criterion_id)
            .bind(verifier_digest)
            .bind(description.ciphertext)
            .bind(description.iv)
            .bind(description.tag)
            .bind(i32::try_from(description.key_version).unwrap_or(i32::MAX))
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO agent_run_checkpoints(run_id,run_version,model_step_id,graph_digest,state_ciphertext,state_iv,state_tag,state_key_version)VALUES($1,$2,$3,$4,$5,$6,$7,$8)ON CONFLICT(run_id,run_version)DO UPDATE SET state_ciphertext=EXCLUDED.state_ciphertext,state_iv=EXCLUDED.state_iv,state_tag=EXCLUDED.state_tag,state_key_version=EXCLUDED.state_key_version").bind(id).bind(run_version).bind(model_step).bind(&*TOOL_SCHEMA_DIGEST).bind(state.ciphertext).bind(state.iv).bind(state.tag).bind(i32::try_from(state.key_version).unwrap_or(i32::MAX)).execute(&mut*tx).await?;
        append_session_item(&mut tx, id, &self.crypto, call).await?;
        sqlx::query("INSERT INTO agent_tool_invocations(id,run_id,call_id,tool_id,operation,state,consequential,idempotency_key,request_ciphertext,request_iv,request_tag,request_key_version,public_summary,expires_at,effect_kind,resource_kind,authorization_source,intent_revision,approval_required)VALUES($1,$2,$3,$4,$5,'requested',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1,$17)ON CONFLICT(run_id,call_id)DO NOTHING").bind(invocation).bind(id).bind(call_id).bind(&tool_id).bind(operation).bind(consequential).bind(format!("{run_version}:{call_id}")).bind(request_envelope.ciphertext).bind(request_envelope.iv).bind(request_envelope.tag).bind(i32::try_from(request_envelope.key_version).unwrap_or(i32::MAX)).bind(format!("{tool_id}.{operation} requested.")).bind(expires).bind(effect_kind).bind(effect.get("resourceKind").and_then(Value::as_str)).bind(if consequential{"none"}else{"routine"}).bind(consequential).execute(&mut*tx).await?;
        sqlx::query("UPDATE agent_runs SET state='awaiting_worker',lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW(),public_summary='Waiting for the desktop worker.'WHERE id=$1").bind(id).execute(&mut*tx).await?;
        append_event(
            &mut tx,
            id,
            "run.awaiting_worker",
            "Waiting for the desktop worker.",
            None,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    async fn transition(
        &self,
        run: Uuid,
        state: &str,
        event: &str,
        summary: &str,
    ) -> ApiResult<()> {
        let mut tx = self.pool.begin().await?;
        let changed=sqlx::query("UPDATE agent_runs SET state=$2,lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW(),public_summary=$3 WHERE id=$1 AND state NOT IN('completed','blocked','failed','cancelled','expired')").bind(run).bind(state).bind(summary).execute(&mut*tx).await?.rows_affected();
        if changed == 1 {
            append_event(&mut tx, run, event, summary, None).await?;
        }
        tx.commit().await?;
        Ok(())
    }
    async fn transition_leased(
        &self,
        run: Uuid,
        run_version: i32,
        state: &str,
        event: &str,
        summary: &str,
    ) -> ApiResult<()> {
        let mut tx = self.pool.begin().await?;
        lock_lease(&mut tx, run, &self.worker_id, run_version).await?;
        sqlx::query(
            "UPDATE agent_runs SET state=$2,updated_at=NOW(),public_summary=$3 WHERE id=$1",
        )
        .bind(run)
        .bind(state)
        .bind(summary)
        .execute(&mut *tx)
        .await?;
        append_event(&mut tx, run, event, summary, None).await?;
        tx.commit().await?;
        Ok(())
    }
    fn start_lease_renewal(&self, run: Uuid, run_version: i32) -> CancellationToken {
        let cancellation = CancellationToken::new();
        let child = cancellation.child_token();
        let pool = self.pool.clone();
        let worker_id = self.worker_id.clone();
        let lease_ms = self.config.lease_ms;
        tokio::spawn(async move {
            let mut interval =
                tokio::time::interval(Duration::from_millis((lease_ms / 3).max(250)));
            interval.tick().await;
            loop {
                tokio::select! {
                    () = child.cancelled() => break,
                    _ = interval.tick() => {
                        let changed = sqlx::query("UPDATE agent_runs SET lease_expires_at=NOW()+($4*INTERVAL'1 millisecond'),updated_at=NOW()WHERE id=$1 AND lease_owner=$2 AND run_version=$3 AND lease_expires_at>NOW()")
                            .bind(run)
                            .bind(&worker_id)
                            .bind(run_version)
                            .bind(i64::try_from(lease_ms).unwrap_or(i64::MAX))
                            .execute(&pool)
                            .await;
                        match changed {
                            Ok(result) if result.rows_affected() == 1 => {}
                            Ok(_) => break,
                            Err(error) => {
                                tracing::error!(event="agent.lease_renewal_failed",%run,%error);
                                break;
                            }
                        }
                    }
                }
            }
        });
        cancellation
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
        self.crypto.decrypt_json(
            &env,
            &json!({"kind":"agent_run_contract","runId":id,"schemaVersion":8}),
        )
    }
    fn public_run(&self, row: &sqlx::postgres::PgRow) -> ApiResult<Value> {
        Ok(
            json!({"id":row.get::<Uuid,_>("id"),"userId":row.get::<String,_>("user_id"),"taskId":row.get::<Uuid,_>("task_id"),"clientTaskId":row.get::<Uuid,_>("client_task_id"),"executionProfile":row.get::<String,_>("execution_profile"),"workspaceSelectionId":row.get::<Option<Uuid>,_>("workspace_selection_id"),"state":row.get::<String,_>("state"),"schemaDigest":row.get::<String,_>("schema_digest"),"protocolVersion":row.get::<i32,_>("protocol_version"),"runVersion":row.get::<i32,_>("run_version"),"outcomeRevision":row.get::<i32,_>("outcome_revision"),"nextSequence":row.get::<i64,_>("next_sequence"),"leaseOwner":row.get::<Option<String>,_>("lease_owner"),"leaseExpiresAt":row.get::<Option<OffsetDateTime>,_>("lease_expires_at").map(iso),"deadlineAt":iso(row.get("deadline_at")),"payloadExpiresAt":iso(row.get("payload_expires_at")),"publicSummary":row.get::<String,_>("public_summary"),"createdAt":iso(row.get("created_at")),"updatedAt":iso(row.get("updated_at"))}),
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
fn effect_criterion(tool_id: &str, operation: &str) -> ApiResult<(String, Value, String)> {
    let verifier = json!({"kind":"tool_effect","operation":operation,"toolId":tool_id});
    let bytes = serde_json::to_vec(&verifier).map_err(ApiError::internal)?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    Ok((format!("effect-{}", &digest[..16]), verifier, digest))
}
fn validate_capabilities(capabilities: &Value) -> ApiResult<Value> {
    let object = capabilities.as_object().ok_or_else(invalid)?;
    if object.len() != 3
        || object
            .keys()
            .any(|key| !matches!(key.as_str(), "protocolVersion" | "schemaDigest" | "tools"))
    {
        return Err(invalid());
    }
    if capabilities.get("protocolVersion").and_then(Value::as_i64) != Some(2) {
        return Err(invalid());
    }
    let digest = capabilities
        .get("schemaDigest")
        .and_then(Value::as_str)
        .filter(|value| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
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
            .ok_or_else(invalid)?;
        let operations = operations
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
    Ok(json!({"protocolVersion":2,"schemaDigest":digest,"tools":normalized_tools}))
}
async fn lock_lease(
    tx: &mut Transaction<'_, Postgres>,
    run: Uuid,
    worker_id: &str,
    run_version: i32,
) -> ApiResult<()> {
    let locked = sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM agent_runs WHERE id=$1 AND lease_owner=$2 AND run_version=$3 AND lease_expires_at>NOW()FOR UPDATE",
    )
    .bind(run)
    .bind(worker_id)
    .bind(run_version)
    .fetch_optional(&mut **tx)
    .await?;
    if locked.is_some() {
        Ok(())
    } else {
        Err(ApiError::coded(
            http::StatusCode::CONFLICT,
            "stale_agent_lease",
            "The durable agent lease is stale.",
        ))
    }
}
async fn append_session_item(
    tx: &mut Transaction<'_, Postgres>,
    run: Uuid,
    crypto: &AgentStateCrypto,
    item: &Value,
) -> ApiResult<()> {
    let generation: i32 = sqlx::query_scalar(
        "SELECT COALESCE(pending_session_generation,session_generation)FROM agent_runs WHERE id=$1 FOR UPDATE",
    )
    .bind(run)
    .fetch_one(&mut **tx)
    .await?;
    let sequence: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(item_sequence),0)+1 FROM agent_session_items WHERE run_id=$1 AND generation=$2",
    )
    .bind(run)
    .bind(generation)
    .fetch_one(&mut **tx)
    .await?;
    let sanitized = strip_image_bytes(item);
    let envelope = crypto.encrypt_json(
        &sanitized,
        &json!({"kind":"agent_session_item","runId":run,"schemaVersion":1,"generation":generation,"sequence":sequence}),
    )?;
    sqlx::query("INSERT INTO agent_session_items(run_id,generation,item_sequence,item_ciphertext,item_iv,item_tag,item_key_version)VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(run)
        .bind(generation)
        .bind(sequence)
        .bind(envelope.ciphertext)
        .bind(envelope.iv)
        .bind(envelope.tag)
        .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
        .execute(&mut **tx)
        .await?;
    Ok(())
}
fn strip_image_bytes(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(strip_image_bytes).collect()),
        Value::Object(object)
            if matches!(
                object.get("type").and_then(Value::as_str),
                Some("input_image" | "computer_screenshot")
            ) =>
        {
            json!({"type":"input_text","text":"[visual evidence expired; capture a fresh observation]"})
        }
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, item)| {
                    let sanitized = if matches!(
                        key.as_str(),
                        "dataBase64" | "dataUrl" | "image_url" | "imageUrl"
                    ) || item
                        .as_str()
                        .is_some_and(|text| text.starts_with("data:image/"))
                    {
                        Value::String("[visual evidence removed]".to_owned())
                    } else {
                        strip_image_bytes(item)
                    };
                    (key.clone(), sanitized)
                })
                .collect(),
        ),
        _ => value.clone(),
    }
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
fn outcome_contract(request: &str, profile: &str) -> Value {
    let mut criteria = vec![
        json!({"id":"assistant-output","description":"Return a bounded user-facing answer that addresses the request.","required":true,"verifier":{"kind":"assistant_output","constraints":["The output must be non-empty and user-facing."]}}),
    ];
    let lower = request.to_ascii_lowercase();
    if lower.contains("open chrome") || lower.contains("launch chrome") {
        criteria.push(json!({"id":"chrome-surface-visible","description":"A fresh trusted observation confirms a visible Chrome surface.","required":true,"verifier":{"kind":"application_surface","application":"chrome"}}));
    }
    if profile == "workspace" {
        let mutation = [
            "add",
            "change",
            "create",
            "delete",
            "edit",
            "fix",
            "implement",
            "modify",
            "refactor",
            "remove",
            "rename",
            "update",
            "write",
        ]
        .iter()
        .any(|word| lower.split_whitespace().any(|token| token == *word));
        criteria.push(json!({"id":if mutation{"workspace-mutated"}else{"workspace-inspected"},"description":if mutation{"A trusted local Workspace operation produced and verified the requested change."}else{"A trusted local Workspace operation inspected the selected repository."},"required":true,"verifier":{"kind":"filesystem_effect","assertion":if mutation{"A verified file write or successful workspace command materially advanced the requested change."}else{"A verified workspace read or successful command grounded the response in the selected repository."}}}));
    }
    json!({"schemaVersion":1,"revision":1,"completionMode":"all_required","criteria":criteria})
}
async fn insert_criterion(
    tx: &mut Transaction<'_, Postgres>,
    run: Uuid,
    crypto: &AgentStateCrypto,
    contract: &Value,
) -> ApiResult<()> {
    for criterion in contract["criteria"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
    {
        let id = criterion["id"].as_str().unwrap_or("criterion");
        let verifier = &criterion["verifier"];
        let digest = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(verifier).map_err(ApiError::internal)?)
        );
        let envelope=crypto.encrypt_json(&json!({"description":criterion["description"],"verifier":verifier}),&json!({"criterionId":id,"kind":"agent_outcome_criterion","runId":run,"schemaVersion":1}))?;
        sqlx::query("INSERT INTO agent_outcome_criteria(run_id,revision,criterion_id,verifier_kind,verifier_digest,required,description_ciphertext,description_iv,description_tag,description_key_version)VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9)").bind(run).bind(id).bind(verifier["kind"].as_str().unwrap_or("semantic_judge")).bind(digest).bind(criterion["required"].as_bool().unwrap_or(true)).bind(envelope.ciphertext).bind(envelope.iv).bind(envelope.tag).bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX)).execute(&mut**tx).await?;
    }
    Ok(())
}
async fn append_event(
    tx: &mut Transaction<'_, Postgres>,
    run: Uuid,
    event: &str,
    summary: &str,
    envelope: Option<AgentEnvelope>,
) -> ApiResult<Value> {
    let sequence:i64=sqlx::query_scalar("UPDATE agent_runs SET next_sequence=next_sequence+1,updated_at=NOW()WHERE id=$1 RETURNING next_sequence-1").bind(run).fetch_one(&mut**tx).await?;
    let id = Uuid::new_v4();
    let (e_ct, e_iv, e_tag, e_ver) = envelope.map_or((None, None, None, None), |value| {
        (
            Some(value.ciphertext),
            Some(value.iv),
            Some(value.tag),
            Some(i32::try_from(value.key_version).unwrap_or(i32::MAX)),
        )
    });
    let created:OffsetDateTime=sqlx::query_scalar("INSERT INTO agent_run_events(id,run_id,sequence,type,public_summary,payload_ciphertext,payload_iv,payload_tag,payload_key_version)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING created_at").bind(id).bind(run).bind(sequence).bind(event).bind(summary).bind(e_ct).bind(e_iv).bind(e_tag).bind(e_ver).fetch_one(&mut**tx).await?;
    Ok(
        json!({"id":id,"runId":run,"sequence":sequence,"type":event,"summary":summary,"createdAt":iso(created)}),
    )
}
async fn reserve_agent_turn(
    tx: &mut Transaction<'_, Postgres>,
    user: &str,
    plan: &str,
    task: Uuid,
    client: Uuid,
    enforce: bool,
) -> ApiResult<Uuid> {
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
        return Ok(existing.get("id"));
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
    sqlx::query_scalar("INSERT INTO agent_turns(client_turn_id,user_id,task_id,plan,would_deny)VALUES($1,$2,$3,$4,$5)RETURNING id").bind(client).bind(user).bind(task).bind(plan).bind(denied).fetch_one(&mut**tx).await.map_err(Into::into)
}
fn validate_effect(effect: &Value) -> ApiResult<()> {
    let object = effect.as_object().ok_or_else(invalid)?;
    if object.len() != 7
        || object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "kind"
                    | "resourceKind"
                    | "reversibility"
                    | "externality"
                    | "communication"
                    | "overwrite"
                    | "sensitiveDataTransfer"
            )
        })
    {
        return Err(invalid());
    }
    let kind = effect
        .get("kind")
        .and_then(Value::as_str)
        .filter(|value| {
            matches!(
                *value,
                "none"
                    | "create_resource"
                    | "update_resource"
                    | "rename_resource"
                    | "move_resource"
                    | "add_comment"
                    | "workspace_write"
                    | "workspace_command"
                    | "send_communication"
                    | "delete_or_archive"
                    | "unexpected_overwrite"
                    | "publish"
                    | "deploy"
                    | "merge"
                    | "financial_or_trade"
                    | "authentication_or_credential"
                    | "system_permission"
                    | "install"
                    | "sensitive_transfer"
                    | "unknown"
            )
        })
        .ok_or_else(invalid)?;
    let resource_kind = match effect.get("resourceKind") {
        Some(Value::Null) => None,
        Some(Value::String(value))
            if matches!(
                value.as_str(),
                "application"
                    | "calendar_event"
                    | "comment"
                    | "document"
                    | "download"
                    | "email"
                    | "form_submission"
                    | "generic_private_resource"
                    | "generic_public_resource"
                    | "issue"
                    | "message"
                    | "pull_request"
                    | "spreadsheet"
                    | "spreadsheet_row"
                    | "workspace_file"
                    | "workspace_repository"
            ) =>
        {
            Some(value.as_str())
        }
        _ => return Err(invalid()),
    };
    if (kind == "none") != resource_kind.is_none() {
        return Err(invalid());
    }
    let reversibility = effect
        .get("reversibility")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "none" | "reversible" | "destructive" | "unknown"))
        .ok_or_else(invalid)?;
    let externality = effect
        .get("externality")
        .and_then(Value::as_str)
        .filter(|value| {
            matches!(
                *value,
                "local" | "cloud_private" | "external" | "public" | "unknown"
            )
        })
        .ok_or_else(invalid)?;
    let communication = effect
        .get("communication")
        .and_then(Value::as_str)
        .filter(|value| {
            matches!(
                *value,
                "none" | "draft" | "send" | "invite" | "notify" | "unknown"
            )
        })
        .ok_or_else(invalid)?;
    let overwrite = effect
        .get("overwrite")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "none" | "requested" | "unexpected" | "unknown"))
        .ok_or_else(invalid)?;
    let sensitive = effect.get("sensitiveDataTransfer");
    if !matches!(sensitive, Some(Value::Bool(_)))
        && sensitive.and_then(Value::as_str) != Some("unknown")
    {
        return Err(invalid());
    }
    if kind == "none"
        && (reversibility != "none"
            || externality != "local"
            || communication != "none"
            || overwrite != "none"
            || sensitive != Some(&Value::Bool(false)))
    {
        return Err(invalid());
    }
    let communicates = matches!(communication, "send" | "invite" | "notify");
    if communicates != (kind == "send_communication") {
        return Err(invalid());
    }
    Ok(())
}
fn model_tools(capabilities: &Value) -> ApiResult<Vec<Value>> {
    if capabilities.get("schemaDigest").and_then(Value::as_str) != Some(TOOL_SCHEMA_DIGEST.as_str())
    {
        return Err(ApiError::coded(
            http::StatusCode::CONFLICT,
            "worker_upgrade_required",
            "Desktop worker must upgrade before accepting tasks.",
        ));
    }
    let advertised: Vec<(String, BTreeSet<String>)> = capabilities
        .get("tools")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|tool| {
            Some((
                tool.get("toolId")?.as_str()?.to_owned(),
                tool.get("operations")?
                    .as_array()?
                    .iter()
                    .filter_map(|op| op.as_str().map(ToOwned::to_owned))
                    .collect(),
            ))
        })
        .collect();
    Ok(TOOLS.iter().filter_map(|(tool,operations)|{let allowed=advertised.iter().find(|(id,_)|id==tool)?.1.clone();let operations:Vec<_>=operations.iter().filter(|op|allowed.contains(**op)).copied().collect();if operations.is_empty(){return None}let name=tool.replace('.',"__").replace('-', "_");Some(json!({"type":"function","name":name,"description":format!("Request {tool} using one allowlisted operation."),"strict":true,"parameters":{"type":"object","additionalProperties":false,"required":["operation","effect","input"],"properties":{"operation":{"type":"string","enum":operations},"effect":{"type":"object","additionalProperties":false,"required":["kind","resourceKind","reversibility","externality","communication","overwrite","sensitiveDataTransfer"],"properties":{"kind":{"type":"string"},"resourceKind":{"type":["string","null"]},"reversibility":{"type":"string"},"externality":{"type":"string"},"communication":{"type":"string"},"overwrite":{"type":"string"},"sensitiveDataTransfer":{"type":["boolean","string"]}}},"input":{"type":"object","additionalProperties":true}}}}))}).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tool_digest_is_sha256() {
        assert_eq!(TOOL_SCHEMA_DIGEST.len(), 64)
    }
    #[test]
    fn effect_free_requires_null_resource() {
        assert!(validate_effect(&json!({"kind":"none","resourceKind":null,"reversibility":"none","externality":"local","communication":"none","overwrite":"none","sensitiveDataTransfer":false})).is_ok());
    }
}
