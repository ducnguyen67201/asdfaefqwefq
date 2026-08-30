use http::StatusCode;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    auth::stable_json,
    error::{ApiError, ApiResult},
};

#[derive(Clone)]
pub struct ModelDispatchStore {
    pool: PgPool,
}

#[derive(Debug)]
pub struct ModelDispatchContext {
    pub agent_turn_id: Uuid,
    pub plan_id: String,
    pub request_digest: String,
    pub safety_identifier: String,
    pub task_id: Uuid,
    pub user_id: String,
}

impl ModelDispatchStore {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn begin(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        request_id: Uuid,
        body: &Value,
        compact: bool,
    ) -> ApiResult<ModelDispatchContext> {
        let request_digest = format!(
            "{:x}",
            Sha256::digest(
                stable_json(&json!({"body":body,"kind":if compact {"compact"} else {"response"}}))?
                    .as_bytes()
            )
        );
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT runs.user_id,runs.task_id,runs.agent_turn_id,turns.plan
             FROM agent_runs runs
             JOIN agent_turns turns ON turns.id=runs.agent_turn_id
             WHERE runs.id=$1 AND runs.lease_owner=$2 AND runs.lease_expires_at>NOW()
               AND runs.orchestrator_kind='openai_agents_sdk'
             FOR UPDATE OF runs",
        )
        .bind(run_id)
        .bind(worker_id.to_string())
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(lease_conflict)?;
        let inserted = sqlx::query(
            "INSERT INTO agent_model_dispatches(
               run_id,request_digest,request_kind,provider_request_id,state
             ) VALUES($1,$2,$3,$4,'dispatched')
             ON CONFLICT(run_id,request_digest) DO NOTHING",
        )
        .bind(run_id)
        .bind(&request_digest)
        .bind(if compact { "compact" } else { "response" })
        .bind(request_id)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() != 1 {
            tx.rollback().await?;
            return Err(provider_outcome_unknown());
        }
        let user_id: String = row.get("user_id");
        let context = ModelDispatchContext {
            agent_turn_id: row.get("agent_turn_id"),
            plan_id: row.get("plan"),
            request_digest,
            safety_identifier: format!(
                "{:x}",
                Sha256::digest(format!("trocode:{user_id}").as_bytes())
            ),
            task_id: row.get("task_id"),
            user_id,
        };
        tx.commit().await?;
        Ok(context)
    }

    pub async fn complete(&self, run_id: Uuid, request_digest: &str) -> ApiResult<()> {
        self.transition(run_id, request_digest, "completed").await
    }

    pub async fn mark_unknown(&self, run_id: Uuid, request_digest: &str) -> ApiResult<()> {
        self.transition(run_id, request_digest, "unknown").await
    }

    async fn transition(&self, run_id: Uuid, request_digest: &str, state: &str) -> ApiResult<()> {
        let updated = sqlx::query(
            "UPDATE agent_model_dispatches SET state=$3,updated_at=NOW()
             WHERE run_id=$1 AND request_digest=$2 AND state='dispatched'",
        )
        .bind(run_id)
        .bind(request_digest)
        .bind(state)
        .execute(&self.pool)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(provider_outcome_unknown());
        }
        Ok(())
    }
}

fn lease_conflict() -> ApiError {
    ApiError::conflict(
        "lease_conflict",
        "The Agents SDK worker lease is stale or incompatible.",
    )
}

pub fn provider_outcome_unknown() -> ApiError {
    ApiError::coded(
        StatusCode::BAD_GATEWAY,
        "provider_outcome_unknown",
        "This model step may already have completed, so it was not repeated.",
    )
}
