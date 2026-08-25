use crate::error::{ApiError, ApiResult};

#[derive(Clone, Copy, Debug)]
pub struct Plan {
    pub id: &'static str,
    pub active_runs: i64,
    pub daily_micro_usd: i64,
    pub group_participants: i64,
    pub knowledge_queries_per_minute: i64,
    pub monthly_micro_usd: i64,
    pub monthly_price_cents: i64,
    pub provider_calls_per_turn: i32,
    pub responses_per_minute: i64,
    pub space_count: i64,
    pub space_storage_bytes: i64,
    pub task_micro_usd: i64,
    pub upload_files_per_batch: i64,
    pub upload_initiates_per_minute: i64,
    pub weekly_messages: i64,
}

pub const FREE: Plan = Plan {
    id: "free",
    active_runs: 0,
    daily_micro_usd: 250_000,
    group_participants: 0,
    knowledge_queries_per_minute: 0,
    monthly_micro_usd: 1_000_000,
    monthly_price_cents: 0,
    provider_calls_per_turn: 40,
    responses_per_minute: 15,
    space_count: 0,
    space_storage_bytes: 0,
    task_micro_usd: 100_000,
    upload_files_per_batch: 0,
    upload_initiates_per_minute: 0,
    weekly_messages: 25,
};

pub const BASIC: Plan = Plan {
    id: "basic",
    active_runs: 5,
    daily_micro_usd: 1_000_000,
    group_participants: 200,
    knowledge_queries_per_minute: 60,
    monthly_micro_usd: 8_000_000,
    monthly_price_cents: 2_000,
    provider_calls_per_turn: 40,
    responses_per_minute: 30,
    space_count: 3,
    space_storage_bytes: 1_073_741_824,
    task_micro_usd: 750_000,
    upload_files_per_batch: 50,
    upload_initiates_per_minute: 20,
    weekly_messages: 300,
};

pub const PRO: Plan = Plan {
    id: "pro",
    active_runs: 25,
    daily_micro_usd: 3_000_000,
    group_participants: 1_000,
    knowledge_queries_per_minute: 180,
    monthly_micro_usd: 20_000_000,
    monthly_price_cents: 5_000,
    provider_calls_per_turn: 40,
    responses_per_minute: 45,
    space_count: 20,
    space_storage_bytes: 21_474_836_480,
    task_micro_usd: 2_000_000,
    upload_files_per_batch: 100,
    upload_initiates_per_minute: 60,
    weekly_messages: 750,
};

pub const MAX: Plan = Plan {
    id: "max",
    active_runs: 100,
    daily_micro_usd: 8_000_000,
    group_participants: 2_000,
    knowledge_queries_per_minute: 360,
    monthly_micro_usd: 45_000_000,
    monthly_price_cents: 10_000,
    provider_calls_per_turn: 40,
    responses_per_minute: 60,
    space_count: 100,
    space_storage_bytes: 107_374_182_400,
    task_micro_usd: 5_000_000,
    upload_files_per_batch: 100,
    upload_initiates_per_minute: 120,
    weekly_messages: 1_875,
};

pub fn plan_for(id: &str) -> ApiResult<Plan> {
    match id {
        "free" => Ok(FREE),
        "basic" => Ok(BASIC),
        "pro" => Ok(PRO),
        "max" => Ok(MAX),
        _ => Err(ApiError::internal(anyhow::anyhow!(
            "Unknown usage plan: {id}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_are_monotonic() {
        let weekly = [
            FREE.weekly_messages,
            BASIC.weekly_messages,
            PRO.weekly_messages,
            MAX.weekly_messages,
        ];
        assert!(weekly.windows(2).all(|pair| pair[0] < pair[1]));
    }
}
