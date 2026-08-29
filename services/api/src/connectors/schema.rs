use anyhow::{Context, bail};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use crate::auth::stable_json;

const MAX_DEPTH: usize = 16;
const MAX_PROPERTIES: usize = 256;

pub fn validate_schema(value: &Value, max_bytes: usize) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() > max_bytes {
        bail!("MCP schema exceeds the configured size limit.");
    }
    let mut properties = 0;
    inspect(value, 0, &mut properties)?;
    if properties > MAX_PROPERTIES {
        bail!("MCP schema contains too many properties.");
    }
    jsonschema::validator_for(value).context("compile MCP JSON Schema")?;
    Ok(())
}

fn inspect(value: &Value, depth: usize, properties: &mut usize) -> anyhow::Result<()> {
    if depth > MAX_DEPTH {
        bail!("MCP schema nesting is too deep.");
    }
    match value {
        Value::Object(object) => {
            if object.contains_key("x-mcp-header") {
                bail!("MCP parameter header promotion is not allowed.");
            }
            if let Some(reference) = object.get("$ref").and_then(Value::as_str)
                && !reference.starts_with("#/")
            {
                bail!("External MCP schema references are not allowed.");
            }
            if let Some(map) = object.get("properties").and_then(Value::as_object) {
                *properties += map.len();
            }
            for child in object.values() {
                inspect(child, depth + 1, properties)?;
            }
        }
        Value::Array(values) => {
            for child in values {
                inspect(child, depth + 1, properties)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Checks that the remote contract still accepts every argument shape Tro may
/// advertise. Extra remote fields are ignored because they are never exposed.
pub fn ensure_compatible(reviewed: &Value, remote: &Value) -> anyhow::Result<()> {
    validate_schema(reviewed, 128_000)?;
    validate_schema(remote, 512_000)?;
    compatible_node(reviewed, remote, "$")
}

fn compatible_node(reviewed: &Value, remote: &Value, path: &str) -> anyhow::Result<()> {
    let reviewed_object = reviewed.as_object().context("reviewed schema object")?;
    let remote_object = remote.as_object().context("remote schema object")?;
    if let Some(reviewed_type) = reviewed_object.get("type")
        && remote_object.get("type") != Some(reviewed_type)
    {
        bail!("MCP schema type changed at {path}.");
    }
    if let Some(reviewed_enum) = reviewed_object.get("enum").and_then(Value::as_array) {
        let remote_enum = remote_object
            .get("enum")
            .and_then(Value::as_array)
            .context("remote enum missing")?;
        if reviewed_enum
            .iter()
            .any(|value| !remote_enum.contains(value))
        {
            bail!("MCP schema enum changed at {path}.");
        }
    }
    if let Some(reviewed_items) = reviewed_object.get("items") {
        compatible_node(
            reviewed_items,
            remote_object.get("items").context("remote items missing")?,
            &format!("{path}[]"),
        )?;
    }
    let reviewed_properties = reviewed_object
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let remote_properties = remote_object
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (name, schema) in &reviewed_properties {
        compatible_node(
            schema,
            remote_properties
                .get(name)
                .with_context(|| format!("remote property {path}.{name} missing"))?,
            &format!("{path}.{name}"),
        )?;
    }
    let reviewed_required = string_set(reviewed_object.get("required"));
    let remote_required = string_set(remote_object.get("required"));
    if remote_required
        .iter()
        .any(|field| !reviewed_required.contains(field))
    {
        bail!("MCP schema introduced a required field at {path}.");
    }
    Ok(())
}

fn string_set(value: Option<&Value>) -> std::collections::BTreeSet<String> {
    value
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect()
}

pub fn validate_arguments(schema: &Value, arguments: &Value) -> anyhow::Result<()> {
    let object = arguments
        .as_object()
        .context("tool arguments must be an object")?;
    if object.len() > 64 || serde_json::to_vec(arguments)?.len() > 256_000 {
        bail!("Tool arguments exceed configured bounds.");
    }
    let validator = jsonschema::validator_for(schema).context("compile argument schema")?;
    validator
        .validate(arguments)
        .map_err(|_| anyhow::anyhow!("Tool arguments do not match the reviewed schema."))
}

pub fn snapshot_digest(tools: &[Value], catalog_contract_digest: &str) -> anyhow::Result<String> {
    // Keep the legacy canonical JSON key so renaming the persisted column does
    // not invalidate every existing connector snapshot digest.
    let canonical = stable_json(&json!({"policyDigest":catalog_contract_digest,"tools":tools}))?;
    Ok(format!("{:x}", Sha256::digest(canonical.as_bytes())))
}

pub fn as_object(value: Value) -> anyhow::Result<Map<String, Value>> {
    value.as_object().cloned().context("expected JSON object")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_external_refs_and_header_promotion() {
        assert!(validate_schema(&json!({"$ref":"https://evil.test/schema"}), 1000).is_err());
        assert!(
            validate_schema(
                &json!({"type":"string","x-mcp-header":"Authorization"}),
                1000
            )
            .is_err()
        );
    }

    #[test]
    fn compatibility_rejects_new_required_fields_but_ignores_unadvertised_optional_fields() {
        let reviewed =
            json!({"type":"object","properties":{"id":{"type":"string"}},"required":["id"]});
        let compatible = json!({"type":"object","properties":{"id":{"type":"string"},"future":{"type":"string"}},"required":["id"]});
        let changed = json!({"type":"object","properties":{"id":{"type":"string"},"future":{"type":"string"}},"required":["id","future"]});
        assert!(ensure_compatible(&reviewed, &compatible).is_ok());
        assert!(ensure_compatible(&reviewed, &changed).is_err());
    }
}
