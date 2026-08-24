use std::time::{Duration, Instant};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    usage::{BudgetService, ProviderUsage, ReservationInput, SettlementInput},
    validation::js_string_len,
};
const URL: &str = "https://api.openai.com/v1/audio/transcriptions";
const MODEL: &str = "gpt-transcribe";
#[derive(Clone)]
pub struct TranscriptionService {
    budget: BudgetService,
    client: reqwest::Client,
    key: String,
    url: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranscriptionBody {
    pub audio_base64: String,
    pub client_duration_ms: i64,
    pub language: String,
    pub utterance_id: Uuid,
}
pub struct TranscriptionInput<'a> {
    pub body: TranscriptionBody,
    pub request_id: Uuid,
    pub safety_identifier: &'a str,
    pub user_id: &'a str,
    pub plan_id: &'a str,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionResult {
    pub audio_duration_ms: i64,
    pub billed_seconds: f64,
    pub model: &'static str,
    pub text: String,
    pub usage_source: &'static str,
}
pub struct Wav {
    pub duration_ms: f64,
}

pub(crate) fn is_supported_language(language: &str) -> bool {
    matches!(
        language,
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
}

fn transcription_text(value: &serde_json::Value) -> Option<String> {
    if let Some(languages) = value.get("languages") {
        let languages = languages.as_array()?;
        for language in languages {
            let code = language.get("code")?.as_str()?.trim();
            if code.is_empty() || js_string_len(code) > 32 {
                return None;
            }
        }
    }
    let text = value.get("text")?.as_str()?.trim();
    (js_string_len(text) <= 8_000).then(|| text.to_owned())
}
impl TranscriptionService {
    #[must_use]
    pub fn new(budget: BudgetService, client: reqwest::Client, key: &str) -> Self {
        Self::new_with_endpoint(budget, client, key, URL)
    }

    #[doc(hidden)]
    #[must_use]
    pub fn new_with_endpoint(
        budget: BudgetService,
        client: reqwest::Client,
        key: &str,
        url: &str,
    ) -> Self {
        Self {
            budget,
            client,
            key: key.to_owned(),
            url: url.to_owned(),
        }
    }
    pub async fn execute(&self, input: TranscriptionInput<'_>) -> ApiResult<TranscriptionResult> {
        let started = Instant::now();
        let audio = STANDARD.decode(&input.body.audio_base64).map_err(|_| {
            ApiError::coded(
                http::StatusCode::BAD_REQUEST,
                "invalid_audio",
                "The audio segment must be a valid bounded PCM WAV file.",
            )
        })?;
        let wav = parse_pcm_wav(&audio, Some(input.body.client_duration_ms)).map_err(|_| {
            ApiError::coded(
                http::StatusCode::BAD_REQUEST,
                "invalid_audio",
                "The audio segment must be a valid bounded PCM WAV file.",
            )
        })?;
        let reserved = self
            .budget
            .transcription_estimate_micro_usd(wav.duration_ms.ceil() as i64)?;
        self.budget
            .reserve(ReservationInput {
                agent_turn_id: None,
                catalog_version: "gpt-transcribe-duration-2026-08-18",
                lane: "transcription",
                model: MODEL,
                plan_id: input.plan_id,
                request_id: input.request_id,
                reserved_micro_usd: reserved,
                task_id: input.body.utterance_id,
                user_id: input.user_id,
            })
            .await?;
        let part = reqwest::multipart::Part::bytes(audio)
            .file_name("segment.wav")
            .mime_str("audio/wav")
            .map_err(ApiError::internal)?;
        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", MODEL)
            .text("languages[]", input.body.language);
        self.budget
            .mark_dispatched(input.user_id, input.request_id)
            .await?;
        let request = self
            .client
            .post(&self.url)
            .bearer_auth(&self.key)
            .header("openai-safety-identifier", input.safety_identifier)
            .multipart(form);
        let response = match tokio::time::timeout(Duration::from_secs(30), request.send()).await {
            Ok(Ok(value)) => value,
            Ok(Err(_)) | Err(_) => {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
                return Err(ApiError::coded(
                    http::StatusCode::BAD_GATEWAY,
                    "ambiguous_dispatch",
                    "The transcription provider is temporarily unavailable. This call was not retried.",
                ));
            }
        };
        let status = response.status();
        let bytes = match response.bytes().await {
            Ok(bytes) => bytes,
            Err(_) => {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
                return Err(ApiError::coded(
                    http::StatusCode::BAD_GATEWAY,
                    "ambiguous_response",
                    "The transcription provider returned an invalid response. This call was not retried.",
                ));
            }
        };
        if bytes.len() > 1_000_000 {
            self.budget
                .mark_uncertain(input.user_id, input.request_id)
                .await?;
            return Err(ApiError::coded(
                http::StatusCode::BAD_GATEWAY,
                "ambiguous_response",
                "The transcription provider returned an invalid response. This call was not retried.",
            ));
        }
        if !status.is_success() {
            if matches!(status.as_u16(), 400 | 401 | 403 | 404 | 422) {
                self.budget
                    .release(input.user_id, input.request_id, "rejected_before_inference")
                    .await?;
            } else {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
            }
            return Err(ApiError::coded(
                status,
                "provider_rejected",
                "The transcription provider rejected the audio request.",
            ));
        }
        let value: serde_json::Value = match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(_) => {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
                return Err(ApiError::coded(
                    http::StatusCode::BAD_GATEWAY,
                    "ambiguous_response",
                    "The transcription provider returned an invalid response. This call was not retried.",
                ));
            }
        };
        let Some(text) = transcription_text(&value) else {
            self.budget
                .mark_uncertain(input.user_id, input.request_id)
                .await?;
            return Err(ApiError::coded(
                http::StatusCode::BAD_GATEWAY,
                "ambiguous_response",
                "The transcription provider returned an invalid response. This call was not retried.",
            ));
        };
        let actual = self
            .budget
            .transcription_actual_micro_usd(wav.duration_ms / 1_000.0)?;
        let usage = ProviderUsage {
            cache_write_tokens: 0,
            cached_input_tokens: 0,
            input_tokens: 0,
            model: MODEL.to_owned(),
            output_tokens: 0,
            reasoning_tokens: 0,
        };
        self.budget
            .settle(SettlementInput {
                actual_micro_usd: actual,
                audio_duration_ms: wav.duration_ms.round() as i64,
                character_count: 0,
                duration_ms: i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
                provider_response_id: None,
                request_id: input.request_id,
                usage: &usage,
                usage_source: "actual",
                user_id: input.user_id,
            })
            .await?;
        Ok(TranscriptionResult {
            audio_duration_ms: wav.duration_ms.round() as i64,
            billed_seconds: wav.duration_ms / 1_000.0,
            model: MODEL,
            text,
            usage_source: "actual",
        })
    }
}
pub fn parse_pcm_wav(buffer: &[u8], client: Option<i64>) -> Result<Wav, &'static str> {
    if buffer.len() < 44
        || buffer.len() > 500_000
        || &buffer[0..4] != b"RIFF"
        || &buffer[8..12] != b"WAVE"
    {
        return Err("invalid wav");
    }
    let riff = u32::from_le_bytes(buffer[4..8].try_into().map_err(|_| "riff")?) as usize;
    if riff + 8 != buffer.len() {
        return Err("riff size");
    }
    let (mut offset, mut format, mut data) = (12, None, None);
    while offset < buffer.len() {
        if offset + 8 > buffer.len() {
            return Err("chunk header");
        }
        let id = &buffer[offset..offset + 4];
        let size = u32::from_le_bytes(
            buffer[offset + 4..offset + 8]
                .try_into()
                .map_err(|_| "chunk size")?,
        ) as usize;
        let start = offset + 8;
        let end = start.checked_add(size).ok_or("overflow")?;
        if end > buffer.len() {
            return Err("chunk end");
        }
        if id == b"fmt " {
            if format.is_some() || size < 16 {
                return Err("fmt");
            }
            format = Some((
                u16::from_le_bytes(buffer[start..start + 2].try_into().map_err(|_| "format")?),
                u16::from_le_bytes(
                    buffer[start + 2..start + 4]
                        .try_into()
                        .map_err(|_| "channels")?,
                ),
                u32::from_le_bytes(
                    buffer[start + 4..start + 8]
                        .try_into()
                        .map_err(|_| "rate")?,
                ),
                u32::from_le_bytes(
                    buffer[start + 8..start + 12]
                        .try_into()
                        .map_err(|_| "byte rate")?,
                ),
                u16::from_le_bytes(
                    buffer[start + 12..start + 14]
                        .try_into()
                        .map_err(|_| "align")?,
                ),
                u16::from_le_bytes(
                    buffer[start + 14..start + 16]
                        .try_into()
                        .map_err(|_| "bits")?,
                ),
            ));
        } else if id == b"data" {
            if data.is_some() {
                return Err("data");
            }
            data = Some(size);
        }
        offset = end + size % 2;
    }
    let Some((1, 1, 16_000, 32_000, 2, 16)) = format else {
        return Err("format");
    };
    let size = data.ok_or("data")?;
    if size == 0 || size % 2 != 0 {
        return Err("samples");
    }
    let duration = size as f64 * 1_000.0 / 32_000.0;
    if !(300.0..=15_000.0).contains(&duration)
        || client.is_some_and(|client| (client as f64 - duration).abs() > 21.0)
    {
        return Err("duration");
    }
    Ok(Wav {
        duration_ms: duration,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm_wav(data_size: u32) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(44 + data_size as usize);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&16_000_u32.to_le_bytes());
        bytes.extend_from_slice(&32_000_u32.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_size.to_le_bytes());
        bytes.resize(44 + data_size as usize, 0);
        bytes
    }

    #[test]
    fn rejects_non_wav() {
        assert!(parse_pcm_wav(b"not wav", None).is_err());
    }

    #[test]
    fn preserves_fractional_pcm_duration() {
        let wav = parse_pcm_wav(&pcm_wav(9_794), Some(306)).expect("valid PCM WAV");
        assert!((wav.duration_ms - 306.062_5).abs() < f64::EPSILON);
    }
}
