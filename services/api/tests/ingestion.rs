use std::time::Duration;

use aws_credential_types::Credentials;
use aws_sdk_s3::{Client as S3Client, config::Region};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};
use trocode_api::{
    Row as _,
    config::ObjectStoreConfig,
    db,
    knowledge::{IngestionWorker, ObjectStore},
    postgres::PgPoolOptions,
    query, query_scalar,
};
use url::Url;
use uuid::Uuid;

struct S3Fixture {
    access_key_id: String,
    bucket: String,
    endpoint: String,
    region: String,
    secret_access_key: String,
}

impl S3Fixture {
    fn from_environment() -> Self {
        let endpoint = std::env::var("TROCODE_TEST_S3_ENDPOINT")
            .expect("TROCODE_TEST_S3_ENDPOINT is required for this ignored integration test");
        let parsed = Url::parse(&endpoint).expect("test S3 endpoint must be a URL");
        assert!(
            matches!(parsed.host_str(), Some("127.0.0.1" | "localhost")),
            "refusing to use a non-local S3 integration endpoint"
        );
        Self {
            access_key_id: std::env::var("TROCODE_TEST_S3_ACCESS_KEY_ID")
                .unwrap_or_else(|_| "trocode_test_access".to_owned()),
            bucket: std::env::var("TROCODE_TEST_S3_BUCKET")
                .unwrap_or_else(|_| "trocode-rust-integration".to_owned()),
            endpoint,
            region: std::env::var("TROCODE_TEST_S3_REGION")
                .unwrap_or_else(|_| "us-east-1".to_owned()),
            secret_access_key: std::env::var("TROCODE_TEST_S3_SECRET_ACCESS_KEY")
                .unwrap_or_else(|_| "trocode_test_secret_password".to_owned()),
        }
    }

    fn object_store_config(&self) -> ObjectStoreConfig {
        ObjectStoreConfig {
            access_key_id: self.access_key_id.clone(),
            bucket: self.bucket.clone(),
            endpoint: Some(self.endpoint.clone()),
            force_path_style: true,
            region: self.region.clone(),
            secret_access_key: self.secret_access_key.clone(),
        }
    }

    async fn admin_client(&self) -> S3Client {
        let credentials = Credentials::new(
            &self.access_key_id,
            &self.secret_access_key,
            None,
            None,
            "trocode-integration-test",
        );
        let shared = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(Region::new(self.region.clone()))
            .credentials_provider(credentials)
            .load()
            .await;
        let config = aws_sdk_s3::config::Builder::from(&shared)
            .endpoint_url(&self.endpoint)
            .force_path_style(true)
            .build();
        S3Client::from_conf(config)
    }
}

async fn require_success(response: reqwest::Response) -> reqwest::Response {
    if response.status().is_success() {
        return response;
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    panic!("S3 request failed with {status}: {body}");
}

#[tokio::test]
#[ignore = "requires a disposable local S3-compatible TROCODE_TEST_S3_ENDPOINT"]
async fn presigned_put_head_and_get_preserve_exact_object_contract() {
    let fixture = S3Fixture::from_environment();
    let admin = fixture.admin_client().await;
    let _ = admin.delete_bucket().bucket(&fixture.bucket).send().await;
    admin
        .create_bucket()
        .bucket(&fixture.bucket)
        .send()
        .await
        .expect("create disposable test bucket");

    let store = ObjectStore::new(&fixture.object_store_config()).await;
    let key = "users/test-user/spaces/test-space/sources/test-source/version.txt";
    let bytes = b"TroCode Rust S3 integration fixture\n".to_vec();
    let checksum = STANDARD.encode(Sha256::digest(&bytes));
    let ticket = store
        .put_ticket(
            key,
            i64::try_from(bytes.len()).expect("bounded bytes"),
            "text/plain",
            &checksum,
        )
        .await
        .expect("presigned PUT ticket");
    assert_eq!(ticket.expires_in_seconds, 300);
    assert_eq!(ticket.headers["content-length"], bytes.len().to_string());
    assert_eq!(ticket.headers["content-type"], "text/plain");
    assert_eq!(ticket.headers["x-amz-checksum-sha256"], checksum);

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .expect("HTTP client");
    let mut request = client.put(&ticket.url).body(bytes.clone());
    for (name, value) in &ticket.headers {
        request = request.header(*name, value);
    }
    require_success(request.send().await.expect("send presigned PUT")).await;

    let head = store.head(key).await.expect("HEAD object");
    assert_eq!(head.byte_size, i64::try_from(bytes.len()).unwrap());
    assert_eq!(head.media_type.as_deref(), Some("text/plain"));
    assert_eq!(head.checksum_base64.as_deref(), Some(checksum.as_str()));

    let get_ticket = store.get_ticket(key).await.expect("presigned GET ticket");
    assert_eq!(get_ticket.expires_in_seconds, 120);
    let downloaded = require_success(
        client
            .get(&get_ticket.url)
            .send()
            .await
            .expect("send presigned GET"),
    )
    .await
    .bytes()
    .await
    .expect("read presigned GET");
    assert_eq!(downloaded.as_ref(), bytes);
    assert_eq!(store.get(key).await.expect("authenticated GET"), bytes);

    admin
        .delete_object()
        .bucket(&fixture.bucket)
        .key(key)
        .send()
        .await
        .expect("delete fixture object");
    admin
        .delete_bucket()
        .bucket(&fixture.bucket)
        .send()
        .await
        .expect("delete fixture bucket");
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

async fn reset_database() -> trocode_api::PgPool {
    let pool = PgPoolOptions::new()
        .max_connections(4)
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
    pool
}

async fn upload(store: &ObjectStore, key: &str, bytes: &[u8], media_type: &str) {
    let checksum = STANDARD.encode(Sha256::digest(bytes));
    let ticket = store
        .put_ticket(
            key,
            i64::try_from(bytes.len()).expect("bounded fixture"),
            media_type,
            &checksum,
        )
        .await
        .expect("create worker upload ticket");
    let mut request = reqwest::Client::new().put(&ticket.url).body(bytes.to_vec());
    for (name, value) in ticket.headers {
        request = request.header(name, value);
    }
    require_success(request.send().await.expect("upload worker fixture")).await;
}

async fn seed_version(
    pool: &trocode_api::PgPool,
    space: Uuid,
    key: &str,
    bytes: &[u8],
    expected_sha256: &str,
) -> Uuid {
    let source: Uuid = query_scalar("INSERT INTO knowledge_sources(client_id,space_id,display_name,virtual_path,role,created_by)VALUES($1,$2,$3,$4,'reference','ingestion-user')RETURNING id")
        .bind(Uuid::new_v4())
        .bind(space)
        .bind(format!("{}.txt", Uuid::new_v4()))
        .bind(format!("fixtures/{}.txt", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("seed source");
    let version: Uuid = query_scalar("INSERT INTO knowledge_source_versions(source_id,version_number,state,media_type,byte_size,sha256,object_key,created_by)VALUES($1,1,'processing','text/plain',$2,$3,$4,'ingestion-user')RETURNING id")
        .bind(source)
        .bind(i64::try_from(bytes.len()).expect("bounded fixture"))
        .bind(expected_sha256)
        .bind(key)
        .fetch_one(pool)
        .await
        .expect("seed source version");
    query("INSERT INTO knowledge_ingestion_jobs(source_version_id)VALUES($1)")
        .bind(version)
        .execute(pool)
        .await
        .expect("seed ingestion job");
    version
}

#[tokio::test]
#[ignore = "requires disposable local PostgreSQL and S3-compatible integration services"]
async fn ingestion_worker_completes_text_and_fails_closed_on_permanent_corruption() {
    let fixture = S3Fixture::from_environment();
    let admin = fixture.admin_client().await;
    let _ = admin.delete_bucket().bucket(&fixture.bucket).send().await;
    admin
        .create_bucket()
        .bucket(&fixture.bucket)
        .send()
        .await
        .expect("create disposable worker bucket");
    let store = ObjectStore::new(&fixture.object_store_config()).await;
    let pool = reset_database().await;
    query("INSERT INTO users(id,email,name,plan)VALUES('ingestion-user','ingestion@example.test','Ingestion','basic')")
        .execute(&pool)
        .await
        .expect("seed ingestion user");
    let space: Uuid = query_scalar("INSERT INTO knowledge_spaces(client_id,owner_user_id,name)VALUES($1,'ingestion-user','Ingestion fixtures')RETURNING id")
        .bind(Uuid::new_v4())
        .fetch_one(&pool)
        .await
        .expect("seed ingestion space");
    let worker = IngestionWorker::new(pool.clone(), store.clone());

    let success_key = "worker/success.txt";
    let success_bytes = format!(
        "Rust ingestion compatibility {} tail",
        "bounded searchable content ".repeat(80)
    )
    .into_bytes();
    upload(&store, success_key, &success_bytes, "text/plain").await;
    let success_sha = format!("{:x}", Sha256::digest(&success_bytes));
    let success_version =
        seed_version(&pool, space, success_key, &success_bytes, &success_sha).await;
    assert!(worker.run_once().await.expect("process valid text"));
    let success_state: String =
        query_scalar("SELECT state FROM knowledge_source_versions WHERE id=$1")
            .bind(success_version)
            .fetch_one(&pool)
            .await
            .unwrap();
    let chunk_count: i64 = query_scalar(
        "SELECT COUNT(*)::bigint FROM knowledge_source_chunks WHERE source_version_id=$1",
    )
    .bind(success_version)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(success_state, "ready");
    assert!(
        chunk_count >= 2,
        "long text should be split into overlapping chunks"
    );
    assert!(!worker.run_once().await.expect("empty queue"));

    let mismatch_key = "worker/checksum-mismatch.txt";
    let mismatch_bytes = b"checksum mismatch fixture".to_vec();
    upload(&store, mismatch_key, &mismatch_bytes, "text/plain").await;
    let mismatch_version =
        seed_version(&pool, space, mismatch_key, &mismatch_bytes, &"0".repeat(64)).await;
    assert!(worker.run_once().await.expect("process checksum mismatch"));
    let row = query("SELECT state,error_code FROM knowledge_source_versions WHERE id=$1")
        .bind(mismatch_version)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("state"), "failed");
    assert_eq!(
        row.get::<Option<String>, _>("error_code").as_deref(),
        Some("object_checksum_mismatch")
    );

    let invalid_key = "worker/invalid-utf8.txt";
    let invalid_bytes = vec![0xff, 0xfe, 0xfd];
    upload(&store, invalid_key, &invalid_bytes, "text/plain").await;
    let invalid_sha = format!("{:x}", Sha256::digest(&invalid_bytes));
    let invalid_version =
        seed_version(&pool, space, invalid_key, &invalid_bytes, &invalid_sha).await;
    assert!(worker.run_once().await.expect("process invalid UTF-8"));
    let row = query("SELECT state,error_code FROM knowledge_source_versions WHERE id=$1")
        .bind(invalid_version)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("state"), "failed");
    assert_eq!(
        row.get::<Option<String>, _>("error_code").as_deref(),
        Some("invalid_text")
    );

    let missing_key = "worker/missing.txt";
    let missing_bytes = b"missing object".to_vec();
    let missing_sha = format!("{:x}", Sha256::digest(&missing_bytes));
    let missing_version =
        seed_version(&pool, space, missing_key, &missing_bytes, &missing_sha).await;
    assert!(
        worker
            .run_once()
            .await
            .expect("process transient object error")
    );
    let row = query("SELECT state,error_code,attempt_count FROM knowledge_ingestion_jobs WHERE source_version_id=$1")
        .bind(missing_version)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("state"), "retry");
    assert_eq!(
        row.get::<Option<String>, _>("error_code").as_deref(),
        Some("extraction_failed")
    );
    assert_eq!(row.get::<i32, _>("attempt_count"), 1);

    for key in [success_key, mismatch_key, invalid_key] {
        admin
            .delete_object()
            .bucket(&fixture.bucket)
            .key(key)
            .send()
            .await
            .expect("delete worker fixture object");
    }
    admin
        .delete_bucket()
        .bucket(&fixture.bucket)
        .send()
        .await
        .expect("delete disposable worker bucket");
    pool.close().await;
}
