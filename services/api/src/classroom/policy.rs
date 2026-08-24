use std::net::IpAddr;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use url::Url;
use uuid::Uuid;

use crate::error::ApiError;

use super::DirectiveInput;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug)]
pub struct DirectiveDecision {
    pub delivery: &'static str,
    pub origin: Option<String>,
    pub url: Option<String>,
}

pub fn room_code_digest(code: &str, hmac_key: &[u8]) -> [u8; 32] {
    hmac_digest(hmac_key, code.trim().to_uppercase().as_bytes())
}

pub fn deterministic_room_code(hmac_key: &[u8], run_id: Uuid, client_id: Uuid) -> String {
    let source = format!("live-room:{run_id}:{client_id}");
    let digest = hmac_digest(hmac_key, source.as_bytes());
    let mut compact: String = URL_SAFE_NO_PAD
        .encode(digest)
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(12)
        .flat_map(char::to_uppercase)
        .collect();
    compact.push_str("XXXXXXXXXXXX");
    compact.truncate(12);
    format!(
        "TRO-{}-{}-{}",
        &compact[0..4],
        &compact[4..8],
        &compact[8..12]
    )
}

pub fn directive_delivery(
    directive: &DirectiveInput,
    allowed_origins: &[String],
) -> Result<DirectiveDecision, ApiError> {
    let DirectiveInput::OpenUrl { url, .. } = directive else {
        return Ok(DirectiveDecision {
            delivery: "manual_only",
            origin: None,
            url: None,
        });
    };
    let parsed = public_https_url(url).ok_or(ApiError::bad_request(
        "directive_url_invalid",
        "Use a public HTTPS URL without embedded credentials.",
    ))?;
    let origin = parsed.origin().ascii_serialization();
    Ok(DirectiveDecision {
        delivery: if allowed_origins.iter().any(|allowed| allowed == &origin) {
            "auto_eligible"
        } else {
            "manual_only"
        },
        origin: Some(origin),
        url: Some(parsed.to_string()),
    })
}

pub fn validated_origin(value: &str) -> Option<String> {
    let parsed = public_https_url(value)?;
    let origin = parsed.origin().ascii_serialization();
    (origin == value).then_some(origin)
}

fn public_https_url(value: &str) -> Option<Url> {
    let parsed = Url::parse(value).ok()?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !is_public_hostname(parsed.host_str()?)
    {
        return None;
    }
    Some(parsed)
}

fn is_public_hostname(hostname: &str) -> bool {
    let normalized = hostname
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if normalized == "localhost"
        || normalized.ends_with(".localhost")
        || normalized.ends_with(".local")
        || normalized.ends_with(".internal")
        || normalized.ends_with(".lan")
        || normalized == "host.docker.internal"
    {
        return false;
    }
    let Ok(address) = normalized.parse::<IpAddr>() else {
        return true;
    };
    match address {
        IpAddr::V4(value) => {
            let [first, second, ..] = value.octets();
            !(first == 0
                || first == 10
                || first == 127
                || (first == 169 && second == 254)
                || (first == 172 && (16..=31).contains(&second))
                || (first == 192 && second == 168)
                || first >= 224)
        }
        IpAddr::V6(value) => {
            let first = value.segments()[0];
            !value.is_unspecified()
                && !value.is_loopback()
                && value.to_ipv4_mapped().is_none()
                && first & 0xfe00 != 0xfc00
                && first & 0xffc0 != 0xfe80
                && first & 0xff00 != 0xff00
        }
    }
}

pub(super) fn hmac_digest(key: &[u8], value: &[u8]) -> [u8; 32] {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts keys of any size");
    mac.update(value);
    mac.finalize().into_bytes().into()
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::{deterministic_room_code, directive_delivery, room_code_digest};
    use crate::classroom::DirectiveInput;

    #[test]
    fn room_codes_are_deterministic_and_only_digests_are_persisted() {
        let run_id = Uuid::parse_str("00000000-0000-4000-8000-000000000001").unwrap();
        let client_id = Uuid::parse_str("00000000-0000-4000-8000-000000000002").unwrap();
        let key = b"test-key-that-is-at-least-32-bytes";
        let first = deterministic_room_code(key, run_id, client_id);
        let second = deterministic_room_code(key, run_id, client_id);
        assert_eq!(first, second);
        assert_eq!(first.len(), 18);
        assert!(first.starts_with("TRO-"));
        assert_eq!(room_code_digest(&first.to_lowercase(), key).len(), 32);
    }

    #[test]
    fn directives_only_auto_open_for_exact_allowed_public_origins() {
        let allowed = vec!["https://learn.example.com".to_owned()];
        let directive = DirectiveInput::OpenUrl {
            instruction: "Open the lesson".to_owned(),
            criterion_ids: vec![],
            url: "https://learn.example.com/loops?day=1".to_owned(),
        };
        let decision = directive_delivery(&directive, &allowed).unwrap();
        assert_eq!(decision.delivery, "auto_eligible");
        assert_eq!(
            decision.origin.as_deref(),
            Some("https://learn.example.com")
        );

        for value in [
            "https://127.0.0.1/work",
            "https://[fe90::1]/work",
            "https://[ff02::1]/work",
            "https://user:secret@example.com/work",
        ] {
            let directive = DirectiveInput::OpenUrl {
                instruction: "Open".to_owned(),
                criterion_ids: vec![],
                url: value.to_owned(),
            };
            assert_eq!(
                directive_delivery(&directive, &allowed)
                    .expect_err("private URL must fail")
                    .code,
                Some("directive_url_invalid")
            );
        }
    }
}
