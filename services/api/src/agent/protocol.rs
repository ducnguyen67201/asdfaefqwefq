use std::sync::LazyLock;

use serde::Deserialize;

typify::import_types!(schema = "../../protocol/agent-runtime.v4.schema.json");

pub const PROTOCOL_VERSION: u8 = 4;

const MANIFEST_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../protocol/agent-runtime.v4.manifest.json"
));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentRuntimeManifest {
    protocol_digest: String,
    schema_version: u8,
    tool_catalog_digest: String,
}

static MANIFEST: LazyLock<AgentRuntimeManifest> = LazyLock::new(|| {
    let manifest: AgentRuntimeManifest = serde_json::from_str(MANIFEST_JSON)
        .expect("generated agent runtime manifest must be valid");
    assert_eq!(
        manifest.schema_version, PROTOCOL_VERSION,
        "agent runtime manifest version must match the compiled protocol"
    );
    manifest
});

#[must_use]
pub fn protocol_digest() -> &'static str {
    &MANIFEST.protocol_digest
}

#[must_use]
pub fn tool_catalog_digest() -> &'static str {
    &MANIFEST.tool_catalog_digest
}
