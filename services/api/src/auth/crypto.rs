use std::collections::BTreeMap;

use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, Payload},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;

use crate::error::{ApiError, ApiResult};

const SEALED_SECRET_VERSION: u8 = 1;
const IV_BYTES: usize = 12;
const TAG_BYTES: usize = 16;

fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> ApiResult<[u8; 32]> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).map_err(ApiError::internal)?;
    for part in parts {
        mac.update(part);
    }
    Ok(mac.finalize().into_bytes().into())
}

pub fn normalize_access_code(value: &str) -> Option<String> {
    let normalized = value.trim().to_uppercase();
    let valid = (4..=64).contains(&normalized.len())
        && normalized.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_uppercase()
                || byte.is_ascii_digit()
                || (index > 0 && matches!(byte, b'_' | b'-'))
        });
    valid.then_some(normalized)
}

pub fn digest_access_code(value: &str, hmac_key: &str) -> ApiResult<Option<[u8; 32]>> {
    let Some(normalized) = normalize_access_code(value) else {
        return Ok(None);
    };
    hmac_sha256(
        hmac_key.as_bytes(),
        &[b"trocode-access-code-v1\0", normalized.as_bytes()],
    )
    .map(Some)
}

fn secret_key(hmac_key: &str, domain: &[u8]) -> ApiResult<[u8; 32]> {
    if hmac_key.len() < 32 {
        return Err(ApiError::internal(anyhow::anyhow!(
            "Secret encryption requires a strong server key."
        )));
    }
    hmac_sha256(hmac_key.as_bytes(), &[domain])
}

fn seal_secret(
    cleartext: &str,
    hmac_key: &str,
    digest: &[u8; 32],
    domain: &[u8],
) -> ApiResult<Vec<u8>> {
    let cipher =
        Aes256Gcm::new_from_slice(&secret_key(hmac_key, domain)?).map_err(ApiError::internal)?;
    let mut iv = [0_u8; IV_BYTES];
    rand::rng().fill_bytes(&mut iv);
    let mut encrypted = cipher
        .encrypt(
            (&iv).into(),
            Payload {
                msg: cleartext.as_bytes(),
                aad: digest,
            },
        )
        .map_err(|_| ApiError::internal(anyhow::anyhow!("Could not encrypt secret.")))?;
    let tag = encrypted.split_off(encrypted.len().saturating_sub(TAG_BYTES));
    let mut output = Vec::with_capacity(1 + IV_BYTES + TAG_BYTES + encrypted.len());
    output.push(SEALED_SECRET_VERSION);
    output.extend_from_slice(&iv);
    output.extend_from_slice(&tag);
    output.extend_from_slice(&encrypted);
    Ok(output)
}

fn open_secret(
    sealed: &[u8],
    hmac_key: &str,
    digest: &[u8; 32],
    domain: &[u8],
) -> ApiResult<String> {
    if sealed.len() < 1 + IV_BYTES + TAG_BYTES + 1 || sealed[0] != SEALED_SECRET_VERSION {
        return Err(ApiError::internal(anyhow::anyhow!(
            "Could not authenticate secret ciphertext."
        )));
    }
    let iv = &sealed[1..1 + IV_BYTES];
    let tag = &sealed[1 + IV_BYTES..1 + IV_BYTES + TAG_BYTES];
    let ciphertext = &sealed[1 + IV_BYTES + TAG_BYTES..];
    let mut combined = Vec::from(ciphertext);
    combined.extend_from_slice(tag);
    let cipher =
        Aes256Gcm::new_from_slice(&secret_key(hmac_key, domain)?).map_err(ApiError::internal)?;
    let clear = cipher
        .decrypt(
            iv.into(),
            Payload {
                msg: &combined,
                aad: digest,
            },
        )
        .map_err(|_| ApiError::internal(anyhow::anyhow!("Could not authenticate secret.")))?;
    String::from_utf8(clear).map_err(ApiError::internal)
}

pub fn seal_access_code(code: &str, hmac_key: &str, digest: &[u8; 32]) -> ApiResult<Vec<u8>> {
    seal_secret(
        code,
        hmac_key,
        digest,
        b"trocode-access-code-encryption-v1\0",
    )
}

pub fn open_access_code(sealed: &[u8], hmac_key: &str, digest: &[u8; 32]) -> ApiResult<String> {
    open_secret(
        sealed,
        hmac_key,
        digest,
        b"trocode-access-code-encryption-v1\0",
    )
}

pub fn seal_invite_code(code: &str, hmac_key: &str, digest: &[u8; 32]) -> ApiResult<Vec<u8>> {
    seal_secret(
        code,
        hmac_key,
        digest,
        b"trocode-space-invite-encryption-v1\0",
    )
}

pub fn open_invite_code(sealed: &[u8], hmac_key: &str, digest: &[u8; 32]) -> ApiResult<String> {
    open_secret(
        sealed,
        hmac_key,
        digest,
        b"trocode-space-invite-encryption-v1\0",
    )
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEnvelope {
    #[serde(with = "base64_bytes")]
    pub ciphertext: Vec<u8>,
    #[serde(with = "base64_bytes")]
    pub iv: Vec<u8>,
    pub key_version: u32,
    #[serde(with = "base64_bytes")]
    pub tag: Vec<u8>,
}

#[derive(Clone)]
pub struct AgentStateCrypto {
    current_version: u32,
    keys: BTreeMap<u32, [u8; 32]>,
}

/// Connector credentials use the same versioned AES-GCM envelope primitive as
/// agent state, but callers must bind every value to connector-specific AAD.
/// Keeping a distinct type prevents connector tokens from being accidentally
/// decrypted through a different trust domain.
#[derive(Clone)]
pub struct ConnectorTokenCrypto(AgentStateCrypto);

impl ConnectorTokenCrypto {
    pub fn parse(value: &str, current_version: u32) -> ApiResult<Self> {
        AgentStateCrypto::parse(value, current_version).map(Self)
    }

    pub fn encrypt_json(&self, value: &Value, metadata: &Value) -> ApiResult<AgentEnvelope> {
        self.0.encrypt_json(value, metadata)
    }

    pub fn decrypt_json(&self, envelope: &AgentEnvelope, metadata: &Value) -> ApiResult<Value> {
        self.0.decrypt_json(envelope, metadata)
    }
}

impl AgentStateCrypto {
    pub fn parse(value: &str, current_version: u32) -> ApiResult<Self> {
        let mut keys = BTreeMap::new();
        for entry in value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let (version, encoded) = entry.split_once(':').ok_or_else(|| {
                ApiError::internal(anyhow::anyhow!(
                    "Agent-state keys must use version:base64 format."
                ))
            })?;
            let version: u32 = version.parse().map_err(ApiError::internal)?;
            let bytes = STANDARD.decode(encoded).map_err(ApiError::internal)?;
            let key: [u8; 32] = bytes.try_into().map_err(|_| {
                ApiError::internal(anyhow::anyhow!(
                    "Agent-state encryption keys must be 32 bytes."
                ))
            })?;
            if version == 0 || keys.insert(version, key).is_some() {
                return Err(ApiError::internal(anyhow::anyhow!(
                    "Agent-state key versions must be unique positive integers."
                )));
            }
        }
        if !keys.contains_key(&current_version) {
            return Err(ApiError::internal(anyhow::anyhow!(
                "The current agent-state key version is unavailable."
            )));
        }
        Ok(Self {
            current_version,
            keys,
        })
    }

    pub fn encrypt_json(&self, value: &Value, metadata: &Value) -> ApiResult<AgentEnvelope> {
        let key = self.keys.get(&self.current_version).expect("validated");
        let mut iv = [0_u8; IV_BYTES];
        rand::rng().fill_bytes(&mut iv);
        let aad = stable_json(metadata)?;
        let message = serde_json::to_vec(value).map_err(ApiError::internal)?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(ApiError::internal)?;
        let mut encrypted = cipher
            .encrypt(
                (&iv).into(),
                Payload {
                    msg: &message,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| ApiError::internal(anyhow::anyhow!("Agent state encryption failed.")))?;
        let tag = encrypted.split_off(encrypted.len().saturating_sub(TAG_BYTES));
        Ok(AgentEnvelope {
            ciphertext: encrypted,
            iv: iv.to_vec(),
            key_version: self.current_version,
            tag,
        })
    }

    pub fn decrypt_json(&self, envelope: &AgentEnvelope, metadata: &Value) -> ApiResult<Value> {
        let key = self.keys.get(&envelope.key_version).ok_or_else(|| {
            ApiError::internal(anyhow::anyhow!(
                "Agent-state key version {} is unavailable.",
                envelope.key_version
            ))
        })?;
        if envelope.iv.len() != IV_BYTES || envelope.tag.len() != TAG_BYTES {
            return Err(ApiError::internal(anyhow::anyhow!(
                "Agent state envelope is invalid."
            )));
        }
        let mut combined = envelope.ciphertext.clone();
        combined.extend_from_slice(&envelope.tag);
        let aad = stable_json(metadata)?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(ApiError::internal)?;
        let clear = cipher
            .decrypt(
                envelope.iv.as_slice().into(),
                Payload {
                    msg: &combined,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| {
                ApiError::internal(anyhow::anyhow!("Agent state authentication failed."))
            })?;
        serde_json::from_slice(&clear).map_err(ApiError::internal)
    }
}

pub fn stable_json(value: &Value) -> ApiResult<String> {
    match value {
        Value::Array(items) => Ok(format!(
            "[{}]",
            items
                .iter()
                .map(stable_json)
                .collect::<ApiResult<Vec<_>>>()?
                .join(",")
        )),
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort_unstable();
            let entries = keys
                .into_iter()
                .map(|key| {
                    Ok(format!(
                        "{}:{}",
                        serde_json::to_string(key).map_err(ApiError::internal)?,
                        stable_json(&map[key])?
                    ))
                })
                .collect::<ApiResult<Vec<_>>>()?;
            Ok(format!("{{{}}}", entries.join(",")))
        }
        _ => serde_json::to_string(value).map_err(ApiError::internal),
    }
}

mod base64_bytes {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&STANDARD.encode(value))
    }
    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        STANDARD.decode(value).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_cipher_round_trips() {
        let key = "test-access-code-cipher-key-that-is-at-least-32-characters";
        let digest = [7_u8; 32];
        let sealed = seal_access_code("TRO-SECRET-CODE", key, &digest).expect("seal");
        assert_eq!(
            open_access_code(&sealed, key, &digest).expect("open"),
            "TRO-SECRET-CODE"
        );
        assert!(open_access_code(&sealed, key, &[8_u8; 32]).is_err());
    }

    #[test]
    fn invite_cipher_round_trips_with_a_separate_key_domain() {
        let key = "test-space-invite-cipher-key-that-is-at-least-32-characters";
        let digest = [9_u8; 32];
        let sealed = seal_invite_code("TROSPACE-SECRET", key, &digest).expect("seal");
        assert_eq!(
            open_invite_code(&sealed, key, &digest).expect("open"),
            "TROSPACE-SECRET"
        );
        assert!(open_access_code(&sealed, key, &digest).is_err());
    }

    #[test]
    fn stable_json_sorts_recursively() {
        let value = serde_json::json!({"z": 1, "a": {"d": 2, "b": 3}});
        assert_eq!(
            stable_json(&value).expect("json"),
            "{\"a\":{\"b\":3,\"d\":2},\"z\":1}"
        );
    }

    #[test]
    fn connector_cipher_is_bound_to_connector_metadata() {
        let crypto =
            ConnectorTokenCrypto::parse("1:eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg=", 1)
                .expect("connector key");
        let first = serde_json::json!({"kind":"connector_tokens","connectionId":"one"});
        let second = serde_json::json!({"kind":"connector_tokens","connectionId":"two"});
        let envelope = crypto
            .encrypt_json(&serde_json::json!({"accessToken":"secret"}), &first)
            .expect("encrypt");
        assert!(crypto.decrypt_json(&envelope, &first).is_ok());
        assert!(crypto.decrypt_json(&envelope, &second).is_err());
    }
}
