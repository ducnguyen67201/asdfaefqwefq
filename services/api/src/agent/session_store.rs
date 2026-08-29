use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgRow};
use uuid::Uuid;

use crate::{
    auth::{AgentStateCrypto, stable_json},
    error::{ApiError, ApiResult},
};

use super::{run_store::RunStore, run_store::row_envelope};

const MAX_SESSION_ITEMS: usize = 10_000;

#[derive(Clone)]
pub struct SessionStore {
    crypto: AgentStateCrypto,
    pool: PgPool,
    runs: RunStore,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionTransaction {
    AppendItems {
        items: Vec<Value>,
    },
    ReplaceSuffix {
        #[serde(rename = "expectedSuffix")]
        expected_suffix: Vec<Value>,
        replacement: Vec<Value>,
    },
    Clear {
        #[serde(rename = "expectedItems")]
        expected_items: Vec<Value>,
    },
}

#[derive(Debug)]
pub struct SessionSnapshot {
    pub items: Vec<Value>,
    pub revision: i64,
}

#[derive(Debug)]
pub struct SessionMutationResult {
    pub replayed: bool,
    pub revision: i64,
}

impl SessionStore {
    #[must_use]
    pub fn new(pool: PgPool, crypto: AgentStateCrypto, runs: RunStore) -> Self {
        Self { crypto, pool, runs }
    }

    pub async fn get(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
    ) -> ApiResult<SessionSnapshot> {
        let mut tx = self.pool.begin().await?;
        self.runs
            .assert_lease(&mut tx, run_id, worker_id, expected_run_version)
            .await?;
        let snapshot = self.load_locked(&mut tx, run_id).await?;
        tx.commit().await?;
        Ok(snapshot)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn apply(
        &self,
        run_id: Uuid,
        worker_id: Uuid,
        expected_run_version: i32,
        expected_session_revision: i64,
        operation_id: &str,
        operation_digest: &str,
        transaction: &SessionTransaction,
    ) -> ApiResult<SessionMutationResult> {
        let computed_digest = format!(
            "{:x}",
            Sha256::digest(
                stable_json(&serde_json::to_value(transaction).map_err(ApiError::internal)?)?
                    .as_bytes()
            )
        );
        if operation_digest != computed_digest {
            return Err(ApiError::bad_request(
                "operation_digest_mismatch",
                "The session operation digest does not match its transaction.",
            ));
        }

        let mut tx = self.pool.begin().await?;
        self.runs
            .assert_lease(&mut tx, run_id, worker_id, expected_run_version)
            .await?;
        if let Some(row) = sqlx::query(
            "SELECT operation_digest,resulting_revision FROM agent_session_mutations WHERE run_id=$1 AND operation_id=$2",
        )
        .bind(run_id)
        .bind(operation_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            if row.get::<String, _>("operation_digest") != operation_digest {
                tx.rollback().await?;
                return Err(session_conflict());
            }
            let revision = row.get("resulting_revision");
            tx.commit().await?;
            return Ok(SessionMutationResult {
                replayed: true,
                revision,
            });
        }

        let snapshot = self.load_locked(&mut tx, run_id).await?;
        if snapshot.revision != expected_session_revision {
            tx.rollback().await?;
            return Err(session_conflict());
        }
        let next_items = apply_transaction(&snapshot.items, transaction)?;
        if next_items.len() > MAX_SESSION_ITEMS {
            tx.rollback().await?;
            return Err(ApiError::bad_request(
                "session_too_large",
                "The agent session contains too many items.",
            ));
        }
        let next_revision = snapshot.revision + 1;
        match transaction {
            SessionTransaction::AppendItems { items } => {
                self.append_locked(&mut tx, run_id, items).await?;
            }
            SessionTransaction::ReplaceSuffix { .. } | SessionTransaction::Clear { .. } => {
                self.replace_locked(&mut tx, run_id, &next_items).await?;
            }
        }
        let changed = sqlx::query(
            "UPDATE agent_runs SET session_revision=$2,updated_at=NOW() WHERE id=$1 AND session_revision=$3",
        )
        .bind(run_id)
        .bind(next_revision)
        .bind(expected_session_revision)
        .execute(&mut *tx)
        .await?;
        if changed.rows_affected() != 1 {
            tx.rollback().await?;
            return Err(session_conflict());
        }
        sqlx::query(
            "INSERT INTO agent_session_mutations(run_id,operation_id,operation_digest,resulting_revision)VALUES($1,$2,$3,$4)",
        )
        .bind(run_id)
        .bind(operation_id)
        .bind(operation_digest)
        .bind(next_revision)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(SessionMutationResult {
            replayed: false,
            revision: next_revision,
        })
    }

    async fn load_locked(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        run_id: Uuid,
    ) -> ApiResult<SessionSnapshot> {
        let run = sqlx::query(
            "SELECT session_generation,session_revision,orchestrator_kind,sdk_version,orchestrator_graph_version FROM agent_runs WHERE id=$1 FOR UPDATE",
        )
        .bind(run_id)
        .fetch_one(&mut **tx)
        .await?;
        let generation: i32 = run.get("session_generation");
        let rows = sqlx::query(
            "SELECT * FROM agent_session_items WHERE run_id=$1 AND generation=$2 ORDER BY item_sequence",
        )
        .bind(run_id)
        .bind(generation)
        .fetch_all(&mut **tx)
        .await?;
        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let envelope = row_envelope(&row, "item")?.ok_or_else(|| {
                ApiError::internal(anyhow::anyhow!("session item envelope missing"))
            })?;
            items.push(self.crypto.decrypt_json(
                &envelope,
                &session_item_metadata(
                    run_id,
                    generation,
                    row.get("item_sequence"),
                    run.get("orchestrator_kind"),
                    run.get("sdk_version"),
                    run.get("orchestrator_graph_version"),
                ),
            )?);
        }
        Ok(SessionSnapshot {
            items,
            revision: run.get("session_revision"),
        })
    }

    async fn append_locked(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        run_id: Uuid,
        items: &[Value],
    ) -> ApiResult<()> {
        let run = sqlx::query(
            "SELECT session_generation,orchestrator_kind,sdk_version,orchestrator_graph_version FROM agent_runs WHERE id=$1 FOR UPDATE",
        )
        .bind(run_id)
        .fetch_one(&mut **tx)
        .await?;
        let generation: i32 = run.get("session_generation");
        let mut sequence: i64 = sqlx::query_scalar(
            "SELECT COALESCE(MAX(item_sequence),0) FROM agent_session_items WHERE run_id=$1 AND generation=$2",
        )
        .bind(run_id)
        .bind(generation)
        .fetch_one(&mut **tx)
        .await?;
        for item in items {
            sequence += 1;
            self.insert_item(tx, run_id, generation, sequence, &run, item)
                .await?;
        }
        Ok(())
    }

    async fn replace_locked(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        run_id: Uuid,
        items: &[Value],
    ) -> ApiResult<()> {
        let run = sqlx::query(
            "SELECT session_generation,orchestrator_kind,sdk_version,orchestrator_graph_version FROM agent_runs WHERE id=$1 FOR UPDATE",
        )
        .bind(run_id)
        .fetch_one(&mut **tx)
        .await?;
        let generation = run.get::<i32, _>("session_generation") + 1;
        for (index, item) in items.iter().enumerate() {
            self.insert_item(
                tx,
                run_id,
                generation,
                i64::try_from(index + 1).unwrap_or(i64::MAX),
                &run,
                item,
            )
            .await?;
        }
        sqlx::query(
            "UPDATE agent_runs SET session_generation=$2,pending_session_generation=NULL WHERE id=$1",
        )
        .bind(run_id)
        .bind(generation)
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn insert_item(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        run_id: Uuid,
        generation: i32,
        sequence: i64,
        run: &PgRow,
        item: &Value,
    ) -> ApiResult<()> {
        let sanitized = strip_image_bytes(item);
        let metadata = session_item_metadata(
            run_id,
            generation,
            sequence,
            run.get("orchestrator_kind"),
            run.get("sdk_version"),
            run.get("orchestrator_graph_version"),
        );
        let envelope = self.crypto.encrypt_json(&sanitized, &metadata)?;
        sqlx::query(
            "INSERT INTO agent_session_items(run_id,generation,item_sequence,item_ciphertext,item_iv,item_tag,item_key_version)VALUES($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(run_id)
        .bind(generation)
        .bind(sequence)
        .bind(envelope.ciphertext)
        .bind(envelope.iv)
        .bind(envelope.tag)
        .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
        .execute(&mut **tx)
        .await?;
        Ok(())
    }
}

fn apply_transaction(current: &[Value], transaction: &SessionTransaction) -> ApiResult<Vec<Value>> {
    match transaction {
        SessionTransaction::AppendItems { items } => {
            let mut next = current.to_vec();
            next.extend(items.iter().map(strip_image_bytes));
            Ok(next)
        }
        SessionTransaction::ReplaceSuffix {
            expected_suffix,
            replacement,
        } => {
            let expected_suffix = expected_suffix
                .iter()
                .map(strip_image_bytes)
                .collect::<Vec<_>>();
            if current.len() < expected_suffix.len()
                || stable_json(&Value::Array(
                    current[current.len() - expected_suffix.len()..].to_vec(),
                ))? != stable_json(&Value::Array(expected_suffix.clone()))?
            {
                return Err(session_conflict());
            }
            let mut next = current[..current.len() - expected_suffix.len()].to_vec();
            next.extend(replacement.iter().map(strip_image_bytes));
            Ok(next)
        }
        SessionTransaction::Clear { expected_items } => {
            let expected_items = expected_items
                .iter()
                .map(strip_image_bytes)
                .collect::<Vec<_>>();
            if stable_json(&Value::Array(current.to_vec()))?
                != stable_json(&Value::Array(expected_items.clone()))?
            {
                return Err(session_conflict());
            }
            Ok(Vec::new())
        }
    }
}

fn session_item_metadata(
    run_id: Uuid,
    generation: i32,
    sequence: i64,
    runtime_kind: String,
    sdk_version: String,
    graph_version: String,
) -> Value {
    json!({
        "generation":generation,
        "graphVersion":graph_version,
        "kind":"agent_session_item",
        "runId":run_id,
        "runtimeKind":runtime_kind,
        "schemaVersion":1,
        "sdkVersion":sdk_version,
        "sequence":sequence
    })
}

fn strip_image_bytes(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(strip_image_bytes).collect()),
        Value::Object(object)
            if matches!(
                object.get("type").and_then(Value::as_str),
                Some("input_image" | "computer_screenshot")
            ) =>
        {
            json!({"type":"input_text","text":"[visual evidence expired; capture a fresh observation]"})
        }
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, item)| {
                    let sanitized = if matches!(
                        key.as_str(),
                        "dataBase64" | "dataUrl" | "image_url" | "imageUrl"
                    ) || item
                        .as_str()
                        .is_some_and(|text| text.starts_with("data:image/"))
                    {
                        Value::String("[visual bytes omitted]".to_owned())
                    } else {
                        strip_image_bytes(item)
                    };
                    (key.clone(), sanitized)
                })
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn session_conflict() -> ApiError {
    ApiError::conflict(
        "session_conflict",
        "The Agents SDK session changed before this transaction was committed.",
    )
}
