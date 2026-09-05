use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use super::{ClassroomService, invalid_request};
use crate::{Postgres, Row, Transaction, error::ApiError, query};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum BroadcastPayload {
    Assignment {
        instruction: String,
        #[serde(rename = "targetRunId")]
        target_run_id: Uuid,
        #[serde(rename = "activityVersionId")]
        activity_version_id: Uuid,
        title: String,
        number: u32,
        #[serde(rename = "studentAction")]
        student_action: String,
    },
    Exercise {
        instruction: String,
    },
    OpenUrl {
        instruction: String,
        url: String,
        origin: String,
    },
}
impl BroadcastPayload {
    pub fn validate(&self) -> Result<(), ApiError> {
        let instruction = match self {
            Self::Assignment {
                instruction,
                title,
                number,
                student_action,
                ..
            } => {
                if !(1..=50).contains(number)
                    || title.is_empty()
                    || title.encode_utf16().count() > 240
                    || !matches!(student_action.as_str(), "open" | "explain")
                {
                    return Err(invalid_request());
                }
                instruction
            }
            Self::Exercise { instruction } => instruction,
            Self::OpenUrl {
                instruction,
                url,
                origin,
            } => {
                if url.encode_utf16().count() > 2000 || origin.len() > 2000 {
                    return Err(invalid_request());
                }
                let parsed = super::policy::public_https_url(url).ok_or_else(invalid_request)?;
                if parsed.origin().ascii_serialization() != *origin {
                    return Err(invalid_request());
                }
                instruction
            }
        };
        if instruction.trim().is_empty()
            || instruction.trim() != instruction
            || instruction.encode_utf16().count() > 4000
        {
            return Err(invalid_request());
        }
        Ok(())
    }
    pub fn target(&self) -> (Option<Uuid>, Option<Uuid>) {
        match self {
            Self::Assignment {
                target_run_id,
                activity_version_id,
                ..
            } => (Some(*target_run_id), Some(*activity_version_id)),
            _ => (None, None),
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBroadcastRequest {
    pub client_id: Uuid,
    pub payload: BroadcastPayload,
}

// serde_json::Value uses sorted object keys. TS uses the same recursive sorted-key representation.
pub fn broadcast_digest(payload: &Value) -> Result<String, ApiError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(payload).map_err(ApiError::internal)?)
    ))
}
pub(super) fn broadcast_value(row: &crate::postgres::PgRow) -> Value {
    json!({"id":row.get::<Uuid,_>("id"),"sessionId":row.get::<Uuid,_>("session_id"),
        "sequence":row.get::<i64,_>("sequence"),"delivery":"manual_only","payload":row.get::<Value,_>("payload"),
        "createdAt":timestamp(row.get("created_at"))})
}
pub(super) fn timestamp(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .expect("database timestamp is RFC3339")
}
fn receipt(row: &crate::postgres::PgRow, newly_created: bool) -> Value {
    json!({"clientId":row.get::<Uuid,_>("client_id"),"broadcast":broadcast_value(row),
        "payloadDigest":row.get::<String,_>("payload_digest"),"newlyCreated":newly_created})
}
impl ClassroomService {
    pub(super) async fn broadcast_teacher_authority(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        user: &str,
        space: Uuid,
    ) -> Result<(), ApiError> {
        let account=query("SELECT id FROM users WHERE id=$1 AND classroom_role='teacher' AND blocked_at IS NULL AND knowledge_spaces_enabled=true FOR SHARE")
            .bind(user).fetch_optional(&mut **tx).await?;
        if account.is_none() {
            return Err(ApiError::forbidden(
                "classroom_role_mismatch",
                "Teacher classroom access is required.",
            ));
        }
        let member=query("SELECT user_id FROM knowledge_space_members WHERE space_id=$1 AND user_id=$2 AND removed_at IS NULL AND role IN ('owner','facilitator') FOR SHARE")
            .bind(space).bind(user).fetch_optional(&mut **tx).await?;
        if member.is_none() {
            return Err(ApiError::forbidden(
                "space_forbidden",
                "Classroom access is unavailable.",
            ));
        }
        Ok(())
    }
    pub async fn teacher_context(
        &self,
        user: &str,
        space: Uuid,
        session: Uuid,
    ) -> Result<Value, ApiError> {
        let mut tx = self.begin().await?;
        self.broadcast_teacher_authority(&mut tx, user, space)
            .await?;
        let row=query("SELECT sessions.title,sessions.state,spaces.name FROM knowledge_class_sessions sessions JOIN knowledge_spaces spaces ON spaces.id=sessions.space_id WHERE sessions.id=$1 AND sessions.space_id=$2 AND spaces.archived_at IS NULL")
            .bind(session).bind(space).fetch_optional(&mut *tx).await?.ok_or_else(session_missing)?;
        let rows=query(r#"SELECT items.position,items.run_id,items.activity_version_id,versions.definition,runs.mode,runs.target_kind
            FROM knowledge_class_session_activities items JOIN knowledge_activity_versions versions ON versions.id=items.activity_version_id
            JOIN knowledge_activity_runs runs ON runs.id=items.run_id WHERE items.session_id=$1 ORDER BY items.position LIMIT 50"#)
            .bind(session).fetch_all(&mut *tx).await?;
        if rows.is_empty()
            || rows.iter().any(|r| {
                !matches!(r.get::<String, _>("mode").as_str(), "live" | "hybrid")
                    || !super::service::definition_bool(
                        &r.get("definition"),
                        &["sessionPolicy", "allowRoomJoin"],
                    )
            })
        {
            return Err(ApiError::conflict(
                "session_not_live",
                "Open a live classroom session first.",
            ));
        }
        let assignments:Vec<Value>=rows.iter().map(|r| {let d=r.get::<Value,_>("definition");json!({"number":r.get::<i32,_>("position")+1,"runId":r.get::<Uuid,_>("run_id"),"activityVersionId":r.get::<Uuid,_>("activity_version_id"),"title":d["title"],"objectivePreview":truncate_utf16(d["objective"].as_str().unwrap_or_default(),300)})}).collect();
        tx.commit().await?;
        Ok(
            json!({"binding":{"spaceId":space,"sessionId":session,"spaceName":row.get::<String,_>("name"),"sessionTitle":row.get::<String,_>("title"),"verifiedAt":timestamp(OffsetDateTime::now_utc())},"sessionState":row.get::<String,_>("state"),"assignments":assignments}),
        )
    }
    pub async fn create_broadcast(
        &self,
        user: &str,
        space: Uuid,
        session: Uuid,
        input: CreateBroadcastRequest,
    ) -> Result<Value, ApiError> {
        input.payload.validate()?;
        let mut tx = self.begin().await?;
        self.broadcast_teacher_authority(&mut tx, user, space)
            .await?;
        let context=query("SELECT state,broadcast_sequence FROM knowledge_class_sessions WHERE id=$1 AND space_id=$2 FOR UPDATE")
            .bind(session).bind(space).fetch_optional(&mut *tx).await?.ok_or_else(session_missing)?;
        let payload = serde_json::to_value(&input.payload).map_err(ApiError::internal)?;
        let digest = broadcast_digest(&payload)?;
        if let Some(existing) = query(
            "SELECT * FROM knowledge_class_session_broadcasts WHERE session_id=$1 AND client_id=$2",
        )
        .bind(session)
        .bind(input.client_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            if existing.get::<String, _>("created_by") != user
                || existing.get::<String, _>("payload_digest") != digest
            {
                return Err(ApiError::conflict(
                    "broadcast_idempotency_conflict",
                    "This broadcast key already belongs to different content.",
                ));
            }
            tx.commit().await?;
            return Ok(receipt(&existing, false));
        }
        if context.get::<String, _>("state") != "open" {
            return Err(ApiError::conflict(
                "session_not_open",
                "Start the class before broadcasting.",
            ));
        }
        let runs=query(r#"SELECT runs.id,runs.mode,runs.state,versions.definition,items.position,items.activity_version_id FROM knowledge_activity_runs runs
            JOIN knowledge_class_session_activities items ON items.run_id=runs.id JOIN knowledge_activity_versions versions ON versions.id=items.activity_version_id
            WHERE items.session_id=$1 ORDER BY runs.id FOR SHARE OF runs"#).bind(session).fetch_all(&mut *tx).await?;
        if runs.is_empty()
            || runs.iter().any(|r| {
                r.get::<String, _>("state") != "open"
                    || !matches!(r.get::<String, _>("mode").as_str(), "live" | "hybrid")
                    || !super::service::definition_bool(
                        &r.get("definition"),
                        &["sessionPolicy", "allowRoomJoin"],
                    )
            })
        {
            return Err(ApiError::conflict(
                "session_not_live",
                "This session is not available for live broadcasts.",
            ));
        }
        if let BroadcastPayload::Assignment {
            target_run_id,
            activity_version_id,
            title,
            number,
            ..
        } = &input.payload
        {
            let target = runs
                .iter()
                .find(|r| r.get::<Uuid, _>("id") == *target_run_id)
                .ok_or_else(invalid_request)?;
            if target.get::<Uuid, _>("activity_version_id") != *activity_version_id
                || target.get::<i32, _>("position") + 1 != *number as i32
                || target.get::<Value, _>("definition")["title"].as_str() != Some(title.as_str())
            {
                return Err(ApiError::conflict(
                    "assignment_changed",
                    "Choose a published assignment from this session.",
                ));
            }
        }
        let recent=query("SELECT COUNT(*)::bigint AS count FROM knowledge_class_session_broadcasts WHERE session_id=$1 AND created_at>NOW()-INTERVAL '1 minute'").bind(session).fetch_one(&mut *tx).await?;
        if recent.get::<i64, _>("count") >= 30 {
            return Err(ApiError::new(
                axum::http::StatusCode::TOO_MANY_REQUESTS,
                "Please wait before another broadcast.",
            ));
        }
        let seq = context.get::<i64, _>("broadcast_sequence") + 1;
        if seq > 9_007_199_254_740_991 {
            return Err(ApiError::conflict(
                "sequence_exhausted",
                "Start a new session.",
            ));
        }
        let (run, version) = input.payload.target();
        let row=query("INSERT INTO knowledge_class_session_broadcasts(session_id,client_id,sequence,kind,payload,payload_digest,created_by,target_run_id,activity_version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *")
            .bind(session).bind(input.client_id).bind(seq).bind(payload["kind"].as_str().ok_or_else(invalid_request)?).bind(&payload).bind(digest).bind(user).bind(run).bind(version).fetch_one(&mut *tx).await?;
        query("UPDATE knowledge_class_sessions SET broadcast_sequence=$2 WHERE id=$1")
            .bind(session)
            .bind(seq)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(receipt(&row, true))
    }
    pub async fn broadcast_receipt(
        &self,
        user: &str,
        space: Uuid,
        session: Uuid,
        client: Uuid,
    ) -> Result<Value, ApiError> {
        let mut tx = self.begin().await?;
        self.broadcast_teacher_authority(&mut tx, user, space)
            .await?;
        let row=query("SELECT broadcasts.* FROM knowledge_class_session_broadcasts broadcasts JOIN knowledge_class_sessions sessions ON sessions.id=broadcasts.session_id WHERE broadcasts.session_id=$1 AND sessions.space_id=$2 AND broadcasts.client_id=$3 AND broadcasts.created_by=$4")
            .bind(session).bind(space).bind(client).bind(user).fetch_optional(&mut *tx).await?;
        tx.commit().await?;
        Ok(json!({"receipt":row.as_ref().map(|r|receipt(r,false))}))
    }
    pub(super) async fn broadcast_student_session(
        &self,
        user: &str,
        anchor: Uuid,
    ) -> Result<crate::postgres::PgRow, ApiError> {
        query(r#"SELECT sessions.id,sessions.state,runs.state AS run_state FROM knowledge_activity_attempts attempts
          JOIN knowledge_run_participations participation ON participation.attempt_id=attempts.id AND participation.left_at IS NULL
          JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
          JOIN knowledge_class_session_activities items ON items.run_id=runs.id
          JOIN knowledge_class_sessions sessions ON sessions.id=items.session_id
          JOIN knowledge_space_members members ON members.space_id=runs.space_id AND members.user_id=attempts.user_id AND members.removed_at IS NULL AND members.role='participant'
          JOIN users ON users.id=attempts.user_id AND users.classroom_role='student' AND users.blocked_at IS NULL AND users.knowledge_spaces_enabled=true
          WHERE attempts.id=$1 AND attempts.user_id=$2 AND attempts.state<>'withdrawn'"#)
            .bind(anchor).bind(user).fetch_optional(&self.pool).await?.ok_or_else(session_missing)
    }
    pub async fn list_broadcasts(
        &self,
        user: &str,
        anchor: Uuid,
        after: Option<i64>,
    ) -> Result<Value, ApiError> {
        let session = self.broadcast_student_session(user, anchor).await?;
        let id = session.get::<Uuid, _>("id");
        let rows = if let Some(after) = after {
            query("SELECT * FROM knowledge_class_session_broadcasts WHERE session_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100").bind(id).bind(after).fetch_all(&self.pool).await?
        } else {
            query("SELECT * FROM knowledge_class_session_broadcasts WHERE session_id=$1 ORDER BY sequence DESC LIMIT 1").bind(id).fetch_all(&self.pool).await?
        };
        let max = rows
            .last()
            .map_or(after.unwrap_or(0), |r| r.get::<i64, _>("sequence"));
        Ok(
            json!({"sessionId":id,"sessionState":session.get::<String,_>("state"),"items":rows.iter().map(broadcast_value).collect::<Vec<_>>(),"maxSequence":max}),
        )
    }
    pub async fn broadcast_assignment(
        &self,
        user: &str,
        anchor: Uuid,
        broadcast: Uuid,
    ) -> Result<Value, ApiError> {
        let session = self.broadcast_student_session(user, anchor).await?;
        if session.get::<String, _>("state") != "open"
            || session.get::<String, _>("run_state") != "open"
        {
            return Err(ApiError::conflict(
                "session_not_open",
                "This session has ended.",
            ));
        }
        let row=query(r#"SELECT attempts.id FROM knowledge_class_session_broadcasts broadcasts
            JOIN knowledge_activity_attempts attempts ON attempts.run_id=broadcasts.target_run_id
            WHERE broadcasts.id=$1 AND broadcasts.session_id=$2 AND broadcasts.kind='assignment' AND attempts.user_id=$3 AND attempts.state<>'withdrawn'"#)
            .bind(broadcast).bind(session.get::<Uuid,_>("id")).bind(user).fetch_optional(&self.pool).await?.ok_or_else(||ApiError::not_found("assignment_not_found","Your assignment is unavailable."))?;
        Ok(json!({"attemptId":row.get::<Uuid,_>("id")}))
    }
}
fn session_missing() -> ApiError {
    ApiError::not_found("class_session_not_found", "Class session not found.")
}
fn truncate_utf16(value: &str, max: usize) -> String {
    let mut count = 0;
    value
        .chars()
        .take_while(|c| {
            count += c.len_utf16();
            count <= max
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn digest_is_shared_with_typescript_and_payloads_are_strict() {
        assert_eq!(
            broadcast_digest(&json!({"kind":"exercise","instruction":"Explain Assignment 1."}))
                .unwrap(),
            "16d459e6c5fa3d51310d044f39c82ad13da5d17401b43f1b33c180eea77339a7"
        );
        assert!(
            serde_json::from_value::<BroadcastPayload>(
                json!({"kind":"exercise","instruction":"Read","ownerId":"attacker"})
            )
            .is_err()
        );
        let too_long = BroadcastPayload::Exercise {
            instruction: "😀".repeat(2001),
        };
        assert!(too_long.validate().is_err());
        let private = BroadcastPayload::OpenUrl {
            instruction: "Open".into(),
            url: "https://127.0.0.1".into(),
            origin: "https://127.0.0.1".into(),
        };
        assert!(private.validate().is_err());
        assert_eq!(truncate_utf16("😀a", 2), "😀");
    }
}
