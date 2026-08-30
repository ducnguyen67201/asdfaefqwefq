use axum::{
    http::{HeaderMap, Method, StatusCode, Uri},
    response::Response,
};
use bytes::Bytes;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::LazyLock;
use subtle::ConstantTimeEq;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::{
    agent::{
        ClaimedRun, OrchestratorWorkerRegistration, PutCheckpoint, QueueToolCall,
        SessionTransaction,
    },
    app::AppState,
    error::{ApiError, ApiResult},
    http::{bearer, bytes_response, json_response, read_json},
    providers::{ProviderBody, ResponsesInput},
};

const PREFIX: &str = "/internal/agent-orchestrator/v1";
const MAX_CONTROL_BODY: usize = 10_500_000;
const MAX_PROVIDER_BODY: usize = 25_000_000;
const ORCHESTRATOR_SCHEMA_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../protocol/agent-orchestrator.v1.schema.json"
));
static ORCHESTRATOR_SCHEMA: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(ORCHESTRATOR_SCHEMA_JSON)
        .expect("generated orchestrator schema must be valid")
});

pub async fn handle(
    state: &AppState,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Option<Response>> {
    let path = uri.path();
    if !path.starts_with(PREFIX) {
        return Ok(None);
    }
    authorize(state, headers)?;
    let orchestrator = state.orchestrator.as_ref().ok_or_else(not_found)?;

    if method == Method::POST && path == format!("{PREFIX}/workers/register") {
        let input = validated(headers, body, 16_000, "workerRegistrationRequest")?;
        let (worker_id, expires_at) = orchestrator
            .register_worker(&OrchestratorWorkerRegistration {
                graph_version: string(&input, "graphVersion")?,
                instance_id: uuid(&input, "instanceId")?,
                protocol_digest: string(&input, "protocolDigest")?,
                protocol_version: integer(&input, "protocolVersion")?,
                public_protocol_digest: string(&input, "publicProtocolDigest")?,
                release_version: string(&input, "releaseVersion")?,
                sdk_version: string(&input, "sdkVersion")?,
            })
            .await?;
        return Ok(Some(json_response(
            StatusCode::CREATED,
            json!({"workerId":worker_id,"expiresAt":timestamp(expires_at)?}),
        )?));
    }

    if method == Method::POST
        && let Some(worker_id) = worker_route(path, "heartbeat")?
    {
        let input = validated(headers, body, 4_096, "workerHeartbeatRequest")?;
        let expires_at = orchestrator
            .heartbeat_worker(worker_id, string(&input, "releaseVersion")?)
            .await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"expiresAt":timestamp(expires_at)?}),
        )?));
    }

    if method == Method::POST && path == format!("{PREFIX}/runs/claim") {
        let input = validated(headers, body, 16_000, "claimRunRequest")?;
        let run = orchestrator
            .claim(
                uuid(&input, "workerId")?,
                string(&input, "sdkVersion")?,
                string(&input, "graphVersion")?,
            )
            .await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"run":run.map(claimed_run_json).transpose()?}),
        )?));
    }

    if method == Method::POST
        && matches!(
            path,
            "/internal/agent-orchestrator/v1/openai/v1/responses"
                | "/internal/agent-orchestrator/v1/openai/v1/responses/compact"
        )
    {
        return Ok(Some(
            proxy_model(
                state,
                uuid_header(headers, "x-trocode-agent-run-id")?,
                path.ends_with("/compact"),
                headers,
                body,
            )
            .await?,
        ));
    }

    let Some((run_id, operation, tail)) = run_route(path)? else {
        return Err(not_found());
    };

    if method == Method::POST && operation == "lease" && tail.is_none() {
        let input = validated(headers, body, 16_000, "runLeaseRequest")?;
        let worker_id = uuid(&input, "workerId")?;
        let expected = integer(&input, "expectedRunVersion")?;
        let (run_version, expires_at) = match string(&input, "action")? {
            "renew" => {
                let (version, expires) = orchestrator
                    .renew_lease(run_id, worker_id, expected)
                    .await?;
                (version, Some(timestamp(expires)?))
            }
            "release" => (
                orchestrator
                    .release_lease(run_id, worker_id, expected)
                    .await?,
                None,
            ),
            _ => return Err(invalid()),
        };
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"runVersion":run_version,"expiresAt":expires_at}),
        )?));
    }

    if method == Method::GET && operation == "session" && tail.is_none() {
        let worker_id = query_uuid(uri, "workerId")?;
        let expected = query_integer(uri, "expectedRunVersion")?;
        let snapshot = orchestrator.session(run_id, worker_id, expected).await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"revision":snapshot.revision,"items":snapshot.items}),
        )?));
    }

    if method == Method::GET && operation == "steering" && tail.is_none() {
        let updates = orchestrator
            .steering_updates(
                run_id,
                query_uuid(uri, "workerId")?,
                query_integer(uri, "expectedRunVersion")?,
                query_integer_i64(uri, "afterSequence")?,
            )
            .await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({
                "items":updates.into_iter().map(|update| json!({
                    "sequence":update.sequence,
                    "instruction":update.instruction
                })).collect::<Vec<_>>()
            }),
        )?));
    }

    if method == Method::POST && operation == "session" && tail == Some("transactions") {
        let input = validated(
            headers,
            body,
            MAX_CONTROL_BODY,
            "applySessionTransactionRequest",
        )?;
        let transaction: SessionTransaction =
            serde_json::from_value(input["transaction"].clone()).map_err(|_| invalid())?;
        let result = orchestrator
            .apply_session_transaction(
                run_id,
                uuid(&input, "workerId")?,
                integer(&input, "expectedRunVersion")?,
                integer_i64(&input, "expectedSessionRevision")?,
                string(&input, "operationId")?,
                string(&input, "operationDigest")?,
                &transaction,
            )
            .await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"revision":result.revision,"replayed":result.replayed}),
        )?));
    }

    if method == Method::PUT && operation == "checkpoint" && tail.is_none() {
        let input = validated(headers, body, MAX_CONTROL_BODY, "putCheckpointRequest")?;
        let checkpoint = PutCheckpoint {
            applied_control_sequence: integer_i64(&input, "appliedControlSequence")?,
            expected_checkpoint_revision: integer_i64(&input, "expectedCheckpointRevision")?,
            graph_version: owned_string(&input, "graphVersion")?,
            pending_call_id: optional_string(&input, "pendingCallId")?,
            sdk_version: owned_string(&input, "sdkVersion")?,
            state: owned_string(&input, "state")?,
        };
        let (checkpoint_revision, run_version) = orchestrator
            .put_checkpoint(
                run_id,
                uuid(&input, "workerId")?,
                integer(&input, "expectedRunVersion")?,
                &checkpoint,
            )
            .await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"checkpointRevision":checkpoint_revision,"runVersion":run_version}),
        )?));
    }

    if method == Method::POST && operation == "tool-calls" && tail.is_none() {
        let input = validated(headers, body, 2_000_000, "queueToolCallRequest")?;
        let call = QueueToolCall {
            arguments: input["arguments"].clone(),
            call_id: owned_string(&input, "callId")?,
            catalog_digest: owned_string(&input, "catalogDigest")?,
            driver_catalog_digest: optional_string(&input, "driverCatalogDigest")?,
            graph_version: owned_string(&input, "graphVersion")?,
            idempotency_digest: owned_string(&input, "idempotencyDigest")?,
            operation: owned_string(&input, "operation")?,
            sdk_version: owned_string(&input, "sdkVersion")?,
            tool_id: owned_string(&input, "toolId")?,
        };
        let queued = orchestrator
            .queue_tool_call(
                run_id,
                uuid(&input, "workerId")?,
                integer(&input, "expectedRunVersion")?,
                &call,
            )
            .await?;
        return Ok(Some(json_response(
            StatusCode::ACCEPTED,
            json!({"invocationId":queued.invocation_id,"runVersion":queued.run_version,"replayed":queued.replayed}),
        )?));
    }

    if method == Method::GET
        && operation == "tool-calls"
        && let Some(call_id) = tail
    {
        let result = orchestrator
            .tool_call_result(run_id, call_id, query_uuid(uri, "workerId")?)
            .await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"status":result.status,"summary":result.summary,"data":result.data,"visual":result.visual}),
        )?));
    }

    if method == Method::POST && operation == "activity" && tail.is_none() {
        let input = validated(headers, body, 16_000, "activityRequest")?;
        let version = orchestrator
            .activity(
                run_id,
                uuid(&input, "workerId")?,
                integer(&input, "expectedRunVersion")?,
                string(&input, "kind")?,
                string(&input, "summary")?,
            )
            .await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"runVersion":version}),
        )?));
    }

    if method == Method::POST && operation == "complete" && tail.is_none() {
        let input = validated(headers, body, 16_000, "completeRunRequest")?;
        let version = orchestrator
            .complete(
                run_id,
                uuid(&input, "workerId")?,
                integer(&input, "expectedRunVersion")?,
                integer_i64(&input, "appliedControlSequence")?,
                string(&input, "finalOutput")?,
            )
            .await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"runVersion":version}),
        )?));
    }

    if method == Method::POST && operation == "fail" && tail.is_none() {
        let input = validated(headers, body, 16_000, "failRunRequest")?;
        let version = orchestrator
            .fail(
                run_id,
                uuid(&input, "workerId")?,
                integer(&input, "expectedRunVersion")?,
                string(&input, "stage")?,
                string(&input, "code")?,
                boolean(&input, "retryable")?,
                string(&input, "message")?,
            )
            .await?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"runVersion":version}),
        )?));
    }

    Err(not_found())
}

async fn proxy_model(
    state: &AppState,
    run_id: Uuid,
    compact: bool,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Response> {
    let worker_id = uuid_header(headers, "x-trocode-orchestrator-worker-id")?;
    let request_id = uuid_header(headers, "x-trocode-request-id")?;
    let input = read_json(headers, body, MAX_PROVIDER_BODY)?;
    validate_model_body(state, &input)?;
    let orchestrator = state.orchestrator.as_ref().ok_or_else(not_found)?;
    let context = orchestrator
        .begin_model_request(run_id, worker_id, request_id, &input, compact)
        .await?;
    let request = ResponsesInput {
        body: input,
        agent_turn_id: context.agent_turn_id,
        request_id,
        safety_identifier: &context.safety_identifier,
        task_id: context.task_id,
        user_id: &context.user_id,
        plan_id: &context.plan_id,
    };
    let upstream_result = if compact {
        state.responses.execute_compact(request).await
    } else {
        state.responses.execute(request).await
    };
    let upstream = match upstream_result {
        Ok(upstream) => upstream,
        Err(error) => {
            let _ = orchestrator
                .mark_model_request_unknown(run_id, &context.request_digest)
                .await;
            return Err(error);
        }
    };
    if matches!(&upstream.body, ProviderBody::Stream(_)) {
        orchestrator
            .mark_model_request_unknown(run_id, &context.request_digest)
            .await?;
        return Err(ApiError::coded(
            StatusCode::BAD_GATEWAY,
            "provider_outcome_unknown",
            "The model provider returned an unsupported stream, so this step was not repeated.",
        ));
    }
    orchestrator
        .complete_model_request(run_id, &context.request_digest)
        .await
        .map_err(|_| {
            ApiError::coded(
                StatusCode::BAD_GATEWAY,
                "provider_outcome_unknown",
                "The model step completed but could not be committed safely, so it was not repeated.",
            )
        })?;
    let mut response = match upstream.body {
        ProviderBody::Buffered(body) => {
            bytes_response(upstream.status, &upstream.content_type, body)?
        }
        ProviderBody::Stream(_) => unreachable!("streaming model requests are rejected"),
    };
    for (name, value) in upstream.headers {
        if let Some(name) = name {
            response.headers_mut().insert(name, value);
        }
    }
    Ok(response)
}

fn validate_model_body(state: &AppState, input: &Value) -> ApiResult<()> {
    let object = input.as_object().ok_or_else(invalid)?;
    if object.get("model").and_then(Value::as_str)
        != Some(state.config.agent_runtime.orchestrator_model.as_str())
        || object.get("store").and_then(Value::as_bool) == Some(true)
        || object.contains_key("user")
        || object.contains_key("metadata")
    {
        return Err(ApiError::bad_request(
            "invalid_provider_request",
            "The model request does not match the pinned orchestrator configuration.",
        ));
    }
    if object.get("stream").and_then(Value::as_bool) == Some(true) {
        return Err(ApiError::bad_request(
            "invalid_provider_request",
            "Brokered orchestrator requests cannot stream.",
        ));
    }
    Ok(())
}

fn authorize(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    let expected = state
        .config
        .agent_runtime
        .orchestrator_service_token
        .as_deref()
        .ok_or_else(not_found)?;
    let Some(actual) = bearer(headers) else {
        return Err(unauthorized());
    };
    let actual_digest = Sha256::digest(actual.as_bytes());
    let expected_digest = Sha256::digest(expected.as_bytes());
    if !bool::from(actual_digest.as_slice().ct_eq(expected_digest.as_slice())) {
        return Err(unauthorized());
    }
    Ok(())
}

fn validated(headers: &HeaderMap, body: &Bytes, max: usize, property: &str) -> ApiResult<Value> {
    let input = read_json(headers, body, max)?;
    let schema = ORCHESTRATOR_SCHEMA
        .get("properties")
        .and_then(|value| value.get(property))
        .ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!("orchestrator schema property missing"))
        })?;
    let validator = jsonschema::validator_for(schema).map_err(ApiError::internal)?;
    validator.validate(&input).map_err(|_| invalid())?;
    Ok(input)
}

fn run_route(path: &str) -> ApiResult<Option<(Uuid, &str, Option<&str>)>> {
    let Some(rest) = path.strip_prefix(&format!("{PREFIX}/runs/")) else {
        return Ok(None);
    };
    let parts = rest.split('/').collect::<Vec<_>>();
    if !(2..=3).contains(&parts.len()) || parts.iter().any(|part| part.is_empty()) {
        return Ok(None);
    }
    let run_id = parts[0].parse().map_err(|_| invalid())?;
    Ok(Some((run_id, parts[1], parts.get(2).copied())))
}

fn worker_route(path: &str, operation: &str) -> ApiResult<Option<Uuid>> {
    let prefix = format!("{PREFIX}/workers/");
    let Some(rest) = path.strip_prefix(&prefix) else {
        return Ok(None);
    };
    let Some(worker) = rest.strip_suffix(&format!("/{operation}")) else {
        return Ok(None);
    };
    if worker.contains('/') {
        return Ok(None);
    }
    Ok(Some(worker.parse().map_err(|_| invalid())?))
}

fn claimed_run_json(run: ClaimedRun) -> ApiResult<Value> {
    Ok(json!({
        "runId":run.run_id,
        "runVersion":run.run_version,
        "request":run.request,
        "model":run.model,
        "sdkVersion":run.sdk_version,
        "graphVersion":run.graph_version,
        "protocolDigest":run.protocol_digest,
        "toolCatalogDigest":run.tool_catalog_digest,
        "sessionRevision":run.session_revision,
        "lastControlSequence":run.last_control_sequence,
        "tools":run.tools,
        "limits":{
            "deadlineAt":timestamp(run.deadline_at)?,
            "maxModelSamples":40,
            "maxToolCalls":30,
            "maxOutputCharacters":8000,
            "maxSessionItems":10000
        },
        "checkpoint":run.checkpoint.map(|checkpoint| json!({
            "revision":checkpoint.revision,
            "state":checkpoint.state,
            "sdkVersion":checkpoint.sdk_version,
            "graphVersion":checkpoint.graph_version,
            "pendingCallId":checkpoint.pending_call_id
        }))
    }))
}

fn query_value<'a>(uri: &'a Uri, name: &str) -> Option<std::borrow::Cow<'a, str>> {
    url::form_urlencoded::parse(uri.query()?.as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value)
}

fn query_uuid(uri: &Uri, name: &str) -> ApiResult<Uuid> {
    query_value(uri, name)
        .ok_or_else(invalid)?
        .parse()
        .map_err(|_| invalid())
}

fn query_integer(uri: &Uri, name: &str) -> ApiResult<i32> {
    query_value(uri, name)
        .ok_or_else(invalid)?
        .parse::<i32>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(invalid)
}

fn query_integer_i64(uri: &Uri, name: &str) -> ApiResult<i64> {
    query_value(uri, name)
        .ok_or_else(invalid)?
        .parse::<i64>()
        .ok()
        .filter(|value| *value >= 0)
        .ok_or_else(invalid)
}

fn uuid_header(headers: &HeaderMap, name: &str) -> ApiResult<Uuid> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .ok_or_else(invalid)
}

fn string<'a>(input: &'a Value, name: &str) -> ApiResult<&'a str> {
    input.get(name).and_then(Value::as_str).ok_or_else(invalid)
}

fn owned_string(input: &Value, name: &str) -> ApiResult<String> {
    string(input, name).map(str::to_owned)
}

fn optional_string(input: &Value, name: &str) -> ApiResult<Option<String>> {
    match input.get(name) {
        Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(invalid()),
    }
}

fn integer(input: &Value, name: &str) -> ApiResult<i32> {
    input
        .get(name)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .ok_or_else(invalid)
}

fn integer_i64(input: &Value, name: &str) -> ApiResult<i64> {
    input.get(name).and_then(Value::as_i64).ok_or_else(invalid)
}

fn uuid(input: &Value, name: &str) -> ApiResult<Uuid> {
    string(input, name)?.parse().map_err(|_| invalid())
}

fn boolean(input: &Value, name: &str) -> ApiResult<bool> {
    input.get(name).and_then(Value::as_bool).ok_or_else(invalid)
}

fn timestamp(value: OffsetDateTime) -> ApiResult<String> {
    value.format(&Rfc3339).map_err(ApiError::internal)
}

fn invalid() -> ApiError {
    ApiError::bad_request("invalid_request", "The orchestrator request is invalid.")
}

fn unauthorized() -> ApiError {
    ApiError::coded(
        StatusCode::UNAUTHORIZED,
        "unauthorized",
        "The orchestrator service token is invalid.",
    )
}

fn not_found() -> ApiError {
    ApiError::not_found("run_not_found", "Endpoint not found.")
}
