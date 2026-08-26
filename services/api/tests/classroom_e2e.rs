use std::{collections::BTreeSet, time::Duration};

use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use hmac::{Hmac, Mac};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sha2::Sha256;
use tower::ServiceExt;
use trocode_api::{
    PgPool,
    app::AppState,
    config::{
        AdminConfig, AgentRuntimeConfig, AgentRuntimeV3Mode, Config, CostGuardConfig,
        CostGuardMode, KnowledgeConfig, RolloutConfig,
    },
    postgres::PgPoolOptions,
    query, query_scalar,
};
use url::Url;
use uuid::Uuid;

const HMAC_KEY: &str = "rust-classroom-e2e-hmac-key-32-bytes";

#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn teacher_and_student_complete_a_live_classroom_over_http() {
    let database_url = disposable_database_url();
    reset_database(&database_url).await;
    let state = AppState::compose(test_config(database_url))
        .await
        .expect("compose Rust classroom application");
    let pool = state.pool.clone();
    let fixture = Fixture::create(&pool).await;
    let router = trocode_api::http::router(state.clone());

    let room_client_id = Uuid::new_v4();
    let room = call(
        &router,
        Method::POST,
        &format!(
            "/v1/spaces/{}/runs/{}/room-code",
            fixture.space_id, fixture.run_id
        ),
        Some(&fixture.teacher_token),
        Some(json!({"clientId":room_client_id,"maxUses":200,"expiresAt":null})),
    )
    .await;
    assert_eq!(room.status, StatusCode::CREATED);
    let room_code = room.body["code"].as_str().unwrap().to_owned();
    assert_eq!(room.body["newlyCreated"], true);

    let repeated_room = call(
        &router,
        Method::POST,
        &format!(
            "/v1/spaces/{}/runs/{}/room-code",
            fixture.space_id, fixture.run_id
        ),
        Some(&fixture.teacher_token),
        Some(json!({"clientId":room_client_id,"maxUses":200,"expiresAt":null})),
    )
    .await;
    assert_eq!(repeated_room.status, StatusCode::OK);
    assert_eq!(repeated_room.body["code"], room_code);
    assert_eq!(repeated_room.body["newlyCreated"], false);

    let unassigned_id = format!("rust-e2e-unassigned-{}", Uuid::new_v4());
    let unassigned_token = token('u');
    query(
        r#"INSERT INTO users (id,email,name,plan,free_access_started_at)
           VALUES ($1,$2,'Rust E2E unassigned','basic',NOW())"#,
    )
    .bind(&unassigned_id)
    .bind(format!("{unassigned_id}@example.test"))
    .execute(&pool)
    .await
    .unwrap();
    query(
        r#"INSERT INTO device_sessions (user_id,token_digest,expires_at)
           VALUES ($1,$2,NOW()+INTERVAL '1 hour')"#,
    )
    .bind(&unassigned_id)
    .bind(session_digest(&unassigned_token).as_slice())
    .execute(&pool)
    .await
    .unwrap();
    let role_rejected = call(
        &router,
        Method::POST,
        "/v1/live-rooms/join",
        Some(&unassigned_token),
        Some(json!({"clientId":Uuid::new_v4(),"code":room_code})),
    )
    .await;
    assert_eq!(role_rejected.status, StatusCode::FORBIDDEN);
    assert_eq!(role_rejected.body["code"], "classroom_role_mismatch");

    let unrostered = call(
        &router,
        Method::POST,
        "/v1/live-rooms/join",
        Some(&fixture.student_token),
        Some(json!({"clientId":Uuid::new_v4(),"code":room_code})),
    )
    .await;
    assert_eq!(unrostered.status, StatusCode::FORBIDDEN);
    assert_eq!(unrostered.body["code"], "classroom_membership_required");

    let rostered = call(
        &router,
        Method::POST,
        &format!("/v1/spaces/{}/members/bulk", fixture.space_id),
        Some(&fixture.teacher_token),
        Some(json!({
            "clientId":Uuid::new_v4(),
            "emails":[format!("{}@example.test", fixture.student_id)],
            "role":"participant"
        })),
    )
    .await;
    assert_eq!(rostered.status, StatusCode::OK);
    assert_eq!(rostered.body["addedEmails"].as_array().unwrap().len(), 1);

    let joined = call(
        &router,
        Method::POST,
        "/v1/live-rooms/join",
        Some(&fixture.student_token),
        Some(json!({"clientId":Uuid::new_v4(),"code":room_code})),
    )
    .await;
    assert_eq!(joined.status, StatusCode::OK);
    assert_eq!(joined.body["run"]["status"], "lobby");
    assert_eq!(joined.body["activity"]["title"], "Rust loops lab");
    assert_eq!(joined.body["activity"]["launchTarget"], "current_surface");
    let attempt_id = Uuid::parse_str(joined.body["attemptId"].as_str().unwrap()).unwrap();

    let current = call(
        &router,
        Method::GET,
        "/v1/live-rooms/current",
        Some(&fixture.student_token),
        None,
    )
    .await;
    assert_eq!(current.status, StatusCode::OK);
    assert_eq!(current.body["session"]["attemptId"], attempt_id.to_string());

    let lobby_ready = call(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/ready"),
        Some(&fixture.student_token),
        Some(json!({"clientId":Uuid::new_v4()})),
    )
    .await;
    assert_eq!(lobby_ready.status, StatusCode::CONFLICT);
    assert_eq!(lobby_ready.body["code"], "run_not_open");

    let opened = call(
        &router,
        Method::POST,
        &format!(
            "/v1/spaces/{}/runs/{}/open",
            fixture.space_id, fixture.run_id
        ),
        Some(&fixture.teacher_token),
        None,
    )
    .await;
    assert_eq!(opened.status, StatusCode::OK);
    assert_eq!(opened.body["state"], "open");

    let ready_without_agent = call(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/ready"),
        Some(&fixture.student_token),
        Some(json!({"clientId":Uuid::new_v4()})),
    )
    .await;
    assert_eq!(ready_without_agent.body["state"], "ready_for_review");

    let returned = call(
        &router,
        Method::POST,
        &format!(
            "/v1/spaces/{}/runs/{}/attempts/{attempt_id}/review",
            fixture.space_id, fixture.run_id
        ),
        Some(&fixture.teacher_token),
        Some(json!({"clientId":Uuid::new_v4(),"action":"return"})),
    )
    .await;
    assert_eq!(returned.body["state"], "in_progress");

    let directive = call(
        &router,
        Method::POST,
        &format!(
            "/v1/spaces/{}/runs/{}/directives",
            fixture.space_id, fixture.run_id
        ),
        Some(&fixture.teacher_token),
        Some(json!({
            "clientId":Uuid::new_v4(),
            "directive":{
                "kind":"open_url",
                "instruction":"Open the published loop exercise.",
                "criterionIds":["loop"],
                "url":"https://class.example/loops?part=1"
            }
        })),
    )
    .await;
    assert_eq!(directive.status, StatusCode::CREATED);
    assert_eq!(directive.body["delivery"], "auto_eligible");
    let directive_id = Uuid::parse_str(directive.body["id"].as_str().unwrap()).unwrap();

    let listed = call(
        &router,
        Method::GET,
        &format!("/v1/attempts/{attempt_id}/directives?sinceSequence=0"),
        Some(&fixture.student_token),
        None,
    )
    .await;
    assert_eq!(listed.status, StatusCode::OK);
    assert_eq!(listed.body["items"][0]["id"], directive_id.to_string());

    let claim_client_id = Uuid::new_v4();
    let first_claim = call(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/directives/{directive_id}/claim"),
        Some(&fixture.student_token),
        Some(json!({"clientId":claim_client_id})),
    )
    .await;
    let second_claim = call(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/directives/{directive_id}/claim"),
        Some(&fixture.student_token),
        Some(json!({"clientId":Uuid::new_v4()})),
    )
    .await;
    assert_eq!(first_claim.body["execute"], true);
    assert_eq!(second_claim.body, json!({"execute":false}));

    let help = call(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/help"),
        Some(&fixture.student_token),
        Some(json!({"clientId":Uuid::new_v4()})),
    )
    .await;
    assert_eq!(help.status, StatusCode::OK);
    assert_eq!(help.body["state"], "blocked");

    let task_id = Uuid::new_v4();
    let work_session = call(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/work-sessions"),
        Some(&fixture.student_token),
        Some(json!({
            "clientId":Uuid::new_v4(),
            "taskId":task_id,
            "launchKind":"current_surface",
            "purpose":"help"
        })),
    )
    .await;
    assert_eq!(work_session.status, StatusCode::CREATED);
    assert_eq!(work_session.body["purpose"], "help");

    let client_task_id = Uuid::new_v4();
    let classroom_task = call(
        &router,
        Method::POST,
        "/v1/tasks",
        Some(&fixture.student_token),
        Some(json!({
            "clientTaskId":client_task_id,
            "taskId":task_id,
            "request":"Help me understand the next step.",
            "autonomyMode":"balanced",
            "executionProfile":"everyday",
            "workspaceSelectionId":null,
            "activityAttemptId":attempt_id,
            "activityIntent":"help"
        })),
    )
    .await;
    assert_eq!(classroom_task.status, StatusCode::CREATED);
    assert_eq!(
        classroom_task.body["activity"]["attemptId"],
        attempt_id.to_string()
    );
    assert_eq!(classroom_task.body["activity"]["purpose"], "help");
    assert_eq!(
        classroom_task.body["activity"]["currentDirective"]["id"],
        directive_id.to_string()
    );
    assert_eq!(
        classroom_task.body["activity"]["priorProgress"]["sessionCount"],
        1
    );

    let replayed_task = call(
        &router,
        Method::POST,
        "/v1/tasks",
        Some(&fixture.student_token),
        Some(json!({
            "clientTaskId":client_task_id,
            "taskId":task_id,
            "request":"Help me understand the next step.",
            "autonomyMode":"balanced",
            "executionProfile":"everyday",
            "workspaceSelectionId":null,
            "activityAttemptId":attempt_id,
            "activityIntent":"help"
        })),
    )
    .await;
    assert_eq!(replayed_task.status, StatusCode::OK);
    assert_eq!(replayed_task.body["id"], classroom_task.body["id"]);
    assert_eq!(
        replayed_task.body["activity"],
        classroom_task.body["activity"]
    );

    let dashboard_response = dashboard(&router, &fixture).await;
    assert_eq!(
        dashboard_response["participants"][0]["status"],
        "needs_help"
    );
    assert_eq!(
        dashboard_response["helpQueue"][0]["attemptId"],
        attempt_id.to_string()
    );

    let resolved = call(
        &router,
        Method::POST,
        &format!(
            "/v1/spaces/{}/runs/{}/attempts/{attempt_id}/help/resolve",
            fixture.space_id, fixture.run_id
        ),
        Some(&fixture.teacher_token),
        Some(json!({"clientId":Uuid::new_v4()})),
    )
    .await;
    assert_eq!(resolved.body["state"], "in_progress");
    assert_eq!(resolved.body["resolved"], true);

    let ready = call(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/ready"),
        Some(&fixture.student_token),
        Some(json!({"clientId":Uuid::new_v4()})),
    )
    .await;
    assert_eq!(ready.body["state"], "ready_for_review");

    let review_client_id = Uuid::new_v4();
    let reviewed = call(
        &router,
        Method::POST,
        &format!(
            "/v1/spaces/{}/runs/{}/attempts/{attempt_id}/review",
            fixture.space_id, fixture.run_id
        ),
        Some(&fixture.teacher_token),
        Some(json!({"clientId":review_client_id,"action":"complete"})),
    )
    .await;
    assert_eq!(reviewed.body["state"], "completed");

    let terminal_work = call(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/work-sessions"),
        Some(&fixture.student_token),
        Some(json!({
            "clientId":Uuid::new_v4(),
            "taskId":Uuid::new_v4(),
            "launchKind":"current_surface",
            "purpose":"check"
        })),
    )
    .await;
    assert_eq!(terminal_work.status, StatusCode::CONFLICT);
    assert_eq!(terminal_work.body["code"], "attempt_not_active");

    let wrong_run_replay = call(
        &router,
        Method::POST,
        &format!(
            "/v1/spaces/{}/runs/{}/attempts/{attempt_id}/review",
            fixture.space_id,
            Uuid::new_v4()
        ),
        Some(&fixture.teacher_token),
        Some(json!({"clientId":review_client_id,"action":"complete"})),
    )
    .await;
    assert_eq!(wrong_run_replay.status, StatusCode::NOT_FOUND);

    let left = call(
        &router,
        Method::POST,
        &format!("/v1/attempts/{attempt_id}/live-session/leave"),
        Some(&fixture.student_token),
        Some(json!({"clientId":Uuid::new_v4()})),
    )
    .await;
    assert_eq!(left.status, StatusCode::OK);
    let final_dashboard = dashboard(&router, &fixture).await;
    assert_eq!(final_dashboard["participants"][0]["status"], "completed");

    let load_users = create_load_users(&pool, fixture.space_id, 200).await;
    let mut joins = tokio::task::JoinSet::new();
    for (_, token) in &load_users {
        let router = router.clone();
        let token = token.clone();
        let code = room_code.clone();
        joins.spawn(async move {
            call(
                &router,
                Method::POST,
                "/v1/live-rooms/join",
                Some(&token),
                Some(json!({"clientId":Uuid::new_v4(),"code":code})),
            )
            .await
            .status
        });
    }
    let mut joined_count = 0;
    let mut rejected_count = 0;
    while let Some(status) = joins.join_next().await {
        match status.unwrap() {
            StatusCode::OK => joined_count += 1,
            StatusCode::BAD_REQUEST => rejected_count += 1,
            other => panic!("unexpected load-join status: {other}"),
        }
    }
    assert_eq!(joined_count, 199);
    assert_eq!(rejected_count, 1);
    let admitted_count =
        query_scalar::<_, i64>("SELECT COUNT(*) FROM knowledge_run_participations WHERE run_id=$1")
            .bind(fixture.run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(admitted_count, 200);

    let unauthenticated = call(&router, Method::GET, "/v1/live-rooms/current", None, None).await;
    assert_eq!(unauthenticated.status, StatusCode::UNAUTHORIZED);
    assert_eq!(unauthenticated.body["code"], "authentication_required");
    fixture.cleanup(&pool).await;
    let load_user_ids: Vec<_> = load_users.into_iter().map(|(id, _)| id).collect();
    query("DELETE FROM users WHERE id=ANY($1::text[])")
        .bind(load_user_ids)
        .execute(&pool)
        .await
        .unwrap();
    query("DELETE FROM users WHERE id=$1")
        .bind(unassigned_id)
        .execute(&pool)
        .await
        .unwrap();
    state.shutdown.cancel();
    state.pool.close().await;
}

struct ResponseBody {
    status: StatusCode,
    body: Value,
}

async fn call(
    router: &Router,
    method: Method,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> ResponseBody {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "api.example.test")
        .header("x-forwarded-for", "198.18.0.1");
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let request_body = if let Some(body) = body {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
        Body::from(serde_json::to_vec(&body).unwrap())
    } else {
        Body::empty()
    };
    let response = router
        .clone()
        .oneshot(builder.body(request_body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    ResponseBody { status, body }
}

async fn dashboard(router: &Router, fixture: &Fixture) -> Value {
    let response = call(
        router,
        Method::GET,
        &format!(
            "/v1/spaces/{}/runs/{}/dashboard",
            fixture.space_id, fixture.run_id
        ),
        Some(&fixture.teacher_token),
        None,
    )
    .await;
    assert_eq!(response.status, StatusCode::OK);
    response.body
}

struct Fixture {
    teacher_id: String,
    teacher_token: String,
    student_id: String,
    student_token: String,
    space_id: Uuid,
    activity_id: Uuid,
    activity_version_id: Uuid,
    run_id: Uuid,
}

impl Fixture {
    async fn create(pool: &PgPool) -> Self {
        let suffix = Uuid::new_v4();
        let teacher_id = format!("rust-e2e-teacher-{suffix}");
        let student_id = format!("rust-e2e-student-{suffix}");
        let teacher_token = token('t');
        let student_token = token('s');
        query(
            r#"INSERT INTO users
                 (id,email,name,plan,free_access_started_at,classroom_role)
               VALUES ($1,$2,'Rust E2E teacher','basic',NOW(),'teacher'),
                      ($3,$4,'Rust E2E student','basic',NOW(),'student')"#,
        )
        .bind(&teacher_id)
        .bind(format!("{teacher_id}@example.test"))
        .bind(&student_id)
        .bind(format!("{student_id}@example.test"))
        .execute(pool)
        .await
        .unwrap();
        for (user_id, access_token) in
            [(&teacher_id, &teacher_token), (&student_id, &student_token)]
        {
            query(
                r#"INSERT INTO device_sessions (user_id,token_digest,expires_at)
                   VALUES ($1,$2,NOW()+INTERVAL '1 hour')"#,
            )
            .bind(user_id)
            .bind(session_digest(access_token).as_slice())
            .execute(pool)
            .await
            .unwrap();
        }
        let space_id = Uuid::new_v4();
        let activity_id = Uuid::new_v4();
        let activity_version_id = Uuid::new_v4();
        let run_id = Uuid::new_v4();
        let definition = json!({
            "title":"Rust loops lab",
            "objective":"Complete one bounded classroom exercise.",
            "instructions":"Open the exercise and practice loops.",
            "launchTarget":"current_surface",
            "guidancePolicy":{"answerReveal":"after_attempt","hintMode":"guided","maxHintLevel":2},
            "criteria":[{"id":"loop","title":"Use a loop","description":"","tags":[]}],
            "completionPolicy":{"requiresSubmission":false,"requiresFacilitatorConfirmation":true},
            "sessionPolicy":{"allowRoomJoin":true,"allowedOrigins":["https://class.example"]}
        });
        query(
            r#"INSERT INTO knowledge_spaces (id,client_id,owner_user_id,name,description)
               VALUES ($1,$2,$3,'Rust E2E room','Integration fixture')"#,
        )
        .bind(space_id)
        .bind(Uuid::new_v4())
        .bind(&teacher_id)
        .execute(pool)
        .await
        .unwrap();
        query("INSERT INTO knowledge_space_members (space_id,user_id,role) VALUES ($1,$2,'owner')")
            .bind(space_id)
            .bind(&teacher_id)
            .execute(pool)
            .await
            .unwrap();
        query(
            r#"INSERT INTO knowledge_activities
                 (id,client_id,space_id,state,draft_definition,created_by)
               VALUES ($1,$2,$3,'published',$4,$5)"#,
        )
        .bind(activity_id)
        .bind(Uuid::new_v4())
        .bind(space_id)
        .bind(&definition)
        .bind(&teacher_id)
        .execute(pool)
        .await
        .unwrap();
        query(
            r#"INSERT INTO knowledge_activity_versions
                 (id,activity_id,version_number,definition,content_hash,published_by)
               VALUES ($1,$2,1,$3,$4,$5)"#,
        )
        .bind(activity_version_id)
        .bind(activity_id)
        .bind(&definition)
        .bind("b".repeat(64))
        .bind(&teacher_id)
        .execute(pool)
        .await
        .unwrap();
        query(
            r#"INSERT INTO knowledge_activity_runs
                 (id,client_id,space_id,activity_version_id,mode,state,target_kind,
                  insight_policy,created_by)
               VALUES ($1,$2,$3,$4,'live','draft','room','explicit_and_operational',$5)"#,
        )
        .bind(run_id)
        .bind(Uuid::new_v4())
        .bind(space_id)
        .bind(activity_version_id)
        .bind(&teacher_id)
        .execute(pool)
        .await
        .unwrap();
        Self {
            teacher_id,
            teacher_token,
            student_id,
            student_token,
            space_id,
            activity_id,
            activity_version_id,
            run_id,
        }
    }

    async fn cleanup(self, pool: &PgPool) {
        let run_id = self.run_id;
        for statement in [
            "DELETE FROM knowledge_activity_run_events WHERE run_id=$1",
            "DELETE FROM knowledge_attempt_help_requests WHERE attempt_id IN (SELECT id FROM knowledge_activity_attempts WHERE run_id=$1)",
            "DELETE FROM knowledge_attempt_review_actions WHERE attempt_id IN (SELECT id FROM knowledge_activity_attempts WHERE run_id=$1)",
            "DELETE FROM knowledge_run_directive_claims WHERE directive_id IN (SELECT id FROM knowledge_run_directives WHERE run_id=$1)",
            "DELETE FROM knowledge_run_directives WHERE run_id=$1",
            "DELETE FROM knowledge_run_participations WHERE run_id=$1",
            "DELETE FROM knowledge_activity_work_sessions WHERE attempt_id IN (SELECT id FROM knowledge_activity_attempts WHERE run_id=$1)",
            "DELETE FROM knowledge_activity_attempts WHERE run_id=$1",
            "DELETE FROM knowledge_activity_assignments WHERE run_id=$1",
            "DELETE FROM knowledge_live_room_codes WHERE run_id=$1",
            "DELETE FROM knowledge_activity_runs WHERE id=$1",
        ] {
            query(statement).bind(run_id).execute(pool).await.unwrap();
        }
        query("DELETE FROM knowledge_activity_versions WHERE id=$1")
            .bind(self.activity_version_id)
            .execute(pool)
            .await
            .unwrap();
        query("DELETE FROM knowledge_activities WHERE id=$1")
            .bind(self.activity_id)
            .execute(pool)
            .await
            .unwrap();
        query("DELETE FROM knowledge_spaces WHERE id=$1")
            .bind(self.space_id)
            .execute(pool)
            .await
            .unwrap();
        query("DELETE FROM users WHERE id IN ($1,$2)")
            .bind(self.teacher_id)
            .bind(self.student_id)
            .execute(pool)
            .await
            .unwrap();
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
    query("DROP SCHEMA IF EXISTS public CASCADE")
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
    Config {
        admin: AdminConfig { access_token: None },
        agent_runtime: AgentRuntimeConfig {
            canary_users: BTreeSet::new(),
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
            rollout_percent: 100,
            v3_mode: AgentRuntimeV3Mode::Observe,
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
        database_pool_max: 16,
        database_url,
        eleven_labs_api_key: None,
        eleven_labs_model_id: "eleven_multilingual_v2".to_owned(),
        eleven_labs_voice_id: None,
        google_client_id: "classroom-e2e.apps.googleusercontent.com".to_owned(),
        knowledge_spaces: KnowledgeConfig { object_store: None },
        openai_api_key: "test-openai-key".to_owned(),
        openai_models: BTreeSet::from(["gpt-5.6-luna".to_owned()]),
        port: 0,
        railway_git_commit_sha: "classroom-e2e".to_owned(),
        session_duration_days: 30,
        session_token_hmac_key: HMAC_KEY.to_owned(),
    }
}

fn token(character: char) -> String {
    format!("tro_live_{}", character.to_string().repeat(43))
}

fn session_digest(token: &str) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(HMAC_KEY.as_bytes()).unwrap();
    mac.update(token.as_bytes());
    mac.finalize().into_bytes().into()
}

async fn create_load_users(pool: &PgPool, space_id: Uuid, count: usize) -> Vec<(String, String)> {
    let prefix = Uuid::new_v4();
    let users: Vec<_> = (0..count)
        .map(|index| {
            (
                format!("rust-load-{prefix}-{index}"),
                format!("tro_live_{:0>43}", index),
            )
        })
        .collect();
    let ids: Vec<_> = users.iter().map(|(id, _)| id.clone()).collect();
    query(
        r#"INSERT INTO users
             (id,email,name,plan,free_access_started_at,classroom_role)
           SELECT id,id||'@example.test','Rust load student','basic',NOW(),'student'
           FROM UNNEST($1::text[]) AS ids(id)"#,
    )
    .bind(&ids)
    .execute(pool)
    .await
    .unwrap();
    query(
        r#"INSERT INTO knowledge_space_members (space_id,user_id,role)
           SELECT $1,id,'participant' FROM UNNEST($2::text[]) AS ids(id)"#,
    )
    .bind(space_id)
    .bind(&ids)
    .execute(pool)
    .await
    .unwrap();
    let digests: Vec<Vec<u8>> = users
        .iter()
        .map(|(_, token)| session_digest(token).to_vec())
        .collect();
    query(
        r#"INSERT INTO device_sessions (user_id,token_digest,expires_at)
           SELECT id,digest,NOW()+INTERVAL '1 hour'
           FROM UNNEST($1::text[],$2::bytea[]) AS sessions(id,digest)"#,
    )
    .bind(ids)
    .bind(digests)
    .execute(pool)
    .await
    .unwrap();
    users
}
