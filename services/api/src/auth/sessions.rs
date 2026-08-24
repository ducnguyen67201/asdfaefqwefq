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
