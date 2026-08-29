use std::sync::LazyLock;

use serde::Deserialize;

typify::import_types!(schema = "../../protocol/agent-orchestrator.v1.schema.json");

pub const PROTOCOL_VERSION: u8 = 1;

const MANIFEST_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../protocol/agent-orchestrator.v1.manifest.json"
));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentOrchestratorManifest {
    protocol_digest: String,
    schema_version: u8,
}

static MANIFEST: LazyLock<AgentOrchestratorManifest> = LazyLock::new(|| {
    let manifest: AgentOrchestratorManifest = serde_json::from_str(MANIFEST_JSON)
        .expect("generated agent orchestrator manifest must be valid");
    assert_eq!(
        manifest.schema_version, PROTOCOL_VERSION,
        "agent orchestrator manifest version must match the compiled protocol"
    );
    manifest
});

#[must_use]
pub fn protocol_digest() -> &'static str {
    &MANIFEST.protocol_digest
}
