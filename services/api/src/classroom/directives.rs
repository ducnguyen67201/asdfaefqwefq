use axum::http::StatusCode;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::error::ApiError;
use crate::{Row, postgres::PgRow, query, query_scalar};

use super::service::{allowed_origins, criterion_ids};
use super::{
    ClassroomDirective, ClassroomService, CreateDirectiveRequest, DirectiveClaimResponse,
    DirectiveInput, DirectiveListResponse, directive_delivery,
};

impl ClassroomService {
    pub async fn create_directive(
        &self,
        user_id: &str,
        space_id: Uuid,
        run_id: Uuid,
        mut input: CreateDirectiveRequest,
    ) -> Result<ClassroomDirective, ApiError> {
        input.validate()?;
        self.require_facilitator(user_id, space_id).await?;
        let context = self
            .run_context(run_id, space_id)
            .await?
            .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        if context.state != "open" {
            return Err(ApiError::conflict(
                "run_not_open",
                "Start the class before broadcasting.",
            ));
        }
        let published_criteria = criterion_ids(&context.definition);
        if input
            .directive
            .criterion_ids()
            .iter()
            .any(|criterion| !published_criteria.contains(criterion))
        {
            return Err(ApiError::bad_request(
                "directive_criterion_invalid",
                "A directive criterion is not part of the published Activity.",
            ));
        }
        let decision = directive_delivery(&input.directive, &allowed_origins(&context.definition))?;
        let payload = directive_payload(&input.directive, &decision);
        let mut transaction = self.begin().await?;
        query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("directive:{run_id}:{}", input.client_id))
            .execute(&mut *transaction)
            .await?;
        if let Some(existing) = query(
            r#"SELECT id,sequence,kind,delivery,payload,created_at
               FROM knowledge_run_directives WHERE run_id=$1 AND client_id=$2"#,
        )
        .bind(run_id)
        .bind(input.client_id)
        .fetch_optional(&mut *transaction)
        .await?
        {
            let mut response = directive_from_row(&existing)?;
            response.newly_created = Some(false);
            transaction.commit().await?;
            return Ok(response);
        }
        let run_state = query_scalar::<_, String>(
            "SELECT state FROM knowledge_activity_runs WHERE id=$1 AND space_id=$2 FOR UPDATE",
        )
        .bind(run_id)
        .bind(space_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(ApiError::not_found("run_not_found", "Run not found."))?;
        if run_state != "open" {
            return Err(ApiError::conflict(
                "run_not_open",
                "Start the class before broadcasting.",
            ));
        }
        let recent_count = query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM knowledge_run_directives
               WHERE run_id=$1 AND created_at>NOW()-INTERVAL '1 minute'"#,
        )
        .bind(run_id)
        .fetch_one(&mut *transaction)
        .await?;
        if recent_count >= 30 {
            return Err(ApiError::rate_limited(
                "directive_rate_limited",
                "Too many classroom directives. Try again shortly.",
                60,
            ));
        }
        let inserted = query(
            r#"INSERT INTO knowledge_run_directives
                 (client_id,run_id,activity_version_id,kind,delivery,payload,created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               RETURNING id,sequence,kind,delivery,payload,created_at"#,
        )
        .bind(input.client_id)
        .bind(run_id)
        .bind(context.activity_version_id)
        .bind(input.directive.kind())
        .bind(decision.delivery)
        .bind(payload)
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        let directive_id: Uuid = inserted.get("id");
        let kind: String = inserted.get("kind");
        let sequence: i64 = inserted.get("sequence");
        query(
            r#"INSERT INTO knowledge_activity_run_events (run_id,event_type,payload)
               VALUES ($1,'directive_created',jsonb_build_object(
                 'directiveId',$2::text,'kind',$3::text,'sequence',$4::bigint
               ))"#,
        )
        .bind(run_id)
        .bind(directive_id)
        .bind(kind)
        .bind(sequence)
        .execute(&mut *transaction)
        .await?;
        let mut response = directive_from_row(&inserted)?;
        response.newly_created = Some(true);
        transaction.commit().await?;
        Ok(response)
    }

    pub async fn list_directives(
        &self,
        user_id: &str,
        attempt_id: Uuid,
        since_sequence: u64,
    ) -> Result<Option<DirectiveListResponse>, ApiError> {
        let authority = query(
            r#"SELECT attempts.run_id,attempts.state AS attempt_state,runs.state AS run_state
               FROM knowledge_activity_attempts attempts
               JOIN knowledge_run_participations participations
                 ON participations.attempt_id=attempts.id
               JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
               WHERE attempts.id=$1 AND attempts.user_id=$2
                 AND participations.left_at IS NULL"#,
        )
        .bind(attempt_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(authority) = authority else {
            return Ok(None);
        };
        let run_id: Uuid = authority.get("run_id");
        let database_sequence = i64::try_from(since_sequence)
            .map_err(|_| ApiError::bad_request("invalid_request", "sinceSequence is invalid."))?;
        let rows = query(
            r#"SELECT id,sequence,kind,delivery,payload,created_at
               FROM knowledge_run_directives
               WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100"#,
        )
        .bind(run_id)
        .bind(database_sequence)
        .fetch_all(&self.pool)
        .await?;
        let items = rows
            .iter()
            .map(directive_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        let max_sequence = items.last().map_or(since_sequence, |item| item.sequence);
        Ok(Some(DirectiveListResponse {
            attempt_state: authority.get("attempt_state"),
            run_state: authority.get("run_state"),
            items,
            max_sequence,
        }))
    }

    pub async fn claim_directive(
        &self,
        user_id: &str,
        attempt_id: Uuid,
        directive_id: Uuid,
        client_id: Uuid,
    ) -> Result<Option<DirectiveClaimResponse>, ApiError> {
        let mut transaction = self.begin().await?;
        let authority = query(
            r#"SELECT directives.delivery,directives.kind,directives.payload,runs.state
               FROM knowledge_run_directives directives
               JOIN knowledge_activity_attempts attempts ON attempts.run_id=directives.run_id
               JOIN knowledge_run_participations participations
                 ON participations.attempt_id=attempts.id
               JOIN knowledge_activity_runs runs ON runs.id=directives.run_id
               WHERE directives.id=$1 AND attempts.id=$2 AND attempts.user_id=$3
                 AND participations.left_at IS NULL"#,
        )
        .bind(directive_id)
        .bind(attempt_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(authority) = authority else {
            return Ok(None);
        };
        let state: String = authority.get("state");
        let delivery: String = authority.get("delivery");
        let kind: String = authority.get("kind");
        if state != "open" || delivery != "auto_eligible" || kind != "open_url" {
            transaction.commit().await?;
            return Ok(Some(DirectiveClaimResponse::Ignored { execute: false }));
        }
        let claimed_at = query_scalar(
            r#"INSERT INTO knowledge_run_directive_claims (directive_id,user_id,client_id)
               VALUES ($1,$2,$3) ON CONFLICT (directive_id,user_id) DO NOTHING
               RETURNING claimed_at"#,
        )
        .bind(directive_id)
        .bind(user_id)
        .bind(client_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(claimed_at) = claimed_at else {
            transaction.commit().await?;
            return Ok(Some(DirectiveClaimResponse::Ignored { execute: false }));
        };
        let payload: Value = authority.get("payload");
        let url = payload_string(&payload, "url")?;
        let origin = payload_string(&payload, "origin")?;
        transaction.commit().await?;
        Ok(Some(DirectiveClaimResponse::Execute {
            execute: true,
            url,
            origin,
            claimed_at,
        }))
    }
}

pub(crate) fn directive_from_row(row: &PgRow) -> Result<ClassroomDirective, ApiError> {
    let payload: Value = row.get("payload");
    let kind: String = row.get("kind");
    let criterion_ids = payload
        .get("criterionIds")
        .and_then(Value::as_array)
        .ok_or_else(invalid_stored_data)?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(invalid_stored_data)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let raw_sequence: i64 = row.get("sequence");
    Ok(ClassroomDirective {
        id: row.get("id"),
        sequence: u64::try_from(raw_sequence).map_err(|_| invalid_stored_data())?,
        kind: kind.clone(),
        delivery: row.get("delivery"),
        instruction: payload_string(&payload, "instruction")?,
        criterion_ids,
        url: if kind == "open_url" {
            Some(payload_string(&payload, "url")?)
        } else {
            None
        },
        origin: if kind == "open_url" {
            Some(payload_string(&payload, "origin")?)
        } else {
            None
        },
        created_at: row.get("created_at"),
        newly_created: None,
    })
}

fn directive_payload(
    directive: &DirectiveInput,
    decision: &super::policy::DirectiveDecision,
) -> Value {
    match directive {
        DirectiveInput::Exercise {
            instruction,
            criterion_ids,
        } => json!({
            "kind": "exercise",
            "instruction": instruction,
            "criterionIds": criterion_ids,
        }),
        DirectiveInput::OpenUrl {
            instruction,
            criterion_ids,
            ..
        } => json!({
            "kind": "open_url",
            "instruction": instruction,
            "criterionIds": criterion_ids,
            "url": decision.url,
            "origin": decision.origin,
        }),
    }
}

fn payload_string(payload: &Value, key: &str) -> Result<String, ApiError> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(invalid_stored_data)
}

fn invalid_stored_data() -> ApiError {
    ApiError::coded(
        StatusCode::INTERNAL_SERVER_ERROR,
        "classroom_data_invalid",
        "Stored classroom data is invalid.",
    )
}
