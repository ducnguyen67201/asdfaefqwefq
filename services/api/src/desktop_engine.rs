use std::io::{self, BufRead, Write};
use std::time::Duration;

use anyhow::Context;
use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD},
};
use reqwest::blocking::multipart;
use serde::Deserialize;
use serde_json::{Value, json};
use url::Url;
use uuid::Uuid;

use crate::agent::{compile_intent_authorization, evaluate_action};

const MAX_REQUEST_BYTES: usize = 1_000_000;
const MAX_VOICE_RESPONSE_BYTES: usize = 1_000_000;
const MAX_AUDIO_BASE64_BYTES: usize = 750_000;
const MAX_AUDIO_BYTES: usize = 562_500;
const VOICE_MODEL: &str = "gpt-transcribe";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

pub fn run() -> anyhow::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    run_protocol(stdin.lock(), stdout.lock())
}

fn run_protocol(reader: impl BufRead, mut writer: impl Write) -> anyhow::Result<()> {
    for line in reader.lines() {
        let line = line.context("Could not read a Rust desktop engine request.")?;
        let response = if line.len() > MAX_REQUEST_BYTES {
            error_response(None, "The Rust desktop engine request is too large.")
        } else {
            handle_line(&line)
        };
        serde_json::to_writer(&mut writer, &response)?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }
    Ok(())
}

fn handle_line(line: &str) -> Value {
    let request = match serde_json::from_str::<Request>(line) {
        Ok(request) => request,
        Err(_) => return error_response(None, "The Rust desktop engine request is invalid."),
    };
    if Uuid::parse_str(&request.id).is_err() {
        return error_response(None, "The Rust desktop engine request ID is invalid.");
    }
    let id = request.id.clone();
    let result = match request.method.as_str() {
        "health" if request.params == json!({}) || request.params.is_null() => Ok(json!({
            "engine": "rust",
            "protocolVersion": 1,
            "features": ["intent_authorization", "desktop_policy", "google_oauth", "voice"]
        })),
        "policy.evaluate_action" => serde_json::from_value(request.params)
            .context("The desktop policy request is invalid.")
            .and_then(evaluate_action)
            .and_then(|value| serde_json::to_value(value).map_err(Into::into)),
        "intent.compile" => compile_intent(&request.params),
        "oauth.google_exchange" => exchange_google_oauth_code(&request.params),
        "voice.transcribe" => transcribe_voice(&request.params),
        "voice.validate_credential" => validate_voice_credential(&request.params),
        _ => Err(anyhow::anyhow!(
            "The Rust desktop engine method is unavailable."
        )),
    };
    match result {
        Ok(result) => json!({"id": id, "ok": true, "result": result}),
        Err(error) => error_response(Some(id), &error.to_string()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GoogleOauthExchangeInput {
    client_id: String,
    code: String,
    code_verifier: String,
    expected_nonce: String,
    redirect_uri: String,
}

fn exchange_google_oauth_code(params: &Value) -> anyhow::Result<Value> {
    let input: GoogleOauthExchangeInput = serde_json::from_value(params.clone())
        .context("The Google OAuth exchange request is invalid.")?;
    input.validate()?;
    let mut form = vec![
        ("client_id", input.client_id.as_str()),
        ("code", input.code.as_str()),
        ("code_verifier", input.code_verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", input.redirect_uri.as_str()),
    ];
    let client_secret = std::env::var("GOOGLE_OAUTH_CLIENT_SECRET")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if let Some(secret) = client_secret.as_deref() {
        form.push(("client_secret", secret));
    }
    let response = voice_client()?
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .context("Google could not complete sign-in.")?;
    if !response.status().is_success() {
        anyhow::bail!("Google could not complete sign-in. Please try again.");
    }
    let body = bounded_json(response)?;
    let id_token = body
        .get("id_token")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 16_384)
        .context("Google returned an invalid identity token.")?;
    validate_google_nonce(id_token, &input.expected_nonce)?;
    Ok(json!({ "idToken": id_token }))
}

impl GoogleOauthExchangeInput {
    fn validate(&self) -> anyhow::Result<()> {
        let redirect =
            Url::parse(&self.redirect_uri).context("The Google OAuth redirect URI is invalid.")?;
        if self.client_id.is_empty()
            || self.client_id.len() > 1_024
            || self.code.is_empty()
            || self.code.len() > 8_000
            || !(43..=128).contains(&self.code_verifier.len())
            || !(16..=256).contains(&self.expected_nonce.len())
            || self
                .code_verifier
                .bytes()
                .any(|byte| byte.is_ascii_control())
            || self
                .expected_nonce
                .bytes()
                .any(|byte| byte.is_ascii_control())
            || redirect.scheme() != "http"
            || redirect.host_str() != Some("127.0.0.1")
            || redirect.port().is_none()
            || redirect.path() != "/oauth2/callback"
            || redirect.query().is_some()
            || redirect.fragment().is_some()
            || !redirect.username().is_empty()
            || redirect.password().is_some()
        {
            anyhow::bail!("The Google OAuth exchange request is invalid.");
        }
        Ok(())
    }
}

fn validate_google_nonce(id_token: &str, expected_nonce: &str) -> anyhow::Result<()> {
    let mut parts = id_token.split('.');
    let _header = parts.next();
    let payload = parts
        .next()
        .context("Google returned a malformed identity token.")?;
    let signature = parts
        .next()
        .context("Google returned a malformed identity token.")?;
    if parts.next().is_some() || signature.is_empty() {
        anyhow::bail!("Google returned a malformed identity token.");
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .context("Google returned a malformed identity token.")?;
    let claims: Value =
        serde_json::from_slice(&decoded).context("Google returned a malformed identity token.")?;
    if claims.get("nonce").and_then(Value::as_str) != Some(expected_nonce) {
        anyhow::bail!("Google identity token nonce is invalid.");
    }
    Ok(())
}

fn transcribe_voice(params: &Value) -> anyhow::Result<Value> {
    let input: VoiceTranscriptionInput = serde_json::from_value(params.clone())
        .context("The voice transcription request is invalid.")?;
    input.validate()?;
    let client = voice_client()?;
    let response = if input.api_base_url.is_empty() {
        let audio = BASE64
            .decode(input.audio_base64.as_bytes())
            .context("The voice audio is not valid base64.")?;
        if audio.is_empty() || audio.len() > MAX_AUDIO_BYTES {
            anyhow::bail!("The voice audio size is invalid.");
        }
        let form = multipart::Form::new()
            .part(
                "file",
                multipart::Part::bytes(audio)
                    .file_name("segment.wav")
                    .mime_str("audio/wav")?,
            )
            .text("model", VOICE_MODEL.to_owned())
            .text("languages[]", input.language.clone());
        client
            .post("https://api.openai.com/v1/audio/transcriptions")
            .bearer_auth(&input.credential)
            .multipart(form)
            .send()
            .context("Tro could not reach voice transcription.")?
    } else {
        let endpoint = hosted_endpoint(&input.api_base_url, "/v1/openai/audio/transcriptions")?;
        client
            .post(endpoint)
            .bearer_auth(&input.credential)
            .header("X-Trocode-Request-Id", input.request_id.to_string())
            .header("X-Trocode-Transcription-Contract", "2")
            .json(&json!({
                "audioBase64": input.audio_base64,
                "clientDurationMs": input.client_duration_ms,
                "language": input.language,
                "utteranceId": input.utterance_id,
            }))
            .send()
            .context("Tro could not reach voice transcription.")?
    };
    let status = response.status();
    let mut body = bounded_json(response)?;
    if status.is_success() && input.api_base_url.is_empty() {
        let text = body
            .get("text")
            .and_then(Value::as_str)
            .filter(|value| value.chars().count() <= 8_000)
            .context("Voice transcription returned an invalid response.")?;
        body = json!({
            "audioDurationMs": input.client_duration_ms,
            "billedSeconds": f64::from(input.client_duration_ms) / 1_000.0,
            "model": VOICE_MODEL,
            "text": text,
        });
    }
    Ok(json!({ "status": status.as_u16(), "body": body }))
}

fn validate_voice_credential(params: &Value) -> anyhow::Result<Value> {
    let object = params
        .as_object()
        .context("The voice credential request must be an object.")?;
    if object.len() != 1 || !object.contains_key("apiKey") {
        anyhow::bail!("The voice credential request is invalid.");
    }
    let api_key = bounded_credential(params.get("apiKey"))?;
    let response = voice_client()?
        .get(format!("https://api.openai.com/v1/models/{VOICE_MODEL}"))
        .bearer_auth(api_key)
        .send()
        .context("Tro could not validate OpenAI GPT Transcribe access.")?;
    let status = response.status();
    let body = bounded_json(response)?;
    if status.is_success() && body.get("id").and_then(Value::as_str) != Some(VOICE_MODEL) {
        anyhow::bail!("OpenAI returned an invalid voice model response.");
    }
    Ok(json!({ "status": status.as_u16(), "body": body }))
}

fn voice_client() -> anyhow::Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("Could not initialize the Rust voice client.")
}

fn hosted_endpoint(base_url: &str, path: &str) -> anyhow::Result<Url> {
    let url = Url::parse(base_url).context("The hosted voice URL is invalid.")?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost"));
    if (url.scheme() != "https" && !local)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        anyhow::bail!("The hosted voice URL is invalid.");
    }
    Url::parse(&format!("{}{path}", base_url.trim_end_matches('/')))
        .context("The hosted voice endpoint is invalid.")
}

fn bounded_json(response: reqwest::blocking::Response) -> anyhow::Result<Value> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_VOICE_RESPONSE_BYTES as u64)
    {
        anyhow::bail!("Voice response exceeded the size limit.");
    }
    let bytes = response
        .bytes()
        .context("Could not read the voice response.")?;
    if bytes.len() > MAX_VOICE_RESPONSE_BYTES {
        anyhow::bail!("Voice response exceeded the size limit.");
    }
    serde_json::from_slice(&bytes).context("Voice transcription returned an invalid response.")
}

fn bounded_credential(value: Option<&Value>) -> anyhow::Result<&str> {
    let credential = value
        .and_then(Value::as_str)
        .map(str::trim)
        .context("The voice credential is invalid.")?;
    validate_credential(credential)?;
    Ok(credential)
}

fn validate_credential(credential: &str) -> anyhow::Result<()> {
    if !(16..=4_096).contains(&credential.len())
        || credential.bytes().any(|byte| byte.is_ascii_control())
    {
        anyhow::bail!("The voice credential is invalid.");
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VoiceTranscriptionInput {
    api_base_url: String,
    credential: String,
    audio_base64: String,
    client_duration_ms: u32,
    language: String,
    request_id: Uuid,
    utterance_id: Uuid,
}

impl VoiceTranscriptionInput {
    fn validate(&self) -> anyhow::Result<()> {
        validate_credential(&self.credential)?;
        if !(60..=MAX_AUDIO_BASE64_BYTES).contains(&self.audio_base64.len())
            || !self.audio_base64.len().is_multiple_of(4)
            || !(300..=15_000).contains(&self.client_duration_ms)
            || !matches!(
                self.language.as_str(),
                "ar" | "de"
                    | "en"
                    | "es"
                    | "fr"
                    | "hi"
                    | "id"
                    | "it"
                    | "ja"
                    | "ko"
                    | "ms"
                    | "nl"
                    | "pl"
                    | "pt"
                    | "ru"
                    | "th"
                    | "tr"
                    | "uk"
                    | "vi"
                    | "zh"
            )
        {
            anyhow::bail!("The voice transcription request is invalid.");
        }
        if !self.api_base_url.is_empty() {
            hosted_endpoint(&self.api_base_url, "/v1/openai/audio/transcriptions")?;
        }
        Ok(())
    }
}

fn compile_intent(params: &Value) -> anyhow::Result<Value> {
    let object = params
        .as_object()
        .context("The intent compiler request must be an object.")?;
    if object.len() != 3
        || object
            .keys()
            .any(|key| !matches!(key.as_str(), "request" | "executionProfile" | "revision"))
    {
        anyhow::bail!("The intent compiler request is invalid.");
    }
    let request = params
        .get("request")
        .and_then(Value::as_str)
        .filter(|value| (2..=8_000).contains(&value.chars().count()))
        .context("The intent compiler request text is invalid.")?;
    let execution_profile = params
        .get("executionProfile")
        .and_then(Value::as_str)
        .context("The intent compiler execution profile is invalid.")?;
    let revision = params
        .get("revision")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .context("The intent compiler revision is invalid.")?;
    Ok(serde_json::to_value(compile_intent_authorization(
        request,
        execution_profile,
        revision,
    )?)?)
}

fn error_response(id: Option<String>, message: &str) -> Value {
    json!({
        "id": id,
        "ok": false,
        "error": { "message": message.chars().take(1_000).collect::<String>() }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_round_trip_is_bounded_json_lines() {
        let id = Uuid::new_v4();
        let input = format!("{{\"id\":\"{id}\",\"method\":\"health\",\"params\":{{}}}}\n");
        let mut output = Vec::new();
        run_protocol(input.as_bytes(), &mut output).expect("protocol");
        let value: Value = serde_json::from_slice(&output).expect("response");
        assert_eq!(value["id"], id.to_string());
        assert_eq!(value["ok"], true);
        assert_eq!(value["result"]["engine"], "rust");
    }

    #[test]
    fn malformed_requests_fail_without_stopping_the_protocol() {
        let id = Uuid::new_v4();
        let input =
            format!("not-json\n{{\"id\":\"{id}\",\"method\":\"health\",\"params\":{{}}}}\n");
        let mut output = Vec::new();
        run_protocol(input.as_bytes(), &mut output).expect("protocol");
        let lines = String::from_utf8(output).expect("utf8");
        assert_eq!(lines.lines().count(), 2);
        assert!(
            lines
                .lines()
                .next()
                .expect("first")
                .contains("\"ok\":false")
        );
        assert!(
            lines
                .lines()
                .nth(1)
                .expect("second")
                .contains("\"ok\":true")
        );
    }

    #[test]
    fn google_oauth_nonce_and_loopback_redirect_are_bound() {
        let input = GoogleOauthExchangeInput {
            client_id: "desktop.apps.googleusercontent.com".to_owned(),
            code: "authorization-code".to_owned(),
            code_verifier: "v".repeat(64),
            expected_nonce: "n".repeat(32),
            redirect_uri: "http://127.0.0.1:43210/oauth2/callback".to_owned(),
        };
        input.validate().expect("valid loopback exchange");
        let payload = URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&json!({"nonce": &input.expected_nonce})).expect("claims"));
        let token = format!("header.{payload}.signature");
        validate_google_nonce(&token, &"n".repeat(32)).expect("matching nonce");
        assert!(validate_google_nonce(&token, &"x".repeat(32)).is_err());

        let invalid = GoogleOauthExchangeInput {
            redirect_uri: "https://example.com/oauth2/callback".to_owned(),
            ..input
        };
        assert!(invalid.validate().is_err());
    }
}
