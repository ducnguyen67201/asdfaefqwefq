use std::{collections::HashSet, convert::Infallible, time::Duration};

use async_stream::stream;
use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::Response,
};
use bytes::Bytes;
use serde_json::json;
use tokio::time::MissedTickBehavior;
use uuid::Uuid;

use crate::{
    agent::protocol,
    app::AppState,
    error::{ApiError, ApiResult},
    http::{
        core::{access, session},
        json_response, read_json,
    },
};

pub async fn handle(
    state: &AppState,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Option<Response>> {
    let path = uri.path();
    if !matches_agent_runtime(path) {
        return Ok(None);
    }

    let current = session(state, headers).await?;
    let membership = access(state, &current).await?;
    let Some(agent) = state.agent.as_ref() else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Endpoint not found."));
    };
    let enabled = agent.enabled_for(&current.user.id);

    if method == Method::GET && path == "/v1/agent-runtime/v3/status" {
        let mode = agent.v3_mode().as_str();
        let value = json!({
            "protocolVersion": protocol::PROTOCOL_VERSION,
            "protocolDigest": protocol::protocol_digest(),
            "toolCatalogDigest": protocol::tool_catalog_digest(),
            "supportedReadVersions": [2, 3],
            "supportedStartVersions": if mode == "enforce" { vec![3] } else { vec![2, 3] },
            "rolloutMode": mode,
            "workerRequired": enabled || agent.has_active(&current.user.id).await?,
            "enabled": enabled
        });
        let status: protocol::AgentRuntimeStatusV3 =
            serde_json::from_value(value).map_err(ApiError::internal)?;
        return Ok(Some(json_response(StatusCode::OK, status)?));
    }

    if method == Method::GET && path == "/v1/agent-runtime/status" {
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({
                "enabled": enabled,
                "protocolVersion": 2,
                "workerRequired": enabled || agent.has_active(&current.user.id).await?,
            }),
        )?));
    }

    if method == Method::POST && path == "/v1/tasks" {
        if !enabled {
            return Err(ApiError::coded(
                StatusCode::CONFLICT,
                "backend_agent_not_enabled",
                "The durable agent runtime is not enabled for this user.",
            ));
        }
        let input = read_json(headers, body, 64_000)?;
        let run = agent
            .submit(
                &current.user.id,
                membership.plan.as_deref().unwrap_or("free"),
                &input,
            )
            .await?;
        let status = if run["newlyCreated"].as_bool() == Some(true) {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        };
        let mut response = json_response(status, &run)?;
        if let Some(id) = run["id"].as_str() {
            response.headers_mut().insert(
                "location",
                HeaderValue::from_str(&format!("/v1/tasks/{id}")).map_err(ApiError::internal)?,
            );
        }
        return Ok(Some(response));
    }

    if method == Method::POST && path == "/v1/agent-runtime/v3/tasks" {
        if !enabled {
            return Err(ApiError::coded(
                StatusCode::CONFLICT,
                "agent_runtime_unavailable",
                "The durable agent runtime is not enabled for this user.",
            ));
        }
        let input = read_json(headers, body, 64_000)?;
        let typed: protocol::SubmitAgentTaskRequestV3 =
            serde_json::from_value(input).map_err(|_| {
                ApiError::bad_request("invalid_agent_runtime_request", "Request data is invalid.")
            })?;
        let input = serde_json::to_value(typed).map_err(ApiError::internal)?;
        let run = agent
            .submit(
                &current.user.id,
                membership.plan.as_deref().unwrap_or("free"),
                &input,
            )
            .await?;
        let status = if run["newlyCreated"].as_bool() == Some(true) {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        };
        return Ok(Some(json_response(status, agent.project_v3_run(&run)?)?));
    }

    if method == Method::GET && path == "/v1/agent-runtime/v3/tasks" {
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"items":agent.list_v3(&current.user.id).await?}),
        )?));
    }

    if let Some((run_id, operation)) = v3_task_route(path)? {
        if method == Method::GET && operation.is_none() {
            let run = agent
                .get_v3(&current.user.id, run_id)
                .await?
                .ok_or_else(not_found)?;
            return Ok(Some(json_response(StatusCode::OK, run)?));
        }
        if method == Method::GET && operation == Some("events") {
            if agent.get_v3(&current.user.id, run_id).await?.is_none() {
                return Err(not_found());
            }
            return Ok(Some(run_event_stream(
                agent.clone(),
                current.user.id,
                run_id,
                after_sequence(headers, uri)?,
                state.shutdown.clone(),
                true,
            )?));
        }
        if method == Method::POST && operation == Some("cancel") {
            let input = read_json(headers, body, 16_000)?;
            let typed: protocol::CancelAgentTaskRequestV3 =
                serde_json::from_value(input).map_err(|_| {
                    ApiError::bad_request(
                        "invalid_agent_runtime_request",
                        "Request data is invalid.",
                    )
                })?;
            let input = serde_json::to_value(typed).map_err(ApiError::internal)?;
            let run = agent
                .cancel_v3(&current.user.id, run_id, &input)
                .await?
                .ok_or_else(not_found)?;
            return Ok(Some(json_response(StatusCode::OK, run)?));
        }
        if method == Method::POST && operation == Some("approval") {
            let input = read_json(headers, body, 16_000)?;
            let typed: protocol::ApprovalDecisionRequestV3 = serde_json::from_value(input)
                .map_err(|_| {
                    ApiError::bad_request(
                        "invalid_agent_runtime_request",
                        "Request data is invalid.",
                    )
                })?;
            let input = serde_json::to_value(typed).map_err(ApiError::internal)?;
            agent
                .control(&current.user.id, run_id, "approval", &input)
                .await?
                .ok_or_else(not_found)?;
            let run = agent
                .get_v3(&current.user.id, run_id)
                .await?
                .ok_or_else(not_found)?;
            return Ok(Some(json_response(StatusCode::OK, run)?));
        }
    }

    if method == Method::GET && path == "/v1/tasks" {
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"items": agent.list(&current.user.id).await?}),
        )?));
    }

    if let Some((run_id, operation)) = task_route(path)? {
        if method == Method::GET && operation.is_none() {
            let run = agent
                .get(&current.user.id, run_id)
                .await?
                .ok_or_else(not_found)?;
            return Ok(Some(json_response(StatusCode::OK, run)?));
        }
        if method == Method::GET && operation == Some("events") {
            if agent.get(&current.user.id, run_id).await?.is_none() {
                return Err(not_found());
            }
            return Ok(Some(run_event_stream(
                agent.clone(),
                current.user.id,
                run_id,
                after_sequence(headers, uri)?,
                state.shutdown.clone(),
                false,
            )?));
        }
        if (method == Method::DELETE && operation.is_none())
            || (method == Method::POST && operation == Some("cancel"))
        {
            let run = agent
                .cancel(&current.user.id, run_id)
                .await?
                .ok_or_else(not_found)?;
            return Ok(Some(json_response(StatusCode::OK, run)?));
        }
        if method == Method::POST && matches!(operation, Some("steering" | "approval")) {
            let kind = operation.expect("matched operation");
            let input = read_json(headers, body, 16_000)?;
            let event = agent
                .control(&current.user.id, run_id, kind, &input)
                .await?
                .ok_or_else(not_found)?;
            return Ok(Some(json_response(StatusCode::ACCEPTED, event)?));
        }
    }

    if method == Method::POST && path == "/v1/desktop-worker/connect" {
        let capabilities = read_json(headers, body, 64_000)?;
        return Ok(Some(json_response(
            StatusCode::CREATED,
            agent
                .connect_worker(&current.user.id, current.session_id, &capabilities)
                .await?,
        )?));
    }

    if method == Method::GET && path == "/v1/desktop-worker/events" {
        let worker = query_value(uri, "workerSessionId")
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "workerSessionId is required."))?
            .parse::<Uuid>()
            .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "workerSessionId is invalid."))?;
        return Ok(Some(worker_event_stream(
            agent.clone(),
            current.user.id,
            worker,
            state.shutdown.clone(),
        )?));
    }

    if let Some((worker, operation)) = worker_route(path)? {
        if method != Method::POST {
            return Err(not_found());
        }
        let value = match operation {
            "heartbeat" => agent
                .heartbeat(&current.user.id, worker)
                .await?
                .ok_or_else(not_found)?,
            "disconnect" => agent.disconnect(&current.user.id, worker).await?,
            "executing" => {
                let input = read_json(headers, body, 1_000_000)?;
                agent
                    .grant_execution(&current.user.id, worker, &input)
                    .await?
            }
            "result" => {
                let input = read_json(headers, body, 1_000_000)?;
                agent
                    .record_result(&current.user.id, worker, &input)
                    .await?
            }
            "permission-wait" => {
                let input = read_json(headers, body, 16_000)?;
                let typed: protocol::PermissionWaitRequestV3 = serde_json::from_value(input)
                    .map_err(|_| {
                        ApiError::bad_request(
                            "invalid_agent_runtime_request",
                            "Request data is invalid.",
                        )
                    })?;
                let input = serde_json::to_value(typed).map_err(ApiError::internal)?;
                agent
                    .wait_for_permission(&current.user.id, worker, &input)
                    .await?
            }
            "permission-decision" => {
                let input = read_json(headers, body, 16_000)?;
                let typed: protocol::PermissionDecisionRequestV3 = serde_json::from_value(input)
                    .map_err(|_| {
                        ApiError::bad_request(
                            "invalid_agent_runtime_request",
                            "Request data is invalid.",
                        )
                    })?;
                let input = serde_json::to_value(typed).map_err(ApiError::internal)?;
                agent
                    .decide_permission(&current.user.id, worker, &input)
                    .await?
            }
            _ => return Err(not_found()),
        };
        return Ok(Some(json_response(StatusCode::OK, value)?));
    }

    Err(not_found())
}

fn matches_agent_runtime(path: &str) -> bool {
    path == "/v1/agent-runtime/status"
        || path.starts_with("/v1/agent-runtime/v3/")
        || path == "/v1/tasks"
        || path.starts_with("/v1/tasks/")
        || path.starts_with("/v1/desktop-worker/")
}

fn v3_task_route(path: &str) -> ApiResult<Option<(Uuid, Option<&str>)>> {
    let Some(rest) = path.strip_prefix("/v1/agent-runtime/v3/tasks/") else {
        return Ok(None);
    };
    let mut parts = rest.split('/');
    let id = parts
        .next()
        .ok_or_else(invalid_uuid)?
        .parse()
        .map_err(|_| invalid_uuid())?;
    let operation = parts.next();
    if parts.next().is_some()
        || operation.is_some_and(|value| !matches!(value, "events" | "cancel"))
    {
        return Ok(None);
    }
    Ok(Some((id, operation)))
}

fn task_route(path: &str) -> ApiResult<Option<(Uuid, Option<&str>)>> {
    let Some(rest) = path.strip_prefix("/v1/tasks/") else {
        return Ok(None);
    };
    let mut parts = rest.split('/');
    let id = parts
        .next()
        .ok_or_else(invalid_uuid)?
        .parse()
        .map_err(|_| invalid_uuid())?;
    let operation = parts.next();
    if parts.next().is_some()
        || operation
            .is_some_and(|value| !matches!(value, "events" | "steering" | "cancel" | "approval"))
    {
        return Ok(None);
    }
    Ok(Some((id, operation)))
}

fn worker_route(path: &str) -> ApiResult<Option<(Uuid, &str)>> {
    let Some(rest) = path.strip_prefix("/v1/desktop-worker/") else {
        return Ok(None);
    };
    let mut parts = rest.split('/');
    let Some(raw_id) = parts.next() else {
        return Ok(None);
    };
    if raw_id == "connect" || raw_id == "events" {
        return Ok(None);
    }
    let id = raw_id.parse().map_err(|_| invalid_uuid())?;
    let Some(operation) = parts.next() else {
        return Ok(None);
    };
    if parts.next().is_some() {
        return Ok(None);
    }
    Ok(Some((id, operation)))
}

fn invalid_uuid() -> ApiError {
    ApiError::coded(
        StatusCode::BAD_REQUEST,
        "invalid_request",
        "Request data is invalid.",
    )
}

fn not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "Endpoint not found.")
}

fn query_value(uri: &Uri, name: &str) -> Option<String> {
    url::form_urlencoded::parse(uri.query()?.as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
}

fn after_sequence(headers: &HeaderMap, uri: &Uri) -> ApiResult<i64> {
    let raw = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned)
        .or_else(|| query_value(uri, "after"))
        .unwrap_or_else(|| "0".to_owned());
    raw.parse::<i64>()
        .ok()
        .filter(|value| *value >= 0)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Event replay sequence is invalid."))
}

fn run_event_stream(
    agent: crate::agent::AgentService,
    user_id: String,
    run_id: Uuid,
    mut after: i64,
    shutdown: tokio_util::sync::CancellationToken,
    v3: bool,
) -> ApiResult<Response> {
    let stream = stream! {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                () = shutdown.cancelled() => break,
                _ = interval.tick() => {}
            }
            let fetched = if v3 {
                agent.events_v3(&user_id, run_id, after).await
            } else {
                agent.events(&user_id, run_id, after).await
            };
            match fetched {
                Ok(events) => {
                    for event in events {
                        if let Some(sequence) = event["sequence"].as_i64() {
                            after = sequence;
                        }
                        let id = event["sequence"].as_i64().unwrap_or(after);
                        let kind = event.get(if v3 { "eventType" } else { "type" }).and_then(serde_json::Value::as_str).unwrap_or("run.event");
                        match serde_json::to_string(&event) {
                            Ok(data) => yield Ok::<_, Infallible>(format!("id: {id}\nevent: {kind}\ndata: {data}\n\n")),
                            Err(_) => continue,
                        }
                    }
                    yield Ok::<_, Infallible>(": heartbeat\n\n".to_owned());
                }
                Err(error) => {
                    tracing::warn!(event="agent.events.stream_failed", code=error.code.unwrap_or("stream_failed"));
                    break;
                }
            }
        }
    };
    sse_response(Body::from_stream(stream))
}

fn worker_event_stream(
    agent: crate::agent::AgentService,
    user_id: String,
    worker_id: Uuid,
    shutdown: tokio_util::sync::CancellationToken,
) -> ApiResult<Response> {
    let stream = stream! {
        let mut seen = HashSet::new();
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                () = shutdown.cancelled() => break,
                _ = interval.tick() => {}
            }
            match agent.pending(&user_id, worker_id).await {
                Ok(items) => {
                    for item in items {
                        let id = item["invocationId"].as_str().unwrap_or_default().to_owned();
                        if !seen.insert(id.clone()) {
                            continue;
                        }
                        match serde_json::to_string(&item) {
                            Ok(data) => yield Ok::<_, Infallible>(format!("id: {id}\nevent: tool.requested\ndata: {data}\n\n")),
                            Err(_) => continue,
                        }
                    }
                    yield Ok::<_, Infallible>(": heartbeat\n\n".to_owned());
                }
                Err(error) => {
                    tracing::warn!(event="agent.worker_events.stream_failed", code=error.code.unwrap_or("stream_failed"));
                    break;
                }
            }
        }
    };
    sse_response(Body::from_stream(stream))
}

fn sse_response(body: Body) -> ApiResult<Response> {
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream; charset=utf-8")
        .header("cache-control", "no-cache")
        .header("connection", "keep-alive")
        .header("x-accel-buffering", "no")
        .body(body)
        .map_err(ApiError::internal)
}
