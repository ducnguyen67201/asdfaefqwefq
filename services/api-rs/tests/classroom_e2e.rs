use std::{
    env, fs,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{Arc, OnceLock},
};

use axum::{
    Router,
    body::Body,
    extract::ConnectInfo,
    http::{Method, Request, StatusCode, header},
};
use hmac::{Hmac, KeyInit, Mac};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sha2::Sha256;
use tower::ServiceExt;
use trocode_api::{
    app_with_classroom,
    classroom::ClassroomService,
    database::{PgPool, PgPoolOptions, query, query_scalar, raw_sql},
};
use uuid::Uuid;

const HMAC_KEY: &str = "rust-classroom-e2e-hmac-key-32-bytes";

#[tokio::test]
async fn teacher_and_student_complete_a_live_classroom_over_http() {
    let Some(database_url) = env::var("TEST_DATABASE_URL")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    else {
        eprintln!("TEST_DATABASE_URL is not configured; Rust PostgreSQL E2E skipped.");
        return;
    };
    let pool = PgPoolOptions::new()
        .max_connections(8)
        .connect(&database_url)
        .await
        .expect("test PostgreSQL must be reachable");
    apply_migrations(&pool).await;
    let fixture = Fixture::create(&pool).await;
    let service = Arc::new(ClassroomService::new(pool.clone(), HMAC_KEY));
    service
        .verify_schema()
        .await
        .expect("migration 018 must exist");
    let router = app_with_classroom("e2e", service);

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

    let load_users = create_load_users(&pool, 200).await;
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
        .extension(ConnectInfo(e2e_peer()));
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

fn e2e_peer() -> SocketAddr {
    static PEER: OnceLock<SocketAddr> = OnceLock::new();
    *PEER.get_or_init(|| {
        let bytes = *Uuid::new_v4().as_bytes();
        SocketAddr::new(IpAddr::V4(Ipv4Addr::new(198, 18, bytes[0], bytes[1])), 443)
    })
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
            r#"INSERT INTO users (id,email,name,plan,free_access_started_at)
               VALUES ($1,$2,'Rust E2E teacher','basic',NOW()),
                      ($3,$4,'Rust E2E student','basic',NOW())"#,
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

async fn apply_migrations(pool: &PgPool) {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../api/migrations");
    let mut files: Vec<_> = fs::read_dir(directory)
        .expect("migration directory must exist")
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".sql"))
        })
        .collect();
    files.sort();
    for path in files {
        let migration = fs::read_to_string(path).unwrap();
        raw_sql(&migration).execute(pool).await.unwrap();
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

async fn create_load_users(pool: &PgPool, count: usize) -> Vec<(String, String)> {
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
        r#"INSERT INTO users (id,email,name,plan,free_access_started_at)
           SELECT id,id||'@example.test','Rust load student','basic',NOW()
           FROM UNNEST($1::text[]) AS ids(id)"#,
    )
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
