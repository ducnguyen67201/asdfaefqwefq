use std::time::{Duration, Instant};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use futures_util::StreamExt as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    usage::{
        BudgetService, CompanionGenerationSnapshot, GPT_IMAGE_MODEL, IMAGE_CATALOG_VERSION,
        ImageUsage, ModelCatalog, ProviderUsage, ReservationInput, SettlementInput,
    },
    validation::{js_string_len, js_trim},
};

const URL: &str = "https://api.openai.com/v1/images/edits";
const MAX_SOURCE_BYTES: usize = 5 * 1_024 * 1_024;
const MAX_OUTPUT_BYTES: usize = 8 * 1_024 * 1_024;
const MAX_PROVIDER_RESPONSE_BYTES: usize = 12 * 1_024 * 1_024;
const MAX_TOKEN_COUNT: i64 = 2_000_000_000;
const PNG_SIGNATURE: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];

#[derive(Clone)]
pub struct CompanionImageService {
    budget: BudgetService,
    catalog: ModelCatalog,
    client: reqwest::Client,
    key: String,
    reservation_micro_usd: i64,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompanionImageBody {
    pub image_base64: String,
    pub mime_type: String,
    pub prompt: String,
}

pub struct CompanionImageInput<'a> {
    pub body: CompanionImageBody,
    pub plan_id: &'a str,
    pub request_id: Uuid,
    pub safety_identifier: &'a str,
    pub user_id: &'a str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionImageResult {
    pub image_base64: String,
    pub mime_type: &'static str,
    pub model: &'static str,
    pub quota: CompanionGenerationSnapshot,
}

struct ParsedPayload {
    image_base64: String,
    usage: ImageUsage,
}

impl CompanionImageService {
    #[must_use]
    pub fn new(
        budget: BudgetService,
        client: reqwest::Client,
        key: &str,
        reservation_micro_usd: i64,
    ) -> Self {
        Self::new_with_endpoint(budget, client, key, reservation_micro_usd, URL)
    }

    #[doc(hidden)]
    #[must_use]
    pub fn new_with_endpoint(
        budget: BudgetService,
        client: reqwest::Client,
        key: &str,
        reservation_micro_usd: i64,
        url: &str,
    ) -> Self {
        Self {
            budget,
            catalog: ModelCatalog,
            client,
            key: key.to_owned(),
            reservation_micro_usd,
            url: url.to_owned(),
        }
    }

    pub async fn execute(&self, input: CompanionImageInput<'_>) -> ApiResult<CompanionImageResult> {
        let started = Instant::now();
        let prompt = js_trim(&input.body.prompt);
        let source =
            if input.body.mime_type == "image/png" && (1..=400).contains(&js_string_len(prompt)) {
                decode_png(&input.body.image_base64, MAX_SOURCE_BYTES)
            } else {
                None
            }
            .ok_or_else(invalid_request)?;

        self.budget
            .reserve(ReservationInput {
                agent_turn_id: None,
                catalog_version: IMAGE_CATALOG_VERSION,
                lane: "image_generation",
                model: GPT_IMAGE_MODEL,
                plan_id: input.plan_id,
                request_id: input.request_id,
                reserved_micro_usd: self.reservation_micro_usd,
                task_id: input.request_id,
                user_id: input.user_id,
            })
            .await?;

        let byte_count = source.len();
        let image = reqwest::multipart::Part::bytes(source)
            .file_name("reference.png")
            .mime_str("image/png")
            .map_err(ApiError::internal)?;
        let form = reqwest::multipart::Form::new()
            .part("image[]", image)
            .text("model", GPT_IMAGE_MODEL)
            .text("prompt", provider_prompt(prompt))
            .text("n", "1")
            .text("size", "1024x1024")
            .text("quality", "low")
            .text("background", "transparent")
            .text("output_format", "png")
            .text("moderation", "auto");

        self.budget
            .mark_dispatched(input.user_id, input.request_id)
            .await?;
        let request = self
            .client
            .post(&self.url)
            .bearer_auth(&self.key)
            .header("openai-safety-identifier", input.safety_identifier)
            .multipart(form);
        let response = match tokio::time::timeout(Duration::from_secs(130), request.send()).await {
            Ok(Ok(value)) => value,
            Ok(Err(_)) | Err(_) => {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
                return Err(ambiguous_dispatch());
            }
        };
        let status = response.status();
        if !status.is_success() {
            if matches!(status.as_u16(), 400 | 401 | 403 | 404 | 422) {
                self.budget
                    .release(input.user_id, input.request_id, "rejected_before_inference")
                    .await?;
                return Err(ApiError::coded(
                    http::StatusCode::UNPROCESSABLE_ENTITY,
                    "companion_image_rejected",
                    "That image could not be used for a student companion. Try a different reference or prompt.",
                ));
            }
            self.budget
                .mark_uncertain(input.user_id, input.request_id)
                .await?;
            return Err(ambiguous_dispatch());
        }

        let parsed = match read_and_parse(response).await {
            Some(value) => value,
            None => {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
                return Err(ambiguous_response(
                    "Companion generation returned an uncertain result, so Tro did not retry it.",
                ));
            }
        };
        let actual_micro_usd = self.catalog.calculate_image_usage_cost(&parsed.usage)?;
        let usage = ProviderUsage {
            cache_write_tokens: 0,
            cached_input_tokens: 0,
            input_tokens: parsed
                .usage
                .input_text_tokens
                .saturating_add(parsed.usage.input_image_tokens),
            input_text_tokens: parsed.usage.input_text_tokens,
            input_image_tokens: parsed.usage.input_image_tokens,
            model: GPT_IMAGE_MODEL.to_owned(),
            output_tokens: parsed.usage.output_image_tokens,
            output_image_tokens: parsed.usage.output_image_tokens,
            reasoning_tokens: 0,
        };
        let accounting = async {
            self.budget
                .settle(SettlementInput {
                    actual_micro_usd,
                    audio_duration_ms: 0,
                    character_count: 0,
                    duration_ms: i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
                    provider_response_id: None,
                    request_id: input.request_id,
                    usage: &usage,
                    usage_source: "actual",
                    user_id: input.user_id,
                })
                .await?;
            self.budget
                .companion_generation_snapshot(input.user_id, input.plan_id)
                .await
        }
        .await;
        let quota = match accounting {
            Ok(value) => value,
            Err(_) => {
                let _ = self
                    .budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await;
                return Err(ambiguous_response(
                    "Companion generation completed, but Tro could not confirm its usage status, so it did not retry it.",
                ));
            }
        };

        tracing::info!(
            event = "companion.image.completed",
            request_id = %input.request_id,
            model = GPT_IMAGE_MODEL,
            lane = "image_generation",
            byte_count,
            duration_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),
            input_text_tokens = parsed.usage.input_text_tokens,
            input_image_tokens = parsed.usage.input_image_tokens,
            output_image_tokens = parsed.usage.output_image_tokens,
            micro_usd = actual_micro_usd,
            quota_remaining = quota.remaining,
        );
        Ok(CompanionImageResult {
            image_base64: parsed.image_base64,
            mime_type: "image/png",
            model: GPT_IMAGE_MODEL,
            quota,
        })
    }
}

fn invalid_request() -> ApiError {
    ApiError::coded(
        http::StatusCode::BAD_REQUEST,
        "invalid_companion_image_request",
        "Choose a valid PNG and customization prompt.",
    )
}

fn ambiguous_dispatch() -> ApiError {
    ApiError::coded(
        http::StatusCode::BAD_GATEWAY,
        "ambiguous_dispatch",
        "Companion generation may have completed, so Tro did not retry it.",
    )
}

fn ambiguous_response(message: &'static str) -> ApiError {
    ApiError::coded(http::StatusCode::BAD_GATEWAY, "ambiguous_response", message)
}

fn decode_png(value: &str, max_bytes: usize) -> Option<Vec<u8>> {
    if value.len() < 4 || !value.len().is_multiple_of(4) {
        return None;
    }
    let padding = if value.ends_with("==") {
        2
    } else if value.ends_with('=') {
        1
    } else {
        0
    };
    let content_len = value.len().checked_sub(padding)?;
    if !value[..content_len]
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
        || !value[content_len..].bytes().all(|byte| byte == b'=')
    {
        return None;
    }
    let bytes = STANDARD.decode(value).ok()?;
    if bytes.is_empty()
        || bytes.len() > max_bytes
        || STANDARD.encode(&bytes) != value
        || !bytes.starts_with(PNG_SIGNATURE)
    {
        return None;
    }
    Some(bytes)
}

async fn read_and_parse(response: reqwest::Response) -> Option<ParsedPayload> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_PROVIDER_RESPONSE_BYTES as u64)
    {
        return None;
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.ok()?;
        if bytes.len().saturating_add(chunk.len()) > MAX_PROVIDER_RESPONSE_BYTES {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_provider_payload(&serde_json::from_slice(&bytes).ok()?)
}

fn parse_provider_payload(value: &Value) -> Option<ParsedPayload> {
    let object = value.as_object()?;
    let data = object.get("data")?.as_array()?;
    if data.len() != 1 {
        return None;
    }
    let image_base64 = data.first()?.get("b64_json")?.as_str()?.to_owned();
    decode_png(&image_base64, MAX_OUTPUT_BYTES)?;
    let usage = object.get("usage")?.as_object()?;
    let details = usage.get("input_tokens_details")?.as_object()?;
    let input_text_tokens = bounded_token(details.get("text_tokens")?)?;
    let input_image_tokens = bounded_token(details.get("image_tokens")?)?;
    let output_image_tokens = bounded_token(usage.get("output_tokens")?)?;
    let input_tokens = bounded_token(usage.get("input_tokens")?)?;
    if input_tokens != input_text_tokens + input_image_tokens {
        return None;
    }
    Some(ParsedPayload {
        image_base64,
        usage: ImageUsage {
            input_image_tokens,
            input_text_tokens,
            output_image_tokens,
        },
    })
}

fn bounded_token(value: &Value) -> Option<i64> {
    let value = value.as_i64().or_else(|| {
        let value = value.as_f64()?;
        (value.is_finite() && value.fract() == 0.0).then_some(value as i64)
    })?;
    (0..=MAX_TOKEN_COUNT).contains(&value).then_some(value)
}

fn provider_prompt(user_prompt: &str) -> String {
    [
        "Create exactly one friendly, age-appropriate cursor companion based on the reference image.",
        "Show one centered subject on a transparent background with a bold clean silhouette and high contrast.",
        "Keep recognizable safe traits from the reference and make the result legible at 29 pixels.",
        "Do not include text, letters, logos, watermarks, frames, extra subjects, or unsafe content.",
        "<student_customization>",
        user_prompt,
        "</student_customization>",
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        [PNG_SIGNATURE, &[0, 0, 0, 0]].concat()
    }

    #[test]
    fn source_requires_canonical_png_base64() {
        let canonical = STANDARD.encode(png());
        assert_eq!(decode_png(&canonical, MAX_SOURCE_BYTES), Some(png()));
        assert!(decode_png("AAAA", MAX_SOURCE_BYTES).is_none());
        assert!(decode_png("iVBORw0KGgo=\n", MAX_SOURCE_BYTES).is_none());
    }

    #[test]
    fn provider_payload_requires_exact_token_totals() {
        let image = STANDARD.encode(png());
        let valid = serde_json::json!({
            "data": [{"b64_json": image}],
            "usage": {
                "input_tokens": 2,
                "input_tokens_details": {"image_tokens": 1, "text_tokens": 1},
                "output_tokens": 200
            }
        });
        let parsed = parse_provider_payload(&valid).expect("valid provider payload");
        assert_eq!(parsed.usage.output_image_tokens, 200);
        let mut invalid = valid.clone();
        invalid["usage"]["input_tokens"] = serde_json::json!(3);
        assert!(parse_provider_payload(&invalid).is_none());

        let mut integer_float = valid;
        integer_float["usage"]["output_tokens"] = serde_json::json!(200.0);
        assert!(parse_provider_payload(&integer_float).is_some());
    }

    #[test]
    fn fixed_prompt_delimits_student_customization() {
        let prompt = provider_prompt("blue space cat");
        assert!(
            prompt.contains("<student_customization>\nblue space cat\n</student_customization>")
        );
        assert!(prompt.contains("transparent background"));
    }
}
