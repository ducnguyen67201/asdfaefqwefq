use std::{collections::BTreeSet, env};

use anyhow::{Context, bail};

const MIN_SECRET_LENGTH: usize = 32;

#[derive(Clone, Debug)]
pub struct Config {
    pub admin: AdminConfig,
    pub agent_runtime: AgentRuntimeConfig,
    pub connectors: ConnectorConfig,
    pub cost_guard: CostGuardConfig,
    pub database_pool_max: u32,
    pub database_url: String,
    pub eleven_labs_api_key: Option<String>,
    pub eleven_labs_model_id: String,
    pub eleven_labs_voice_id: Option<String>,
    pub google_client_id: String,
    pub knowledge_spaces: KnowledgeConfig,
    pub openai_api_key: String,
    pub openai_models: BTreeSet<String>,
    pub port: u16,
    pub railway_git_commit_sha: String,
    pub session_duration_days: u32,
    pub session_token_hmac_key: String,
}

#[derive(Clone, Debug)]
pub struct ConnectorConfig {
    pub callback_url: Option<String>,
    pub canary_users: BTreeSet<String>,
    pub current_encryption_key_version: u32,
    pub enabled: bool,
    pub encryption_keys: Option<String>,
    pub gmail_client_id: Option<String>,
    pub gmail_client_secret: Option<String>,
    pub max_result_bytes: usize,
    pub max_schema_bytes: usize,
    pub mcp_timeout_ms: u64,
    pub oauth_attempt_ttl_ms: u64,
    pub rollout_percent: u8,
}

#[derive(Clone, Debug)]
pub struct AdminConfig {
    pub access_token: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CostGuardConfig {
    pub daily_micro_usd: i64,
    pub enabled: bool,
    pub mode: CostGuardMode,
    pub monthly_micro_usd: i64,
    pub realtime_call_micro_usd: i64,
    pub reservation_ttl_ms: u64,
    pub speech_micro_usd_per_thousand_characters: i64,
    pub task_micro_usd: i64,
    pub transcription_micro_usd_per_minute: i64,
    pub warning_percent: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CostGuardMode {
    Enforce,
    Observe,
}

#[derive(Clone, Debug)]
pub struct KnowledgeConfig {
    pub object_store: Option<ObjectStoreConfig>,
}

#[derive(Clone, Debug)]
pub struct ObjectStoreConfig {
    pub access_key_id: String,
    pub bucket: String,
    pub endpoint: Option<String>,
    pub force_path_style: bool,
    pub region: String,
    pub secret_access_key: String,
}

#[derive(Clone, Debug)]
pub struct AgentRuntimeConfig {
    pub canary_users: BTreeSet<String>,
    pub compaction_item_threshold: usize,
    pub current_encryption_key_version: u32,
    pub enabled: bool,
    pub encryption_keys: Option<String>,
    pub heartbeat_ttl_ms: u64,
    pub intent_authorization: RolloutConfig,
    pub lease_ms: u64,
    pub max_active_runs_per_user: i64,
    pub max_queue_depth: i64,
    pub payload_ttl_ms: u64,
    pub playwright_cdp_enabled: bool,
    pub protocol_version: u32,
    pub v3_mode: AgentRuntimeV3Mode,
    pub rollout_percent: u8,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentRuntimeV3Mode {
    Observe,
    Dual,
    Enforce,
}

impl AgentRuntimeV3Mode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Observe => "observe",
            Self::Dual => "dual",
            Self::Enforce => "enforce",
        }
    }
}

#[derive(Clone, Debug)]
pub struct RolloutConfig {
    pub canary_users: BTreeSet<String>,
    pub enabled: bool,
    pub rollout_percent: u8,
}

trait Environment {
    fn get(&self, key: &str) -> Option<String>;
}

struct ProcessEnvironment;

impl Environment for ProcessEnvironment {
    fn get(&self, key: &str) -> Option<String> {
        env::var(key).ok()
    }
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Self::from_source(&ProcessEnvironment)
    }

    fn from_source(environment: &impl Environment) -> anyhow::Result<Self> {
        let session_token_hmac_key = required(environment, "TROCODE_SESSION_TOKEN_HMAC_KEY")?;
        if session_token_hmac_key.len() < MIN_SECRET_LENGTH {
            bail!(
                "TROCODE_SESSION_TOKEN_HMAC_KEY must be at least {MIN_SECRET_LENGTH} characters."
            );
        }

        let primary_model = optional(environment, "TROCODE_AGENT_MODEL")
            .unwrap_or_else(|| "gpt-5.6-luna".to_owned());
        let backend_agent_enabled = boolean(environment, "TROCODE_BACKEND_AGENT_ENABLED", false)?;
        let encryption_keys = optional(environment, "TROCODE_AGENT_STATE_ENCRYPTION_KEYS");
        if backend_agent_enabled && encryption_keys.is_none() {
            bail!(
                "TROCODE_AGENT_STATE_ENCRYPTION_KEYS is required when the backend agent is enabled."
            );
        }
        let protocol_version =
            positive_u32(environment, "TROCODE_AGENT_RUNTIME_PROTOCOL_VERSION", 2)?;
        if protocol_version != 2 {
            bail!("TROCODE_AGENT_RUNTIME_PROTOCOL_VERSION must be 2.");
        }
        let v3_mode = match optional(environment, "AGENT_RUNTIME_V3_MODE").as_deref() {
            None | Some("observe") => AgentRuntimeV3Mode::Observe,
            Some("dual") => AgentRuntimeV3Mode::Dual,
            Some("enforce") => AgentRuntimeV3Mode::Enforce,
            Some(_) => bail!("AGENT_RUNTIME_V3_MODE must be one of: observe, dual, enforce."),
        };

        let knowledge_access_key_id = optional(environment, "TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID");
        let knowledge_bucket = optional(environment, "TROCODE_KNOWLEDGE_S3_BUCKET");
        let knowledge_endpoint = optional(environment, "TROCODE_KNOWLEDGE_S3_ENDPOINT");
        let knowledge_region = optional(environment, "TROCODE_KNOWLEDGE_S3_REGION");
        let knowledge_secret_access_key =
            optional(environment, "TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY");
        let knowledge_storage_configured = knowledge_access_key_id.is_some()
            || knowledge_bucket.is_some()
            || knowledge_endpoint.is_some()
            || knowledge_region.is_some()
            || knowledge_secret_access_key.is_some();
        let object_store = if knowledge_storage_configured {
            Some(ObjectStoreConfig {
                access_key_id: knowledge_access_key_id
                    .context("TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID is required.")?,
                bucket: knowledge_bucket.context("TROCODE_KNOWLEDGE_S3_BUCKET is required.")?,
                endpoint: knowledge_endpoint,
                force_path_style: boolean(
                    environment,
                    "TROCODE_KNOWLEDGE_S3_FORCE_PATH_STYLE",
                    false,
                )?,
                region: knowledge_region.context("TROCODE_KNOWLEDGE_S3_REGION is required.")?,
                secret_access_key: knowledge_secret_access_key
                    .context("TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY is required.")?,
            })
        } else {
            None
        };

        let admin_access_token = optional(environment, "TROCODE_ADMIN_ACCESS_TOKEN");
        if admin_access_token
            .as_ref()
            .is_some_and(|token| token.len() < MIN_SECRET_LENGTH)
        {
            bail!("TROCODE_ADMIN_ACCESS_TOKEN must be at least {MIN_SECRET_LENGTH} characters.");
        }

        let mut openai_models = BTreeSet::from([
            primary_model,
            "gpt-5.6-luna".to_owned(),
            "gpt-5.6-terra".to_owned(),
            "gpt-5.6-sol".to_owned(),
        ]);
        openai_models.extend(comma_separated(
            environment,
            "TROCODE_AGENT_MODEL_ALLOWLIST",
        ));

        let cost_mode = match optional(environment, "TROCODE_COST_GUARD_MODE").as_deref() {
            None | Some("enforce") => CostGuardMode::Enforce,
            Some("observe") => CostGuardMode::Observe,
            Some(_) => bail!("TROCODE_COST_GUARD_MODE must be one of: observe, enforce."),
        };

        let warning_percent = positive_u32(environment, "TROCODE_BUDGET_WARNING_PERCENT", 80)?;
        if warning_percent > 100 {
            bail!("TROCODE_BUDGET_WARNING_PERCENT must be at most 100.");
        }

        let connector_enabled = boolean(environment, "TROCODE_CONNECTORS_ENABLED", false)?;
        let connector_canary_users = comma_separated(environment, "TROCODE_CONNECTOR_CANARY_USERS");
        let connector_rollout_percent =
            percentage(environment, "TROCODE_CONNECTOR_ROLLOUT_PERCENT", 0)?;
        let connector_rollout_active = connector_enabled
            && (!connector_canary_users.is_empty() || connector_rollout_percent > 0);
        let connector_callback_url = optional(environment, "TROCODE_CONNECTOR_CALLBACK_URL");
        let connector_encryption_keys =
            optional(environment, "TROCODE_CONNECTOR_TOKEN_ENCRYPTION_KEYS");
        let gmail_connector_client_id = optional(environment, "TROCODE_GMAIL_CONNECTOR_CLIENT_ID");
        let gmail_connector_client_secret =
            optional(environment, "TROCODE_GMAIL_CONNECTOR_CLIENT_SECRET");
        if connector_rollout_active {
            connector_encryption_keys.as_ref().context(
                "TROCODE_CONNECTOR_TOKEN_ENCRYPTION_KEYS is required when connectors are enabled.",
            )?;
            gmail_connector_client_id.as_ref().context(
                "TROCODE_GMAIL_CONNECTOR_CLIENT_ID is required when connectors are enabled.",
            )?;
            gmail_connector_client_secret.as_ref().context(
                "TROCODE_GMAIL_CONNECTOR_CLIENT_SECRET is required when connectors are enabled.",
            )?;
            let callback = connector_callback_url.as_ref().context(
                "TROCODE_CONNECTOR_CALLBACK_URL is required when connectors are enabled.",
            )?;
            let parsed = url::Url::parse(callback)
                .context("TROCODE_CONNECTOR_CALLBACK_URL must be a valid URL.")?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || parsed.path() != "/v1/connectors/oauth/callback"
                || parsed.query().is_some()
                || parsed.fragment().is_some()
            {
                bail!(
                    "TROCODE_CONNECTOR_CALLBACK_URL must be a public HTTPS URL with the exact /v1/connectors/oauth/callback path and no query or fragment."
                );
            }
        }
        let connector_max_schema_bytes =
            positive_usize(environment, "TROCODE_CONNECTOR_MAX_SCHEMA_BYTES", 128_000)?;
        if connector_max_schema_bytes > 512_000 {
            bail!("TROCODE_CONNECTOR_MAX_SCHEMA_BYTES must be at most 512000.");
        }
        let connector_max_result_bytes =
            positive_usize(environment, "TROCODE_CONNECTOR_MAX_RESULT_BYTES", 512_000)?;
        if connector_max_result_bytes > 2_000_000 {
            bail!("TROCODE_CONNECTOR_MAX_RESULT_BYTES must be at most 2000000.");
        }

        Ok(Self {
            admin: AdminConfig {
                access_token: admin_access_token,
            },
            agent_runtime: AgentRuntimeConfig {
                canary_users: comma_separated(environment, "TROCODE_BACKEND_AGENT_CANARY_USERS"),
                compaction_item_threshold: positive_usize(
                    environment,
                    "TROCODE_AGENT_COMPACTION_ITEM_THRESHOLD",
                    80,
                )?,
                current_encryption_key_version: positive_u32(
                    environment,
                    "TROCODE_AGENT_STATE_KEY_VERSION",
                    1,
                )?,
                enabled: backend_agent_enabled,
                encryption_keys,
                heartbeat_ttl_ms: positive_u64(
                    environment,
                    "TROCODE_DESKTOP_WORKER_TTL_MS",
                    35_000,
                )?,
                intent_authorization: RolloutConfig {
                    canary_users: comma_separated(
                        environment,
                        "TROCODE_INTENT_AUTHORIZATION_CANARY_USERS",
                    ),
                    enabled: boolean(environment, "TROCODE_INTENT_AUTHORIZATION_ENABLED", false)?,
                    rollout_percent: percentage(
                        environment,
                        "TROCODE_INTENT_AUTHORIZATION_ROLLOUT_PERCENT",
                        0,
                    )?,
                },
                lease_ms: positive_u64(environment, "TROCODE_AGENT_LEASE_MS", 30_000)?,
                max_active_runs_per_user: i64::from(positive_u32(
                    environment,
                    "TROCODE_AGENT_MAX_ACTIVE_RUNS_PER_USER",
                    2,
                )?),
                max_queue_depth: i64::from(positive_u32(
                    environment,
                    "TROCODE_AGENT_MAX_QUEUE_DEPTH",
                    1_000,
                )?),
                payload_ttl_ms: positive_u64(
                    environment,
                    "TROCODE_AGENT_PAYLOAD_TTL_MS",
                    7 * 24 * 60 * 60 * 1_000,
                )?,
                playwright_cdp_enabled: boolean(
                    environment,
                    "TROCODE_PLAYWRIGHT_CDP_ENABLED",
                    false,
                )?,
                protocol_version,
                v3_mode,
                rollout_percent: percentage(
                    environment,
                    "TROCODE_BACKEND_AGENT_ROLLOUT_PERCENT",
                    0,
                )?,
            },
            connectors: ConnectorConfig {
                callback_url: connector_callback_url,
                canary_users: connector_canary_users,
                current_encryption_key_version: positive_u32(
                    environment,
                    "TROCODE_CONNECTOR_TOKEN_KEY_VERSION",
                    1,
                )?,
                enabled: connector_enabled,
                encryption_keys: connector_encryption_keys,
                gmail_client_id: gmail_connector_client_id,
                gmail_client_secret: gmail_connector_client_secret,
                max_result_bytes: connector_max_result_bytes,
                max_schema_bytes: connector_max_schema_bytes,
                mcp_timeout_ms: positive_u64(
                    environment,
                    "TROCODE_CONNECTOR_MCP_TIMEOUT_MS",
                    30_000,
                )?,
                oauth_attempt_ttl_ms: positive_u64(
                    environment,
                    "TROCODE_CONNECTOR_OAUTH_ATTEMPT_TTL_MS",
                    10 * 60 * 1_000,
                )?,
                rollout_percent: connector_rollout_percent,
            },
            cost_guard: CostGuardConfig {
                daily_micro_usd: positive_i64(
                    environment,
                    "TROCODE_DAILY_BUDGET_MICRO_USD",
                    8_000_000,
                )?,
                enabled: boolean(environment, "TROCODE_PAID_CALLS_ENABLED", true)?,
                mode: cost_mode,
                monthly_micro_usd: positive_i64(
                    environment,
                    "TROCODE_MONTHLY_BUDGET_MICRO_USD",
                    45_000_000,
                )?,
                realtime_call_micro_usd: positive_i64(
                    environment,
                    "TROCODE_REALTIME_CALL_ESTIMATE_MICRO_USD",
                    5_000,
                )?,
                reservation_ttl_ms: positive_u64(
                    environment,
                    "TROCODE_RESERVATION_TTL_MS",
                    120_000,
                )?,
                speech_micro_usd_per_thousand_characters: positive_i64(
                    environment,
                    "TROCODE_SPEECH_MICRO_USD_PER_THOUSAND_CHARACTERS",
                    60_000,
                )?,
                task_micro_usd: positive_i64(
                    environment,
                    "TROCODE_TASK_BUDGET_MICRO_USD",
                    5_000_000,
                )?,
                transcription_micro_usd_per_minute: positive_i64(
                    environment,
                    "TROCODE_TRANSCRIPTION_MICRO_USD_PER_MINUTE",
                    4_500,
                )?,
                warning_percent,
            },
            database_pool_max: positive_u32(environment, "TROCODE_DATABASE_POOL_MAX", 10)?,
            database_url: required(environment, "DATABASE_URL")?,
            eleven_labs_api_key: optional(environment, "ELEVENLABS_API_KEY"),
            eleven_labs_model_id: optional(environment, "ELEVENLABS_MODEL_ID")
                .unwrap_or_else(|| "eleven_flash_v2_5".to_owned()),
            eleven_labs_voice_id: optional(environment, "ELEVENLABS_VOICE_ID"),
            google_client_id: required(environment, "GOOGLE_OAUTH_CLIENT_ID")?,
            knowledge_spaces: KnowledgeConfig { object_store },
            openai_api_key: required(environment, "OPENAI_API_KEY")?,
            openai_models,
            port: positive_u16(environment, "PORT", 8080)?,
            railway_git_commit_sha: optional(environment, "RAILWAY_GIT_COMMIT_SHA")
                .unwrap_or_else(|| "local".to_owned()),
            session_duration_days: positive_u32(environment, "TROCODE_SESSION_DURATION_DAYS", 30)?,
            session_token_hmac_key,
        })
    }
}

fn optional(environment: &impl Environment, name: &str) -> Option<String> {
    environment
        .get(name)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn required(environment: &impl Environment, name: &str) -> anyhow::Result<String> {
    optional(environment, name).with_context(|| format!("{name} is required."))
}

fn boolean(environment: &impl Environment, name: &str, fallback: bool) -> anyhow::Result<bool> {
    match optional(environment, name).as_deref() {
        None => Ok(fallback),
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(_) => bail!("{name} must be true or false."),
    }
}

fn parsed<T>(environment: &impl Environment, name: &str, fallback: T) -> anyhow::Result<T>
where
    T: std::str::FromStr + Copy,
{
    optional(environment, name).map_or(Ok(fallback), |value| {
        value
            .parse::<T>()
            .map_err(|_| anyhow::anyhow!("{name} must be a positive integer."))
    })
}

fn positive_u64(environment: &impl Environment, name: &str, fallback: u64) -> anyhow::Result<u64> {
    let value = parsed(environment, name, fallback)?;
    if value == 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn positive_u32(environment: &impl Environment, name: &str, fallback: u32) -> anyhow::Result<u32> {
    let value = parsed(environment, name, fallback)?;
    if value == 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn positive_u16(environment: &impl Environment, name: &str, fallback: u16) -> anyhow::Result<u16> {
    let value = parsed(environment, name, fallback)?;
    if value == 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn positive_usize(
    environment: &impl Environment,
    name: &str,
    fallback: usize,
) -> anyhow::Result<usize> {
    let value = parsed(environment, name, fallback)?;
    if value == 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn positive_i64(environment: &impl Environment, name: &str, fallback: i64) -> anyhow::Result<i64> {
    let value = parsed(environment, name, fallback)?;
    if value <= 0 {
        bail!("{name} must be a positive integer.");
    }
    Ok(value)
}

fn percentage(environment: &impl Environment, name: &str, fallback: u8) -> anyhow::Result<u8> {
    let value = parsed(environment, name, fallback)?;
    if value > 100 {
        bail!("{name} must be an integer from 0 to 100.");
    }
    Ok(value)
}

fn comma_separated(environment: &impl Environment, name: &str) -> BTreeSet<String> {
    environment
        .get(name)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    impl Environment for BTreeMap<String, String> {
        fn get(&self, key: &str) -> Option<String> {
            self.get(key).cloned()
        }
    }

    fn environment() -> BTreeMap<String, String> {
        BTreeMap::from([
            (
                "DATABASE_URL".to_owned(),
                "postgres://local/test".to_owned(),
            ),
            ("GOOGLE_OAUTH_CLIENT_ID".to_owned(), "client".to_owned()),
            ("OPENAI_API_KEY".to_owned(), "openai".to_owned()),
            ("TROCODE_SESSION_TOKEN_HMAC_KEY".to_owned(), "x".repeat(32)),
        ])
    }

    #[test]
    fn loads_defaults() {
        let config = Config::from_source(&environment()).expect("valid config");
        assert_eq!(config.port, 8080);
        assert_eq!(config.agent_runtime.protocol_version, 2);
        assert!(config.openai_models.contains("gpt-5.6-luna"));
    }

    #[test]
    fn requires_encryption_key_when_runtime_is_enabled() {
        let mut values = environment();
        values.insert(
            "TROCODE_BACKEND_AGENT_ENABLED".to_owned(),
            "true".to_owned(),
        );
        assert!(Config::from_source(&values).is_err());
    }

    #[test]
    fn configures_knowledge_object_storage_without_a_feature_flag() {
        let mut values = environment();
        values.extend([
            (
                "TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID".to_owned(),
                "access-key".to_owned(),
            ),
            (
                "TROCODE_KNOWLEDGE_S3_BUCKET".to_owned(),
                "knowledge".to_owned(),
            ),
            (
                "TROCODE_KNOWLEDGE_S3_REGION".to_owned(),
                "us-east-1".to_owned(),
            ),
            (
                "TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY".to_owned(),
                "secret-key".to_owned(),
            ),
        ]);

        let config = Config::from_source(&values).expect("valid object store config");

        assert!(config.knowledge_spaces.object_store.is_some());
    }

    #[test]
    fn rejects_partial_knowledge_object_storage_configuration() {
        let mut values = environment();
        values.insert(
            "TROCODE_KNOWLEDGE_S3_BUCKET".to_owned(),
            "knowledge".to_owned(),
        );

        let error = Config::from_source(&values).expect_err("partial object store config");

        assert!(
            error
                .to_string()
                .contains("TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID")
        );
    }

    #[test]
    fn connector_defaults_are_disabled() {
        let config = Config::from_source(&environment()).expect("valid config");
        assert!(!config.connectors.enabled);
        assert!(config.connectors.callback_url.is_none());
    }

    #[test]
    fn connector_rollout_requires_separate_secrets_and_exact_callback() {
        let mut values = environment();
        values.extend([
            ("TROCODE_CONNECTORS_ENABLED".to_owned(), "true".to_owned()),
            (
                "TROCODE_CONNECTOR_ROLLOUT_PERCENT".to_owned(),
                "100".to_owned(),
            ),
            (
                "TROCODE_CONNECTOR_TOKEN_ENCRYPTION_KEYS".to_owned(),
                "1:eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg=".to_owned(),
            ),
            (
                "TROCODE_GMAIL_CONNECTOR_CLIENT_ID".to_owned(),
                "gmail-client".to_owned(),
            ),
            (
                "TROCODE_GMAIL_CONNECTOR_CLIENT_SECRET".to_owned(),
                "gmail-secret".to_owned(),
            ),
            (
                "TROCODE_CONNECTOR_CALLBACK_URL".to_owned(),
                "https://api.example.com/wrong".to_owned(),
            ),
        ]);
        assert!(Config::from_source(&values).is_err());
        values.insert(
            "TROCODE_CONNECTOR_CALLBACK_URL".to_owned(),
            "https://api.example.com/v1/connectors/oauth/callback".to_owned(),
        );
        assert!(Config::from_source(&values).is_ok());
    }
}
