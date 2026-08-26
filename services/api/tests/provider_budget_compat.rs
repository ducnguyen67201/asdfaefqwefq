use std::time::Duration;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use futures_util::StreamExt as _;
use http::StatusCode;
use serde_json::{Value, json};
use trocode_api::{
    config::{CostGuardConfig, CostGuardMode},
    db,
    postgres::PgPoolOptions,
    providers::{
        CompanionImageBody, CompanionImageInput, CompanionImageService, ProviderBody,
        ResponsesInput, ResponsesService, TranscriptionBody, TranscriptionInput,
        TranscriptionService,
    },
    query, query_scalar,
    usage::{BudgetService, ProviderUsage, ReservationInput, SettlementInput},
};
use url::Url;
use uuid::Uuid;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

const USER: &str = "provider-budget-user";

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

fn cost_guard(mode: CostGuardMode) -> CostGuardConfig {
    CostGuardConfig {
        daily_micro_usd: 8_000_000,
        enabled: true,
        mode,
        monthly_micro_usd: 45_000_000,
        realtime_call_micro_usd: 5_000,
        reservation_ttl_ms: 120_000,
        speech_micro_usd_per_thousand_characters: 60_000,
        task_micro_usd: 5_000_000,
        transcription_micro_usd_per_minute: 6_000,
        warning_percent: 80,
    }
}

async fn setup() -> (trocode_api::PgPool, BudgetService) {
    let database_url = disposable_database_url();
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&database_url)
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
    query("INSERT INTO users(id,email,name,plan)VALUES($1,$2,$3,'basic')")
        .bind(USER)
        .bind("provider-budget@example.test")
        .bind("Provider Budget")
        .execute(&pool)
        .await
        .expect("seed provider user");
    let budget = BudgetService::new(pool.clone(), cost_guard(CostGuardMode::Enforce));
    (pool, budget)
}

async fn seed_turn(pool: &trocode_api::PgPool) -> (Uuid, Uuid) {
    let id = Uuid::new_v4();
    let task = Uuid::new_v4();
    query("INSERT INTO agent_turns(id,client_turn_id,user_id,task_id,plan)VALUES($1,$2,$3,$4,'basic')")
        .bind(id)
        .bind(Uuid::new_v4())
        .bind(USER)
        .bind(task)
        .execute(pool)
        .await
        .expect("seed agent turn");
    (id, task)
}

async fn reservation_status(pool: &trocode_api::PgPool, request: Uuid) -> String {
    query_scalar("SELECT status FROM model_budget_reservations WHERE user_id=$1 AND request_id=$2")
        .bind(USER)
        .bind(request)
        .fetch_one(pool)
        .await
        .expect("reservation status")
}

async fn mock_endpoint(
    route: &str,
    status: u16,
    content_type: &str,
    body: impl Into<Vec<u8>>,
) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(route))
        .respond_with(
            ResponseTemplate::new(status)
                .insert_header("content-type", content_type)
                .set_body_bytes(body),
        )
        .expect(1)
        .mount(&server)
        .await;
    server
}

fn responses_body(stream: bool) -> Value {
    json!({
        "input":[{"content":[{"text":"test","type":"input_text"}],"role":"user"}],
        "max_output_tokens":128,
        "model":"gpt-5.6-luna",
        "parallel_tool_calls":false,
        "store":false,
        "stream":stream,
        "tool_choice":"auto",
        "tools":[]
    })
}

async fn execute_response(
    pool: &trocode_api::PgPool,
    budget: &BudgetService,
    server: &MockServer,
    stream: bool,
) -> (
    Uuid,
    trocode_api::error::ApiResult<trocode_api::providers::ProviderResponse>,
) {
    let (turn, task) = seed_turn(pool).await;
    let request = Uuid::new_v4();
    let service = ResponsesService::new_with_endpoint(
        budget.clone(),
        reqwest::Client::new(),
        "test-key",
        &format!("{}/v1/responses", server.uri()),
    );
    let result = service
        .execute(ResponsesInput {
            agent_turn_id: turn,
            body: responses_body(stream),
            plan_id: "basic",
            request_id: request,
            safety_identifier: "provider-test-safety",
            task_id: task,
            user_id: USER,
        })
        .await;
    (request, result)
}

fn pcm_wav(duration_ms: u32) -> Vec<u8> {
    let data_size = duration_ms * 32;
    let mut bytes = Vec::with_capacity(44 + data_size as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&16_000_u32.to_le_bytes());
    bytes.extend_from_slice(&32_000_u32.to_le_bytes());
    bytes.extend_from_slice(&2_u16.to_le_bytes());
    bytes.extend_from_slice(&16_u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    bytes.resize(44 + data_size as usize, 0);
    bytes
}

async fn execute_transcription(
    budget: &BudgetService,
    server: &MockServer,
) -> (
    Uuid,
    trocode_api::error::ApiResult<trocode_api::providers::TranscriptionResult>,
) {
    let request = Uuid::new_v4();
    let service = TranscriptionService::new_with_endpoint(
        budget.clone(),
        reqwest::Client::new(),
        "test-key",
        &format!("{}/v1/audio/transcriptions", server.uri()),
    );
    let result = service
        .execute(TranscriptionInput {
            body: TranscriptionBody {
                audio_base64: STANDARD.encode(pcm_wav(320)),
                client_duration_ms: 320,
                language: "en".to_owned(),
                utterance_id: Uuid::new_v4(),
            },
            plan_id: "basic",
            request_id: request,
            safety_identifier: "transcription-test-safety",
            user_id: USER,
        })
        .await;
    (request, result)
}

fn png() -> Vec<u8> {
    vec![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]
}

async fn execute_companion_image(
    budget: &BudgetService,
    server: &MockServer,
) -> (
    Uuid,
    trocode_api::error::ApiResult<trocode_api::providers::CompanionImageResult>,
) {
    let request = Uuid::new_v4();
    let service = CompanionImageService::new_with_endpoint(
        budget.clone(),
        reqwest::Client::new(),
        "test-key",
        50_000,
        &format!("{}/v1/images/edits", server.uri()),
    );
    let result = service
        .execute(CompanionImageInput {
            body: CompanionImageBody {
                image_base64: STANDARD.encode(png()),
                mime_type: "image/png".to_owned(),
                prompt: "private blue space cat".to_owned(),
            },
            plan_id: "basic",
            request_id: request,
            safety_identifier: "companion-test-safety",
            user_id: USER,
        })
        .await;
    (request, result)
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn provider_outcomes_and_budget_transitions_are_durable_and_fail_closed() {
    let (pool, budget) = setup().await;

    assert_eq!(budget.realtime_call_estimate_micro_usd(), 5_000);
    assert_eq!(budget.speech_estimate_micro_usd(1), 60);
    assert_eq!(budget.speech_estimate_micro_usd(1_001), 60_060);
    assert_eq!(budget.transcription_estimate_micro_usd(320).unwrap(), 32);
    assert!(budget.transcription_estimate_micro_usd(15_001).is_err());
    assert_eq!(budget.transcription_actual_micro_usd(0.300_1).unwrap(), 31);

    let success = mock_endpoint(
        "/v1/responses",
        200,
        "application/json",
        serde_json::to_vec(&json!({
            "id":"resp_test",
            "model":"gpt-5.6-luna",
            "output":[],
            "usage":{
                "input_tokens":100,
                "input_tokens_details":{"cache_write_tokens":5,"cached_tokens":10},
                "output_tokens":20,
                "output_tokens_details":{"reasoning_tokens":4}
            }
        }))
        .unwrap(),
    )
    .await;
    let (request, response) = execute_response(&pool, &budget, &success, false).await;
    let response = response.expect("buffered provider success");
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.headers["x-trocode-usage-source"], "actual");
    assert!(response.headers.contains_key("x-trocode-usage-micro-usd"));
    match response.body {
        ProviderBody::Buffered(bytes) => assert!(bytes.starts_with(b"{")),
        ProviderBody::Stream(_) => panic!("expected buffered provider response"),
    }
    assert_eq!(reservation_status(&pool, request).await, "settled");

    let missing_usage = mock_endpoint(
        "/v1/responses",
        200,
        "application/json",
        br#"{"id":"missing_usage","output":[]}"#.to_vec(),
    )
    .await;
    let (request, response) = execute_response(&pool, &budget, &missing_usage, false).await;
    let response = response.expect("provider success without usage");
    assert_eq!(response.headers["x-trocode-usage-source"], "missing");
    assert_eq!(reservation_status(&pool, request).await, "uncertain");

    for (upstream_status, expected_status) in [(400, "released"), (500, "uncertain")] {
        let server = mock_endpoint(
            "/v1/responses",
            upstream_status,
            "application/json",
            br#"{"error":"provider"}"#.to_vec(),
        )
        .await;
        let (request, response) = execute_response(&pool, &budget, &server, false).await;
        assert_eq!(
            response
                .expect("provider error passthrough")
                .status
                .as_u16(),
            upstream_status
        );
        assert_eq!(reservation_status(&pool, request).await, expected_status);
    }

    let stream_body = concat!(
        "event: response.output_text.delta\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\n",
        "event: response.completed\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_stream\",\"model\":\"gpt-5.6-luna\",\"usage\":{\"input_tokens\":80,\"input_tokens_details\":{\"cached_tokens\":0},\"output_tokens\":12,\"output_tokens_details\":{\"reasoning_tokens\":2}}}}\n\n",
        "data: [DONE]\n\n"
    );
    let stream_server = mock_endpoint("/v1/responses", 200, "text/event-stream", stream_body).await;
    let (request, response) = execute_response(&pool, &budget, &stream_server, true).await;
    let response = response.expect("stream provider success");
    let ProviderBody::Stream(mut stream) = response.body else {
        panic!("expected streaming provider response");
    };
    let mut streamed = Vec::new();
    while let Some(chunk) = stream.next().await {
        streamed.extend_from_slice(&chunk.expect("stream chunk"));
    }
    assert!(String::from_utf8_lossy(&streamed).contains("response.completed"));
    assert_eq!(reservation_status(&pool, request).await, "settled");

    let invalid_stream = mock_endpoint(
        "/v1/responses",
        200,
        "application/json",
        br#"{"stream":"wrong-content-type"}"#.to_vec(),
    )
    .await;
    let (request, error) = execute_response(&pool, &budget, &invalid_stream, true).await;
    let error = error.err().expect("invalid stream must fail");
    assert_eq!(error.status, StatusCode::BAD_GATEWAY);
    assert_eq!(error.code, Some("ambiguous_response"));
    assert_eq!(reservation_status(&pool, request).await, "uncertain");

    let (turn, task) = seed_turn(&pool).await;
    let failed_request = Uuid::new_v4();
    let unavailable = ResponsesService::new_with_endpoint(
        budget.clone(),
        reqwest::Client::new(),
        "test-key",
        "http://127.0.0.1:9/v1/responses",
    );
    let error = unavailable
        .execute(ResponsesInput {
            agent_turn_id: turn,
            body: responses_body(false),
            plan_id: "basic",
            request_id: failed_request,
            safety_identifier: "dispatch-failure",
            task_id: task,
            user_id: USER,
        })
        .await
        .err()
        .expect("unavailable provider must fail");
    assert_eq!(error.code, Some("ambiguous_dispatch"));
    assert_eq!(reservation_status(&pool, failed_request).await, "uncertain");

    let transcription = mock_endpoint(
        "/v1/audio/transcriptions",
        200,
        "application/json",
        br#"{"text":"  durable transcript  "}"#.to_vec(),
    )
    .await;
    let (request, result) = execute_transcription(&budget, &transcription).await;
    let result = result.expect("transcription success");
    assert_eq!(result.text, "durable transcript");
    assert_eq!(result.audio_duration_ms, 320);
    assert_eq!(result.billed_seconds, 0.32);
    assert_eq!(reservation_status(&pool, request).await, "settled");

    let empty_transcription = mock_endpoint(
        "/v1/audio/transcriptions",
        200,
        "application/json",
        br#"{"languages":[{"code":"en"}],"text":"   "}"#.to_vec(),
    )
    .await;
    let (request, result) = execute_transcription(&budget, &empty_transcription).await;
    assert_eq!(result.expect("empty transcript is valid").text, "");
    assert_eq!(reservation_status(&pool, request).await, "settled");

    for (upstream_status, expected_status) in [(400, "released"), (500, "uncertain")] {
        let server = mock_endpoint(
            "/v1/audio/transcriptions",
            upstream_status,
            "application/json",
            br#"{"error":"provider"}"#.to_vec(),
        )
        .await;
        let (request, error) = execute_transcription(&budget, &server).await;
        let error = error.expect_err("provider rejection must fail");
        assert_eq!(error.code, Some("provider_rejected"));
        assert_eq!(error.status.as_u16(), upstream_status);
        assert_eq!(reservation_status(&pool, request).await, expected_status);
    }

    for invalid_body in [
        b"not-json".to_vec(),
        br#"{"languages":[{"code":""}],"text":"valid"}"#.to_vec(),
        br#"{"languages":"en","text":"valid"}"#.to_vec(),
        serde_json::to_vec(&json!({"text":"x".repeat(8_001)})).unwrap(),
    ] {
        let server = mock_endpoint(
            "/v1/audio/transcriptions",
            200,
            "application/json",
            invalid_body,
        )
        .await;
        let (request, error) = execute_transcription(&budget, &server).await;
        let error = error.expect_err("invalid provider success must fail");
        assert_eq!(error.code, Some("ambiguous_response"));
        assert_eq!(reservation_status(&pool, request).await, "uncertain");
    }

    let companion_success = mock_endpoint(
        "/v1/images/edits",
        200,
        "application/json",
        serde_json::to_vec(&json!({
            "data": [{"b64_json": STANDARD.encode(png())}],
            "usage": {
                "input_tokens": 2,
                "input_tokens_details": {"image_tokens": 1, "text_tokens": 1},
                "output_tokens": 200
            }
        }))
        .unwrap(),
    )
    .await;
    let (request, result) = execute_companion_image(&budget, &companion_success).await;
    let result = result.expect("companion image success");
    assert_eq!(result.image_base64, STANDARD.encode(png()));
    assert_eq!(result.model, "gpt-image-2-2026-04-21");
    assert_eq!(result.quota.used, 1);
    assert_eq!(reservation_status(&pool, request).await, "settled");
    let image_usage: (i64, i64, i64, i64) = query(
        "SELECT input_text_tokens,input_image_tokens,output_image_tokens,amount_micro_usd FROM model_usage_events WHERE user_id=$1 AND request_id=$2",
    )
    .bind(USER)
    .bind(request)
    .map(|row: trocode_api::postgres::PgRow| {
        use trocode_api::Row as _;
        (row.get(0), row.get(1), row.get(2), row.get(3))
    })
    .fetch_one(&pool)
    .await
    .expect("persisted image modality usage");
    assert_eq!(image_usage, (1, 1, 200, 6_013));
    let received = companion_success
        .received_requests()
        .await
        .expect("received companion request");
    let multipart = String::from_utf8_lossy(&received[0].body);
    for expected in [
        "name=\"image[]\"; filename=\"reference.png\"",
        "name=\"background\"",
        "transparent",
        "name=\"moderation\"",
        "name=\"quality\"",
        "low",
        "<student_customization>",
        "private blue space cat",
    ] {
        assert!(
            multipart.contains(expected),
            "missing multipart field {expected}"
        );
    }

    for (upstream_status, expected_code, expected_status) in [
        (400, "companion_image_rejected", "released"),
        (500, "ambiguous_dispatch", "uncertain"),
    ] {
        let server = mock_endpoint(
            "/v1/images/edits",
            upstream_status,
            "application/json",
            br#"{"error":"private provider detail"}"#.to_vec(),
        )
        .await;
        let (request, error) = execute_companion_image(&budget, &server).await;
        let error = error.expect_err("companion provider rejection must fail");
        assert_eq!(error.code, Some(expected_code));
        assert_eq!(reservation_status(&pool, request).await, expected_status);
    }

    let malformed_companion = mock_endpoint(
        "/v1/images/edits",
        200,
        "application/json",
        serde_json::to_vec(&json!({"data": [{"b64_json": STANDARD.encode(png())}]})).unwrap(),
    )
    .await;
    let (request, error) = execute_companion_image(&budget, &malformed_companion).await;
    assert_eq!(
        error.expect_err("missing usage must be ambiguous").code,
        Some("ambiguous_response")
    );
    assert_eq!(reservation_status(&pool, request).await, "uncertain");

    let mut image_count: i64 = query_scalar(
        "SELECT COUNT(*)::bigint FROM model_budget_reservations WHERE user_id=$1 AND lane='image_generation' AND status IN ('reserved','settled','uncertain') AND created_at>=date_trunc('month',NOW())",
    )
    .bind(USER)
    .fetch_one(&pool)
    .await
    .unwrap();
    while image_count < 5 {
        let request_id = Uuid::new_v4();
        budget
            .reserve(ReservationInput {
                agent_turn_id: None,
                catalog_version: "2026-04-21",
                lane: "image_generation",
                model: "gpt-image-2-2026-04-21",
                plan_id: "basic",
                request_id,
                reserved_micro_usd: 50_000,
                task_id: request_id,
                user_id: USER,
            })
            .await
            .expect("first five companion slots");
        image_count += 1;
    }
    let observe_image_budget = BudgetService::new(pool.clone(), cost_guard(CostGuardMode::Observe));
    let sixth = Uuid::new_v4();
    let limit_error = observe_image_budget
        .reserve(ReservationInput {
            agent_turn_id: None,
            catalog_version: "2026-04-21",
            lane: "image_generation",
            model: "gpt-image-2-2026-04-21",
            plan_id: "basic",
            request_id: sixth,
            reserved_micro_usd: 50_000,
            task_id: sixth,
            user_id: USER,
        })
        .await
        .expect_err("sixth monthly generation is always denied");
    assert_eq!(limit_error.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limit_error.code, Some("companion_generation_limit_reached"));
    let image_quota = budget
        .companion_generation_snapshot(USER, "basic")
        .await
        .expect("image quota");
    assert_eq!((image_quota.used, image_quota.remaining), (5, 0));

    let disabled = BudgetService::new(
        pool.clone(),
        CostGuardConfig {
            enabled: false,
            ..cost_guard(CostGuardMode::Enforce)
        },
    );
    let error = disabled
        .reserve(ReservationInput {
            agent_turn_id: None,
            catalog_version: "test",
            lane: "speech",
            model: "test",
            plan_id: "basic",
            request_id: Uuid::new_v4(),
            reserved_micro_usd: 1,
            task_id: Uuid::new_v4(),
            user_id: USER,
        })
        .await
        .expect_err("disabled budget must reject");
    assert_eq!(error.code, Some("cost_guard_disabled"));

    let missing_turn = budget
        .reserve(ReservationInput {
            agent_turn_id: None,
            catalog_version: "test",
            lane: "responses",
            model: "gpt-5.6-luna",
            plan_id: "basic",
            request_id: Uuid::new_v4(),
            reserved_micro_usd: 1,
            task_id: Uuid::new_v4(),
            user_id: USER,
        })
        .await
        .expect_err("responses reservation must require a turn");
    assert_eq!(missing_turn.code, Some("invalid_agent_turn"));

    let observe = BudgetService::new(pool.clone(), cost_guard(CostGuardMode::Observe));
    let observe_request = Uuid::new_v4();
    observe
        .reserve(ReservationInput {
            agent_turn_id: None,
            catalog_version: "test",
            lane: "speech",
            model: "test",
            plan_id: "basic",
            request_id: observe_request,
            reserved_micro_usd: 1_000_001,
            task_id: Uuid::new_v4(),
            user_id: USER,
        })
        .await
        .expect("observe mode records would-deny reservation");
    let would_deny: bool = query_scalar(
        "SELECT would_deny FROM model_budget_reservations WHERE user_id=$1 AND request_id=$2",
    )
    .bind(USER)
    .bind(observe_request)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(would_deny);
    let duplicate = observe
        .reserve(ReservationInput {
            agent_turn_id: None,
            catalog_version: "test",
            lane: "speech",
            model: "test",
            plan_id: "basic",
            request_id: observe_request,
            reserved_micro_usd: 1,
            task_id: Uuid::new_v4(),
            user_id: USER,
        })
        .await
        .expect_err("duplicate request must fail");
    assert_eq!(duplicate.code, Some("duplicate_request"));

    let release_error = observe
        .release(USER, observe_request, "unsafe_release")
        .await
        .expect_err("unsafe release disposition must fail");
    assert_eq!(release_error.status, StatusCode::INTERNAL_SERVER_ERROR);
    observe.mark_uncertain(USER, observe_request).await.unwrap();
    assert_eq!(
        reservation_status(&pool, observe_request).await,
        "uncertain"
    );
    let disposition: String = query_scalar(
        "SELECT disposition FROM model_budget_reservations WHERE user_id=$1 AND request_id=$2",
    )
    .bind(USER)
    .bind(observe_request)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(disposition, "ambiguous");

    let settle_request = Uuid::new_v4();
    let settle_task = Uuid::new_v4();
    observe
        .reserve(ReservationInput {
            agent_turn_id: None,
            catalog_version: "test",
            lane: "speech",
            model: "test",
            plan_id: "basic",
            request_id: settle_request,
            reserved_micro_usd: 100,
            task_id: settle_task,
            user_id: USER,
        })
        .await
        .unwrap();
    budget.mark_dispatched(USER, settle_request).await.unwrap();
    let usage = ProviderUsage {
        cache_write_tokens: 0,
        cached_input_tokens: 0,
        input_tokens: 0,
        input_text_tokens: 0,
        input_image_tokens: 0,
        model: "test".to_owned(),
        output_tokens: 0,
        output_image_tokens: 0,
        reasoning_tokens: 0,
    };
    let settlement = SettlementInput {
        actual_micro_usd: 90,
        audio_duration_ms: 0,
        character_count: 10,
        duration_ms: 5,
        provider_response_id: Some("settled-test"),
        request_id: settle_request,
        usage: &usage,
        usage_source: "estimated",
        user_id: USER,
    };
    budget.settle(settlement.clone()).await.unwrap();
    budget.settle(settlement).await.unwrap();
    let old_request = Uuid::new_v4();
    observe
        .reserve(ReservationInput {
            agent_turn_id: None,
            catalog_version: "test",
            lane: "speech",
            model: "test",
            plan_id: "basic",
            request_id: old_request,
            reserved_micro_usd: 999,
            task_id: settle_task,
            user_id: USER,
        })
        .await
        .unwrap();
    query(
        "UPDATE model_budget_reservations
         SET created_at=date_trunc('month',NOW())-INTERVAL '1 day',updated_at=date_trunc('month',NOW())-INTERVAL '1 day'
         WHERE user_id=$1 AND request_id=$2",
    )
    .bind(USER)
    .bind(old_request)
    .execute(&pool)
    .await
    .unwrap();
    let snapshot = budget
        .snapshot(USER, Some(settle_task), "basic")
        .await
        .expect("budget snapshot");
    assert!(snapshot.actual_micro_usd > 0);
    assert_eq!(snapshot.enforcement_mode, "enforce");
    assert_eq!(snapshot.plan, "basic");
    assert_eq!(snapshot.task.settled_micro_usd, 90);
    assert_eq!(snapshot.task.reserved_micro_usd, 0);

    pool.close().await;
}
