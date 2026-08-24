use uuid::Uuid;

use crate::error::ApiError;
use crate::{Row, query, query_scalar};

use super::service::definition_bool;
use super::{AttemptTransitionResponse, ClassroomService, ReviewAction, ReviewAttemptRequest};

impl ClassroomService {
    pub async fn ready_attempt(
        &self,
        user_id: &str,
        attempt_id: Uuid,
    ) -> Result<Option<AttemptTransitionResponse>, ApiError> {
        let mut transaction = self.begin().await?;
        let attempt = query(
            r#"SELECT attempts.run_id,attempts.state,versions.definition
               FROM knowledge_activity_attempts attempts
               JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
               JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
               WHERE attempts.id=$1 AND attempts.user_id=$2 FOR UPDATE OF attempts"#,
        )
        .bind(attempt_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(attempt) = attempt else {
            return Ok(None);
        };
        let state: String = attempt.get("state");
        if matches!(state.as_str(), "ready_for_review" | "submitted") {
            transaction.commit().await?;
            return Ok(Some(transition(attempt_id, state)));
        }
        let definition: serde_json::Value = attempt.get("definition");
        if definition_bool(&definition, &["completionPolicy", "requiresSubmission"]) {
            return Err(ApiError::conflict(
                "submission_required",
                "Submit the required files before requesting review.",
            ));
        }
        if !matches!(state.as_str(), "in_progress" | "blocked") {
            return Err(ApiError::conflict(
                "invalid_review_transition",
                "This Attempt cannot be marked ready.",
            ));
        }
        let updated = query(
            r#"UPDATE knowledge_activity_attempts
               SET state='ready_for_review',ready_at=COALESCE(ready_at,NOW()),updated_at=NOW()
               WHERE id=$1 RETURNING state,ready_at"#,
        )
        .bind(attempt_id)
        .fetch_one(&mut *transaction)
        .await?;
        let run_id: Uuid = attempt.get("run_id");
        query(
            r#"INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
               VALUES ($1,$2,'attempt_ready',jsonb_build_object('state','ready_for_review'))"#,
        )
        .bind(run_id)
        .bind(attempt_id)
        .execute(&mut *transaction)
        .await?;
        let mut response = transition(attempt_id, updated.get("state"));
        response.ready_at = Some(updated.get("ready_at"));
        transaction.commit().await?;
        Ok(Some(response))
    }

    pub async fn review_attempt(
        &self,
        user_id: &str,
        space_id: Uuid,
        run_id: Uuid,
        attempt_id: Uuid,
        input: ReviewAttemptRequest,
    ) -> Result<Option<AttemptTransitionResponse>, ApiError> {
        self.require_facilitator(user_id, space_id).await?;
        let mut transaction = self.begin().await?;
        query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("review:{attempt_id}:{}", input.client_id))
            .execute(&mut *transaction)
            .await?;
        if let Some(existing) = query(
            r#"SELECT reviews.action,reviews.created_at,attempts.state
               FROM knowledge_attempt_review_actions reviews
               JOIN knowledge_activity_attempts attempts ON attempts.id=reviews.attempt_id
               JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
               WHERE reviews.attempt_id=$1 AND reviews.client_id=$2
                 AND attempts.run_id=$3 AND runs.space_id=$4"#,
        )
        .bind(attempt_id)
        .bind(input.client_id)
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&mut *transaction)
        .await?
        {
            let mut response = transition(attempt_id, existing.get("state"));
            response.action = Some(existing.get("action"));
            response.reviewed_at = Some(existing.get("created_at"));
            response.newly_created = Some(false);
            transaction.commit().await?;
            return Ok(Some(response));
        }
        let state = query_scalar::<_, String>(
            r#"SELECT attempts.state FROM knowledge_activity_attempts attempts
               JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
               WHERE attempts.id=$1 AND attempts.run_id=$2 AND runs.space_id=$3
               FOR UPDATE OF attempts"#,
        )
        .bind(attempt_id)
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(state) = state else {
            return Ok(None);
        };
        if !matches!(state.as_str(), "ready_for_review" | "submitted") {
            return Err(ApiError::conflict(
                "invalid_review_transition",
                "This Attempt is not ready for review.",
            ));
        }
        let action = input.action.as_str();
        let next_state = match input.action {
            ReviewAction::Complete => "completed",
            ReviewAction::Return => "in_progress",
        };
        query(
            r#"UPDATE knowledge_activity_attempts SET state=$2,
                 completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at,NOW()) ELSE NULL END,
                 ready_at=CASE WHEN $2='in_progress' THEN NULL ELSE ready_at END,
                 updated_at=NOW() WHERE id=$1"#,
        )
        .bind(attempt_id)
        .bind(next_state)
        .execute(&mut *transaction)
        .await?;
        let reviewed_at = query_scalar(
            r#"INSERT INTO knowledge_attempt_review_actions
                 (client_id,attempt_id,action,reviewed_by)
               VALUES ($1,$2,$3,$4) RETURNING created_at"#,
        )
        .bind(input.client_id)
        .bind(attempt_id)
        .bind(action)
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        query(
            r#"INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
               VALUES ($1,$2,$3,jsonb_build_object('state',$4::text))"#,
        )
        .bind(run_id)
        .bind(attempt_id)
        .bind(if matches!(input.action, ReviewAction::Complete) {
            "attempt_completed"
        } else {
            "attempt_returned"
        })
        .bind(next_state)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        let mut response = transition(attempt_id, next_state.to_owned());
        response.action = Some(action.to_owned());
        response.reviewed_at = Some(reviewed_at);
        response.newly_created = Some(true);
        Ok(Some(response))
    }

    pub async fn resolve_help(
        &self,
        user_id: &str,
        space_id: Uuid,
        run_id: Uuid,
        attempt_id: Uuid,
    ) -> Result<Option<AttemptTransitionResponse>, ApiError> {
        self.require_facilitator(user_id, space_id).await?;
        let mut transaction = self.begin().await?;
        let state = query_scalar::<_, String>(
            r#"SELECT attempts.state FROM knowledge_activity_attempts attempts
               JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
               WHERE attempts.id=$1 AND attempts.run_id=$2 AND runs.space_id=$3
               FOR UPDATE OF attempts"#,
        )
        .bind(attempt_id)
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(state) = state else {
            return Ok(None);
        };
        let resolved = query(
            r#"UPDATE knowledge_attempt_help_requests
               SET resolved_at=COALESCE(resolved_at,NOW())
               WHERE attempt_id=$1 AND resolved_at IS NULL RETURNING resolved_at"#,
        )
        .bind(attempt_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let next_state = if state == "blocked" {
            "in_progress"
        } else {
            state.as_str()
        };
        query("UPDATE knowledge_activity_attempts SET state=$2,updated_at=NOW() WHERE id=$1")
            .bind(attempt_id)
            .bind(next_state)
            .execute(&mut *transaction)
            .await?;
        if resolved.is_some() {
            query(
                r#"INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
                   VALUES ($1,$2,'help_resolved',jsonb_build_object('state',$3::text))"#,
            )
            .bind(run_id)
            .bind(attempt_id)
            .bind(next_state)
            .execute(&mut *transaction)
            .await?;
        }
        let resolved_at = resolved.as_ref().map(|row| row.get("resolved_at"));
        transaction.commit().await?;
        let mut response = transition(attempt_id, next_state.to_owned());
        response.resolved = Some(resolved.is_some());
        response.resolved_at = resolved_at;
        Ok(Some(response))
    }
}

fn transition(attempt_id: Uuid, state: String) -> AttemptTransitionResponse {
    AttemptTransitionResponse {
        attempt_id,
        state,
        action: None,
        ready_at: None,
        reviewed_at: None,
        newly_created: None,
        resolved: None,
        resolved_at: None,
    }
}
