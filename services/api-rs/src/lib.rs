use std::{error::Error, fmt};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, HeaderName, HeaderValue, header},
    routing::get,
};
use serde::Serialize;

pub const DEFAULT_PORT: u16 = 8081;

#[derive(Clone)]
struct AppState {
    version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConfigError;

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PORT must be an integer from 1 to 65535")
    }
}

impl Error for ConfigError {}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: String,
}

pub fn parse_port(value: Option<&str>) -> Result<u16, ConfigError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(DEFAULT_PORT);
    };

    value
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or(ConfigError)
}

pub fn version_from_value(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("local")
        .to_owned()
}

pub fn app(version: impl Into<String>) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .with_state(AppState {
            version: version.into(),
        })
}

async fn health(State(state): State<AppState>) -> (HeaderMap, Json<HealthResponse>) {
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("x-frame-options"),
        HeaderValue::from_static("DENY"),
    );

    (
        headers,
        Json(HealthResponse {
            status: "ok",
            version: state.version,
        }),
    )
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use serde_json::json;
    use tower::ServiceExt;

    use super::{ConfigError, DEFAULT_PORT, app, parse_port, version_from_value};

    fn request(path: &str) -> Request<Body> {
        Request::builder()
            .uri(path)
            .body(Body::empty())
            .expect("test request must be valid")
    }

    #[test]
    fn port_defaults_when_missing_or_blank() {
        assert_eq!(parse_port(None), Ok(DEFAULT_PORT));
        assert_eq!(parse_port(Some("   ")), Ok(DEFAULT_PORT));
    }

    #[test]
    fn port_accepts_a_positive_u16() {
        assert_eq!(parse_port(Some("18081")), Ok(18081));
    }

    #[test]
    fn port_rejects_invalid_values_without_echoing_input() {
        for value in ["0", "abc", "-1", "65536"] {
            let error = parse_port(Some(value)).expect_err("invalid port must fail");
            assert_eq!(error, ConfigError);
            assert_eq!(error.to_string(), "PORT must be an integer from 1 to 65535");
            assert!(!error.to_string().contains(value));
        }
    }

    #[test]
    fn version_defaults_when_missing_or_blank() {
        assert_eq!(version_from_value(None), "local");
        assert_eq!(version_from_value(Some("   ")), "local");
        assert_eq!(version_from_value(Some(" test-sha ")), "test-sha");
    }

    #[tokio::test]
    async fn health_contract_is_public_and_hardened() {
        let response = app("test-sha")
            .oneshot(request("/healthz"))
            .await
            .expect("health request must succeed");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(
            response.headers()["content-security-policy"],
            "default-src 'none'; frame-ancestors 'none'"
        );
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(response.headers()["x-frame-options"], "DENY");
        assert_eq!(response.headers()["content-type"], "application/json");

        let bytes = response
            .into_body()
            .collect()
            .await
            .expect("health body must be readable")
            .to_bytes();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).expect("health body must be JSON"),
            json!({"status": "ok", "version": "test-sha"})
        );
    }

    #[tokio::test]
    async fn unknown_route_returns_not_found() {
        let response = app("local")
            .oneshot(request("/missing"))
            .await
            .expect("router must return a response");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn concurrent_health_requests_are_independent() {
        let router = app("test-sha");
        let (first, second, third) = tokio::join!(
            router.clone().oneshot(request("/healthz")),
            router.clone().oneshot(request("/healthz")),
            router.oneshot(request("/healthz")),
        );

        for response in [first, second, third] {
            assert_eq!(
                response.expect("health request must succeed").status(),
                StatusCode::OK
            );
        }
    }
}
