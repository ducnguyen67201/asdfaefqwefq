use std::{process::Command, time::Duration};

use trocode_api::{Row as _, db, postgres::PgPoolOptions, query, query_scalar};
use url::Url;

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
    query("DROP SCHEMA public CASCADE")
        .execute(pool)
        .await
        .expect("drop disposable schema");
    query("CREATE SCHEMA public")
        .execute(pool)
        .await
        .expect("create disposable schema");
}

fn run_node_migrations(database_url: &str) {
    let script = r#"
      import pg from 'pg';
      import { runMigrations } from './src/migrate.mjs';
      const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
      try { await runMigrations(pool); } finally { await pool.end(); }
    "#;
    let status = Command::new("node")
        .args(["--input-type=module", "--eval", script])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .env("TEST_DATABASE_URL", database_url)
        .status()
        .expect("run JavaScript migration oracle");
    assert!(status.success(), "JavaScript migrations failed");
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn rust_migrations_are_idempotent_on_an_empty_database() {
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
    assert_eq!(sqlx_count, 18);
    assert_eq!(table_count, 40, "39 domain tables plus SQLx bookkeeping");
}

#[tokio::test]
#[ignore = "requires Node dependencies and a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn rust_migrations_preserve_a_node_initialized_database() {
    let database_url = disposable_database_url();
    let pool = open_pool(&database_url).await;
    reset(&pool).await;
    pool.close().await;

    run_node_migrations(&database_url);

    let pool = open_pool(&database_url).await;
    query("INSERT INTO users(id,email,name)VALUES('compat-user','compat@example.test','Compat')")
        .execute(&pool)
        .await
        .expect("seed Node-created domain row");
    let node_table_count: i64 = query_scalar(
        "SELECT COUNT(*)::bigint FROM information_schema.tables WHERE table_schema='public'",
    )
    .fetch_one(&pool)
    .await
    .expect("Node-created domain table count");
    assert_eq!(node_table_count, 39);

    db::migrate(&pool)
        .await
        .expect("Rust migration over Node schema");
    db::migrate(&pool).await.expect("Rust second-start no-op");

    let row = query("SELECT email,name FROM users WHERE id='compat-user'")
        .fetch_one(&pool)
        .await
        .expect("preserved user");
    assert_eq!(row.get::<String, _>("email"), "compat@example.test");
    assert_eq!(row.get::<String, _>("name"), "Compat");
    let sqlx_count: i64 = query_scalar("SELECT COUNT(*)::bigint FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .expect("SQLx bookkeeping count");
    assert_eq!(sqlx_count, 18);
}
