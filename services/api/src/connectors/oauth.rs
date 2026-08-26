use std::time::Duration;

use anyhow::{Context, bail};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use url::Url;

use super::catalog::ConnectorDefinition;

const GOOGLE_AUTHORIZATION_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOCATION_URL: &str = "https://oauth2.googleapis.com/revoke";

#[derive(Clone, Debug)]
pub struct OAuthSecrets {
    pub verifier: String,
}

#[derive(Clone, Debug)]
pub struct OAuthStart {
    pub authorization_url: String,
    pub secrets: OAuthSecrets,
    pub state: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GoogleTokenResponse {
    pub access_token: String,
    pub expires_in: i64,
    pub refresh_token: Option<String>,
    pub scope: Option<String>,
    pub token_type: String,
}

pub fn start(
    definition: &ConnectorDefinition,
    callback_url: &str,
    client_id: &str,
) -> anyhow::Result<OAuthStart> {
    let state = random_secret(32);
    let verifier = random_secret(64);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = Url::parse(GOOGLE_AUTHORIZATION_URL)?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", callback_url)
        .append_pair("response_type", "code")
        .append_pair("scope", &definition.scopes.join(" "))
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("include_granted_scopes", "false")
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);
    Ok(OAuthStart {
        authorization_url: url.to_string(),
        secrets: OAuthSecrets { verifier },
        state,
    })
}

pub async fn exchange_code(
    client: &reqwest::Client,
    code: &str,
    verifier: &str,
    callback_url: &str,
    client_id: &str,
    client_secret: &str,
) -> anyhow::Result<GoogleTokenResponse> {
    let request = client.post(GOOGLE_TOKEN_URL).form(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", callback_url),
    ]);
    let response = tokio::time::timeout(Duration::from_secs(20), request.send())
        .await
        .context("Google token exchange timed out")??;
    if !response.status().is_success() {
        bail!("Google rejected the connector authorization code.");
    }
    let token: GoogleTokenResponse = response
        .json()
        .await
        .context("invalid Google token response")?;
    validate_token(&token, true)?;
    Ok(token)
}

pub async fn refresh(
    client: &reqwest::Client,
    refresh_token: &str,
    client_id: &str,
    client_secret: &str,
) -> anyhow::Result<GoogleTokenResponse> {
    let request = client.post(GOOGLE_TOKEN_URL).form(&[
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ]);
    let response = tokio::time::timeout(Duration::from_secs(20), request.send())
        .await
        .context("Google token refresh timed out")??;
    if !response.status().is_success() {
        bail!("Google rejected the connector refresh token.");
    }
    let token: GoogleTokenResponse = response
        .json()
        .await
        .context("invalid Google refresh response")?;
    validate_token(&token, false)?;
    Ok(token)
}

pub async fn revoke(client: &reqwest::Client, token: &str) {
    let request = client.post(GOOGLE_REVOCATION_URL).form(&[("token", token)]);
    let _ = tokio::time::timeout(Duration::from_secs(10), request.send()).await;
}

fn validate_token(token: &GoogleTokenResponse, require_refresh: bool) -> anyhow::Result<()> {
    if token.access_token.is_empty()
        || token.access_token.len() > 16_384
        || !token.token_type.eq_ignore_ascii_case("bearer")
        || !(60..=86_400).contains(&token.expires_in)
        || (require_refresh && token.refresh_token.as_deref().is_none_or(str::is_empty))
        || token
            .refresh_token
            .as_deref()
            .is_some_and(|value| value.len() > 16_384)
    {
        bail!("Google returned an invalid connector token response.");
    }
    if let Some(scope) = &token.scope
        && !scope
            .split_ascii_whitespace()
            .any(|value| value == "https://www.googleapis.com/auth/gmail.modify")
    {
        bail!("Google did not grant the required Gmail scope.");
    }
    Ok(())
}

fn random_secret(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    rand::rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_uses_pkce_and_separate_connector_client() {
        let definition = super::super::catalog::by_key("gmail").expect("gmail");
        let value = start(
            definition,
            "https://api.example.com/v1/connectors/oauth/callback",
            "connector-client",
        )
        .expect("start");
        let url = Url::parse(&value.authorization_url).expect("url");
        let query: std::collections::BTreeMap<_, _> = url.query_pairs().collect();
        assert_eq!(
            query.get("client_id").map(AsRef::as_ref),
            Some("connector-client")
        );
        assert_eq!(
            query.get("code_challenge_method").map(AsRef::as_ref),
            Some("S256")
        );
        assert_ne!(value.state, value.secrets.verifier);
    }
}
