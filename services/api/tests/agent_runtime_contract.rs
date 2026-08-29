use serde_json::Value;
use trocode_api::agent::{lifecycle, orchestrator_protocol, protocol, tool_catalog};

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
fn rust_deserializes_the_shared_v5_contract_corpus() {
    let valid = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/agent-runtime-v5/status.valid.json"
    ));
    let status: protocol::v5::AgentRuntimeStatusV5 =
        serde_json::from_str(valid).expect("valid shared v5 status fixture");
    let status = serde_json::to_value(status).expect("serializable generated v5 status");
    assert_eq!(status["protocolDigest"], protocol::v5::protocol_digest());
    assert_eq!(
        status["toolCatalogDigest"],
        protocol::v5::tool_catalog_digest()
    );

    let invalid = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/agent-runtime-v5/status.unknown-field.invalid.json"
    ));
    assert!(serde_json::from_str::<protocol::v5::AgentRuntimeStatusV5>(invalid).is_err());
}

#[test]
fn rust_deserializes_the_private_orchestrator_contract() {
    let valid = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/agent-orchestrator-v1/worker-registration.valid.json"
    ));
    let schema: Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../protocol/agent-orchestrator.v1.schema.json"
    )))
    .expect("private orchestrator schema");
    let registration = &schema["properties"]["workerRegistrationRequest"];
    let validator = jsonschema::validator_for(registration).expect("registration validator");
    let request: Value = serde_json::from_str(valid).expect("valid private worker fixture");
    validator
        .validate(&request)
        .expect("valid private worker fixture");
    assert_eq!(
        request["protocolDigest"],
        orchestrator_protocol::protocol_digest()
    );

    let invalid = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../test/fixtures/agent-orchestrator-v1/worker-registration.unknown-field.invalid.json"
    ));
    let invalid: Value = serde_json::from_str(invalid).expect("invalid fixture is JSON");
    assert!(validator.validate(&invalid).is_err());
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
