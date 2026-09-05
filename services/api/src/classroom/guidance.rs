use super::broadcasts::timestamp;
use super::{ClassroomService, invalid_request};
use crate::{Row, error::ApiError, query};
use serde::Deserialize;
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuidanceStartRequest {
    pub client_start_id: Uuid,
    pub task_id: Uuid,
    pub client_instance_id: Uuid,
    pub context_mode: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuidanceReport {
    pub status: String,
    pub revision: i64,
    pub reason: Option<String>,
}
fn claim_value(row: &crate::postgres::PgRow, owned: bool) -> Value {
    json!({"id":row.get::<Uuid,_>("id"),"broadcastId":row.get::<Uuid,_>("broadcast_id"),"sessionId":row.get::<Uuid,_>("session_id"),
        "anchorAttemptId":row.get::<Uuid,_>("anchor_attempt_id"),"attemptId":row.get::<Uuid,_>("attempt_id"),"activityVersionId":row.get::<Uuid,_>("activity_version_id"),
        "workSessionId":row.get::<Uuid,_>("work_session_id"),"taskId":row.get::<Uuid,_>("task_id"),"clientStartId":row.get::<Uuid,_>("client_start_id"),
        "clientInstanceId":row.get::<Uuid,_>("client_instance_id"),"contextMode":row.get::<String,_>("context_mode"),"status":row.get::<String,_>("status"),
        "revision":row.get::<i64,_>("revision"),"createdAt":timestamp(row.get("created_at")),"ownedByThisRequest":owned})
}
fn unavailable() -> ApiError {
    ApiError::conflict(
        "guidance_unavailable",
        "This explanation is no longer available. Open the assignment to ask a new question.",
    )
}
impl ClassroomService {
    pub async fn claim_guidance(
        &self,
        user: &str,
        anchor: Uuid,
        broadcast: Uuid,
        input: GuidanceStartRequest,
    ) -> Result<Value, ApiError> {
        if !matches!(
            input.context_mode.as_str(),
            "screen_if_permitted" | "text_only"
        ) {
            return Err(invalid_request());
        }
        let session = self.broadcast_student_session(user, anchor).await?;
        let session_id = session.get::<Uuid, _>("id");
        let mut tx = self.begin().await?;
        // Same lock order as membership changes: account, session, runs, participant facts.
        let account=query("SELECT id FROM users WHERE id=$1 AND classroom_role='student' AND blocked_at IS NULL AND knowledge_spaces_enabled=true FOR SHARE").bind(user).fetch_optional(&mut *tx).await?;
        if account.is_none() {
            return Err(unavailable());
        }
        query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("guidance-start:{user}:{}", input.client_start_id))
            .execute(&mut *tx)
            .await?;
        let locked = query("SELECT state FROM knowledge_class_sessions WHERE id=$1 FOR UPDATE")
            .bind(session_id)
            .fetch_one(&mut *tx)
            .await?;
        let authority=query(r#"SELECT members.user_id FROM knowledge_activity_attempts attempts
          JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
          JOIN knowledge_run_participations participation ON participation.attempt_id=attempts.id AND participation.left_at IS NULL
          JOIN knowledge_space_members members ON members.space_id=runs.space_id AND members.user_id=attempts.user_id AND members.role='participant' AND members.removed_at IS NULL
          WHERE attempts.id=$1 AND attempts.user_id=$2 AND attempts.state<>'withdrawn' AND runs.state='open' FOR SHARE OF members,participation"#)
            .bind(anchor).bind(user).fetch_optional(&mut *tx).await?;
        if authority.is_none() {
            return Err(unavailable());
        }
        if let Some(row)=query("SELECT * FROM knowledge_classroom_guidance_starts WHERE user_id=$1 AND (broadcast_id=$2 OR client_start_id=$3) FOR UPDATE")
            .bind(user).bind(broadcast).bind(input.client_start_id).fetch_optional(&mut *tx).await? {
            let own=row.get::<Uuid,_>("client_start_id")==input.client_start_id;
            if own&&(row.get::<Uuid,_>("broadcast_id")!=broadcast||row.get::<Uuid,_>("task_id")!=input.task_id||row.get::<Uuid,_>("client_instance_id")!=input.client_instance_id||row.get::<String,_>("context_mode")!=input.context_mode||row.get::<Uuid,_>("anchor_attempt_id")!=anchor){return Err(ApiError::conflict("guidance_idempotency_conflict","The start request key is already used."));}
            tx.commit().await?;return Ok(claim_value(&row,own));
        }
        if locked.get::<String, _>("state") != "open" {
            return Err(unavailable());
        }
        query("SELECT runs.id FROM knowledge_activity_runs runs JOIN knowledge_class_session_activities items ON items.run_id=runs.id WHERE items.session_id=$1 ORDER BY runs.id FOR SHARE OF runs")
            .bind(session_id).fetch_all(&mut *tx).await?;
        let target=query(r#"SELECT attempts.id,attempts.state,attempts.acknowledged_policy_version,runs.id AS run_id,runs.activity_version_id,runs.insight_policy,runs.insight_policy_version,runs.opens_at,runs.closes_at,broadcasts.created_at
          FROM knowledge_class_session_broadcasts broadcasts JOIN knowledge_activity_runs runs ON runs.id=broadcasts.target_run_id AND runs.activity_version_id=broadcasts.activity_version_id
          JOIN knowledge_activity_attempts attempts ON attempts.run_id=runs.id AND attempts.user_id=$3
          WHERE broadcasts.id=$1 AND broadcasts.session_id=$2 AND broadcasts.payload->>'studentAction'='explain' AND runs.state='open'
          FOR UPDATE OF attempts FOR SHARE OF runs"#).bind(broadcast).bind(session_id).bind(user).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
        let now = OffsetDateTime::now_utc();
        if now - target.get::<OffsetDateTime, _>("created_at") > time::Duration::minutes(10)
            || !matches!(
                target.get::<String, _>("state").as_str(),
                "assigned" | "in_progress" | "blocked" | "ready_for_review"
            )
            || target
                .get::<Option<OffsetDateTime>, _>("opens_at")
                .is_some_and(|t| now < t)
            || target
                .get::<Option<OffsetDateTime>, _>("closes_at")
                .is_some_and(|t| now >= t)
        {
            return Err(unavailable());
        }
        if target.get::<String, _>("insight_policy") == "evidence_candidates"
            && target.get::<Option<String>, _>("acknowledged_policy_version")
                != Some(target.get::<String, _>("insight_policy_version"))
        {
            return Err(ApiError::conflict(
                "insight_acknowledgement_required",
                "Open the assignment and acknowledge its class insight policy first.",
            ));
        }
        let attempt = target.get::<Uuid, _>("id");
        let work=query("INSERT INTO knowledge_activity_work_sessions(client_id,attempt_id,task_id,launch_kind,purpose) VALUES($1,$2,$3,$4,'work') RETURNING id")
            .bind(input.client_start_id).bind(attempt).bind(input.task_id).bind(if input.context_mode=="text_only"{"none"}else{"current_surface"}).fetch_one(&mut *tx).await?;
        let row=query("INSERT INTO knowledge_classroom_guidance_starts(broadcast_id,session_id,user_id,anchor_attempt_id,attempt_id,activity_version_id,client_start_id,task_id,client_instance_id,context_mode,work_session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *")
            .bind(broadcast).bind(session_id).bind(user).bind(anchor).bind(attempt).bind(target.get::<Uuid,_>("activity_version_id")).bind(input.client_start_id).bind(input.task_id).bind(input.client_instance_id).bind(input.context_mode).bind(work.get::<Uuid,_>("id")).fetch_one(&mut *tx).await?;
        query("INSERT INTO knowledge_activity_run_events(run_id,attempt_id,event_type,payload) VALUES($1,$2,'work_session_created',$3)")
            .bind(target.get::<Uuid,_>("run_id")).bind(attempt).bind(json!({"state":"created","purpose":"work","trigger":"teacher_broadcast","broadcastId":broadcast,"guidanceId":row.get::<Uuid,_>("id")})).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(claim_value(&row, true))
    }
    pub async fn lookup_guidance(
        &self,
        user: &str,
        anchor: Uuid,
        broadcast: Uuid,
    ) -> Result<Value, ApiError> {
        let session = self.broadcast_student_session(user, anchor).await?;
        let row=query("SELECT * FROM knowledge_classroom_guidance_starts WHERE user_id=$1 AND broadcast_id=$2 AND session_id=$3")
            .bind(user).bind(broadcast).bind(session.get::<Uuid,_>("id")).fetch_optional(&self.pool).await?;
        Ok(json!({"claim":row.as_ref().map(|r|claim_value(r,false))}))
    }
    pub async fn report_guidance(
        &self,
        user: &str,
        work: Uuid,
        input: GuidanceReport,
    ) -> Result<Value, ApiError> {
        if !matches!(
            input.status.as_str(),
            "accepted" | "active" | "finished" | "cancelled" | "failed" | "interrupted" | "unknown"
        ) || !(1..=9_007_199_254_740_991).contains(&input.revision)
            || input.reason.as_deref().is_some_and(|r| {
                !matches!(
                    r,
                    "student_stop"
                        | "session_ended"
                        | "access_changed"
                        | "expired"
                        | "model_unavailable"
                        | "budget_exhausted"
                        | "network_unavailable"
                        | "device_busy"
                        | "restart"
                        | "outcome_unknown"
                        | "runtime_failed"
                )
            })
        {
            return Err(invalid_request());
        }
        let identity = query("SELECT session_id FROM knowledge_classroom_guidance_starts WHERE work_session_id=$1 AND user_id=$2")
            .bind(work).bind(user).fetch_optional(&self.pool).await?.ok_or_else(unavailable)?;
        let mut tx = self.begin().await?;
        // Serialize reports with class closure and claims before locking the claim.
        query("SELECT id FROM knowledge_class_sessions WHERE id=$1 FOR UPDATE")
            .bind(identity.get::<Uuid, _>("session_id"))
            .fetch_one(&mut *tx)
            .await?;
        let row=query("SELECT * FROM knowledge_classroom_guidance_starts WHERE work_session_id=$1 AND user_id=$2 FOR UPDATE").bind(work).bind(user).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
        let previous = row.get::<String, _>("status");
        if input.revision <= row.get::<i64, _>("revision") {
            if input.revision == row.get::<i64, _>("revision") && input.status != previous {
                return Err(ApiError::conflict(
                    "guidance_revision_conflict",
                    "Guidance report changed.",
                ));
            }
            tx.commit().await?;
            return Ok(claim_value(&row, false));
        }
        if !matches!(previous.as_str(), "accepted" | "active") {
            return Err(unavailable());
        }
        if input.status == "accepted" {
            return Err(invalid_request());
        }
        if input.status == "active" {
            let session = self
                .broadcast_student_session(user, row.get("anchor_attempt_id"))
                .await?;
            if session.get::<String, _>("state") != "open"
                || session.get::<String, _>("run_state") != "open"
            {
                return Err(unavailable());
            }
            let target=query(r#"SELECT attempts.state,runs.state AS run_state,runs.opens_at,runs.closes_at,broadcasts.created_at
                FROM knowledge_activity_attempts attempts
                JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id AND runs.activity_version_id=$3
                JOIN knowledge_class_session_broadcasts broadcasts ON broadcasts.id=$4
                WHERE attempts.id=$1 AND attempts.user_id=$2
                FOR UPDATE OF attempts FOR SHARE OF runs"#)
                .bind(row.get::<Uuid,_>("attempt_id")).bind(user).bind(row.get::<Uuid,_>("activity_version_id"))
                .bind(row.get::<Uuid,_>("broadcast_id")).fetch_optional(&mut *tx).await?.ok_or_else(unavailable)?;
            let now = OffsetDateTime::now_utc();
            if !matches!(
                target.get::<String, _>("state").as_str(),
                "assigned" | "in_progress" | "blocked" | "ready_for_review"
            ) || target.get::<String, _>("run_state") != "open"
                || now - target.get::<OffsetDateTime, _>("created_at")
                    >= time::Duration::minutes(10)
                || target
                    .get::<Option<OffsetDateTime>, _>("opens_at")
                    .is_some_and(|t| now < t)
                || target
                    .get::<Option<OffsetDateTime>, _>("closes_at")
                    .is_some_and(|t| now >= t)
            {
                return Err(unavailable());
            }
            query("UPDATE knowledge_activity_attempts SET state=CASE WHEN state='assigned' THEN 'in_progress' ELSE state END,started_at=COALESCE(started_at,NOW()),updated_at=NOW() WHERE id=$1")
                .bind(row.get::<Uuid,_>("attempt_id")).execute(&mut *tx).await?;
        }
        let work_state = match input.status.as_str() {
            "active" => "active",
            "finished" => "completed",
            "cancelled" => "cancelled",
            _ => "failed",
        };
        query("UPDATE knowledge_activity_work_sessions SET state=$2,started_at=CASE WHEN $2='active' THEN COALESCE(started_at,NOW()) ELSE started_at END,ended_at=CASE WHEN $2 IN ('completed','cancelled','failed') THEN NOW() ELSE ended_at END,updated_at=NOW() WHERE id=$1")
            .bind(work).bind(work_state).execute(&mut *tx).await?;
        let updated=query("UPDATE knowledge_classroom_guidance_starts SET status=$2,revision=$3,reason=$4,started_at=CASE WHEN $2='active' THEN COALESCE(started_at,NOW()) ELSE started_at END,ended_at=CASE WHEN $2<>'active' THEN NOW() ELSE ended_at END,updated_at=NOW() WHERE id=$1 RETURNING *")
            .bind(row.get::<Uuid,_>("id")).bind(input.status).bind(input.revision).bind(input.reason).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(claim_value(&updated, false))
    }
    pub async fn guidance_summary(
        &self,
        user: &str,
        space: Uuid,
        session: Uuid,
        broadcast: Uuid,
    ) -> Result<Value, ApiError> {
        let mut tx = self.begin().await?;
        self.broadcast_teacher_authority(&mut tx, user, space)
            .await?;
        let exists=query("SELECT broadcasts.id FROM knowledge_class_session_broadcasts broadcasts JOIN knowledge_class_sessions sessions ON sessions.id=broadcasts.session_id WHERE broadcasts.id=$1 AND sessions.id=$2 AND sessions.space_id=$3").bind(broadcast).bind(session).bind(space).fetch_optional(&mut *tx).await?;
        if exists.is_none() {
            return Err(unavailable());
        }
        let rows=query("SELECT status,COUNT(*)::bigint AS count FROM knowledge_classroom_guidance_starts WHERE broadcast_id=$1 GROUP BY status").bind(broadcast).fetch_all(&mut *tx).await?;
        let mut counts = json!({"accepted":0,"active":0,"finished":0,"cancelled":0,"failed":0,"interrupted":0,"unknown":0});
        for row in rows {
            counts[row.get::<String, _>("status")] = json!(row.get::<i64, _>("count"));
        }
        tx.commit().await?;
        Ok(json!({"broadcastId":broadcast,"counts":counts}))
    }
}
