use std::{collections::BTreeSet, time::Duration};

use serde_json::{Value, json};
use trocode_api::{
    agent::{
        AgentOrchestrator, AgentService, OrchestratorWorkerRegistration, orchestrator_protocol,
        protocol,
    },
    auth::AgentStateCrypto,
    config::{AgentRuntimeConfig, CostGuardMode},
    db,
    postgres::PgPoolOptions,
    query, query_scalar,
};
use url::Url;
use uuid::Uuid;

const USER: &str = "durable-agent-user";
const GRAPH_VERSION: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const INCOMPATIBLE_PROTOCOL_DIGEST: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

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

async fn setup() -> (trocode_api::PgPool, AgentService, AgentOrchestrator, Uuid) {
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
    let incompatible = orchestrator
        .register_worker(&OrchestratorWorkerRegistration {
            graph_version: GRAPH_VERSION,
            instance_id: Uuid::new_v4(),
            protocol_digest: orchestrator_protocol::protocol_digest(),
            protocol_version: 1,
            public_protocol_digest: INCOMPATIBLE_PROTOCOL_DIGEST,
            release_version: "integration-test",
            sdk_version: "0.17.0",
        })
        .await
        .expect_err("SDK worker built for an older public protocol must upgrade");
    assert_eq!(incompatible.code, Some("graph_version_mismatch"));
    let (sdk_worker, _) = orchestrator
        .register_worker(&OrchestratorWorkerRegistration {
            graph_version: GRAPH_VERSION,
            instance_id: Uuid::new_v4(),
            protocol_digest: orchestrator_protocol::protocol_digest(),
            protocol_version: 1,
            public_protocol_digest: protocol::v5::protocol_digest(),
            release_version: "integration-test",
            sdk_version: "0.17.0",
        })
        .await
        .expect("register compatible SDK worker");
    (pool, agent, orchestrator, sdk_worker)
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
        "maxResultBytes":48_000_000,
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
    let (pool, agent, orchestrator, sdk_worker) = setup().await;
    assert!(agent.enabled_for(USER));
    assert!(!agent.enabled_for("not-in-canary"));

    query("UPDATE agent_orchestrator_workers SET public_protocol_digest=$2 WHERE id=$1")
        .bind(sdk_worker)
        .bind("0".repeat(64))
        .execute(&pool)
        .await
        .expect("simulate an SDK worker from the previous public protocol");
    let unavailable = agent
        .submit_v5(
            USER,
            "basic",
            &task_input(
                "This task must not bind to an old SDK graph.",
                Uuid::new_v4(),
                Uuid::new_v4(),
            ),
        )
        .await
        .expect_err("new tasks must ignore SDK workers on an old public digest");
    assert_eq!(unavailable.code, Some("orchestrator_unavailable"));
    query("UPDATE agent_orchestrator_workers SET public_protocol_digest=$2 WHERE id=$1")
        .bind(sdk_worker)
        .bind(protocol::v5::protocol_digest())
        .execute(&pool)
        .await
        .expect("restore compatible SDK worker");

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
    let mut legacy_capabilities = capabilities();
    legacy_capabilities
        .as_object_mut()
        .expect("capabilities object")
        .remove("maxResultBytes");
    legacy_capabilities["protocolDigest"] = Value::String("0".repeat(64));
    let legacy_error = agent
        .connect_worker(USER, device, &legacy_capabilities)
        .await
        .expect_err("desktop workers without the versioned result bound must upgrade");
    assert_eq!(legacy_error.code, Some("tool_catalog_upgrade_required"));

    let worker = agent
        .connect_worker(USER, device, &capabilities())
        .await
        .expect("connect protocol-v5 desktop worker");
    assert_eq!(worker["protocolVersion"], 5);

    let run_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    assert!(
        agent
            .cancel(USER, run_id)
            .await
            .expect("legacy cancellation path must not mutate v5 runs")
            .is_none()
    );
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

    let clarification = agent
        .submit_v5(
            USER,
            "basic",
            &task_input("Ask which window I mean.", Uuid::new_v4(), Uuid::new_v4()),
        )
        .await
        .expect("submit clarification task");
    let clarification_run: Uuid = clarification["id"].as_str().unwrap().parse().unwrap();
    let claim = orchestrator
        .claim(sdk_worker, "0.17.0", GRAPH_VERSION)
        .await
        .expect("claim clarification task")
        .expect("clarification task is claimable");
    assert_eq!(claim.run_id, clarification_run);
    let desktop_worker: Uuid = worker["id"].as_str().unwrap().parse().unwrap();
    let invocation_id = Uuid::new_v4();
    query(
        "INSERT INTO agent_tool_invocations(
           id,run_id,call_id,tool_id,operation,state,idempotency_key,
           worker_session_id,public_summary,expires_at
         ) VALUES($1,$2,'clarification-call','task.interaction','clarify','delivered',
           'clarification-idempotency',$3,'Waiting for the user.',NOW()+INTERVAL'5 minutes')",
    )
    .bind(invocation_id)
    .bind(clarification_run)
    .bind(desktop_worker)
    .execute(&pool)
    .await
    .expect("seed delivered clarification");
    agent
        .begin_execution(
            USER,
            desktop_worker,
            &json!({
                "invocationId":invocation_id,
                "expectedRunVersion":claim.run_version
            }),
        )
        .await
        .expect("begin clarification wait");
    let clarification_cancelled = agent
        .cancel_versioned(
            USER,
            clarification_run,
            &json!({
                "clientCommandId":Uuid::new_v4(),
                "expectedRunVersion":claim.run_version,
                "source":"stop_button"
            }),
        )
        .await
        .expect("cancel clarification wait")
        .expect("clarification task exists");
    assert_eq!(clarification_cancelled["projection"]["state"], "cancelled");
    let invocation_state: String =
        query_scalar("SELECT state FROM agent_tool_invocations WHERE id=$1")
            .bind(invocation_id)
            .fetch_one(&pool)
            .await
            .expect("read cancelled clarification");
    assert_eq!(invocation_state, "cancelled");

    query("UPDATE agent_worker_sessions SET protocol_digest=$2 WHERE id=$1")
        .bind(desktop_worker)
        .bind("0".repeat(64))
        .execute(&pool)
        .await
        .expect("simulate a worker session from the previous protocol digest");
    assert!(
        agent
            .heartbeat(USER, desktop_worker)
            .await
            .expect("reject incompatible heartbeat")
            .is_none()
    );
    agent
        .maintain()
        .await
        .expect("disconnect incompatible worker session");
    let disconnected: bool =
        query_scalar("SELECT disconnected_at IS NOT NULL FROM agent_worker_sessions WHERE id=$1")
            .bind(desktop_worker)
            .fetch_one(&pool)
            .await
            .expect("read disconnected worker session");
    assert!(disconnected);
    pool.close().await;
}
