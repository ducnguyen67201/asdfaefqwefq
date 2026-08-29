use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    auth::{AgentStateCrypto, stable_json},
    error::{ApiError, ApiResult},
};

use super::run_store::row_envelope;

#[derive(Clone)]
pub struct ToolSnapshotStore {
    crypto: AgentStateCrypto,
    pool: PgPool,
}

pub struct ToolSnapshotIdentity<'a> {
    pub graph_version: &'a str,
    pub protocol_digest: &'a str,
    pub run_id: Uuid,
    pub sdk_version: &'a str,
    pub tool_catalog_digest: &'a str,
}

impl ToolSnapshotStore {
    #[must_use]
    pub fn new(pool: PgPool, crypto: AgentStateCrypto) -> Self {
        Self { crypto, pool }
    }

    pub async fn load(&self, identity: &ToolSnapshotIdentity<'_>) -> ApiResult<Option<Vec<Value>>> {
        let row = sqlx::query("SELECT * FROM agent_run_tool_snapshots WHERE run_id=$1")
            .bind(identity.run_id)
            .fetch_optional(&self.pool)
            .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let snapshot_digest: String = row.get("snapshot_digest");
        if row.get::<String, _>("protocol_digest") != identity.protocol_digest
            || row.get::<String, _>("tool_catalog_digest") != identity.tool_catalog_digest
            || row.get::<String, _>("sdk_version") != identity.sdk_version
            || row.get::<String, _>("graph_version") != identity.graph_version
        {
            return Err(ApiError::conflict(
                "graph_version_mismatch",
                "The frozen tool surface belongs to a different agent graph release.",
            ));
        }
        let envelope = row_envelope(&row, "tools")?.ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!("frozen tool surface envelope missing"))
        })?;
        let payload = self
            .crypto
            .decrypt_json(&envelope, &snapshot_metadata(identity, &snapshot_digest))?;
        let tools = payload
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("frozen tool surface is invalid")))?;
        if tools.len() > 512 || snapshot_digest_for(&tools)? != snapshot_digest {
            return Err(ApiError::internal(anyhow::anyhow!(
                "frozen tool surface digest mismatch"
            )));
        }
        Ok(Some(tools))
    }

    pub async fn freeze(
        &self,
        identity: &ToolSnapshotIdentity<'_>,
        tools: &[Value],
    ) -> ApiResult<Vec<Value>> {
        if tools.len() > 512 {
            return Err(ApiError::conflict(
                "catalog_mismatch",
                "The execution surface contains too many tools.",
            ));
        }
        let snapshot_digest = snapshot_digest_for(tools)?;
        let envelope = self.crypto.encrypt_json(
            &json!({"tools":tools}),
            &snapshot_metadata(identity, &snapshot_digest),
        )?;
        sqlx::query(
            "INSERT INTO agent_run_tool_snapshots(
               run_id,protocol_digest,tool_catalog_digest,sdk_version,graph_version,
               snapshot_digest,tools_ciphertext,tools_iv,tools_tag,tools_key_version
             ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT(run_id) DO NOTHING",
        )
        .bind(identity.run_id)
        .bind(identity.protocol_digest)
        .bind(identity.tool_catalog_digest)
        .bind(identity.sdk_version)
        .bind(identity.graph_version)
        .bind(snapshot_digest)
        .bind(envelope.ciphertext)
        .bind(envelope.iv)
        .bind(envelope.tag)
        .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
        .execute(&self.pool)
        .await?;
        self.load(identity).await?.ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!("frozen tool surface was not persisted"))
        })
    }
}

pub fn call_was_offered(
    tools: &[Value],
    tool_id: &str,
    operation: &str,
    driver_catalog_digest: Option<&str>,
) -> bool {
    tools.iter().any(|tool| {
        if tool.get("toolId").and_then(Value::as_str) != Some(tool_id)
            || tool.get("driverCatalogDigest").and_then(Value::as_str) != driver_catalog_digest
        {
            return false;
        }
        match tool.get("operation") {
            Some(Value::String(value)) => value == operation,
            Some(Value::Null) => tool
                .get("operationSelector")
                .is_some_and(|selector| !selector.is_null()),
            _ => false,
        }
    })
}

fn snapshot_digest_for(tools: &[Value]) -> ApiResult<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(stable_json(&json!({"tools":tools}))?.as_bytes())
    ))
}

fn snapshot_metadata(identity: &ToolSnapshotIdentity<'_>, snapshot_digest: &str) -> Value {
    json!({
        "graphVersion":identity.graph_version,
        "kind":"agent_run_tool_snapshot",
        "protocolDigest":identity.protocol_digest,
        "runId":identity.run_id,
        "schemaVersion":1,
        "sdkVersion":identity.sdk_version,
        "snapshotDigest":snapshot_digest,
        "toolCatalogDigest":identity.tool_catalog_digest
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offered_calls_must_match_the_frozen_operation_and_driver_digest() {
        let tools = vec![
            json!({
                "driverCatalogDigest":Value::Null,
                "operation":"navigate",
                "operationSelector":Value::Null,
                "toolId":"browser.navigate"
            }),
            json!({
                "driverCatalogDigest":"a".repeat(64),
                "operation":"future_action",
                "operationSelector":Value::Null,
                "toolId":"cua.driver"
            }),
            json!({
                "driverCatalogDigest":Value::Null,
                "operation":Value::Null,
                "operationSelector":{"kind":"json_pointer","pointer":"/operation"},
                "toolId":"workspace.filesystem"
            }),
        ];
        assert!(call_was_offered(
            &tools,
            "browser.navigate",
            "navigate",
            None
        ));
        assert!(!call_was_offered(
            &tools,
            "browser.navigate",
            "delete",
            None
        ));
        assert!(call_was_offered(
            &tools,
            "cua.driver",
            "future_action",
            Some(&"a".repeat(64))
        ));
        assert!(!call_was_offered(
            &tools,
            "cua.driver",
            "future_action",
            Some(&"b".repeat(64))
        ));
        assert!(call_was_offered(
            &tools,
            "workspace.filesystem",
            "read_file",
            None
        ));
    }
}
