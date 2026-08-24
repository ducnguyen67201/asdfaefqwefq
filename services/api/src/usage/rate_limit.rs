use std::time::Duration;

use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::PgPool;
use time::OffsetDateTime;

use crate::error::{ApiError, ApiResult};

#[derive(Clone, Debug)]
pub struct RateLimiter {
    pool: PgPool,
    hmac_key: Vec<u8>,
}

#[derive(Clone, Copy, Debug)]
pub struct RateLimitResult {
    pub allowed: bool,
    pub limit: i64,
    pub remaining: i64,
    pub retry_after_seconds: u64,
}

impl RateLimiter {
    #[must_use]
    pub fn new(pool: PgPool, hmac_key: &str) -> Self {
        Self {
            pool,
            hmac_key: hmac_key.as_bytes().to_vec(),
        }
    }

    pub async fn consume(
        &self,
        scope: &str,
        key: &str,
        limit: i64,
        window: Duration,
    ) -> ApiResult<RateLimitResult> {
        if scope.is_empty() || scope.len() > 64 || key.is_empty() || key.len() > 512 || limit < 1 {
            return Err(ApiError::internal(anyhow::anyhow!(
                "Rate-limit input is invalid."
            )));
        }
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.hmac_key).map_err(ApiError::internal)?;
        mac.update(b"trocode-rate-limit-v1\0");
        mac.update(scope.as_bytes());
        mac.update(b"\0");
        mac.update(key.as_bytes());
        let digest = mac.finalize().into_bytes().to_vec();
        let now = OffsetDateTime::now_utc();
        let window_seconds = i64::try_from(window.as_secs()).map_err(ApiError::internal)?;
        let started = OffsetDateTime::from_unix_timestamp(
            now.unix_timestamp().div_euclid(window_seconds) * window_seconds,
        )
        .map_err(ApiError::internal)?;
        let count: i32 = sqlx::query_scalar(
            "INSERT INTO api_rate_limit_buckets (scope, identity_digest, window_started_at, request_count) VALUES ($1,$2,$3,1) ON CONFLICT (scope, identity_digest, window_started_at) DO UPDATE SET request_count=api_rate_limit_buckets.request_count+1, updated_at=NOW() RETURNING request_count",
        )
        .bind(scope)
        .bind(digest)
        .bind(started)
        .fetch_one(&self.pool)
        .await?;
        let count = i64::from(count);
        let elapsed = now
            .unix_timestamp()
            .saturating_sub(started.unix_timestamp());
        let retry = u64::try_from(window_seconds.saturating_sub(elapsed))
            .unwrap_or(1)
            .max(1);
        Ok(RateLimitResult {
            allowed: count <= limit,
            limit,
            remaining: (limit - count).max(0),
            retry_after_seconds: retry,
        })
    }
}
