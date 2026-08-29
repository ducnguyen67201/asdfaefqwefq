use std::{collections::BTreeMap, sync::LazyLock};

use serde::Deserialize;
use serde_json::Value;

use super::protocol::PROTOCOL_VERSION;

const CATALOG_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../protocol/agent-tools.v4.json"
));

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostedToolContract {
    pub description: String,
    pub model_name: String,
    pub operation_selector: Value,
    pub operations: Vec<String>,
    pub parameters: Value,
    pub prerequisites: Vec<String>,
    pub tool_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostedToolCatalog {
    schema_version: u8,
    tools: Vec<HostedToolContract>,
}

static TOOLS_BY_ID: LazyLock<BTreeMap<String, HostedToolContract>> = LazyLock::new(|| {
    let catalog: HostedToolCatalog =
        serde_json::from_str(CATALOG_JSON).expect("generated hosted tool catalog must be valid");
    assert_eq!(
        catalog.schema_version, PROTOCOL_VERSION,
        "hosted tool catalog version must match protocol"
    );
    let tools: BTreeMap<_, _> = catalog
        .tools
        .into_iter()
        .map(|tool| (tool.tool_id.clone(), tool))
        .collect();
    assert_eq!(tools.len(), 13, "hosted tool IDs must be unique");
    tools
});

static TOOLS_BY_MODEL_NAME: LazyLock<BTreeMap<String, HostedToolContract>> = LazyLock::new(|| {
    let tools: BTreeMap<_, _> = TOOLS_BY_ID
        .values()
        .cloned()
        .map(|tool| (tool.model_name.clone(), tool))
        .collect();
    assert_eq!(
        tools.len(),
        TOOLS_BY_ID.len(),
        "hosted model tool names must be unique"
    );
    tools
});

pub fn all() -> impl Iterator<Item = &'static HostedToolContract> {
    TOOLS_BY_ID.values()
}

#[must_use]
pub fn by_id(tool_id: &str) -> Option<&'static HostedToolContract> {
    TOOLS_BY_ID.get(tool_id)
}

#[must_use]
pub fn by_model_name(model_name: &str) -> Option<&'static HostedToolContract> {
    TOOLS_BY_MODEL_NAME.get(model_name)
}

fn pointer_value<'a>(input: &'a Value, pointer: &str) -> Option<&'a Value> {
    input.pointer(pointer)
}

pub fn resolve_operation(tool: &HostedToolContract, input: &Value) -> Result<String, &'static str> {
    let kind = tool
        .operation_selector
        .get("kind")
        .and_then(Value::as_str)
        .ok_or("operation selector kind is missing")?;
    let operation = match kind {
        "constant" => tool
            .operation_selector
            .get("value")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        "json_pointer" => {
            let pointer = tool
                .operation_selector
                .get("pointer")
                .and_then(Value::as_str)
                .ok_or("operation selector pointer is missing")?;
            match pointer_value(input, pointer) {
                Some(Value::Null) | None => tool
                    .operation_selector
                    .get("nullValue")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                Some(_) if tool.operation_selector.get("presentValue").is_some() => tool
                    .operation_selector
                    .get("presentValue")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                Some(Value::String(value)) => Some(value.clone()),
                Some(_) => None,
            }
            .or_else(|| {
                tool.operation_selector
                    .get("presentValue")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
        }
        _ => None,
    }
    .ok_or("operation selector did not resolve")?;
    tool.operations
        .contains(&operation)
        .then_some(operation)
        .ok_or("resolved operation is not declared")
}

pub fn validate_model_arguments(schema: &Value, input: &Value) -> Result<(), &'static str> {
    if let Some(constant) = schema.get("const")
        && input != constant
    {
        return Err("model argument does not match const");
    }
    if let Some(values) = schema.get("enum").and_then(Value::as_array)
        && !values.contains(input)
    {
        return Err("model argument is outside enum");
    }
    if let Some(alternatives) = schema.get("anyOf").and_then(Value::as_array) {
        return alternatives
            .iter()
            .any(|alternative| validate_model_arguments(alternative, input).is_ok())
            .then_some(())
            .ok_or("model argument matches no anyOf branch");
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("object") => {
            let object = input
                .as_object()
                .ok_or("model argument must be an object")?;
            let properties = schema
                .get("properties")
                .and_then(Value::as_object)
                .ok_or("object schema properties are missing")?;
            if schema.get("additionalProperties") == Some(&Value::Bool(false))
                && object.keys().any(|key| !properties.contains_key(key))
            {
                return Err("model argument has an unknown property");
            }
            for required in schema
                .get("required")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                if !object.contains_key(required) {
                    return Err("model argument is missing a required property");
                }
            }
            for (name, value) in object {
                if let Some(property_schema) = properties.get(name) {
                    validate_model_arguments(property_schema, value)?;
                }
            }
            Ok(())
        }
        Some("array") => {
            let array = input.as_array().ok_or("model argument must be an array")?;
            if let Some(items) = schema.get("items") {
                for item in array {
                    validate_model_arguments(items, item)?;
                }
            }
            Ok(())
        }
        Some("string") => input
            .is_string()
            .then_some(())
            .ok_or("model argument must be a string"),
        Some("integer") => input
            .as_i64()
            .is_some()
            .then_some(())
            .ok_or("model argument must be an integer"),
        Some("number") => input
            .as_f64()
            .is_some()
            .then_some(())
            .ok_or("model argument must be a number"),
        Some("boolean") => input
            .is_boolean()
            .then_some(())
            .ok_or("model argument must be a boolean"),
        Some("null") => input
            .is_null()
            .then_some(())
            .ok_or("model argument must be null"),
        None => Ok(()),
        Some(_) => Err("model argument schema type is unsupported"),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{all, by_model_name, resolve_operation};

    #[test]
    fn generated_catalog_is_strict_and_resolves_open_url() {
        for tool in all() {
            assert_eq!(tool.parameters["additionalProperties"], false);
            assert!(by_model_name(&tool.model_name).is_some());
        }
        let tool = by_model_name("open_url").expect("open_url contract");
        assert_eq!(
            resolve_operation(
                tool,
                &json!({"url":"https://youtube.com","reason":"Open YouTube"})
            ),
            Ok("open_url".to_owned())
        );
        assert!(tool.prerequisites.is_empty());

        let workspace = by_model_name("workspace_filesystem").expect("workspace contract");
        assert_eq!(
            resolve_operation(workspace, &json!({"path":"a.txt","content":"changed"})),
            Ok("write_file".to_owned())
        );
    }
}
