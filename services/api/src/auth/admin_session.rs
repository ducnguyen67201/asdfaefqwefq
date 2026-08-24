use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

pub const ADMIN_SESSION_COOKIE_NAME: &str = "trocode_admin_session";
pub const ADMIN_SESSION_MAX_AGE_SECONDS: i64 = 30 * 24 * 60 * 60;

fn signature(payload: &str, token: &str) -> Option<String> {
    if token.len() < 32 {
        return None;
    }
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(token.as_bytes()).ok()?;
    mac.update(b"trocode-admin-browser-session-v1\0");
    mac.update(payload.as_bytes());
    Some(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

pub fn issue_admin_session(token: &str, now_seconds: i64) -> Option<String> {
    let payload = format!(
        "v1.{}",
        now_seconds.saturating_add(ADMIN_SESSION_MAX_AGE_SECONDS)
    );
    Some(format!("{payload}.{}", signature(&payload, token)?))
}

pub fn verify_admin_session(value: &str, token: &str, now_seconds: i64) -> bool {
    if value.len() > 256 {
        return false;
    }
    let mut parts = value.split('.');
    let (Some("v1"), Some(expiry), Some(actual), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let Ok(expiry) = expiry.parse::<i64>() else {
        return false;
    };
    if expiry <= now_seconds || actual.len() != 43 {
        return false;
    }
    let payload = format!("v1.{expiry}");
    let Some(expected) = signature(&payload, token) else {
        return false;
    };
    actual.as_bytes().ct_eq(expected.as_bytes()).into()
}

pub fn admin_session_from_cookie(header: &str) -> Option<&str> {
    if header.len() > 8_192 {
        return None;
    }
    header
        .split(';')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("trocode_admin_session="))
}

pub fn set_admin_session_cookie(value: &str) -> String {
    format!(
        "{ADMIN_SESSION_COOKIE_NAME}={value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age={ADMIN_SESSION_MAX_AGE_SECONDS}"
    )
}

pub fn clear_admin_session_cookie() -> &'static str {
    "trocode_admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_expires_and_cookie_is_hardened() {
        let key = "test-admin-token-that-is-longer-than-thirty-two-characters";
        let session = issue_admin_session(key, 1_000).expect("session");
        assert!(verify_admin_session(&session, key, 1_000));
        assert!(!verify_admin_session(
            &session,
            key,
            1_000 + ADMIN_SESSION_MAX_AGE_SECONDS
        ));
        let cookie = set_admin_session_cookie(&session);
        assert!(cookie.contains("HttpOnly; Secure; SameSite=Strict"));
    }
}
