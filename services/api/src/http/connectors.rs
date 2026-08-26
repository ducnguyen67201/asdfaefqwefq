use std::time::Duration;

use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::Response,
};
use bytes::Bytes;
use serde_json::json;
use uuid::Uuid;

use crate::{
    app::AppState,
    error::{ApiError, ApiResult},
    http::{core, json_response, read_json, request_ip},
    validation::api_uuid,
};

const CALLBACK_PATH: &str = "/v1/connectors/oauth/callback";

pub async fn handle_public(
    state: &AppState,
    method: &Method,
    uri: &Uri,
) -> ApiResult<Option<Response>> {
    if uri.path() != CALLBACK_PATH {
        return Ok(None);
    }
    if method != Method::GET {
        return Ok(Some(fixed_callback_page(
            false,
            StatusCode::METHOD_NOT_ALLOWED,
        )?));
    }

    let parsed = callback_query(uri);
    let success = match (state.connectors.as_ref(), parsed) {
        (Some(service), Ok((state_token, code, provider_error))) => service
            .complete_callback(&state_token, code.as_deref(), provider_error.as_deref())
            .await
            .map(|outcome| outcome.success)
            .unwrap_or_else(|error| {
                tracing::warn!(event = "connector.oauth.callback_failed", error = %error);
                false
            }),
        (_, Err(error)) => {
            tracing::warn!(event = "connector.oauth.callback_rejected", error = %error);
            false
        }
        (None, _) => false,
    };
    Ok(Some(fixed_callback_page(success, StatusCode::OK)?))
}

pub async fn handle_authenticated(
    state: &AppState,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Option<Response>> {
    let path = uri.path();
    if path == CALLBACK_PATH || !(path == "/v1/connectors" || path.starts_with("/v1/connectors/")) {
        return Ok(None);
    }
    let current = core::session(state, headers).await?;
    core::access(state, &current).await?;
    let service = state.connectors.as_ref().ok_or_else(endpoint_not_found)?;
    let user = &current.user.id;

    if method == Method::GET && path == "/v1/connectors" {
        return Ok(Some(json_response(
            StatusCode::OK,
            service.list(user).await?,
        )?));
    }

    let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();
    if method == Method::POST
        && parts.len() == 4
        && parts[..2] == ["v1", "connectors"]
        && parts[3] == "attempts"
    {
        mutation_limit(state, headers, user).await?;
        let input = read_json(headers, body, 4_096)?;
        if !input.as_object().is_some_and(serde_json::Map::is_empty) {
            return Err(ApiError::bad_request(
                "invalid_request",
                "Connector request must be an empty JSON object.",
            ));
        }
        let started = service.begin(user, parts[2]).await?;
        return Ok(Some(json_response(
            StatusCode::CREATED,
            json!({
                "attempt": started.status,
                "authorizationUrl": started.authorization_url
            }),
        )?));
    }
    if method == Method::GET && parts.len() == 4 && parts[..3] == ["v1", "connectors", "attempts"] {
        let attempt = parse_uuid(parts[3])?;
        let value = service
            .attempt_status(user, attempt)
            .await?
            .ok_or_else(connector_not_found)?;
        return Ok(Some(json_response(StatusCode::OK, value)?));
    }
    if method == Method::DELETE
        && parts.len() == 4
        && parts[..3] == ["v1", "connectors", "connections"]
    {
        mutation_limit(state, headers, user).await?;
        let connection = parse_uuid(parts[3])?;
        if !service.disconnect(user, connection).await? {
            return Err(connector_not_found());
        }
        return Ok(Some(json_response(
            StatusCode::OK,
            json!({"disconnected": true}),
        )?));
    }

    Err(endpoint_not_found())
}

async fn mutation_limit(state: &AppState, headers: &HeaderMap, user: &str) -> ApiResult<()> {
    for (scope, key, count) in [
        ("connector.mutation.user", user, 12_i64),
        ("connector.mutation.ip", request_ip(headers), 60_i64),
    ] {
        let result = state
            .rate_limiter
            .consume(scope, key, count, Duration::from_secs(900))
            .await?;
        if !result.allowed {
            return Err(ApiError::rate_limited(
                "rate_limited",
                "Too many connector requests. Try again shortly.",
                result.retry_after_seconds,
            ));
        }
    }
    Ok(())
}

fn callback_query(uri: &Uri) -> anyhow::Result<(String, Option<String>, Option<String>)> {
    let query = uri.query().unwrap_or_default();
    anyhow::ensure!(query.len() <= 16_384, "callback query is too large");
    let mut state = None;
    let mut code = None;
    let mut error = None;
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        anyhow::ensure!(value.len() <= 8_192, "callback field is too large");
        let slot = match key.as_ref() {
            "state" => Some(&mut state),
            "code" => Some(&mut code),
            "error" => Some(&mut error),
            _ => None,
        };
        if let Some(slot) = slot {
            anyhow::ensure!(slot.is_none(), "duplicate callback field");
            *slot = Some(value.into_owned());
        }
    }
    let state = state
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("callback state missing"))?;
    anyhow::ensure!(
        code.is_some() ^ error.is_some(),
        "callback result is ambiguous"
    );
    Ok((state, code, error))
}

fn fixed_callback_page(success: bool, status: StatusCode) -> ApiResult<Response> {
    let (title, message) = if success {
        (
            "Gmail connected",
            "You can close this window and return to Tro.",
        )
    } else {
        (
            "Connection not completed",
            "Return to Tro and try connecting Gmail again.",
        )
    };
    let body = format!(
        "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><title>{title}</title><style>body{{font:16px system-ui;margin:4rem auto;max-width:34rem;padding:0 1.5rem;color:#172033}}h1{{font-size:1.6rem}}</style><main><h1>{title}</h1><p>{message}</p></main>"
    );
    let mut response = Response::builder()
        .status(status)
        .header("content-type", "text/html; charset=utf-8")
        .body(Body::from(body))
        .map_err(ApiError::internal)?;
    let headers = response.headers_mut();
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    headers.insert("content-security-policy", HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

fn parse_uuid(value: &str) -> ApiResult<Uuid> {
    api_uuid(value)
        .ok_or_else(|| ApiError::bad_request("invalid_request", "Connector identifier is invalid."))
}

const fn endpoint_not_found() -> ApiError {
    ApiError::not_found("not_found", "Endpoint not found.")
}

const fn connector_not_found() -> ApiError {
    ApiError::not_found("connector_not_found", "Connected application not found.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_parser_requires_exactly_one_terminal_result() {
        let valid: Uri = "/v1/connectors/oauth/callback?state=one&code=two"
            .parse()
            .unwrap();
        assert_eq!(
            callback_query(&valid).unwrap(),
            ("one".to_owned(), Some("two".to_owned()), None)
        );
        let duplicate: Uri = "/v1/connectors/oauth/callback?state=one&state=two&code=three"
            .parse()
            .unwrap();
        assert!(callback_query(&duplicate).is_err());
        let ambiguous: Uri = "/v1/connectors/oauth/callback?state=one&code=two&error=no"
            .parse()
            .unwrap();
        assert!(callback_query(&ambiguous).is_err());
    }
}
