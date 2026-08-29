use serde_json::Value;
use trocode_api::agent::{lifecycle, protocol, tool_catalog};

#[test]
fn rust_deserializes_the_shared_v4_contract_corpus() {
    let valid = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/agent-runtime-v4/status.valid.json"
    ));
    let status: protocol::AgentRuntimeStatusV4 =
        serde_json::from_str(valid).expect("valid shared status fixture");
    let status = serde_json::to_value(status).expect("serializable generated status");
    assert_eq!(status["protocolDigest"], protocol::protocol_digest());
    assert_eq!(status["toolCatalogDigest"], protocol::tool_catalog_digest());

    let invalid = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/agent-runtime-v4/status.unknown-field.invalid.json"
    ));
    assert!(serde_json::from_str::<protocol::AgentRuntimeStatusV4>(invalid).is_err());
}

#[test]
fn open_url_uses_the_exact_generated_direct_tool_contract() {
    let fixture: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/agent-runtime-v4/open-url.valid.json"
    )))
    .expect("open URL fixture");
    let tool = tool_catalog::by_model_name(fixture["name"].as_str().expect("fixture model name"))
        .expect("generated open URL tool");
    tool_catalog::validate_model_arguments(&tool.parameters, &fixture["arguments"])
        .expect("exact open URL arguments");
    assert_eq!(
        tool_catalog::resolve_operation(tool, &fixture["arguments"]),
        Ok("open_url".to_owned())
    );
    assert!(tool.prerequisites.is_empty());
    assert_eq!(tool.parameters["additionalProperties"], false);
}

#[test]
fn lifecycle_projection_keeps_blocked_terminal() {
    let projection = lifecycle::project(&protocol::AgentRunStateV4::Blocked);
    assert!(projection.terminal);
    assert!(projection.actions.is_empty());
}
