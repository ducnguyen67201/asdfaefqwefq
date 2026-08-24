use std::{error::Error, fmt};

pub const DEFAULT_PORT: u16 = 8081;
const DEFAULT_POOL_MAX: u32 = 10;
const MIN_SECRET_LENGTH: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassroomConfig {
    pub database_url: String,
    pub pool_max: u32,
    pub session_hmac_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigError(pub &'static str);

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

impl Error for ConfigError {}

pub fn parse_port(value: Option<&str>) -> Result<u16, ConfigError> {
    let Some(value) = trimmed(value) else {
        return Ok(DEFAULT_PORT);
    };

    value
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or(ConfigError("PORT must be an integer from 1 to 65535"))
}

pub fn version_from_value(value: Option<&str>) -> String {
    trimmed(value).unwrap_or("local").to_owned()
}

pub fn classroom_config_from_values(
    enabled: Option<&str>,
    database_url: Option<&str>,
    hmac_key: Option<&str>,
    pool_max: Option<&str>,
) -> Result<Option<ClassroomConfig>, ConfigError> {
    if !parse_knowledge_spaces_enabled(enabled)? {
        return Ok(None);
    }

    let database_url = trimmed(database_url).ok_or(ConfigError(
        "DATABASE_URL is required when the Rust classroom API is enabled",
    ))?;
    let session_hmac_key = trimmed(hmac_key).ok_or(ConfigError(
        "TROCODE_SESSION_TOKEN_HMAC_KEY is required when the Rust classroom API is enabled",
    ))?;
    if session_hmac_key.len() < MIN_SECRET_LENGTH {
        return Err(ConfigError(
            "TROCODE_SESSION_TOKEN_HMAC_KEY must be at least 32 characters",
        ));
    }

    Ok(Some(ClassroomConfig {
        database_url: database_url.to_owned(),
        pool_max: parse_pool_max(pool_max)?,
        session_hmac_key: session_hmac_key.to_owned(),
    }))
}

fn trimmed(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn parse_knowledge_spaces_enabled(value: Option<&str>) -> Result<bool, ConfigError> {
    match trimmed(value) {
        None => Ok(false),
        Some("true") => Ok(true),
        Some("false") => Ok(false),
        Some(_) => Err(ConfigError(
            "TROCODE_KNOWLEDGE_SPACES_ENABLED must be true or false",
        )),
    }
}

fn parse_pool_max(value: Option<&str>) -> Result<u32, ConfigError> {
    match trimmed(value) {
        None => Ok(DEFAULT_POOL_MAX),
        Some(value) => value
            .parse::<u32>()
            .ok()
            .filter(|parsed| *parsed > 0)
            .ok_or(ConfigError(
                "TROCODE_DATABASE_POOL_MAX must be a positive integer",
            )),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ClassroomConfig, ConfigError, DEFAULT_PORT, classroom_config_from_values, parse_port,
        version_from_value,
    };

    #[test]
    fn port_defaults_and_validates_without_echoing_input() {
        assert_eq!(parse_port(None), Ok(DEFAULT_PORT));
        assert_eq!(parse_port(Some("   ")), Ok(DEFAULT_PORT));
        assert_eq!(parse_port(Some("18081")), Ok(18081));
        for value in ["0", "abc", "-1", "65536"] {
            let error = parse_port(Some(value)).expect_err("invalid port must fail");
            assert_eq!(
                error,
                ConfigError("PORT must be an integer from 1 to 65535")
            );
            assert!(!error.to_string().contains(value));
        }
    }

    #[test]
    fn version_defaults_when_missing_or_blank() {
        assert_eq!(version_from_value(None), "local");
        assert_eq!(version_from_value(Some("   ")), "local");
        assert_eq!(version_from_value(Some(" test-sha ")), "test-sha");
    }

    #[test]
    fn classroom_configuration_is_opt_in_and_bounded() {
        assert_eq!(
            classroom_config_from_values(None, None, None, None),
            Ok(None)
        );
        assert_eq!(
            classroom_config_from_values(
                Some("true"),
                Some(" postgres://localhost/trocode "),
                Some("abcdefghijklmnopqrstuvwxyz123456"),
                Some("16"),
            ),
            Ok(Some(ClassroomConfig {
                database_url: "postgres://localhost/trocode".to_owned(),
                pool_max: 16,
                session_hmac_key: "abcdefghijklmnopqrstuvwxyz123456".to_owned(),
            }))
        );
        assert_eq!(
            classroom_config_from_values(Some("true"), None, Some(&"x".repeat(32)), None),
            Err(ConfigError(
                "DATABASE_URL is required when the Rust classroom API is enabled"
            ))
        );
        assert!(
            classroom_config_from_values(
                Some("true"),
                Some("postgres://localhost/trocode"),
                Some("short"),
                None,
            )
            .is_err()
        );
    }
}
