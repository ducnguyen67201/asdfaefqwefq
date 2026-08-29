use std::{collections::BTreeSet, time::Duration};

use serde_json::{Value, json};
use trocode_api::{
    agent::{AgentOrchestrator, AgentService, orchestrator_protocol, protocol},
    auth::AgentStateCrypto,
    config::{AgentRuntimeConfig, CostGuardMode},
    db,
    postgres::PgPoolOptions,
    query,
};
use url::Url;
use uuid::Uuid;

const USER: &str = "durable-agent-user";
const GRAPH_VERSION: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn disposable_database_url() -> String {
    let value = std::env::var("TEST_DATABASE_URL")
        .expect("TEST_DATABASE_URL is required for this ignored integration test");
    let parsed = Url::parse(&value).expect("TEST_DATABASE_URL must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"))
            && parsed.path().trim_start_matches('/').ends_with("_test"),
        "refusing to reset a database that is not local and suffixed _test"
    );
    value
}

fn runtime_config() -> AgentRuntimeConfig {
    AgentRuntimeConfig {
        canary_users: BTreeSet::from([USER.to_owned()]),
        current_encryption_key_version: 1,
        enabled: true,
        encryption_keys: Some("1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".to_owned()),
        heartbeat_ttl_ms: 35_000,
        lease_ms: 30_000,
        max_active_runs_per_user: 10,
        max_queue_depth: 1_000,
        orchestrator_model: "gpt-5.6-sol".to_owned(),
        orchestrator_sdk_version: "0.17.0".to_owned(),
        orchestrator_service_token: Some("o".repeat(32)),
        payload_ttl_ms: 7 * 24 * 60 * 60 * 1_000,
        protocol_version: 5,
        rollout_percent: 0,
    }
}

async fn setup() -> (trocode_api::PgPool, AgentService, AgentOrchestrator) {
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&disposable_database_url())
        .await
        .expect("connect to disposable PostgreSQL");
    query("DROP SCHEMA public CASCADE")
        .execute(&pool)
        .await
        .expect("drop disposable schema");
    query("CREATE SCHEMA public")
        .execute(&pool)
        .await
        .expect("create disposable schema");
    db::migrate(&pool).await.expect("migrate disposable schema");
    query("INSERT INTO users(id,email,name,plan)VALUES($1,'agent@example.test','Agent','basic')")
        .bind(USER)
        .execute(&pool)
        .await
        .expect("seed agent user");
    let crypto = AgentStateCrypto::parse("1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1)
        .expect("parse integration encryption key");
    let config = runtime_config();
    let agent = AgentService::new(
        pool.clone(),
        crypto.clone(),
        config.clone(),
        "durable_agent_hmac_key_0123456789abcdef",
        CostGuardMode::Enforce,
    );
    let orchestrator = AgentOrchestrator::new(pool.clone(), crypto, config, None);
    orchestrator
        .register_worker(
            Uuid::new_v4(),
            1,
            orchestrator_protocol::protocol_digest(),
            "integration-test",
            "0.17.0",
            GRAPH_VERSION,
        )
        .await
        .expect("register compatible SDK worker");
    (pool, agent, orchestrator)
}

fn task_input(request: &str, client: Uuid, task: Uuid) -> Value {
    json!({
        "clientTaskId":client,
        "executionProfile":"everyday",
        "request":request,
        "taskId":task,
        "workspaceSelectionId":null,
        "activityAttemptId":null,
        "activityIntent":"work",
        "protocolVersion":5,
        "protocolDigest":protocol::v5::protocol_digest(),
        "toolCatalogDigest":protocol::v5::tool_catalog_digest()
    })
}

fn capabilities() -> Value {
    json!({
        "protocolVersion":5,
        "protocolDigest":protocol::v5::protocol_digest(),
        "toolCatalogDigest":protocol::v5::tool_catalog_digest(),
        "cua":null,
        "tools":[
            {"operations":["launch"],"toolId":"application.launch"},
            {"operations":["read_file","write_file"],"toolId":"workspace.filesystem"}
        ]
    })
}

async fn seed_device(pool: &trocode_api::PgPool) -> Uuid {
    let id = Uuid::new_v4();
    query(
        "INSERT INTO device_sessions(id,user_id,token_digest,expires_at)
         VALUES($1,$2,$3,NOW()+INTERVAL'1 hour')",
    )
    .bind(id)
    .bind(USER)
    .bind(id.as_bytes().to_vec())
    .execute(pool)
    .await
    .expect("seed desktop device session");
    id
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn v5_is_the_only_start_path_and_remains_idempotent_and_cancellable() {
    let (pool, agent, _orchestrator) = setup().await;
    assert!(agent.enabled_for(USER));
    assert!(!agent.enabled_for("not-in-canary"));

    let client = Uuid::new_v4();
    let task = Uuid::new_v4();
    let created = agent
        .submit_v5(USER, "basic", &task_input("Open YouTube.", client, task))
        .await
        .expect("submit v5 task");
    assert_eq!(created["protocolVersion"].as_f64(), Some(5.0));
    assert_eq!(
        created["authorityContract"]["schemaVersion"].as_f64(),
        Some(10.0)
    );
    assert_eq!(
        created["authorityContract"]["runtimeKind"],
        "openai_agents_sdk"
    );
    assert!(created.get("outcomeContract").is_none());
    assert_eq!(created["projection"]["state"], "awaiting_orchestrator");

    let duplicate = agent
        .submit_v5(
            USER,
            "basic",
            &task_input("A retry cannot replace the intent.", client, task),
        )
        .await
        .expect("idempotent v5 retry");
    assert_eq!(duplicate["newlyCreated"], false);
    assert_eq!(duplicate["request"], "Open YouTube.");

    let conflict = agent
        .submit_v5(
            USER,
            "basic",
            &task_input("Open YouTube.", client, Uuid::new_v4()),
        )
        .await
        .expect_err("client task reuse across tasks must conflict");
    assert_eq!(conflict.code, Some("agent_run_conflict"));

    let device = seed_device(&pool).await;
    let worker = agent
        .connect_worker(USER, device, &capabilities())
        .await
        .expect("connect protocol-v5 desktop worker");
    assert_eq!(worker["protocolVersion"], 5);

    let run_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let cancelled = agent
        .cancel_versioned(
            USER,
            run_id,
            &json!({
                "clientCommandId":Uuid::new_v4(),
                "expectedRunVersion":created["projection"]["runVersion"],
                "source":"stop_button"
            }),
        )
        .await
        .expect("cancel v5 task")
        .expect("task exists");
    assert_eq!(cancelled["projection"]["state"], "cancelled");
    assert!(agent.get_v5(USER, run_id).await.unwrap().is_some());
    assert!(agent.get_v4(USER, run_id).await.unwrap().is_none());
    pool.close().await;
}
