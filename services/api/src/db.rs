use std::{borrow::Cow, sync::LazyLock, time::Duration};

use sqlx::{
    PgPool,
    migrate::{Migration, MigrationType, Migrator},
    postgres::PgPoolOptions,
};

use crate::{config::Config, error::ApiError};

static MIGRATOR: LazyLock<Migrator> = LazyLock::new(|| Migrator {
    migrations: Cow::Owned(vec![
        migration(
            1,
            "hosted sessions",
            include_str!("../migrations/001_hosted_sessions.sql"),
        ),
        migration(
            2,
            "access codes",
            include_str!("../migrations/002_access_codes.sql"),
        ),
        migration(
            3,
            "model usage budgets",
            include_str!("../migrations/003_model_usage_budgets.sql"),
        ),
        migration(
            4,
            "audio transcription usage",
            include_str!("../migrations/004_audio_transcription_usage.sql"),
        ),
        migration(
            5,
            "usage plans and rate limits",
            include_str!("../migrations/005_usage_plans_and_rate_limits.sql"),
        ),
        migration(
            6,
            "agent turns",
            include_str!("../migrations/006_agent_turns.sql"),
        ),
        migration(
            7,
            "free usage plan",
            include_str!("../migrations/007_free_usage_plan.sql"),
        ),
        migration(
            8,
            "knowledge spaces",
            include_str!("../migrations/008_knowledge_spaces.sql"),
        ),
        migration(
            9,
            "knowledge sources",
            include_str!("../migrations/009_knowledge_sources.sql"),
        ),
        migration(
            10,
            "knowledge activities",
            include_str!("../migrations/010_knowledge_activities.sql"),
        ),
        migration(
            11,
            "admin access controls",
            include_str!("../migrations/011_admin_access_controls.sql"),
        ),
        migration(
            12,
            "retrievable access codes",
            include_str!("../migrations/012_retrievable_access_codes.sql"),
        ),
        migration(
            13,
            "access code lifecycle",
            include_str!("../migrations/013_access_code_lifecycle.sql"),
        ),
        migration(
            14,
            "agent runtime",
            include_str!("../migrations/014_agent_runtime.sql"),
        ),
        migration(
            15,
            "intent authorization",
            include_str!("../migrations/015_intent_authorization.sql"),
        ),
        migration(
            16,
            "admin code grants",
            include_str!("../migrations/016_admin_code_grants.sql"),
        ),
        migration(
            17,
            "free plan onboarding",
            include_str!("../migrations/017_free_plan_onboarding.sql"),
        ),
        migration(
            18,
            "classroom roles",
            include_str!("../migrations/018_classroom_roles.sql"),
        ),
        migration(
            19,
            "invite idempotency",
            include_str!("../migrations/019_invite_idempotency.sql"),
        ),
        migration(
            20,
            "live classroom room flow",
            include_str!("../migrations/020_live_classroom_room_flow.sql"),
        ),
        migration(
            21,
            "organization managed access",
            include_str!("../migrations/021_organization_managed_access.sql"),
        ),
        migration(
            22,
            "organization profile settings",
            include_str!("../migrations/022_organization_profile_settings.sql"),
        ),
        migration(
            23,
            "user knowledge spaces access",
            include_str!("../migrations/023_user_knowledge_spaces_access.sql"),
        ),
        migration(
            24,
            "companion image generation",
            include_str!("../migrations/024_companion_image_generation.sql"),
        ),
        migration(
            25,
            "canonical agent runtime contract v3",
            include_str!("../migrations/025_agent_runtime_contract_v3.sql"),
        ),
        migration(
            26,
            "organization home banners",
            include_str!("../migrations/026_organization_home_banners.sql"),
        ),
        migration(
            27,
            "verified MCP connectors",
            include_str!("../migrations/027_mcp_connectors.sql"),
        ),
    ]),
    ..Migrator::DEFAULT
});

fn migration(version: i64, description: &'static str, sql: &'static str) -> Migration {
    Migration::new(
        version,
        Cow::Borrowed(description),
        MigrationType::Simple,
        Cow::Borrowed(sql),
        false,
    )
}

pub async fn connect(config: &Config) -> Result<PgPool, ApiError> {
    let pool = PgPoolOptions::new()
        .max_connections(config.database_pool_max)
        .acquire_timeout(Duration::from_secs(15))
        .connect(&config.database_url)
        .await?;
    Ok(pool)
}

pub async fn migrate(pool: &PgPool) -> Result<(), ApiError> {
    MIGRATOR.run(pool).await.map_err(ApiError::internal)
}

pub async fn ready(pool: &PgPool) -> bool {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await
        .is_ok()
}
