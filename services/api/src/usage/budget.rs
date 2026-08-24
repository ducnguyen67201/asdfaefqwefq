use serde::Serialize;
use sqlx::{PgPool, Row};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{
    config::{CostGuardConfig, CostGuardMode},
    error::{ApiError, ApiResult},
    usage::{ProviderUsage, plan_for},
};

#[derive(Clone, Debug)]
pub struct BudgetService {
    pool: PgPool,
    options: CostGuardConfig,
}

#[derive(Clone, Debug)]
pub struct ReservationInput<'a> {
    pub agent_turn_id: Option<Uuid>,
    pub catalog_version: &'a str,
    pub lane: &'a str,
    pub model: &'a str,
    pub plan_id: &'a str,
    pub request_id: Uuid,
    pub reserved_micro_usd: i64,
    pub task_id: Uuid,
    pub user_id: &'a str,
}

#[derive(Clone, Debug)]
pub struct SettlementInput<'a> {
    pub actual_micro_usd: i64,
    pub audio_duration_ms: i64,
    pub character_count: i64,
    pub disposition: &'a str,
    pub duration_ms: i64,
    pub provider_response_id: Option<&'a str>,
    pub request_id: Uuid,
    pub usage: &'a ProviderUsage,
    pub usage_source: &'a str,
    pub user_id: &'a str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub actual_micro_usd: i64,
    pub daily: SpendPeriod,
    pub enforcement_mode: &'static str,
    pub estimated_micro_usd: i64,
    pub messages: MessagePeriod,
    pub month_ends_at: String,
    pub monthly: SpendPeriod,
    pub period_starts_at: String,
    pub plan: String,
    pub pricing: Pricing,
    pub task: SpendPeriod,
    pub warning_threshold_micro_usd: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendPeriod {
    pub limit_micro_usd: i64,
    pub remaining_micro_usd: i64,
    pub reserved_micro_usd: i64,
    pub settled_micro_usd: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePeriod {
    pub limit: i64,
    pub period_ends_at: String,
    pub period_starts_at: String,
    pub remaining: i64,
    pub used: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pricing {
    pub currency: &'static str,
    pub monthly_cents: i64,
}

impl BudgetService {
    #[must_use]
    pub fn new(pool: PgPool, options: CostGuardConfig) -> Self {
        Self { pool, options }
    }

    #[must_use]
    pub const fn realtime_call_estimate_micro_usd(&self) -> i64 {
        self.options.realtime_call_micro_usd
    }

    #[must_use]
    pub fn speech_estimate_micro_usd(&self, characters: usize) -> i64 {
        i64::try_from(characters)
            .unwrap_or(i64::MAX)
            .saturating_mul(self.options.speech_micro_usd_per_thousand_characters)
            .saturating_add(999)
            / 1_000
    }

    pub fn transcription_estimate_micro_usd(&self, duration_ms: i64) -> ApiResult<i64> {
        if !(0..=15_000).contains(&duration_ms) {
            return Err(ApiError::internal(anyhow::anyhow!(
                "durationMs exceeds the transcription segment limit."
            )));
        }
        Ok(duration_ms
            .saturating_mul(self.options.transcription_micro_usd_per_minute)
            .saturating_add(59_999)
            / 60_000)
    }

    pub async fn reserve(&self, input: ReservationInput<'_>) -> ApiResult<()> {
        if !self.options.enabled {
            return Err(ApiError::coded(
                http::StatusCode::SERVICE_UNAVAILABLE,
                "cost_guard_disabled",
                "Hosted model calls are temporarily disabled.",
            ));
        }
        let plan = plan_for(input.plan_id)?;
        let monthly_limit = plan.monthly_micro_usd.min(self.options.monthly_micro_usd);
        let daily_limit = plan.daily_micro_usd.min(self.options.daily_micro_usd);
        let task_limit = plan.task_micro_usd.min(self.options.task_micro_usd);
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(input.user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE model_budget_reservations
             SET status=CASE WHEN dispatched_at IS NULL THEN 'released' ELSE 'uncertain' END,
                 disposition=CASE WHEN dispatched_at IS NULL THEN 'expired_before_dispatch' ELSE 'ambiguous' END,
                 updated_at=NOW()
             WHERE user_id=$1 AND status='reserved'
               AND created_at<NOW()-($2*INTERVAL '1 millisecond')",
        )
        .bind(input.user_id)
        .bind(i64::try_from(self.options.reservation_ttl_ms).unwrap_or(i64::MAX))
        .execute(&mut *tx)
        .await?;
        let duplicate: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM model_budget_reservations WHERE user_id=$1 AND request_id=$2)")
            .bind(input.user_id).bind(input.request_id).fetch_one(&mut *tx).await?;
        if duplicate {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "duplicate_request",
                "This model request was already accepted.",
            ));
        }
        let agent_turn = if input.lane == "responses" {
            let Some(turn_id) = input.agent_turn_id else {
                tx.rollback().await?;
                return Err(ApiError::coded(
                    http::StatusCode::FORBIDDEN,
                    "invalid_agent_turn",
                    "The agent turn is missing, expired, or belongs to another task.",
                ));
            };
            let turn = sqlx::query("SELECT id,task_id,plan,status,provider_call_count FROM agent_turns WHERE id=$1 AND user_id=$2 FOR UPDATE")
                .bind(turn_id).bind(input.user_id).fetch_optional(&mut *tx).await?;
            let Some(turn) = turn else {
                tx.rollback().await?;
                return Err(ApiError::coded(
                    http::StatusCode::FORBIDDEN,
                    "invalid_agent_turn",
                    "The agent turn is missing, expired, or belongs to another task.",
                ));
            };
            if turn.get::<Uuid, _>("task_id") != input.task_id
                || turn.get::<String, _>("plan") != input.plan_id
                || turn.get::<String, _>("status") == "released"
            {
                tx.rollback().await?;
                return Err(ApiError::coded(
                    http::StatusCode::FORBIDDEN,
                    "invalid_agent_turn",
                    "The agent turn is missing, expired, or belongs to another task.",
                ));
            }
            if turn.get::<i32, _>("provider_call_count") >= plan.provider_calls_per_turn {
                tx.rollback().await?;
                return Err(ApiError::coded(
                    http::StatusCode::TOO_MANY_REQUESTS,
                    "agent_turn_call_limit_reached",
                    "This agent turn reached its internal model-call limit.",
                ));
            }
            Some(turn_id)
        } else {
            None
        };
        let committed = sqlx::query(
            "SELECT COALESCE(SUM(CASE WHEN created_at >= date_trunc('month',NOW()) THEN COALESCE(actual_micro_usd,reserved_micro_usd) ELSE 0 END),0)::bigint month_total, COALESCE(SUM(CASE WHEN created_at >= date_trunc('day',NOW()) THEN COALESCE(actual_micro_usd,reserved_micro_usd) ELSE 0 END),0)::bigint day_total, COALESCE(SUM(CASE WHEN task_id=$2 THEN COALESCE(actual_micro_usd,reserved_micro_usd) ELSE 0 END),0)::bigint task_total FROM model_budget_reservations WHERE user_id=$1 AND status IN ('reserved','settled','uncertain')",
        ).bind(input.user_id).bind(input.task_id).fetch_one(&mut *tx).await?;
        let denial = if committed
            .get::<i64, _>("month_total")
            .saturating_add(input.reserved_micro_usd)
            > monthly_limit
        {
            Some((
                "monthly_budget_exhausted",
                "The monthly model budget has been reached.",
            ))
        } else if committed
            .get::<i64, _>("day_total")
            .saturating_add(input.reserved_micro_usd)
            > daily_limit
        {
            Some((
                "daily_budget_exhausted",
                "The daily model budget has been reached.",
            ))
        } else if committed
            .get::<i64, _>("task_total")
            .saturating_add(input.reserved_micro_usd)
            > task_limit
        {
            Some((
                "task_budget_exhausted",
                "This task needs another budget tranche before it can continue.",
            ))
        } else {
            None
        };
        if self.options.mode == CostGuardMode::Enforce
            && let Some((code, message)) = denial
        {
            tx.rollback().await?;
            return Err(ApiError::coded(
                http::StatusCode::PAYMENT_REQUIRED,
                code,
                message,
            ));
        }
        if let Some(turn_id) = agent_turn {
            sqlx::query("UPDATE agent_turns SET provider_call_count=provider_call_count+1,updated_at=NOW() WHERE id=$1")
                .bind(turn_id).execute(&mut *tx).await?;
        }
        sqlx::query("INSERT INTO model_budget_reservations (request_id,user_id,task_id,lane,model,catalog_version,reserved_micro_usd,status,would_deny,agent_turn_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9)")
            .bind(input.request_id).bind(input.user_id).bind(input.task_id).bind(input.lane).bind(input.model).bind(input.catalog_version).bind(input.reserved_micro_usd).bind(denial.is_some()).bind(agent_turn).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn mark_dispatched(&self, user_id: &str, request_id: Uuid) -> ApiResult<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        let turn: Option<Uuid> = sqlx::query_scalar("UPDATE model_budget_reservations SET dispatched_at=COALESCE(dispatched_at,NOW()),updated_at=NOW() WHERE user_id=$1 AND request_id=$2 AND status='reserved' RETURNING agent_turn_id")
            .bind(user_id).bind(request_id).fetch_optional(&mut *tx).await?.flatten();
        if let Some(turn) = turn {
            sqlx::query("UPDATE agent_turns SET status='active',first_dispatched_at=COALESCE(first_dispatched_at,NOW()),updated_at=NOW() WHERE id=$1 AND status<>'released'")
                .bind(turn).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn release(
        &self,
        user_id: &str,
        request_id: Uuid,
        disposition: &str,
    ) -> ApiResult<()> {
        if disposition != "rejected_before_inference" {
            return Err(ApiError::internal(anyhow::anyhow!(
                "A reservation may only be released before inference."
            )));
        }
        self.transition(user_id, request_id, "released", disposition)
            .await
    }

    pub async fn mark_uncertain(&self, user_id: &str, request_id: Uuid) -> ApiResult<()> {
        self.transition(user_id, request_id, "uncertain", "ambiguous_dispatch")
            .await
    }

    async fn transition(
        &self,
        user_id: &str,
        request_id: Uuid,
        status: &str,
        disposition: &str,
    ) -> ApiResult<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        let current = sqlx::query("SELECT agent_turn_id,status FROM model_budget_reservations WHERE user_id=$1 AND request_id=$2 FOR UPDATE")
            .bind(user_id).bind(request_id).fetch_optional(&mut *tx).await?
            .ok_or_else(||ApiError::internal(anyhow::anyhow!("Usage reservation was not found.")))?;
        let changed = sqlx::query("UPDATE model_budget_reservations SET status=$3,disposition=$4,settled_at=NOW(),updated_at=NOW() WHERE user_id=$1 AND request_id=$2 AND status='reserved'")
            .bind(user_id).bind(request_id).bind(status).bind(disposition).execute(&mut *tx).await?.rows_affected();
        if changed > 0
            && let Some(turn) = current.get::<Option<Uuid>, _>("agent_turn_id")
        {
            if status == "uncertain" {
                sqlx::query("UPDATE agent_turns SET status='uncertain',updated_at=NOW() WHERE id=$1 AND status<>'released'")
                    .bind(turn).execute(&mut *tx).await?;
            } else if status == "released" {
                sqlx::query("UPDATE agent_turns SET status='released',updated_at=NOW() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM model_budget_reservations WHERE agent_turn_id=$1 AND status IN('reserved','settled','uncertain'))")
                    .bind(turn).execute(&mut *tx).await?;
            }
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn settle(&self, input: SettlementInput<'_>) -> ApiResult<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(input.user_id)
            .execute(&mut *tx)
            .await?;
        let row = sqlx::query("SELECT task_id,lane,model,catalog_version,status,actual_micro_usd,agent_turn_id FROM model_budget_reservations WHERE user_id=$1 AND request_id=$2 FOR UPDATE")
            .bind(input.user_id).bind(input.request_id).fetch_optional(&mut *tx).await?
            .ok_or_else(||ApiError::internal(anyhow::anyhow!("Usage reservation was not found.")))?;
        let current_status: String = row.get("status");
        if current_status == "settled" {
            if row.get::<Option<i64>, _>("actual_micro_usd") != Some(input.actual_micro_usd) {
                return Err(ApiError::internal(anyhow::anyhow!(
                    "Usage reservation was already settled differently."
                )));
            }
            tx.commit().await?;
            return Ok(());
        }
        if current_status != "reserved" {
            return Err(ApiError::internal(anyhow::anyhow!(
                "Cannot settle a {current_status} reservation."
            )));
        }
        sqlx::query("INSERT INTO model_usage_events (request_id,user_id,task_id,lane,model,catalog_version,input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,reasoning_tokens,duration_ms,audio_duration_ms,character_count,amount_micro_usd,usage_source,disposition,provider_response_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (user_id,request_id) DO NOTHING")
                .bind(input.request_id).bind(input.user_id).bind(row.get::<Uuid,_>("task_id")).bind(row.get::<String,_>("lane")).bind(row.get::<String,_>("model")).bind(row.get::<String,_>("catalog_version"))
                .bind(input.usage.input_tokens).bind(input.usage.cached_input_tokens).bind(input.usage.cache_write_tokens).bind(input.usage.output_tokens).bind(input.usage.reasoning_tokens).bind(input.duration_ms.max(0)).bind(input.audio_duration_ms.max(0)).bind(input.character_count.max(0)).bind(input.actual_micro_usd.max(0)).bind(input.usage_source).bind(input.disposition).bind(input.provider_response_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE model_budget_reservations SET status='settled',actual_micro_usd=$3,disposition='completed',settled_at=NOW(),updated_at=NOW() WHERE user_id=$1 AND request_id=$2")
            .bind(input.user_id).bind(input.request_id).bind(input.actual_micro_usd).execute(&mut *tx).await?;
        if let Some(turn) = row.get::<Option<Uuid>, _>("agent_turn_id") {
            sqlx::query("UPDATE agent_turns SET status='active',updated_at=NOW() WHERE id=$1 AND status<>'released'")
                .bind(turn).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }

    pub async fn snapshot(
        &self,
        user_id: &str,
        task_id: Option<Uuid>,
        plan_id: &str,
    ) -> ApiResult<UsageSnapshot> {
        let row = sqlx::query("SELECT COALESCE(SUM(CASE WHEN created_at>=date_trunc('month',NOW()) AND status='settled' THEN actual_micro_usd ELSE 0 END),0)::bigint month_settled, COALESCE(SUM(CASE WHEN created_at>=date_trunc('month',NOW()) AND status IN ('reserved','uncertain') THEN reserved_micro_usd ELSE 0 END),0)::bigint month_reserved, COALESCE(SUM(CASE WHEN updated_at>=date_trunc('day',NOW()) AND status='settled' THEN actual_micro_usd ELSE 0 END),0)::bigint day_settled, COALESCE(SUM(CASE WHEN updated_at>=date_trunc('day',NOW()) AND status IN ('reserved','uncertain') THEN reserved_micro_usd ELSE 0 END),0)::bigint day_reserved, COALESCE(SUM(CASE WHEN task_id=$2 AND status='settled' THEN actual_micro_usd ELSE 0 END),0)::bigint task_settled, COALESCE(SUM(CASE WHEN task_id=$2 AND status IN ('reserved','uncertain') THEN reserved_micro_usd ELSE 0 END),0)::bigint task_reserved FROM model_budget_reservations WHERE user_id=$1")
            .bind(user_id).bind(task_id).fetch_one(&self.pool).await?;
        let week_messages: i64 = sqlx::query_scalar("SELECT COUNT(*)::bigint FROM agent_turns WHERE user_id=$1 AND created_at>=date_trunc('week',NOW()) AND status<>'released'")
            .bind(user_id).fetch_one(&self.pool).await?;
        let plan = plan_for(plan_id)?;
        let daily_limit = plan.daily_micro_usd.min(self.options.daily_micro_usd);
        let monthly_limit = plan.monthly_micro_usd.min(self.options.monthly_micro_usd);
        let task_limit = plan.task_micro_usd.min(self.options.task_micro_usd);
        let now = OffsetDateTime::now_utc();
        let month_start = now
            .replace_day(1)
            .map_err(ApiError::internal)?
            .replace_hour(0)
            .map_err(ApiError::internal)?
            .replace_minute(0)
            .map_err(ApiError::internal)?
            .replace_second(0)
            .map_err(ApiError::internal)?
            .replace_nanosecond(0)
            .map_err(ApiError::internal)?;
        let month_end = (month_start + Duration::days(32))
            .replace_day(1)
            .map_err(ApiError::internal)?;
        let week_start = (now - Duration::days(i64::from(now.weekday().number_days_from_monday())))
            .replace_hour(0)
            .map_err(ApiError::internal)?
            .replace_minute(0)
            .map_err(ApiError::internal)?
            .replace_second(0)
            .map_err(ApiError::internal)?
            .replace_nanosecond(0)
            .map_err(ApiError::internal)?;
        let week_end = week_start + Duration::days(7);
        let format = |value: OffsetDateTime| {
            value
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        };
        let month_settled = row.get::<i64, _>("month_settled");
        let month_reserved = row.get::<i64, _>("month_reserved");
        let day_settled = row.get::<i64, _>("day_settled");
        let day_reserved = row.get::<i64, _>("day_reserved");
        let task_settled = row.get::<i64, _>("task_settled");
        let task_reserved = row.get::<i64, _>("task_reserved");
        let spend = |limit: i64, settled: i64, reserved: i64| SpendPeriod {
            limit_micro_usd: limit,
            remaining_micro_usd: (limit - settled - reserved).max(0),
            reserved_micro_usd: reserved,
            settled_micro_usd: settled,
        };
        Ok(UsageSnapshot {
            actual_micro_usd: month_settled,
            daily: spend(daily_limit, day_settled, day_reserved),
            enforcement_mode: if self.options.mode == CostGuardMode::Enforce {
                "enforce"
            } else {
                "observe"
            },
            estimated_micro_usd: month_reserved,
            messages: MessagePeriod {
                limit: plan.weekly_messages,
                period_ends_at: format(week_end),
                period_starts_at: format(week_start),
                remaining: (plan.weekly_messages - week_messages).max(0),
                used: week_messages,
            },
            month_ends_at: format(month_end),
            monthly: spend(monthly_limit, month_settled, month_reserved),
            period_starts_at: format(month_start),
            plan: plan_id.to_owned(),
            pricing: Pricing {
                currency: "usd",
                monthly_cents: plan.monthly_price_cents,
            },
            task: spend(task_limit, task_settled, task_reserved),
            warning_threshold_micro_usd: monthly_limit
                .saturating_mul(i64::from(self.options.warning_percent))
                / 100,
        })
    }
}
