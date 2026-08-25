use std::time::Instant;

use axum::{
    body::Body,
    http::{HeaderValue, Request},
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

pub async fn security_and_logs(mut request: Request<Body>, next: Next) -> Response {
    let started = Instant::now();
    let request_id = Uuid::new_v4();
    request.extensions_mut().insert(request_id);
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers
        .entry("cache-control")
        .or_insert(HeaderValue::from_static("no-store"));
    headers
        .entry("content-security-policy")
        .or_insert(HeaderValue::from_static(
            "default-src 'none'; frame-ancestors 'none'",
        ));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert(
        "x-request-id",
        HeaderValue::from_str(&request_id.to_string())
            .unwrap_or_else(|_| HeaderValue::from_static("invalid")),
    );
    let duration = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
    if response.status().is_server_error() {
        tracing::error!(durationMs=duration,event="request.failed",method=%method,path=%path,requestId=%request_id,status=response.status().as_u16());
    }
    tracing::info!(durationMs=duration,event="request.completed",method=%method,path=%path,requestId=%request_id,status=response.status().as_u16());
    response
}
