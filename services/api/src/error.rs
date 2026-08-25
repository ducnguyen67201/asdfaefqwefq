use axum::{
    Json,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
#[error("{message}")]
pub struct ApiError {
    pub status: StatusCode,
    pub code: Option<&'static str>,
    pub message: &'static str,
    pub retry_after_seconds: Option<u64>,
    #[source]
    source: Option<anyhow::Error>,
}

#[derive(Serialize)]
struct ErrorBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    error: &'static str,
}

impl ApiError {
    #[must_use]
    pub const fn new(status: StatusCode, message: &'static str) -> Self {
        Self {
            status,
            code: None,
            message,
            retry_after_seconds: None,
            source: None,
        }
    }

    #[must_use]
    pub const fn coded(status: StatusCode, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            code: Some(code),
            message,
            retry_after_seconds: None,
            source: None,
        }
    }

    #[must_use]
    pub fn internal(error: impl Into<anyhow::Error>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: None,
            message: "An internal error occurred.",
            retry_after_seconds: None,
            source: Some(error.into()),
        }
    }

    #[must_use]
    pub const fn retry_after(mut self, seconds: u64) -> Self {
        self.retry_after_seconds = Some(seconds);
        self
    }

    #[must_use]
    pub fn private_source(&self) -> Option<&anyhow::Error> {
        self.source.as_ref()
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut headers = HeaderMap::new();
        if let Some(seconds) = self.retry_after_seconds
            && let Ok(value) = HeaderValue::from_str(&seconds.to_string())
        {
            headers.insert("retry-after", value);
        }
        (
            self.status,
            headers,
            Json(ErrorBody {
                code: self.code,
                error: self.message,
            }),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(value: sqlx::Error) -> Self {
        Self::internal(value)
    }
}

impl From<reqwest::Error> for ApiError {
    fn from(value: reqwest::Error) -> Self {
        Self::internal(value)
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

#[cfg(test)]
mod tests {
    use axum::response::IntoResponse as _;

    use super::*;

    #[test]
    fn errors_preserve_public_status_and_private_source() {
        let response = ApiError::coded(StatusCode::TOO_MANY_REQUESTS, "limited", "Slow down.")
            .retry_after(12)
            .into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()["retry-after"], "12");
        let internal = ApiError::internal(anyhow::anyhow!("private detail"));
        assert_eq!(internal.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(internal.private_source().is_some());
        assert_eq!(ApiError::new(StatusCode::BAD_REQUEST, "bad").code, None);
    }
}
