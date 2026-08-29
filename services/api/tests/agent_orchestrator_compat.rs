use std::{collections::BTreeSet, time::Duration};

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use trocode_api::{
    agent::{
        AgentOrchestrator, AgentService, PutCheckpoint, QueueToolCall, SessionTransaction,
        orchestrator_protocol, protocol,
    },
    auth::{AgentStateCrypto, stable_json},
    config::{AgentRuntimeConfig, CostGuardMode},
    db,
    postgres::PgPoolOptions,
    query, query_scalar,
};
use url::Url;
use uuid::Uuid;

const USER: &str = "sdk-orchestrator-user";
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

async fn setup() -> (
    trocode_api::PgPool,
    AgentService,
    AgentOrchestrator,
    Uuid,
    Uuid,
) {
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
    query("INSERT INTO users(id,email,name,plan)VALUES($1,'sdk@example.test','SDK','basic')")
        .bind(USER)
        .execute(&pool)
        .await
        .expect("seed user");
    let crypto = AgentStateCrypto::parse("1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1)
        .expect("parse integration key");
    let config = runtime_config();
    let service = AgentService::new(
        pool.clone(),
        crypto.clone(),
        config.clone(),
        "durable_agent_hmac_key_0123456789abcdef",
        CostGuardMode::Enforce,
    );
    let orchestrator = AgentOrchestrator::new(pool.clone(), crypto, config, None);
    let (orchestrator_worker, _) = orchestrator
        .register_worker(
            Uuid::new_v4(),
            1,
            orchestrator_protocol::protocol_digest(),
            "integration-test",
            "0.17.0",
            GRAPH_VERSION,
        )
        .await
        .expect("register SDK worker");
    let device = Uuid::new_v4();
    query(
        "INSERT INTO device_sessions(id,user_id,token_digest,expires_at)
         VALUES($1,$2,$3,NOW()+INTERVAL'1 hour')",
    )
    .bind(device)
    .bind(USER)
    .bind(device.as_bytes().to_vec())
    .execute(&pool)
    .await
    .expect("seed device");
    let desktop = service
        .connect_worker(USER, device, &desktop_capabilities())
        .await
        .expect("connect desktop worker");
    (
        pool,
        service,
        orchestrator,
        orchestrator_worker,
        desktop["id"].as_str().unwrap().parse().unwrap(),
    )
}

fn desktop_capabilities() -> Value {
    json!({
        "protocolVersion":5,
        "protocolDigest":protocol::v5::protocol_digest(),
        "toolCatalogDigest":protocol::v5::tool_catalog_digest(),
        "cua":null,
        "tools":[{"operations":["launch"],"toolId":"application.launch"}]
    })
}

fn task_input() -> Value {
    json!({
        "clientTaskId":Uuid::new_v4(),
        "executionProfile":"everyday",
        "request":"Open Chrome.",
        "taskId":Uuid::new_v4(),
        "workspaceSelectionId":null,
        "activityAttemptId":null,
        "activityIntent":"work",
        "protocolVersion":5,
        "protocolDigest":protocol::v5::protocol_digest(),
        "toolCatalogDigest":protocol::v5::tool_catalog_digest()
    })
}

fn digest(value: &Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(stable_json(value).expect("stable JSON").as_bytes())
    )
}

fn launch_call(call_id: &str) -> QueueToolCall {
    let arguments = json!({"application":"chrome","reason":"The user asked to open Chrome."});
    let value = json!({
        "arguments":arguments,
        "callId":call_id,
        "catalogDigest":protocol::v5::tool_catalog_digest(),
        "driverCatalogDigest":Value::Null,
        "graphVersion":GRAPH_VERSION,
        "operation":"launch",
        "sdkVersion":"0.17.0",
        "toolId":"application.launch"
    });
    QueueToolCall {
        arguments,
        call_id: call_id.to_owned(),
        catalog_digest: protocol::v5::tool_catalog_digest().to_owned(),
        driver_catalog_digest: None,
        graph_version: GRAPH_VERSION.to_owned(),
        idempotency_digest: digest(&value),
        operation: "launch".to_owned(),
        sdk_version: "0.17.0".to_owned(),
        tool_id: "application.launch".to_owned(),
    }
}

fn workspace_call(call_id: &str) -> QueueToolCall {
    let arguments = json!({"content":Value::Null,"path":"README.md"});
    let value = json!({
        "arguments":arguments,
        "callId":call_id,
        "catalogDigest":protocol::v5::tool_catalog_digest(),
        "driverCatalogDigest":Value::Null,
        "graphVersion":GRAPH_VERSION,
        "operation":"read_file",
        "sdkVersion":"0.17.0",
        "toolId":"workspace.filesystem"
    });
    QueueToolCall {
        arguments,
        call_id: call_id.to_owned(),
        catalog_digest: protocol::v5::tool_catalog_digest().to_owned(),
        driver_catalog_digest: None,
        graph_version: GRAPH_VERSION.to_owned(),
        idempotency_digest: digest(&value),
        operation: "read_file".to_owned(),
        sdk_version: "0.17.0".to_owned(),
        tool_id: "workspace.filesystem".to_owned(),
    }
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn sdk_checkpoint_session_steering_and_tool_dispatch_are_durable() {
    let (pool, service, orchestrator, sdk_worker, desktop_worker) = setup().await;
    let created = service
        .submit_v5(USER, "basic", &task_input())
        .await
        .expect("submit v5 task");
    let run_id: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let claim = orchestrator
        .claim(sdk_worker, "0.17.0", GRAPH_VERSION)
        .await
        .expect("claim request")
        .expect("claim run");
    assert_eq!(claim.run_id, run_id);
    assert!(
        claim
            .tools
            .iter()
            .any(|tool| tool["toolId"] == "application.launch")
    );
    assert!(
        orchestrator
            .queue_tool_call(
                run_id,
                sdk_worker,
                claim.run_version,
                &workspace_call("forbidden-workspace-call"),
            )
            .await
            .is_err(),
        "the broker must reject a tool that was not offered for this run"
    );

    let model_body = json!({
        "input":"Open Chrome.",
        "model":"gpt-5.6-sol",
        "store":false
    });
    let dispatch = orchestrator
        .begin_model_request(run_id, sdk_worker, Uuid::new_v4(), &model_body, false)
        .await
        .expect("reserve first model dispatch");
    orchestrator
        .complete_model_request(run_id, &dispatch.request_digest)
        .await
        .expect("commit model dispatch outcome");
    assert!(
        orchestrator
            .begin_model_request(run_id, sdk_worker, Uuid::new_v4(), &model_body, false,)
            .await
            .is_err(),
        "an identical model step must block rather than repeat after a worker crash"
    );
    let dispatch_state: String = query_scalar(
        "SELECT state FROM agent_model_dispatches WHERE run_id=$1 AND request_digest=$2",
    )
    .bind(run_id)
    .bind(&dispatch.request_digest)
    .fetch_one(&pool)
    .await
    .expect("read model dispatch ledger");
    assert_eq!(dispatch_state, "completed");

    let transaction = SessionTransaction::AppendItems {
        items: vec![json!({"role":"user","content":"Open Chrome."})],
    };
    let transaction_value = serde_json::to_value(&transaction).unwrap();
    let applied = orchestrator
        .apply_session_transaction(
            run_id,
            sdk_worker,
            claim.run_version,
            0,
            "sdk-session-1",
            &digest(&transaction_value),
            &transaction,
        )
        .await
        .expect("append SDK Session item");
    assert_eq!(applied.revision, 1);

    let steering_turn_id = Uuid::new_v4();
    let steering_event = service
        .control(
            USER,
            run_id,
            "steering",
            &json!({"clientTurnId":steering_turn_id,"instruction":"Use the existing window."}),
        )
        .await
        .expect("queue steering")
        .expect("run exists");
    let replayed_steering_event = service
        .control(
            USER,
            run_id,
            "steering",
            &json!({"clientTurnId":steering_turn_id,"instruction":"Use the existing window."}),
        )
        .await
        .expect("replay steering")
        .expect("run exists");
    assert_eq!(replayed_steering_event["id"], steering_event["id"]);
    assert_eq!(
        replayed_steering_event["sequence"],
        steering_event["sequence"]
    );
    assert!(
        service
            .control(
                USER,
                run_id,
                "steering",
                &json!({"clientTurnId":steering_turn_id,"instruction":"Different content."}),
            )
            .await
            .is_err(),
        "an idempotency key cannot be reused with different steering content"
    );
    let steering = orchestrator
        .steering_updates(run_id, sdk_worker, claim.run_version, 0)
        .await
        .expect("load steering");
    assert_eq!(steering.len(), 1);
    assert_eq!(steering[0].instruction, "Use the existing window.");
    assert_eq!(steering[0].sequence, steering_event["sequence"]);

    let checkpoint = PutCheckpoint {
        applied_control_sequence: steering[0].sequence,
        expected_checkpoint_revision: 0,
        graph_version: GRAPH_VERSION.to_owned(),
        pending_call_id: Some("call-open-chrome".to_owned()),
        sdk_version: "0.17.0".to_owned(),
        state: "serialized-sdk-run-state".to_owned(),
    };
    let (revision, _) = orchestrator
        .put_checkpoint(run_id, sdk_worker, claim.run_version, &checkpoint)
        .await
        .expect("checkpoint SDK state");
    assert_eq!(revision, 1);

    let call = launch_call("call-open-chrome");
    let queued = orchestrator
        .queue_tool_call(run_id, sdk_worker, claim.run_version, &call)
        .await
        .expect("queue durable tool call");
    let replay = orchestrator
        .queue_tool_call(run_id, sdk_worker, queued.run_version, &call)
        .await
        .expect("replay same call ID");
    assert!(replay.replayed);
    assert_eq!(replay.invocation_id, queued.invocation_id);

    let pending = service
        .pending(USER, desktop_worker)
        .await
        .expect("load desktop work");
    assert_eq!(pending.len(), 1);
    service
        .begin_execution(
            USER,
            desktop_worker,
            &json!({
                "invocationId":pending[0]["invocationId"],
                "expectedRunVersion":pending[0]["runVersion"]
            }),
        )
        .await
        .expect("own execution");
    service
        .record_result(
            USER,
            desktop_worker,
            &json!({
                "invocationId":pending[0]["invocationId"],
                "status":"confirmed",
                "summary":"Chrome opened.",
                "data":{"application":"chrome"}
            }),
        )
        .await
        .expect("commit desktop result");
    let result = orchestrator
        .tool_call_result(run_id, "call-open-chrome", sdk_worker)
        .await
        .expect("read durable result");
    assert_eq!(result.status, "confirmed");
    orchestrator
        .complete(run_id, sdk_worker, queued.run_version, "Chrome was opened.")
        .await
        .expect("complete through control plane");
    assert_eq!(
        service.get_v5(USER, run_id).await.unwrap().unwrap()["projection"]["state"],
        "completed"
    );
    pool.close().await;
}
