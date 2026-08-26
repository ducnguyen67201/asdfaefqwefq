use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{ApiError, ApiResult};

pub const DEFAULT_CATALOG_VERSION: &str = "2026-08-20";
pub const IMAGE_CATALOG_VERSION: &str = "2026-04-21";
pub const GPT_IMAGE_MODEL: &str = "gpt-image-2-2026-04-21";
const MAX_TOKEN_COUNT: i64 = 2_000_000_000;
const TOKENS_PER_MILLION: i128 = 1_000_000;

#[derive(Clone, Copy, Debug)]
struct Price {
    cached_input: i64,
    cache_write: i64,
    input: i64,
    output: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    pub cache_write_tokens: i64,
    pub cached_input_tokens: i64,
    pub input_tokens: i64,
    #[serde(default)]
    pub input_text_tokens: i64,
    #[serde(default)]
    pub input_image_tokens: i64,
    pub model: String,
    pub output_tokens: i64,
    #[serde(default)]
    pub output_image_tokens: i64,
    #[serde(default)]
    pub reasoning_tokens: i64,
}

#[derive(Clone, Copy, Debug)]
pub struct ImageUsage {
    pub input_image_tokens: i64,
    pub input_text_tokens: i64,
    pub output_image_tokens: i64,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ModelCatalog;

impl ModelCatalog {
    fn price(model: &str) -> ApiResult<Price> {
        let value = match model {
            "gpt-5.6-luna" => Price {
                cached_input: 20_000,
                cache_write: 250_000,
                input: 200_000,
                output: 1_200_000,
            },
            "gpt-5.6-terra" => Price {
                cached_input: 200_000,
                cache_write: 2_500_000,
                input: 2_000_000,
                output: 12_000_000,
            },
            "gpt-5.6-sol" => Price {
                cached_input: 500_000,
                cache_write: 6_250_000,
                input: 5_000_000,
                output: 30_000_000,
            },
            _ => {
                return Err(ApiError::internal(anyhow::anyhow!(
                    "Model {model} is not in the price catalog."
                )));
            }
        };
        Ok(value)
    }

    pub fn calculate_usage_cost(&self, usage: &ProviderUsage) -> ApiResult<i64> {
        for (name, count) in [
            ("inputTokens", usage.input_tokens),
            ("cachedInputTokens", usage.cached_input_tokens),
            ("cacheWriteTokens", usage.cache_write_tokens),
            ("outputTokens", usage.output_tokens),
        ] {
            if !(0..=MAX_TOKEN_COUNT).contains(&count) {
                return Err(ApiError::internal(anyhow::anyhow!(
                    "{name} must be a bounded nonnegative integer."
                )));
            }
        }
        if usage.cached_input_tokens + usage.cache_write_tokens > usage.input_tokens {
            return Err(ApiError::internal(anyhow::anyhow!(
                "Cached and cache-write tokens cannot exceed input tokens."
            )));
        }
        let price = Self::price(&usage.model)?;
        let long = usage.input_tokens > 272_000;
        let input_multiplier = if long { 2_i128 } else { 1_i128 };
        let output_numerator = if long { 3_i128 } else { 2_i128 };
        let ordinary = usage.input_tokens - usage.cached_input_tokens - usage.cache_write_tokens;
        let numerator = i128::from(ordinary) * i128::from(price.input) * input_multiplier
            + i128::from(usage.cached_input_tokens)
                * i128::from(price.cached_input)
                * input_multiplier
            + i128::from(usage.cache_write_tokens)
                * i128::from(price.cache_write)
                * input_multiplier
            + i128::from(usage.output_tokens) * i128::from(price.output) * output_numerator / 2;
        let result = (numerator + TOKENS_PER_MILLION - 1) / TOKENS_PER_MILLION;
        i64::try_from(result).map_err(ApiError::internal)
    }

    pub fn calculate_image_usage_cost(&self, usage: &ImageUsage) -> ApiResult<i64> {
        for (name, count) in [
            ("inputTextTokens", usage.input_text_tokens),
            ("inputImageTokens", usage.input_image_tokens),
            ("outputImageTokens", usage.output_image_tokens),
        ] {
            if !(0..=MAX_TOKEN_COUNT).contains(&count) {
                return Err(ApiError::internal(anyhow::anyhow!(
                    "{name} must be a bounded nonnegative integer."
                )));
            }
        }
        let numerator = i128::from(usage.input_text_tokens) * 5_000_000_i128
            + i128::from(usage.input_image_tokens) * 8_000_000_i128
            + i128::from(usage.output_image_tokens) * 30_000_000_i128;
        let result = (numerator + TOKENS_PER_MILLION - 1) / TOKENS_PER_MILLION;
        i64::try_from(result).map_err(ApiError::internal)
    }

    pub fn estimate_responses_reservation(&self, body: &Value) -> ApiResult<i64> {
        let model = body
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let output_tokens = body
            .get("max_output_tokens")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        let input = serde_json::to_string(body.get("input").unwrap_or(&Value::Array(vec![])))
            .map_err(ApiError::internal)?;
        let tools = serde_json::to_string(body.get("tools").unwrap_or(&Value::Array(vec![])))
            .map_err(ApiError::internal)?;
        let instructions = body
            .get("instructions")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let image_count = input.matches("\"input_image\"").count();
        let chars = input
            .len()
            .saturating_add(tools.len())
            .saturating_add(instructions.len());
        let input_tokens = i64::try_from(
            chars
                .div_ceil(3)
                .saturating_add(1_024)
                .saturating_add(image_count.saturating_mul(20_000)),
        )
        .unwrap_or(MAX_TOKEN_COUNT)
        .min(MAX_TOKEN_COUNT);
        self.calculate_usage_cost(&ProviderUsage {
            cache_write_tokens: 0,
            cached_input_tokens: 0,
            input_tokens,
            input_text_tokens: 0,
            input_image_tokens: 0,
            model: model.to_owned(),
            output_tokens,
            output_image_tokens: 0,
            reasoning_tokens: 0,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cost_uses_integer_ceiling() {
        let value = ModelCatalog
            .calculate_usage_cost(&ProviderUsage {
                cache_write_tokens: 0,
                cached_input_tokens: 0,
                input_tokens: 1,
                input_text_tokens: 0,
                input_image_tokens: 0,
                model: "gpt-5.6-luna".to_owned(),
                output_tokens: 0,
                output_image_tokens: 0,
                reasoning_tokens: 0,
            })
            .expect("cost");
        assert_eq!(value, 1);
    }

    #[test]
    fn image_cost_matches_the_javascript_release_oracle() {
        let value = ModelCatalog
            .calculate_image_usage_cost(&ImageUsage {
                input_image_tokens: 2,
                input_text_tokens: 3,
                output_image_tokens: 4,
            })
            .expect("image cost");
        assert_eq!(value, 151);
    }
}
