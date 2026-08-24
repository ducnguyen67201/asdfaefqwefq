use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{
        ConnectInfo, DefaultBodyLimit, FromRequestParts, Path, Query, State,
        rejection::{JsonRejection, PathRejection, QueryRejection},
    },
    http::{HeaderMap, HeaderName, HeaderValue, Request, StatusCode, header, request::Parts},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, de::DeserializeOwned};
use uuid::Uuid;

use crate::{
    classroom::{
        AuthorizedUser, ClassroomService, CreateDirectiveRequest, CreateRoomCodeRequest,
        CurrentSessionResponse, JoinRoomRequest, MutationRequest, ReviewAttemptRequest,
    },
    error::ApiError,
};

#[derive(Clone)]
pub struct AppState {
    version: Arc<str>,
    classroom: Option<Arc<ClassroomService>>,
}

#[derive(serde::Serialize)]
struct HealthResponse {
    status: &'static str,
    version: Arc<str>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SequenceQuery {
    #[serde(default)]
    since_sequence: Option<u64>,
}

struct PeerAddr(Option<IpAddr>);

pub fn app(version: impl Into<String>) -> Router {
    build_app(version.into(), None)
}

pub fn app_with_classroom(version: impl Into<String>, classroom: Arc<ClassroomService>) -> Router {
    build_app(version.into(), Some(classroom))
}

fn build_app(version: String, classroom: Option<Arc<ClassroomService>>) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/v1/live-rooms/join", post(join_room))
        .route("/v1/live-rooms/current", get(current_session))
        .route(
            "/v1/spaces/{space_id}/runs/{run_id}/room-code",
            post(create_room_code).delete(revoke_room_code),
        )
        .route(
            "/v1/spaces/{space_id}/runs/{run_id}/directives",
            post(create_directive),
        )
        .route("/v1/spaces/{space_id}/runs/{run_id}/open", post(open_run))
        .route("/v1/spaces/{space_id}/runs/{run_id}/close", post(close_run))
        .route(
            "/v1/spaces/{space_id}/runs/{run_id}/dashboard",
            get(dashboard),
        )
        .route(
            "/v1/spaces/{space_id}/runs/{run_id}/attempts/{attempt_id}/review",
            post(review_attempt),
        )
        .route(
            "/v1/spaces/{space_id}/runs/{run_id}/attempts/{attempt_id}/help/resolve",
            post(resolve_help),
        )
        .route(
            "/v1/attempts/{attempt_id}/live-session",
            get(session_for_attempt),
        )
        .route(
            "/v1/attempts/{attempt_id}/live-session/leave",
            post(leave_session),
        )
        .route("/v1/attempts/{attempt_id}/directives", get(list_directives))
        .route(
            "/v1/attempts/{attempt_id}/directives/{directive_id}/claim",
            post(claim_directive),
        )
        .route("/v1/attempts/{attempt_id}/ready", post(ready_attempt))
        .route("/v1/attempts/{attempt_id}/help", post(request_help))
        .layer(DefaultBodyLimit::max(1_000_000))
        .layer(middleware::from_fn(security_headers))
        .with_state(AppState {
            version: version.into(),
            classroom,
        })
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: state.version,
    })
}

async fn create_room_code(
    State(state): State<AppState>,
    ApiPath((space_id, run_id)): ApiPath<(Uuid, Uuid)>,
    headers: HeaderMap,
    peer: PeerAddr,
    ApiJson(input): ApiJson<CreateRoomCodeRequest>,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    let room = service
        .create_room_code(&user.id, user.group_participants, space_id, run_id, input)
        .await?;
    let status = if room.newly_created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(room)).into_response())
}

async fn revoke_room_code(
    State(state): State<AppState>,
    ApiPath((space_id, run_id)): ApiPath<(Uuid, Uuid)>,
    headers: HeaderMap,
    peer: PeerAddr,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    Ok(Json(service.revoke_room_code(&user.id, space_id, run_id).await?).into_response())
}

async fn join_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    peer: PeerAddr,
    ApiJson(mut input): ApiJson<JoinRoomRequest>,
) -> Result<Response, ApiError> {
    input.validate()?;
    let (service, user) = authorize(&state, &headers, peer, "classroom.join").await?;
    Ok(Json(
        service
            .join_room(&user.id, input.client_id, &input.code)
            .await?,
    )
    .into_response())
}

async fn current_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    peer: PeerAddr,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.read").await?;
    Ok(Json(CurrentSessionResponse {
        session: service.current_session(&user.id).await?,
    })
    .into_response())
}

async fn session_for_attempt(
    State(state): State<AppState>,
    ApiPath(attempt_id): ApiPath<Uuid>,
    headers: HeaderMap,
    peer: PeerAddr,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.read").await?;
    let session = service
        .session_for_attempt(&user.id, attempt_id)
        .await?
        .ok_or(ApiError::not_found(
            "class_session_not_found",
            "Class session not found.",
        ))?;
    Ok(Json(session).into_response())
}

async fn leave_session(
    State(state): State<AppState>,
    ApiPath(attempt_id): ApiPath<Uuid>,
    headers: HeaderMap,
    peer: PeerAddr,
    ApiJson(_input): ApiJson<MutationRequest>,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    let response =
        service
            .leave_session(&user.id, attempt_id)
            .await?
            .ok_or(ApiError::not_found(
                "class_session_not_found",
                "Class session not found.",
            ))?;
    Ok(Json(response).into_response())
}

async fn create_directive(
    State(state): State<AppState>,
    ApiPath((space_id, run_id)): ApiPath<(Uuid, Uuid)>,
    headers: HeaderMap,
    peer: PeerAddr,
    ApiJson(input): ApiJson<CreateDirectiveRequest>,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    let directive = service
        .create_directive(&user.id, space_id, run_id, input)
        .await?;
    let status = if directive.newly_created == Some(true) {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(directive)).into_response())
}

async fn list_directives(
    State(state): State<AppState>,
    ApiPath(attempt_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<SequenceQuery>,
    headers: HeaderMap,
    peer: PeerAddr,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.read").await?;
    let directives = service
        .list_directives(&user.id, attempt_id, query.since_sequence.unwrap_or(0))
        .await?
        .ok_or(ApiError::not_found(
            "class_session_not_found",
            "Class session not found.",
        ))?;
    Ok(Json(directives).into_response())
}

async fn claim_directive(
    State(state): State<AppState>,
    ApiPath((attempt_id, directive_id)): ApiPath<(Uuid, Uuid)>,
    headers: HeaderMap,
    peer: PeerAddr,
    ApiJson(input): ApiJson<MutationRequest>,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    let claim = service
        .claim_directive(&user.id, attempt_id, directive_id, input.client_id)
        .await?
        .ok_or(ApiError::not_found(
            "directive_not_found",
            "Classroom directive not found.",
        ))?;
    Ok(Json(claim).into_response())
}

async fn ready_attempt(
    State(state): State<AppState>,
    ApiPath(attempt_id): ApiPath<Uuid>,
    headers: HeaderMap,
    peer: PeerAddr,
    ApiJson(_input): ApiJson<MutationRequest>,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    let response =
        service
            .ready_attempt(&user.id, attempt_id)
            .await?
            .ok_or(ApiError::not_found(
                "attempt_not_found",
                "Attempt not found.",
            ))?;
    Ok(Json(response).into_response())
}

async fn review_attempt(
    State(state): State<AppState>,
    ApiPath((space_id, run_id, attempt_id)): ApiPath<(Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
    peer: PeerAddr,
    ApiJson(input): ApiJson<ReviewAttemptRequest>,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    let response = service
        .review_attempt(&user.id, space_id, run_id, attempt_id, input)
        .await?
        .ok_or(ApiError::not_found(
            "attempt_not_found",
            "Attempt not found.",
        ))?;
    Ok(Json(response).into_response())
}

async fn resolve_help(
    State(state): State<AppState>,
    ApiPath((space_id, run_id, attempt_id)): ApiPath<(Uuid, Uuid, Uuid)>,
    headers: HeaderMap,
    peer: PeerAddr,
    ApiJson(_input): ApiJson<MutationRequest>,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    let response = service
        .resolve_help(&user.id, space_id, run_id, attempt_id)
        .await?
        .ok_or(ApiError::not_found(
            "attempt_not_found",
            "Attempt not found.",
        ))?;
    Ok(Json(response).into_response())
}

async fn request_help(
    State(state): State<AppState>,
    ApiPath(attempt_id): ApiPath<Uuid>,
    headers: HeaderMap,
    peer: PeerAddr,
    ApiJson(input): ApiJson<MutationRequest>,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    Ok(Json(
        service
            .request_help(&user.id, attempt_id, input.client_id)
            .await?,
    )
    .into_response())
}

async fn open_run(
    State(state): State<AppState>,
    ApiPath((space_id, run_id)): ApiPath<(Uuid, Uuid)>,
    headers: HeaderMap,
    peer: PeerAddr,
) -> Result<Response, ApiError> {
    set_run_state(state, space_id, run_id, headers, peer, "open").await
}

async fn close_run(
    State(state): State<AppState>,
    ApiPath((space_id, run_id)): ApiPath<(Uuid, Uuid)>,
    headers: HeaderMap,
    peer: PeerAddr,
) -> Result<Response, ApiError> {
    set_run_state(state, space_id, run_id, headers, peer, "closed").await
}

async fn set_run_state(
    state: AppState,
    space_id: Uuid,
    run_id: Uuid,
    headers: HeaderMap,
    peer: PeerAddr,
    next_state: &'static str,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.write").await?;
    Ok(Json(
        service
            .set_run_state(&user.id, space_id, run_id, next_state)
            .await?,
    )
    .into_response())
}

async fn dashboard(
    State(state): State<AppState>,
    ApiPath((space_id, run_id)): ApiPath<(Uuid, Uuid)>,
    ApiQuery(query): ApiQuery<SequenceQuery>,
    headers: HeaderMap,
    peer: PeerAddr,
) -> Result<Response, ApiError> {
    let (service, user) = authorize(&state, &headers, peer, "knowledge.read").await?;
    Ok(Json(
        service
            .dashboard(&user.id, space_id, run_id, query.since_sequence)
            .await?,
    )
    .into_response())
}

async fn authorize(
    state: &AppState,
    headers: &HeaderMap,
    peer: PeerAddr,
    scope: &'static str,
) -> Result<(Arc<ClassroomService>, AuthorizedUser), ApiError> {
    let service = state.classroom.clone().ok_or_else(ApiError::unavailable)?;
    let user = service
        .authorize(bearer_token(headers), scope, peer.0)
        .await?;
    Ok((service, user))
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .filter(|value| !value.contains(char::is_whitespace))
}

async fn security_headers(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
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
    response
}

struct ApiJson<T>(T);

impl<S, T> axum::extract::FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Send,
    Json<T>: axum::extract::FromRequest<S, Rejection = JsonRejection>,
{
    type Rejection = ApiError;

    async fn from_request(
        request: axum::extract::Request,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        Json::<T>::from_request(request, state)
            .await
            .map(|Json(value)| Self(value))
            .map_err(|rejection| match rejection {
                JsonRejection::MissingJsonContentType(_) => ApiError::new(
                    StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    "invalid_content_type",
                    "Content-Type must be application/json.",
                ),
                JsonRejection::BytesRejection(_) => ApiError::new(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "body_too_large",
                    "Request body is too large.",
                ),
                JsonRejection::JsonSyntaxError(_) => {
                    ApiError::bad_request("invalid_json", "Request body must be valid JSON.")
                }
                _ => ApiError::bad_request("invalid_request", "Request data is invalid."),
            })
    }
}

struct ApiPath<T>(T);

impl<S, T> FromRequestParts<S> for ApiPath<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Send,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Path::<T>::from_request_parts(parts, state)
            .await
            .map(|Path(value)| Self(value))
            .map_err(|_error: PathRejection| {
                ApiError::bad_request("invalid_request", "Request path is invalid.")
            })
    }
}

struct ApiQuery<T>(T);

impl<S, T> FromRequestParts<S> for ApiQuery<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Send,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Query::<T>::from_request_parts(parts, state)
            .await
            .map(|Query(value)| Self(value))
            .map_err(|_error: QueryRejection| {
                ApiError::bad_request("invalid_request", "Request query is invalid.")
            })
    }
}

impl<S> FromRequestParts<S> for PeerAddr
where
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self(
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|value| value.0.ip()),
        ))
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use http_body_util::BodyExt;
    use serde_json::json;
    use tower::ServiceExt;

    use super::{Response, StatusCode, Uuid, app};

    async fn response_json(response: Response) -> serde_json::Value {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn health_contract_is_public_and_hardened() {
        let response = app("test-sha")
            .oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert_eq!(
            response_json(response).await,
            json!({"status":"ok","version":"test-sha"})
        );
    }

    #[tokio::test]
    async fn disabled_classroom_route_fails_closed_without_database_details() {
        let response = app("local")
            .oneshot(
                Request::get(format!("/v1/attempts/{}/live-session", Uuid::nil()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response_json(response).await,
            json!({
                "code":"classroom_unavailable",
                "error":"The Rust classroom API is not enabled."
            })
        );
    }

    #[tokio::test]
    async fn malformed_path_and_unknown_route_are_bounded() {
        let invalid = app("local")
            .oneshot(
                Request::get("/v1/attempts/not-a-uuid/live-session")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        assert_eq!(response_json(invalid).await["code"], "invalid_request");
        let missing = app("local")
            .oneshot(Request::get("/missing").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    }
}
