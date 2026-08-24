use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    knowledge::{ObjectStore, chunk_pages, extract_pdf, extract_text, verify_sha256},
};

const MAX_ATTEMPTS: i32 = 6;
const LEASE_SECONDS: i64 = 120;

#[derive(Clone)]
pub struct IngestionWorker {
    pool: PgPool,
    store: ObjectStore,
    worker_id: Uuid,
}

impl IngestionWorker {
    #[must_use]
    pub fn new(pool: PgPool, store: ObjectStore) -> Self {
        Self {
            pool,
            store,
            worker_id: Uuid::new_v4(),
        }
    }

    pub async fn run_once(&self) -> ApiResult<bool> {
        let mut tx = self.pool.begin().await?;
        let job = sqlx::query(
            "WITH candidate AS (
               SELECT id FROM knowledge_ingestion_jobs
               WHERE ((state IN ('queued','retry') AND available_at<=NOW())
                  OR (state='leased' AND lease_expires_at<NOW()))
                 AND attempt_count<12
               ORDER BY available_at,created_at
               FOR UPDATE SKIP LOCKED LIMIT 1
             )
             UPDATE knowledge_ingestion_jobs jobs
             SET state='leased',lease_owner=$1,
                 lease_expires_at=NOW()+($2*INTERVAL '1 second'),
                 attempt_count=attempt_count+1,updated_at=NOW()
             FROM candidate WHERE jobs.id=candidate.id
             RETURNING jobs.id,jobs.source_version_id,jobs.attempt_count",
        )
        .bind(self.worker_id)
        .bind(LEASE_SECONDS)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(job) = job else {
            tx.rollback().await?;
            return Ok(false);
        };
        tx.commit().await?;

        let job_id: Uuid = job.get("id");
        let version: Uuid = job.get("source_version_id");
        let attempt_count: i32 = job.get("attempt_count");
        let source = sqlx::query(
            "SELECT versions.object_key,versions.byte_size,versions.sha256,versions.media_type
             FROM knowledge_ingestion_jobs jobs
             JOIN knowledge_source_versions versions ON versions.id=jobs.source_version_id
             WHERE jobs.id=$1 AND jobs.lease_owner=$2 AND jobs.state='leased'
               AND jobs.lease_expires_at>NOW()",
        )
        .bind(job_id)
        .bind(self.worker_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(source) = source else {
            return Ok(true);
        };

        let result = self.process(job_id, version, &source).await;
        if let Err(error) = result {
            let code = error.code.unwrap_or("extraction_failed");
            let permanent = matches!(
                code,
                "chunk_limit"
                    | "encrypted_pdf_unsupported"
                    | "empty_text"
                    | "scanned_pdf_unsupported"
                    | "invalid_pdf"
                    | "invalid_text"
                    | "object_checksum_mismatch"
                    | "object_too_large"
                    | "extracted_text_too_large"
                    | "pdf_page_limit"
            );
            let effective_attempts = if permanent { 12 } else { attempt_count };
            let failed = effective_attempts >= MAX_ATTEMPTS;
            let exponent = u32::try_from(effective_attempts.clamp(0, 9)).unwrap_or(9);
            let delay_seconds = i64::from(2_i32.pow(exponent)).min(900);
            let mut tx = self.pool.begin().await?;
            let changed = sqlx::query(
                "UPDATE knowledge_ingestion_jobs
                 SET state=$3,error_code=$4,lease_owner=NULL,lease_expires_at=NULL,
                     available_at=NOW()+($5*INTERVAL '1 second'),updated_at=NOW()
                 WHERE id=$1 AND lease_owner=$2",
            )
            .bind(job_id)
            .bind(self.worker_id)
            .bind(if failed { "failed" } else { "retry" })
            .bind(code)
            .bind(delay_seconds)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if permanent && changed > 0 {
                sqlx::query(
                    "UPDATE knowledge_source_versions SET state='failed',error_code=$2 WHERE id=$1",
                )
                .bind(version)
                .bind(code)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
        }
        Ok(true)
    }

    async fn process(
        &self,
        job_id: Uuid,
        version: Uuid,
        source: &sqlx::postgres::PgRow,
    ) -> ApiResult<()> {
        let bytes = self.store.get(source.get("object_key")).await?;
        if i64::try_from(bytes.len()).unwrap_or(i64::MAX) != source.get::<i64, _>("byte_size")
            || !verify_sha256(&bytes, &source.get::<String, _>("sha256"))
        {
            return Err(ApiError::coded(
                http::StatusCode::UNPROCESSABLE_ENTITY,
                "object_checksum_mismatch",
                "Uploaded object does not match the reviewed file.",
            ));
        }
        let extracted = if source.get::<String, _>("media_type") == "application/pdf" {
            extract_pdf(&bytes)?
        } else {
            extract_text(&bytes)?
        };
        let chunks = chunk_pages(&extracted.pages)?;

        let mut tx = self.pool.begin().await?;
        let current_lease: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM knowledge_ingestion_jobs
             WHERE id=$1 AND lease_owner=$2 AND state='leased' AND lease_expires_at>NOW()
             FOR UPDATE",
        )
        .bind(job_id)
        .bind(self.worker_id)
        .fetch_optional(&mut *tx)
        .await?;
        if current_lease.is_none() {
            tx.rollback().await?;
            return Ok(());
        }
        sqlx::query("DELETE FROM knowledge_source_chunks WHERE source_version_id=$1")
            .bind(version)
            .execute(&mut *tx)
            .await?;
        for chunk in chunks {
            sqlx::query(
                "INSERT INTO knowledge_source_chunks(source_version_id,ordinal,locator,body)
                 VALUES($1,$2,$3,$4)",
            )
            .bind(version)
            .bind(i32::try_from(chunk.ordinal).unwrap_or(i32::MAX))
            .bind(serde_json::to_value(chunk.locator).map_err(ApiError::internal)?)
            .bind(chunk.body)
            .execute(&mut *tx)
            .await?;
        }
        sqlx::query(
            "UPDATE knowledge_source_versions
             SET state='ready',parser_version='knowledge-extractor-v1',page_count=$2,
                 ready_at=NOW(),error_code=NULL
             WHERE id=$1",
        )
        .bind(version)
        .bind(i32::try_from(extracted.page_count).unwrap_or(i32::MAX))
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE knowledge_ingestion_jobs
             SET state='completed',lease_owner=NULL,lease_expires_at=NULL,updated_at=NOW()
             WHERE id=$1 AND lease_owner=$2",
        )
        .bind(job_id)
        .bind(self.worker_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
