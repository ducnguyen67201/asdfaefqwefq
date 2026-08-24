use std::{
    pin::Pin,
    time::{Duration, Instant},
};

use async_stream::try_stream;
use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use http::{HeaderMap, HeaderValue, StatusCode};
use serde_json::Value;
use uuid::Uuid;

use crate::{
    error::{ApiError, ApiResult},
    usage::{
        BudgetService, DEFAULT_CATALOG_VERSION, ModelCatalog, ProviderUsage, ReservationInput,
        SettlementInput,
    },
};

const RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const MAX_BYTES: usize = 5_000_000;
const MAX_LINE: usize = 1_000_000;
pub type ByteStream = Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>;
pub enum ProviderBody {
    Buffered(Bytes),
    Stream(ByteStream),
}
pub struct ProviderResponse {
    pub body: ProviderBody,
    pub content_type: String,
    pub headers: HeaderMap,
    pub status: StatusCode,
}
pub struct ResponsesInput<'a> {
    pub body: Value,
    pub agent_turn_id: Uuid,
    pub request_id: Uuid,
    pub safety_identifier: &'a str,
    pub task_id: Uuid,
    pub user_id: &'a str,
    pub plan_id: &'a str,
}

struct StreamingReservationGuard {
    budget: BudgetService,
    request_id: Uuid,
    user_id: String,
    armed: bool,
}

impl StreamingReservationGuard {
    fn new(budget: BudgetService, user_id: String, request_id: Uuid) -> Self {
        Self {
            budget,
            request_id,
            user_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for StreamingReservationGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let budget = self.budget.clone();
        let request_id = self.request_id;
        let user_id = self.user_id.clone();
        tokio::spawn(async move {
            if let Err(error) = budget.mark_uncertain(&user_id, request_id).await {
                tracing::error!(event = "provider.stream.cleanup_failed", %request_id, %error);
            }
        });
    }
}

#[derive(Clone)]
pub struct ResponsesService {
    budget: BudgetService,
    catalog: ModelCatalog,
    client: reqwest::Client,
    key: String,
    url: String,
}
impl ResponsesService {
    #[must_use]
    pub fn new(budget: BudgetService, client: reqwest::Client, key: &str) -> Self {
        Self::new_with_endpoint(budget, client, key, RESPONSES_URL)
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
            catalog: ModelCatalog,
            client,
            key: key.to_owned(),
            url: url.to_owned(),
        }
    }
    pub async fn execute(&self, input: ResponsesInput<'_>) -> ApiResult<ProviderResponse> {
        let started = Instant::now();
        let model = input
            .body
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let estimate = self.catalog.estimate_responses_reservation(&input.body)?;
        self.budget
            .reserve(ReservationInput {
                agent_turn_id: Some(input.agent_turn_id),
                catalog_version: DEFAULT_CATALOG_VERSION,
                lane: "responses",
                model: &model,
                plan_id: input.plan_id,
                request_id: input.request_id,
                reserved_micro_usd: estimate,
                task_id: input.task_id,
                user_id: input.user_id,
            })
            .await?;
        self.budget
            .mark_dispatched(input.user_id, input.request_id)
            .await?;
        let stream = input.body.get("stream").and_then(Value::as_bool) == Some(true);
        let request = self
            .client
            .post(&self.url)
            .bearer_auth(&self.key)
            .header("content-type", "application/json")
            .header("openai-safety-identifier", input.safety_identifier)
            .json(&input.body);
        let result = tokio::time::timeout(Duration::from_secs(60), request.send()).await;
        let response = match result {
            Ok(Ok(response)) => response,
            Ok(Err(_)) | Err(_) => {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
                return Err(ApiError::coded(
                    StatusCode::BAD_GATEWAY,
                    "ambiguous_dispatch",
                    "The model provider is temporarily unavailable. This call was not retried.",
                ));
            }
        };
        let status = response.status();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/json; charset=utf-8")
            .to_owned();
        if !status.is_success() || !stream {
            let declared = response.content_length().unwrap_or(0);
            if declared > MAX_BYTES as u64 {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
                return Err(ApiError::coded(
                    StatusCode::BAD_GATEWAY,
                    "ambiguous_response",
                    "The model provider returned an invalid response. This call was not retried.",
                ));
            }
            let bytes = match response.bytes().await {
                Ok(bytes) => bytes,
                Err(_) => {
                    self.budget
                        .mark_uncertain(input.user_id, input.request_id)
                        .await?;
                    return Err(ApiError::coded(
                        StatusCode::BAD_GATEWAY,
                        "ambiguous_response",
                        "The model provider returned an invalid response. This call was not retried.",
                    ));
                }
            };
            if bytes.len() > MAX_BYTES {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
                return Err(ApiError::coded(
                    StatusCode::BAD_GATEWAY,
                    "ambiguous_response",
                    "The model provider returned an invalid response. This call was not retried.",
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
                return Ok(ProviderResponse {
                    body: ProviderBody::Buffered(bytes),
                    content_type,
                    headers: HeaderMap::new(),
                    status,
                });
            }
            let parsed: Option<Value> = serde_json::from_slice(&bytes).ok();
            let usage = parsed
                .as_ref()
                .and_then(|value| parse_usage(value, &model).ok())
                .flatten();
            let mut headers = HeaderMap::new();
            if let Some((usage, response_id)) = usage {
                let actual = match self.catalog.calculate_usage_cost(&usage) {
                    Ok(actual) => actual,
                    Err(error) => {
                        self.budget
                            .mark_uncertain(input.user_id, input.request_id)
                            .await?;
                        return Err(error);
                    }
                };
                self.budget
                    .settle(SettlementInput {
                        actual_micro_usd: actual,
                        audio_duration_ms: 0,
                        character_count: 0,
                        duration_ms: i64::try_from(started.elapsed().as_millis())
                            .unwrap_or(i64::MAX),
                        provider_response_id: response_id.as_deref(),
                        request_id: input.request_id,
                        usage: &usage,
                        usage_source: "actual",
                        user_id: input.user_id,
                    })
                    .await?;
                headers.insert(
                    "x-trocode-usage-micro-usd",
                    HeaderValue::from_str(&actual.to_string()).map_err(ApiError::internal)?,
                );
                headers.insert("x-trocode-usage-source", HeaderValue::from_static("actual"));
            } else {
                self.budget
                    .mark_uncertain(input.user_id, input.request_id)
                    .await?;
                headers.insert(
                    "x-trocode-usage-source",
                    HeaderValue::from_static("missing"),
                );
            }
            return Ok(ProviderResponse {
                body: ProviderBody::Buffered(bytes),
                content_type,
                headers,
                status,
            });
        }
        if !content_type
            .to_ascii_lowercase()
            .starts_with("text/event-stream")
        {
            self.budget
                .mark_uncertain(input.user_id, input.request_id)
                .await?;
            return Err(ApiError::coded(
                StatusCode::BAD_GATEWAY,
                "ambiguous_response",
                "The model provider returned an invalid stream. This call was not retried.",
            ));
        }
        let budget = self.budget.clone();
        let catalog = self.catalog;
        let user = input.user_id.to_owned();
        let request = input.request_id;
        let model_clone = model;
        let mut upstream = response.bytes_stream();
        let output = try_stream! {
            let mut guard = StreamingReservationGuard::new(budget.clone(), user.clone(), request);
            let mut all=Vec::new();let mut pending=Vec::new();
            while let Some(next)=upstream.next().await{let chunk=match next{Ok(value)=>value,Err(error)=>{budget.mark_uncertain(&user,request).await.map_err(io_error)?;guard.disarm();Err(std::io::Error::other(error))?;unreachable!()}};if all.len().saturating_add(chunk.len())>MAX_BYTES{budget.mark_uncertain(&user,request).await.map_err(io_error)?;guard.disarm();Err(std::io::Error::other("upstream response was unexpectedly large"))?;}all.extend_from_slice(&chunk);pending.extend_from_slice(&chunk);while let Some(index)=pending.iter().position(|byte|*byte==b'\n'){if index>MAX_LINE{budget.mark_uncertain(&user,request).await.map_err(io_error)?;guard.disarm();Err(std::io::Error::other("upstream SSE event was unexpectedly large"))?;}pending.drain(..=index);}if pending.len()>MAX_LINE{budget.mark_uncertain(&user,request).await.map_err(io_error)?;guard.disarm();Err(std::io::Error::other("upstream SSE event was unexpectedly large"))?;}yield chunk;}
            let usage=parse_stream_usage(&all,&model_clone);if let Some((usage,response_id))=usage{let actual=catalog.calculate_usage_cost(&usage).map_err(io_error)?;budget.settle(SettlementInput{actual_micro_usd:actual,audio_duration_ms:0,character_count:0,duration_ms:i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX),provider_response_id:response_id.as_deref(),request_id:request,usage:&usage,usage_source:"actual",user_id:&user}).await.map_err(io_error)?;}else{budget.mark_uncertain(&user,request).await.map_err(io_error)?;}guard.disarm();
        };
        Ok(ProviderResponse {
            body: ProviderBody::Stream(Box::pin(output)),
            content_type,
            headers: HeaderMap::new(),
            status,
        })
    }
}
fn io_error(error: ApiError) -> std::io::Error {
    std::io::Error::other(error.to_string())
}
fn integer(value: Option<&Value>) -> Option<i64> {
    let value = value?.as_i64()?;
    (value >= 0).then_some(value)
}
fn parse_usage(
    value: &Value,
    expected: &str,
) -> ApiResult<Option<(ProviderUsage, Option<String>)>> {
    let Some(usage) = value.get("usage") else {
        return Ok(None);
    };
    let input = integer(usage.get("input_tokens"))
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("invalid provider input usage")))?;
    let output = integer(usage.get("output_tokens"))
        .ok_or_else(|| ApiError::internal(anyhow::anyhow!("invalid provider output usage")))?;
    let details = usage.get("input_tokens_details").unwrap_or(&Value::Null);
    let output_details = usage.get("output_tokens_details").unwrap_or(&Value::Null);
    let cached = integer(details.get("cached_tokens")).unwrap_or(0);
    let cache_write = integer(details.get("cache_write_tokens")).unwrap_or(0);
    let reasoning = integer(output_details.get("reasoning_tokens")).unwrap_or(0);
    if cached + cache_write > input || reasoning > output {
        return Err(ApiError::internal(anyhow::anyhow!(
            "provider usage details exceed totals"
        )));
    }
    Ok(Some((
        ProviderUsage {
            cache_write_tokens: cache_write,
            cached_input_tokens: cached,
            input_tokens: input,
            model: value
                .get("model")
                .and_then(Value::as_str)
                .unwrap_or(expected)
                .to_owned(),
            output_tokens: output,
            reasoning_tokens: reasoning,
        },
        value
            .get("id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    )))
}
fn parse_stream_usage(bytes: &[u8], model: &str) -> Option<(ProviderUsage, Option<String>)> {
    let text = String::from_utf8_lossy(bytes);
    for line in text.lines().rev() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("response.completed") {
            return parse_usage(value.get("response")?, model).ok().flatten();
        }
    }
    None
}
