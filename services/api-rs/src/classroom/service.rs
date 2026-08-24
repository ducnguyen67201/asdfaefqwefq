use std::{collections::HashSet, net::IpAddr};

use chrono::{DateTime, Utc};
use serde_json::Value;
use uuid::Uuid;

use crate::database::{PgPool, Postgres, Row, Transaction, query, query_scalar};
use crate::error::ApiError;

use super::policy::hmac_digest;
use super::{HelpResponse, RunStateResponse};

const CLASSROOM_JOIN_PEER_LIMIT: i32 = 2_400;

pub struct ClassroomService {
    pub(super) pool: PgPool,
    pub(super) hmac_key: Vec<u8>,
}

#[derive(Debug)]
pub struct AuthorizedUser {
    pub id: String,
    pub group_participants: u32,
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

    pub async fn verify_schema(&self) -> Result<(), ApiError> {
        let ready = query_scalar::<_, bool>(
            r#"SELECT to_regclass('public.knowledge_live_room_codes') IS NOT NULL
                   AND to_regclass('public.knowledge_run_participations') IS NOT NULL
                   AND to_regclass('public.knowledge_run_directives') IS NOT NULL
                   AND to_regclass('public.knowledge_attempt_review_actions') IS NOT NULL"#,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|error| ApiError::database(&error))?;
        if !ready {
            return Err(ApiError::unavailable());
        }
        Ok(())
    }

    pub async fn authorize(
        &self,
        token: Option<&str>,
        scope: &'static str,
        peer: Option<IpAddr>,
    ) -> Result<AuthorizedUser, ApiError> {
        let token = token.ok_or(ApiError::unauthorized(
            "authentication_required",
            "Sign in to continue.",
        ))?;
        if !valid_session_token(token) {
            return Err(ApiError::unauthorized(
                "session_expired",
                "Your session expired. Sign in again.",
            ));
        }
        let digest = hmac_digest(&self.hmac_key, token.as_bytes());
        let row = query(
            r#"UPDATE device_sessions AS sessions
               SET last_used_at=NOW()
               FROM users
               WHERE sessions.token_digest=$1
                 AND sessions.user_id=users.id
                 AND users.blocked_at IS NULL
                 AND sessions.revoked_at IS NULL
                 AND sessions.expires_at>NOW()
               RETURNING users.id,users.plan,users.free_access_started_at,
                 EXISTS(
                   SELECT 1 FROM access_code_redemptions redemption
                   WHERE redemption.user_id=users.id
                 ) AS has_access_code"#,
        )
        .bind(digest.as_slice())
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| ApiError::database(&error))?
        .ok_or(ApiError::unauthorized(
            "session_expired",
            "Your session expired. Sign in again.",
        ))?;
        let has_access_code: bool = row.get("has_access_code");
        let free_access_started_at: Option<DateTime<Utc>> = row.get("free_access_started_at");
        if !has_access_code && free_access_started_at.is_none() {
            return Err(ApiError::forbidden(
                "access_required",
                "Enter a valid access code to use TroCode.",
            ));
        }
        let user_id: String = row.get("id");
        let plan: String = row.get("plan");
        let request_limit = match scope {
            "classroom.join" => 12,
            "knowledge.read" => 180,
            _ => 60,
        };
        self.consume_rate_limit(&user_id, scope, request_limit, "rate_limited")
            .await?;
        if scope == "classroom.join"
            && let Some(peer) = peer
        {
            self.consume_rate_limit(
                &peer.to_string(),
                "classroom.join.peer",
                CLASSROOM_JOIN_PEER_LIMIT,
                "room_join_rate_limited",
            )
            .await?;
        }
        Ok(AuthorizedUser {
            id: user_id,
            group_participants: match plan.as_str() {
                "pro" => 1_000,
                "max" => 2_000,
                _ => 200,
            },
        })
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
            "SELECT state FROM knowledge_activity_runs WHERE id=$1 AND space_id=$2 FOR UPDATE",
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| ApiError::database(&error))?
        .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        let current_state: String = current.get("state");
        if current_state == next_state {
            transaction
                .commit()
                .await
                .map_err(|error| ApiError::database(&error))?;
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
        query(
            "UPDATE knowledge_activity_runs SET state=$3,updated_at=NOW() WHERE id=$1 AND space_id=$2",
        )
        .bind(run_id)
        .bind(space_id)
        .bind(next_state)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database(&error))?;
        query(
            r#"INSERT INTO knowledge_activity_run_events (run_id,event_type,payload)
               VALUES ($1,$2,jsonb_build_object('state',$3::text))"#,
        )
        .bind(run_id)
        .bind(if next_state == "open" {
            "class_started"
        } else {
            "class_ended"
        })
        .bind(next_state)
        .execute(&mut *transaction)
        .await
        .map_err(|error| ApiError::database(&error))?;
        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database(&error))?;
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
        .await
        .map_err(|error| ApiError::database(&error))?
        .ok_or(ApiError::not_found(
            "attempt_not_found",
            "Attempt not found.",
        ))?;
        let run_state: String = attempt.get("run_state");
        let opens_at: Option<DateTime<Utc>> = attempt.get("opens_at");
        let closes_at: Option<DateTime<Utc>> = attempt.get("closes_at");
        let now = Utc::now();
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
            .await
            .map_err(|error| ApiError::database(&error))?;
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
        .await
        .map_err(|error| ApiError::database(&error))?;
        if inserted.is_some() {
            query(
                r#"UPDATE knowledge_activity_work_sessions
                   SET help_requested_at=COALESCE(help_requested_at,NOW()),updated_at=NOW()
                   WHERE id=(SELECT id FROM knowledge_activity_work_sessions
                             WHERE attempt_id=$1 ORDER BY created_at DESC LIMIT 1)"#,
            )
            .bind(attempt_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database(&error))?;
            let run_id: Uuid = attempt.get("run_id");
            query(
                r#"INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
                   VALUES ($1,$2,'help_requested',jsonb_build_object('state',$3::text))"#,
            )
            .bind(run_id)
            .bind(attempt_id)
            .bind(next_state)
            .execute(&mut *transaction)
            .await
            .map_err(|error| ApiError::database(&error))?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| ApiError::database(&error))?;
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
        .await
        .map_err(|error| ApiError::database(&error))?;
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
        .await
        .map_err(|error| ApiError::database(&error))?
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
        self.pool
            .begin()
            .await
            .map_err(|error| ApiError::database(&error))
    }

    async fn consume_rate_limit(
        &self,
        key: &str,
        scope: &'static str,
        limit: i32,
        code: &'static str,
    ) -> Result<(), ApiError> {
        let identity = rate_limit_digest(&self.hmac_key, scope, key);
        let row = query(
            r#"INSERT INTO api_rate_limit_buckets
                 (scope,identity_digest,window_started_at,request_count)
               VALUES ($1,$2,date_trunc('minute',NOW()),1)
               ON CONFLICT (scope,identity_digest,window_started_at)
               DO UPDATE SET request_count=api_rate_limit_buckets.request_count+1,
                             updated_at=NOW()
               RETURNING request_count,
                 GREATEST(1,CEIL(EXTRACT(EPOCH FROM (
                   window_started_at+INTERVAL '1 minute'-NOW()
                 )))::bigint) AS retry_after"#,
        )
        .bind(scope)
        .bind(identity.as_slice())
        .fetch_one(&self.pool)
        .await
        .map_err(|error| ApiError::database(&error))?;
        let count: i32 = row.get("request_count");
        if count > limit {
            let retry_after: i64 = row.get("retry_after");
            let message = if code == "room_join_rate_limited" {
                "Too many room join attempts from this network. Try again shortly."
            } else {
                "Too many requests. Please try again shortly."
            };
            return Err(ApiError::rate_limited(
                code,
                message,
                u64::try_from(retry_after).unwrap_or(1),
            ));
        }
        Ok(())
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

fn valid_session_token(token: &str) -> bool {
    token.len() == 52
        && token.starts_with("tro_live_")
        && token[9..]
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'_' | b'-'))
}

fn rate_limit_digest(key: &[u8], scope: &str, identity: &str) -> [u8; 32] {
    let mut value = b"trocode-rate-limit-v1\0".to_vec();
    value.extend_from_slice(scope.as_bytes());
    value.push(0);
    value.extend_from_slice(identity.as_bytes());
    hmac_digest(key, &value)
}

#[cfg(test)]
mod tests {
    use super::valid_session_token;

    #[test]
    fn hosted_token_shape_is_exact_and_bounded() {
        assert!(valid_session_token(&format!("tro_live_{}", "a".repeat(43))));
        assert!(!valid_session_token("Bearer token"));
        assert!(!valid_session_token(&format!(
            "tro_live_{}",
            "a".repeat(44)
        )));
        assert!(!valid_session_token(&format!(
            "tro_live_{}!",
            "a".repeat(42)
        )));
    }
}
