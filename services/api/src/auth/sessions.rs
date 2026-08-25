use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::{PgPool, Row};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct User {
    pub email: String,
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug)]
pub struct DeviceSession {
    pub expires_at: OffsetDateTime,
    pub session_id: Uuid,
    pub user: User,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedSession {
    pub access_token: String,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    pub user: User,
}

#[derive(Clone, Debug)]
pub struct SessionRepository {
    pool: PgPool,
    hmac_key: Vec<u8>,
    duration_days: u32,
}

impl SessionRepository {
    #[must_use]
    pub fn new(pool: PgPool, hmac_key: &str, duration_days: u32) -> Self {
        Self {
            pool,
            hmac_key: hmac_key.as_bytes().to_vec(),
            duration_days,
        }
    }
    fn digest(&self, token: &str) -> ApiResult<Vec<u8>> {
        let mut mac =
            <Hmac<Sha256> as Mac>::new_from_slice(&self.hmac_key).map_err(ApiError::internal)?;
        mac.update(token.as_bytes());
        Ok(mac.finalize().into_bytes().to_vec())
    }
    fn token() -> String {
        let mut bytes = [0_u8; 32];
        rand::rng().fill_bytes(&mut bytes);
        format!("tro_live_{}", URL_SAFE_NO_PAD.encode(bytes))
    }

    pub async fn issue(&self, user: User) -> ApiResult<Option<IssuedSession>> {
        let token = Self::token();
        let digest = self.digest(&token)?;
        let mut tx = self.pool.begin().await?;
        let blocked: Option<OffsetDateTime> = sqlx::query_scalar("INSERT INTO users (id,email,name) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,updated_at=NOW() RETURNING blocked_at")
            .bind(&user.id).bind(&user.email).bind(&user.name).fetch_one(&mut *tx).await?;
        if blocked.is_some() {
            tx.rollback().await?;
            return Ok(None);
        }
        let candidate=sqlx::query("SELECT memberships.id,memberships.organization_id,organizations.access_code_id FROM organization_memberships memberships JOIN organizations ON organizations.id=memberships.organization_id WHERE memberships.email_normalized=LOWER(BTRIM($1))AND memberships.user_id IS NULL AND memberships.joined_at IS NULL AND memberships.removed_at IS NULL LIMIT 1")
            .bind(&user.email).fetch_optional(&mut *tx).await?;
        if let Some(candidate) = candidate {
            let membership_id: Uuid = candidate.get("id");
            let organization_id: Uuid = candidate.get("organization_id");
            let access_code_id: Uuid = candidate.get("access_code_id");
            let code = sqlx::query("SELECT id,plan FROM access_codes WHERE id=$1 FOR UPDATE")
                .bind(access_code_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| {
                    ApiError::internal(anyhow::anyhow!(
                        "Reserved organization access code is missing"
                    ))
                })?;
            let pending=sqlx::query("SELECT id,organization_id FROM organization_memberships WHERE id=$1 AND email_normalized=LOWER(BTRIM($2))AND user_id IS NULL AND joined_at IS NULL AND removed_at IS NULL FOR UPDATE")
                .bind(membership_id).bind(&user.email).fetch_optional(&mut *tx).await?;
            if pending.is_some() {
                let conflict: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM access_code_redemptions WHERE user_id=$1)OR EXISTS(SELECT 1 FROM organization_memberships WHERE user_id=$1 AND removed_at IS NULL)")
                    .bind(&user.id).fetch_one(&mut *tx).await?;
                if !conflict {
                    sqlx::query("UPDATE organization_memberships SET user_id=$2,email=$3,email_normalized=LOWER(BTRIM($3)),joined_at=NOW() WHERE id=$1")
                        .bind(membership_id).bind(&user.id).bind(&user.email).execute(&mut *tx).await?;
                    sqlx::query(
                        "INSERT INTO access_code_redemptions(user_id,access_code_id)VALUES($1,$2)",
                    )
                    .bind(&user.id)
                    .bind(access_code_id)
                    .execute(&mut *tx)
                    .await?;
                    let plan: String = code.get("plan");
                    sqlx::query("UPDATE users SET plan=$2,updated_at=NOW() WHERE id=$1")
                        .bind(&user.id)
                        .bind(plan)
                        .execute(&mut *tx)
                        .await?;
                    sqlx::query("INSERT INTO organization_audit_events(organization_id,actor_user_id,target_membership_id,action,detail)VALUES($1,$2,$3,'organization.member_joined','{}'::jsonb)")
                        .bind(organization_id).bind(&user.id).bind(membership_id).execute(&mut *tx).await?;
                }
            }
        }
        let expires_at: OffsetDateTime = sqlx::query_scalar("INSERT INTO device_sessions (user_id,token_digest,expires_at) VALUES ($1,$2,NOW()+($3*INTERVAL '1 day')) RETURNING expires_at")
            .bind(&user.id).bind(digest).bind(i64::from(self.duration_days)).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(Some(IssuedSession {
            access_token: token,
            expires_at,
            user,
        }))
    }

    pub async fn authenticate(&self, token: &str) -> ApiResult<Option<DeviceSession>> {
        if !token.starts_with("tro_live_")
            || token.len() != 52
            || !token[9..]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        {
            return Ok(None);
        }
        let row = sqlx::query("UPDATE device_sessions sessions SET last_used_at=NOW() FROM users WHERE sessions.token_digest=$1 AND sessions.user_id=users.id AND users.blocked_at IS NULL AND sessions.revoked_at IS NULL AND sessions.expires_at>NOW() RETURNING sessions.id session_id,sessions.expires_at,users.id,users.email,users.name")
            .bind(self.digest(token)?).fetch_optional(&self.pool).await?;
        Ok(row.map(|row| DeviceSession {
            expires_at: row.get("expires_at"),
            session_id: row.get("session_id"),
            user: User {
                id: row.get("id"),
                email: row.get("email"),
                name: row.get("name"),
            },
        }))
    }

    pub async fn revoke(&self, session_id: Uuid) -> ApiResult<()> {
        sqlx::query(
            "UPDATE device_sessions SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL",
        )
        .bind(session_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn rotate(&self, session: &DeviceSession) -> ApiResult<Option<IssuedSession>> {
        let token = Self::token();
        let digest = self.digest(&token)?;
        let mut tx = self.pool.begin().await?;
        let revoked: Option<String> = sqlx::query_scalar("UPDATE device_sessions sessions SET revoked_at=NOW() FROM users WHERE sessions.id=$1 AND sessions.user_id=users.id AND users.blocked_at IS NULL AND sessions.revoked_at IS NULL AND sessions.expires_at>NOW() RETURNING sessions.user_id")
            .bind(session.session_id).fetch_optional(&mut *tx).await?;
        if revoked.is_none() {
            tx.rollback().await?;
            return Ok(None);
        }
        let expires_at: OffsetDateTime = sqlx::query_scalar("INSERT INTO device_sessions (user_id,token_digest,expires_at) VALUES ($1,$2,NOW()+($3*INTERVAL '1 day')) RETURNING expires_at")
            .bind(&session.user.id).bind(digest).bind(i64::from(self.duration_days)).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(Some(IssuedSession {
            access_token: token,
            expires_at,
            user: session.user.clone(),
        }))
    }
}
