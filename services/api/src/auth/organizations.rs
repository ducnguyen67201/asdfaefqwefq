use base64::{Engine as _, engine::general_purpose::STANDARD};
use http::StatusCode;
use serde::Serialize;
use sqlx::{PgPool, Row};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

const CURRENT_MEMBERSHIP: &str = "SELECT memberships.id membership_id,memberships.organization_id,memberships.role,organizations.access_code_id,organizations.name organization_name,organizations.home_banner_mime_type,organizations.home_banner_bytes,codes.max_users,codes.paused_at,codes.plan,(SELECT COUNT(*)::int FROM organization_memberships assigned WHERE assigned.organization_id=organizations.id AND assigned.removed_at IS NULL)assigned_seats FROM organization_memberships memberships JOIN organizations ON organizations.id=memberships.organization_id JOIN access_codes codes ON codes.id=organizations.access_code_id WHERE memberships.user_id=$1 AND memberships.removed_at IS NULL";

pub const MAX_ORGANIZATION_HOME_BANNER_BYTES: usize = 750_000;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationCapacity {
    pub assigned_seats: i64,
    pub max_seats: i64,
    pub remaining_seats: i64,
    pub state: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationHomeBanner {
    pub image_data_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationSummary {
    pub capacity: OrganizationCapacity,
    pub home_banner: Option<OrganizationHomeBanner>,
    pub id: Uuid,
    pub name: String,
    pub plan: String,
    pub role: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationMember {
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub email: String,
    pub id: Uuid,
    #[serde(with = "time::serde::rfc3339::option")]
    pub joined_at: Option<OffsetDateTime>,
    pub name: Option<String>,
    pub role: String,
    pub state: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct OrganizationPage {
    pub limit: i64,
    pub offset: i64,
    pub total: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct OrganizationMemberList {
    pub items: Vec<OrganizationMember>,
    pub organization: OrganizationSummary,
    pub page: OrganizationPage,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddOrganizationMember {
    pub member: OrganizationMember,
    pub newly_created: bool,
    pub organization: OrganizationSummary,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelOrganizationMember {
    pub kind: &'static str,
    pub member_id: Uuid,
    pub organization: OrganizationSummary,
}

#[derive(Clone, Debug)]
pub struct OrganizationRepository {
    pool: PgPool,
}

#[must_use]
pub fn organization_capacity(max_users: i32, assigned_seats: i64) -> OrganizationCapacity {
    let max_seats = i64::from(max_users);
    OrganizationCapacity {
        assigned_seats,
        max_seats,
        remaining_seats: (max_seats - assigned_seats).max(0),
        state: if assigned_seats >= max_seats {
            "full"
        } else {
            "available"
        },
    }
}

fn summary(row: &sqlx::postgres::PgRow, assigned: Option<i64>) -> OrganizationSummary {
    let assigned_seats = assigned.unwrap_or_else(|| i64::from(row.get::<i32, _>("assigned_seats")));
    let home_banner = match (
        row.get::<Option<String>, _>("home_banner_mime_type"),
        row.get::<Option<Vec<u8>>, _>("home_banner_bytes"),
    ) {
        (Some(mime_type), Some(bytes)) => Some(OrganizationHomeBanner {
            image_data_url: format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)),
        }),
        _ => None,
    };
    OrganizationSummary {
        capacity: organization_capacity(row.get("max_users"), assigned_seats),
        home_banner,
        id: row.get("organization_id"),
        name: row.get("organization_name"),
        plan: row.get("plan"),
        role: row.get("role"),
    }
}

fn member(row: &sqlx::postgres::PgRow) -> OrganizationMember {
    let user_id: Option<String> = row.get("user_id");
    OrganizationMember {
        created_at: row.get("created_at"),
        email: row.get("email"),
        id: row.get("id"),
        joined_at: row.get("joined_at"),
        name: row.try_get("name").ok(),
        role: row.get("role"),
        state: if user_id.is_some() {
            "active"
        } else {
            "pending"
        },
    }
}

pub fn normalize_organization_email(value: &str) -> Option<(String, String)> {
    let email = value.trim();
    if !(3..=320).contains(&email.len())
        || email.chars().any(char::is_whitespace)
        || email.matches('@').count() != 1
    {
        return None;
    }
    let (_, domain) = email.split_once('@')?;
    if !domain.contains('.') || domain.starts_with('.') || domain.ends_with('.') {
        return None;
    }
    Some((email.to_owned(), email.to_lowercase()))
}

pub fn normalize_organization_name(value: &str) -> Option<String> {
    let name = value.trim();
    let character_count = name.chars().count();
    if !(1..=100).contains(&character_count) || name.chars().any(char::is_control) {
        return None;
    }
    Some(name.to_owned())
}

pub fn decode_organization_home_banner(value: &str) -> Option<(String, Vec<u8>)> {
    let (header, encoded) = value.split_once(',')?;
    let mime_type = match header {
        "data:image/png;base64" => "image/png",
        "data:image/jpeg;base64" => "image/jpeg",
        "data:image/webp;base64" => "image/webp",
        _ => return None,
    };
    let bytes = STANDARD.decode(encoded).ok()?;
    if bytes.is_empty() || bytes.len() > MAX_ORGANIZATION_HOME_BANNER_BYTES {
        return None;
    }
    let signature_is_valid = match mime_type {
        "image/png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]) && bytes.ends_with(&[0xff, 0xd9]),
        "image/webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        _ => false,
    };
    signature_is_valid.then(|| (mime_type.to_owned(), bytes))
}

impl OrganizationRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn current_for_user(&self, user_id: &str) -> ApiResult<Option<OrganizationSummary>> {
        let row = sqlx::query(CURRENT_MEMBERSHIP)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(|value| summary(value, None)))
    }

    pub async fn update_name(
        &self,
        user_id: &str,
        name_value: &str,
    ) -> ApiResult<OrganizationSummary> {
        let Some(name) = normalize_organization_name(name_value) else {
            return Err(ApiError::coded(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "A valid organization name is required.",
            ));
        };
        let mut tx = self.pool.begin().await?;
        let current = sqlx::query(CURRENT_MEMBERSHIP)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
        let Some(current) = current.filter(|row| row.get::<String, _>("role") == "organizer")
        else {
            tx.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::FORBIDDEN,
                "organization_organizer_required",
                "Organization organizer access is required.",
            ));
        };
        let organization_id: Uuid = current.get("organization_id");
        let updated_name: String = sqlx::query_scalar(
            "UPDATE organizations SET name=$2,updated_at=NOW() WHERE id=$1 RETURNING name",
        )
        .bind(organization_id)
        .bind(name)
        .fetch_one(&mut *tx)
        .await?;
        sqlx::query("INSERT INTO organization_audit_events(organization_id,actor_user_id,action,detail)VALUES($1,$2,'organization.profile_updated','{}'::jsonb)")
            .bind(organization_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        let mut organization = summary(&current, None);
        organization.name = updated_name;
        Ok(organization)
    }

    pub async fn update_home_banner(
        &self,
        user_id: &str,
        image_data_url: Option<&str>,
    ) -> ApiResult<OrganizationSummary> {
        let banner = match image_data_url {
            Some(value) => Some(decode_organization_home_banner(value).ok_or_else(|| {
                ApiError::coded(
                    StatusCode::BAD_REQUEST,
                    "invalid_request",
                    "Use a PNG, JPEG, or WebP image no larger than 750 KB.",
                )
            })?),
            None => None,
        };
        let mut tx = self.pool.begin().await?;
        let current = sqlx::query(CURRENT_MEMBERSHIP)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
        let Some(current) = current.filter(|row| row.get::<String, _>("role") == "organizer")
        else {
            tx.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::FORBIDDEN,
                "organization_organizer_required",
                "Organization organizer access is required.",
            ));
        };
        let organization_id: Uuid = current.get("organization_id");
        let mime_type = banner.as_ref().map(|(mime_type, _)| mime_type.as_str());
        let bytes = banner.as_ref().map(|(_, bytes)| bytes.as_slice());
        sqlx::query("UPDATE organizations SET home_banner_mime_type=$2,home_banner_bytes=$3,updated_at=NOW() WHERE id=$1")
            .bind(organization_id)
            .bind(mime_type)
            .bind(bytes)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO organization_audit_events(organization_id,actor_user_id,action,detail)VALUES($1,$2,'organization.home_banner_updated',$3)")
            .bind(organization_id)
            .bind(user_id)
            .bind(serde_json::json!({"custom": banner.is_some(), "byteSize": bytes.map_or(0, <[u8]>::len)}))
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        let mut organization = summary(&current, None);
        organization.home_banner = banner.map(|(mime_type, bytes)| OrganizationHomeBanner {
            image_data_url: format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)),
        });
        Ok(organization)
    }

    pub async fn list_members(
        &self,
        user_id: &str,
        limit: i64,
        offset: i64,
    ) -> ApiResult<OrganizationMemberList> {
        let current = sqlx::query(CURRENT_MEMBERSHIP)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?;
        let Some(current) = current.filter(|row| row.get::<String, _>("role") == "organizer")
        else {
            return Err(ApiError::coded(
                StatusCode::FORBIDDEN,
                "organization_organizer_required",
                "Organization organizer access is required.",
            ));
        };
        let organization_id: Uuid = current.get("organization_id");
        let rows=sqlx::query("SELECT memberships.id,memberships.email,memberships.role,memberships.user_id,memberships.created_at,memberships.joined_at,users.name,COUNT(*)OVER()::int total FROM organization_memberships memberships LEFT JOIN users ON users.id=memberships.user_id WHERE memberships.organization_id=$1 AND memberships.removed_at IS NULL ORDER BY CASE WHEN memberships.role='organizer'THEN 0 ELSE 1 END,CASE WHEN memberships.user_id IS NOT NULL THEN 0 ELSE 1 END,memberships.created_at,memberships.id LIMIT $2 OFFSET $3")
            .bind(organization_id).bind(limit).bind(offset).fetch_all(&self.pool).await?;
        let total = rows.first().map_or_else(
            || i64::from(current.get::<i32, _>("assigned_seats")),
            |row| i64::from(row.get::<i32, _>("total")),
        );
        Ok(OrganizationMemberList {
            items: rows.iter().map(member).collect(),
            organization: summary(&current, None),
            page: OrganizationPage {
                limit,
                offset,
                total,
            },
        })
    }

    pub async fn add_member(
        &self,
        user_id: &str,
        email_value: &str,
    ) -> ApiResult<AddOrganizationMember> {
        let Some((email, normalized)) = normalize_organization_email(email_value) else {
            return Err(ApiError::coded(
                StatusCode::BAD_REQUEST,
                "invalid_request",
                "A valid email is required.",
            ));
        };
        let mut tx = self.pool.begin().await?;
        let current = sqlx::query(CURRENT_MEMBERSHIP)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
        let Some(current) = current.filter(|row| row.get::<String, _>("role") == "organizer")
        else {
            tx.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::FORBIDDEN,
                "organization_organizer_required",
                "Organization organizer access is required.",
            ));
        };
        let organization_id: Uuid = current.get("organization_id");
        let access_code_id: Uuid = current.get("access_code_id");
        let code =
            sqlx::query("SELECT id,max_users,paused_at FROM access_codes WHERE id=$1 FOR UPDATE")
                .bind(access_code_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| {
                    ApiError::internal(anyhow::anyhow!("Organization access code is missing"))
                })?;
        if code.get::<Option<OffsetDateTime>, _>("paused_at").is_some() {
            tx.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::CONFLICT,
                "organization_code_paused",
                "This organization access code is temporarily paused.",
            ));
        }
        let existing=sqlx::query("SELECT memberships.id,memberships.email,memberships.role,memberships.user_id,memberships.created_at,memberships.joined_at,memberships.organization_id,users.name FROM organization_memberships memberships LEFT JOIN users ON users.id=memberships.user_id WHERE memberships.email_normalized=$1 AND memberships.removed_at IS NULL")
            .bind(&normalized).fetch_optional(&mut *tx).await?;
        if let Some(existing) = existing {
            if existing.get::<Uuid, _>("organization_id") != organization_id {
                tx.rollback().await?;
                return Err(ApiError::coded(
                    StatusCode::CONFLICT,
                    "email_already_assigned",
                    "This email is already assigned to another organization.",
                ));
            }
            tx.commit().await?;
            return Ok(AddOrganizationMember {
                member: member(&existing),
                newly_created: false,
                organization: summary(&current, None),
            });
        }
        let assigned: i64=sqlx::query_scalar("SELECT COUNT(*)::bigint FROM organization_memberships WHERE organization_id=$1 AND removed_at IS NULL")
            .bind(organization_id).fetch_one(&mut *tx).await?;
        let max_users: i32 = code.get("max_users");
        if assigned >= i64::from(max_users) {
            tx.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::CONFLICT,
                "organization_capacity_reached",
                "All organization seats are already assigned.",
            ));
        }
        let inserted=sqlx::query("INSERT INTO organization_memberships(organization_id,email,email_normalized,role,invited_by_user_id)VALUES($1,$2,$3,'member',$4)ON CONFLICT DO NOTHING RETURNING id,email,role,user_id,created_at,joined_at")
            .bind(organization_id).bind(email).bind(&normalized).bind(user_id).fetch_optional(&mut *tx).await?;
        let Some(inserted) = inserted else {
            let conflicting=sqlx::query("SELECT memberships.id,memberships.email,memberships.role,memberships.user_id,memberships.created_at,memberships.joined_at,memberships.organization_id,users.name FROM organization_memberships memberships LEFT JOIN users ON users.id=memberships.user_id WHERE memberships.email_normalized=$1 AND memberships.removed_at IS NULL")
                .bind(normalized).fetch_one(&mut *tx).await?;
            if conflicting.get::<Uuid, _>("organization_id") != organization_id {
                tx.rollback().await?;
                return Err(ApiError::coded(
                    StatusCode::CONFLICT,
                    "email_already_assigned",
                    "This email is already assigned to another organization.",
                ));
            }
            tx.commit().await?;
            return Ok(AddOrganizationMember {
                member: member(&conflicting),
                newly_created: false,
                organization: summary(&current, None),
            });
        };
        sqlx::query("INSERT INTO organization_audit_events(organization_id,actor_user_id,target_membership_id,action,detail)VALUES($1,$2,$3,'organization.member_added',$4)")
            .bind(organization_id).bind(user_id).bind(inserted.get::<Uuid,_>("id"))
            .bind(serde_json::json!({"assignedSeats":assigned+1,"maxSeats":max_users})).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(AddOrganizationMember {
            member: member(&inserted),
            newly_created: true,
            organization: summary(&current, Some(assigned + 1)),
        })
    }

    pub async fn cancel_pending(
        &self,
        user_id: &str,
        membership_id: Uuid,
    ) -> ApiResult<CancelOrganizationMember> {
        let mut tx = self.pool.begin().await?;
        let current = sqlx::query(CURRENT_MEMBERSHIP)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
        let Some(current) = current.filter(|row| row.get::<String, _>("role") == "organizer")
        else {
            tx.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::FORBIDDEN,
                "organization_organizer_required",
                "Organization organizer access is required.",
            ));
        };
        let organization_id: Uuid = current.get("organization_id");
        let access_code_id: Uuid = current.get("access_code_id");
        let max_users: i32 =
            sqlx::query_scalar("SELECT max_users FROM access_codes WHERE id=$1 FOR UPDATE")
                .bind(access_code_id)
                .fetch_one(&mut *tx)
                .await?;
        let target=sqlx::query("SELECT id,role,user_id,joined_at FROM organization_memberships WHERE id=$1 AND organization_id=$2 AND removed_at IS NULL FOR UPDATE")
            .bind(membership_id).bind(organization_id).fetch_optional(&mut *tx).await?;
        let Some(target) = target else {
            tx.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::NOT_FOUND,
                "not_found",
                "Organization member not found.",
            ));
        };
        if target.get::<String, _>("role") == "organizer"
            || target.get::<Option<String>, _>("user_id").is_some()
            || target
                .get::<Option<OffsetDateTime>, _>("joined_at")
                .is_some()
        {
            tx.rollback().await?;
            return Err(ApiError::coded(
                StatusCode::CONFLICT,
                "organization_member_active",
                "Active organization members cannot be removed.",
            ));
        }
        sqlx::query("UPDATE organization_memberships SET removed_at=NOW() WHERE id=$1")
            .bind(membership_id)
            .execute(&mut *tx)
            .await?;
        let assigned:i64=sqlx::query_scalar("SELECT COUNT(*)::bigint FROM organization_memberships WHERE organization_id=$1 AND removed_at IS NULL")
            .bind(organization_id).fetch_one(&mut *tx).await?;
        sqlx::query("INSERT INTO organization_audit_events(organization_id,actor_user_id,target_membership_id,action,detail)VALUES($1,$2,$3,'organization.pending_cancelled',$4)")
            .bind(organization_id).bind(user_id).bind(membership_id).bind(serde_json::json!({"assignedSeats":assigned})).execute(&mut *tx).await?;
        tx.commit().await?;
        let mut organization = summary(&current, Some(assigned));
        organization.capacity = organization_capacity(max_users, assigned);
        Ok(CancelOrganizationMember {
            kind: "cancelled",
            member_id: membership_id,
            organization,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_ORGANIZATION_HOME_BANNER_BYTES, decode_organization_home_banner};
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    #[test]
    fn validates_supported_banner_signatures() {
        let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        let value = format!("data:image/png;base64,{}", STANDARD.encode(png));
        assert_eq!(
            decode_organization_home_banner(&value),
            Some(("image/png".to_owned(), png.to_vec()))
        );

        assert!(decode_organization_home_banner("data:image/svg+xml;base64,PHN2Zz4=").is_none());
        assert!(decode_organization_home_banner("data:image/png;base64,bm90IGEgcG5n").is_none());
        let oversized = vec![0_u8; MAX_ORGANIZATION_HOME_BANNER_BYTES + 1];
        assert!(
            decode_organization_home_banner(&format!(
                "data:image/png;base64,{}",
                STANDARD.encode(oversized)
            ))
            .is_none()
        );
    }
}
