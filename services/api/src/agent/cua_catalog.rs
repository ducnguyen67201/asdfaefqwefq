use std::collections::BTreeSet;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{
    auth::stable_json,
    connectors::schema,
    error::{ApiError, ApiResult},
    validation::js_string_len,
};

fn invalid() -> ApiError {
    ApiError::coded(
        http::StatusCode::BAD_REQUEST,
        "invalid_request",
        "CUA driver catalog is invalid.",
    )
}

pub fn validate(value: &Value) -> ApiResult<Value> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    if serde_json::to_vec(value).map_err(ApiError::internal)?.len() > 2_000_000 {
        return Err(invalid());
    }
    let object = value
        .as_object()
        .filter(|object| {
            object.len() == 6
                && object.keys().all(|key| {
                    matches!(
                        key.as_str(),
                        "driverVersion"
                            | "contractVersion"
                            | "toolsListSchemaVersion"
                            | "capabilityVersion"
                            | "driverCatalogDigest"
                            | "tools"
                    )
                })
        })
        .ok_or_else(invalid)?;
    let bounded = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && js_string_len(value) <= 100)
            .map(ToOwned::to_owned)
            .ok_or_else(invalid)
    };
    let driver_version = bounded("driverVersion")?;
    let contract_version = bounded("contractVersion")?;
    let capability_version = bounded("capabilityVersion")?;
    if object.get("toolsListSchemaVersion").and_then(Value::as_str) != Some("1") {
        return Err(invalid());
    }
    let digest = object
        .get("driverCatalogDigest")
        .and_then(Value::as_str)
        .filter(|value| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
        .ok_or_else(invalid)?;
    let tools = object
        .get("tools")
        .and_then(Value::as_array)
        .filter(|tools| tools.len() <= 128)
        .ok_or_else(invalid)?;
    let mut names = BTreeSet::new();
    let mut model_names = BTreeSet::new();
    let mut normalized_tools = Vec::with_capacity(tools.len());
    for tool in tools {
        let tool_object = tool
            .as_object()
            .filter(|object| {
                object.len() == 5
                    && object.keys().all(|key| {
                        matches!(
                            key.as_str(),
                            "name" | "modelName" | "description" | "inputSchema" | "injectSession"
                        )
                    })
            })
            .ok_or_else(invalid)?;
        let name = tool_object
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| {
                (1..=100).contains(&js_string_len(name))
                    && name
                        .bytes()
                        .next()
                        .is_some_and(|byte| byte.is_ascii_lowercase())
                    && name.bytes().all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
                    })
            })
            .ok_or_else(invalid)?;
        let model_name = tool_object
            .get("modelName")
            .and_then(Value::as_str)
            .filter(|name| {
                (1..=64).contains(&js_string_len(name))
                    && name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            })
            .ok_or_else(invalid)?;
        if !names.insert(name.to_owned()) || !model_names.insert(model_name.to_owned()) {
            return Err(invalid());
        }
        let description = tool_object
            .get("description")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty() && js_string_len(value) <= 20_000)
            .ok_or_else(invalid)?;
        let input_schema = tool_object
            .get("inputSchema")
            .filter(|input_schema| {
                input_schema.get("type").and_then(Value::as_str) == Some("object")
                    && input_schema.get("properties").is_some_and(Value::is_object)
                    && schema::validate_schema(input_schema, 100_000).is_ok()
            })
            .ok_or_else(invalid)?;
        let inject_session = tool_object
            .get("injectSession")
            .and_then(Value::as_bool)
            .ok_or_else(invalid)?;
        normalized_tools.push(json!({
            "name":name,
            "modelName":model_name,
            "description":description,
            "inputSchema":input_schema,
            "injectSession":inject_session
        }));
    }
    let digest_payload = json!({
        "driverVersion":driver_version,
        "contractVersion":contract_version,
        "toolsListSchemaVersion":"1",
        "capabilityVersion":capability_version,
        "tools":normalized_tools
    });
    let expected = format!(
        "{:x}",
        Sha256::digest(stable_json(&digest_payload)?.as_bytes())
    );
    if digest != expected {
        return Err(invalid());
    }
    Ok(json!({
        "driverVersion":digest_payload["driverVersion"],
        "contractVersion":digest_payload["contractVersion"],
        "toolsListSchemaVersion":"1",
        "capabilityVersion":digest_payload["capabilityVersion"],
        "driverCatalogDigest":digest,
        "tools":digest_payload["tools"]
    }))
}
