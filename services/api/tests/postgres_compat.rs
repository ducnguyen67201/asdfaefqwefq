use std::{sync::LazyLock, time::Duration};

use sqlx_core::raw_sql::raw_sql;
use trocode_api::{Row as _, db, postgres::PgPoolOptions, query, query_scalar};
use url::Url;

static DATABASE_TEST_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

fn disposable_database_url() -> String {
    let value = std::env::var("TEST_DATABASE_URL")
        .expect("TEST_DATABASE_URL is required for this ignored integration test");
    let parsed = Url::parse(&value).expect("TEST_DATABASE_URL must be a URL");
    let local = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"));
    let test_database = parsed.path().trim_start_matches('/').ends_with("_test");
    assert!(
        local && test_database,
        "refusing to reset a database that is not local and suffixed _test"
    );
    value
}

async fn open_pool(database_url: &str) -> trocode_api::PgPool {
    PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
        .expect("connect to disposable PostgreSQL")
}

async fn reset(pool: &trocode_api::PgPool) {
    query("DROP SCHEMA IF EXISTS public CASCADE")
        .execute(pool)
        .await
        .expect("drop disposable schema");
    query("CREATE SCHEMA public")
        .execute(pool)
        .await
        .expect("create disposable schema");
}

async fn apply_legacy_schema(pool: &trocode_api::PgPool) {
    for migration in [
        include_str!("../migrations/001_hosted_sessions.sql"),
        include_str!("../migrations/002_access_codes.sql"),
        include_str!("../migrations/003_model_usage_budgets.sql"),
        include_str!("../migrations/004_audio_transcription_usage.sql"),
        include_str!("../migrations/005_usage_plans_and_rate_limits.sql"),
        include_str!("../migrations/006_agent_turns.sql"),
        include_str!("../migrations/007_free_usage_plan.sql"),
        include_str!("../migrations/008_knowledge_spaces.sql"),
        include_str!("../migrations/009_knowledge_sources.sql"),
        include_str!("../migrations/010_knowledge_activities.sql"),
        include_str!("../migrations/011_admin_access_controls.sql"),
        include_str!("../migrations/012_retrievable_access_codes.sql"),
        include_str!("../migrations/013_access_code_lifecycle.sql"),
        include_str!("../migrations/014_agent_runtime.sql"),
        include_str!("../migrations/015_intent_authorization.sql"),
        include_str!("../migrations/016_admin_code_grants.sql"),
        include_str!("../migrations/017_free_plan_onboarding.sql"),
        include_str!("../migrations/018_classroom_roles.sql"),
        include_str!("../migrations/019_invite_idempotency.sql"),
        include_str!("../migrations/020_live_classroom_room_flow.sql"),
    ] {
        raw_sql(migration)
            .execute(pool)
            .await
            .expect("apply legacy idempotent migration");
    }
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn rust_migrations_are_idempotent_on_an_empty_database() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = disposable_database_url();
    let pool = open_pool(&database_url).await;
    reset(&pool).await;

    db::migrate(&pool).await.expect("first Rust migration run");
    db::migrate(&pool).await.expect("second Rust migration run");

    let sqlx_count: i64 = query_scalar("SELECT COUNT(*)::bigint FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .expect("SQLx migration count");
    let table_count: i64 = query_scalar(
        "SELECT COUNT(*)::bigint FROM information_schema.tables WHERE table_schema='public'",
    )
    .fetch_one(&pool)
    .await
    .expect("domain table count");
    assert_eq!(sqlx_count, 32);
    assert_eq!(table_count, 59, "58 domain tables plus SQLx bookkeeping");
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn rust_migrations_adopt_a_legacy_initialized_database() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = disposable_database_url();
    let pool = open_pool(&database_url).await;
    reset(&pool).await;
    apply_legacy_schema(&pool).await;
    query("INSERT INTO users(id,email,name)VALUES('compat-user','compat@example.test','Compat')")
        .execute(&pool)
        .await
        .expect("seed existing domain row");
    let domain_table_count: i64 = query_scalar(
        "SELECT COUNT(*)::bigint FROM information_schema.tables WHERE table_schema='public'",
    )
    .fetch_one(&pool)
    .await
    .expect("domain table count");
    assert_eq!(domain_table_count, 45);

    db::migrate(&pool).await.expect("Rust adoption migration");
    db::migrate(&pool).await.expect("Rust second-start no-op");

    let row = query("SELECT email,name,knowledge_spaces_enabled FROM users WHERE id='compat-user'")
        .fetch_one(&pool)
        .await
        .expect("preserved existing user");
    assert_eq!(row.get::<String, _>("email"), "compat@example.test");
    assert_eq!(row.get::<String, _>("name"), "Compat");
    assert!(row.get::<bool, _>("knowledge_spaces_enabled"));
    let sqlx_count: i64 = query_scalar("SELECT COUNT(*)::bigint FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .expect("SQLx bookkeeping count");
    assert_eq!(sqlx_count, 32);
}
