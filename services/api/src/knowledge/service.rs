use std::collections::{HashMap, HashSet};

use base64::Engine as _;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::{PgPool, Row};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    auth::{open_invite_code, seal_invite_code},
    error::{ApiError, ApiResult},
    knowledge::{
        ClassroomRole, ObjectStore, SpaceRole, can_add_member, classroom_role_allows_space_role,
    },
    usage::Plan,
    validation::{js_string_len, truncate_js_string, zod_uuid},
};

#[derive(Clone)]
pub struct KnowledgeService {
    pub pool: PgPool,
    pub object_store: Option<ObjectStore>,
    hmac_key: String,
}
fn iso(value: Option<OffsetDateTime>) -> Value {
    value.map_or(Value::Null, |value| {
        Value::String(
            value
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        )
    })
}
fn required_string<'a>(value: &'a Value, key: &str, max: usize) -> ApiResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && js_string_len(value) <= max)
        .ok_or_else(|| {
            ApiError::coded(
                http::StatusCode::BAD_REQUEST,
                "invalid_request",
                "Request data is invalid.",
            )
        })
}
fn invalid_request() -> ApiError {
    ApiError::coded(
        http::StatusCode::BAD_REQUEST,
        "invalid_request",
        "Request data is invalid.",
    )
}
fn classroom_role_error(classroom_role: &str) -> ApiError {
    ApiError::coded(
        http::StatusCode::FORBIDDEN,
        if classroom_role == "unassigned" {
            "classroom_role_required"
        } else {
            "classroom_role_mismatch"
        },
        "Your account role does not allow this class role.",
    )
}
fn valid_email(value: &str) -> bool {
    let value = value.trim();
    if js_string_len(value) > 320 || !value.is_ascii() || value.matches('@').count() != 1 {
        return false;
    }
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    let local_valid = !local.is_empty()
        && !local.starts_with('.')
        && !local.contains("..")
        && local
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_'+-.".contains(&byte))
        && local
            .as_bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || b"_+-".contains(byte));
    let labels = domain.split('.').collect::<Vec<_>>();
    let domain_valid = labels.len() >= 2
        && labels.iter().all(|label| {
            label
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        && labels.last().is_some_and(|label| {
            label.len() >= 2 && label.bytes().all(|byte| byte.is_ascii_alphabetic())
        });
    local_valid && domain_valid
}
fn required_uuid(value: &Value, key: &str) -> ApiResult<Uuid> {
    zod_uuid(required_string(value, key, 64)?).ok_or_else(|| {
        ApiError::coded(
            http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "Request data is invalid.",
        )
    })
}
fn optional_time(value: &Value, key: &str) -> ApiResult<Option<OffsetDateTime>> {
    value
        .get(key)
        .filter(|value| !value.is_null())
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| {
                    ApiError::coded(
                        http::StatusCode::BAD_REQUEST,
                        "invalid_request",
                        "Request data is invalid.",
                    )
                })
                .and_then(|value| {
                    OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
                        .map_err(|_| {
                            ApiError::coded(
                                http::StatusCode::BAD_REQUEST,
                                "invalid_request",
                                "Request data is invalid.",
                            )
                        })
                })
        })
        .transpose()
}
impl KnowledgeService {
    #[must_use]
    pub fn new(pool: PgPool, object_store: Option<ObjectStore>, hmac_key: &str) -> Self {
        Self {
            pool,
            object_store,
            hmac_key: hmac_key.to_owned(),
        }
    }
    pub async fn enabled_for(&self, user: &str) -> ApiResult<bool> {
        Ok(sqlx::query_scalar(
            "SELECT knowledge_spaces_enabled FROM users WHERE id=$1 AND blocked_at IS NULL",
        )
        .bind(user)
        .fetch_optional(&self.pool)
        .await?
        .unwrap_or(false))
    }
    pub async fn role(&self, user: &str, space: Uuid, allowed: &[&str]) -> ApiResult<&'static str> {
        let row=sqlx::query("SELECT members.role,users.classroom_role FROM knowledge_space_members members JOIN users ON users.id=members.user_id WHERE members.space_id=$1 AND members.user_id=$2 AND members.removed_at IS NULL").bind(space).bind(user).fetch_optional(&self.pool).await?;
        let Some(row) = row else {
            return Err(ApiError::coded(
                http::StatusCode::NOT_FOUND,
                "space_not_found",
                "Space not found.",
            ));
        };
        let role: String = row.get("role");
        let classroom_role: String = row.get("classroom_role");
        let roles_are_compatible = ClassroomRole::parse(&classroom_role)
            .zip(SpaceRole::parse(&role))
            .is_some_and(|(classroom_role, space_role)| {
                classroom_role_allows_space_role(classroom_role, space_role)
            });
        if !roles_are_compatible {
            return Err(classroom_role_error(&classroom_role));
        }
        if !allowed.contains(&role.as_str()) {
            return Err(ApiError::coded(
                http::StatusCode::FORBIDDEN,
                "space_forbidden",
                "This Space operation is not available.",
            ));
        }
        Ok(match role.as_str() {
            "owner" => "owner",
            "facilitator" => "facilitator",
            _ => "participant",
        })
    }
    pub async fn list_spaces(&self, user: &str) -> ApiResult<Value> {
        let classroom_role: Option<String> =
            sqlx::query_scalar("SELECT classroom_role FROM users WHERE id=$1")
                .bind(user)
                .fetch_optional(&self.pool)
                .await?;
        let mut rows=sqlx::query("SELECT spaces.id,spaces.name,spaces.description,spaces.purpose_label,members.role,spaces.created_at,spaces.updated_at FROM knowledge_spaces spaces JOIN knowledge_space_members members ON members.space_id=spaces.id WHERE members.user_id=$1 AND members.removed_at IS NULL AND spaces.archived_at IS NULL ORDER BY spaces.created_at DESC,spaces.id DESC LIMIT 51").bind(user).fetch_all(&self.pool).await?;
        let has_more = rows.len() > 50;
        rows.truncate(50);
        let next_cursor = if has_more {
            rows.last().map(|row| {
                json!({
                    "createdAt":iso(Some(row.get("created_at"))),
                    "id":row.get::<Uuid,_>("id"),
                })
            })
        } else {
            None
        };
        Ok(
            json!({"classroomRole":classroom_role.unwrap_or_else(||"unassigned".to_owned()),"items":rows.into_iter().map(|row|json!({"id":row.get::<Uuid,_>("id"),"name":row.get::<String,_>("name"),"description":row.get::<String,_>("description"),"purposeLabel":row.get::<Option<String>,_>("purpose_label"),"role":row.get::<String,_>("role"),"createdAt":iso(Some(row.get("created_at"))),"updatedAt":iso(Some(row.get("updated_at")))})).collect::<Vec<_>>(),"nextCursor":next_cursor}),
        )
    }
    pub async fn create_space(
        &self,
        user: &str,
        input: &Value,
        plan: Plan,
    ) -> ApiResult<(bool, Value)> {
        if input.as_object().is_none_or(|object| {
            object.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "clientId" | "name" | "description" | "purposeLabel"
                )
            })
        }) {
            return Err(invalid_request());
        }
        let client_id = required_uuid(input, "clientId")?;
        let name = required_string(input, "name", 240)?;
        let description = match input.get("description") {
            None => "",
            Some(value) => value.as_str().map(str::trim).ok_or_else(invalid_request)?,
        };
        if js_string_len(description) > 4_000 {
            return Err(invalid_request());
        }
        let purpose = match input.get("purposeLabel") {
            None | Some(Value::Null) => None,
            Some(value) => Some(value.as_str().map(str::trim).ok_or_else(invalid_request)?),
        };
        if purpose.is_some_and(|value| js_string_len(value) > 120) {
            return Err(invalid_request());
        }
        let mut tx = self.pool.begin().await?;
        let classroom_role: Option<String> =
            sqlx::query_scalar("SELECT classroom_role FROM users WHERE id=$1 FOR UPDATE")
                .bind(user)
                .fetch_optional(&mut *tx)
                .await?;
        if classroom_role.as_deref() != Some("teacher") {
            return Err(ApiError::coded(
                http::StatusCode::FORBIDDEN,
                "teacher_role_required",
                "An administrator must assign the Teacher role before you can create a class.",
            ));
        }
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("space:{user}:{client_id}"))
            .execute(&mut *tx)
            .await?;
        let existing=sqlx::query("SELECT id,name,description,purpose_label,created_at,updated_at FROM knowledge_spaces WHERE owner_user_id=$1 AND client_id=$2").bind(user).bind(client_id).fetch_optional(&mut*tx).await?;
        if let Some(row) = existing {
            tx.commit().await?;
            return Ok((
                false,
                json!({"space":{"id":row.get::<Uuid,_>("id"),"name":row.get::<String,_>("name"),"description":row.get::<String,_>("description"),"purposeLabel":row.get::<Option<String>,_>("purpose_label"),"role":"owner","createdAt":iso(Some(row.get("created_at"))),"updatedAt":iso(Some(row.get("updated_at")))},"newlyCreated":false}),
            ));
        }
        let owned:i64=sqlx::query_scalar("SELECT COUNT(*)::bigint FROM knowledge_spaces WHERE owner_user_id=$1 AND archived_at IS NULL").bind(user).fetch_one(&mut*tx).await?;
        if owned >= plan.space_count {
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "space_quota_reached",
                "This plan reached its Knowledge Space limit.",
            ));
        }
        let row=sqlx::query("INSERT INTO knowledge_spaces(client_id,owner_user_id,name,description,purpose_label) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at,updated_at").bind(client_id).bind(user).bind(name).bind(description).bind(purpose).fetch_one(&mut*tx).await?;
        let id: Uuid = row.get("id");
        sqlx::query(
            "INSERT INTO knowledge_space_members(space_id,user_id,role) VALUES($1,$2,'owner')",
        )
        .bind(id)
        .bind(user)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok((
            true,
            json!({"space":{"id":id,"name":name,"description":description,"purposeLabel":purpose,"role":"owner","createdAt":iso(Some(row.get("created_at"))),"updatedAt":iso(Some(row.get("updated_at")))},"newlyCreated":true}),
        ))
    }
    pub async fn get_space(&self, user: &str, space: Uuid) -> ApiResult<Value> {
        self.role(user, space, &["owner", "facilitator", "participant"])
            .await?;
        let row=sqlx::query("SELECT spaces.id,spaces.name,spaces.description,spaces.purpose_label,spaces.created_at,spaces.updated_at,members.role FROM knowledge_spaces spaces JOIN knowledge_space_members members ON members.space_id=spaces.id WHERE spaces.id=$1 AND members.user_id=$2 AND members.removed_at IS NULL").bind(space).bind(user).fetch_optional(&self.pool).await?.ok_or_else(||ApiError::coded(http::StatusCode::NOT_FOUND,"space_not_found","Space not found."))?;
        Ok(
            json!({"id":row.get::<Uuid,_>("id"),"name":row.get::<String,_>("name"),"description":row.get::<String,_>("description"),"purposeLabel":row.get::<Option<String>,_>("purpose_label"),"role":row.get::<String,_>("role"),"createdAt":iso(Some(row.get("created_at"))),"updatedAt":iso(Some(row.get("updated_at")))}),
        )
    }
    pub async fn list_sources(&self, user: &str, space: Uuid) -> ApiResult<Value> {
        self.role(user, space, &["owner", "facilitator", "participant"])
            .await?;
        let rows=sqlx::query("SELECT sources.id,sources.display_name,sources.virtual_path,sources.role,sources.created_at,latest.id version_id,latest.state version_state,latest.media_type,latest.byte_size,latest.created_at version_created_at,latest.error_code FROM knowledge_sources sources JOIN knowledge_space_members members ON members.space_id=sources.space_id AND members.user_id=$2 AND members.removed_at IS NULL LEFT JOIN LATERAL(SELECT * FROM knowledge_source_versions versions WHERE versions.source_id=sources.id ORDER BY versions.version_number DESC LIMIT 1)latest ON TRUE WHERE sources.space_id=$1 AND sources.archived_at IS NULL AND sources.role<>'submission' AND(members.role IN('owner','facilitator')OR EXISTS(SELECT 1 FROM knowledge_activity_version_sources pinned JOIN knowledge_activity_runs runs ON runs.activity_version_id=pinned.activity_version_id JOIN knowledge_activity_attempts attempts ON attempts.run_id=runs.id WHERE pinned.source_version_id=latest.id AND attempts.user_id=$2 AND attempts.state<>'withdrawn'))ORDER BY sources.created_at DESC,sources.id DESC LIMIT 100").bind(space).bind(user).fetch_all(&self.pool).await?;
        Ok(
            json!({"items":rows.into_iter().map(|row|{let version:Option<Uuid>=row.get("version_id");json!({"id":row.get::<Uuid,_>("id"),"displayName":row.get::<String,_>("display_name"),"relativePath":row.get::<String,_>("virtual_path"),"role":row.get::<String,_>("role"),"createdAt":iso(Some(row.get("created_at"))),"latestVersion":version.map(|id|json!({"id":id,"state":row.get::<String,_>("version_state"),"mediaType":row.get::<String,_>("media_type"),"byteSize":row.get::<i64,_>("byte_size"),"createdAt":iso(Some(row.get("version_created_at"))),"errorCode":row.get::<Option<String>,_>("error_code")}))})}).collect::<Vec<_>>() }),
        )
    }
    pub async fn list_groups(&self, user: &str, space: Uuid) -> ApiResult<Value> {
        self.role(user, space, &["owner", "facilitator"]).await?;
        let rows=sqlx::query("SELECT groups.id,groups.name,groups.created_at,COUNT(members.user_id)::int participant_count FROM knowledge_space_groups groups LEFT JOIN knowledge_space_group_members members ON members.group_id=groups.id WHERE groups.space_id=$1 AND groups.archived_at IS NULL GROUP BY groups.id ORDER BY groups.created_at DESC,groups.id DESC LIMIT 500").bind(space).fetch_all(&self.pool).await?;
        Ok(
            json!({"items":rows.into_iter().map(|row|json!({"id":row.get::<Uuid,_>("id"),"name":row.get::<String,_>("name"),"createdAt":iso(Some(row.get("created_at"))),"participantCount":row.get::<i32,_>("participant_count")})).collect::<Vec<_>>() }),
        )
    }
    pub async fn create_group(&self, user: &str, space: Uuid, input: &Value) -> ApiResult<Value> {
        self.role(user, space, &["owner", "facilitator"]).await?;
        if input.as_object().is_none_or(|object| {
            object.len() != 2
                || object
                    .keys()
                    .any(|key| !matches!(key.as_str(), "clientId" | "name"))
        }) {
            return Err(invalid_request());
        }
        let client = required_uuid(input, "clientId")?;
        let name = required_string(input, "name", 240)?;
        let row=sqlx::query("INSERT INTO knowledge_space_groups(client_id,space_id,name,created_by)VALUES($1,$2,$3,$4)ON CONFLICT(space_id,client_id)DO UPDATE SET name=knowledge_space_groups.name RETURNING id,name,created_at").bind(client).bind(space).bind(name).bind(user).fetch_one(&self.pool).await?;
        Ok(
            json!({"id":row.get::<Uuid,_>("id"),"name":row.get::<String,_>("name"),"createdAt":iso(Some(row.get("created_at")))}),
        )
    }
    pub async fn list_members(&self, user: &str, space: Uuid) -> ApiResult<Value> {
        self.role(user, space, &["owner", "facilitator"]).await?;
        let rows=sqlx::query("SELECT members.user_id,members.role,members.joined_at,users.email,users.name,users.classroom_role FROM knowledge_space_members members JOIN users ON users.id=members.user_id WHERE members.space_id=$1 AND members.removed_at IS NULL ORDER BY members.joined_at,members.user_id LIMIT 2000").bind(space).fetch_all(&self.pool).await?;
        Ok(
            json!({"items":rows.into_iter().map(|row|json!({"classroomRole":row.get::<String,_>("classroom_role"),"email":row.get::<String,_>("email"),"joinedAt":iso(Some(row.get("joined_at"))),"name":row.get::<String,_>("name"),"role":row.get::<String,_>("role"),"userId":row.get::<String,_>("user_id")})).collect::<Vec<_>>() }),
        )
    }
    pub async fn add_members(&self, user: &str, space: Uuid, input: &Value) -> ApiResult<Value> {
        if input.as_object().is_none_or(|object| {
            object.len() != 3
                || object
                    .keys()
                    .any(|key| !matches!(key.as_str(), "clientId" | "emails" | "role"))
        }) {
            return Err(invalid_request());
        }
        let client_id = required_uuid(input, "clientId")?;
        let requested_role = SpaceRole::parse(required_string(input, "role", 20)?)
            .filter(|role| matches!(role, SpaceRole::Facilitator | SpaceRole::Participant))
            .ok_or_else(invalid_request)?;
        let emails = input
            .get("emails")
            .and_then(Value::as_array)
            .filter(|emails| (1..=500).contains(&emails.len()))
            .ok_or_else(invalid_request)?;
        let mut normalized_emails = Vec::with_capacity(emails.len());
        let mut seen = HashSet::with_capacity(emails.len());
        for value in emails {
            let email = value.as_str().map(str::trim).ok_or_else(invalid_request)?;
            if !valid_email(email) {
                return Err(invalid_request());
            }
            let email = email.to_lowercase();
            if seen.insert(email.clone()) {
                normalized_emails.push(email);
            }
        }

        let actor_role = self.role(user, space, &["owner", "facilitator"]).await?;
        let actor_role = SpaceRole::parse(actor_role).ok_or_else(invalid_request)?;
        if !can_add_member(actor_role, requested_role) {
            return Err(ApiError::coded(
                http::StatusCode::FORBIDDEN,
                "space_forbidden",
                "Teachers can only add students to a class they do not own.",
            ));
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("members:{space}"))
            .execute(&mut *tx)
            .await?;
        if let Some(result) = sqlx::query_scalar::<_, Value>(
            "SELECT result FROM knowledge_space_member_batches WHERE space_id=$1 AND client_id=$2",
        )
        .bind(space)
        .bind(client_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            tx.commit().await?;
            return Ok(result);
        }

        let rows = sqlx::query(
            "SELECT id,email,classroom_role,blocked_at FROM users WHERE LOWER(email)=ANY($1::text[]) FOR UPDATE",
        )
        .bind(&normalized_emails)
        .fetch_all(&mut *tx)
        .await?;
        let mut users_by_email: HashMap<String, Vec<(String, String, String, bool)>> =
            HashMap::new();
        for row in rows {
            let email: String = row.get("email");
            users_by_email
                .entry(email.to_lowercase())
                .or_default()
                .push((
                    row.get("id"),
                    email,
                    row.get("classroom_role"),
                    row.get::<Option<OffsetDateTime>, _>("blocked_at").is_some(),
                ));
        }
        let mut unavailable_emails = Vec::new();
        let mut role_mismatch_emails = Vec::new();
        let mut eligible_users = Vec::new();
        for email in &normalized_emails {
            let Some(candidates) = users_by_email.get(email) else {
                unavailable_emails.push(email.clone());
                continue;
            };
            if candidates.len() != 1 || candidates[0].3 {
                unavailable_emails.push(email.clone());
            } else {
                let account_role = ClassroomRole::parse(&candidates[0].2);
                if account_role.is_some_and(|account_role| {
                    classroom_role_allows_space_role(account_role, requested_role)
                }) {
                    eligible_users.push(candidates[0].clone());
                } else {
                    role_mismatch_emails.push(email.clone());
                }
            }
        }
        let eligible_ids = eligible_users
            .iter()
            .map(|candidate| candidate.0.clone())
            .collect::<Vec<_>>();
        let existing_ids = if eligible_ids.is_empty() {
            HashSet::new()
        } else {
            sqlx::query_scalar::<_, String>(
                "SELECT user_id FROM knowledge_space_members WHERE space_id=$1 AND user_id=ANY($2::text[]) AND removed_at IS NULL",
            )
            .bind(space)
            .bind(&eligible_ids)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .collect::<HashSet<_>>()
        };
        let already_member_emails = eligible_users
            .iter()
            .filter(|candidate| existing_ids.contains(&candidate.0))
            .map(|candidate| candidate.1.to_lowercase())
            .collect::<Vec<_>>();
        let users_to_add = eligible_users
            .iter()
            .filter(|candidate| !existing_ids.contains(&candidate.0))
            .collect::<Vec<_>>();
        if !users_to_add.is_empty() {
            let ids = users_to_add
                .iter()
                .map(|candidate| candidate.0.clone())
                .collect::<Vec<_>>();
            sqlx::query("INSERT INTO knowledge_space_members(space_id,user_id,role) SELECT $1,users.id,$2 FROM users WHERE users.id=ANY($3::text[]) ON CONFLICT(space_id,user_id)DO UPDATE SET role=EXCLUDED.role,removed_at=NULL,joined_at=NOW()")
                .bind(space)
                .bind(requested_role.as_str())
                .bind(ids)
                .execute(&mut *tx)
                .await?;
        }
        let result = json!({
            "addedEmails":users_to_add.iter().map(|candidate|candidate.1.to_lowercase()).collect::<Vec<_>>(),
            "alreadyMemberEmails":already_member_emails,
            "requestedRole":requested_role.as_str(),
            "roleMismatchEmails":role_mismatch_emails,
            "spaceId":space,
            "unavailableEmails":unavailable_emails,
        });
        sqlx::query("INSERT INTO knowledge_space_member_batches(client_id,space_id,requested_role,created_by,result)VALUES($1,$2,$3,$4,$5)")
            .bind(client_id)
            .bind(space)
            .bind(requested_role.as_str())
            .bind(user)
            .bind(&result)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(result)
    }
    fn invite_digest(&self, code: &str) -> ApiResult<[u8; 32]> {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.hmac_key.as_bytes())
            .map_err(ApiError::internal)?;
        mac.update(code.trim().to_uppercase().as_bytes());
        Ok(mac.finalize().into_bytes().into())
    }
    pub async fn create_invite(&self, user: &str, space: Uuid, input: &Value) -> ApiResult<Value> {
        if input.as_object().is_none_or(|object| {
            object.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "clientId" | "groupId" | "role" | "maxUses" | "expiresAt"
                )
            })
        }) {
            return Err(invalid_request());
        }
        let client = required_uuid(input, "clientId")?;
        let role = required_string(input, "role", 20)?;
        if !matches!(role, "facilitator" | "participant") {
            return Err(ApiError::coded(
                http::StatusCode::BAD_REQUEST,
                "invalid_request",
                "Request data is invalid.",
            ));
        }
        let actor_role = self.role(user, space, &["owner", "facilitator"]).await?;
        let actor_role = SpaceRole::parse(actor_role).ok_or_else(invalid_request)?;
        let requested_role = SpaceRole::parse(role).ok_or_else(invalid_request)?;
        if !can_add_member(actor_role, requested_role) {
            return Err(ApiError::coded(
                http::StatusCode::FORBIDDEN,
                "space_forbidden",
                "Teachers can only add students to a class they do not own.",
            ));
        }
        let max = input
            .get("maxUses")
            .and_then(Value::as_i64)
            .filter(|value| (1..=10_000).contains(value))
            .ok_or_else(|| {
                ApiError::coded(
                    http::StatusCode::BAD_REQUEST,
                    "invalid_request",
                    "Request data is invalid.",
                )
            })?;
        let group = match input.get("groupId") {
            None | Some(Value::Null) => None,
            Some(value) => Some(
                value
                    .as_str()
                    .and_then(zod_uuid)
                    .ok_or_else(invalid_request)?,
            ),
        };
        let expires = optional_time(input, "expiresAt")?;
        let mut random = [0u8; 12];
        rand::rng().fill_bytes(&mut random);
        let code = format!(
            "TROSPACE-{}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(random)
                .to_uppercase()
        );
        let digest = self.invite_digest(&code)?;
        let sealed = seal_invite_code(&code, &self.hmac_key, &digest)?;
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("invite:{space}:{client}"))
            .execute(&mut *tx)
            .await?;
        let existing=sqlx::query("SELECT id,code_digest,code_ciphertext,role,max_uses,expires_at,created_at FROM knowledge_space_invites WHERE space_id=$1 AND client_id=$2").bind(space).bind(client).fetch_optional(&mut*tx).await?;
        if let Some(row) = existing {
            let stored_digest: Vec<u8> = row.get("code_digest");
            let stored_digest: [u8; 32] = stored_digest.try_into().map_err(|_| {
                ApiError::internal(anyhow::anyhow!("Stored invite digest is invalid."))
            })?;
            let stored_ciphertext: Option<Vec<u8>> = row.get("code_ciphertext");
            let Some(stored_ciphertext) = stored_ciphertext else {
                return Err(ApiError::coded(
                    http::StatusCode::CONFLICT,
                    "invite_replay_unavailable",
                    "This older invite cannot be replayed. Create a new invite request.",
                ));
            };
            let stored_code = open_invite_code(&stored_ciphertext, &self.hmac_key, &stored_digest)?;
            tx.commit().await?;
            return Ok(
                json!({"id":row.get::<Uuid,_>("id"),"role":row.get::<String,_>("role"),"maxUses":row.get::<i32,_>("max_uses"),"expiresAt":iso(row.get("expires_at")),"createdAt":iso(Some(row.get("created_at"))),"code":stored_code}),
            );
        }
        let row=sqlx::query("INSERT INTO knowledge_space_invites(client_id,space_id,group_id,code_digest,code_ciphertext,role,max_uses,expires_at,created_by)SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE $3::uuid IS NULL OR EXISTS(SELECT 1 FROM knowledge_space_groups WHERE id=$3 AND space_id=$2 AND archived_at IS NULL)RETURNING id,role,max_uses,expires_at,created_at").bind(client).bind(space).bind(group).bind(digest.to_vec()).bind(sealed).bind(role).bind(i32::try_from(max).unwrap_or(10_000)).bind(expires).bind(user).fetch_optional(&mut*tx).await?.ok_or_else(||ApiError::coded(http::StatusCode::NOT_FOUND,"group_not_found","Group not found in this Space."))?;
        tx.commit().await?;
        Ok(
            json!({"id":row.get::<Uuid,_>("id"),"role":row.get::<String,_>("role"),"maxUses":row.get::<i32,_>("max_uses"),"expiresAt":iso(row.get("expires_at")),"createdAt":iso(Some(row.get("created_at"))),"code":code}),
        )
    }
    pub async fn redeem_invite(&self, user: &str, code: &str) -> ApiResult<Value> {
        let mut tx = self.pool.begin().await?;
        let row =
            sqlx::query("SELECT * FROM knowledge_space_invites WHERE code_digest=$1 FOR UPDATE")
                .bind(self.invite_digest(code)?.to_vec())
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| {
                    ApiError::coded(
                        http::StatusCode::BAD_REQUEST,
                        "invite_invalid",
                        "This Space invite is invalid or expired.",
                    )
                })?;
        let id: Uuid = row.get("id");
        let space: Uuid = row.get("space_id");
        let role: String = row.get("role");
        let redemption_count: i32 = row.get("used_count");
        let max: i32 = row.get("max_uses");
        let revoked: Option<OffsetDateTime> = row.get("revoked_at");
        let expires: Option<OffsetDateTime> = row.get("expires_at");
        let invite_role = SpaceRole::parse(&role).ok_or_else(invalid_request)?;
        let account =
            sqlx::query("SELECT classroom_role,blocked_at FROM users WHERE id=$1 FOR UPDATE")
                .bind(user)
                .fetch_optional(&mut *tx)
                .await?;
        let account_matches = account.is_some_and(|account| {
            account
                .get::<Option<OffsetDateTime>, _>("blocked_at")
                .is_none()
                && ClassroomRole::parse(&account.get::<String, _>("classroom_role")).is_some_and(
                    |classroom_role| classroom_role_allows_space_role(classroom_role, invite_role),
                )
        });
        if !account_matches {
            return Err(ApiError::coded(
                http::StatusCode::FORBIDDEN,
                "classroom_role_mismatch",
                "This invite does not match the role assigned to your account.",
            ));
        }
        let already_redeemed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM knowledge_space_invite_redemptions WHERE invite_id=$1 AND user_id=$2)")
            .bind(id)
            .bind(user)
            .fetch_one(&mut *tx)
            .await?;
        let existing_role: Option<String> = sqlx::query_scalar("SELECT role FROM knowledge_space_members WHERE space_id=$1 AND user_id=$2 AND removed_at IS NULL")
            .bind(space)
            .bind(user)
            .fetch_optional(&mut *tx)
            .await?;
        if already_redeemed {
            tx.commit().await?;
            return Ok(json!({"spaceId":space,"role":existing_role.unwrap_or(role)}));
        }
        if revoked.is_some()
            || expires.is_some_and(|value| value <= OffsetDateTime::now_utc())
            || redemption_count >= max
        {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::BAD_REQUEST,
                "invite_invalid",
                "This Space invite is invalid or expired.",
            ));
        }
        if existing_role.is_none() {
            sqlx::query(
                "INSERT INTO knowledge_space_members(space_id,user_id,role)VALUES($1,$2,$3)ON CONFLICT(space_id,user_id)DO UPDATE SET role=EXCLUDED.role,removed_at=NULL,joined_at=NOW()",
            )
            .bind(space)
            .bind(user)
            .bind(&role)
            .execute(&mut *tx)
            .await?;
        }
        if let Some(group) = row.get::<Option<Uuid>, _>("group_id") {
            sqlx::query("INSERT INTO knowledge_space_group_members(group_id,user_id)VALUES($1,$2)ON CONFLICT DO NOTHING").bind(group).bind(user).execute(&mut*tx).await?;
        }
        sqlx::query("UPDATE knowledge_space_invites SET used_count=used_count+1 WHERE id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO knowledge_space_invite_redemptions(invite_id,user_id)VALUES($1,$2)ON CONFLICT DO NOTHING").bind(id).bind(user).execute(&mut*tx).await?;
        tx.commit().await?;
        Ok(json!({"spaceId":space,"role":existing_role.unwrap_or(role)}))
    }
    pub async fn search(
        &self,
        user: &str,
        attempt: Uuid,
        query: &str,
        limit: i64,
    ) -> ApiResult<Value> {
        let allowed: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM knowledge_activity_attempts WHERE id=$1 AND user_id=$2)",
        )
        .bind(attempt)
        .bind(user)
        .fetch_one(&self.pool)
        .await?;
        if !allowed {
            return Err(ApiError::coded(
                http::StatusCode::NOT_FOUND,
                "attempt_not_found",
                "Attempt not found.",
            ));
        }
        let rows=sqlx::query("WITH authorized AS(SELECT pinned.source_version_id FROM knowledge_activity_attempts attempts JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id JOIN knowledge_activity_version_sources pinned ON pinned.activity_version_id=runs.activity_version_id JOIN knowledge_source_versions versions ON versions.id=pinned.source_version_id AND versions.state='ready'WHERE attempts.id=$1 AND attempts.user_id=$2)SELECT chunks.body,chunks.locator,sources.display_name,sources.role,ts_rank_cd(chunks.search_vector,websearch_to_tsquery('simple',$3)) rank FROM knowledge_source_chunks chunks JOIN authorized ON authorized.source_version_id=chunks.source_version_id JOIN knowledge_source_versions versions ON versions.id=chunks.source_version_id JOIN knowledge_sources sources ON sources.id=versions.source_id WHERE chunks.search_vector@@websearch_to_tsquery('simple',$3)ORDER BY rank DESC,chunks.ordinal LIMIT $4").bind(attempt).bind(user).bind(query).bind(limit).fetch_all(&self.pool).await?;
        let row_count = rows.len();
        let mut chars = 0;
        let mut results = Vec::new();
        for row in rows {
            let body: String = row.get("body");
            let remaining = 12_000usize.saturating_sub(chars);
            if remaining == 0 {
                break;
            }
            let snippet = truncate_js_string(&body, remaining.min(4_000));
            chars += js_string_len(&snippet);
            results.push(json!({"sourceTitle":row.get::<String,_>("display_name"),"role":row.get::<String,_>("role"),"locator":row.get::<Value,_>("locator"),"snippet":snippet,"score":row.get::<f32,_>("rank")}));
        }
        let truncated = row_count > results.len() || chars >= 12_000;
        Ok(json!({"results":results,"truncated":truncated}))
    }
}

#[cfg(test)]
mod tests {
    use super::valid_email;

    #[test]
    fn roster_email_validation_matches_the_desktop_contract() {
        for email in [
            "teacher@example.com",
            "first.last+class_2@example-school.edu",
        ] {
            assert!(valid_email(email), "expected valid email: {email}");
        }
        for email in [
            "a@b",
            ".student@example.com",
            "student..name@example.com",
            "student@example.1com",
            "é@example.com",
        ] {
            assert!(!valid_email(email), "expected invalid email: {email}");
        }
    }
}
