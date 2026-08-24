use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::error::ApiError;
use crate::{Row, postgres::PgRow, query, query_scalar};

use super::directives::directive_from_row;
use super::service::{definition_bool, definition_string};
use super::{
    ClassroomService, ClassroomSession, CreateRoomCodeRequest, LeaveSessionResponse,
    RoomCodeResponse, RoomRevocationResponse, SessionActivity, SessionRun, SessionSpace,
    deterministic_room_code, room_code_digest,
};

impl ClassroomService {
    pub async fn create_room_code(
        &self,
        user_id: &str,
        group_participant_limit: u32,
        space_id: Uuid,
        run_id: Uuid,
        input: CreateRoomCodeRequest,
    ) -> Result<RoomCodeResponse, ApiError> {
        input.validate()?;
        self.require_facilitator(user_id, space_id).await?;
        let context = self
            .run_context(run_id, space_id)
            .await?
            .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        if context.target_kind != "room" || !matches!(context.mode.as_str(), "live" | "hybrid") {
            return Err(ApiError::conflict(
                "room_run_required",
                "Room admission requires a live or hybrid Room Run.",
            ));
        }
        if !definition_bool(&context.definition, &["sessionPolicy", "allowRoomJoin"]) {
            return Err(ApiError::conflict(
                "room_join_disabled",
                "Publish this Activity with room joining enabled first.",
            ));
        }
        let now = OffsetDateTime::now_utc();
        let expires_at = input.expires_at.unwrap_or(now + Duration::hours(8));
        if expires_at <= now || expires_at > now + Duration::hours(24) {
            return Err(ApiError::bad_request(
                "room_expiry_invalid",
                "Room codes must expire within the next 24 hours.",
            ));
        }
        let max_uses = input.max_uses.min(group_participant_limit) as i32;
        let code = deterministic_room_code(&self.hmac_key, run_id, input.client_id);
        let digest = room_code_digest(&code, &self.hmac_key);
        let mut transaction = self.begin().await?;
        query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("room-code:{run_id}"))
            .execute(&mut *transaction)
            .await?;
        let run = query(
            r#"SELECT state,mode,target_kind FROM knowledge_activity_runs
               WHERE id=$1 AND space_id=$2 FOR UPDATE"#,
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        let target_kind: String = run.get("target_kind");
        let mode: String = run.get("mode");
        let state: String = run.get("state");
        if target_kind != "room" || !matches!(mode.as_str(), "live" | "hybrid") {
            return Err(ApiError::conflict(
                "room_run_required",
                "Room admission requires a live or hybrid Room Run.",
            ));
        }
        if !matches!(state.as_str(), "draft" | "open") {
            return Err(ApiError::conflict(
                "room_closed",
                "This classroom is closed.",
            ));
        }
        if let Some(existing) = query(
            r#"SELECT id,max_uses,used_count,expires_at,revoked_at,created_at
               FROM knowledge_live_room_codes WHERE run_id=$1 AND client_id=$2"#,
        )
        .bind(run_id)
        .bind(input.client_id)
        .fetch_optional(&mut *transaction)
        .await?
        {
            let response = room_code_from_row(&existing, code, false);
            transaction.commit().await?;
            return Ok(response);
        }
        query(
            r#"UPDATE knowledge_live_room_codes SET revoked_at=COALESCE(revoked_at,NOW())
               WHERE run_id=$1 AND revoked_at IS NULL"#,
        )
        .bind(run_id)
        .execute(&mut *transaction)
        .await?;
        let inserted = query(
            r#"INSERT INTO knowledge_live_room_codes
                 (client_id,run_id,code_digest,max_uses,expires_at,created_by)
               VALUES ($1,$2,$3,$4,$5,$6)
               RETURNING id,max_uses,used_count,expires_at,revoked_at,created_at"#,
        )
        .bind(input.client_id)
        .bind(run_id)
        .bind(digest.as_slice())
        .bind(max_uses)
        .bind(expires_at)
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        let response = room_code_from_row(&inserted, code, true);
        transaction.commit().await?;
        Ok(response)
    }

    pub async fn revoke_room_code(
        &self,
        user_id: &str,
        space_id: Uuid,
        run_id: Uuid,
    ) -> Result<RoomRevocationResponse, ApiError> {
        self.require_facilitator(user_id, space_id).await?;
        self.run_context(run_id, space_id)
            .await?
            .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        let rows = query(
            r#"UPDATE knowledge_live_room_codes codes
               SET revoked_at=COALESCE(codes.revoked_at,NOW())
               FROM knowledge_activity_runs runs
               WHERE codes.run_id=$1 AND runs.id=codes.run_id AND runs.space_id=$2
               RETURNING codes.revoked_at"#,
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(RoomRevocationResponse {
            revoked: !rows.is_empty(),
            revoked_at: rows.first().map(|row| row.get("revoked_at")),
        })
    }

    pub async fn join_room(
        &self,
        user_id: &str,
        _client_id: Uuid,
        code: &str,
    ) -> Result<ClassroomSession, ApiError> {
        let digest = room_code_digest(code, &self.hmac_key);
        let mut transaction = self.begin().await?;
        query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("live-room-user:{user_id}"))
            .execute(&mut *transaction)
            .await?;
        let room = query(
            r#"SELECT codes.id AS code_id,codes.max_uses,codes.used_count,codes.expires_at,
                      codes.revoked_at,runs.id AS run_id,runs.space_id,runs.activity_version_id,
                      runs.state AS run_state,runs.mode,runs.target_kind,versions.definition,
                      spaces.name AS space_name
               FROM knowledge_live_room_codes codes
               JOIN knowledge_activity_runs runs ON runs.id=codes.run_id
               JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
               JOIN knowledge_spaces spaces ON spaces.id=runs.space_id
               WHERE codes.code_digest=$1 FOR UPDATE OF codes,runs"#,
        )
        .bind(digest.as_slice())
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or_else(invalid_room_code)?;
        let revoked_at: Option<OffsetDateTime> = room.get("revoked_at");
        let expires_at: OffsetDateTime = room.get("expires_at");
        let target_kind: String = room.get("target_kind");
        let run_state: String = room.get("run_state");
        let definition: serde_json::Value = room.get("definition");
        if revoked_at.is_some()
            || expires_at <= OffsetDateTime::now_utc()
            || target_kind != "room"
            || !matches!(run_state.as_str(), "draft" | "open")
            || !definition_bool(&definition, &["sessionPolicy", "allowRoomJoin"])
        {
            return Err(invalid_room_code());
        }
        let run_id: Uuid = room.get("run_id");
        let prior = query(
            r#"SELECT attempt_id FROM knowledge_run_participations
               WHERE run_id=$1 AND user_id=$2 FOR UPDATE"#,
        )
        .bind(run_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let max_uses: i32 = room.get("max_uses");
        let used_count: i32 = room.get("used_count");
        if prior.is_none() && used_count >= max_uses {
            return Err(invalid_room_code());
        }
        let left_other_rooms = query(
            r#"UPDATE knowledge_run_participations
               SET left_at=NOW(),updated_at=NOW()
               WHERE user_id=$1 AND run_id<>$2 AND left_at IS NULL
               RETURNING run_id,attempt_id"#,
        )
        .bind(user_id)
        .bind(run_id)
        .fetch_all(&mut *transaction)
        .await?;
        for row in left_other_rooms {
            query(
                r#"INSERT INTO knowledge_activity_run_events
                     (run_id,attempt_id,event_type,payload)
                   VALUES ($1,$2,'participant_left',jsonb_build_object('reason','joined_another_room'))"#,
            )
            .bind(row.get::<Uuid, _>("run_id"))
            .bind(row.get::<Uuid, _>("attempt_id"))
            .execute(&mut *transaction)
            .await?;
        }
        let space_id: Uuid = room.get("space_id");
        query(
            r#"INSERT INTO knowledge_space_members (space_id,user_id,role)
               VALUES ($1,$2,'participant')
               ON CONFLICT (space_id,user_id) DO UPDATE SET
                 removed_at=NULL,
                 role=CASE WHEN knowledge_space_members.removed_at IS NULL
                                AND knowledge_space_members.role IN ('owner','facilitator')
                           THEN knowledge_space_members.role ELSE 'participant' END"#,
        )
        .bind(space_id)
        .bind(user_id)
        .execute(&mut *transaction)
        .await?;
        let assignment_id: Uuid = query_scalar(
            r#"INSERT INTO knowledge_activity_assignments (run_id,user_id)
               VALUES ($1,$2)
               ON CONFLICT (run_id,user_id) DO UPDATE SET user_id=EXCLUDED.user_id
               RETURNING id"#,
        )
        .bind(run_id)
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        let attempt = query(
            r#"INSERT INTO knowledge_activity_attempts (run_id,assignment_id,user_id)
               VALUES ($1,$2,$3)
               ON CONFLICT (run_id,user_id) DO UPDATE
                 SET updated_at=knowledge_activity_attempts.updated_at
               RETURNING id,state"#,
        )
        .bind(run_id)
        .bind(assignment_id)
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        let attempt_id: Uuid = attempt.get("id");
        let attempt_state: String = attempt.get("state");
        let participation = query(
            r#"INSERT INTO knowledge_run_participations (run_id,user_id,attempt_id)
               VALUES ($1,$2,$3)
               ON CONFLICT (run_id,user_id) DO UPDATE SET
                 attempt_id=EXCLUDED.attempt_id,left_at=NULL,updated_at=NOW()
               RETURNING joined_at"#,
        )
        .bind(run_id)
        .bind(user_id)
        .bind(attempt_id)
        .fetch_one(&mut *transaction)
        .await?;
        if prior.is_none() {
            let code_id: Uuid = room.get("code_id");
            query("UPDATE knowledge_live_room_codes SET used_count=used_count+1 WHERE id=$1")
                .bind(code_id)
                .execute(&mut *transaction)
                .await?;
        }
        query(
            r#"INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
               VALUES ($1,$2,$3,jsonb_build_object('status',$4::text))"#,
        )
        .bind(run_id)
        .bind(attempt_id)
        .bind(if prior.is_some() {
            "participant_rejoined"
        } else {
            "participant_joined"
        })
        .bind(if run_state == "draft" {
            "lobby"
        } else {
            "working"
        })
        .execute(&mut *transaction)
        .await?;
        let latest = query(
            r#"SELECT id,sequence,kind,delivery,payload,created_at
               FROM knowledge_run_directives WHERE run_id=$1
               ORDER BY sequence DESC LIMIT 1"#,
        )
        .bind(run_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let current_directive = latest.as_ref().map(directive_from_row).transpose()?;
        let joined_at = participation.get("joined_at");
        let mode: String = room.get("mode");
        let activity_version_id: Uuid = room.get("activity_version_id");
        let space_name: String = room.get("space_name");
        transaction.commit().await?;
        Ok(ClassroomSession {
            attempt_id,
            attempt_state,
            run: SessionRun {
                id: run_id,
                state: run_state.clone(),
                mode,
                status: if run_state == "draft" {
                    "lobby"
                } else {
                    "live"
                }
                .to_owned(),
            },
            space: SessionSpace {
                id: space_id,
                name: space_name,
            },
            activity_version_id,
            activity: session_activity(&definition),
            current_directive,
            joined_at,
            left_at: None,
        })
    }

    pub async fn session_for_attempt(
        &self,
        user_id: &str,
        attempt_id: Uuid,
    ) -> Result<Option<ClassroomSession>, ApiError> {
        let row = query(
            r#"SELECT participations.joined_at,participations.left_at,
                      attempts.state AS attempt_state,runs.id AS run_id,runs.state AS run_state,
                      runs.mode,runs.space_id,runs.activity_version_id,versions.definition,
                      spaces.name AS space_name
               FROM knowledge_run_participations participations
               JOIN knowledge_activity_attempts attempts ON attempts.id=participations.attempt_id
               JOIN knowledge_activity_runs runs ON runs.id=participations.run_id
               JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
               JOIN knowledge_spaces spaces ON spaces.id=runs.space_id
               WHERE participations.attempt_id=$1 AND participations.user_id=$2"#,
        )
        .bind(attempt_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let run_id: Uuid = row.get("run_id");
        let latest = query(
            r#"SELECT id,sequence,kind,delivery,payload,created_at
               FROM knowledge_run_directives WHERE run_id=$1
               ORDER BY sequence DESC LIMIT 1"#,
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?;
        let run_state: String = row.get("run_state");
        let definition: serde_json::Value = row.get("definition");
        Ok(Some(ClassroomSession {
            attempt_id,
            attempt_state: row.get("attempt_state"),
            run: SessionRun {
                id: run_id,
                state: run_state.clone(),
                mode: row.get("mode"),
                status: match run_state.as_str() {
                    "draft" => "lobby",
                    "open" => "live",
                    _ => "ended",
                }
                .to_owned(),
            },
            space: SessionSpace {
                id: row.get("space_id"),
                name: row.get("space_name"),
            },
            activity_version_id: row.get("activity_version_id"),
            activity: session_activity(&definition),
            current_directive: latest.as_ref().map(directive_from_row).transpose()?,
            joined_at: row.get("joined_at"),
            left_at: row.get("left_at"),
        }))
    }

    pub async fn current_session(
        &self,
        user_id: &str,
    ) -> Result<Option<ClassroomSession>, ApiError> {
        let attempt_id = query_scalar::<_, Uuid>(
            r#"SELECT participations.attempt_id
               FROM knowledge_run_participations participations
               JOIN knowledge_activity_runs runs ON runs.id=participations.run_id
               WHERE participations.user_id=$1 AND participations.left_at IS NULL
                 AND runs.state IN ('draft','open')
               ORDER BY participations.updated_at DESC,participations.joined_at DESC LIMIT 1"#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        match attempt_id {
            Some(attempt_id) => self.session_for_attempt(user_id, attempt_id).await,
            None => Ok(None),
        }
    }

    pub async fn leave_session(
        &self,
        user_id: &str,
        attempt_id: Uuid,
    ) -> Result<Option<LeaveSessionResponse>, ApiError> {
        let mut transaction = self.begin().await?;
        let current = query(
            r#"SELECT participations.run_id,participations.left_at
               FROM knowledge_run_participations participations
               WHERE participations.attempt_id=$1 AND participations.user_id=$2
               FOR UPDATE OF participations"#,
        )
        .bind(attempt_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(current) = current else {
            return Ok(None);
        };
        if let Some(left_at) = current.get::<Option<OffsetDateTime>, _>("left_at") {
            transaction.commit().await?;
            return Ok(Some(LeaveSessionResponse {
                attempt_id,
                left_at,
            }));
        }
        let left_at: OffsetDateTime = query_scalar(
            r#"UPDATE knowledge_run_participations SET left_at=NOW(),updated_at=NOW()
               WHERE attempt_id=$1 AND user_id=$2 RETURNING left_at"#,
        )
        .bind(attempt_id)
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        let run_id: Uuid = current.get("run_id");
        query(
            r#"INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
               VALUES ($1,$2,'participant_left','{}'::jsonb)"#,
        )
        .bind(run_id)
        .bind(attempt_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(LeaveSessionResponse {
            attempt_id,
            left_at,
        }))
    }
}

fn room_code_from_row(row: &PgRow, code: String, newly_created: bool) -> RoomCodeResponse {
    RoomCodeResponse {
        id: row.get("id"),
        code,
        max_uses: row.get("max_uses"),
        used_count: row.get("used_count"),
        expires_at: row.get("expires_at"),
        revoked_at: row.get("revoked_at"),
        created_at: row.get("created_at"),
        newly_created,
    }
}

fn invalid_room_code() -> ApiError {
    ApiError::bad_request(
        "room_code_invalid",
        "This room code is invalid, expired, full, or closed.",
    )
}

fn session_activity(definition: &serde_json::Value) -> SessionActivity {
    SessionActivity {
        title: definition_string(definition, "title"),
        objective: definition_string(definition, "objective"),
        requires_submission: definition_bool(
            definition,
            &["completionPolicy", "requiresSubmission"],
        ),
    }
}
