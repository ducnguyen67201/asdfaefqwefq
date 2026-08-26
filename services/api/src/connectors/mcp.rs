use std::time::Duration;

use anyhow::{Context, bail};
use rmcp::{
    RoleClient, ServiceExt,
    model::{CallToolRequestParams, Tool},
    transport::streamable_http_client::{
        StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
    },
};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use super::{
    catalog::{ConnectorDefinition, ToolPolicy},
    schema,
};

#[derive(Clone, Debug)]
pub struct DiscoveredSnapshot {
    pub digest: String,
    pub tools: Vec<Value>,
}

#[derive(Clone)]
pub struct McpClientFactory {
    max_result_bytes: usize,
    max_schema_bytes: usize,
    timeout: Duration,
}

impl McpClientFactory {
    #[must_use]
    pub fn new(timeout_ms: u64, max_schema_bytes: usize, max_result_bytes: usize) -> Self {
        Self {
            max_result_bytes,
            max_schema_bytes,
            timeout: Duration::from_millis(timeout_ms),
        }
    }

    pub async fn discover(
        &self,
        definition: &'static ConnectorDefinition,
        access_token: &str,
        policy_digest: &str,
        cancellation: &CancellationToken,
    ) -> anyhow::Result<DiscoveredSnapshot> {
        let endpoint = verified_endpoint(definition)?;
        let future = async {
            let mut service = self.connect(endpoint, access_token).await?;
            let result = service
                .peer()
                .list_all_tools()
                .await
                .map_err(|error| anyhow::anyhow!(error.to_string()));
            let _ = service.close_with_timeout(Duration::from_secs(1)).await;
            result
        };
        let tools = tokio::select! {
            () = cancellation.cancelled() => bail!("MCP request was cancelled before completion."),
            result = tokio::time::timeout(self.timeout, future) => result.context("MCP request timed out")??,
        };
        let reviewed = reviewed_tools(definition, &tools, self.max_schema_bytes)?;
        let digest = schema::snapshot_digest(&reviewed, policy_digest)?;
        Ok(DiscoveredSnapshot {
            digest,
            tools: reviewed,
        })
    }

    pub async fn call_tool(
        &self,
        definition: &'static ConnectorDefinition,
        policy: &'static ToolPolicy,
        access_token: &str,
        arguments: Value,
        cancellation: &CancellationToken,
    ) -> anyhow::Result<Value> {
        schema::validate_arguments(&policy.input_schema, &arguments)?;
        let argument_object = schema::as_object(arguments)?;
        let endpoint = verified_endpoint(definition)?;
        let name = policy.name.to_owned();
        let future = async {
            let mut service = self.connect(endpoint, access_token).await?;
            let result = service
                .call_tool(CallToolRequestParams::new(name).with_arguments(argument_object))
                .await
                .map_err(|error| anyhow::anyhow!(error.to_string()));
            let _ = service.close_with_timeout(Duration::from_secs(1)).await;
            result
        };
        let result = tokio::select! {
            () = cancellation.cancelled() => bail!("MCP request was cancelled before completion."),
            result = tokio::time::timeout(self.timeout, future) => result.context("MCP request timed out")??,
        };
        if result.is_error == Some(true) {
            bail!("MCP tool returned an error result.");
        }
        let value = serde_json::to_value(result)?;
        reject_unsupported_content(&value)?;
        if serde_json::to_vec(&value)?.len() > self.max_result_bytes {
            bail!("MCP result exceeds the configured size limit.");
        }
        Ok(value)
    }

    async fn connect(
        &self,
        endpoint: &str,
        access_token: &str,
    ) -> anyhow::Result<rmcp::service::RunningService<RoleClient, ()>> {
        let http = reqwest_mcp::Client::builder()
            .redirect(reqwest_mcp::redirect::Policy::none())
            .timeout(self.timeout)
            .build()
            .context("build MCP HTTP client")?;
        let transport = StreamableHttpClientTransport::with_client(
            http,
            StreamableHttpClientTransportConfig::with_uri(endpoint.to_owned())
                .auth_header(access_token.to_owned())
                .max_sse_event_size(self.max_result_bytes)
                .reinit_on_expired_session(false),
        );
        ().serve(transport)
            .await
            .map_err(|error| anyhow::anyhow!(error.to_string()))
    }
}

fn reject_unsupported_content(value: &Value) -> anyhow::Result<()> {
    match value {
        Value::Object(object) => {
            if object
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| {
                    matches!(kind, "image" | "audio" | "resource" | "resource_link")
                })
            {
                bail!("MCP result contains unsupported content.");
            }
            for child in object.values() {
                reject_unsupported_content(child)?;
            }
        }
        Value::Array(items) => {
            for child in items {
                reject_unsupported_content(child)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn verified_endpoint(definition: &ConnectorDefinition) -> anyhow::Result<&str> {
    let parsed = url::Url::parse(definition.endpoint)?;
    if parsed.scheme() != "https"
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.as_str() != definition.endpoint
    {
        bail!("Connector endpoint is not an exact verified HTTPS URL.");
    }
    Ok(definition.endpoint)
}

fn reviewed_tools(
    definition: &ConnectorDefinition,
    remote: &[Tool],
    max_schema_bytes: usize,
) -> anyhow::Result<Vec<Value>> {
    let mut result = Vec::with_capacity(definition.tools.len());
    for policy in &definition.tools {
        let remote_tool = remote
            .iter()
            .find(|tool| tool.name == policy.name)
            .with_context(|| format!("reviewed MCP tool {} is unavailable", policy.name))?;
        if remote_tool.name.len() > 64
            || remote_tool
                .description
                .as_deref()
                .is_some_and(|value| value.chars().count() > 8_000)
        {
            bail!("MCP tool metadata exceeds configured bounds.");
        }
        let remote_schema = Value::Object((*remote_tool.input_schema).clone());
        schema::validate_schema(&remote_schema, max_schema_bytes)?;
        schema::ensure_compatible(&policy.input_schema, &remote_schema)?;
        result.push(json!({
            "description":policy.description,
            "effect":policy.effect,
            "inputSchema":policy.input_schema,
            "mcpName":policy.name,
            "namespace":policy.namespace
        }));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_is_exact_and_https() {
        let definition = super::super::catalog::by_key("gmail").expect("gmail");
        assert_eq!(
            verified_endpoint(definition).expect("endpoint"),
            definition.endpoint
        );
    }
}
