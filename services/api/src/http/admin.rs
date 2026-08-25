use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::{
    body::Body,
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::Response,
};
use bytes::Bytes;
use rand::RngCore;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::Row;
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::{
        admin_session_from_cookie, clear_admin_session_cookie, digest_access_code,
        issue_admin_session, open_access_code, seal_access_code, set_admin_session_cookie,
        verify_admin_session,
    },
    error::{ApiError, ApiResult},
    http::{bearer, json_response, read_json, request_ip},
    knowledge::{ClassroomRole, classroom_role_conflicts_with_memberships},
    usage::plan_for,
    validation::{js_string_len, zod_uuid},
};

const HTML: &str = include_str!("../../public/admin.html");
const CSS: &str = include_str!("../../public/admin.css");
const JS: &str = include_str!("../../public/admin.js");
const ICON: &str = include_str!("../../public/admin-favicon.svg");

pub async fn handle(
    state: &AppState,
    method: &Method,
    uri: &Uri,
    headers: &HeaderMap,
    body: &Bytes,
) -> ApiResult<Option<Response>> {
    let Some(token) = state.config.admin.access_token.as_deref() else {
        return Ok(None);
    };
    let path = uri.path();
    if method == Method::GET && matches!(path, "/source/admin" | "/source/admin/") {
        return Ok(Some(asset(HTML, "text/html; charset=utf-8", true)?));
    }
    if method == Method::GET
        && let Some((value, content)) = match path {
            "/source/admin/assets/admin.css" => Some((CSS, "text/css; charset=utf-8")),
            "/source/admin/assets/admin.js" => Some((JS, "text/javascript; charset=utf-8")),
            "/source/admin/assets/favicon.svg" => Some((ICON, "image/svg+xml; charset=utf-8")),
            _ => None,
        }
    {
        return Ok(Some(asset(value, content, false)?));
    }
    if !path.starts_with("/v1/admin/") {
        return Ok(None);
    }
    same_origin(headers)?;
    let rate = state
        .rate_limiter
        .consume(
            "admin.api",
            request_ip(headers),
            120,
            Duration::from_secs(60),
        )
        .await?;
    if !rate.allowed {
        return Err(ApiError::coded(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many admin requests. Try again shortly.",
        )
        .retry_after(rate.retry_after_seconds));
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    if method == Method::POST && path == "/v1/admin/session" {
        if !equal(bearer(headers), token) {
            return Err(ApiError::coded(
                StatusCode::UNAUTHORIZED,
                "admin_required",
                "Admin access token is invalid.",
            ));
        }
        let session = issue_admin_session(token, now)
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("admin token is invalid")))?;
        let mut response = Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .map_err(ApiError::internal)?;
        response.headers_mut().insert(
            "set-cookie",
            HeaderValue::from_str(&set_admin_session_cookie(&session))
                .map_err(ApiError::internal)?,
        );
        return Ok(Some(response));
    }
    authorize(headers, token, now)?;
    if method == Method::DELETE && path == "/v1/admin/session" {
        let mut response = Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .map_err(ApiError::internal)?;
        response.headers_mut().insert(
            "set-cookie",
            HeaderValue::from_static(clear_admin_session_cookie()),
        );
        return Ok(Some(response));
    }
    if method == Method::GET && path == "/v1/admin/users" {
        return Ok(Some(list_users(state, uri).await?));
    }
    if method == Method::GET && path == "/v1/admin/usage" {
        return Ok(Some(list_usage(state, uri).await?));
    }
    if method == Method::GET && path == "/v1/admin/access-codes" {
        return Ok(Some(
            list_codes(state, uri, &state.config.session_token_hmac_key).await?,
        ));
    }
    if method == Method::POST && path == "/v1/admin/access-codes/bulk" {
        return Ok(Some(
            create_codes(state, body, headers, &state.config.session_token_hmac_key).await?,
        ));
    }
    let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();
    if parts.len() >= 4 && parts[0..3] == ["v1", "admin", "access-codes"] {
        let code: Uuid = parts[3].parse().map_err(|_| invalid())?;
        if parts.len() == 4 && method == Method::PATCH {
            let input = read_json(headers, body, 4_096)?;
            let paused = input
                .as_object()
                .filter(|map| map.len() == 1)
                .and_then(|map| map.get("paused"))
                .and_then(Value::as_bool)
                .ok_or_else(invalid)?;
            let mut tx = state.pool.begin().await?;
            let row=sqlx::query("UPDATE access_codes SET paused_at=CASE WHEN $2 THEN COALESCE(paused_at,NOW())ELSE NULL END WHERE id=$1 RETURNING id,paused_at,max_users").bind(code).bind(paused).fetch_optional(&mut *tx).await?.ok_or_else(||ApiError::coded(StatusCode::NOT_FOUND,"code_not_found","Access code not found."))?;
            let redemption_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint FROM access_code_redemptions WHERE access_code_id=$1",
            )
            .bind(code)
            .fetch_one(&mut *tx)
            .await?;
            sqlx::query("INSERT INTO admin_audit_events(action,detail)VALUES($1,$2)")
                .bind(if paused {
                    "access_codes.paused"
                } else {
                    "access_codes.resumed"
                })
                .bind(json!({"accessCodeId":code}))
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Ok(Some(json_response(
                StatusCode::OK,
                json!({"id":code,"pausedAt":row.get::<Option<time::OffsetDateTime>,_>("paused_at").map(format_time),"status":if paused{"paused"}else if redemption_count>=i64::from(row.get::<i32,_>("max_users")){"full"}else{"available"}}),
            )?));
        }
        if parts.len() == 4 && method == Method::DELETE {
            let mut tx = state.pool.begin().await?;
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM access_codes WHERE id=$1 FOR UPDATE)",
            )
            .bind(code)
            .fetch_one(&mut *tx)
            .await?;
            if !exists {
                return Err(ApiError::coded(
                    StatusCode::NOT_FOUND,
                    "code_not_found",
                    "Access code not found.",
                ));
            }
            let redemption_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint FROM access_code_redemptions WHERE access_code_id=$1",
            )
            .bind(code)
            .fetch_one(&mut *tx)
            .await?;
            if redemption_count > 0 {
                return Err(ApiError::coded(
                    StatusCode::CONFLICT,
                    "code_in_use",
                    "Access codes with redemptions cannot be deleted.",
                ));
            }
            sqlx::query("DELETE FROM access_codes WHERE id=$1")
                .bind(code)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "INSERT INTO admin_audit_events(action,detail)VALUES('access_codes.deleted',$1)",
            )
            .bind(json!({"accessCodeId":code}))
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            return Ok(Some(json_response(
                StatusCode::OK,
                json!({"id":code,"kind":"deleted"}),
            )?));
        }
        if parts.len() == 5 && parts[4] == "users" && method == Method::GET {
            return Ok(Some(list_code_users(state, code, uri).await?));
        }
    }
    if parts.len() == 5 && parts[0..3] == ["v1", "admin", "users"] {
        let user = decode_segment(parts[3])?;
        if parts[4] == "access" && method == Method::PATCH {
            let input = read_json(headers, body, 4_096)?;
            let blocked = input
                .as_object()
                .filter(|map| map.len() == 1)
                .and_then(|map| map.get("blocked"))
                .and_then(Value::as_bool)
                .ok_or_else(invalid)?;
            let mut tx = state.pool.begin().await?;
            let row=sqlx::query("UPDATE users SET blocked_at=CASE WHEN $2 THEN COALESCE(blocked_at,NOW())ELSE NULL END,updated_at=NOW()WHERE id=$1 RETURNING id,blocked_at").bind(&user).bind(blocked).fetch_optional(&mut*tx).await?.ok_or_else(||ApiError::coded(StatusCode::NOT_FOUND,"user_not_found","User not found."))?;
            if blocked {
                sqlx::query("UPDATE device_sessions SET revoked_at=NOW()WHERE user_id=$1 AND revoked_at IS NULL").bind(&user).execute(&mut*tx).await?;
            }
            sqlx::query("INSERT INTO admin_audit_events(action,target_user_id)VALUES($1,$2)")
                .bind(if blocked {
                    "user.blocked"
                } else {
                    "user.unblocked"
                })
                .bind(&user)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            let at = row.get::<Option<time::OffsetDateTime>, _>("blocked_at");
            return Ok(Some(json_response(
                StatusCode::OK,
                json!({"id":user,"blockedAt":at.map(format_time),"status":if at.is_some(){"blocked"}else{"active"}}),
            )?));
        }
        if parts[4] == "classroom-role" && method == Method::PATCH {
            let input = read_json(headers, body, 4_096)?;
            let role = input
                .as_object()
                .filter(|map| map.len() == 1)
                .and_then(|map| map.get("role"))
                .and_then(Value::as_str)
                .filter(|value| matches!(*value, "unassigned" | "teacher" | "student"))
                .ok_or_else(invalid)?;
            return Ok(Some(set_classroom_role(state, &user, role).await?));
        }
        if parts[4] == "access-code" && method == Method::POST {
            let input = read_json(headers, body, 4_096)?;
            let code = input
                .as_object()
                .filter(|map| map.len() == 1)
                .and_then(|map| map.get("accessCodeId"))
                .and_then(Value::as_str)
                .and_then(zod_uuid)
                .ok_or_else(invalid)?;
            return Ok(Some(grant_code(state, &user, code).await?));
        }
    }
    Err(ApiError::coded(
        StatusCode::NOT_FOUND,
        "not_found",
        "Admin endpoint not found.",
    ))
}
fn asset(value: &str, content: &str, page: bool) -> ApiResult<Response> {
    let mut response = Response::builder()
        .status(StatusCode::OK)
        .header("content-type", content)
        .header("content-length", value.len().to_string())
        .body(Body::from(value.as_bytes().to_vec()))
        .map_err(ApiError::internal)?;
    response.headers_mut().insert("content-security-policy",HeaderValue::from_static(if page{"default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'"}else{"default-src 'none'; frame-ancestors 'none'"}));
    Ok(response)
}
fn same_origin(headers: &HeaderMap) -> ApiResult<()> {
    let Some(origin) = headers.get("origin") else {
        return Ok(());
    };
    let origin = origin.to_str().map_err(|_| {
        ApiError::coded(
            StatusCode::FORBIDDEN,
            "origin_denied",
            "Browser origin is not allowed.",
        )
    })?;
    let parsed = url::Url::parse(origin).map_err(|_| {
        ApiError::coded(
            StatusCode::FORBIDDEN,
            "origin_denied",
            "Browser origin is not allowed.",
        )
    })?;
    let host = headers
        .get("host")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed
            .host_str()
            .map(|value| {
                format!(
                    "{value}{}",
                    parsed
                        .port()
                        .map(|port| format!(":{port}"))
                        .unwrap_or_default()
                )
            })
            .as_deref()
            != Some(host)
    {
        return Err(ApiError::coded(
            StatusCode::FORBIDDEN,
            "origin_denied",
            "Browser origin is not allowed.",
        ));
    }
    Ok(())
}
fn equal(actual: Option<&str>, expected: &str) -> bool {
    let Some(actual) = actual else { return false };
    let left = Sha256::digest(actual.as_bytes());
    let right = Sha256::digest(expected.as_bytes());
    left.as_slice().ct_eq(right.as_slice()).into()
}
fn authorize(headers: &HeaderMap, token: &str, now: i64) -> ApiResult<()> {
    if equal(bearer(headers), token) {
        return Ok(());
    }
    let cookie = headers
        .get("cookie")
        .and_then(|value| value.to_str().ok())
        .and_then(admin_session_from_cookie);
    if cookie.is_some_and(|value| verify_admin_session(value, token, now)) {
        Ok(())
    } else {
        Err(ApiError::coded(
            StatusCode::UNAUTHORIZED,
            "admin_required",
            "Admin access token is invalid.",
        ))
    }
}
fn invalid() -> ApiError {
    ApiError::coded(
        StatusCode::BAD_REQUEST,
        "invalid_request",
        "Request values are invalid.",
    )
}
fn params(uri: &Uri) -> std::collections::BTreeMap<String, String> {
    url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
        .into_owned()
        .collect()
}
fn page(uri: &Uri) -> ApiResult<(i64, i64, String)> {
    let values = params(uri);
    let limit = values
        .get("limit")
        .map(|value| value.parse::<i64>())
        .transpose()
        .map_err(|_| invalid())?
        .unwrap_or(50);
    let offset = values
        .get("offset")
        .map(|value| value.parse::<i64>())
        .transpose()
        .map_err(|_| invalid())?
        .unwrap_or(0);
    let search = values
        .get("search")
        .map_or_else(String::new, |value| value.trim().to_owned());
    if !(1..=100).contains(&limit)
        || !(0..=100_000).contains(&offset)
        || js_string_len(&search) > 200
    {
        return Err(invalid());
    }
    Ok((limit, offset, search))
}
async fn list_users(state: &AppState, uri: &Uri) -> ApiResult<Response> {
    let (limit, offset, search) = page(uri)?;
    let values = params(uri);
    let status = values.get("status").map(String::as_str).unwrap_or("all");
    let classroom = values
        .get("classroomRole")
        .map(String::as_str)
        .unwrap_or("all");
    if !matches!(status, "all" | "active" | "blocked") {
        return Err(invalid());
    }
    if !matches!(classroom, "all" | "unassigned" | "teacher" | "student") {
        return Err(invalid());
    }
    let pattern = if search.is_empty() {
        String::new()
    } else {
        format!("%{search}%")
    };
    let summary = sqlx::query(
        "SELECT COUNT(*)::int total_users,
                COUNT(*)FILTER(WHERE blocked_at IS NULL)::int active_users,
                COUNT(*)FILTER(WHERE blocked_at IS NOT NULL)::int blocked_users,
                COUNT(*)FILTER(WHERE($1=''OR email ILIKE $1 OR name ILIKE $1)
                    AND($2='all'OR($2='active'AND blocked_at IS NULL)OR($2='blocked'AND blocked_at IS NOT NULL))
                    AND($3='all'OR classroom_role=$3))::int filtered_users
         FROM users",
    )
    .bind(&pattern)
    .bind(status)
    .bind(classroom)
    .fetch_one(&state.pool)
    .await?;
    let rows=sqlx::query("SELECT users.id,users.email,users.name,users.plan,users.classroom_role,users.blocked_at,users.created_at,
                                redemptions.access_code_id,codes.label code_label,latest_session.last_seen_at,
                                COUNT(*)OVER()::int filtered_total
                         FROM users
                         LEFT JOIN access_code_redemptions redemptions ON redemptions.user_id=users.id
                         LEFT JOIN access_codes codes ON codes.id=redemptions.access_code_id
                         LEFT JOIN LATERAL(SELECT MAX(last_used_at)last_seen_at FROM device_sessions WHERE user_id=users.id)latest_session ON TRUE
                         WHERE($1=''OR users.email ILIKE $1 OR users.name ILIKE $1)
                           AND($2='all'OR($2='active'AND users.blocked_at IS NULL)OR($2='blocked'AND users.blocked_at IS NOT NULL))
                           AND($3='all'OR users.classroom_role=$3)
                         ORDER BY users.created_at DESC,users.id LIMIT $4 OFFSET $5").bind(&pattern).bind(status).bind(classroom).bind(limit).bind(offset).fetch_all(&state.pool).await?;
    let total = rows.first().map_or_else(
        || summary.get::<i32, _>("filtered_users"),
        |row| row.get::<i32, _>("filtered_total"),
    );
    json_response(
        StatusCode::OK,
        json!({"items":rows.into_iter().map(|row|{let blocked=row.get::<Option<time::OffsetDateTime>,_>("blocked_at");json!({"accessCodeId":row.get::<Option<Uuid>,_>("access_code_id"),"blockedAt":blocked.map(format_time),"classroomRole":row.get::<String,_>("classroom_role"),"codeLabel":row.get::<Option<String>,_>("code_label"),"createdAt":format_time(row.get("created_at")),"email":row.get::<String,_>("email"),"id":row.get::<String,_>("id"),"lastSeenAt":row.get::<Option<time::OffsetDateTime>,_>("last_seen_at").map(format_time),"name":row.get::<String,_>("name"),"plan":row.get::<String,_>("plan"),"status":if blocked.is_some(){"blocked"}else{"active"}})}).collect::<Vec<_>>(),"page":{"limit":limit,"offset":offset,"total":total},"summary":{"activeUsers":summary.get::<i32,_>("active_users"),"blockedUsers":summary.get::<i32,_>("blocked_users"),"totalUsers":summary.get::<i32,_>("total_users")}}),
    )
}
async fn set_classroom_role(state: &AppState, user: &str, classroom: &str) -> ApiResult<Response> {
    let mut tx = state.pool.begin().await?;
    let row = sqlx::query("SELECT id,classroom_role FROM users WHERE id=$1 FOR UPDATE")
        .bind(user)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            ApiError::coded(StatusCode::NOT_FOUND, "user_not_found", "User not found.")
        })?;
    let roles = sqlx::query(
        "SELECT role FROM knowledge_space_members WHERE user_id=$1 AND removed_at IS NULL",
    )
    .bind(user)
    .fetch_all(&mut *tx)
    .await?;
    let classroom = ClassroomRole::parse(classroom).ok_or_else(invalid)?;
    let membership_roles = roles
        .iter()
        .map(|row| row.get::<String, _>("role"))
        .collect::<Vec<_>>();
    let incompatible = classroom_role_conflicts_with_memberships(
        classroom,
        membership_roles.iter().map(String::as_str),
    );
    if incompatible {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "classroom_role_in_use",
            "Remove incompatible class memberships before changing this role.",
        ));
    }
    let updated = sqlx::query(
        "UPDATE users SET classroom_role=$2,updated_at=NOW() WHERE id=$1 RETURNING id,classroom_role",
    )
    .bind(user)
    .bind(classroom.as_str())
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO admin_audit_events(action,target_user_id,detail)VALUES('user.classroom_role_updated',$1,$2)")
        .bind(user)
        .bind(json!({"from":row.get::<String,_>("classroom_role"),"to":classroom.as_str()}))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    json_response(
        StatusCode::OK,
        json!({"classroomRole":updated.get::<String,_>("classroom_role"),"id":updated.get::<String,_>("id"),"kind":"updated"}),
    )
}
async fn list_usage(state: &AppState, uri: &Uri) -> ApiResult<Response> {
    let (limit, offset, search) = page(uri)?;
    let values = params(uri);
    let lane = values.get("lane").map(String::as_str).unwrap_or("all");
    let range = values.get("range").map(String::as_str).unwrap_or("7d");
    if !matches!(
        lane,
        "all" | "responses" | "realtime_transcription" | "speech" | "transcription"
    ) || !matches!(range, "24h" | "7d" | "30d" | "all")
    {
        return Err(invalid());
    }
    let pattern = if search.is_empty() {
        String::new()
    } else {
        format!("%{search}%")
    };
    let summary=sqlx::query("SELECT COUNT(*)::int total_requests,COUNT(DISTINCT events.user_id)::int active_users,COALESCE(SUM(events.amount_micro_usd),0)::bigint total_spend_micro_usd,COALESCE(SUM(events.input_tokens+events.output_tokens),0)::bigint total_tokens FROM model_usage_events events JOIN users ON users.id=events.user_id LEFT JOIN knowledge_activity_work_sessions work_sessions ON work_sessions.task_id=events.task_id LEFT JOIN knowledge_activity_attempts attempts ON attempts.id=work_sessions.attempt_id AND attempts.user_id=events.user_id LEFT JOIN knowledge_activity_runs activity_runs ON activity_runs.id=attempts.run_id LEFT JOIN knowledge_activity_versions activity_versions ON activity_versions.id=activity_runs.activity_version_id WHERE(($3='24h'AND events.created_at>=date_trunc('hour',NOW())-INTERVAL'23 hours')OR($3='7d'AND events.created_at>=date_trunc('day',NOW())-INTERVAL'6 days')OR($3='30d'AND events.created_at>=date_trunc('day',NOW())-INTERVAL'29 days')OR $3='all')AND($1='all'OR events.lane=$1)AND($2=''OR users.email ILIKE $2 OR users.name ILIKE $2 OR events.model ILIKE $2 OR events.task_id::text ILIKE $2 OR COALESCE(activity_versions.definition->>'title','')ILIKE $2)").bind(lane).bind(&pattern).bind(range).fetch_one(&state.pool).await?;
    let series=sqlx::query("WITH filtered_usage AS(SELECT events.created_at,events.amount_micro_usd,events.input_tokens,events.output_tokens FROM model_usage_events events JOIN users ON users.id=events.user_id LEFT JOIN knowledge_activity_work_sessions work_sessions ON work_sessions.task_id=events.task_id LEFT JOIN knowledge_activity_attempts attempts ON attempts.id=work_sessions.attempt_id AND attempts.user_id=events.user_id LEFT JOIN knowledge_activity_runs activity_runs ON activity_runs.id=attempts.run_id LEFT JOIN knowledge_activity_versions activity_versions ON activity_versions.id=activity_runs.activity_version_id WHERE(($3='24h'AND events.created_at>=date_trunc('hour',NOW())-INTERVAL'23 hours')OR($3='7d'AND events.created_at>=date_trunc('day',NOW())-INTERVAL'6 days')OR($3='30d'AND events.created_at>=date_trunc('day',NOW())-INTERVAL'29 days')OR $3='all')AND($1='all'OR events.lane=$1)AND($2=''OR users.email ILIKE $2 OR users.name ILIKE $2 OR events.model ILIKE $2 OR events.task_id::text ILIKE $2 OR COALESCE(activity_versions.definition->>'title','')ILIKE $2)),bounds AS(SELECT CASE WHEN $3='24h'THEN date_trunc('hour',NOW())-INTERVAL'23 hours'WHEN $3='7d'THEN date_trunc('day',NOW())-INTERVAL'6 days'WHEN $3='30d'THEN date_trunc('day',NOW())-INTERVAL'29 days'ELSE COALESCE(date_trunc('month',MIN(created_at)),date_trunc('month',NOW()))END first_bucket,CASE WHEN $3='24h'THEN date_trunc('hour',NOW())WHEN $3='all'THEN date_trunc('month',NOW())ELSE date_trunc('day',NOW())END last_bucket FROM filtered_usage),buckets AS(SELECT generate_series(first_bucket,last_bucket,CASE WHEN $3='24h'THEN INTERVAL'1 hour'WHEN $3='all'THEN INTERVAL'1 month'ELSE INTERVAL'1 day'END)bucket_start FROM bounds),aggregated AS(SELECT CASE WHEN $3='24h'THEN date_trunc('hour',created_at)WHEN $3='all'THEN date_trunc('month',created_at)ELSE date_trunc('day',created_at)END bucket_start,COUNT(*)::int request_count,COALESCE(SUM(amount_micro_usd),0)::bigint spend_micro_usd,COALESCE(SUM(input_tokens+output_tokens),0)::bigint total_tokens FROM filtered_usage GROUP BY 1)SELECT buckets.bucket_start,COALESCE(aggregated.request_count,0)::int request_count,COALESCE(aggregated.spend_micro_usd,0)::bigint spend_micro_usd,COALESCE(aggregated.total_tokens,0)::bigint total_tokens FROM buckets LEFT JOIN aggregated USING(bucket_start)ORDER BY bucket_start").bind(lane).bind(&pattern).bind(range).fetch_all(&state.pool).await?;
    let rows=sqlx::query("SELECT events.*,users.email,users.name,users.plan,NULLIF(activity_versions.definition->>'title','')activity_title,COUNT(*)OVER()::int filtered_total FROM model_usage_events events JOIN users ON users.id=events.user_id LEFT JOIN knowledge_activity_work_sessions work_sessions ON work_sessions.task_id=events.task_id LEFT JOIN knowledge_activity_attempts attempts ON attempts.id=work_sessions.attempt_id AND attempts.user_id=events.user_id LEFT JOIN knowledge_activity_runs activity_runs ON activity_runs.id=attempts.run_id LEFT JOIN knowledge_activity_versions activity_versions ON activity_versions.id=activity_runs.activity_version_id WHERE(($3='24h'AND events.created_at>=date_trunc('hour',NOW())-INTERVAL'23 hours')OR($3='7d'AND events.created_at>=date_trunc('day',NOW())-INTERVAL'6 days')OR($3='30d'AND events.created_at>=date_trunc('day',NOW())-INTERVAL'29 days')OR $3='all')AND($1='all'OR events.lane=$1)AND($2=''OR users.email ILIKE $2 OR users.name ILIKE $2 OR events.model ILIKE $2 OR events.task_id::text ILIKE $2 OR COALESCE(activity_versions.definition->>'title','')ILIKE $2)ORDER BY events.created_at DESC,events.id DESC LIMIT $4 OFFSET $5").bind(lane).bind(&pattern).bind(range).bind(limit).bind(offset).fetch_all(&state.pool).await?;
    let total = rows
        .first()
        .map_or(0, |row| row.get::<i32, _>("filtered_total"));
    let items=rows.into_iter().map(|row|json!({"activityTitle":row.get::<Option<String>,_>("activity_title"),"amountMicroUsd":row.get::<i64,_>("amount_micro_usd"),"audioDurationMs":row.get::<i64,_>("audio_duration_ms"),"cacheWriteTokens":row.get::<i64,_>("cache_write_tokens"),"cachedInputTokens":row.get::<i64,_>("cached_input_tokens"),"characterCount":row.get::<i64,_>("character_count"),"createdAt":format_time(row.get("created_at")),"durationMs":row.get::<i64,_>("duration_ms"),"id":row.get::<Uuid,_>("id"),"inputTokens":row.get::<i64,_>("input_tokens"),"lane":row.get::<String,_>("lane"),"model":row.get::<String,_>("model"),"outputTokens":row.get::<i64,_>("output_tokens"),"reasoningTokens":row.get::<i64,_>("reasoning_tokens"),"taskId":row.get::<Uuid,_>("task_id"),"usageSource":row.get::<String,_>("usage_source"),"user":{"id":row.get::<String,_>("user_id"),"email":row.get::<String,_>("email"),"name":row.get::<String,_>("name"),"plan":row.get::<String,_>("plan")}})).collect::<Vec<_>>();
    let series_items=series.into_iter().map(|row|json!({"requests":row.get::<i32,_>("request_count"),"spendMicroUsd":row.get::<i64,_>("spend_micro_usd"),"startedAt":format_time(row.get("bucket_start")),"tokens":row.get::<i64,_>("total_tokens")})).collect::<Vec<_>>();
    json_response(
        StatusCode::OK,
        json!({"items":items,"page":{"limit":limit,"offset":offset,"total":total},"series":{"granularity":if range=="24h"{"hour"}else if range=="all"{"month"}else{"day"},"items":series_items},"summary":{"activeUsers":summary.get::<i32,_>("active_users"),"totalRequests":summary.get::<i32,_>("total_requests"),"totalSpendMicroUsd":summary.get::<i64,_>("total_spend_micro_usd"),"totalTokens":summary.get::<i64,_>("total_tokens")}}),
    )
}
async fn list_codes(state: &AppState, uri: &Uri, key: &str) -> ApiResult<Response> {
    let (limit, offset, search) = page(uri)?;
    let values = params(uri);
    let status = values.get("status").map(String::as_str).unwrap_or("all");
    if !matches!(status, "all" | "available" | "full" | "paused") {
        return Err(invalid());
    }
    let digest = if search.is_empty() {
        None
    } else {
        digest_access_code(&search, key)?
    };
    let summary=sqlx::query("WITH usage AS(SELECT codes.id,codes.max_users,codes.code_ciphertext,codes.paused_at,COUNT(redemptions.user_id)::int redeemed_users FROM access_codes codes LEFT JOIN access_code_redemptions redemptions ON redemptions.access_code_id=codes.id GROUP BY codes.id)SELECT COUNT(*)::int total_codes,COUNT(*)FILTER(WHERE paused_at IS NULL AND redeemed_users<max_users)::int available_codes,COUNT(*)FILTER(WHERE paused_at IS NULL AND redeemed_users>=max_users)::int full_codes,COUNT(*)FILTER(WHERE paused_at IS NOT NULL)::int paused_codes,COUNT(*)FILTER(WHERE code_ciphertext IS NOT NULL)::int retrievable_codes,COALESCE(SUM(redeemed_users),0)::int total_redemptions FROM usage").fetch_one(&state.pool).await?;
    let pattern = if search.is_empty() {
        String::new()
    } else {
        format!("%{search}%")
    };
    let rows=sqlx::query("WITH usage AS(SELECT codes.*,COUNT(redemptions.user_id)::int redeemed_users FROM access_codes codes LEFT JOIN access_code_redemptions redemptions ON redemptions.access_code_id=codes.id GROUP BY codes.id)SELECT *,COUNT(*)OVER()::int filtered_total FROM usage WHERE($1='all'OR($1='available'AND paused_at IS NULL AND redeemed_users<max_users)OR($1='full'AND paused_at IS NULL AND redeemed_users>=max_users)OR($1='paused'AND paused_at IS NOT NULL))AND($2=''OR COALESCE(label,'')ILIKE $2 OR code_digest=$3)ORDER BY created_at DESC,id LIMIT $4 OFFSET $5").bind(status).bind(&pattern).bind(digest.map(|value|value.to_vec())).bind(limit).bind(offset).fetch_all(&state.pool).await?;
    let total = rows
        .first()
        .map_or(0, |row| row.get::<i32, _>("filtered_total"));
    let mut items = Vec::new();
    for row in rows {
        let digest: Vec<u8> = row.get("code_digest");
        let code = row
            .get::<Option<Vec<u8>>, _>("code_ciphertext")
            .and_then(|sealed| {
                digest
                    .as_slice()
                    .try_into()
                    .ok()
                    .and_then(|digest: &[u8; 32]| open_access_code(&sealed, key, digest).ok())
            });
        let redemption_count = row.get::<i32, _>("redeemed_users");
        let max = row.get::<i32, _>("max_users");
        let paused = row.get::<Option<time::OffsetDateTime>, _>("paused_at");
        items.push(json!({"code":code,"createdAt":format_time(row.get("created_at")),"id":row.get::<Uuid,_>("id"),"label":row.get::<Option<String>,_>("label"),"maxUsers":max,"pausedAt":paused.map(format_time),"plan":row.get::<String,_>("plan"),"redeemedUsers":redemption_count,"remainingUsers":(max-redemption_count).max(0),"retrievable":code.is_some(),"status":if paused.is_some(){"paused"}else if redemption_count>=max{"full"}else{"available"}}));
    }
    json_response(
        StatusCode::OK,
        json!({"items":items,"page":{"limit":limit,"offset":offset,"total":total},"summary":{"availableCodes":summary.get::<i32,_>("available_codes"),"fullCodes":summary.get::<i32,_>("full_codes"),"pausedCodes":summary.get::<i32,_>("paused_codes"),"retrievableCodes":summary.get::<i32,_>("retrievable_codes"),"totalCodes":summary.get::<i32,_>("total_codes"),"totalRedemptions":summary.get::<i32,_>("total_redemptions")}}),
    )
}
async fn create_codes(
    state: &AppState,
    body: &Bytes,
    headers: &HeaderMap,
    key: &str,
) -> ApiResult<Response> {
    let input = read_json(headers, body, 8_192)?;
    let count = input
        .get("count")
        .and_then(Value::as_i64)
        .filter(|value| (1..=100).contains(value))
        .ok_or_else(invalid)?;
    let max = input
        .get("maxUsers")
        .and_then(Value::as_i64)
        .filter(|value| (1..=10_000).contains(value))
        .ok_or_else(invalid)?;
    let plan = input
        .get("plan")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    plan_for(plan).map_err(|_| invalid())?;
    let label = input
        .get("label")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if input.as_object().is_none_or(|object| {
        object
            .keys()
            .any(|key| !matches!(key.as_str(), "count" | "label" | "maxUsers" | "plan"))
    }) || input
        .get("label")
        .is_some_and(|value| !value.is_null() && !value.is_string())
        || label.is_some_and(|value| js_string_len(value) > 80)
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    let mut items = Vec::new();
    for index in 0..count {
        let mut random = [0u8; 12];
        rand::rng().fill_bytes(&mut random);
        let code = format!(
            "TRO-{}",
            random
                .iter()
                .map(|value| format!("{value:02X}"))
                .collect::<String>()
        );
        let digest = digest_access_code(&code, key)?.ok_or_else(invalid)?;
        let sealed = seal_access_code(&code, key, &digest)?;
        let item_label = label.map(|value| {
            if count == 1 {
                value.to_owned()
            } else {
                format!("{value} {}/{count}", index + 1)
            }
        });
        let row=sqlx::query("INSERT INTO access_codes(code_digest,code_ciphertext,label,max_users,plan)VALUES($1,$2,$3,$4,$5)RETURNING id,created_at").bind(digest.to_vec()).bind(sealed).bind(item_label.as_deref()).bind(i32::try_from(max).unwrap_or(10_000)).bind(plan).fetch_one(&mut*tx).await?;
        items.push(json!({"code":code,"createdAt":format_time(row.get("created_at")),"id":row.get::<Uuid,_>("id"),"label":item_label,"maxUsers":max,"plan":plan}));
    }
    sqlx::query("INSERT INTO admin_audit_events(action,detail)VALUES('access_codes.created',$1)")
        .bind(json!({"count":count,"maxUsers":max,"plan":plan}))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    json_response(StatusCode::CREATED, json!({"items":items}))
}
async fn list_code_users(state: &AppState, code: Uuid, uri: &Uri) -> ApiResult<Response> {
    let (limit, offset, _) = page(uri)?;
    let meta = sqlx::query("SELECT id,label,max_users,plan FROM access_codes WHERE id=$1")
        .bind(code)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| {
            ApiError::coded(
                StatusCode::NOT_FOUND,
                "code_not_found",
                "Access code not found.",
            )
        })?;
    let rows=sqlx::query("SELECT users.id,users.email,users.name,users.blocked_at,redemptions.redeemed_at FROM access_code_redemptions redemptions JOIN users ON users.id=redemptions.user_id WHERE redemptions.access_code_id=$1 ORDER BY redemptions.redeemed_at DESC LIMIT $2 OFFSET $3").bind(code).bind(limit).bind(offset).fetch_all(&state.pool).await?;
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM access_code_redemptions WHERE access_code_id=$1",
    )
    .bind(code)
    .fetch_one(&state.pool)
    .await?;
    json_response(
        StatusCode::OK,
        json!({"code":{"id":code,"label":meta.get::<Option<String>,_>("label"),"maxUsers":meta.get::<i32,_>("max_users"),"plan":meta.get::<String,_>("plan"),"redeemedUsers":total},"items":rows.into_iter().map(|row|json!({"id":row.get::<String,_>("id"),"email":row.get::<String,_>("email"),"name":row.get::<String,_>("name"),"redeemedAt":format_time(row.get("redeemed_at")),"status":if row.get::<Option<time::OffsetDateTime>,_>("blocked_at").is_some(){"blocked"}else{"active"}})).collect::<Vec<_>>(),"page":{"limit":limit,"offset":offset,"total":total}}),
    )
}
async fn grant_code(state: &AppState, user: &str, code: Uuid) -> ApiResult<Response> {
    let mut tx = state.pool.begin().await?;
    let row = sqlx::query("SELECT blocked_at FROM users WHERE id=$1 FOR UPDATE")
        .bind(user)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| {
            ApiError::coded(StatusCode::NOT_FOUND, "user_not_found", "User not found.")
        })?;
    if row
        .get::<Option<time::OffsetDateTime>, _>("blocked_at")
        .is_some()
    {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "account_blocked",
            "Unblock this account before granting an access code.",
        ));
    }
    let linked: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM access_code_redemptions WHERE user_id=$1)")
            .bind(user)
            .fetch_one(&mut *tx)
            .await?;
    if linked {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "account_already_linked",
            "This account is already linked to an access code.",
        ));
    }
    let code_row = sqlx::query(
        "SELECT label,max_users,paused_at,plan FROM access_codes WHERE id=$1 FOR UPDATE",
    )
    .bind(code)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        ApiError::coded(
            StatusCode::NOT_FOUND,
            "code_not_found",
            "Access code not found.",
        )
    })?;
    if code_row
        .get::<Option<time::OffsetDateTime>, _>("paused_at")
        .is_some()
    {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "code_paused",
            "This access code is temporarily paused.",
        ));
    }
    let redemption_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM access_code_redemptions WHERE access_code_id=$1",
    )
    .bind(code)
    .fetch_one(&mut *tx)
    .await?;
    let max = i64::from(code_row.get::<i32, _>("max_users"));
    if redemption_count >= max {
        return Err(ApiError::coded(
            StatusCode::CONFLICT,
            "code_full",
            "This access code has reached its user limit.",
        ));
    }
    let plan: String = code_row.get("plan");
    sqlx::query("INSERT INTO access_code_redemptions(user_id,access_code_id)VALUES($1,$2)")
        .bind(user)
        .bind(code)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE users SET plan=$2,updated_at=NOW()WHERE id=$1")
        .bind(user)
        .bind(&plan)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO admin_audit_events(action,target_user_id,detail)VALUES('user.access_code_granted',$1,$2)")
        .bind(user)
        .bind(json!({"accessCodeId":code}))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    json_response(
        StatusCode::CREATED,
        json!({"kind":"granted","userId":user,"accessCodeId":code,"codeLabel":code_row.get::<Option<String>,_>("label"),"plan":plan,"remainingUsers":max-redemption_count-1}),
    )
}
fn decode_segment(value: &str) -> ApiResult<String> {
    let parsed = url::form_urlencoded::parse(format!("value={value}").as_bytes())
        .find(|(key, _)| key == "value")
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default();
    let value = parsed.trim().to_owned();
    if value.is_empty() || js_string_len(&value) > 255 {
        Err(invalid())
    } else {
        Ok(value)
    }
}
fn format_time(value: time::OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
