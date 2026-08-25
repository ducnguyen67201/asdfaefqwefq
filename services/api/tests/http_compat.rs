use std::{collections::BTreeSet, time::Duration};

use aws_credential_types::Credentials;
use aws_sdk_s3::{Client as S3Client, config::Region};
use axum::{
    Router,
    body::Body,
    http::{HeaderMap, Method, Request, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use http_body_util::BodyExt as _;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tower::ServiceExt as _;
use trocode_api::{
    agent::TOOL_SCHEMA_DIGEST,
    app::AppState,
    auth::User,
    config::{
        AdminConfig, AgentRuntimeConfig, Config, CostGuardConfig, CostGuardMode, KnowledgeConfig,
        ObjectStoreConfig, RolloutConfig,
    },
    knowledge::IngestionWorker,
    postgres::PgPoolOptions,
    providers::{ResponsesService, TranscriptionService},
    query, query_scalar,
};
use url::Url;
use uuid::Uuid;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

const ADMIN_TOKEN: &str = "trocode_test_admin_token_0123456789abcdef";
const HMAC_KEY: &str = "trocode_test_hmac_key_0123456789abcdef";

struct TestResponse {
    body: Vec<u8>,
    headers: HeaderMap,
    status: StatusCode,
}

impl TestResponse {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|error| {
            panic!(
                "response was not JSON ({error}): {}",
                String::from_utf8_lossy(&self.body)
            )
        })
    }
}

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

async fn reset_database(database_url: &str) {
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
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
    pool.close().await;
}

fn test_config(database_url: String) -> Config {
    test_config_with_store(database_url, None)
}

fn test_config_with_store(database_url: String, object_store: Option<ObjectStoreConfig>) -> Config {
    Config {
        admin: AdminConfig {
            access_token: Some(ADMIN_TOKEN.to_owned()),
        },
        agent_runtime: AgentRuntimeConfig {
            canary_users: BTreeSet::from(["http-owner".to_owned()]),
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
        },
        cost_guard: CostGuardConfig {
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
        },
        database_pool_max: 8,
        database_url,
        eleven_labs_api_key: None,
        eleven_labs_model_id: "eleven_multilingual_v2".to_owned(),
        eleven_labs_voice_id: None,
        google_client_id: "http-test.apps.googleusercontent.com".to_owned(),
        knowledge_spaces: KnowledgeConfig {
            enabled: true,
            object_store,
        },
        openai_api_key: "test-openai-key".to_owned(),
        openai_models: BTreeSet::from([
            "gpt-5.6-luna".to_owned(),
            "gpt-5.6-terra".to_owned(),
            "gpt-5.6-sol".to_owned(),
        ]),
        port: 0,
        railway_git_commit_sha: "http-compat".to_owned(),
        session_duration_days: 30,
        session_token_hmac_key: HMAC_KEY.to_owned(),
    }
}

async fn send(
    router: &Router,
    method: Method,
    path: &str,
    bearer: Option<&str>,
    body: Option<&Value>,
) -> TestResponse {
    send_with_headers(router, method, path, bearer, body, &[]).await
}

async fn send_with_headers(
    router: &Router,
    method: Method,
    path: &str,
    bearer: Option<&str>,
    body: Option<&Value>,
    headers: &[(&str, &str)],
) -> TestResponse {
    let bytes = body
        .map(serde_json::to_vec)
        .transpose()
        .expect("serialize test request")
        .unwrap_or_default();
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "api.example.test")
        .header("x-forwarded-for", "127.0.0.1");
    if body.is_some() {
        request = request.header("content-type", "application/json");
    }
    if let Some(token) = bearer {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = router
        .clone()
        .oneshot(request.body(Body::from(bytes)).expect("build test request"))
        .await
        .expect("router response");
    let status = response.status();
    let headers = response.headers().clone();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("collect response body")
        .to_bytes()
        .to_vec();
    TestResponse {
        body,
        headers,
        status,
    }
}

async fn send_without_collecting(
    router: &Router,
    path: &str,
    bearer: &str,
) -> (StatusCode, HeaderMap) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(path)
                .header("authorization", format!("Bearer {bearer}"))
                .header("host", "api.example.test")
                .body(Body::empty())
                .expect("build streaming request"),
        )
        .await
        .expect("streaming router response");
    (response.status(), response.headers().clone())
}

#[track_caller]
fn assert_status(response: &TestResponse, expected: StatusCode) {
    assert_eq!(
        response.status,
        expected,
        "unexpected response: {}",
        String::from_utf8_lossy(&response.body)
    );
}

async fn issue_user(state: &AppState, id: &str) -> String {
    state
        .sessions
        .issue(User {
            email: format!("{id}@example.test"),
            id: id.to_owned(),
            name: id.to_owned(),
        })
        .await
        .expect("issue test session")
        .expect("user is not blocked")
        .access_token
}

async fn activate_basic(router: &Router, state: &AppState, user: &str, token: &str) {
    let response = send(
        router,
        Method::POST,
        "/v1/access-code-redemptions/free",
        Some(token),
        None,
    )
    .await;
    assert_status(&response, StatusCode::OK);
    query("UPDATE users SET plan='basic' WHERE id=$1")
        .bind(user)
        .execute(&state.pool)
        .await
        .expect("set integration user plan");
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

fn local_object_store(bucket: String) -> ObjectStoreConfig {
    let endpoint = std::env::var("TROCODE_TEST_S3_ENDPOINT")
        .expect("TROCODE_TEST_S3_ENDPOINT is required for the ignored upload test");
    let parsed = Url::parse(&endpoint).expect("test S3 endpoint must be a URL");
    assert!(
        matches!(parsed.host_str(), Some("127.0.0.1" | "localhost")),
        "refusing to use a non-local S3 integration endpoint"
    );
    ObjectStoreConfig {
        access_key_id: std::env::var("TROCODE_TEST_S3_ACCESS_KEY_ID")
            .unwrap_or_else(|_| "trocode_test_access".to_owned()),
        bucket,
        endpoint: Some(endpoint),
        force_path_style: true,
        region: std::env::var("TROCODE_TEST_S3_REGION").unwrap_or_else(|_| "us-east-1".to_owned()),
        secret_access_key: std::env::var("TROCODE_TEST_S3_SECRET_ACCESS_KEY")
            .unwrap_or_else(|_| "trocode_test_secret_password".to_owned()),
    }
}

async fn s3_client(config: &ObjectStoreConfig) -> S3Client {
    let credentials = Credentials::new(
        &config.access_key_id,
        &config.secret_access_key,
        None,
        None,
        "trocode-http-upload-test",
    );
    let shared = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(Region::new(config.region.clone()))
        .credentials_provider(credentials)
        .load()
        .await;
    let mut builder = aws_sdk_s3::config::Builder::from(&shared).force_path_style(true);
    if let Some(endpoint) = &config.endpoint {
        builder = builder.endpoint_url(endpoint);
    }
    S3Client::from_conf(builder.build())
}

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn rust_router_preserves_backend_contracts_across_major_route_families() {
    let database_url = disposable_database_url();
    reset_database(&database_url).await;
    let provider = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/responses"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_json(json!({
                    "id":"resp_http_compat",
                    "model":"gpt-5.6-luna",
                    "output":[{"content":[{"text":"ok","type":"output_text"}],"type":"message"}],
                    "usage":{
                        "input_tokens":100,
                        "input_tokens_details":{"cached_tokens":0},
                        "output_tokens":10,
                        "output_tokens_details":{"reasoning_tokens":0}
                    }
                })),
        )
        .mount(&provider)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/audio/transcriptions"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "application/json")
                .set_body_json(json!({"text":"HTTP transcription"})),
        )
        .mount(&provider)
        .await;
    let mut state = AppState::compose(test_config(database_url))
        .await
        .expect("compose Rust application");
    state.responses = ResponsesService::new_with_endpoint(
        state.budget.clone(),
        reqwest::Client::new(),
        "test-key",
        &format!("{}/v1/responses", provider.uri()),
    );
    state.transcription = TranscriptionService::new_with_endpoint(
        state.budget.clone(),
        reqwest::Client::new(),
        "test-key",
        &format!("{}/v1/audio/transcriptions", provider.uri()),
    );
    let router = trocode_api::http::router(state.clone());

    let health = send(&router, Method::GET, "/healthz", None, None).await;
    assert_status(&health, StatusCode::OK);
    assert_eq!(health.json()["version"], "http-compat");
    assert_status(
        &send(&router, Method::GET, "/readyz", None, None).await,
        StatusCode::OK,
    );
    let capabilities = send(&router, Method::GET, "/v1/capabilities", None, None).await;
    assert_status(&capabilities, StatusCode::OK);
    assert_eq!(capabilities.json()["knowledgeSpaces"]["enabled"], true);
    assert_eq!(capabilities.json()["knowledgeSpaces"]["contractVersion"], 2);
    let asset = send(&router, Method::GET, "/source/admin", None, None).await;
    assert_status(&asset, StatusCode::OK);
    assert!(asset.headers.contains_key("content-security-policy"));
    assert_status(
        &send_with_headers(
            &router,
            Method::GET,
            "/missing",
            None,
            None,
            &[("origin", "https://attacker.example")],
        )
        .await,
        StatusCode::FORBIDDEN,
    );
    assert_status(
        &send(&router, Method::GET, "/missing", None, None).await,
        StatusCode::NOT_FOUND,
    );

    let owner_token = issue_user(&state, "http-owner").await;
    let participant_token = issue_user(&state, "http-participant").await;
    let facilitator_token = issue_user(&state, "http-facilitator").await;
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/auth/google/exchange",
            None,
            Some(&json!({"idToken":"not-a-jwt"})),
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/access-code-redemptions/me",
            None,
            None,
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    let pending = send(
        &router,
        Method::GET,
        "/v1/access-code-redemptions/me",
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&pending, StatusCode::OK);
    assert_eq!(pending.json()["state"], "inactive");
    activate_basic(&router, &state, "http-owner", &owner_token).await;
    activate_basic(&router, &state, "http-participant", &participant_token).await;
    activate_basic(&router, &state, "http-facilitator", &facilitator_token).await;

    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/admin/session",
            Some("incorrect-admin-token"),
            None,
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    let admin_session = send(
        &router,
        Method::POST,
        "/v1/admin/session",
        Some(ADMIN_TOKEN),
        None,
    )
    .await;
    assert_status(&admin_session, StatusCode::NO_CONTENT);
    assert!(admin_session.headers.contains_key("set-cookie"));
    for (user, role) in [
        ("http-owner", "teacher"),
        ("http-participant", "student"),
        ("http-facilitator", "teacher"),
    ] {
        let assigned = send(
            &router,
            Method::PATCH,
            &format!("/v1/admin/users/{user}/classroom-role"),
            Some(ADMIN_TOKEN),
            Some(&json!({"role":role})),
        )
        .await;
        assert_status(&assigned, StatusCode::OK);
        assert_eq!(assigned.json()["classroomRole"], role);
    }
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/admin/users?status=active&classroomRole=teacher&limit=10",
            Some(ADMIN_TOKEN),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/admin/usage?range=7d&lane=all",
            Some(ADMIN_TOKEN),
            None,
        )
        .await,
        StatusCode::OK,
    );
    let created_codes = send(
        &router,
        Method::POST,
        "/v1/admin/access-codes/bulk",
        Some(ADMIN_TOKEN),
        Some(&json!({"count":2,"label":"HTTP parity","maxUsers":2,"plan":"basic"})),
    )
    .await;
    assert_status(&created_codes, StatusCode::CREATED);
    let created_codes = created_codes.json();
    let granted_code = created_codes["items"][0]["id"]
        .as_str()
        .expect("granted access-code id");
    let granted_plain_code = created_codes["items"][0]["code"]
        .as_str()
        .expect("granted access-code plaintext");
    let unused_code = created_codes["items"][1]["id"]
        .as_str()
        .expect("unused access-code id");
    assert_status(
        &send(
            &router,
            Method::PATCH,
            &format!("/v1/admin/access-codes/{granted_code}"),
            Some(ADMIN_TOKEN),
            Some(&json!({"paused":true})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::PATCH,
            &format!("/v1/admin/access-codes/{granted_code}"),
            Some(ADMIN_TOKEN),
            Some(&json!({"paused":false})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/admin/users/http-participant/access-code",
            Some(ADMIN_TOKEN),
            Some(&json!({"accessCodeId":granted_code})),
        )
        .await,
        StatusCode::CREATED,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/access-code-redemptions",
            Some(&owner_token),
            Some(&json!({"code":granted_plain_code})),
        )
        .await,
        StatusCode::CREATED,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/access-code-redemptions",
            Some(&owner_token),
            Some(&json!({"code":granted_plain_code})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            &format!("/v1/admin/access-codes/{granted_code}/users"),
            Some(ADMIN_TOKEN),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::DELETE,
            &format!("/v1/admin/access-codes/{unused_code}"),
            Some(ADMIN_TOKEN),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/admin/access-codes?limit=10",
            Some(ADMIN_TOKEN),
            None,
        )
        .await,
        StatusCode::OK,
    );

    let space = send(
        &router,
        Method::POST,
        "/v1/spaces",
        Some(&owner_token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "description":"Disposable integration space",
            "name":"HTTP compatibility",
            "purposeLabel":"migration"
        })),
    )
    .await;
    assert_status(&space, StatusCode::CREATED);
    let space_id = space.json()["space"]["id"]
        .as_str()
        .expect("space id")
        .to_owned();
    for path in [
        "/v1/spaces".to_owned(),
        format!("/v1/spaces/{space_id}"),
        format!("/v1/spaces/{space_id}/sources"),
        format!("/v1/spaces/{space_id}/groups"),
        format!("/v1/spaces/{space_id}/members"),
    ] {
        assert_status(
            &send(&router, Method::GET, &path, Some(&owner_token), None).await,
            StatusCode::OK,
        );
    }
    let spaces = send(&router, Method::GET, "/v1/spaces", Some(&owner_token), None).await;
    assert_eq!(spaces.json()["classroomRole"], "teacher");
    assert_eq!(spaces.json()["nextCursor"], Value::Null);
    let participant_batch_id = Uuid::new_v4();
    let added_participant = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/members/bulk"),
        Some(&owner_token),
        Some(&json!({
            "clientId":participant_batch_id,
            "emails":[
                "HTTP-PARTICIPANT@example.test",
                "http-owner@example.test",
                "missing@example.test"
            ],
            "role":"participant"
        })),
    )
    .await;
    assert_status(&added_participant, StatusCode::OK);
    assert_eq!(
        added_participant.json()["addedEmails"],
        json!(["http-participant@example.test"])
    );
    assert_eq!(
        added_participant.json()["roleMismatchEmails"],
        json!(["http-owner@example.test"])
    );
    assert_eq!(
        added_participant.json()["unavailableEmails"],
        json!(["missing@example.test"])
    );
    let replayed_batch = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/members/bulk"),
        Some(&owner_token),
        Some(&json!({
            "clientId":participant_batch_id,
            "emails":["different@example.test"],
            "role":"participant"
        })),
    )
    .await;
    assert_status(&replayed_batch, StatusCode::OK);
    assert_eq!(replayed_batch.json(), added_participant.json());
    let added_facilitator = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/members/bulk"),
        Some(&owner_token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "emails":["http-facilitator@example.test"],
            "role":"facilitator"
        })),
    )
    .await;
    assert_status(&added_facilitator, StatusCode::OK);
    assert_eq!(
        added_facilitator.json()["addedEmails"],
        json!(["http-facilitator@example.test"])
    );
    let facilitator_cannot_add_teacher = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/members/bulk"),
        Some(&facilitator_token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "emails":["http-owner@example.test"],
            "role":"facilitator"
        })),
    )
    .await;
    assert_status(&facilitator_cannot_add_teacher, StatusCode::FORBIDDEN);
    let owner_role_in_use = send(
        &router,
        Method::PATCH,
        "/v1/admin/users/http-owner/classroom-role",
        Some(ADMIN_TOKEN),
        Some(&json!({"role":"student"})),
    )
    .await;
    assert_status(&owner_role_in_use, StatusCode::CONFLICT);
    let group = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/groups"),
        Some(&owner_token),
        Some(&json!({"clientId":Uuid::new_v4(),"name":"Participants"})),
    )
    .await;
    assert_status(&group, StatusCode::CREATED);
    let group_id = group.json()["id"].as_str().expect("group id").to_owned();
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/invites"),
            Some(&owner_token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "groupId":Uuid::new_v4(),
                "maxUses":1,
                "role":"participant"
            })),
        )
        .await,
        StatusCode::NOT_FOUND,
    );
    let invite = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/invites"),
        Some(&owner_token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "groupId":group_id,
            "maxUses":2,
            "role":"participant"
        })),
    )
    .await;
    assert_status(&invite, StatusCode::CREATED);
    let invite_code = invite.json()["code"]
        .as_str()
        .expect("invite code")
        .to_owned();
    let redeemed = send(
        &router,
        Method::POST,
        "/v1/space-invites/redeem",
        Some(&participant_token),
        Some(&json!({"code":&invite_code})),
    )
    .await;
    assert_status(&redeemed, StatusCode::OK);
    assert_eq!(redeemed.json()["role"], "participant");
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/space-invites/redeem",
            Some(&participant_token),
            Some(&json!({"code":&invite_code})),
        )
        .await,
        StatusCode::OK,
    );

    let activity = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/activities"),
        Some(&owner_token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "definition":{
                "instructions":"Exercise the Rust backend contract.",
                "launchTarget":"none",
                "objective":"Prove the hosted backend contract remains compatible.",
                "title":"Migration parity",
                "criteria":[{
                    "id":"rust-router",
                    "title":"Rust router remains compatible",
                    "tags":["integration"]
                }]
            },
            "sourceVersionIds":[]
        })),
    )
    .await;
    assert_status(&activity, StatusCode::CREATED);
    let activity_id = activity.json()["id"]
        .as_str()
        .expect("activity id")
        .to_owned();
    let published = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/activities/{activity_id}/publish"),
        Some(&owner_token),
        Some(&json!({"clientId":Uuid::new_v4()})),
    )
    .await;
    assert_status(&published, StatusCode::CREATED);
    let version_id = published.json()["id"]
        .as_str()
        .expect("activity version id")
        .to_owned();
    let run_client_id = Uuid::new_v4();
    let run_body = json!({
        "activityVersionId":version_id,
        "clientId":run_client_id,
        "insightPolicy":"explicit_and_operational",
        "mode":"live",
        "target":{"kind":"participants","userIds":["http-participant"]}
    });
    let run = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/runs"),
        Some(&owner_token),
        Some(&run_body),
    )
    .await;
    assert_status(&run, StatusCode::CREATED);
    let run_id = run.json()["id"].as_str().expect("run id").to_owned();
    let repeated_run = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/runs"),
        Some(&owner_token),
        Some(&run_body),
    )
    .await;
    assert_status(&repeated_run, StatusCode::OK);
    assert_eq!(repeated_run.json()["id"], run_id);
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/runs/{run_id}/open"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    let assignments = send(
        &router,
        Method::GET,
        "/v1/assignments/me",
        Some(&participant_token),
        None,
    )
    .await;
    assert_status(&assignments, StatusCode::OK);
    assert_eq!(
        assignments.json()["items"][0]["activity"]["title"],
        "Migration parity"
    );
    let attempt_id = assignments.json()["items"][0]["attemptId"]
        .as_str()
        .expect("attempt id")
        .to_owned();
    let attempt_context = send(
        &router,
        Method::GET,
        &format!("/v1/attempts/{attempt_id}"),
        Some(&participant_token),
        None,
    )
    .await;
    assert_status(&attempt_context, StatusCode::OK);
    assert_eq!(attempt_context.json()["attemptId"], attempt_id);
    assert_eq!(attempt_context.json()["priorProgress"]["sessionCount"], 0);
    let starter_files = send(
        &router,
        Method::GET,
        &format!("/v1/attempts/{attempt_id}/starter-files"),
        Some(&participant_token),
        None,
    )
    .await;
    assert_status(&starter_files, StatusCode::OK);
    assert_eq!(starter_files.json()["files"], json!([]));
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/attempts/{attempt_id}/acknowledge"),
            Some(&participant_token),
            Some(&json!({"policyVersion":"1"})),
        )
        .await,
        StatusCode::OK,
    );
    let task_id = Uuid::new_v4();
    let work_client_id = Uuid::new_v4();
    let work = send(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/work-sessions"),
        Some(&participant_token),
        Some(&json!({
            "clientId":work_client_id,
            "launchKind":"none",
            "taskId":task_id
        })),
    )
    .await;
    assert_status(&work, StatusCode::CREATED);
    let work_id = work.json()["id"]
        .as_str()
        .expect("work session id")
        .to_owned();
    let repeated_work = send(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/work-sessions"),
        Some(&participant_token),
        Some(&json!({
            "clientId":work_client_id,
            "launchKind":"none",
            "taskId":Uuid::new_v4()
        })),
    )
    .await;
    assert_status(&repeated_work, StatusCode::CREATED);
    assert_eq!(repeated_work.json()["id"], work_id);
    assert_status(
        &send(
            &router,
            Method::PATCH,
            &format!("/v1/work-sessions/{work_id}"),
            Some(&participant_token),
            Some(&json!({"helpRequested":false,"hintLevel":1,"state":"active"})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::PATCH,
            &format!("/v1/work-sessions/{work_id}"),
            Some(&participant_token),
            Some(&json!({"helpRequested":"false","state":"active"})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/attempts/{attempt_id}/evidence"),
            Some(&participant_token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "criterionId":"rust-router",
                "provenance":"participant",
                "resultCode":"passed",
                "tag":"integration",
                "workSessionId":work_id
            })),
        )
        .await,
        StatusCode::CREATED,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/attempts/{attempt_id}/evidence"),
            Some(&participant_token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "criterionId":"rust-router",
                "provenance":"participant",
                "resultCode":"passed",
                "tag":"not-allowed",
                "workSessionId":work_id
            })),
        )
        .await,
        StatusCode::FORBIDDEN,
    );
    let search = send(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/knowledge/search"),
        Some(&participant_token),
        Some(&json!({"limit":6,"query":"Rust migration"})),
    )
    .await;
    assert_status(&search, StatusCode::OK);
    assert_eq!(search.json()["results"], json!([]));
    let help_client_id = Uuid::new_v4();
    for _ in 0..2 {
        assert_status(
            &send(
                &router,
                Method::POST,
                &format!("/v1/attempts/{attempt_id}/help"),
                Some(&participant_token),
                Some(&json!({"clientId":help_client_id})),
            )
            .await,
            StatusCode::OK,
        );
    }
    let dashboard = send(
        &router,
        Method::GET,
        &format!("/v1/spaces/{space_id}/runs/{run_id}/dashboard"),
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&dashboard, StatusCode::OK);
    assert_eq!(dashboard.json()["counts"]["blocked"], 1);
    assert_eq!(
        dashboard.json()["criterionEvidence"][0]["criterionId"],
        "rust-router"
    );
    assert_eq!(dashboard.json()["helpQueue"][0]["attemptId"], attempt_id);
    let delta = send(
        &router,
        Method::GET,
        &format!("/v1/spaces/{space_id}/runs/{run_id}/dashboard?sinceSequence=0"),
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&delta, StatusCode::OK);
    let delta_json = delta.json();
    let event_types: Vec<_> = delta_json["events"]
        .as_array()
        .expect("delta events")
        .iter()
        .filter_map(|event| event["type"].as_str().map(ToOwned::to_owned))
        .collect();
    assert_eq!(
        event_types
            .iter()
            .filter(|kind| **kind == "work_session_created")
            .count(),
        1
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            &format!(
                "/v1/spaces/{space_id}/runs/{run_id}/dashboard?sinceSequence=9007199254740992"
            ),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_eq!(
        event_types
            .iter()
            .filter(|kind| **kind == "help_requested")
            .count(),
        1
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/runs/{run_id}/close"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/runs/{run_id}/open"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::CONFLICT,
    );

    let client_turn_id = Uuid::new_v4();
    let agent_turn = json!({"clientTurnId":client_turn_id,"taskId":task_id});
    let created_turn = send(
        &router,
        Method::POST,
        "/v1/agent-turns",
        Some(&owner_token),
        Some(&agent_turn),
    )
    .await;
    assert_status(&created_turn, StatusCode::CREATED);
    let agent_turn_id = created_turn.json()["id"]
        .as_str()
        .expect("agent turn id")
        .to_owned();
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/agent-turns",
            Some(&owner_token),
            Some(&agent_turn),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/agent-turns",
            Some(&owner_token),
            Some(&json!({"clientTurnId":client_turn_id,"taskId":Uuid::new_v4()})),
        )
        .await,
        StatusCode::CONFLICT,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            &format!("/v1/usage/budget?taskId={task_id}"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/openai/responses",
            Some(&owner_token),
            Some(&json!({"model":"not-allowed"})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    let provider_request_id = Uuid::new_v4().to_string();
    let task_id_header = task_id.to_string();
    let responses = send_with_headers(
        &router,
        Method::POST,
        "/v1/openai/responses",
        Some(&owner_token),
        Some(&json!({
            "input":[{"content":[{"text":"hello","type":"input_text"}],"role":"user"}],
            "max_output_tokens":128,
            "model":"gpt-5.6-luna",
            "parallel_tool_calls":false,
            "store":false,
            "tools":[]
        })),
        &[
            ("x-trocode-agent-turn-id", &agent_turn_id),
            ("x-trocode-request-id", &provider_request_id),
            ("x-trocode-task-id", &task_id_header),
        ],
    )
    .await;
    assert_status(&responses, StatusCode::OK);
    assert_eq!(responses.headers["x-trocode-usage-source"], "actual");
    let transcription_request_id = Uuid::new_v4().to_string();
    let transcription = send_with_headers(
        &router,
        Method::POST,
        "/v1/openai/audio/transcriptions",
        Some(&owner_token),
        Some(&json!({
            "audioBase64":STANDARD.encode(pcm_wav(320)),
            "clientDurationMs":320,
            "language":"en",
            "utteranceId":Uuid::new_v4()
        })),
        &[
            ("x-trocode-request-id", &transcription_request_id),
            ("x-trocode-transcription-contract", "2"),
        ],
    )
    .await;
    assert_status(&transcription, StatusCode::OK);
    assert_eq!(transcription.json()["text"], "HTTP transcription");
    let invalid_language_request_id = Uuid::new_v4().to_string();
    assert_status(
        &send_with_headers(
            &router,
            Method::POST,
            "/v1/openai/audio/transcriptions",
            Some(&owner_token),
            Some(&json!({
                "audioBase64":STANDARD.encode(pcm_wav(320)),
                "clientDurationMs":320,
                "language":"xx",
                "utteranceId":Uuid::new_v4()
            })),
            &[("x-trocode-request-id", &invalid_language_request_id)],
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/openai/audio/transcriptions",
            Some(&owner_token),
            Some(&json!({"audio":"invalid"})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/openai/realtime/calls",
            Some(&owner_token),
            Some(&json!({"language":"xx","offerSdp":"invalid"})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/elevenlabs/speech",
            Some(&owner_token),
            Some(&json!({"text":"hello"})),
        )
        .await,
        StatusCode::SERVICE_UNAVAILABLE,
    );

    let status = send(
        &router,
        Method::GET,
        "/v1/agent-runtime/status",
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&status, StatusCode::OK);
    assert_eq!(status.json()["enabled"], true);
    let durable_task = send(
        &router,
        Method::POST,
        "/v1/tasks",
        Some(&owner_token),
        Some(&json!({
            "autonomyMode":"balanced",
            "clientTaskId":Uuid::new_v4(),
            "executionProfile":"everyday",
            "request":"Open the browser for the compatibility test.",
            "taskId":Uuid::new_v4()
        })),
    )
    .await;
    assert_status(&durable_task, StatusCode::CREATED);
    let durable_task_id = durable_task.json()["id"]
        .as_str()
        .expect("durable task id")
        .to_owned();
    assert_status(
        &send(&router, Method::GET, "/v1/tasks", Some(&owner_token), None).await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            &format!("/v1/tasks/{durable_task_id}"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            &format!("/v1/tasks/{durable_task_id}/events?after=-1"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    let (event_status, event_headers) = send_without_collecting(
        &router,
        &format!("/v1/tasks/{durable_task_id}/events?after=0"),
        &owner_token,
    )
    .await;
    assert_eq!(event_status, StatusCode::OK);
    assert!(
        event_headers["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/event-stream")
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/tasks/{durable_task_id}/steering"),
            Some(&owner_token),
            Some(&json!({
                "clientTurnId":Uuid::new_v4(),
                "instruction":"Keep the action read-only."
            })),
        )
        .await,
        StatusCode::ACCEPTED,
    );
    let worker = send(
        &router,
        Method::POST,
        "/v1/desktop-worker/connect",
        Some(&owner_token),
        Some(&json!({
            "protocolVersion":2,
            "schemaDigest":TOOL_SCHEMA_DIGEST.as_str(),
            "tools":[{"operations":["launch"],"toolId":"application.launch"}]
        })),
    )
    .await;
    assert_status(&worker, StatusCode::CREATED);
    let worker_id = worker.json()["id"]
        .as_str()
        .expect("worker session id")
        .to_owned();
    let (worker_event_status, _) = send_without_collecting(
        &router,
        &format!("/v1/desktop-worker/events?workerSessionId={worker_id}"),
        &owner_token,
    )
    .await;
    assert_eq!(worker_event_status, StatusCode::OK);
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/desktop-worker/{worker_id}/executing"),
            Some(&owner_token),
            Some(&json!({})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/desktop-worker/{worker_id}/result"),
            Some(&owner_token),
            Some(&json!({})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/desktop-worker/{worker_id}/heartbeat"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/desktop-worker/{worker_id}/disconnect"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/tasks/{durable_task_id}/cancel"),
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::OK,
    );

    let refreshed = send(
        &router,
        Method::POST,
        "/v1/auth/session/refresh",
        Some(&owner_token),
        None,
    )
    .await;
    assert_status(&refreshed, StatusCode::OK);
    let refreshed_token = refreshed.json()["accessToken"]
        .as_str()
        .expect("refreshed token")
        .to_owned();
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/access-code-redemptions/me",
            Some(&owner_token),
            None,
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    assert_status(
        &send(
            &router,
            Method::DELETE,
            "/v1/auth/session",
            Some(&refreshed_token),
            None,
        )
        .await,
        StatusCode::NO_CONTENT,
    );

    assert_status(
        &send(
            &router,
            Method::PATCH,
            "/v1/admin/users/http-participant/access",
            Some(ADMIN_TOKEN),
            Some(&json!({"blocked":true})),
        )
        .await,
        StatusCode::OK,
    );
    assert_status(
        &send(
            &router,
            Method::GET,
            "/v1/access-code-redemptions/me",
            Some(&participant_token),
            None,
        )
        .await,
        StatusCode::UNAUTHORIZED,
    );
    assert_status(
        &send(
            &router,
            Method::PATCH,
            "/v1/admin/users/http-participant/access",
            Some(ADMIN_TOKEN),
            Some(&json!({"blocked":false})),
        )
        .await,
        StatusCode::OK,
    );

    state.shutdown.cancel();
    state.pool.close().await;
}

#[tokio::test]
#[ignore = "requires disposable local PostgreSQL and S3-compatible integration services"]
async fn rust_upload_routes_preserve_integrity_idempotency_and_worker_handoff() {
    let database_url = disposable_database_url();
    reset_database(&database_url).await;
    let bucket = format!("trocode-http-{}", Uuid::new_v4().simple());
    let object_store = local_object_store(bucket.clone());
    let s3 = s3_client(&object_store).await;
    s3.create_bucket()
        .bucket(&bucket)
        .send()
        .await
        .expect("create disposable HTTP upload bucket");
    let state = AppState::compose(test_config_with_store(database_url, Some(object_store)))
        .await
        .expect("compose upload application");
    let router = trocode_api::http::router(state.clone());
    let token = issue_user(&state, "http-upload-owner").await;
    activate_basic(&router, &state, "http-upload-owner", &token).await;
    let space = send(
        &router,
        Method::POST,
        "/v1/spaces",
        Some(&token),
        Some(&json!({
            "clientId":Uuid::new_v4(),
            "description":"Upload integration",
            "name":"Upload compatibility",
            "purposeLabel":"migration"
        })),
    )
    .await;
    assert_status(&space, StatusCode::CREATED);
    let space_id = space.json()["space"]["id"]
        .as_str()
        .expect("upload space id")
        .to_owned();
    let bytes = b"Searchable Rust upload route integration content.".to_vec();
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let client_id = Uuid::new_v4();
    let file = json!({
        "byteSize":bytes.len(),
        "clientId":client_id,
        "displayName":"integration.txt",
        "mediaType":"text/plain",
        "relativePath":"fixtures/integration.txt",
        "role":"reference",
        "sha256":sha256
    });
    let initiated = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/uploads/initiate"),
        Some(&token),
        Some(&json!({"files":[file.clone()]})),
    )
    .await;
    assert_status(&initiated, StatusCode::CREATED);
    let initiated = initiated.json();
    let version_id = initiated["uploads"][0]["sourceVersionId"]
        .as_str()
        .expect("uploaded source version")
        .to_owned();
    let upload_url = initiated["uploads"][0]["upload"]["url"]
        .as_str()
        .expect("upload URL");
    let mut upload = reqwest::Client::new().put(upload_url).body(bytes.clone());
    for (name, value) in initiated["uploads"][0]["upload"]["headers"]
        .as_object()
        .expect("upload headers")
    {
        upload = upload.header(name, value.as_str().expect("upload header value"));
    }
    let upload = upload.send().await.expect("send presigned upload");
    assert!(upload.status().is_success());
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/uploads/complete",
            Some(&token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "sourceVersionId":version_id
            })),
        )
        .await,
        StatusCode::ACCEPTED,
    );
    let worker = IngestionWorker::new(
        state.pool.clone(),
        state
            .knowledge
            .object_store
            .clone()
            .expect("configured upload object store"),
    );
    assert!(worker.run_once().await.expect("ingest HTTP upload"));
    let sources = send(
        &router,
        Method::GET,
        &format!("/v1/spaces/{space_id}/sources"),
        Some(&token),
        None,
    )
    .await;
    assert_status(&sources, StatusCode::OK);
    assert_eq!(
        sources.json()["items"][0]["latestVersion"]["state"],
        "ready"
    );
    let repeated = send(
        &router,
        Method::POST,
        &format!("/v1/spaces/{space_id}/uploads/initiate"),
        Some(&token),
        Some(&json!({"files":[file.clone()]})),
    )
    .await;
    assert_status(&repeated, StatusCode::CREATED);
    assert_eq!(repeated.json()["uploads"][0]["state"], "ready");
    assert!(repeated.json()["uploads"][0]["upload"].is_null());
    let mut conflicting = file;
    conflicting["sha256"] = Value::String("0".repeat(64));
    assert_status(
        &send(
            &router,
            Method::POST,
            &format!("/v1/spaces/{space_id}/uploads/initiate"),
            Some(&token),
            Some(&json!({"files":[conflicting]})),
        )
        .await,
        StatusCode::CONFLICT,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/uploads/complete",
            Some(&token),
            Some(&json!({"sourceVersionId":version_id})),
        )
        .await,
        StatusCode::BAD_REQUEST,
    );
    assert_status(
        &send(
            &router,
            Method::POST,
            "/v1/uploads/complete",
            Some(&token),
            Some(&json!({
                "clientId":Uuid::new_v4(),
                "sourceVersionId":version_id
            })),
        )
        .await,
        StatusCode::ACCEPTED,
    );

    let version: Uuid = version_id.parse().unwrap();
    let object_key: String =
        query_scalar("SELECT object_key FROM knowledge_source_versions WHERE id=$1")
            .bind(version)
            .fetch_one(&state.pool)
            .await
            .expect("private object key for fixture cleanup");
    s3.delete_object()
        .bucket(&bucket)
        .key(object_key)
        .send()
        .await
        .expect("delete HTTP upload fixture");
    s3.delete_bucket()
        .bucket(&bucket)
        .send()
        .await
        .expect("delete disposable HTTP upload bucket");
    state.shutdown.cancel();
    state.pool.close().await;
}
