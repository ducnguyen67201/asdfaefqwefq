use serde::Serialize;
use sqlx::{PgPool, Row};

use crate::{
    auth::crypto::digest_access_code,
    error::{ApiError, ApiResult},
    usage::plan_for,
};

#[derive(Clone, Debug)]
pub struct AccessCodeRepository {
    pool: PgPool,
    hmac_key: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessStatus {
    pub max_users: Option<i64>,
    pub newly_redeemed: bool,
    pub plan: Option<String>,
    pub state: &'static str,
    pub summary: &'static str,
    pub used_users: Option<i64>,
}

impl AccessCodeRepository {
    #[must_use]
    pub fn new(pool: PgPool, hmac_key: &str) -> Self {
        Self {
            pool,
            hmac_key: hmac_key.to_owned(),
        }
    }
    fn status_from(row: &sqlx::postgres::PgRow, newly_redeemed: bool) -> ApiResult<AccessStatus> {
        let plan: String = row.get("plan");
        plan_for(&plan)?;
        let blocked: Option<time::OffsetDateTime> = row.try_get("blocked_at").ok();
        let free: Option<time::OffsetDateTime> = row.try_get("free_access_started_at").ok();
        let max: Option<i32> = row.try_get("max_users").ok();
        let redemption_count: Option<i32> = row.try_get("used_users").ok();
        let active = blocked.is_none() && (max.is_some() || free.is_some());
        Ok(AccessStatus {
            max_users: max.map(i64::from),
            newly_redeemed,
            plan: Some(plan),
            state: if active { "active" } else { "inactive" },
            summary: if blocked.is_some() {
                "This account has been blocked by an administrator."
            } else if max.is_some() {
                "Access code accepted."
            } else if free.is_some() {
                "Free plan active."
            } else {
                "Enter an access code or continue with Free."
            },
            used_users: redemption_count.map(i64::from),
        })
    }
    pub async fn get_status(&self, user_id: &str) -> ApiResult<AccessStatus> {
        let row=sqlx::query("SELECT users.plan,users.blocked_at,users.free_access_started_at,codes.max_users,COUNT(usage.user_id)::int used_users FROM users LEFT JOIN access_code_redemptions own ON own.user_id=users.id LEFT JOIN access_codes codes ON codes.id=own.access_code_id LEFT JOIN access_code_redemptions usage ON usage.access_code_id=codes.id WHERE users.id=$1 GROUP BY users.id,users.plan,users.blocked_at,users.free_access_started_at,codes.id,codes.max_users").bind(user_id).fetch_optional(&self.pool).await?;
        match row {
            Some(row) => Self::status_from(&row, false),
            None => Ok(AccessStatus {
                max_users: None,
                newly_redeemed: false,
                plan: None,
                state: "inactive",
                summary: "The signed-in account could not be found.",
                used_users: None,
            }),
        }
    }
    pub async fn continue_free(&self, user_id: &str) -> ApiResult<AccessStatus> {
        let mut tx = self.pool.begin().await?;
        let blocked: Option<time::OffsetDateTime> =
            sqlx::query_scalar("SELECT blocked_at FROM users WHERE id=$1 FOR UPDATE")
                .bind(user_id)
                .fetch_one(&mut *tx)
                .await?;
        if blocked.is_some() {
            tx.rollback().await?;
            return Err(ApiError::new(
                http::StatusCode::FORBIDDEN,
                "This account has been blocked by an administrator.",
            ));
        }
        sqlx::query("UPDATE users SET free_access_started_at=COALESCE(free_access_started_at,NOW()),updated_at=NOW() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM access_code_redemptions WHERE user_id=$1)").bind(user_id).execute(&mut*tx).await?;
        tx.commit().await?;
        self.get_status(user_id).await
    }
    pub async fn redeem(&self, user_id: &str, value: &str) -> ApiResult<AccessStatus> {
        let Some(digest) = digest_access_code(value, &self.hmac_key)? else {
            return Err(ApiError::new(
                http::StatusCode::BAD_REQUEST,
                "This access code is not valid.",
            ));
        };
        let mut tx = self.pool.begin().await?;
        let user = sqlx::query("SELECT blocked_at FROM users WHERE id=$1 FOR UPDATE")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("Authenticated user is missing")))?;
        if user
            .get::<Option<time::OffsetDateTime>, _>("blocked_at")
            .is_some()
        {
            tx.rollback().await?;
            return Err(ApiError::new(
                http::StatusCode::FORBIDDEN,
                "This account has been blocked by an administrator.",
            ));
        }
        if let Some(existing)=sqlx::query("SELECT codes.code_digest,codes.max_users,codes.plan,COUNT(usage.user_id)::int used_users FROM access_code_redemptions own JOIN access_codes codes ON codes.id=own.access_code_id JOIN access_code_redemptions usage ON usage.access_code_id=codes.id WHERE own.user_id=$1 GROUP BY codes.id,codes.code_digest,codes.max_users,codes.plan").bind(user_id).fetch_optional(&mut*tx).await?{
            if existing.get::<Vec<u8>,_>("code_digest")!=digest{tx.rollback().await?;return Err(ApiError::new(http::StatusCode::CONFLICT,"This account is already linked to a different access code."));}tx.commit().await?;return Self::status_from(&existing,false);
        }
        let code = sqlx::query(
            "SELECT id,max_users,paused_at,plan FROM access_codes WHERE code_digest=$1 FOR UPDATE",
        )
        .bind(digest.to_vec())
        .fetch_optional(&mut *tx)
        .await?;
        let Some(code) = code else {
            tx.rollback().await?;
            return Err(ApiError::new(
                http::StatusCode::BAD_REQUEST,
                "This access code is not valid.",
            ));
        };
        if code
            .get::<Option<time::OffsetDateTime>, _>("paused_at")
            .is_some()
        {
            tx.rollback().await?;
            return Err(ApiError::new(
                http::StatusCode::CONFLICT,
                "This access code is temporarily paused.",
            ));
        }
        let id: uuid::Uuid = code.get("id");
        let max: i32 = code.get("max_users");
        let plan: String = code.get("plan");
        let redemption_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM access_code_redemptions WHERE access_code_id=$1",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if redemption_count >= i64::from(max) {
            tx.rollback().await?;
            return Err(ApiError::new(
                http::StatusCode::CONFLICT,
                "This access code has reached its user limit.",
            ));
        }
        sqlx::query("INSERT INTO access_code_redemptions(user_id,access_code_id) VALUES($1,$2)")
            .bind(user_id)
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE users SET plan=$2,updated_at=NOW() WHERE id=$1")
            .bind(user_id)
            .bind(&plan)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(AccessStatus {
            max_users: Some(i64::from(max)),
            newly_redeemed: true,
            plan: Some(plan),
            state: "active",
            summary: "Access code accepted.",
            used_users: Some(redemption_count + 1),
        })
    }
}
