use std::collections::HashSet;

use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::ApiError;
use crate::{PgPool, Postgres, Row, Transaction, query, query_scalar};

use super::{HelpResponse, RunStateResponse};

#[derive(Clone)]
pub struct ClassroomService {
    pub(super) pool: PgPool,
    pub(super) hmac_key: Vec<u8>,
}

#[derive(Debug)]
pub(super) struct RunContext {
    pub activity_version_id: Uuid,
    pub definition: Value,
    pub mode: String,
    pub state: String,
    pub target_kind: String,
}

impl ClassroomService {
    pub fn new(pool: PgPool, hmac_key: impl AsRef<[u8]>) -> Self {
        Self {
            pool,
            hmac_key: hmac_key.as_ref().to_vec(),
        }
    }

    pub async fn set_run_state(
        &self,
        user_id: &str,
        space_id: Uuid,
        run_id: Uuid,
        next_state: &'static str,
    ) -> Result<RunStateResponse, ApiError> {
        self.require_facilitator(user_id, space_id).await?;
        let mut transaction = self.begin().await?;
        let current = query(
            r#"SELECT runs.state,items.session_id
               FROM knowledge_activity_runs runs
               LEFT JOIN knowledge_class_session_activities items ON items.run_id=runs.id
               WHERE runs.id=$1 AND runs.space_id=$2"#,
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        let session_id: Option<Uuid> = current.get("session_id");
        let current_state: String = if let Some(session_id) = session_id {
            let state = query_scalar(
                "SELECT state FROM knowledge_class_sessions WHERE id=$1 AND space_id=$2 FOR UPDATE",
            )
            .bind(session_id)
            .bind(space_id)
            .fetch_one(&mut *transaction)
            .await?;
            query("SELECT runs.id FROM knowledge_activity_runs runs JOIN knowledge_class_session_activities items ON items.run_id=runs.id WHERE items.session_id=$1 ORDER BY runs.id FOR UPDATE OF runs")
                .bind(session_id).fetch_all(&mut *transaction).await?;
            state
        } else {
            query_scalar(
                "SELECT state FROM knowledge_activity_runs WHERE id=$1 AND space_id=$2 FOR UPDATE",
            )
            .bind(run_id)
            .bind(space_id)
            .fetch_one(&mut *transaction)
            .await?
        };
        if current_state == next_state {
            transaction.commit().await?;
            return Ok(RunStateResponse {
                id: run_id,
                state: current_state,
            });
        }
        if !matches!(
            (current_state.as_str(), next_state),
            ("draft", "open") | ("open", "closed")
        ) {
            return Err(ApiError::conflict(
                "invalid_transition",
                "Invalid run transition.",
            ));
        }
        let event_type = if next_state == "open" {
            "class_started"
        } else {
            "class_ended"
        };
        if let Some(session_id) = session_id {
            query(
                "UPDATE knowledge_class_sessions SET state=$3,updated_at=NOW() WHERE id=$1 AND space_id=$2",
            )
            .bind(session_id)
            .bind(space_id)
            .bind(next_state)
            .execute(&mut *transaction)
            .await?;
            query(
                r#"UPDATE knowledge_activity_runs runs SET state=$3,updated_at=NOW()
                   FROM knowledge_class_session_activities items
                   WHERE items.session_id=$1 AND items.run_id=runs.id AND runs.space_id=$2"#,
            )
            .bind(session_id)
            .bind(space_id)
            .bind(next_state)
            .execute(&mut *transaction)
            .await?;
            query(
                r#"INSERT INTO knowledge_activity_run_events (run_id,event_type,payload)
                   SELECT items.run_id,$2,jsonb_build_object('state',$3::text,'sessionId',$1::uuid)
                   FROM knowledge_class_session_activities items WHERE items.session_id=$1"#,
            )
            .bind(session_id)
            .bind(event_type)
            .bind(next_state)
            .execute(&mut *transaction)
            .await?;
        } else {
            query(
                "UPDATE knowledge_activity_runs SET state=$3,updated_at=NOW() WHERE id=$1 AND space_id=$2",
            )
            .bind(run_id)
            .bind(space_id)
            .bind(next_state)
            .execute(&mut *transaction)
            .await?;
            query(
                r#"INSERT INTO knowledge_activity_run_events (run_id,event_type,payload)
                   VALUES ($1,$2,jsonb_build_object('state',$3::text))"#,
            )
            .bind(run_id)
            .bind(event_type)
            .bind(next_state)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(RunStateResponse {
            id: run_id,
            state: next_state.to_owned(),
        })
    }

    pub async fn request_help(
        &self,
        user_id: &str,
        attempt_id: Uuid,
        client_id: Uuid,
    ) -> Result<HelpResponse, ApiError> {
        let mut transaction = self.begin().await?;
        let attempt = query(
            r#"SELECT attempts.state,runs.id AS run_id,runs.state AS run_state,
                      runs.opens_at,runs.closes_at
               FROM knowledge_activity_attempts attempts
               JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
               WHERE attempts.id=$1 AND attempts.user_id=$2 FOR UPDATE OF attempts"#,
        )
        .bind(attempt_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(ApiError::not_found(
            "attempt_not_found",
            "Attempt not found.",
        ))?;
        let run_state: String = attempt.get("run_state");
        let opens_at: Option<OffsetDateTime> = attempt.get("opens_at");
        let closes_at: Option<OffsetDateTime> = attempt.get("closes_at");
        let now = OffsetDateTime::now_utc();
        if run_state != "open"
            || opens_at.is_some_and(|opens| now < opens)
            || closes_at.is_some_and(|closes| now >= closes)
        {
            return Err(ApiError::conflict("run_not_open", "This Run is not open."));
        }
        let current_state: String = attempt.get("state");
        if !matches!(
            current_state.as_str(),
            "assigned" | "in_progress" | "blocked" | "ready_for_review"
        ) {
            return Err(ApiError::conflict(
                "attempt_not_active",
                "This Attempt is waiting for review or no longer active.",
            ));
        }
        let next_state = if matches!(current_state.as_str(), "assigned" | "in_progress") {
            "blocked"
        } else {
            current_state.as_str()
        };
        query("UPDATE knowledge_activity_attempts SET state=$2,updated_at=NOW() WHERE id=$1")
            .bind(attempt_id)
            .bind(next_state)
            .execute(&mut *transaction)
            .await?;
        let inserted = query(
            r#"INSERT INTO knowledge_attempt_help_requests (client_id,attempt_id,requested_by)
               SELECT $1,$2,$3 WHERE NOT EXISTS (
                 SELECT 1 FROM knowledge_attempt_help_requests
                 WHERE attempt_id=$2 AND resolved_at IS NULL
               )
               ON CONFLICT DO NOTHING RETURNING requested_at"#,
        )
        .bind(client_id)
        .bind(attempt_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if inserted.is_some() {
            query(
                r#"UPDATE knowledge_activity_work_sessions
                   SET help_requested_at=COALESCE(help_requested_at,NOW()),updated_at=NOW()
                   WHERE id=(SELECT id FROM knowledge_activity_work_sessions
                             WHERE attempt_id=$1 ORDER BY created_at DESC LIMIT 1)"#,
            )
            .bind(attempt_id)
            .execute(&mut *transaction)
            .await?;
            let run_id: Uuid = attempt.get("run_id");
            query(
                r#"INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
                   VALUES ($1,$2,'help_requested',jsonb_build_object('state',$3::text))"#,
            )
            .bind(run_id)
            .bind(attempt_id)
            .bind(next_state)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(HelpResponse {
            requested: true,
            state: next_state.to_owned(),
        })
    }

    pub(super) async fn run_context(
        &self,
        run_id: Uuid,
        space_id: Uuid,
    ) -> Result<Option<RunContext>, ApiError> {
        let row = query(
            r#"SELECT runs.activity_version_id,runs.mode,runs.state,runs.target_kind,
                      versions.definition
               FROM knowledge_activity_runs runs
               JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
               WHERE runs.id=$1 AND runs.space_id=$2"#,
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|row| RunContext {
            activity_version_id: row.get("activity_version_id"),
            definition: row.get("definition"),
            mode: row.get("mode"),
            state: row.get("state"),
            target_kind: row.get("target_kind"),
        }))
    }

    pub(super) async fn require_facilitator(
        &self,
        user_id: &str,
        space_id: Uuid,
    ) -> Result<(), ApiError> {
        let role = query_scalar::<_, String>(
            r#"SELECT role FROM knowledge_space_members
               WHERE space_id=$1 AND user_id=$2 AND removed_at IS NULL"#,
        )
        .bind(space_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(ApiError::not_found("space_not_found", "Space not found."))?;
        if !matches!(role.as_str(), "owner" | "facilitator") {
            return Err(ApiError::forbidden(
                "space_forbidden",
                "This Space operation is not available.",
            ));
        }
        Ok(())
    }

    pub(super) async fn begin(&self) -> Result<Transaction<'_, Postgres>, ApiError> {
        Ok(self.pool.begin().await?)
    }
}

pub(super) fn definition_bool(definition: &Value, path: &[&str]) -> bool {
    value_at(definition, path)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(super) fn definition_string(definition: &Value, key: &str) -> String {
    definition
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

pub(super) fn allowed_origins(definition: &Value) -> Vec<String> {
    value_at(definition, &["sessionPolicy", "allowedOrigins"])
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

pub(super) fn criterion_ids(definition: &Value) -> HashSet<String> {
    definition
        .get("criteria")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|criterion| criterion.get("id").and_then(Value::as_str))
        .map(str::to_owned)
        .collect()
}

fn value_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    path.iter().try_fold(value, |current, key| current.get(key))
}
