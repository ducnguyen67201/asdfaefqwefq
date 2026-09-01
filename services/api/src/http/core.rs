use std::{
    collections::BTreeSet,
    time::{Duration, Instant},
};

use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::Response,
};
use bytes::Bytes;
use futures_util::StreamExt;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::{AccessStatus, DeviceSession},
    error::{ApiError, ApiResult},
    http::{bearer, bytes_response, json_response, read_json, request_ip},
    providers::{
        CompanionImageBody, CompanionImageInput, ProviderBody, ResponsesInput, TranscriptionBody,
        TranscriptionInput, is_supported_language,
    },
    usage::{ProviderUsage, ReservationInput, SettlementInput, plan_for},
    validation::{api_uuid, js_string_len},
};

const MAX_COMPANION_IMAGE_BODY_BYTES: usize = ((5_usize * 1_024 * 1_024).div_ceil(3) * 4) + 2_048;

pub async fn session(state: &AppState, headers: &HeaderMap) -> ApiResult<DeviceSession> {
    let token = bearer(headers)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "Sign in to continue."))?;
    state.sessions.authenticate(token).await?.ok_or_else(|| {
        ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Your session expired. Sign in again.",
        )
    })
}
pub async fn access(state: &AppState, session: &DeviceSession) -> ApiResult<AccessStatus> {
    let access = state.access_codes.get_status(&session.user.id).await?;
    if access.state != "active" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "Enter a valid access code to use Tro.",
        ));
    }
    Ok(access)
}
async fn limit(
    state: &AppState,
    scope: &str,
    key: &str,
    count: i64,
    window: Duration,
) -> ApiResult<()> {
    let result = state
        .rate_limiter
        .consume(scope, key, count, window)
        .await?;
    if result.allowed {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many requests. Please try again shortly.",
        )
        .retry_after(result.retry_after_seconds))
    }
}
fn uuid_header(headers: &HeaderMap, name: &str) -> ApiResult<Uuid> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(api_uuid)
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Responses request is invalid."))
}
fn safety(user: &str) -> String {
    format!("{:x}", Sha256::digest(format!("trocode:{user}").as_bytes()))
}

pub async fn handle(
    state: &AppState,
    request_id: Uuid,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    bytes: &Bytes,
    path: &str,
) -> ApiResult<Response> {
    if method == Method::GET && path == "/healthz" {
        return json_response(
            StatusCode::OK,
            json!({"status":"ok","version":state.config.railway_git_commit_sha}),
        );
    }
    if method == Method::GET && path == "/readyz" {
        let ready = crate::db::ready(&state.pool).await;
        return json_response(
            if ready {
                StatusCode::OK
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            },
            json!({"database":if ready{"ok"}else{"unavailable"},"status":if ready{"ok"}else{"degraded"}}),
        );
    }
    if method == Method::POST && path == "/v1/auth/google/exchange" {
        limit(
            state,
            "auth.exchange",
            request_ip(headers),
            15,
            Duration::from_secs(900),
        )
        .await?;
        let input = read_json(headers, bytes, 32_000)?;
        let token = input
            .as_object()
            .filter(|map| map.len() == 1)
            .and_then(|map| map.get("idToken"))
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "idToken is required."))?;
        let user = state
            .google
            .verify(token, &state.config.google_client_id)
            .await
            .map_err(|_| {
                ApiError::new(
                    StatusCode::UNAUTHORIZED,
                    "Google sign-in could not be verified.",
                )
            })?;
        let issued = state.sessions.issue(user).await?.ok_or_else(|| {
            ApiError::new(
                StatusCode::FORBIDDEN,
                "This account has been blocked by an administrator.",
            )
        })?;
        return json_response(StatusCode::CREATED, issued);
    }
    if method == Method::POST && path == "/v1/auth/session/refresh" {
        let current = session(state, headers).await?;
        limit(
            state,
            "auth.refresh",
            &current.user.id,
            15,
            Duration::from_secs(900),
        )
        .await?;
        let rotated = state.sessions.rotate(&current).await?.ok_or_else(|| {
            ApiError::new(
                StatusCode::UNAUTHORIZED,
                "Your session expired. Sign in again.",
            )
        })?;
        return json_response(StatusCode::OK, rotated);
    }
    if method == Method::DELETE && path == "/v1/auth/session" {
        let current = session(state, headers).await?;
        state.sessions.revoke(current.session_id).await?;
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .map_err(ApiError::internal);
    }
    if method == Method::GET && path == "/v1/access-code-redemptions/me" {
        let current = session(state, headers).await?;
        return json_response(
            StatusCode::OK,
            state.access_codes.get_status(&current.user.id).await?,
        );
    }
    if method == Method::POST && path == "/v1/access-code-redemptions" {
        let current = session(state, headers).await?;
        limit(
            state,
            "access-code.user",
            &current.user.id,
            10,
            Duration::from_secs(900),
        )
        .await?;
        limit(
            state,
            "access-code.ip",
            request_ip(headers),
            100,
            Duration::from_secs(900),
        )
        .await?;
        let input = read_json(headers, bytes, 32_000)?;
        let code = input
            .as_object()
            .filter(|map| map.len() == 1)
            .and_then(|map| map.get("code"))
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Access code is required."))?;
        let value = state.access_codes.redeem(&current.user.id, code).await?;
        return json_response(
            if value.newly_redeemed {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            value,
        );
    }
    if method == Method::POST && path == "/v1/access-code-redemptions/free" {
        let current = session(state, headers).await?;
        limit(
            state,
            "access-code.user",
            &current.user.id,
            10,
            Duration::from_secs(900),
        )
        .await?;
        return json_response(
            StatusCode::OK,
            state.access_codes.continue_free(&current.user.id).await?,
        );
    }
    if method == Method::POST && path == "/v1/agent-turns" {
        let current = session(state, headers).await?;
        let membership = access(state, &current).await?;
        let plan = plan_for(membership.plan.as_deref().unwrap_or("free"))?;
        limit(
            state,
            "agent-turns.minute",
            &current.user.id,
            plan.responses_per_minute,
            Duration::from_secs(60),
        )
        .await?;
        let input = read_json(headers, bytes, 32_000)?;
        let object = input
            .as_object()
            .filter(|map| map.len() == 2)
            .ok_or_else(|| {
                ApiError::new(StatusCode::BAD_REQUEST, "Agent turn request is invalid.")
            })?;
        let client = object
            .get("clientTurnId")
            .and_then(Value::as_str)
            .and_then(api_uuid)
            .ok_or_else(|| {
                ApiError::new(StatusCode::BAD_REQUEST, "Agent turn request is invalid.")
            })?;
        let task = object
            .get("taskId")
            .and_then(Value::as_str)
            .and_then(api_uuid)
            .ok_or_else(|| {
                ApiError::new(StatusCode::BAD_REQUEST, "Agent turn request is invalid.")
            })?;
        let mut tx = state.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(&current.user.id)
            .execute(&mut *tx)
            .await?;
        let existing=sqlx::query("SELECT id,task_id,plan,status,would_deny,created_at FROM agent_turns WHERE user_id=$1 AND client_turn_id=$2").bind(&current.user.id).bind(client).fetch_optional(&mut*tx).await?;
        let (newly, id, status, created, would_deny) = if let Some(row) = existing {
            if row.get::<Uuid, _>("task_id") != task {
                tx.rollback().await?;
                return Err(ApiError::coded(
                    StatusCode::CONFLICT,
                    "agent_turn_conflict",
                    "This user turn ID is already linked to another task.",
                ));
            }
            (
                false,
                row.get::<Uuid, _>("id"),
                row.get::<String, _>("status"),
                row.get("created_at"),
                row.get::<bool, _>("would_deny"),
            )
        } else {
            let count:i64=sqlx::query_scalar("SELECT COUNT(*)::bigint FROM agent_turns WHERE user_id=$1 AND created_at>=date_trunc('week',NOW()) AND status<>'released'").bind(&current.user.id).fetch_one(&mut*tx).await?;
            let denied = count >= plan.weekly_messages;
            if denied && state.config.cost_guard.mode == crate::config::CostGuardMode::Enforce {
                tx.rollback().await?;
                return Err(ApiError::coded(
                    StatusCode::PAYMENT_REQUIRED,
                    "weekly_message_limit_reached",
                    "The weekly agent message allowance has been reached.",
                ));
            }
            let row=sqlx::query("INSERT INTO agent_turns(client_turn_id,user_id,task_id,plan,would_deny)VALUES($1,$2,$3,$4,$5)RETURNING id,status,created_at").bind(client).bind(&current.user.id).bind(task).bind(plan.id).bind(denied).fetch_one(&mut*tx).await?;
            (
                true,
                row.get("id"),
                row.get::<String, _>("status"),
                row.get("created_at"),
                denied,
            )
        };
        tx.commit().await?;
        let mut response = json_response(
            if newly {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            json!({"id":id,"clientTurnId":client,"taskId":task,"plan":plan.id,"status":status,"wouldDeny":would_deny,"newlyCreated":newly,"createdAt":format_time(created)}),
        )?;
        response.headers_mut().insert(
            "location",
            HeaderValue::from_str(&format!("/v1/agent-turns/{id}")).map_err(ApiError::internal)?,
        );
        return Ok(response);
    }
    if method == Method::GET && path == "/v1/legacy-agent-history" {
        let current = session(state, headers).await?;
        let _membership = access(state, &current).await?;
        let rows = sqlx::query(
            "SELECT task_id,state,execution_profile,public_summary,created_at,updated_at \
             FROM agent_runs WHERE user_id=$1 \
             AND state IN('completed','blocked','failed','cancelled','expired') \
             ORDER BY updated_at DESC LIMIT 50",
        )
        .bind(&current.user.id)
        .fetch_all(&state.pool)
        .await?;
        let items = rows
            .into_iter()
            .map(|row| {
                json!({
                    "taskId": row.get::<Uuid, _>("task_id"),
                    "state": row.get::<String, _>("state"),
                    "executionProfile": row.get::<String, _>("execution_profile"),
                    "summary": row.get::<String, _>("public_summary"),
                    "createdAt": format_time(row.get("created_at")),
                    "updatedAt": format_time(row.get("updated_at")),
                })
            })
            .collect::<Vec<_>>();
        return json_response(StatusCode::OK, json!({"items":items}));
    }
    if method == Method::POST
        && matches!(
            path,
            "/v1/openai/responses" | "/v1/openai/responses/compact"
        )
    {
        let current = session(state, headers).await?;
        let membership = access(state, &current).await?;
        let plan = plan_for(membership.plan.as_deref().unwrap_or("free"))?;
        limit(
            state,
            "responses.minute",
            &current.user.id,
            plan.responses_per_minute,
            Duration::from_secs(60),
        )
        .await?;
        let mut input = read_json(headers, bytes, 25_000_000)?;
        let header_request = uuid_header(headers, "x-trocode-request-id")?;
        let task = uuid_header(headers, "x-trocode-task-id")?;
        let turn = uuid_header(headers, "x-trocode-agent-turn-id")?;
        if path.ends_with("/compact") {
            validate_responses_compact(state, &input)?;
        } else {
            match validate_responses_payload(&state.config.openai_models, &mut input) {
                Ok(summary) => tracing::info!(
                    event = "agent.model.request.accepted",
                    serverRequestId = %request_id,
                    clientRequestId = %header_request,
                    taskId = %task,
                    agentTurnId = %turn,
                    model = summary.model,
                    toolChoice = summary.tool_choice,
                    toolCount = summary.tool_count,
                    inputItemCount = summary.input_item_count,
                ),
                Err(error) => {
                    tracing::warn!(
                        event = "agent.model.request.rejected",
                        serverRequestId = %request_id,
                        clientRequestId = %header_request,
                        taskId = %task,
                        agentTurnId = %turn,
                        code = error.code.unwrap_or("responses_invalid_request"),
                    );
                    return Err(error);
                }
            }
        }
        let provider_input = ResponsesInput {
            body: input,
            agent_turn_id: turn,
            request_id: header_request,
            safety_identifier: &safety(&current.user.id),
            task_id: task,
            user_id: &current.user.id,
            plan_id: plan.id,
        };
        let upstream = if path.ends_with("/compact") {
            state.responses.execute_compact(provider_input).await?
        } else {
            state.responses.execute(provider_input).await?
        };
        let mut response = match upstream.body {
            ProviderBody::Buffered(body) => {
                bytes_response(upstream.status, &upstream.content_type, body)?
            }
            ProviderBody::Stream(stream) => bytes_response(
                upstream.status,
                &upstream.content_type,
                Body::from_stream(stream),
            )?,
        };
        for (name, value) in upstream.headers {
            if let Some(name) = name {
                response.headers_mut().insert(name, value);
            }
        }
        return Ok(response);
    }
    if method == Method::GET && path == "/v1/usage/budget" {
        let current = session(state, headers).await?;
        let membership = state.access_codes.get_status(&current.user.id).await?;
        let query = uri.query().unwrap_or("");
        let task = url::form_urlencoded::parse(query.as_bytes())
            .find(|(key, _)| key == "taskId")
            .map(|(_, value)| api_uuid(&value).ok_or(()))
            .transpose()
            .map_err(|_| ApiError::new(StatusCode::BAD_REQUEST, "taskId is invalid."))?;
        return json_response(
            StatusCode::OK,
            state
                .budget
                .snapshot(
                    &current.user.id,
                    task,
                    if membership.state == "active" {
                        membership.plan.as_deref().unwrap_or("free")
                    } else {
                        "free"
                    },
                )
                .await?,
        );
    }
    if method == Method::GET && path == "/v1/companion-images/quota" {
        let current = session(state, headers).await?;
        let membership = access(state, &current).await?;
        if hosted_model_calls_available(state) {
            return json_response(
                StatusCode::OK,
                json!({
                    "quota": state.budget.companion_generation_snapshot(
                        &current.user.id,
                        membership.plan.as_deref().unwrap_or("free"),
                    ).await?,
                    "state": "available",
                    "summary": "Create up to five cursor companions each month.",
                }),
            );
        }
        return json_response(
            StatusCode::OK,
            json!({
                "quota": null,
                "state": "unavailable",
                "summary": "Companion generation is not available for this account.",
            }),
        );
    }
    if method == Method::POST && path == "/v1/openai/images/companion-edits" {
        let current = session(state, headers).await?;
        let membership = access(state, &current).await?;
        if !hosted_model_calls_available(state) {
            return Err(ApiError::coded(
                StatusCode::FORBIDDEN,
                "companion_generation_unavailable",
                "Companion generation is not available for this account.",
            ));
        }
        let plan = plan_for(membership.plan.as_deref().unwrap_or("free"))?;
        limit(
            state,
            "companion-images.minute",
            &current.user.id,
            plan.companion_generations_per_minute,
            Duration::from_secs(60),
        )
        .await?;
        let input_value = read_json(headers, bytes, MAX_COMPANION_IMAGE_BODY_BYTES)?;
        let input: CompanionImageBody = serde_json::from_value(input_value).map_err(|_| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Companion image request is invalid.",
            )
        })?;
        let header_request = uuid_header(headers, "x-trocode-request-id").map_err(|_| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Companion image request is invalid.",
            )
        })?;
        let result = state
            .companion_images
            .execute(CompanionImageInput {
                body: input,
                plan_id: plan.id,
                request_id: header_request,
                safety_identifier: &safety(&current.user.id),
                user_id: &current.user.id,
            })
            .await?;
        return json_response(StatusCode::OK, result);
    }
    if method == Method::POST && path == "/v1/openai/audio/transcriptions" {
        let current = session(state, headers).await?;
        let membership = access(state, &current).await?;
        limit(
            state,
            "transcription.minute",
            &current.user.id,
            60,
            Duration::from_secs(60),
        )
        .await?;
        let input_value = read_json(headers, bytes, 1_000_000)?;
        if input_value
            .get("utteranceId")
            .and_then(Value::as_str)
            .and_then(api_uuid)
            .is_none()
        {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Transcription request is invalid.",
            ));
        }
        let input: TranscriptionBody = serde_json::from_value(input_value).map_err(|_| {
            ApiError::new(StatusCode::BAD_REQUEST, "Transcription request is invalid.")
        })?;
        if !is_supported_language(&input.language) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "Transcription request is invalid.",
            ));
        }
        let header_request = uuid_header(headers, "x-trocode-request-id").map_err(|_| {
            ApiError::new(StatusCode::BAD_REQUEST, "Transcription request is invalid.")
        })?;
        let mut result = serde_json::to_value(
            state
                .transcription
                .execute(TranscriptionInput {
                    body: input,
                    request_id: header_request,
                    safety_identifier: &safety(&current.user.id),
                    user_id: &current.user.id,
                    plan_id: membership.plan.as_deref().unwrap_or("free"),
                })
                .await?,
        )
        .map_err(ApiError::internal)?;
        if headers
            .get("x-trocode-transcription-contract")
            .and_then(|value| value.to_str().ok())
            != Some("2")
        {
            result["model"] = Value::String("whisper-1".to_owned());
        }
        return json_response(StatusCode::OK, result);
    }
    if method == Method::POST && path == "/v1/openai/realtime/calls" {
        return realtime(state, request_id, headers, bytes).await;
    }
    if method == Method::POST && path == "/v1/elevenlabs/speech" {
        return speech(state, request_id, headers, bytes).await;
    }
    Err(ApiError::new(StatusCode::NOT_FOUND, "Endpoint not found."))
}

fn hosted_model_calls_available(state: &AppState) -> bool {
    state.config.cost_guard.enabled
}

#[derive(Debug, Eq, PartialEq)]
struct ResponsesRequestSummary {
    model: String,
    tool_choice: String,
    tool_count: usize,
    input_item_count: usize,
}

fn valid_function_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn response_tool_choice(object: &serde_json::Map<String, Value>) -> ApiResult<String> {
    let tool_choice = object.get("tool_choice").ok_or_else(|| {
        ApiError::bad_request(
            "responses_invalid_tool_choice",
            "The requested model tool is unavailable.",
        )
    })?;
    if tool_choice.as_str() == Some("auto") {
        return Ok("auto".to_owned());
    }
    let Some(choice) = tool_choice.as_object() else {
        return Err(ApiError::bad_request(
            "responses_invalid_tool_choice",
            "The requested model tool is unavailable.",
        ));
    };
    let Some(name) = choice.get("name").and_then(Value::as_str) else {
        return Err(ApiError::bad_request(
            "responses_invalid_tool_choice",
            "The requested model tool is unavailable.",
        ));
    };
    let named_function = choice.get("type").and_then(Value::as_str) == Some("function")
        && valid_function_name(name)
        && object
            .get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| {
                tools.iter().any(|tool| {
                    tool.get("type").and_then(Value::as_str) == Some("function")
                        && tool.get("name").and_then(Value::as_str) == Some(name)
                })
            });
    if named_function {
        Ok(format!("function:{name}"))
    } else {
        Err(ApiError::bad_request(
            "responses_invalid_tool_choice",
            "The requested model tool is unavailable.",
        ))
    }
}

fn validate_responses_payload(
    allowed_models: &BTreeSet<String>,
    input: &mut Value,
) -> ApiResult<ResponsesRequestSummary> {
    let object = input.as_object_mut().ok_or_else(|| {
        ApiError::bad_request("responses_invalid_request", "Responses request is invalid.")
    })?;
    object
        .entry("tool_choice")
        .or_insert(Value::String("auto".to_owned()));
    let model = object
        .get("model")
        .and_then(Value::as_str)
        .filter(|model| allowed_models.contains(*model));
    let input_items = object.get("input").and_then(Value::as_array);
    let tools = object.get("tools").and_then(Value::as_array);
    let valid = model.is_some()
        && input_items.is_some_and(|items| items.len() <= 256)
        && tools.is_some_and(|items| items.len() <= 128)
        && object.get("parallel_tool_calls").and_then(Value::as_bool) == Some(false)
        && object.get("store").and_then(Value::as_bool) == Some(false)
        && object
            .get("max_output_tokens")
            .and_then(Value::as_i64)
            .is_some_and(|value| (1..=4_000).contains(&value));
    if !valid {
        return Err(ApiError::bad_request(
            "responses_invalid_request",
            "Responses request is invalid.",
        ));
    }
    let tool_choice = response_tool_choice(object)?;
    Ok(ResponsesRequestSummary {
        model: model.expect("validated model").to_owned(),
        tool_choice,
        tool_count: tools.expect("validated tools").len(),
        input_item_count: input_items.expect("validated input").len(),
    })
}

fn validate_responses_compact(state: &AppState, input: &Value) -> ApiResult<()> {
    let valid_input = input.get("input").is_some_and(|value| match value {
        Value::String(text) => text.len() <= 2_000_000,
        Value::Array(items) => items.len() <= 256,
        _ => false,
    });
    let valid = input
        .get("model")
        .and_then(Value::as_str)
        .is_some_and(|model| state.config.openai_models.contains(model))
        && valid_input
        && input.get("stream").and_then(Value::as_bool) != Some(true)
        && input.get("tools").is_none();
    if valid {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Responses compact request is invalid.",
        ))
    }
}
async fn realtime(
    state: &AppState,
    request_id: Uuid,
    headers: &HeaderMap,
    bytes: &Bytes,
) -> ApiResult<Response> {
    let current = session(state, headers).await?;
    let membership = access(state, &current).await?;
    limit(
        state,
        "realtime.minute",
        &current.user.id,
        30,
        Duration::from_secs(60),
    )
    .await?;
    let input = read_json(headers, bytes, 4_000_000)?;
    let language = input
        .get("language")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "en" | "vi"))
        .ok_or_else(|| {
            ApiError::new(StatusCode::BAD_REQUEST, "Realtime call request is invalid.")
        })?;
    let sdp = input
        .get("offerSdp")
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("v=0") && js_string_len(value) <= 1_000_000)
        .ok_or_else(|| {
            ApiError::new(StatusCode::BAD_REQUEST, "Realtime call request is invalid.")
        })?;
    let task = Uuid::parse_str("00000000-0000-4000-8000-000000000000").expect("static uuid");
    let reserved = state.budget.realtime_call_estimate_micro_usd();
    state
        .budget
        .reserve(ReservationInput {
            agent_turn_id: None,
            catalog_version: "voice-estimate-v1",
            lane: "realtime_transcription",
            model: "gpt-realtime-whisper",
            plan_id: membership.plan.as_deref().unwrap_or("free"),
            request_id,
            reserved_micro_usd: reserved,
            task_id: task,
            user_id: &current.user.id,
        })
        .await?;
    state
        .budget
        .mark_dispatched(&current.user.id, request_id)
        .await?;
    let session = json!({"type":"transcription","audio":{"input":{"noise_reduction":{"type":"far_field"},"transcription":{"language":language,"model":"gpt-realtime-whisper"},"turn_detection":null}}});
    let form = reqwest::multipart::Form::new()
        .text("sdp", sdp.to_owned())
        .text(
            "session",
            serde_json::to_string(&session).map_err(ApiError::internal)?,
        );
    let started = Instant::now();
    let request = reqwest::Client::new()
        .post("https://api.openai.com/v1/realtime/calls")
        .bearer_auth(&state.config.openai_api_key)
        .header("openai-safety-identifier", safety(&current.user.id))
        .multipart(form);
    let response = match tokio::time::timeout(Duration::from_secs(30), request.send()).await {
        Ok(Ok(value)) => value,
        Ok(Err(_)) | Err(_) => {
            state
                .budget
                .mark_uncertain(&current.user.id, request_id)
                .await?;
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                "The voice provider is temporarily unavailable.",
            ));
        }
    };
    let status = response.status();
    let content = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/sdp")
        .to_owned();
    let body = response.bytes().await.map_err(ApiError::internal)?;
    if body.len() > 5_000_000 {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "Upstream response was unexpectedly large.",
        ));
    }
    if status.is_success() {
        let usage = ProviderUsage {
            cache_write_tokens: 0,
            cached_input_tokens: 0,
            input_tokens: 0,
            input_text_tokens: 0,
            input_image_tokens: 0,
            model: "gpt-realtime-whisper".to_owned(),
            output_tokens: 0,
            output_image_tokens: 0,
            reasoning_tokens: 0,
        };
        state
            .budget
            .settle(SettlementInput {
                actual_micro_usd: reserved,
                audio_duration_ms: 0,
                character_count: 0,
                duration_ms: i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
                provider_response_id: None,
                request_id,
                usage: &usage,
                usage_source: "estimated",
                user_id: &current.user.id,
            })
            .await?;
    } else if matches!(status.as_u16(), 400 | 401 | 403 | 404 | 422) {
        state
            .budget
            .release(&current.user.id, request_id, "rejected_before_inference")
            .await?;
    } else {
        state
            .budget
            .mark_uncertain(&current.user.id, request_id)
            .await?;
    }
    bytes_response(status, &content, body)
}
async fn speech(
    state: &AppState,
    request_id: Uuid,
    headers: &HeaderMap,
    bytes: &Bytes,
) -> ApiResult<Response> {
    let current = session(state, headers).await?;
    let membership = access(state, &current).await?;
    limit(
        state,
        "speech.minute",
        &current.user.id,
        30,
        Duration::from_secs(60),
    )
    .await?;
    let key = state.config.eleven_labs_api_key.as_deref().ok_or_else(|| {
        ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Speech playback is not configured.",
        )
    })?;
    let voice = state
        .config
        .eleven_labs_voice_id
        .as_deref()
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Speech playback is not configured.",
            )
        })?;
    let input = read_json(headers, bytes, 32_000)?;
    let text = input
        .as_object()
        .filter(|map| map.len() == 1)
        .and_then(|map| map.get("text"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| (1..=240).contains(&js_string_len(value)))
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Speech text must contain 1 to 240 characters.",
            )
        })?;
    let character_count = js_string_len(text);
    let reserved = state.budget.speech_estimate_micro_usd(character_count);
    let task = Uuid::parse_str("00000000-0000-4000-8000-000000000000").expect("uuid");
    state
        .budget
        .reserve(ReservationInput {
            agent_turn_id: None,
            catalog_version: "voice-estimate-v1",
            lane: "speech",
            model: &state.config.eleven_labs_model_id,
            plan_id: membership.plan.as_deref().unwrap_or("free"),
            request_id,
            reserved_micro_usd: reserved,
            task_id: task,
            user_id: &current.user.id,
        })
        .await?;
    state
        .budget
        .mark_dispatched(&current.user.id, request_id)
        .await?;
    let url = format!(
        "https://api.elevenlabs.io/v1/text-to-speech/{voice}/stream?output_format=mp3_44100_128"
    );
    let request = reqwest::Client::new()
        .post(url)
        .header("accept", "audio/mpeg")
        .header("xi-api-key", key)
        .json(&json!({"text":text,"model_id":state.config.eleven_labs_model_id}));
    let response = match tokio::time::timeout(Duration::from_secs(20), request.send()).await {
        Ok(Ok(value)) => value,
        Ok(Err(_)) | Err(_) => {
            state
                .budget
                .mark_uncertain(&current.user.id, request_id)
                .await?;
            return Err(ApiError::new(
                StatusCode::BAD_GATEWAY,
                "Speech playback is temporarily unavailable.",
            ));
        }
    };
    let status = response.status();
    if !status.is_success() {
        if matches!(status.as_u16(), 400 | 401 | 403 | 404 | 422) {
            state
                .budget
                .release(&current.user.id, request_id, "rejected_before_inference")
                .await?;
        } else {
            state
                .budget
                .mark_uncertain(&current.user.id, request_id)
                .await?;
        }
        return Err(ApiError::new(
            if status.is_server_error() {
                StatusCode::SERVICE_UNAVAILABLE
            } else {
                StatusCode::BAD_GATEWAY
            },
            "Speech playback is temporarily unavailable.",
        ));
    }
    if !response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase()
        .starts_with("audio/mpeg")
    {
        state
            .budget
            .mark_uncertain(&current.user.id, request_id)
            .await?;
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "Speech playback is temporarily unavailable.",
        ));
    }
    let usage = ProviderUsage {
        cache_write_tokens: 0,
        cached_input_tokens: 0,
        input_tokens: 0,
        input_text_tokens: 0,
        input_image_tokens: 0,
        model: state.config.eleven_labs_model_id.clone(),
        output_tokens: 0,
        output_image_tokens: 0,
        reasoning_tokens: 0,
    };
    state
        .budget
        .settle(SettlementInput {
            actual_micro_usd: reserved,
            audio_duration_ms: 0,
            character_count: i64::try_from(character_count).unwrap_or(i64::MAX),
            duration_ms: 0,
            provider_response_id: None,
            request_id,
            usage: &usage,
            usage_source: "estimated",
            user_id: &current.user.id,
        })
        .await?;
    let stream = response.bytes_stream().scan(0usize, |total, next| {
        let result = next.map_err(std::io::Error::other).and_then(|bytes| {
            *total = total.saturating_add(bytes.len());
            if *total > 5_000_000 {
                Err(std::io::Error::other("speech response too large"))
            } else {
                Ok(bytes)
            }
        });
        std::future::ready(Some(result))
    });
    bytes_response(StatusCode::OK, "audio/mpeg", Body::from_stream(stream))
}
fn format_time(value: time::OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use serde_json::json;

    use super::*;

    fn allowed_models() -> BTreeSet<String> {
        BTreeSet::from(["gpt-5.6-luna".to_owned()])
    }

    fn responses_request(tool_choice: Value, tools: Value) -> Value {
        json!({
            "input": [{"role": "user", "content": [{"type": "input_text", "text": "private"}]}],
            "max_output_tokens": 128,
            "model": "gpt-5.6-luna",
            "parallel_tool_calls": false,
            "store": false,
            "tool_choice": tool_choice,
            "tools": tools,
        })
    }

    #[test]
    fn responses_validation_accepts_a_named_function_present_in_the_catalog() {
        let mut input = responses_request(
            json!({"type": "function", "name": "observe_context"}),
            json!([{"type": "function", "name": "observe_context"}]),
        );

        let summary = validate_responses_payload(&allowed_models(), &mut input)
            .expect("the named function is present in the submitted catalog");

        assert_eq!(summary.model, "gpt-5.6-luna");
        assert_eq!(summary.tool_choice, "function:observe_context");
        assert_eq!(summary.tool_count, 1);
    }

    #[test]
    fn responses_validation_rejects_a_named_function_missing_from_the_catalog() {
        let mut input = responses_request(
            json!({"type": "function", "name": "observe_context"}),
            json!([{"type": "function", "name": "different_tool"}]),
        );

        let error = validate_responses_payload(&allowed_models(), &mut input)
            .expect_err("an unavailable named function must fail closed");

        assert_eq!(error.code, Some("responses_invalid_tool_choice"));
    }
}
