use std::{
    collections::BTreeSet,
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

use serde_json::{Value, json};
use trocode_api::{
    agent::{AgentService, TOOL_SCHEMA_DIGEST},
    auth::AgentStateCrypto,
    config::{
        AgentRuntimeConfig, AgentRuntimeV3Mode, CostGuardConfig, CostGuardMode, RolloutConfig,
    },
    db,
    postgres::PgPoolOptions,
    providers::ResponsesService,
    query, query_scalar,
    usage::BudgetService,
};
use url::Url;
use uuid::Uuid;
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate, matchers::path};

const USER: &str = "durable-agent-user";

#[derive(Default)]
struct AgentResponder {
    calls: AtomicUsize,
}

impl Respond for AgentResponder {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        self.calls.fetch_add(1, Ordering::Relaxed);
        let body: Value =
            serde_json::from_slice(&request.body).expect("agent provider request JSON");
        let input = body["input"].as_array().cloned().unwrap_or_default();
        let continuing = input
            .iter()
            .any(|item| item.get("type").and_then(Value::as_str) == Some("function_call_output"));
        let input_text = serde_json::to_string(&input).unwrap_or_default();
        let output = if input_text.contains("malformed provider") {
            json!([])
        } else if continuing {
            json!([{
                "content":[{"text":"The durable agent finished with verified evidence.","type":"output_text"}],
                "role":"assistant",
                "type":"message"
            }])
        } else if input_text.contains("consequential") {
            json!([{
                "arguments":serde_json::to_string(&json!({
                    "content":"changed",
                    "path":"fixture.txt"
                })).unwrap(),
                "call_id":format!("call-{}", self.calls.load(Ordering::Relaxed)),
                "name":"workspace_filesystem",
                "type":"function_call"
            }])
        } else {
            json!([{
                "arguments":serde_json::to_string(&json!({
                    "application":"chrome",
                    "reason":"Open Chrome for the requested task."
                })).unwrap(),
                "call_id":format!("call-{}", self.calls.load(Ordering::Relaxed)),
                "name":"open_application",
                "type":"function_call"
            }])
        };
        ResponseTemplate::new(200)
            .insert_header("content-type", "application/json")
            .set_body_json(json!({
                "id":format!("resp_{}", self.calls.load(Ordering::Relaxed)),
                "model":"gpt-5.6-terra",
                "output":output,
                "usage":{
                    "input_tokens":400,
                    "input_tokens_details":{"cached_tokens":0},
                    "output_tokens":80,
                    "output_tokens_details":{"reasoning_tokens":10}
                }
            }))
    }
}

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

fn cost_guard() -> CostGuardConfig {
    CostGuardConfig {
        daily_micro_usd: 8_000_000,
        enabled: true,
        mode: CostGuardMode::Enforce,
        monthly_micro_usd: 45_000_000,
        realtime_call_micro_usd: 5_000,
        reservation_ttl_ms: 120_000,
        speech_micro_usd_per_thousand_characters: 60_000,
        task_micro_usd: 5_000_000,
        transcription_micro_usd_per_minute: 6_000,
        warning_percent: 80,
    }
}

fn runtime_config() -> AgentRuntimeConfig {
    AgentRuntimeConfig {
        canary_users: BTreeSet::from([USER.to_owned()]),
        compaction_item_threshold: 80,
        current_encryption_key_version: 1,
        enabled: true,
        encryption_keys: Some("1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".to_owned()),
        heartbeat_ttl_ms: 35_000,
        intent_authorization: RolloutConfig {
            canary_users: BTreeSet::new(),
            enabled: false,
            rollout_percent: 0,
        },
        lease_ms: 30_000,
        max_active_runs_per_user: 10,
        max_queue_depth: 1_000,
        payload_ttl_ms: 7 * 24 * 60 * 60 * 1_000,
        playwright_cdp_enabled: false,
        protocol_version: 2,
        rollout_percent: 0,
        v3_mode: AgentRuntimeV3Mode::Observe,
    }
}

async fn setup(server: &MockServer) -> (trocode_api::PgPool, AgentService) {
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
    let budget = BudgetService::new(pool.clone(), cost_guard());
    let responses = ResponsesService::new_with_endpoint(
        budget,
        reqwest::Client::new(),
        "test-key",
        &format!("{}/v1/responses", server.uri()),
    );
    let crypto = AgentStateCrypto::parse("1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", 1)
        .expect("parse integration encryption key");
    let models = BTreeSet::from(["gpt-5.6-luna".to_owned(), "gpt-5.6-terra".to_owned()]);
    let agent = AgentService::new(
        pool.clone(),
        crypto,
        responses,
        runtime_config(),
        "durable_agent_hmac_key_0123456789abcdef",
        &models,
        CostGuardMode::Enforce,
    );
    (pool, agent)
}

fn task_input(request: &str, client: Uuid, task: Uuid) -> Value {
    json!({
        "autonomyMode":"balanced",
        "clientTaskId":client,
        "executionProfile":"everyday",
        "request":request,
        "taskId":task
    })
}

fn capabilities() -> Value {
    json!({
        "protocolVersion":2,
        "schemaDigest":TOOL_SCHEMA_DIGEST.as_str(),
        "tools":[
            {"operations":["launch"],"toolId":"application.launch"},
            {"operations":["read_file","write_file"],"toolId":"workspace.filesystem"}
        ]
    })
}

fn execution_grant(invocation: &Value, exact_approval: bool) -> Value {
    json!({
        "approvalRequired":exact_approval,
        "authorizationSource":if exact_approval{"exact_approval"}else{"routine"},
        "consequential":exact_approval,
        "effect":invocation["effect"],
        "intentRevision":invocation["intentRevision"],
        "invocationId":invocation["invocationId"]
    })
}

async fn submit(agent: &AgentService, request: &str) -> (Uuid, Uuid, Uuid) {
    let client = Uuid::new_v4();
    let task = Uuid::new_v4();
    let value = agent
        .submit(USER, "basic", &task_input(request, client, task))
        .await
        .expect("submit durable task");
    (value["id"].as_str().unwrap().parse().unwrap(), client, task)
}

async fn seed_device(pool: &trocode_api::PgPool) -> Uuid {
    let id = Uuid::new_v4();
    query("INSERT INTO device_sessions(id,user_id,token_digest,expires_at)VALUES($1,$2,$3,NOW()+INTERVAL'1 hour')")
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
async fn durable_agent_completes_verified_work_and_blocks_unknown_effects() {
    let server = MockServer::start().await;
    Mock::given(path("/v1/responses"))
        .respond_with(AgentResponder::default())
        .mount(&server)
        .await;
    let (pool, agent) = setup(&server).await;
    assert!(agent.enabled_for(USER));
    assert!(!agent.enabled_for("not-in-canary"));
    assert!(!agent.has_active(USER).await.unwrap());

    let invalid = agent
        .submit(USER, "basic", &json!({"request":"missing fields"}))
        .await
        .expect_err("invalid task must fail");
    assert_eq!(invalid.code, Some("invalid_request"));

    let (run, client, task) = submit(&agent, "Open Chrome and confirm the visible surface.").await;
    assert!(agent.has_active(USER).await.unwrap());
    let duplicate = agent
        .submit(
            USER,
            "basic",
            &json!({
                "autonomyMode":"strict",
                "clientTaskId":client,
                "executionProfile":"everyday",
                "request":"A conflicting retry body must not replace the persisted request.",
                "taskId":task
            }),
        )
        .await
        .expect("idempotent task submission");
    assert_eq!(duplicate["newlyCreated"], false);
    assert_eq!(
        duplicate["request"],
        "Open Chrome and confirm the visible surface."
    );
    assert_eq!(duplicate["autonomyMode"], "balanced");
    let conflict = agent
        .submit(
            USER,
            "basic",
            &task_input(
                "Open Chrome and confirm the visible surface.",
                client,
                Uuid::new_v4(),
            ),
        )
        .await
        .expect_err("client task reuse across tasks must conflict");
    assert_eq!(conflict.code, Some("agent_run_conflict"));

    assert!(agent.run_once().await.expect("await worker"));
    assert_eq!(
        agent.get(USER, run).await.unwrap().unwrap()["state"],
        "awaiting_worker"
    );
    let device = seed_device(&pool).await;
    let worker = agent
        .connect_worker(USER, device, &capabilities())
        .await
        .expect("connect compatible worker");
    let worker: Uuid = worker["id"].as_str().unwrap().parse().unwrap();
    assert!(agent.heartbeat(USER, worker).await.unwrap().is_some());
    assert!(agent.run_once().await.expect("request desktop tool"));

    let pending = agent
        .pending(USER, worker)
        .await
        .expect("pending desktop work");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0]["toolId"], "application.launch");
    assert_eq!(pending[0]["consequential"], false);
    let grant = agent
        .grant_execution(USER, worker, &execution_grant(&pending[0], false))
        .await
        .expect("grant non-consequential execution");
    assert_eq!(grant["kind"], "granted");
    let committed = agent
        .record_result(
            USER,
            worker,
            &json!({
                "data":{"application":"chrome"},
                "evidence":[{
                    "criterionId":"chrome-surface-visible",
                    "source":"fresh_observation",
                    "status":"supports",
                    "summary":"A fresh trusted observation shows Chrome."
                },{
                    "criterionId":pending[0]["obligations"][0]["criterionId"],
                    "source":"tool_result",
                    "status":"supports",
                    "summary":"The trusted launch result satisfied the requested tool effect."
                }],
                "invocationId":pending[0]["invocationId"],
                "status":"confirmed",
                "summary":"Chrome launched and is visible."
            }),
        )
        .await
        .expect("record trusted desktop result");
    assert_eq!(committed["kind"], "committed");
    assert!(agent.run_once().await.expect("complete durable task"));
    let completed = agent.get(USER, run).await.unwrap().unwrap();
    assert_eq!(completed["state"], "completed");
    let events = agent.events(USER, run, 0).await.unwrap();
    assert!(events.iter().any(|event| {
        event["type"] == "run.completed"
            && event["finalOutput"] == "The durable agent finished with verified evidence."
    }));
    assert!(!agent.list(USER).await.unwrap().is_empty());

    let approval = agent
        .control(
            USER,
            run,
            "approval",
            &json!({
                "actionDigest":"0".repeat(64),
                "decision":"approve",
                "interactionId":Uuid::new_v4()
            }),
        )
        .await
        .expect("record approval event")
        .expect("existing run");
    assert_eq!(approval["type"], "run.approval_decided");

    let (unknown_run, _, _) = submit(
        &agent,
        "Perform a consequential workspace change and verify it.",
    )
    .await;
    assert!(agent.run_once().await.expect("request consequential tool"));
    let pending = agent.pending(USER, worker).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0]["toolId"], "workspace.filesystem");
    assert_eq!(pending[0]["consequential"], true);
    assert_eq!(
        agent
            .grant_execution(USER, worker, &execution_grant(&pending[0], true))
            .await
            .unwrap()["kind"],
        "granted"
    );
    assert_eq!(
        agent
            .record_result(
                USER,
                worker,
                &json!({
                    "invocationId":pending[0]["invocationId"],
                    "status":"unknown",
                    "summary":"The write outcome could not be confirmed."
                }),
            )
            .await
            .unwrap()["kind"],
        "committed"
    );
    assert_eq!(
        agent.get(USER, unknown_run).await.unwrap().unwrap()["state"],
        "blocked"
    );
    assert!(!agent.run_once().await.unwrap());

    let (disconnect_run, _, _) = submit(
        &agent,
        "Perform a consequential workspace disconnect scenario.",
    )
    .await;
    assert!(agent.run_once().await.unwrap());
    let pending = agent.pending(USER, worker).await.unwrap();
    agent
        .grant_execution(USER, worker, &execution_grant(&pending[0], true))
        .await
        .unwrap();
    let disconnected = agent.disconnect(USER, worker).await.unwrap();
    assert_eq!(disconnected["ambiguousInvocationCount"], 1);
    assert_eq!(
        agent.get(USER, disconnect_run).await.unwrap().unwrap()["state"],
        "blocked"
    );
    assert!(agent.heartbeat(USER, worker).await.unwrap().is_none());

    let worker = agent
        .connect_worker(USER, seed_device(&pool).await, &capabilities())
        .await
        .unwrap();
    let worker: Uuid = worker["id"].as_str().unwrap().parse().unwrap();
    let (malformed_run, _, _) =
        submit(&agent, "Handle a malformed provider response safely.").await;
    assert!(agent.run_once().await.unwrap());
    let malformed = agent.get(USER, malformed_run).await.unwrap().unwrap();
    assert_eq!(malformed["state"], "failed");
    assert_eq!(malformed["failureCode"], "internal_runtime_error");

    let (cancel_run, _, _) = submit(&agent, "Cancel this queued task.").await;
    let cancelled = agent.cancel(USER, cancel_run).await.unwrap().unwrap();
    assert_eq!(cancelled["state"], "cancelled");
    assert!(agent.cancel(USER, Uuid::new_v4()).await.unwrap().is_none());
    assert!(agent.get("someone-else", run).await.unwrap().is_none());
    assert!(
        agent
            .control(
                USER,
                Uuid::new_v4(),
                "steering",
                &json!({"clientTurnId":Uuid::new_v4(),"instruction":"safe"}),
            )
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        query_scalar::<_, i64>("SELECT COUNT(*)::bigint FROM model_usage_events")
            .fetch_one(&pool)
            .await
            .unwrap(),
        5
    );
    assert!(agent.heartbeat(USER, worker).await.unwrap().is_some());

    let (invocation_expiry_run, _, _) =
        submit(&agent, "Open Chrome before the desktop invocation expires.").await;
    assert!(agent.run_once().await.unwrap());
    let pending = agent.pending(USER, worker).await.unwrap();
    let invocation_id: Uuid = pending[0]["invocationId"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    query("UPDATE agent_tool_invocations SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1")
        .bind(invocation_id)
        .execute(&pool)
        .await
        .unwrap();
    agent.maintain().await.unwrap();
    assert_eq!(
        query_scalar::<_, String>("SELECT state FROM agent_tool_invocations WHERE id=$1")
            .bind(invocation_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "expired"
    );
    assert_eq!(
        agent
            .get(USER, invocation_expiry_run)
            .await
            .unwrap()
            .unwrap()["state"],
        "blocked"
    );

    let (stale_worker_run, _, _) = submit(
        &agent,
        "Perform a consequential workspace change before the worker expires.",
    )
    .await;
    assert!(agent.run_once().await.unwrap());
    let pending = agent.pending(USER, worker).await.unwrap();
    agent
        .grant_execution(USER, worker, &execution_grant(&pending[0], true))
        .await
        .unwrap();
    query("UPDATE agent_worker_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1")
        .bind(worker)
        .execute(&pool)
        .await
        .unwrap();
    agent.maintain().await.unwrap();
    assert_eq!(
        agent.get(USER, stale_worker_run).await.unwrap().unwrap()["state"],
        "blocked"
    );
    assert!(agent.heartbeat(USER, worker).await.unwrap().is_none());

    let (expired_run, _, _) = submit(&agent, "Expire this private durable task payload.").await;
    query(
        "UPDATE agent_runs SET deadline_at=NOW()-INTERVAL '1 second',payload_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
    )
    .bind(expired_run)
    .execute(&pool)
    .await
    .unwrap();
    agent.maintain().await.unwrap();
    let expired = agent.get(USER, expired_run).await.unwrap().unwrap();
    assert_eq!(expired["state"], "expired");
    assert_eq!(expired["request"], "Expired private task content.");
    assert!(
        agent
            .events(USER, expired_run, 0)
            .await
            .unwrap()
            .iter()
            .any(|event| event["type"] == "run.expired")
    );
    assert_eq!(
        query_scalar::<_, i64>("SELECT COUNT(*)::bigint FROM agent_session_items WHERE run_id=$1")
            .bind(expired_run)
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    pool.close().await;
}
