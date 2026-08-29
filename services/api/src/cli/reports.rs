use std::{fs, path::Path};

use anyhow::Context;
use serde::{Deserialize, Serialize, Serializer};

fn serialize_javascript_number<S>(value: &f64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if value.fract().abs() <= f64::EPSILON && *value >= i64::MIN as f64 && *value <= i64::MAX as f64
    {
        serializer.serialize_i64(*value as i64)
    } else {
        serializer.serialize_f64(*value)
    }
}

fn serialize_optional_javascript_number<S>(
    value: &Option<f64>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match value {
        None => serializer.serialize_none(),
        Some(value)
            if value.fract().abs() <= f64::EPSILON
                && *value >= i64::MIN as f64
                && *value <= i64::MAX as f64 =>
        {
            serializer.serialize_some(&(*value as i64))
        }
        Some(value) => serializer.serialize_some(value),
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReliabilityScenario {
    schema_version: u8,
    #[serde(default)]
    cancellation_latency_ms: Option<f64>,
    #[serde(default)]
    completed: bool,
    cost_micro_usd: u64,
    #[serde(default)]
    duplicate_consequential_actions: u64,
    duration_ms: f64,
    #[serde(default)]
    fault_injected: bool,
    #[serde(default)]
    planned_user_intervention: bool,
    #[serde(default)]
    recovered: bool,
    #[serde(default)]
    stale_observation_rejections: u64,
    #[serde(default)]
    unknown_effect_retries: u64,
    #[serde(default)]
    unplanned_user_intervention: bool,
    #[serde(default)]
    verified: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReliabilitySummary {
    count: usize,
    #[serde(serialize_with = "serialize_optional_javascript_number")]
    cancellation_p95_ms: Option<f64>,
    cost_per_verified_success_micro_usd: Option<u64>,
    duplicate_consequential_action_count: u64,
    #[serde(serialize_with = "serialize_javascript_number")]
    false_completion_rate: f64,
    #[serde(serialize_with = "serialize_javascript_number")]
    p50_duration_ms: f64,
    #[serde(serialize_with = "serialize_javascript_number")]
    p95_duration_ms: f64,
    #[serde(serialize_with = "serialize_javascript_number")]
    recovery_rate: f64,
    #[serde(serialize_with = "serialize_javascript_number")]
    planned_user_intervention_rate: f64,
    stale_observation_rejection_count: u64,
    unknown_effect_retry_count: u64,
    #[serde(serialize_with = "serialize_javascript_number")]
    unplanned_user_intervention_rate: f64,
    #[serde(serialize_with = "serialize_javascript_number")]
    user_intervention_rate: f64,
    #[serde(serialize_with = "serialize_javascript_number")]
    verified_completion_rate: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReliabilityGates {
    cancellation_responsiveness: bool,
    duplicate_consequential_actions: bool,
    false_completions: bool,
    recovery: bool,
    stale_observation_rejection: bool,
    unknown_effect_retries: bool,
    user_intervention: bool,
    verified_completion: bool,
}

impl ReliabilityGates {
    const fn passed(&self) -> bool {
        self.cancellation_responsiveness
            && self.duplicate_consequential_actions
            && self.false_completions
            && self.recovery
            && self.stale_observation_rejection
            && self.unknown_effect_retries
            && self.user_intervention
            && self.verified_completion
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReliabilityReport {
    baseline: ReliabilitySummary,
    candidate: ReliabilitySummary,
    gates: ReliabilityGates,
    passed: bool,
}

fn percentile(values: impl IntoIterator<Item = f64>, fraction: f64) -> f64 {
    let mut values = values.into_iter().collect::<Vec<_>>();
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(f64::total_cmp);
    let rank = (values.len() as f64 * fraction).ceil() as usize;
    values[rank.saturating_sub(1).min(values.len() - 1)]
}

fn summarize_reliability(results: &[ReliabilityScenario]) -> anyhow::Result<ReliabilitySummary> {
    anyhow::ensure!(
        !results.is_empty(),
        "A reliability run must contain at least one scenario result."
    );
    anyhow::ensure!(
        results
            .iter()
            .all(|result| result.duration_ms.is_finite() && result.duration_ms >= 0.0),
        "Reliability scenario durations must be finite and non-negative."
    );
    anyhow::ensure!(
        results.iter().all(|result| result.schema_version == 2),
        "Reliability scenarios must use autonomous-execution report schema version 2."
    );
    anyhow::ensure!(
        results.iter().all(|result| result
            .cancellation_latency_ms
            .is_none_or(|value| value.is_finite() && value >= 0.0)),
        "Cancellation latencies must be finite and non-negative."
    );
    let count = results.len();
    let count_float = count as f64;
    let verified = results.iter().filter(|result| result.verified).count();
    let false_completions = results
        .iter()
        .filter(|result| result.completed && !result.verified)
        .count();
    let faulted = results
        .iter()
        .filter(|result| result.fault_injected)
        .count();
    let recovered = results
        .iter()
        .filter(|result| result.fault_injected && result.recovered)
        .count();
    let planned_interventions = results
        .iter()
        .filter(|result| result.planned_user_intervention)
        .count();
    let unplanned_interventions = results
        .iter()
        .filter(|result| result.unplanned_user_intervention)
        .count();
    let total_cost: u64 = results.iter().map(|result| result.cost_micro_usd).sum();
    let verified_u64 = u64::try_from(verified).context("verified scenario count overflowed")?;
    Ok(ReliabilitySummary {
        count,
        cancellation_p95_ms: {
            let values = results
                .iter()
                .filter_map(|result| result.cancellation_latency_ms)
                .collect::<Vec<_>>();
            (!values.is_empty()).then(|| percentile(values, 0.95))
        },
        cost_per_verified_success_micro_usd: (verified > 0)
            .then(|| total_cost.div_ceil(verified_u64)),
        duplicate_consequential_action_count: results
            .iter()
            .map(|result| result.duplicate_consequential_actions)
            .sum(),
        false_completion_rate: false_completions as f64 / count_float,
        p50_duration_ms: percentile(results.iter().map(|result| result.duration_ms), 0.5),
        p95_duration_ms: percentile(results.iter().map(|result| result.duration_ms), 0.95),
        recovery_rate: if faulted == 0 {
            1.0
        } else {
            recovered as f64 / faulted as f64
        },
        planned_user_intervention_rate: planned_interventions as f64 / count_float,
        stale_observation_rejection_count: results
            .iter()
            .map(|result| result.stale_observation_rejections)
            .sum(),
        unknown_effect_retry_count: results
            .iter()
            .map(|result| result.unknown_effect_retries)
            .sum(),
        unplanned_user_intervention_rate: unplanned_interventions as f64 / count_float,
        user_intervention_rate: (planned_interventions + unplanned_interventions) as f64
            / count_float,
        verified_completion_rate: verified as f64 / count_float,
    })
}

fn build_reliability_report(
    baseline_results: &[ReliabilityScenario],
    candidate_results: &[ReliabilityScenario],
) -> anyhow::Result<ReliabilityReport> {
    let baseline = summarize_reliability(baseline_results)?;
    let candidate = summarize_reliability(candidate_results)?;
    let gates = ReliabilityGates {
        cancellation_responsiveness: match (
            baseline.cancellation_p95_ms,
            candidate.cancellation_p95_ms,
        ) {
            (None, None) => true,
            (Some(_), None) => false,
            (Some(baseline), Some(candidate)) => candidate <= baseline.max(1_000.0),
            (None, Some(candidate)) => candidate <= 1_000.0,
        },
        duplicate_consequential_actions: candidate.duplicate_consequential_action_count == 0,
        false_completions: candidate.false_completion_rate <= f64::EPSILON,
        recovery: candidate.recovery_rate >= baseline.recovery_rate.max(0.95),
        stale_observation_rejection: candidate.stale_observation_rejection_count
            >= baseline.stale_observation_rejection_count,
        unknown_effect_retries: candidate.unknown_effect_retry_count == 0,
        user_intervention: candidate.user_intervention_rate
            <= baseline.user_intervention_rate + 0.02,
        verified_completion: candidate.verified_completion_rate
            >= baseline.verified_completion_rate.max(0.9),
    };
    let passed = gates.passed();
    Ok(ReliabilityReport {
        baseline,
        candidate,
        gates,
        passed,
    })
}

fn reliability_markdown(report: &ReliabilityReport) -> String {
    format!(
        concat!(
            "# Agent reliability benchmark\n\n",
            "| Metric | Baseline | Candidate |\n",
            "|---|---:|---:|\n",
            "| Verified completion rate | {:.3} | {:.3} |\n",
            "| False completion rate | {:.3} | {:.3} |\n",
            "| Recovery rate | {:.3} | {:.3} |\n",
            "| Duplicate consequential actions | {} | {} |\n",
            "| Unknown-effect retries | {} | {} |\n",
            "| Stale-observation rejections | {} | {} |\n",
            "| Cancellation p95 (ms) | {} | {} |\n",
            "| Planned intervention rate | {:.3} | {:.3} |\n",
            "| Unplanned intervention rate | {:.3} | {:.3} |\n",
            "| Cost / verified success (micro-USD) | {} | {} |\n",
            "| p95 duration (ms) | {} | {} |\n\n",
            "Overall: {}"
        ),
        report.baseline.verified_completion_rate,
        report.candidate.verified_completion_rate,
        report.baseline.false_completion_rate,
        report.candidate.false_completion_rate,
        report.baseline.recovery_rate,
        report.candidate.recovery_rate,
        report.baseline.duplicate_consequential_action_count,
        report.candidate.duplicate_consequential_action_count,
        report.baseline.unknown_effect_retry_count,
        report.candidate.unknown_effect_retry_count,
        report.baseline.stale_observation_rejection_count,
        report.candidate.stale_observation_rejection_count,
        report
            .baseline
            .cancellation_p95_ms
            .map_or_else(|| "N/A".to_owned(), |value| value.to_string()),
        report
            .candidate
            .cancellation_p95_ms
            .map_or_else(|| "N/A".to_owned(), |value| value.to_string()),
        report.baseline.planned_user_intervention_rate,
        report.candidate.planned_user_intervention_rate,
        report.baseline.unplanned_user_intervention_rate,
        report.candidate.unplanned_user_intervention_rate,
        report
            .baseline
            .cost_per_verified_success_micro_usd
            .map_or_else(|| "Infinity".to_owned(), |value| value.to_string()),
        report
            .candidate
            .cost_per_verified_success_micro_usd
            .map_or_else(|| "Infinity".to_owned(), |value| value.to_string()),
        report.baseline.p95_duration_ms,
        report.candidate.p95_duration_ms,
        if report.passed { "PASS" } else { "FAIL" },
    )
}

pub fn agent_reliability_report(
    baseline_path: &Path,
    candidate_path: &Path,
    json: bool,
) -> anyhow::Result<()> {
    let baseline: Vec<ReliabilityScenario> = serde_json::from_str(
        &fs::read_to_string(baseline_path)
            .with_context(|| format!("failed to read {}", baseline_path.display()))?,
    )
    .with_context(|| format!("failed to parse {}", baseline_path.display()))?;
    let candidate: Vec<ReliabilityScenario> = serde_json::from_str(
        &fs::read_to_string(candidate_path)
            .with_context(|| format!("failed to read {}", candidate_path.display()))?,
    )
    .with_context(|| format!("failed to parse {}", candidate_path.display()))?;
    let report = build_reliability_report(&baseline, &candidate)?;
    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!("{}", reliability_markdown(&report));
    }
    anyhow::ensure!(report.passed, "Agent reliability benchmark failed.");
    Ok(())
}

const EVENT_PREFIX: &str = "[cua] performance";
const ALLOWED_EVENT_KEYS: [&str; 6] = [
    "durationMs",
    "fallbackReason",
    "operation",
    "route",
    "screenshotAttached",
    "status",
];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PerformanceEvent {
    duration_ms: f64,
    fallback_reason: String,
    operation: String,
    route: String,
    screenshot_attached: bool,
    status: String,
}

fn validate_performance_event(
    value: serde_json::Value,
    line_number: usize,
) -> anyhow::Result<PerformanceEvent> {
    let object = value.as_object().ok_or_else(|| {
        anyhow::anyhow!("Line {line_number}: CUA performance event must be an object.")
    })?;
    let extra_keys = object
        .keys()
        .filter(|key| !ALLOWED_EVENT_KEYS.contains(&key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    anyhow::ensure!(
        extra_keys.is_empty(),
        "Line {line_number}: disallowed CUA performance fields: {}.",
        extra_keys.join(", ")
    );
    let event: PerformanceEvent = serde_json::from_value(value)
        .with_context(|| format!("Line {line_number}: invalid CUA performance event"))?;
    anyhow::ensure!(
        event.duration_ms.is_finite() && event.duration_ms >= 0.0,
        "Line {line_number}: durationMs must be non-negative."
    );
    anyhow::ensure!(
        event.operation.encode_utf16().count() <= 100,
        "Line {line_number}: operation is invalid."
    );
    anyhow::ensure!(
        matches!(
            event.route.as_str(),
            "browser_semantic" | "window_accessibility" | "window_vision" | "desktop_vision"
        ),
        "Line {line_number}: route is invalid."
    );
    anyhow::ensure!(
        matches!(
            event.status.as_str(),
            "confirmed" | "error" | "not_executed" | "unknown"
        ),
        "Line {line_number}: status is invalid."
    );
    anyhow::ensure!(
        matches!(
            event.fallback_reason.as_str(),
            "none" | "semantic_unavailable" | "semantic_error" | "screenshot_required"
        ),
        "Line {line_number}: fallbackReason is invalid."
    );
    Ok(event)
}

fn parse_performance_log(contents: &str) -> anyhow::Result<Vec<PerformanceEvent>> {
    let mut events = Vec::new();
    for (index, line) in contents.lines().enumerate() {
        let Some(prefix_index) = line.find(EVENT_PREFIX) else {
            continue;
        };
        let search_start = prefix_index + EVENT_PREFIX.len();
        let json_offset = line[search_start..]
            .find('{')
            .map(|offset| search_start + offset)
            .ok_or_else(|| anyhow::anyhow!("Line {}: missing CUA performance JSON.", index + 1))?;
        let value = serde_json::from_str(&line[json_offset..])
            .map_err(|_| anyhow::anyhow!("Line {}: malformed CUA performance JSON.", index + 1))?;
        events.push(validate_performance_event(value, index + 1)?);
    }
    anyhow::ensure!(
        !events.is_empty(),
        "No content-free CUA performance events were found."
    );
    Ok(events)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FastPathSummary {
    count: usize,
    #[serde(serialize_with = "serialize_javascript_number")]
    confirmed_rate: f64,
    desktop_vision_count: usize,
    #[serde(serialize_with = "serialize_javascript_number")]
    p50_ms: f64,
    #[serde(serialize_with = "serialize_javascript_number")]
    p95_ms: f64,
    screenshot_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FastPathGates {
    confirmed_rate: bool,
    desktop_vision: bool,
    p50_latency: bool,
    p95_latency: bool,
    screenshots: bool,
}

impl FastPathGates {
    const fn passed(&self) -> bool {
        self.confirmed_rate
            && self.desktop_vision
            && self.p50_latency
            && self.p95_latency
            && self.screenshots
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FastPathReport {
    baseline: FastPathSummary,
    candidate: FastPathSummary,
    gates: FastPathGates,
    passed: bool,
}

fn summarize_fast_path(events: &[PerformanceEvent]) -> FastPathSummary {
    let confirmed = events
        .iter()
        .filter(|event| event.status == "confirmed")
        .count();
    FastPathSummary {
        count: events.len(),
        confirmed_rate: confirmed as f64 / events.len() as f64,
        desktop_vision_count: events
            .iter()
            .filter(|event| event.route == "desktop_vision")
            .count(),
        p50_ms: percentile(events.iter().map(|event| event.duration_ms), 0.5),
        p95_ms: percentile(events.iter().map(|event| event.duration_ms), 0.95),
        screenshot_count: events
            .iter()
            .filter(|event| event.screenshot_attached)
            .count(),
    }
}

fn ratio(candidate: f64, baseline: f64) -> f64 {
    if baseline.abs() <= f64::EPSILON {
        if candidate.abs() <= f64::EPSILON {
            0.0
        } else {
            f64::INFINITY
        }
    } else {
        candidate / baseline
    }
}

fn build_fast_path_report(
    baseline_events: &[PerformanceEvent],
    candidate_events: &[PerformanceEvent],
) -> FastPathReport {
    let baseline = summarize_fast_path(baseline_events);
    let candidate = summarize_fast_path(candidate_events);
    let gates = FastPathGates {
        confirmed_rate: candidate.confirmed_rate >= baseline.confirmed_rate - 0.02,
        desktop_vision: candidate.desktop_vision_count as f64
            <= baseline.desktop_vision_count as f64 * 0.25,
        p50_latency: ratio(candidate.p50_ms, baseline.p50_ms) <= 0.7,
        p95_latency: ratio(candidate.p95_ms, baseline.p95_ms) <= 0.8,
        screenshots: candidate.screenshot_count as f64 <= baseline.screenshot_count as f64 * 0.25,
    };
    let passed = gates.passed();
    FastPathReport {
        baseline,
        candidate,
        gates,
        passed,
    }
}

fn fast_path_markdown(report: &FastPathReport) -> String {
    format!(
        concat!(
            "# CUA semantic fast-path report\n\n",
            "| Metric | Baseline | Candidate | Gate |\n",
            "|---|---:|---:|:---:|\n",
            "| p50 operation latency (ms) | {} | {} | {} |\n",
            "| p95 operation latency (ms) | {} | {} | {} |\n",
            "| Screenshot-bearing operations | {} | {} | {} |\n",
            "| Desktop-vision operations | {} | {} | {} |\n",
            "| Confirmed rate | {:.3} | {:.3} | {} |\n\n",
            "Overall: {}"
        ),
        report.baseline.p50_ms,
        report.candidate.p50_ms,
        gate_label(report.gates.p50_latency),
        report.baseline.p95_ms,
        report.candidate.p95_ms,
        gate_label(report.gates.p95_latency),
        report.baseline.screenshot_count,
        report.candidate.screenshot_count,
        gate_label(report.gates.screenshots),
        report.baseline.desktop_vision_count,
        report.candidate.desktop_vision_count,
        gate_label(report.gates.desktop_vision),
        report.baseline.confirmed_rate,
        report.candidate.confirmed_rate,
        gate_label(report.gates.confirmed_rate),
        if report.passed { "PASS" } else { "FAIL" },
    )
}

const fn gate_label(passed: bool) -> &'static str {
    if passed { "pass" } else { "fail" }
}

pub fn cua_fast_path_report(
    baseline_path: &Path,
    candidate_path: &Path,
    json: bool,
) -> anyhow::Result<()> {
    let baseline_contents = fs::read_to_string(baseline_path)
        .with_context(|| format!("failed to read {}", baseline_path.display()))?;
    let candidate_contents = fs::read_to_string(candidate_path)
        .with_context(|| format!("failed to read {}", candidate_path.display()))?;
    let report = build_fast_path_report(
        &parse_performance_log(&baseline_contents)?,
        &parse_performance_log(&candidate_contents)?,
    );
    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!("{}", fast_path_markdown(&report));
    }
    anyhow::ensure!(report.passed, "CUA semantic fast-path report failed.");
    Ok(())
}

#[derive(Debug, Deserialize)]
struct CostFixture {
    scenarios: Vec<CostScenario>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CostScenario {
    after_micro_usd: i64,
    before_micro_usd: i64,
    id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CostOutput<'a> {
    after_micro_usd: i64,
    before_micro_usd: i64,
    saved_percent: i64,
    scenario: &'a str,
}

pub fn inference_cost_report(fixture_path: &Path) -> anyhow::Result<()> {
    let fixture: CostFixture = serde_json::from_str(
        &fs::read_to_string(fixture_path)
            .with_context(|| format!("failed to read {}", fixture_path.display()))?,
    )
    .with_context(|| format!("failed to parse {}", fixture_path.display()))?;
    for scenario in fixture.scenarios {
        let saved_percent = if scenario.before_micro_usd == 0 {
            0
        } else {
            ((((scenario.before_micro_usd - scenario.after_micro_usd) as f64
                / scenario.before_micro_usd as f64)
                * 100.0)
                + 0.5)
                .floor() as i64
        };
        println!(
            "{}",
            serde_json::to_string(&CostOutput {
                after_micro_usd: scenario.after_micro_usd,
                before_micro_usd: scenario.before_micro_usd,
                saved_percent,
                scenario: &scenario.id,
            })?
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reliability_scenario() -> ReliabilityScenario {
        ReliabilityScenario {
            schema_version: 2,
            cancellation_latency_ms: Some(250.0),
            completed: true,
            cost_micro_usd: 100,
            duplicate_consequential_actions: 0,
            duration_ms: 1_000.0,
            fault_injected: true,
            planned_user_intervention: false,
            recovered: true,
            stale_observation_rejections: 1,
            unknown_effect_retries: 0,
            unplanned_user_intervention: false,
            verified: true,
        }
    }

    fn performance_line(duration_ms: u32, route: &str, screenshot: bool) -> String {
        format!(
            "[cua] performance {}",
            serde_json::json!({
                "durationMs": duration_ms,
                "fallbackReason": if route == "desktop_vision" { "semantic_unavailable" } else { "none" },
                "operation": if route == "desktop_vision" { "observe" } else { "get_window_state" },
                "route": route,
                "screenshotAttached": screenshot,
                "status": "confirmed",
            })
        )
    }

    #[test]
    fn reliability_rejects_false_completion_and_duplicate_effects() {
        let mut unverified = reliability_scenario();
        unverified.verified = false;
        let mut duplicate = unverified.clone();
        duplicate.duplicate_consequential_actions = 1;
        let report = build_reliability_report(
            &[unverified, reliability_scenario()],
            &[reliability_scenario(), duplicate],
        )
        .expect("report");
        assert!(!report.passed);
        assert!(!report.gates.false_completions);
        assert!(!report.gates.duplicate_consequential_actions);
    }

    #[test]
    fn reliability_passes_verified_recovery_without_duplicate_effects() {
        let report = build_reliability_report(&[reliability_scenario()], &[reliability_scenario()])
            .expect("report");
        assert!(report.passed);
    }

    #[test]
    fn reliability_rejects_unknown_effect_retries_and_slow_cancellation() {
        let mut baseline = reliability_scenario();
        baseline.cancellation_latency_ms = Some(250.0);
        let mut candidate = reliability_scenario();
        candidate.cancellation_latency_ms = Some(1_500.0);
        candidate.unknown_effect_retries = 1;
        let report = build_reliability_report(&[baseline], &[candidate]).expect("report");
        assert!(!report.gates.cancellation_responsiveness);
        assert!(!report.gates.unknown_effect_retries);
        assert!(!report.passed);
    }

    #[test]
    fn reliability_rejects_missing_candidate_cancellation_measurements() {
        let baseline = reliability_scenario();
        let mut candidate = reliability_scenario();
        candidate.cancellation_latency_ms = None;
        let report = build_reliability_report(&[baseline], &[candidate]).expect("report");
        assert!(!report.gates.cancellation_responsiveness);
        assert!(!report.passed);
    }

    #[test]
    fn fast_path_passes_materially_faster_screenshot_free_candidate() {
        let baseline = parse_performance_log(&format!(
            "{}\n{}",
            performance_line(100, "desktop_vision", true),
            performance_line(200, "desktop_vision", true)
        ))
        .expect("baseline");
        let candidate = parse_performance_log(&format!(
            "{}\n{}",
            performance_line(50, "window_accessibility", false),
            performance_line(100, "window_accessibility", false)
        ))
        .expect("candidate");
        assert!(build_fast_path_report(&baseline, &candidate).passed);
    }

    #[test]
    fn fast_path_rejects_fields_that_could_carry_sensitive_content() {
        let line = performance_line(10, "window_accessibility", false);
        let with_title = format!(
            "{},\"windowTitle\":\"Private.py\"}}",
            &line[..line.len() - 1]
        );
        let error = parse_performance_log(&with_title).expect_err("sensitive field");
        assert!(
            error
                .to_string()
                .contains("disallowed CUA performance fields")
        );
    }
}
