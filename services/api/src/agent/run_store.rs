use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::{AgentEnvelope, AgentStateCrypto},
    error::{ApiError, ApiResult},
};

const TERMINAL_STATES_SQL: &str = "'completed','blocked','failed','cancelled','expired'";

#[derive(Clone)]
pub struct RunStore {
    pool: PgPool,
    crypto: AgentStateCrypto,
}

#[derive(Debug)]
pub struct ClaimedRunRecord {
    pub contract: Value,
    pub deadline_at: OffsetDateTime,
    pub graph_version: String,
    pub last_control_sequence: i64,
    pub protocol_digest: String,
    pub request: String,
    pub run_id: Uuid,
    pub run_version: i32,
    pub sdk_version: String,
    pub session_revision: i64,
    pub tool_catalog_digest: String,
    pub user_id: String,
}

pub struct WorkerRegistration<'a> {
    pub graph_version: &'a str,
    pub instance_id: Uuid,
    pub protocol_digest: &'a str,
    pub protocol_version: i32,
    pub public_protocol_digest: &'a str,
    pub release_version: &'a str,
    pub sdk_version: &'a str,
}

impl RunStore {
    #[must_use]
    pub fn new(pool: PgPool, crypto: AgentStateCrypto) -> Self {
        Self { pool, crypto }
    }

    pub async fn register_worker(
        &self,
        registration: &WorkerRegistration<'_>,
        lease_ms: u64,
    ) -> ApiResult<(Uuid, OffsetDateTime)> {
        let worker_id = Uuid::new_v4();
        let expires_at = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(i64::try_from(lease_ms).unwrap_or(i64::MAX));
        let row = sqlx::query(
            "INSERT INTO agent_orchestrator_workers(id,instance_id,protocol_version,protocol_digest,public_protocol_digest,release_version,sdk_version,graph_version,expires_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)ON CONFLICT(instance_id)DO UPDATE SET protocol_version=EXCLUDED.protocol_version,protocol_digest=EXCLUDED.protocol_digest,public_protocol_digest=EXCLUDED.public_protocol_digest,release_version=EXCLUDED.release_version,sdk_version=EXCLUDED.sdk_version,graph_version=EXCLUDED.graph_version,heartbeat_at=NOW(),expires_at=EXCLUDED.expires_at,disconnected_at=NULL RETURNING id,expires_at",
        )
        .bind(worker_id)
        .bind(registration.instance_id)
        .bind(registration.protocol_version)
        .bind(registration.protocol_digest)
        .bind(registration.public_protocol_digest)
        .bind(registration.release_version)
        .bind(registration.sdk_version)
        .bind(registration.graph_version)
        .bind(expires_at)
        .fetch_one(&self.pool)
        .await?;
        Ok((row.get("id"), row.get("expires_at")))
    }

    pub async fn heartbeat_worker(
        &self,
        worker_id: Uuid,
        release_version: &str,
        protocol_digest: &str,
        public_protocol_digest: &str,
        lease_ms: u64,
    ) -> ApiResult<OffsetDateTime> {
        let expires_at = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(i64::try_from(lease_ms).unwrap_or(i64::MAX));
        sqlx::query_scalar(
            "UPDATE agent_orchestrator_workers SET heartbeat_at=NOW(),expires_at=$3 WHERE id=$1 AND release_version=$2 AND protocol_version=1 AND protocol_digest=$4 AND public_protocol_digest=$5 AND disconnected_at IS NULL RETURNING expires_at",
        )
        .bind(worker_id)
        .bind(release_version)
        .bind(expires_at)
        .bind(protocol_digest)
        .bind(public_protocol_digest)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(lease_conflict)
    }

    pub async fn claim(
        &self,
        worker_id: Uuid,
        sdk_version: &str,
        graph_version: &str,
        protocol_digest: &str,
        public_protocol_digest: &str,
        lease_ms: u64,
    ) -> ApiResult<Option<ClaimedRunRecord>> {
        let mut tx = self.pool.begin().await?;
        let worker_active: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM agent_orchestrator_workers WHERE id=$1 AND sdk_version=$2 AND graph_version=$3 AND protocol_version=1 AND protocol_digest=$4 AND public_protocol_digest=$5 AND disconnected_at IS NULL AND expires_at>NOW())",
        )
        .bind(worker_id)
        .bind(sdk_version)
        .bind(graph_version)
        .bind(protocol_digest)
        .bind(public_protocol_digest)
        .fetch_one(&mut *tx)
        .await?;
        if !worker_active {
            tx.rollback().await?;
            return Err(lease_conflict());
        }
        let worker = worker_id.to_string();
        let row = sqlx::query(
            "WITH candidate AS (
               SELECT id FROM agent_runs
               WHERE orchestrator_kind='openai_agents_sdk'
                 AND sdk_version=$2 AND orchestrator_graph_version=$3
                 AND protocol_digest=$5
                 AND state IN(
                   'queued','awaiting_orchestrator','recovering','running',
                   'awaiting_worker','awaiting_permission','executing_tool'
                 )
                 AND deadline_at>NOW()
                 AND (lease_expires_at IS NULL OR lease_expires_at<NOW())
               ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
             )
             UPDATE agent_runs runs
             SET state='running',lease_owner=$1,
                 lease_expires_at=NOW()+($4*INTERVAL'1 millisecond'),
                 run_version=run_version+1,updated_at=NOW(),
                 public_summary='OpenAI Agents SDK is working on this task.'
             FROM candidate WHERE runs.id=candidate.id RETURNING runs.*",
        )
        .bind(&worker)
        .bind(sdk_version)
        .bind(graph_version)
        .bind(i64::try_from(lease_ms).unwrap_or(i64::MAX))
        .bind(public_protocol_digest)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.commit().await?;
            return Ok(None);
        };
        append_event(
            &mut tx,
            row.get("id"),
            "run.orchestrator_claimed",
            "OpenAI Agents SDK is working on this task.",
            None,
        )
        .await?;
        tx.commit().await?;
        self.claimed_record(&row).map(Some)
    }

    pub async fn renew_lease(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        lease_ms: u64,
    ) -> ApiResult<(i32, OffsetDateTime)> {
        let expires_at = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(i64::try_from(lease_ms).unwrap_or(i64::MAX));
        let row = sqlx::query(
            "UPDATE agent_runs SET lease_expires_at=$4,updated_at=NOW() WHERE id=$1 AND lease_owner=$2 AND run_version=$3 AND lease_expires_at>NOW() AND orchestrator_kind='openai_agents_sdk' RETURNING run_version,lease_expires_at",
        )
        .bind(run_id)
        .bind(worker_id.to_string())
        .bind(expected_run_version)
        .bind(expires_at)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(lease_conflict)?;
        Ok((row.get("run_version"), row.get("lease_expires_at")))
    }

    pub async fn release_lease(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
    ) -> ApiResult<i32> {
        sqlx::query_scalar(
            "UPDATE agent_runs SET state='recovering',lease_owner=NULL,lease_expires_at=NULL,run_version=run_version+1,updated_at=NOW(),public_summary='Waiting for the Agents SDK worker to resume.' WHERE id=$1 AND lease_owner=$2 AND run_version=$3 AND orchestrator_kind='openai_agents_sdk' RETURNING run_version",
        )
        .bind(run_id)
        .bind(worker_id.to_string())
        .bind(expected_run_version)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(lease_conflict)
    }

    pub async fn complete(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        applied_control_sequence: i64,
        final_output: &str,
    ) -> ApiResult<i32> {
        let envelope = self.crypto.encrypt_json(
            &json!({"finalOutput": final_output}),
            &json!({"kind":"agent_final_output","runId":run_id,"schemaVersion":1}),
        )?;
        let mut tx = self.pool.begin().await?;
        self.assert_lease(&mut tx, run_id, worker_id, expected_run_version)
            .await?;
        let durable_control_sequence: i64 =
            sqlx::query_scalar("SELECT last_control_sequence FROM agent_runs WHERE id=$1")
                .bind(run_id)
                .fetch_one(&mut *tx)
                .await?;
        if applied_control_sequence != durable_control_sequence {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "checkpoint_conflict",
                "The completion cursor does not match the durable SDK checkpoint.",
            ));
        }
        let checkpoint = sqlx::query(
            "SELECT applied_control_sequence,pending_call_id
             FROM agent_run_checkpoints WHERE run_id=$1 AND run_version=$2",
        )
        .bind(run_id)
        .bind(expected_run_version)
        .fetch_optional(&mut *tx)
        .await?;
        if checkpoint.as_ref().is_none_or(|row| {
            row.get::<i64, _>("applied_control_sequence") != applied_control_sequence
                || row.get::<Option<String>, _>("pending_call_id").is_some()
        }) {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "checkpoint_conflict",
                "Completion requires the current terminal SDK checkpoint.",
            ));
        }
        let steering_pending: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM agent_run_events WHERE run_id=$1 AND type='run.steering_queued' AND sequence>$2)",
        )
        .bind(run_id)
        .bind(applied_control_sequence)
        .fetch_one(&mut *tx)
        .await?;
        if steering_pending {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "steering_pending",
                "New steering must be applied before the run can complete.",
            ));
        }
        let pending: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM agent_tool_invocations WHERE run_id=$1 AND state IN('requested','delivered','awaiting_permission','executing'))",
        )
        .bind(run_id)
        .fetch_one(&mut *tx)
        .await?;
        if pending {
            tx.rollback().await?;
            return Err(ApiError::conflict(
                "pending_tool_call",
                "The run still has a pending tool call.",
            ));
        }
        let next_version: i32 = sqlx::query_scalar(&format!(
            "UPDATE agent_runs SET state='completed',run_version=run_version+1,lease_owner=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW(),public_summary='Task completed.' WHERE id=$1 AND lease_owner=$2 AND run_version=$3 AND state NOT IN({TERMINAL_STATES_SQL}) RETURNING run_version"
        ))
        .bind(run_id)
        .bind(worker_id.to_string())
        .bind(expected_run_version)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(lease_conflict)?;
        append_event(
            &mut tx,
            run_id,
            "run.completed",
            "Task completed.",
            Some(envelope),
        )
        .await?;
        tx.commit().await?;
        Ok(next_version)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn fail(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        state: &str,
        stage: &str,
        code: &str,
        retryable: bool,
        message: &str,
    ) -> ApiResult<i32> {
        let mut tx = self.pool.begin().await?;
        let next_version: i32 = sqlx::query_scalar(&format!(
            "UPDATE agent_runs SET state=$4,failure_stage=$5,failure_code=$6,failure_retryable=$7,run_version=run_version+1,lease_owner=NULL,lease_expires_at=NULL,completed_at=NOW(),updated_at=NOW(),public_summary=$8 WHERE id=$1 AND lease_owner=$2 AND run_version=$3 AND state NOT IN({TERMINAL_STATES_SQL}) RETURNING run_version"
        ))
        .bind(run_id)
        .bind(worker_id.to_string())
        .bind(expected_run_version)
        .bind(state)
        .bind(stage)
        .bind(code)
        .bind(retryable)
        .bind(message)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(lease_conflict)?;
        append_event(
            &mut tx,
            run_id,
            if state == "blocked" {
                "run.blocked"
            } else {
                "run.failed"
            },
            message,
            None,
        )
        .await?;
        tx.commit().await?;
        Ok(next_version)
    }

    pub async fn assert_lease(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
    ) -> ApiResult<()> {
        let active = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM agent_runs WHERE id=$1 AND orchestrator_kind='openai_agents_sdk' AND lease_owner=$2 AND run_version=$3 AND lease_expires_at>NOW() FOR UPDATE",
        )
        .bind(run_id)
        .bind(worker_id.to_string())
        .bind(expected_run_version)
        .fetch_optional(&mut **tx)
        .await?;
        active.map(|_| ()).ok_or_else(lease_conflict)
    }

    fn claimed_record(&self, row: &PgRow) -> ApiResult<ClaimedRunRecord> {
        let run_id: Uuid = row.get("id");
        let request_envelope = row_envelope(row, "request")?
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("run request expired")))?;
        let request = self.crypto.decrypt_json(
            &request_envelope,
            &json!({"kind":"agent_run_request","runId":run_id,"schemaVersion":1}),
        )?["request"]
            .as_str()
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("run request is invalid")))?
            .to_owned();
        let contract_envelope = row_envelope(row, "contract")?
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("run contract expired")))?;
        let contract = self.crypto.decrypt_json(
            &contract_envelope,
            &json!({"kind":"agent_run_contract","runId":run_id,"schemaVersion":10}),
        )?;
        Ok(ClaimedRunRecord {
            contract,
            deadline_at: row.get("deadline_at"),
            graph_version: row.get("orchestrator_graph_version"),
            last_control_sequence: row.get("last_control_sequence"),
            protocol_digest: row
                .get::<Option<String>, _>("protocol_digest")
                .ok_or_else(|| {
                    ApiError::internal(anyhow::anyhow!("v5 run protocol digest missing"))
                })?,
            request,
            run_id,
            run_version: row.get("run_version"),
            sdk_version: row.get("sdk_version"),
            session_revision: row.get("session_revision"),
            tool_catalog_digest: row
                .get::<Option<String>, _>("tool_catalog_digest")
                .ok_or_else(|| ApiError::internal(anyhow::anyhow!("v5 run tool digest missing")))?,
            user_id: row.get("user_id"),
        })
    }
}

pub(crate) async fn append_event(
    tx: &mut Transaction<'_, Postgres>,
    run_id: Uuid,
    event_type: &str,
    summary: &str,
    envelope: Option<AgentEnvelope>,
) -> ApiResult<()> {
    let sequence: i64 = sqlx::query_scalar(
        "UPDATE agent_runs SET next_sequence=next_sequence+1,updated_at=NOW() WHERE id=$1 RETURNING next_sequence-1",
    )
    .bind(run_id)
    .fetch_one(&mut **tx)
    .await?;
    let (ciphertext, iv, tag, key_version) = envelope.map_or((None, None, None, None), |value| {
        (
            Some(value.ciphertext),
            Some(value.iv),
            Some(value.tag),
            Some(i32::try_from(value.key_version).unwrap_or(i32::MAX)),
        )
    });
    sqlx::query(
        "INSERT INTO agent_run_events(id,run_id,sequence,type,public_summary,payload_ciphertext,payload_iv,payload_tag,payload_key_version)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(Uuid::new_v4())
    .bind(run_id)
    .bind(sequence)
    .bind(event_type)
    .bind(summary)
    .bind(ciphertext)
    .bind(iv)
    .bind(tag)
    .bind(key_version)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub(crate) fn row_envelope(row: &PgRow, prefix: &str) -> ApiResult<Option<AgentEnvelope>> {
    let ciphertext = row.try_get::<Option<Vec<u8>>, _>(format!("{prefix}_ciphertext").as_str())?;
    let Some(ciphertext) = ciphertext else {
        return Ok(None);
    };
    Ok(Some(AgentEnvelope {
        ciphertext,
        iv: row.try_get(format!("{prefix}_iv").as_str())?,
        key_version: u32::try_from(
            row.try_get::<i32, _>(format!("{prefix}_key_version").as_str())?,
        )
        .map_err(ApiError::internal)?,
        tag: row.try_get(format!("{prefix}_tag").as_str())?,
    }))
}

fn lease_conflict() -> ApiError {
    ApiError::conflict(
        "lease_conflict",
        "The Agents SDK worker lease is stale or incompatible.",
    )
}
