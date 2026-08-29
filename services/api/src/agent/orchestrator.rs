use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::{AgentEnvelope, AgentStateCrypto},
    config::AgentRuntimeConfig,
    connectors::ConnectorService,
    error::{ApiError, ApiResult},
};

use super::{
    model_dispatch_store::{ModelDispatchContext, ModelDispatchStore},
    run_store::{ClaimedRunRecord, RunStore, WorkerRegistration, append_event, row_envelope},
    session_store::{SessionMutationResult, SessionSnapshot, SessionStore, SessionTransaction},
    tool_broker::{QueueToolCall, QueuedToolCall, ToolBroker, ToolCallResult},
    tool_catalog,
};

#[derive(Clone)]
pub struct AgentOrchestrator {
    config: AgentRuntimeConfig,
    connectors: Option<ConnectorService>,
    crypto: AgentStateCrypto,
    pool: PgPool,
    runs: RunStore,
    sessions: SessionStore,
    tools: ToolBroker,
    models: ModelDispatchStore,
}

#[derive(Debug)]
pub struct ClaimedRun {
    pub checkpoint: Option<Checkpoint>,
    pub deadline_at: OffsetDateTime,
    pub graph_version: String,
    pub last_control_sequence: i64,
    pub model: String,
    pub protocol_digest: String,
    pub request: String,
    pub run_id: Uuid,
    pub run_version: i32,
    pub sdk_version: String,
    pub session_revision: i64,
    pub tool_catalog_digest: String,
    pub tools: Vec<Value>,
}

#[derive(Debug)]
pub struct Checkpoint {
    pub applied_control_sequence: i64,
    pub graph_version: String,
    pub pending_call_id: Option<String>,
    pub revision: i64,
    pub sdk_version: String,
    pub state: String,
}

#[derive(Debug)]
pub struct PutCheckpoint {
    pub applied_control_sequence: i64,
    pub expected_checkpoint_revision: i64,
    pub graph_version: String,
    pub pending_call_id: Option<String>,
    pub sdk_version: String,
    pub state: String,
}

#[derive(Debug)]
pub struct SteeringUpdate {
    pub instruction: String,
    pub sequence: i64,
}

impl AgentOrchestrator {
    #[must_use]
    pub fn new(
        pool: PgPool,
        crypto: AgentStateCrypto,
        config: AgentRuntimeConfig,
        connectors: Option<ConnectorService>,
    ) -> Self {
        let runs = RunStore::new(pool.clone(), crypto.clone());
        Self {
            models: ModelDispatchStore::new(pool.clone()),
            sessions: SessionStore::new(pool.clone(), crypto.clone(), runs.clone()),
            tools: ToolBroker::new(
                pool.clone(),
                crypto.clone(),
                runs.clone(),
                connectors.clone(),
            ),
            config,
            connectors,
            crypto,
            pool,
            runs,
        }
    }

    pub async fn register_worker(
        &self,
        instance_id: Uuid,
        protocol_version: i32,
        protocol_digest: &str,
        release_version: &str,
        sdk_version: &str,
        graph_version: &str,
    ) -> ApiResult<(Uuid, OffsetDateTime)> {
        if protocol_version != 1
            || protocol_digest != super::orchestrator_protocol::protocol_digest()
            || sdk_version != self.config.orchestrator_sdk_version
        {
            return Err(ApiError::conflict(
                "graph_version_mismatch",
                "The Agents SDK worker release is incompatible with this API.",
            ));
        }
        self.runs
            .register_worker(
                &WorkerRegistration {
                    graph_version,
                    instance_id,
                    protocol_digest,
                    protocol_version,
                    release_version,
                    sdk_version,
                },
                self.config.heartbeat_ttl_ms,
            )
            .await
    }

    pub async fn heartbeat_worker(
        &self,
        worker_id: Uuid,
        release_version: &str,
    ) -> ApiResult<OffsetDateTime> {
        self.runs
            .heartbeat_worker(worker_id, release_version, self.config.heartbeat_ttl_ms)
            .await
    }

    pub async fn claim(
        &self,
        worker_id: Uuid,
        sdk_version: &str,
        graph_version: &str,
    ) -> ApiResult<Option<ClaimedRun>> {
        let Some(run) = self
            .runs
            .claim(worker_id, sdk_version, graph_version, self.config.lease_ms)
            .await?
        else {
            return Ok(None);
        };
        match self.claim_bundle(&run).await {
            Ok(bundle) => Ok(Some(bundle)),
            Err(error) => {
                let _ = self
                    .runs
                    .release_lease(run.run_id, worker_id, run.run_version)
                    .await;
                Err(error)
            }
        }
    }

    pub async fn renew_lease(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
    ) -> ApiResult<(i32, OffsetDateTime)> {
        self.runs
            .renew_lease(
                run_id,
                worker_id,
                expected_run_version,
                self.config.lease_ms,
            )
            .await
    }

    pub async fn release_lease(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
    ) -> ApiResult<i32> {
        self.runs
            .release_lease(run_id, worker_id, expected_run_version)
            .await
    }

    pub async fn session(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
    ) -> ApiResult<SessionSnapshot> {
        self.sessions
            .get(run_id, worker_id, expected_run_version)
            .await
    }

    pub async fn steering_updates(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        after_sequence: i64,
    ) -> ApiResult<Vec<SteeringUpdate>> {
        let mut tx = self.pool.begin().await?;
        self.runs
            .assert_lease(&mut tx, run_id, worker_id, expected_run_version)
            .await?;
        let persisted: i64 = sqlx::query_scalar(
            "SELECT last_control_sequence FROM agent_runs WHERE id=$1 FOR UPDATE",
        )
        .bind(run_id)
        .fetch_one(&mut *tx)
        .await?;
        if after_sequence < persisted {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "checkpoint_conflict",
                "The worker control cursor is behind its durable checkpoint.",
            ));
        }
        let rows = sqlx::query(
            "SELECT sequence,payload_ciphertext,payload_iv,payload_tag,payload_key_version
             FROM agent_run_events
             WHERE run_id=$1 AND type='run.steering_queued' AND sequence>$2
             ORDER BY sequence LIMIT 20",
        )
        .bind(run_id)
        .bind(after_sequence)
        .fetch_all(&mut *tx)
        .await?;
        let mut updates = Vec::with_capacity(rows.len());
        for row in rows {
            let envelope = row_envelope(&row, "payload")?
                .ok_or_else(|| ApiError::internal(anyhow::anyhow!("steering payload expired")))?;
            let payload = self.crypto.decrypt_json(
                &envelope,
                &json!({"kind":"agent_steering","runId":run_id,"schemaVersion":1}),
            )?;
            let instruction = payload
                .get("instruction")
                .and_then(Value::as_str)
                .ok_or_else(|| ApiError::internal(anyhow::anyhow!("steering payload invalid")))?
                .to_owned();
            updates.push(SteeringUpdate {
                instruction,
                sequence: row.get("sequence"),
            });
        }
        tx.commit().await?;
        Ok(updates)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn apply_session_transaction(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        expected_session_revision: i64,
        operation_id: &str,
        operation_digest: &str,
        transaction: &SessionTransaction,
    ) -> ApiResult<SessionMutationResult> {
        self.sessions
            .apply(
                run_id,
                worker_id,
                expected_run_version,
                expected_session_revision,
                operation_id,
                operation_digest,
                transaction,
            )
            .await
    }

    pub async fn put_checkpoint(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        checkpoint: &PutCheckpoint,
    ) -> ApiResult<(i64, i32)> {
        if checkpoint.sdk_version != self.config.orchestrator_sdk_version {
            return Err(graph_mismatch());
        }
        let mut tx = self.pool.begin().await?;
        self.runs
            .assert_lease(&mut tx, run_id, worker_id, expected_run_version)
            .await?;
        let run = sqlx::query(
            "SELECT sdk_version,orchestrator_graph_version,last_control_sequence FROM agent_runs WHERE id=$1 FOR UPDATE",
        )
        .bind(run_id)
        .fetch_one(&mut *tx)
        .await?;
        if run.get::<String, _>("sdk_version") != checkpoint.sdk_version
            || run.get::<String, _>("orchestrator_graph_version") != checkpoint.graph_version
        {
            tx.rollback().await?;
            return Err(graph_mismatch());
        }
        let current_control_sequence: i64 = run.get("last_control_sequence");
        if checkpoint.applied_control_sequence < current_control_sequence {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "checkpoint_conflict",
                "The checkpoint regressed the durable steering cursor.",
            ));
        }
        if checkpoint.applied_control_sequence > current_control_sequence {
            let valid: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM agent_run_events WHERE run_id=$1 AND type='run.steering_queued' AND sequence=$2)",
            )
            .bind(run_id)
            .bind(checkpoint.applied_control_sequence)
            .fetch_one(&mut *tx)
            .await?;
            if !valid {
                tx.rollback().await?;
                return Err(ApiError::conflict(
                    "checkpoint_conflict",
                    "The checkpoint referenced an unknown steering update.",
                ));
            }
        }
        let current_revision: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(checkpoint_revision),0) FROM agent_run_checkpoints WHERE run_id=$1",
        )
        .bind(run_id)
        .fetch_one(&mut *tx)
        .await?;
        if current_revision != checkpoint.expected_checkpoint_revision {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "checkpoint_conflict",
                "The SDK checkpoint changed before it could be committed.",
            ));
        }
        let next_revision = current_revision + 1;
        let metadata = checkpoint_metadata(
            run_id,
            next_revision,
            &checkpoint.sdk_version,
            &checkpoint.graph_version,
            checkpoint.pending_call_id.as_deref(),
            checkpoint.applied_control_sequence,
        );
        let envelope = self
            .crypto
            .encrypt_json(&json!({"state":checkpoint.state}), &metadata)?;
        sqlx::query(
            "INSERT INTO agent_run_checkpoints(run_id,run_version,model_step_id,graph_digest,state_ciphertext,state_iv,state_tag,state_key_version,runtime_kind,state_schema_version,sdk_version,graph_version,pending_call_id,applied_control_sequence,checkpoint_revision)VALUES($1,$2,$3,$4,$5,$6,$7,$8,'openai_agents_sdk',1,$9,$10,$11,$12,$13)ON CONFLICT(run_id,run_version)DO UPDATE SET model_step_id=EXCLUDED.model_step_id,graph_digest=EXCLUDED.graph_digest,state_ciphertext=EXCLUDED.state_ciphertext,state_iv=EXCLUDED.state_iv,state_tag=EXCLUDED.state_tag,state_key_version=EXCLUDED.state_key_version,runtime_kind=EXCLUDED.runtime_kind,state_schema_version=EXCLUDED.state_schema_version,sdk_version=EXCLUDED.sdk_version,graph_version=EXCLUDED.graph_version,pending_call_id=EXCLUDED.pending_call_id,applied_control_sequence=EXCLUDED.applied_control_sequence,checkpoint_revision=EXCLUDED.checkpoint_revision,created_at=NOW()",
        )
        .bind(run_id)
        .bind(expected_run_version)
        .bind(Uuid::new_v4())
        .bind(&checkpoint.graph_version)
        .bind(envelope.ciphertext)
        .bind(envelope.iv)
        .bind(envelope.tag)
        .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
        .bind(&checkpoint.sdk_version)
        .bind(&checkpoint.graph_version)
        .bind(&checkpoint.pending_call_id)
        .bind(checkpoint.applied_control_sequence)
        .bind(next_revision)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE agent_runs SET last_control_sequence=$2 WHERE id=$1 AND last_control_sequence<=$2",
        )
        .bind(run_id)
        .bind(checkpoint.applied_control_sequence)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((next_revision, expected_run_version))
    }

    pub async fn queue_tool_call(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        call: &QueueToolCall,
    ) -> ApiResult<QueuedToolCall> {
        self.tools
            .queue(run_id, worker_id, expected_run_version, call)
            .await
    }

    pub async fn tool_call_result(
        &self,
        run_id: Uuid,
        call_id: &str,
        worker_id: Uuid,
    ) -> ApiResult<ToolCallResult> {
        self.tools.result(run_id, call_id, worker_id).await
    }

    pub async fn begin_model_request(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        request_id: Uuid,
        body: &Value,
        compact: bool,
    ) -> ApiResult<ModelDispatchContext> {
        self.models
            .begin(run_id, worker_id, request_id, body, compact)
            .await
    }

    pub async fn complete_model_request(
        &self,
        run_id: Uuid,
        request_digest: &str,
    ) -> ApiResult<()> {
        self.models.complete(run_id, request_digest).await
    }

    pub async fn mark_model_request_unknown(
        &self,
        run_id: Uuid,
        request_digest: &str,
    ) -> ApiResult<()> {
        self.models.mark_unknown(run_id, request_digest).await
    }

    pub async fn activity(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        kind: &str,
        summary: &str,
    ) -> ApiResult<i32> {
        let mut tx = self.pool.begin().await?;
        self.runs
            .assert_lease(&mut tx, run_id, worker_id, expected_run_version)
            .await?;
        append_event(&mut tx, run_id, &format!("agent_sdk.{kind}"), summary, None).await?;
        tx.commit().await?;
        Ok(expected_run_version)
    }

    pub async fn complete(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        final_output: &str,
    ) -> ApiResult<i32> {
        self.runs
            .complete(run_id, worker_id, expected_run_version, final_output)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn fail(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        stage: &str,
        code: &str,
        retryable: bool,
        message: &str,
    ) -> ApiResult<i32> {
        self.runs
            .fail(
                run_id,
                worker_id,
                expected_run_version,
                if code == "tool_outcome_unknown" {
                    "blocked"
                } else {
                    "failed"
                },
                stage,
                code,
                retryable,
                message,
            )
            .await
    }

    async fn claim_bundle(&self, run: &ClaimedRunRecord) -> ApiResult<ClaimedRun> {
        let capabilities = sqlx::query_scalar::<_, Value>(
            "SELECT capabilities FROM agent_worker_sessions WHERE user_id=$1 AND protocol_version=5 AND protocol_digest=$2 AND tool_catalog_digest=$3 AND disconnected_at IS NULL AND expires_at>NOW() ORDER BY heartbeat_at DESC LIMIT 1",
        )
        .bind(&run.user_id)
        .bind(&run.protocol_digest)
        .bind(&run.tool_catalog_digest)
        .fetch_optional(&self.pool)
        .await?;
        let connector_routes = match &self.connectors {
            Some(connectors) => connectors.routes_for_user(&run.user_id).await?,
            None => Vec::new(),
        };
        let tools = build_tools(capabilities.as_ref(), &run.contract, &connector_routes);
        let checkpoint = self.load_checkpoint(run).await?;
        Ok(ClaimedRun {
            checkpoint,
            deadline_at: run.deadline_at,
            graph_version: run.graph_version.clone(),
            last_control_sequence: run.last_control_sequence,
            model: self.config.orchestrator_model.clone(),
            protocol_digest: run.protocol_digest.clone(),
            request: run.request.clone(),
            run_id: run.run_id,
            run_version: run.run_version,
            sdk_version: run.sdk_version.clone(),
            session_revision: run.session_revision,
            tool_catalog_digest: run.tool_catalog_digest.clone(),
            tools,
        })
    }

    async fn load_checkpoint(&self, run: &ClaimedRunRecord) -> ApiResult<Option<Checkpoint>> {
        let row = sqlx::query(
            "SELECT * FROM agent_run_checkpoints WHERE run_id=$1 AND runtime_kind='openai_agents_sdk' ORDER BY checkpoint_revision DESC LIMIT 1",
        )
        .bind(run.run_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let sdk_version: String = row.get("sdk_version");
        let graph_version: String = row.get("graph_version");
        if sdk_version != run.sdk_version || graph_version != run.graph_version {
            return Err(graph_mismatch());
        }
        let revision: i64 = row.get("checkpoint_revision");
        let pending_call_id: Option<String> = row.get("pending_call_id");
        let applied_control_sequence: i64 = row.get("applied_control_sequence");
        let envelope: AgentEnvelope = row_envelope(&row, "state")?.ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!("SDK checkpoint envelope missing"))
        })?;
        let state = self.crypto.decrypt_json(
            &envelope,
            &checkpoint_metadata(
                run.run_id,
                revision,
                &sdk_version,
                &graph_version,
                pending_call_id.as_deref(),
                applied_control_sequence,
            ),
        )?["state"]
            .as_str()
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("SDK checkpoint is invalid")))?
            .to_owned();
        Ok(Some(Checkpoint {
            applied_control_sequence,
            graph_version,
            pending_call_id,
            revision,
            sdk_version,
            state,
        }))
    }
}

fn build_tools(
    capabilities: Option<&Value>,
    contract: &Value,
    connector_routes: &[crate::connectors::ConnectorRoute],
) -> Vec<Value> {
    let mut tools = Vec::new();
    for tool in tool_catalog::all() {
        if !tool_catalog::allowed_by_contract(contract, &tool.tool_id) {
            continue;
        }
        let available = capabilities
            .is_some_and(|capabilities| tool_catalog::advertised_by_desktop(capabilities, tool));
        if available {
            tools.push(json!({
                "deferred":false,
                "description":tool.description,
                "driverCatalogDigest":Value::Null,
                "executor":"desktop",
                "inputSchema":tool.parameters,
                "modelName":tool.model_name,
                "namespace":"tro",
                "operation":Value::Null,
                "operationSelector":tool.operation_selector,
                "toolId":tool.tool_id
            }));
        }
    }
    if let Some(cua) = capabilities.and_then(|value| value.get("cua")) {
        let digest = cua
            .get("driverCatalogDigest")
            .cloned()
            .unwrap_or(Value::Null);
        for tool in cua
            .get("tools")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            tools.push(json!({
                "deferred":true,
                "description":tool["description"],
                "driverCatalogDigest":digest,
                "executor":"desktop",
                "inputSchema":tool["inputSchema"],
                "modelName":tool["modelName"],
                "namespace":"cua",
                "operation":tool["name"],
                "operationSelector":Value::Null,
                "toolId":"cua.driver"
            }));
        }
    }
    for route in connector_routes {
        tools.push(json!({
            "deferred":true,
            "description":route.description,
            "driverCatalogDigest":Value::Null,
            "executor":"connector",
            "inputSchema":route.input_schema,
            "modelName":route.tool_name,
            "namespace":route.namespace,
            "operation":route.tool_name,
            "operationSelector":Value::Null,
            "toolId":format!("connector.{}",route.catalog_key)
        }));
    }
    tools.sort_by(|left, right| {
        (
            left["namespace"].as_str().unwrap_or_default(),
            left["modelName"].as_str().unwrap_or_default(),
        )
            .cmp(&(
                right["namespace"].as_str().unwrap_or_default(),
                right["modelName"].as_str().unwrap_or_default(),
            ))
    });
    tools
}

fn checkpoint_metadata(
    run_id: Uuid,
    revision: i64,
    sdk_version: &str,
    graph_version: &str,
    pending_call_id: Option<&str>,
    applied_control_sequence: i64,
) -> Value {
    json!({
        "checkpointRevision":revision,
        "appliedControlSequence":applied_control_sequence,
        "graphVersion":graph_version,
        "kind":"agent_run_state",
        "pendingCallId":pending_call_id,
        "runId":run_id,
        "runtimeKind":"openai_agents_sdk",
        "schemaVersion":1,
        "sdkVersion":sdk_version
    })
}

fn graph_mismatch() -> ApiError {
    ApiError::conflict(
        "graph_version_mismatch",
        "The pending SDK state belongs to a different agent graph release.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capabilities() -> Value {
        json!({
            "tools": tool_catalog::all()
                .map(|tool| json!({"toolId":tool.tool_id,"operations":tool.operations}))
                .collect::<Vec<_>>()
        })
    }

    fn ids(contract: &Value) -> Vec<String> {
        build_tools(Some(&capabilities()), contract, &[])
            .into_iter()
            .filter_map(|tool| {
                tool.get("toolId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect()
    }

    #[test]
    fn contextual_tools_require_matching_run_authority() {
        let everyday = ids(&json!({
            "executionProfile":"everyday",
            "workspaceSelectionId":null,
            "activity":null
        }));
        assert!(!everyday.contains(&"workspace.filesystem".to_owned()));
        assert!(!everyday.contains(&"knowledge.search".to_owned()));
        assert!(!everyday.contains(&"activity.signal".to_owned()));

        let workspace_activity = ids(&json!({
            "executionProfile":"workspace",
            "workspaceSelectionId":Uuid::new_v4(),
            "activity":{
                "insightPolicy":"evidence_candidates",
                "policyAcknowledged":true
            }
        }));
        assert!(workspace_activity.contains(&"workspace.filesystem".to_owned()));
        assert!(workspace_activity.contains(&"workspace.terminal".to_owned()));
        assert!(workspace_activity.contains(&"knowledge.search".to_owned()));
        assert!(workspace_activity.contains(&"activity.signal".to_owned()));
    }
}
