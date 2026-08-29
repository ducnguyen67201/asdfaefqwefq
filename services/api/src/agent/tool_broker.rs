use serde_json::{Value, json};
use sha2::Digest;
use sqlx::{PgPool, Row};
use time::OffsetDateTime;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    auth::{AgentStateCrypto, stable_json},
    connectors::{ConnectorRoute, ConnectorService},
    error::{ApiError, ApiResult},
};

use super::{
    run_store::{RunStore, append_event, row_envelope},
    tool_catalog,
};

#[derive(Clone)]
pub struct ToolBroker {
    connectors: Option<ConnectorService>,
    crypto: AgentStateCrypto,
    pool: PgPool,
    runs: RunStore,
}

#[derive(Debug)]
pub struct QueueToolCall {
    pub arguments: Value,
    pub call_id: String,
    pub catalog_digest: String,
    pub driver_catalog_digest: Option<String>,
    pub graph_version: String,
    pub idempotency_digest: String,
    pub operation: String,
    pub sdk_version: String,
    pub tool_id: String,
}

#[derive(Debug)]
pub struct QueuedToolCall {
    pub invocation_id: Uuid,
    pub replayed: bool,
    pub run_version: i32,
}

#[derive(Debug)]
pub struct ToolCallResult {
    pub data: Option<Value>,
    pub status: String,
    pub summary: String,
}

enum ValidatedRoute {
    Desktop {
        request: Value,
    },
    Connector {
        request: Value,
        route: ConnectorRoute,
    },
}

impl ToolBroker {
    #[must_use]
    pub fn new(
        pool: PgPool,
        crypto: AgentStateCrypto,
        runs: RunStore,
        connectors: Option<ConnectorService>,
    ) -> Self {
        Self {
            connectors,
            crypto,
            pool,
            runs,
        }
    }

    pub async fn queue(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        call: &QueueToolCall,
    ) -> ApiResult<QueuedToolCall> {
        if call.idempotency_digest != tool_call_digest(call)? {
            return Err(ApiError::bad_request(
                "idempotency_digest_mismatch",
                "The tool-call digest does not match its immutable request.",
            ));
        }
        let run = sqlx::query(
            "SELECT user_id,protocol_digest,tool_catalog_digest,sdk_version,
                    orchestrator_graph_version,contract_ciphertext,contract_iv,
                    contract_tag,contract_key_version
             FROM agent_runs WHERE id=$1",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("run_not_found", "Agent run not found."))?;
        if run
            .get::<Option<String>, _>("tool_catalog_digest")
            .as_deref()
            != Some(call.catalog_digest.as_str())
            || run.get::<Option<String>, _>("sdk_version").as_deref()
                != Some(call.sdk_version.as_str())
            || run
                .get::<Option<String>, _>("orchestrator_graph_version")
                .as_deref()
                != Some(call.graph_version.as_str())
        {
            return Err(ApiError::conflict(
                "catalog_mismatch",
                "The tool call does not match the claimed agent graph.",
            ));
        }
        let user_id: String = run.get("user_id");
        let contract_envelope = row_envelope(&run, "contract")?.ok_or_else(|| {
            ApiError::conflict("run_payload_expired", "The task authority payload expired.")
        })?;
        let contract = self.crypto.decrypt_json(
            &contract_envelope,
            &json!({"kind":"agent_run_contract","runId":run_id,"schemaVersion":10}),
        )?;
        let max_tool_calls = contract
            .pointer("/limits/maxToolCalls")
            .and_then(Value::as_i64)
            .filter(|value| (1..=200).contains(value))
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("v10 tool limit is invalid")))?;
        let capabilities = sqlx::query_scalar::<_, Value>(
            "SELECT capabilities FROM agent_worker_sessions
             WHERE user_id=$1 AND protocol_version=5 AND protocol_digest=$2
               AND tool_catalog_digest=$3 AND disconnected_at IS NULL AND expires_at>NOW()
             ORDER BY heartbeat_at DESC LIMIT 1",
        )
        .bind(&user_id)
        .bind(run.get::<Option<String>, _>("protocol_digest"))
        .bind(run.get::<Option<String>, _>("tool_catalog_digest"))
        .fetch_optional(&self.pool)
        .await?;
        let route = self
            .validate_route(&user_id, &contract, capabilities.as_ref(), call)
            .await?;
        let mut tx = self.pool.begin().await?;
        self.runs
            .assert_lease(&mut tx, run_id, worker_id, expected_run_version)
            .await?;
        if let Some(existing) = sqlx::query(
            "SELECT id,idempotency_key FROM agent_tool_invocations WHERE run_id=$1 AND call_id=$2 FOR UPDATE",
        )
        .bind(run_id)
        .bind(&call.call_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            if existing.get::<String, _>("idempotency_key") != call.idempotency_digest {
                tx.rollback().await?;
                return Err(ApiError::conflict(
                    "tool_call_conflict",
                    "The SDK call ID was reused with different arguments.",
                ));
            }
            tx.commit().await?;
            return Ok(QueuedToolCall {
                invocation_id: existing.get("id"),
                replayed: true,
                run_version: expected_run_version,
            });
        }
        let tool_call_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM agent_tool_invocations WHERE run_id=$1")
                .bind(run_id)
                .fetch_one(&mut *tx)
                .await?;
        if tool_call_count >= max_tool_calls {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "tool_limit_exceeded",
                "The task reached its server-owned tool-call limit.",
            ));
        }

        let connector_job = match &route {
            ValidatedRoute::Connector { route, .. } => Some(route.clone()),
            ValidatedRoute::Desktop { .. } => None,
        };
        let invocation_id = Uuid::new_v4();
        let (executor, connector_connection_id, connector_snapshot_id, request) = match route {
            ValidatedRoute::Desktop { request } => ("desktop", None, None, request),
            ValidatedRoute::Connector { request, route } => (
                "connector",
                Some(route.connection_id),
                Some(route.snapshot_id),
                request,
            ),
        };
        let envelope = self.crypto.encrypt_json(
            &request,
            &json!({"invocationId":invocation_id,"kind":"agent_tool_request","runId":run_id,"schemaVersion":1}),
        )?;
        let expires_at = OffsetDateTime::now_utc() + time::Duration::minutes(5);
        sqlx::query(
            "INSERT INTO agent_tool_invocations(id,run_id,call_id,tool_id,operation,state,idempotency_key,request_ciphertext,request_iv,request_tag,request_key_version,public_summary,expires_at,executor_kind,connector_connection_id,connector_snapshot_id,catalog_digest,driver_catalog_digest,sdk_version,graph_version)VALUES($1,$2,$3,$4,$5,'requested',$6,$7,$8,$9,$10,'Tool call queued for execution.',$11,$12,$13,$14,$15,$16,$17,$18)",
        )
        .bind(invocation_id)
        .bind(run_id)
        .bind(&call.call_id)
        .bind(&call.tool_id)
        .bind(&call.operation)
        .bind(&call.idempotency_digest)
        .bind(envelope.ciphertext)
        .bind(envelope.iv)
        .bind(envelope.tag)
        .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
        .bind(expires_at)
        .bind(executor)
        .bind(connector_connection_id)
        .bind(connector_snapshot_id)
        .bind(&call.catalog_digest)
        .bind(&call.driver_catalog_digest)
        .bind(&call.sdk_version)
        .bind(&call.graph_version)
        .execute(&mut *tx)
        .await?;
        let next_version: i32 = sqlx::query_scalar(
            "UPDATE agent_runs SET state=CASE WHEN $4='desktop' THEN 'awaiting_worker' ELSE 'running' END,run_version=run_version+1,updated_at=NOW(),public_summary=CASE WHEN $4='desktop' THEN 'Waiting for the desktop worker.' ELSE 'Connected-app action queued.' END WHERE id=$1 AND lease_owner=$2 AND run_version=$3 RETURNING run_version",
        )
        .bind(run_id)
        .bind(worker_id.to_string())
        .bind(expected_run_version)
        .bind(executor)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            ApiError::conflict("lease_conflict", "The Agents SDK worker lease is stale.")
        })?;
        tx.commit().await?;
        if let Some(route) = connector_job {
            let broker = self.clone();
            let arguments = call.arguments.clone();
            tokio::spawn(async move {
                if let Err(error) = broker
                    .execute_connector(invocation_id, run_id, &user_id, &route, arguments)
                    .await
                {
                    tracing::error!(event="agent.connector_execution_failed", %run_id, %invocation_id, %error);
                }
            });
        }
        Ok(QueuedToolCall {
            invocation_id,
            replayed: false,
            run_version: next_version,
        })
    }

    pub async fn result(
        &self,
        run_id: Uuid,
        call_id: &str,
        worker_id: Uuid,
    ) -> ApiResult<ToolCallResult> {
        let row = sqlx::query(
            "SELECT invocations.*,runs.lease_owner,runs.lease_expires_at FROM agent_tool_invocations invocations JOIN agent_runs runs ON runs.id=invocations.run_id WHERE invocations.run_id=$1 AND invocations.call_id=$2 AND runs.orchestrator_kind='openai_agents_sdk'",
        )
        .bind(run_id)
        .bind(call_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| ApiError::not_found("tool_call_not_found", "Tool call not found."))?;
        let worker_id = worker_id.to_string();
        if row.get::<Option<String>, _>("lease_owner").as_deref() != Some(worker_id.as_str())
            || row
                .get::<Option<OffsetDateTime>, _>("lease_expires_at")
                .is_none_or(|expires| expires <= OffsetDateTime::now_utc())
        {
            return Err(ApiError::conflict(
                "lease_conflict",
                "The Agents SDK worker lease is stale.",
            ));
        }
        let state: String = row.get("state");
        let summary: String = row.get("public_summary");
        if matches!(
            state.as_str(),
            "requested" | "delivered" | "awaiting_permission" | "executing"
        ) {
            return Ok(ToolCallResult {
                data: None,
                status: "pending".to_owned(),
                summary,
            });
        }
        let result = row_envelope(&row, "result")?
            .map(|envelope| {
                self.crypto.decrypt_json(
                    &envelope,
                    &json!({"invocationId":row.get::<Uuid,_>("id"),"kind":"agent_tool_result","runId":run_id,"schemaVersion":1}),
                )
            })
            .transpose()?;
        Ok(ToolCallResult {
            data: result.and_then(|value| value.get("data").cloned()),
            status: state,
            summary,
        })
    }

    pub async fn recover_requested_connectors(&self) -> ApiResult<usize> {
        let rows = sqlx::query(
            "SELECT invocations.*,runs.user_id
             FROM agent_tool_invocations invocations
             JOIN agent_runs runs ON runs.id=invocations.run_id
             WHERE invocations.executor_kind='connector'
               AND invocations.state='requested'
               AND invocations.expires_at>NOW()
               AND runs.deadline_at>NOW()
               AND runs.state NOT IN('completed','blocked','failed','cancelled','expired')
             ORDER BY invocations.requested_at
             LIMIT 100",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut recovered = 0;
        for row in rows {
            let invocation_id: Uuid = row.get("id");
            let run_id: Uuid = row.get("run_id");
            let user_id: String = row.get("user_id");
            let request = row_envelope(&row, "request")?
                .and_then(|envelope| {
                    self.crypto
                        .decrypt_json(
                            &envelope,
                            &json!({"invocationId":invocation_id,"kind":"agent_tool_request","runId":run_id,"schemaVersion":1}),
                        )
                        .ok()
                });
            let arguments = request
                .as_ref()
                .and_then(|value| value.get("input"))
                .cloned();
            let identity = request
                .as_ref()
                .and_then(|value| value.get("connectorRoute"))
                .and_then(|route| {
                    Some((
                        route.get("catalogKey")?.as_str()?.to_owned(),
                        route.get("connectionId")?.as_str()?.parse::<Uuid>().ok()?,
                        route.get("namespace")?.as_str()?.to_owned(),
                        route.get("snapshotId")?.as_str()?.parse::<Uuid>().ok()?,
                        route.get("toolName")?.as_str()?.to_owned(),
                    ))
                });
            let route =
                if let (Some(connectors), Some(identity)) = (self.connectors.as_ref(), identity) {
                    connectors
                        .routes_for_user(&user_id)
                        .await?
                        .into_iter()
                        .find(|route| {
                            route.catalog_key == identity.0
                                && route.connection_id == identity.1
                                && route.namespace == identity.2
                                && route.snapshot_id == identity.3
                                && route.tool_name == identity.4
                        })
                } else {
                    None
                };
            if let (Some(route), Some(arguments)) = (route, arguments) {
                if let Some(execution_owner) = self.claim_connector(invocation_id).await? {
                    recovered += 1;
                    let broker = self.clone();
                    tokio::spawn(async move {
                        if let Err(error) = broker
                            .execute_claimed_connector(
                                invocation_id,
                                run_id,
                                &user_id,
                                &route,
                                arguments,
                                execution_owner,
                            )
                            .await
                        {
                            tracing::error!(event="agent.connector_recovery_failed", %run_id, %invocation_id, %error);
                        }
                    });
                }
            } else if self
                .fail_connector_before_dispatch(invocation_id, run_id)
                .await?
            {
                recovered += 1;
            }
        }
        Ok(recovered)
    }

    async fn execute_connector(
        &self,
        invocation_id: Uuid,
        run_id: Uuid,
        user_id: &str,
        route: &ConnectorRoute,
        arguments: Value,
    ) -> ApiResult<()> {
        let Some(execution_owner) = self.claim_connector(invocation_id).await? else {
            return Ok(());
        };
        self.execute_claimed_connector(
            invocation_id,
            run_id,
            user_id,
            route,
            arguments,
            execution_owner,
        )
        .await
    }

    async fn claim_connector(&self, invocation_id: Uuid) -> ApiResult<Option<Uuid>> {
        let execution_owner = Uuid::new_v4();
        let started = sqlx::query(
            "UPDATE agent_tool_invocations SET state='executing',executing_at=NOW(),execution_lease_owner=$2,execution_lease_expires_at=NOW()+INTERVAL'45 seconds',public_summary='Connected-app action is executing.' WHERE id=$1 AND executor_kind='connector' AND state='requested' RETURNING id",
        )
        .bind(invocation_id)
        .bind(execution_owner)
        .fetch_optional(&self.pool)
        .await?;
        Ok(started.map(|_| execution_owner))
    }

    async fn execute_claimed_connector(
        &self,
        invocation_id: Uuid,
        run_id: Uuid,
        user_id: &str,
        route: &ConnectorRoute,
        arguments: Value,
        execution_owner: Uuid,
    ) -> ApiResult<()> {
        let service = self.connectors.as_ref().ok_or_else(|| {
            ApiError::conflict(
                "connector_unavailable",
                "The connected application is unavailable.",
            )
        })?;
        let cancellation = CancellationToken::new();
        let executed = service
            .execute(user_id, route, arguments, &cancellation)
            .await;
        let (state, summary, result) = match executed {
            Ok(data) => (
                "confirmed",
                "Connected-app action completed.",
                json!({"data":data,"status":"confirmed"}),
            ),
            Err(error) if connector_error_precedes_dispatch(error.code) => (
                "failed",
                "Connected-app action was not dispatched.",
                json!({"data":Value::Null,"status":"failed"}),
            ),
            Err(_) => (
                "unknown",
                "Connected-app execution may have completed; it will not be retried.",
                json!({"data":Value::Null,"status":"unknown"}),
            ),
        };
        let envelope = self.crypto.encrypt_json(
            &result,
            &json!({"invocationId":invocation_id,"kind":"agent_tool_result","runId":run_id,"schemaVersion":1}),
        )?;
        let mut tx = self.pool.begin().await?;
        let stored = sqlx::query(
            "UPDATE agent_tool_invocations SET state=$3,result_ciphertext=$4,result_iv=$5,result_tag=$6,result_key_version=$7,public_summary=$8,terminal_at=NOW(),execution_lease_owner=NULL,execution_lease_expires_at=NULL WHERE id=$1 AND execution_lease_owner=$2 AND state='executing'",
        )
        .bind(invocation_id)
        .bind(execution_owner)
        .bind(state)
        .bind(envelope.ciphertext)
        .bind(envelope.iv)
        .bind(envelope.tag)
        .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
        .bind(summary)
        .execute(&mut *tx)
        .await?;
        if stored.rows_affected() == 1 {
            append_event(
                &mut tx,
                run_id,
                if state == "unknown" {
                    "tool.unknown"
                } else {
                    "tool.completed"
                },
                summary,
                None,
            )
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn fail_connector_before_dispatch(
        &self,
        invocation_id: Uuid,
        run_id: Uuid,
    ) -> ApiResult<bool> {
        let summary = "Connected-app action was not dispatched.";
        let envelope = self.crypto.encrypt_json(
            &json!({"data":Value::Null,"status":"failed"}),
            &json!({"invocationId":invocation_id,"kind":"agent_tool_result","runId":run_id,"schemaVersion":1}),
        )?;
        let mut tx = self.pool.begin().await?;
        let changed = sqlx::query(
            "UPDATE agent_tool_invocations SET state='failed',result_ciphertext=$3,result_iv=$4,result_tag=$5,result_key_version=$6,public_summary=$7,terminal_at=NOW() WHERE id=$1 AND run_id=$2 AND executor_kind='connector' AND state='requested'",
        )
        .bind(invocation_id)
        .bind(run_id)
        .bind(envelope.ciphertext)
        .bind(envelope.iv)
        .bind(envelope.tag)
        .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
        .bind(summary)
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;
        if changed {
            append_event(&mut tx, run_id, "tool.completed", summary, None).await?;
        }
        tx.commit().await?;
        Ok(changed)
    }

    async fn validate_route(
        &self,
        user_id: &str,
        contract: &Value,
        capabilities: Option<&Value>,
        call: &QueueToolCall,
    ) -> ApiResult<ValidatedRoute> {
        if let Some(tool) = tool_catalog::by_id(&call.tool_id) {
            if !tool_catalog::allowed_by_contract(contract, &call.tool_id)
                || !capabilities
                    .is_some_and(|value| tool_catalog::advertised_by_desktop(value, tool))
            {
                return Err(ApiError::conflict(
                    "catalog_mismatch",
                    "The requested tool was not offered for this run.",
                ));
            }
            tool_catalog::validate_model_arguments(&tool.parameters, &call.arguments)
                .map_err(|_| invalid_arguments())?;
            if tool_catalog::resolve_operation(tool, &call.arguments)
                .map_err(|_| invalid_arguments())?
                != call.operation
            {
                return Err(invalid_arguments());
            }
            return Ok(ValidatedRoute::Desktop {
                request: json!({
                    "callId":call.call_id,
                    "driverCatalogDigest":Value::Null,
                    "input":call.arguments,
                    "operation":call.operation,
                    "toolId":call.tool_id
                }),
            });
        }
        if call.tool_id == "cua.driver" {
            let capabilities = capabilities.ok_or_else(|| {
                ApiError::conflict(
                    "worker_unavailable",
                    "No compatible desktop worker is connected.",
                )
            })?;
            let driver_digest = call.driver_catalog_digest.as_deref().ok_or_else(|| {
                ApiError::conflict("catalog_mismatch", "The CUA catalog digest is missing.")
            })?;
            if capabilities
                .get("cua")
                .and_then(|value| value.get("driverCatalogDigest"))
                .and_then(Value::as_str)
                != Some(driver_digest)
            {
                return Err(ApiError::conflict(
                    "catalog_mismatch",
                    "The active CUA catalog changed before execution.",
                ));
            }
            let cua_tool = capabilities
                .get("cua")
                .and_then(|value| value.get("tools"))
                .and_then(Value::as_array)
                .and_then(|tools| {
                    tools.iter().find(|tool| {
                        tool.get("name").and_then(Value::as_str) == Some(call.operation.as_str())
                    })
                })
                .ok_or_else(invalid_arguments)?;
            crate::connectors::schema::validate_arguments(
                &cua_tool["inputSchema"],
                &call.arguments,
            )
            .map_err(|_| invalid_arguments())?;
            return Ok(ValidatedRoute::Desktop {
                request: json!({
                    "callId":call.call_id,
                    "driverCatalogDigest":driver_digest,
                    "input":call.arguments,
                    "operation":call.operation,
                    "toolId":call.tool_id
                }),
            });
        }
        if let Some(catalog_key) = call.tool_id.strip_prefix("connector.") {
            let connectors = self.connectors.as_ref().ok_or_else(|| {
                ApiError::conflict(
                    "connector_unavailable",
                    "Connected applications are unavailable.",
                )
            })?;
            let route = connectors
                .routes_for_user(user_id)
                .await?
                .into_iter()
                .find(|route| route.catalog_key == catalog_key && route.tool_name == call.operation)
                .ok_or_else(|| {
                    ApiError::conflict(
                        "connector_route_stale",
                        "The connected application route changed before execution.",
                    )
                })?;
            crate::connectors::validate_action(&route, &call.arguments)?;
            return Ok(ValidatedRoute::Connector {
                request: json!({
                    "callId":call.call_id,
                    "connectorRoute":{
                        "catalogKey":route.catalog_key,
                        "connectionId":route.connection_id,
                        "namespace":route.namespace,
                        "snapshotId":route.snapshot_id,
                        "toolName":route.tool_name
                    },
                    "input":call.arguments,
                    "operation":call.operation,
                    "toolId":call.tool_id
                }),
                route,
            });
        }
        Err(invalid_arguments())
    }
}

fn tool_call_digest(call: &QueueToolCall) -> ApiResult<String> {
    let value = json!({
        "arguments":call.arguments,
        "callId":call.call_id,
        "catalogDigest":call.catalog_digest,
        "driverCatalogDigest":call.driver_catalog_digest,
        "graphVersion":call.graph_version,
        "operation":call.operation,
        "sdkVersion":call.sdk_version,
        "toolId":call.tool_id
    });
    Ok(format!(
        "{:x}",
        sha2::Sha256::digest(stable_json(&value)?.as_bytes())
    ))
}

fn invalid_arguments() -> ApiError {
    ApiError::bad_request(
        "invalid_tool_arguments",
        "Tool arguments do not match the claimed catalog.",
    )
}

fn connector_error_precedes_dispatch(code: Option<&str>) -> bool {
    matches!(
        code,
        Some(
            "connectors_not_enabled"
                | "connector_route_stale"
                | "connector_unavailable"
                | "connector_reauthorization_required"
                | "connector_refresh_busy"
        )
    )
}
