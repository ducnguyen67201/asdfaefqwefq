use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::{
    auth::User,
    error::{ApiError, ApiResult},
};

const GOOGLE_JWKS: &str = "https://www.googleapis.com/oauth2/v3/certs";
#[derive(Clone)]
pub struct GoogleVerifier {
    client: reqwest::Client,
    cache: Arc<RwLock<Option<(Instant, JwkSet)>>>,
    jwks_url: String,
}
#[derive(Debug, Deserialize)]
struct Claims {
    sub: String,
    email: String,
    email_verified: bool,
    name: Option<String>,
    iss: String,
    aud: serde_json::Value,
    exp: usize,
    iat: usize,
}

impl GoogleVerifier {
    #[must_use]
    pub fn new(client: reqwest::Client) -> Self {
        Self::new_with_endpoint(client, GOOGLE_JWKS)
    }

    #[doc(hidden)]
    #[must_use]
    pub fn new_with_endpoint(client: reqwest::Client, jwks_url: &str) -> Self {
        Self {
            client,
            cache: Arc::new(RwLock::new(None)),
            jwks_url: jwks_url.to_owned(),
        }
    }
    async fn keys(&self, force: bool) -> ApiResult<JwkSet> {
        if !force
            && let Some((at, keys)) = &*self.cache.read().await
            && at.elapsed() < Duration::from_secs(3600)
        {
            return Ok(keys.clone());
        }
        let keys = self
            .client
            .get(&self.jwks_url)
            .header("accept", "application/json")
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(ApiError::internal)?
            .error_for_status()
            .map_err(ApiError::internal)?
            .json::<JwkSet>()
            .await
            .map_err(ApiError::internal)?;
        *self.cache.write().await = Some((Instant::now(), keys.clone()));
        Ok(keys)
    }
    pub async fn verify(&self, token: &str, client_id: &str) -> ApiResult<User> {
        if token.is_empty() || token.len() > 16_384 {
            return Err(ApiError::internal(anyhow::anyhow!(
                "Google identity token is invalid."
            )));
        }
        let header = decode_header(token).map_err(ApiError::internal)?;
        if header.alg != Algorithm::RS256 {
            return Err(ApiError::internal(anyhow::anyhow!(
                "Google identity token claims are invalid."
            )));
        }
        let kid = header.kid.ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!(
                "Google identity token signing key missing."
            ))
        })?;
        let mut keys = self.keys(false).await?;
        let mut jwk = keys.find(&kid);
        if jwk.is_none() {
            keys = self.keys(true).await?;
            jwk = keys.find(&kid);
        }
        let jwk = jwk.ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!(
                "Google identity signing key was not found."
            ))
        })?;
        let key = DecodingKey::from_jwk(jwk).map_err(ApiError::internal)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[client_id]);
        validation.set_issuer(&["accounts.google.com", "https://accounts.google.com"]);
        validation.set_required_spec_claims(&["exp", "iss", "aud"]);
        validation.leeway = 30;
        let claims = decode::<Claims>(token, &key, &validation)
            .map_err(ApiError::internal)?
            .claims;
        let now = usize::try_from(time::OffsetDateTime::now_utc().unix_timestamp())
            .map_err(ApiError::internal)?;
        let _ = (&claims.iss, &claims.aud, claims.exp);
        if claims.iat > now.saturating_add(300)
            || !claims.email_verified
            || claims.sub.is_empty()
            || claims.email.is_empty()
        {
            return Err(ApiError::internal(anyhow::anyhow!(
                "Google identity token claims are invalid."
            )));
        }
        let name = claims
            .name
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                claims
                    .email
                    .split('@')
                    .next()
                    .unwrap_or(&claims.email)
                    .to_owned()
            });
        Ok(User {
            id: claims.sub,
            email: claims.email,
            name,
        })
    }
}
