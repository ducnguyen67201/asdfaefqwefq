pub mod catalog;
mod content_guard;
mod mcp;
mod oauth;
pub(crate) mod schema;

use std::time::Duration;

use anyhow::Context;
use hmac::{Hmac, Mac};
use serde::Serialize;
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::{PgPool, Row};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    auth::{AgentEnvelope, ConnectorTokenCrypto},
    config::ConnectorConfig,
    error::{ApiError, ApiResult},
};

use self::{catalog::ConnectorDefinition, mcp::McpClientFactory};

#[derive(Clone)]
pub struct ConnectorService {
    client: reqwest::Client,
    config: ConnectorConfig,
    crypto: ConnectorTokenCrypto,
    hmac_key: Vec<u8>,
    mcp: McpClientFactory,
    pool: PgPool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorConnectionSummary {
    pub catalog_key: String,
    pub connected_at: Option<String>,
    pub id: Uuid,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorList {
    pub catalog: Vec<catalog::PublicConnectorDefinition>,
    pub connections: Vec<ConnectorConnectionSummary>,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorAttemptStatus {
    pub attempt_id: Uuid,
    pub catalog_key: String,
    pub expires_at: String,
    pub status: String,
}

#[derive(Clone, Debug)]
pub struct BeginConnectorConnection {
    pub authorization_url: String,
    pub status: ConnectorAttemptStatus,
}

#[derive(Clone, Debug)]
pub struct ConnectorRoute {
    pub catalog_key: String,
    pub connection_id: Uuid,
    pub description: String,
    pub input_schema: Value,
    pub namespace: String,
    pub snapshot_id: Uuid,
    pub tool_name: String,
}

#[derive(Clone, Debug)]
pub struct CallbackOutcome {
    pub success: bool,
}

impl ConnectorService {
    pub fn new(
        pool: PgPool,
        crypto: ConnectorTokenCrypto,
        client: reqwest::Client,
        config: ConnectorConfig,
        hmac_key: &str,
    ) -> ApiResult<Self> {
        catalog::validate().map_err(ApiError::internal)?;
        Ok(Self {
            mcp: McpClientFactory::new(
                config.mcp_timeout_ms,
                config.max_schema_bytes,
                config.max_result_bytes,
            ),
            pool,
            crypto,
            client,
            config,
            hmac_key: hmac_key.as_bytes().to_vec(),
        })
    }

    #[must_use]
    pub fn enabled_for(&self, user: &str) -> bool {
        if !self.config.enabled {
            return false;
        }
        if self.config.canary_users.contains(user) || self.config.rollout_percent >= 100 {
            return true;
        }
        if self.config.rollout_percent == 0 {
            return false;
        }
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&self.hmac_key).expect("server key");
        mac.update(format!("connector-rollout:{user}").as_bytes());
        let bytes = mac.finalize().into_bytes();
        u32::from_be_bytes(bytes[..4].try_into().expect("four bytes")) % 10_000
            < u32::from(self.config.rollout_percent) * 100
    }

    pub async fn list(&self, user: &str) -> ApiResult<ConnectorList> {
        let rows = sqlx::query(
            "SELECT id,catalog_key,status,connected_at FROM connector_connections WHERE user_id=$1 ORDER BY catalog_key",
        )
        .bind(user)
        .fetch_all(&self.pool)
        .await?;
        Ok(ConnectorList {
            catalog: catalog::public_catalog(),
            connections: rows
                .into_iter()
                .map(|row| ConnectorConnectionSummary {
                    id: row.get("id"),
                    catalog_key: row.get("catalog_key"),
                    status: row.get("status"),
                    connected_at: row
                        .get::<Option<OffsetDateTime>, _>("connected_at")
                        .map(iso),
                })
                .collect(),
            enabled: self.enabled_for(user),
        })
    }

    pub async fn begin(
        &self,
        user: &str,
        catalog_key: &str,
    ) -> ApiResult<BeginConnectorConnection> {
        self.require_enabled(user)?;
        let definition = catalog::by_key(catalog_key).ok_or_else(connector_not_found)?;
        let callback_url = self.required(&self.config.callback_url, "connector callback")?;
        let client_id = self.required(&self.config.gmail_client_id, "Gmail connector client")?;
        let start =
            oauth::start(definition, callback_url, client_id).map_err(ApiError::internal)?;
        let attempt_id = Uuid::new_v4();
        let expires_at = OffsetDateTime::now_utc()
            + time::Duration::milliseconds(
                i64::try_from(self.config.oauth_attempt_ttl_ms).unwrap_or(i64::MAX),
            );
        let state_digest = self.state_digest(&start.state)?;
        let envelope = self.crypto.encrypt_json(
            &json!({"verifier":start.secrets.verifier}),
            &attempt_metadata(attempt_id, user, catalog_key),
        )?;
        sqlx::query("INSERT INTO connector_oauth_attempts(id,user_id,catalog_key,state_digest,secret_ciphertext,secret_iv,secret_tag,secret_key_version,expires_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(attempt_id)
            .bind(user)
            .bind(catalog_key)
            .bind(state_digest.to_vec())
            .bind(envelope.ciphertext)
            .bind(envelope.iv)
            .bind(envelope.tag)
            .bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX))
            .bind(expires_at)
            .execute(&self.pool)
            .await?;
        self.audit(
            user,
            None,
            catalog_key,
            "oauth.started",
            "success",
            json!({}),
        )
        .await?;
        Ok(BeginConnectorConnection {
            authorization_url: start.authorization_url,
            status: ConnectorAttemptStatus {
                attempt_id,
                catalog_key: catalog_key.to_owned(),
                expires_at: iso(expires_at),
                status: "pending".to_owned(),
            },
        })
    }

    pub async fn attempt_status(
        &self,
        user: &str,
        attempt_id: Uuid,
    ) -> ApiResult<Option<ConnectorAttemptStatus>> {
        let row = sqlx::query("SELECT id,catalog_key,status,expires_at FROM connector_oauth_attempts WHERE id=$1 AND user_id=$2")
            .bind(attempt_id)
            .bind(user)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|row| ConnectorAttemptStatus {
            attempt_id: row.get("id"),
            catalog_key: row.get("catalog_key"),
            status: row.get("status"),
            expires_at: iso(row.get("expires_at")),
        }))
    }

    pub async fn complete_callback(
        &self,
        state: &str,
        code: Option<&str>,
        provider_error: Option<&str>,
    ) -> ApiResult<CallbackOutcome> {
        if state.is_empty() || state.len() > 512 || code.is_some_and(|value| value.len() > 8_192) {
            return Err(ApiError::bad_request(
                "invalid_oauth_callback",
                "The connector authorization response is invalid.",
            ));
        }
        let digest = self.state_digest(state)?;
        let row = sqlx::query("UPDATE connector_oauth_attempts SET status='processing',consumed_at=NOW(),updated_at=NOW() WHERE state_digest=$1 AND status='pending' AND expires_at>NOW() RETURNING *")
            .bind(digest.to_vec())
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| ApiError::coded(http::StatusCode::CONFLICT, "oauth_attempt_stale", "This connector authorization attempt is expired or already used."))?;
        let attempt_id: Uuid = row.get("id");
        let user: String = row.get("user_id");
        let catalog_key: String = row.get("catalog_key");
        if provider_error.is_some() || code.is_none() {
            self.finish_attempt(attempt_id, "denied", Some("provider_denied"))
                .await?;
            self.audit(
                &user,
                None,
                &catalog_key,
                "oauth.callback",
                "denied",
                json!({}),
            )
            .await?;
            return Ok(CallbackOutcome { success: false });
        }
        let definition = catalog::by_key(&catalog_key).ok_or_else(connector_not_found)?;
        let envelope = attempt_envelope(&row)?;
        let secrets = self.crypto.decrypt_json(
            &envelope,
            &attempt_metadata(attempt_id, &user, &catalog_key),
        )?;
        let verifier = secrets
            .get("verifier")
            .and_then(Value::as_str)
            .context("OAuth verifier missing")
            .map_err(ApiError::internal)?;
        let callback_url = self.required(&self.config.callback_url, "connector callback")?;
        let client_id = self.required(&self.config.gmail_client_id, "Gmail connector client")?;
        let client_secret =
            self.required(&self.config.gmail_client_secret, "Gmail connector secret")?;
        let token = match oauth::exchange_code(
            &self.client,
            code.expect("checked"),
            verifier,
            callback_url,
            client_id,
            client_secret,
        )
        .await
        {
            Ok(value) => value,
            Err(_error) => {
                tracing::warn!(
                    event = "connector.oauth.exchange_failed",
                    catalog_key,
                    code = "token_exchange_failed"
                );
                self.finish_attempt(attempt_id, "failed", Some("token_exchange_failed"))
                    .await?;
                self.audit(
                    &user,
                    None,
                    &catalog_key,
                    "oauth.callback",
                    "failed",
                    json!({"code":"token_exchange_failed"}),
                )
                .await?;
                return Ok(CallbackOutcome { success: false });
            }
        };
        let connection_id: Uuid = sqlx::query_scalar("INSERT INTO connector_connections(id,user_id,catalog_key,status,updated_at)VALUES($1,$2,$3,'connecting',NOW())ON CONFLICT(user_id,catalog_key)DO UPDATE SET status='connecting',disconnected_at=NULL,updated_at=NOW()RETURNING id")
            .bind(Uuid::new_v4())
            .bind(&user)
            .bind(&catalog_key)
            .fetch_one(&self.pool)
            .await?;
        let catalog_contract_digest =
            catalog::catalog_contract_digest().map_err(ApiError::internal)?;
        let cancellation = CancellationToken::new();
        let discovered = match self
            .mcp
            .discover(
                definition,
                &token.access_token,
                &catalog_contract_digest,
                &cancellation,
            )
            .await
        {
            Ok(value) => value,
            Err(_error) => {
                tracing::warn!(event="connector.schema_drift", %connection_id, catalog_key, code="contract_changed");
                oauth::revoke(
                    &self.client,
                    token
                        .refresh_token
                        .as_deref()
                        .unwrap_or(&token.access_token),
                )
                .await;
                sqlx::query("UPDATE connector_connections SET status='contract_changed',updated_at=NOW()WHERE id=$1 AND user_id=$2")
                    .bind(connection_id).bind(&user).execute(&self.pool).await?;
                self.finish_attempt(attempt_id, "failed", Some("contract_changed"))
                    .await?;
                self.audit(
                    &user,
                    Some(connection_id),
                    &catalog_key,
                    "schema.discovery",
                    "failed",
                    json!({"code":"contract_changed"}),
                )
                .await?;
                return Ok(CallbackOutcome { success: false });
            }
        };
        let refresh_token = token
            .refresh_token
            .context("refresh token missing")
            .map_err(ApiError::internal)?;
        let token_expires_at =
            OffsetDateTime::now_utc() + time::Duration::seconds(token.expires_in);
        let token_envelope = self.crypto.encrypt_json(
            &json!({"accessToken":token.access_token,"refreshToken":refresh_token}),
            &token_metadata(connection_id, &user, &catalog_key),
        )?;
        let scopes: Vec<String> = token.scope.map_or_else(
            || {
                definition
                    .scopes
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect()
            },
            |scope| {
                scope
                    .split_ascii_whitespace()
                    .map(ToOwned::to_owned)
                    .collect()
            },
        );
        let snapshot_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE connector_tool_snapshots SET active=FALSE WHERE connection_id=$1 AND active=TRUE")
            .bind(connection_id).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO connector_tool_snapshots(id,connection_id,catalog_key,schema_digest,catalog_contract_digest,tools,active)VALUES($1,$2,$3,$4,$5,$6,TRUE)")
            .bind(snapshot_id).bind(connection_id).bind(&catalog_key).bind(&discovered.digest).bind(&catalog_contract_digest).bind(Value::Array(discovered.tools)).execute(&mut *tx).await?;
        sqlx::query("UPDATE connector_connections SET status='connected',token_ciphertext=$3,token_iv=$4,token_tag=$5,token_key_version=$6,granted_scopes=$7,token_expires_at=$8,active_snapshot_id=$9,active_schema_digest=$10,connected_at=NOW(),disconnected_at=NULL,updated_at=NOW()WHERE id=$1 AND user_id=$2")
            .bind(connection_id).bind(&user).bind(token_envelope.ciphertext).bind(token_envelope.iv).bind(token_envelope.tag).bind(i32::try_from(token_envelope.key_version).unwrap_or(i32::MAX)).bind(scopes).bind(token_expires_at).bind(snapshot_id).bind(&discovered.digest).execute(&mut *tx).await?;
        sqlx::query("UPDATE connector_oauth_attempts SET status='connected',failure_code=NULL,updated_at=NOW()WHERE id=$1")
            .bind(attempt_id).execute(&mut *tx).await?;
        tx.commit().await?;
        self.audit(
            &user,
            Some(connection_id),
            &catalog_key,
            "oauth.callback",
            "success",
            json!({"toolCount":definition.tools.len()}),
        )
        .await?;
        tracing::info!(event="connector.connected", %connection_id, catalog_key, tool_count=definition.tools.len());
        Ok(CallbackOutcome { success: true })
    }

    pub async fn disconnect(&self, user: &str, connection_id: Uuid) -> ApiResult<bool> {
        let row = sqlx::query("SELECT * FROM connector_connections WHERE id=$1 AND user_id=$2")
            .bind(connection_id)
            .bind(user)
            .fetch_optional(&self.pool)
            .await?;
        let Some(row) = row else { return Ok(false) };
        let catalog_key: String = row.get("catalog_key");
        let revoke_token = connection_envelope(&row)?
            .and_then(|envelope| {
                self.crypto
                    .decrypt_json(
                        &envelope,
                        &token_metadata(connection_id, user, &catalog_key),
                    )
                    .ok()
            })
            .and_then(|value| {
                value
                    .get("refreshToken")
                    .or_else(|| value.get("accessToken"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            });
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE connector_tool_snapshots SET active=FALSE WHERE connection_id=$1")
            .bind(connection_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE connector_connections SET status='disconnected',token_ciphertext=NULL,token_iv=NULL,token_tag=NULL,token_key_version=NULL,granted_scopes='{}',token_expires_at=NULL,active_snapshot_id=NULL,active_schema_digest=NULL,refresh_lease_owner=NULL,refresh_lease_expires_at=NULL,disconnected_at=NOW(),updated_at=NOW()WHERE id=$1 AND user_id=$2")
            .bind(connection_id).bind(user).execute(&mut *tx).await?;
        tx.commit().await?;
        self.audit(
            user,
            Some(connection_id),
            &catalog_key,
            "connection.disconnected",
            "success",
            json!({}),
        )
        .await?;
        if let Some(token) = revoke_token {
            oauth::revoke(&self.client, &token).await;
        }
        Ok(true)
    }

    pub async fn routes_for_user(&self, user: &str) -> ApiResult<Vec<ConnectorRoute>> {
        if !self.enabled_for(user) {
            return Ok(Vec::new());
        }
        let catalog_contract_digest =
            catalog::catalog_contract_digest().map_err(ApiError::internal)?;
        let rows = sqlx::query("SELECT connections.id AS connection_id,connections.catalog_key,snapshots.id AS snapshot_id,snapshots.catalog_contract_digest,snapshots.tools FROM connector_connections connections JOIN connector_tool_snapshots snapshots ON snapshots.id=connections.active_snapshot_id AND snapshots.active=TRUE WHERE connections.user_id=$1 AND connections.status='connected' ORDER BY connections.catalog_key")
            .bind(user).fetch_all(&self.pool).await?;
        let mut routes = Vec::new();
        for row in rows {
            let catalog_key: String = row.get("catalog_key");
            let connection_id: Uuid = row.get("connection_id");
            let snapshot_id: Uuid = row.get("snapshot_id");
            if row.get::<String, _>("catalog_contract_digest") != catalog_contract_digest {
                tracing::warn!(event="connector.snapshot.contract_changed", %connection_id, catalog_key, code="contract_changed");
                sqlx::query("UPDATE connector_connections SET status='contract_changed',updated_at=NOW()WHERE id=$1 AND user_id=$2 AND active_snapshot_id=$3")
                    .bind(connection_id).bind(user).bind(snapshot_id).execute(&self.pool).await?;
                continue;
            }
            let tools: Value = row.get("tools");
            for tool in tools.as_array().map(Vec::as_slice).unwrap_or(&[]) {
                let Some(name) = tool.get("mcpName").and_then(Value::as_str) else {
                    continue;
                };
                let Some(contract) = catalog::tool(&catalog_key, name) else {
                    continue;
                };
                routes.push(ConnectorRoute {
                    catalog_key: catalog_key.clone(),
                    connection_id,
                    snapshot_id,
                    namespace: contract.namespace.to_owned(),
                    tool_name: contract.name.to_owned(),
                    description: contract.description.to_owned(),
                    input_schema: contract.input_schema.clone(),
                });
            }
        }
        Ok(routes)
    }

    pub async fn execute(
        &self,
        user: &str,
        route: &ConnectorRoute,
        arguments: Value,
        cancellation: &CancellationToken,
    ) -> ApiResult<Value> {
        self.require_enabled(user)?;
        let definition = catalog::by_key(&route.catalog_key).ok_or_else(connector_not_found)?;
        let contract =
            catalog::tool(&route.catalog_key, &route.tool_name).ok_or_else(connector_not_found)?;
        let route_is_active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM connector_connections connections JOIN connector_tool_snapshots snapshots ON snapshots.id=connections.active_snapshot_id AND snapshots.active=TRUE WHERE connections.id=$1 AND connections.user_id=$2 AND connections.catalog_key=$3 AND connections.status='connected'AND snapshots.id=$4)")
            .bind(route.connection_id).bind(user).bind(&route.catalog_key).bind(route.snapshot_id).fetch_one(&self.pool).await?;
        if !route_is_active {
            return Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "connector_route_stale",
                "The connected application changed. Ask Tro to plan this action again.",
            ));
        }
        let access_token = self
            .access_token(user, route.connection_id, definition)
            .await?;
        let started = std::time::Instant::now();
        let result = self
            .mcp
            .call_tool(definition, contract, &access_token, arguments, cancellation)
            .await;
        let elapsed_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
        match result {
            Ok(value) => {
                tracing::info!(event="connector.mcp.completed", connection_id=%route.connection_id, catalog_key=route.catalog_key, tool_name=route.tool_name, duration_ms=elapsed_ms);
                serde_json::to_value(content_guard::guard(
                    &route.catalog_key,
                    &route.tool_name,
                    &value,
                    self.config.max_result_bytes,
                ))
                .map_err(ApiError::internal)
            }
            Err(error) => {
                tracing::warn!(event="connector.mcp.failed", connection_id=%route.connection_id, catalog_key=route.catalog_key, tool_name=route.tool_name, duration_ms=elapsed_ms, code="connector_call_failed");
                Err(ApiError::coded(
                    http::StatusCode::BAD_GATEWAY,
                    if error.to_string() == "MCP tool returned an error result." {
                        "connector_tool_failed"
                    } else {
                        "connector_call_failed"
                    },
                    "The connected application could not complete this action.",
                ))
            }
        }
    }

    pub async fn maintain(&self) -> ApiResult<()> {
        sqlx::query("UPDATE connector_oauth_attempts SET status='expired',failure_code='expired',updated_at=NOW()WHERE status IN('pending','processing')AND expires_at<=NOW()")
            .execute(&self.pool).await?;
        sqlx::query("UPDATE connector_connections SET refresh_lease_owner=NULL,refresh_lease_expires_at=NULL WHERE refresh_lease_expires_at<=NOW()")
            .execute(&self.pool).await?;
        sqlx::query("DELETE FROM connector_tool_snapshots WHERE active=FALSE AND created_at<NOW()-INTERVAL'30 days'")
            .execute(&self.pool).await?;
        Ok(())
    }

    fn require_enabled(&self, user: &str) -> ApiResult<()> {
        if self.enabled_for(user) {
            Ok(())
        } else {
            Err(ApiError::coded(
                http::StatusCode::CONFLICT,
                "connectors_not_enabled",
                "Connected applications are not enabled for this account.",
            ))
        }
    }

    fn required<'a>(&self, value: &'a Option<String>, label: &str) -> ApiResult<&'a str> {
        value
            .as_deref()
            .ok_or_else(|| ApiError::internal(anyhow::anyhow!("{label} is not configured")))
    }

    fn state_digest(&self, state: &str) -> ApiResult<[u8; 32]> {
        let mut mac =
            <Hmac<Sha256> as Mac>::new_from_slice(&self.hmac_key).map_err(ApiError::internal)?;
        mac.update(b"trocode-connector-oauth-state-v1\0");
        mac.update(state.as_bytes());
        Ok(mac.finalize().into_bytes().into())
    }

    async fn finish_attempt(&self, id: Uuid, status: &str, code: Option<&str>) -> ApiResult<()> {
        sqlx::query("UPDATE connector_oauth_attempts SET status=$2,failure_code=$3,updated_at=NOW()WHERE id=$1")
            .bind(id).bind(status).bind(code).execute(&self.pool).await?;
        Ok(())
    }

    async fn audit(
        &self,
        user: &str,
        connection: Option<Uuid>,
        catalog_key: &str,
        event: &str,
        outcome: &str,
        details: Value,
    ) -> ApiResult<()> {
        sqlx::query("INSERT INTO connector_audit_events(id,user_id,connection_id,catalog_key,event_type,outcome,safe_details)VALUES($1,$2,$3,$4,$5,$6,$7)")
            .bind(Uuid::new_v4()).bind(user).bind(connection).bind(catalog_key).bind(event).bind(outcome).bind(details).execute(&self.pool).await?;
        Ok(())
    }

    async fn access_token(
        &self,
        user: &str,
        connection_id: Uuid,
        definition: &'static ConnectorDefinition,
    ) -> ApiResult<String> {
        for _ in 0..10 {
            let row = sqlx::query("SELECT * FROM connector_connections WHERE id=$1 AND user_id=$2 AND catalog_key=$3 AND status='connected'AND active_snapshot_id IS NOT NULL")
                .bind(connection_id).bind(user).bind(definition.catalog_key).fetch_optional(&self.pool).await?
                .ok_or_else(|| ApiError::coded(http::StatusCode::CONFLICT, "connector_unavailable", "The connected application is no longer available."))?;
            let expires_at: OffsetDateTime = row.get("token_expires_at");
            let envelope = connection_envelope(&row)?
                .context("connector token missing")
                .map_err(ApiError::internal)?;
            let tokens = self.crypto.decrypt_json(
                &envelope,
                &token_metadata(connection_id, user, definition.catalog_key),
            )?;
            if expires_at > OffsetDateTime::now_utc() + time::Duration::seconds(90) {
                return tokens
                    .get("accessToken")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .context("access token missing")
                    .map_err(ApiError::internal);
            }
            let lease_owner = Uuid::new_v4();
            let acquired = sqlx::query("UPDATE connector_connections SET refresh_lease_owner=$3,refresh_lease_expires_at=NOW()+INTERVAL'30 seconds'WHERE id=$1 AND user_id=$2 AND(refresh_lease_expires_at IS NULL OR refresh_lease_expires_at<=NOW())")
                .bind(connection_id).bind(user).bind(lease_owner).execute(&self.pool).await?.rows_affected() == 1;
            if !acquired {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
            let refresh_token = tokens
                .get("refreshToken")
                .and_then(Value::as_str)
                .context("refresh token missing")
                .map_err(ApiError::internal)?;
            let client_id =
                self.required(&self.config.gmail_client_id, "Gmail connector client")?;
            let client_secret =
                self.required(&self.config.gmail_client_secret, "Gmail connector secret")?;
            match oauth::refresh(&self.client, refresh_token, client_id, client_secret).await {
                Ok(refreshed) => {
                    let retained_refresh =
                        refreshed.refresh_token.as_deref().unwrap_or(refresh_token);
                    let envelope = self.crypto.encrypt_json(&json!({"accessToken":refreshed.access_token,"refreshToken":retained_refresh}), &token_metadata(connection_id, user, definition.catalog_key))?;
                    let expires =
                        OffsetDateTime::now_utc() + time::Duration::seconds(refreshed.expires_in);
                    let updated = sqlx::query("UPDATE connector_connections SET token_ciphertext=$4,token_iv=$5,token_tag=$6,token_key_version=$7,token_expires_at=$8,refresh_lease_owner=NULL,refresh_lease_expires_at=NULL,updated_at=NOW()WHERE id=$1 AND user_id=$2 AND refresh_lease_owner=$3")
                        .bind(connection_id).bind(user).bind(lease_owner).bind(envelope.ciphertext).bind(envelope.iv).bind(envelope.tag).bind(i32::try_from(envelope.key_version).unwrap_or(i32::MAX)).bind(expires).execute(&self.pool).await?;
                    if updated.rows_affected() == 1 {
                        return Ok(refreshed.access_token);
                    }
                }
                Err(_error) => {
                    tracing::warn!(event="connector.oauth.refresh_failed", %connection_id, catalog_key=definition.catalog_key, code="refresh_failed");
                    sqlx::query("UPDATE connector_connections SET status='reauthorize',refresh_lease_owner=NULL,refresh_lease_expires_at=NULL,updated_at=NOW()WHERE id=$1 AND user_id=$2 AND refresh_lease_owner=$3")
                        .bind(connection_id).bind(user).bind(lease_owner).execute(&self.pool).await?;
                    return Err(ApiError::coded(
                        http::StatusCode::CONFLICT,
                        "connector_reauthorization_required",
                        "Reconnect this application before using it again.",
                    ));
                }
            }
        }
        Err(ApiError::coded(
            http::StatusCode::CONFLICT,
            "connector_refresh_busy",
            "The connected application is refreshing. Try again shortly.",
        ))
    }
}

pub fn validate_action(route: &ConnectorRoute, arguments: &Value) -> ApiResult<()> {
    schema::validate_arguments(&route.input_schema, arguments).map_err(|_| {
        ApiError::bad_request(
            "invalid_connector_arguments",
            "Connector arguments do not match the reviewed contract.",
        )
    })?;
    catalog::tool(&route.catalog_key, &route.tool_name).ok_or_else(connector_not_found)?;
    Ok(())
}

fn attempt_metadata(id: Uuid, user: &str, catalog_key: &str) -> Value {
    json!({"attemptId":id,"catalogKey":catalog_key,"kind":"connector_oauth_attempt","schemaVersion":1,"userId":user})
}

fn token_metadata(id: Uuid, user: &str, catalog_key: &str) -> Value {
    json!({"catalogKey":catalog_key,"connectionId":id,"kind":"connector_tokens","schemaVersion":1,"userId":user})
}

fn attempt_envelope(row: &sqlx::postgres::PgRow) -> ApiResult<AgentEnvelope> {
    Ok(AgentEnvelope {
        ciphertext: row.get("secret_ciphertext"),
        iv: row.get("secret_iv"),
        tag: row.get("secret_tag"),
        key_version: u32::try_from(row.get::<i32, _>("secret_key_version"))
            .map_err(ApiError::internal)?,
    })
}

fn connection_envelope(row: &sqlx::postgres::PgRow) -> ApiResult<Option<AgentEnvelope>> {
    let Some(ciphertext) = row.get::<Option<Vec<u8>>, _>("token_ciphertext") else {
        return Ok(None);
    };
    Ok(Some(AgentEnvelope {
        ciphertext,
        iv: row
            .get::<Option<Vec<u8>>, _>("token_iv")
            .context("connector token IV missing")
            .map_err(ApiError::internal)?,
        tag: row
            .get::<Option<Vec<u8>>, _>("token_tag")
            .context("connector token tag missing")
            .map_err(ApiError::internal)?,
        key_version: u32::try_from(
            row.get::<Option<i32>, _>("token_key_version")
                .context("connector token key version missing")
                .map_err(ApiError::internal)?,
        )
        .map_err(ApiError::internal)?,
    }))
}

fn connector_not_found() -> ApiError {
    ApiError::coded(
        http::StatusCode::NOT_FOUND,
        "connector_not_found",
        "Connected application not found.",
    )
}

fn iso(value: OffsetDateTime) -> String {
    value.format(&Rfc3339).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_validation_uses_the_reviewed_catalog_schema() {
        let route = ConnectorRoute {
            catalog_key: "gmail".to_owned(),
            connection_id: Uuid::nil(),
            snapshot_id: Uuid::from_u128(u128::MAX),
            namespace: "gmail_organize".to_owned(),
            tool_name: "create_draft".to_owned(),
            description: "draft".to_owned(),
            input_schema: catalog::tool("gmail", "create_draft")
                .expect("tool")
                .input_schema
                .clone(),
        };
        validate_action(
            &route,
            &json!({"to":["a@example.com"],"body":"private body"}),
        )
        .expect("action");
        assert!(validate_action(&route, &json!({"unknown":true})).is_err());
    }
}
