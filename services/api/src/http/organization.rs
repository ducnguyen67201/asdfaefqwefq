use std::time::Duration;

use axum::{
    http::{HeaderMap, Method, StatusCode, Uri},
    response::Response,
};
use bytes::Bytes;
use serde_json::{Value, json};

use crate::{
    app::AppState,
    auth::{normalize_organization_email, normalize_organization_name},
    error::{ApiError, ApiResult},
    http::{core, json_response, read_json, request_ip},
    validation::api_uuid,
};

fn matches(path: &str) -> bool {
    path == "/v1/organizations/me" || path.starts_with("/v1/organizations/me/")
}

fn integer_parameter(
    uri: &Uri,
    name: &str,
    default: i64,
    minimum: i64,
    maximum: i64,
) -> ApiResult<i64> {
    let mut found = None;
    if let Some(query) = uri.query() {
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            if key == name {
                if found.is_some()
                    || value.is_empty()
                    || !value.bytes().all(|byte| byte.is_ascii_digit())
                {
                    return Err(ApiError::coded(
                        StatusCode::BAD_REQUEST,
                        "invalid_request",
                        "Pagination is invalid.",
                    ));
                }
                found = value.parse::<i64>().ok();
            }
        }
    }
    let value = found.unwrap_or(default);
    if !(minimum..=maximum).contains(&value) {
        return Err(ApiError::coded(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "Pagination is invalid.",
        ));
    }
    Ok(value)
}

async fn mutation_limit(
    state: &AppState,
    headers: &HeaderMap,
    user_id: &str,
    user_scope: &'static str,
    user_count: i64,
    ip_scope: &'static str,
    ip_count: i64,
) -> ApiResult<()> {
    for (scope, key, count) in [
        (user_scope, user_id, user_count),
        (ip_scope, request_ip(headers), ip_count),
    ] {
        let result = state
            .rate_limiter
            .consume(scope, key, count, Duration::from_secs(900))
            .await?;
        if !result.allowed {
            return Err(ApiError::coded(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "Too many requests. Please try again shortly.",
            )
            .retry_after(result.retry_after_seconds));
        }
    }
    Ok(())
}

pub async fn handle(
    state: &AppState,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Option<Response>> {
    let path = uri.path();
    if !matches(path) {
        return Ok(None);
    }
    let session = core::session(state, headers).await?;
    core::access(state, &session).await?;
    let user_id = &session.user.id;

    if method == Method::GET && path == "/v1/organizations/me" {
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"organization":state.organizations.current_for_user(user_id).await?}),
        )?));
    }
    if method == Method::PATCH && path == "/v1/organizations/me" {
        mutation_limit(
            state,
            headers,
            user_id,
            "organization.profile.user",
            15,
            "organization.profile.ip",
            60,
        )
        .await?;
        let input = read_json(headers, body, 4_096)?;
        let name = input
            .as_object()
            .filter(|object| object.len() == 1)
            .and_then(|object| object.get("name"))
            .and_then(Value::as_str)
            .and_then(normalize_organization_name)
            .ok_or_else(|| {
                ApiError::coded(
                    StatusCode::BAD_REQUEST,
                    "invalid_request",
                    "A valid organization name is required.",
                )
            })?;
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"organization":state.organizations.update_name(user_id, &name).await?}),
        )?));
    }
    if method == Method::GET && path == "/v1/organizations/me/members" {
        let limit = integer_parameter(uri, "limit", 50, 1, 100)?;
        let offset = integer_parameter(uri, "offset", 0, 0, 100_000)?;
        return Ok(Some(json_response(
            StatusCode::OK,
            state
                .organizations
                .list_members(user_id, limit, offset)
                .await?,
        )?));
    }
    if method == Method::POST && path == "/v1/organizations/me/members" {
        mutation_limit(
            state,
            headers,
            user_id,
            "organization.member.user",
            30,
            "organization.member.ip",
            120,
        )
        .await?;
        let input = read_json(headers, body, 4_096)?;
        let email = input
            .as_object()
            .filter(|object| object.len() == 1)
            .and_then(|object| object.get("email"))
            .and_then(Value::as_str)
            .and_then(normalize_organization_email)
            .map(|(email, _)| email)
            .ok_or_else(|| {
                ApiError::coded(
                    StatusCode::BAD_REQUEST,
                    "invalid_request",
                    "A valid email is required.",
                )
            })?;
        let result = state.organizations.add_member(user_id, &email).await?;
        return Ok(Some(json_response(
            if result.newly_created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            },
            result,
        )?));
    }
    if method == Method::DELETE
        && let Some(raw) = path.strip_prefix("/v1/organizations/me/members/")
        && !raw.contains('/')
    {
        mutation_limit(
            state,
            headers,
            user_id,
            "organization.member.user",
            30,
            "organization.member.ip",
            120,
        )
        .await?;
        let membership_id = api_uuid(raw).ok_or_else(|| {
            ApiError::coded(
                StatusCode::NOT_FOUND,
                "not_found",
                "Organization member not found.",
            )
        })?;
        return Ok(Some(json_response(
            StatusCode::OK,
            state
                .organizations
                .cancel_pending(user_id, membership_id)
                .await?,
        )?));
    }
    Err(ApiError::coded(
        StatusCode::NOT_FOUND,
        "not_found",
        "Endpoint not found.",
    ))
}
