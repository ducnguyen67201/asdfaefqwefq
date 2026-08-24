use axum::{Json, http::StatusCode, response::IntoResponse};
use serde::Serialize;
use tracing::error;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: &'static str,
    pub retry_after_seconds: Option<u64>,
}

#[derive(Serialize)]
struct ErrorResponse {
    code: &'static str,
    error: &'static str,
}

impl ApiError {
    pub const fn new(status: StatusCode, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            code,
            message,
            retry_after_seconds: None,
        }
    }

    pub const fn bad_request(code: &'static str, message: &'static str) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }

    pub const fn conflict(code: &'static str, message: &'static str) -> Self {
        Self::new(StatusCode::CONFLICT, code, message)
    }

    pub const fn forbidden(code: &'static str, message: &'static str) -> Self {
        Self::new(StatusCode::FORBIDDEN, code, message)
    }

    pub const fn not_found(code: &'static str, message: &'static str) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, message)
    }

    pub const fn unauthorized(code: &'static str, message: &'static str) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, code, message)
    }

    pub const fn unavailable() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "classroom_unavailable",
            "The Rust classroom API is not enabled.",
        )
    }

    pub fn rate_limited(code: &'static str, message: &'static str, retry_after: u64) -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            code,
            message,
            retry_after_seconds: Some(retry_after),
        }
    }

    pub fn database(error_value: &crate::database::Error) -> Self {
        error!(error = %error_value, "classroom database operation failed");
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "classroom_database_error",
            "The classroom request could not be completed.",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let mut response = (
            self.status,
            Json(ErrorResponse {
                code: self.code,
                error: self.message,
            }),
        )
            .into_response();
        if let Some(seconds) = self.retry_after_seconds
            && let Ok(value) = seconds.to_string().parse()
        {
            response.headers_mut().insert("retry-after", value);
        }
        response
    }
}
