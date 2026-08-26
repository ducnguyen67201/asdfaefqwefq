use std::{collections::BTreeMap, net::IpAddr, sync::LazyLock};

use anyhow::{Context, bail};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use super::tool_catalog;

const AUTO_AUTHORIZABLE_EFFECTS: &[&str] = &[
    "create_resource",
    "update_resource",
    "rename_resource",
    "move_resource",
    "add_comment",
    "workspace_write",
    "workspace_command",
];
const HARD_CONFIRM_EFFECTS: &[&str] = &[
    "send_communication",
    "delete_or_archive",
    "unexpected_overwrite",
    "publish",
    "deploy",
    "merge",
    "financial_or_trade",
    "authentication_or_credential",
    "system_permission",
    "install",
    "sensitive_transfer",
    "unknown",
];
const RESOURCE_KINDS: &[&str] = &[
    "calendar_event",
    "document",
    "spreadsheet",
    "spreadsheet_row",
    "workspace_file",
    "workspace_repository",
    "comment",
    "issue",
    "pull_request",
    "email",
    "message",
    "form_submission",
    "download",
    "application",
    "generic_private_resource",
    "generic_public_resource",
];

static SAFE_DEFAULTS_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:make\s+(?:it|them)\s+up|choose\s+(?:reasonable|sensible|safe)\s+details|use\s+(?:the\s+)?defaults?|you\s+decide|whatever\s+(?:works|is\s+reasonable))\b")
        .expect("valid safe-defaults pattern")
});
static CREATE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:add|book|build|create|make|schedule|write)\b")
        .expect("valid create pattern")
});
static DRAFT_EMAIL_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bdraft\s+(?:(?:a|an|the|my)\s+)?(?:email|mail|message|reply)\b")
        .expect("valid draft-email pattern")
});
static UPDATE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:change|edit|fill|fix|implement|label|modify|organize|refactor|replace|update)\b",
    )
    .expect("valid update pattern")
});
static RENAME_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\brename\b").expect("valid rename pattern"));
static MOVE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bmove\b").expect("valid move pattern"));
static COMMENT_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:add|leave|write)\s+(?:a\s+)?comment\b").expect("valid comment pattern")
});
static WORKSPACE_MUTATION_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:add|build|change|commit|create|edit|fix|implement|modify|refactor|rename|replace|update|write)\b")
        .expect("valid workspace mutation pattern")
});
static WORKSPACE_COMMAND_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:build|check|compile|inspect|lint|run|test|typecheck|verify)\b")
        .expect("valid workspace command pattern")
});

static VISIBLE_SEND_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:invite|notify|send)\b").expect("valid send pattern"));
static VISIBLE_DELETE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:archive|delete|erase|remove)\b").expect("valid delete pattern")
});
static VISIBLE_FINANCIAL_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:bid|buy|checkout|pay|purchase|subscribe|trade)\b")
        .expect("valid financial pattern")
});
static VISIBLE_AUTH_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:credential|log\s*in|password|secret|sign\s*in|token)\b")
        .expect("valid auth pattern")
});
static VISIBLE_PERMISSION_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:accessibility|administrator|microphone|permission|screen\s+recording)\b")
        .expect("valid permission pattern")
});
static VISIBLE_INSTALL_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\binstall\b").expect("valid install pattern"));
static VISIBLE_PUBLISH_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:publish|post\s+publicly|make\s+public)\b").expect("valid publish pattern")
});
static VISIBLE_DEPLOY_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bdeploy\b").expect("valid deploy pattern"));
static VISIBLE_MERGE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bmerge\b").expect("valid merge pattern"));
static VISIBLE_TRANSFER_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:share|upload)\b").expect("valid transfer pattern"));
static VISIBLE_SUBMIT_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bsubmit\b").expect("valid submit pattern"));
static APPROVAL_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bapprov(?:e|al|ed|ing)\b").expect("valid approval pattern"));
static INTERNAL_APPROVAL_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:approve exact action|deny exact action|approval control|approval dialog)\b",
    )
    .expect("valid internal approval pattern")
});
static TROCODE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\btro(?:\s*code)?\b").expect("valid Tro pattern"));

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActionEffect {
    pub kind: String,
    pub resource_kind: Option<String>,
    pub reversibility: String,
    pub externality: String,
    pub communication: String,
    pub overwrite: String,
    pub sensitive_data_transfer: SensitiveDataTransfer,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum SensitiveDataTransfer {
    Boolean(bool),
    Unknown(String),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposedAction {
    pub action: String,
    pub tool_id: Option<String>,
    pub operation: Option<String>,
    pub effect: Option<ActionEffect>,
    pub description: String,
    pub target: Option<String>,
    #[serde(default)]
    pub parameters: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyGoal {
    pub schema_version: u32,
    pub autonomy_mode: String,
    pub activity: Option<Value>,
    pub intent_authorization: IntentAuthorizationContract,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvaluateActionInput {
    pub goal: PolicyGoal,
    pub action: ProposedAction,
    pub proposed_effect: ActionEffect,
    pub supported: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDecision {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal: Option<bool>,
    pub status: String,
    pub effect: ActionEffect,
    pub authorization_source: String,
    pub approval_required: bool,
    pub consequential: bool,
    pub summary: String,
    pub next_actions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IntentAuthorizationGrant {
    pub id: String,
    pub effect_kind: String,
    pub resource_kinds: Vec<String>,
    pub permits_safe_defaults: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IntentAuthorizationContract {
    pub schema_version: u32,
    pub revision: u32,
    pub source: String,
    pub grants: Vec<IntentAuthorizationGrant>,
}

impl ActionEffect {
    fn validate(&self) -> anyhow::Result<()> {
        let valid_kind = self.kind == "none"
            || AUTO_AUTHORIZABLE_EFFECTS.contains(&self.kind.as_str())
            || HARD_CONFIRM_EFFECTS.contains(&self.kind.as_str());
        if !valid_kind {
            bail!("The action effect kind is invalid.");
        }
        if self
            .resource_kind
            .as_deref()
            .is_some_and(|value| !RESOURCE_KINDS.contains(&value))
        {
            bail!("The action resource kind is invalid.");
        }
        if (self.kind == "none") != self.resource_kind.is_none() {
            bail!("The action effect and resource kind do not agree.");
        }
        if !matches!(
            self.reversibility.as_str(),
            "none" | "reversible" | "destructive" | "unknown"
        ) || !matches!(
            self.externality.as_str(),
            "local" | "cloud_private" | "external" | "public" | "unknown"
        ) || !matches!(
            self.communication.as_str(),
            "none" | "draft" | "send" | "invite" | "notify" | "unknown"
        ) || !matches!(
            self.overwrite.as_str(),
            "none" | "requested" | "unexpected" | "unknown"
        ) {
            bail!("The action effect metadata is invalid.");
        }
        if matches!(&self.sensitive_data_transfer, SensitiveDataTransfer::Unknown(value) if value != "unknown")
        {
            bail!("The sensitive-transfer marker is invalid.");
        }
        if self.kind == "none"
            && (self.reversibility != "none"
                || self.externality != "local"
                || self.communication != "none"
                || self.overwrite != "none"
                || self.sensitive_data_transfer != SensitiveDataTransfer::Boolean(false))
        {
            bail!("An effect-free action must contain neutral metadata.");
        }
        let communicates = matches!(self.communication.as_str(), "send" | "invite" | "notify");
        if communicates != (self.kind == "send_communication") {
            bail!("Communication metadata does not match the effect.");
        }
        Ok(())
    }
}

pub fn compile_intent_authorization(
    request: &str,
    execution_profile: &str,
    revision: u32,
) -> anyhow::Result<IntentAuthorizationContract> {
    if !matches!(execution_profile, "everyday" | "workspace") || !(1..=10_000).contains(&revision) {
        bail!("Intent authorization options are invalid.");
    }
    let request = request.trim();
    let resources = resource_kinds_for(request);
    let application_resources: Vec<String> = if execution_profile == "workspace" {
        resources
            .iter()
            .filter(|resource| resource.as_str() != "workspace_file")
            .cloned()
            .collect()
    } else {
        resources.clone()
    };
    let permits_safe_defaults = SAFE_DEFAULTS_PATTERN.is_match(request);
    let mut grants = Vec::new();
    if CREATE_PATTERN.is_match(request) || DRAFT_EMAIL_PATTERN.is_match(request) {
        add_grant(
            &mut grants,
            "create_resource",
            &application_resources,
            permits_safe_defaults,
        );
    }
    if UPDATE_PATTERN.is_match(request) {
        add_grant(
            &mut grants,
            "update_resource",
            &application_resources,
            permits_safe_defaults,
        );
    }
    if RENAME_PATTERN.is_match(request) {
        add_grant(
            &mut grants,
            "rename_resource",
            &application_resources,
            permits_safe_defaults,
        );
    }
    if MOVE_PATTERN.is_match(request) {
        add_grant(
            &mut grants,
            "move_resource",
            &application_resources,
            permits_safe_defaults,
        );
    }
    if COMMENT_PATTERN.is_match(request) {
        add_grant(
            &mut grants,
            "add_comment",
            &["comment".to_owned()],
            permits_safe_defaults,
        );
    }
    if execution_profile == "workspace" {
        if WORKSPACE_MUTATION_PATTERN.is_match(request) {
            add_grant(
                &mut grants,
                "workspace_write",
                &["workspace_file".to_owned()],
                permits_safe_defaults,
            );
        }
        if WORKSPACE_MUTATION_PATTERN.is_match(request)
            || WORKSPACE_COMMAND_PATTERN.is_match(request)
        {
            add_grant(
                &mut grants,
                "workspace_command",
                &["workspace_repository".to_owned()],
                permits_safe_defaults,
            );
        }
    }
    grants.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(IntentAuthorizationContract {
        schema_version: 1,
        revision,
        source: "user_instruction".to_owned(),
        grants,
    })
}

pub fn empty_intent_authorization(revision: u32) -> IntentAuthorizationContract {
    IntentAuthorizationContract {
        schema_version: 1,
        revision,
        source: "user_instruction".to_owned(),
        grants: Vec::new(),
    }
}

pub fn intent_authorization_digest(
    contract: &IntentAuthorizationContract,
) -> anyhow::Result<String> {
    validate_intent_authorization(contract)?;
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(contract)?)
    ))
}

pub fn evaluate_action(input: EvaluateActionInput) -> anyhow::Result<PolicyDecision> {
    if input.goal.schema_version != 8 {
        bail!("The Rust desktop policy engine accepts only task contract v8.");
    }
    validate_intent_authorization(&input.goal.intent_authorization)?;
    validate_action(&input.action)?;
    input.proposed_effect.validate()?;

    let host_effect = resolve_action_effect(&input.action)?;
    let mut proposed_action = input.action.clone();
    proposed_action.effect = Some(input.proposed_effect);
    let proposed_effect = resolve_action_effect(&proposed_action)?;
    let effect = raise_action_effect(host_effect, proposed_effect);
    let consequential = effect.kind != "none";

    if !input.supported || !hosted_tool_supports(&input.action) {
        return Ok(decision(
            "denied",
            effect,
            "none",
            false,
            consequential,
            "The requested runtime tool operation is unavailable.",
            &["Choose an operation exposed by the current runtime."],
        ));
    }
    if input.action.tool_id.as_deref() == Some("activity.signal")
        && !activity_signal_allowed(&input.goal, &input.action)
    {
        return Ok(decision(
            "denied",
            effect,
            "none",
            false,
            consequential,
            "Activity evidence is outside the pinned Attempt policy.",
            &["Continue without recording inferred evidence."],
        ));
    }
    if !target_is_admissible(&input.action) {
        return Ok(decision(
            "denied",
            effect,
            "none",
            false,
            consequential,
            "The proposed browser target is not an admissible public HTTPS URL.",
            &["Choose a public HTTPS target without embedded credentials."],
        ));
    }
    if is_tro_approval_ui_action(&input.action) {
        let mut result = decision(
            "denied",
            effect,
            "none",
            false,
            consequential,
            "Tro stopped an approval loop. The agent cannot operate Tro approval controls.",
            &["Only the user can approve or deny a consequential action from the approval card."],
        );
        result.terminal = Some(true);
        return Ok(result);
    }

    if is_sensitive(&input.goal, &input.action, &effect) {
        let reason = sensitive_reason(&input.goal, &input.action, &effect);
        return Ok(decision(
            "needs_approval",
            effect,
            "none",
            true,
            consequential,
            &format!(
                "{} requires explicit user approval. {}",
                input.action.description, reason
            ),
            &["Present a scoped approval request to the user."],
        ));
    }

    if effect.kind != "none" {
        if matches_intent_authorization(&input.goal.intent_authorization, &effect) {
            return Ok(decision(
                "allowed",
                effect,
                "user_instruction",
                false,
                consequential,
                &input.action.description,
                &["Execute once under the user instruction, then observe and verify the result."],
            ));
        }
        return Ok(decision(
            "needs_approval",
            effect,
            "none",
            true,
            consequential,
            &format!(
                "{} is outside the current instruction authorization.",
                input.action.description
            ),
            &["Present a scoped approval request to the user."],
        ));
    }

    Ok(decision(
        "allowed",
        effect,
        "routine",
        false,
        consequential,
        &input.action.description,
        &["Execute once, then observe and verify the result."],
    ))
}

fn resource_kinds_for(request: &str) -> Vec<String> {
    let patterns = [
        (
            "calendar_event",
            r"(?i)\b(?:appointment|calendar|event|meeting)\b",
        ),
        (
            "email",
            r"(?i)\b(?:draft|email|gmail|inbox|mail|message|thread)\b",
        ),
        ("spreadsheet_row", r"(?i)\b(?:row|rows)\b"),
        ("spreadsheet", r"(?i)\b(?:sheet|spreadsheet|workbook)\b"),
        ("document", r"(?i)\b(?:doc|document|page|report)\b"),
        ("comment", r"(?i)\bcomment\b"),
        ("issue", r"(?i)\bissue\b"),
        ("pull_request", r"(?i)\b(?:pull\s+request|pr)\b"),
        (
            "workspace_file",
            r"(?i)\b(?:code|file|files|repository|repo|workspace)\b",
        ),
    ];
    patterns
        .iter()
        .filter(|(_, pattern)| {
            Regex::new(pattern)
                .expect("valid resource pattern")
                .is_match(request)
        })
        .map(|(resource, _)| (*resource).to_owned())
        .collect()
}

fn add_grant(
    grants: &mut Vec<IntentAuthorizationGrant>,
    effect_kind: &str,
    resource_kinds: &[String],
    permits_safe_defaults: bool,
) {
    if resource_kinds.is_empty() {
        return;
    }
    let mut resource_kinds = resource_kinds.to_vec();
    resource_kinds.sort();
    resource_kinds.dedup();
    let resource_digest = format!("{:x}", Sha256::digest(resource_kinds.join(",").as_bytes()));
    let id = format!(
        "{}-{}",
        effect_kind.replace('_', "-"),
        &resource_digest[..12]
    );
    if grants.iter().any(|grant| grant.id == id) {
        return;
    }
    grants.push(IntentAuthorizationGrant {
        id,
        effect_kind: effect_kind.to_owned(),
        resource_kinds,
        permits_safe_defaults,
    });
}

fn validate_intent_authorization(contract: &IntentAuthorizationContract) -> anyhow::Result<()> {
    if contract.schema_version != 1
        || contract.source != "user_instruction"
        || !(1..=10_000).contains(&contract.revision)
        || contract.grants.len() > 30
    {
        bail!("The intent authorization contract is invalid.");
    }
    let mut ids = std::collections::BTreeSet::new();
    for grant in &contract.grants {
        if !ids.insert(&grant.id)
            || !valid_grant_id(&grant.id)
            || !AUTO_AUTHORIZABLE_EFFECTS.contains(&grant.effect_kind.as_str())
            || grant.resource_kinds.is_empty()
            || grant.resource_kinds.len() > 20
            || grant
                .resource_kinds
                .iter()
                .any(|resource| !RESOURCE_KINDS.contains(&resource.as_str()))
        {
            bail!("The intent authorization grant is invalid.");
        }
        let unique: std::collections::BTreeSet<_> = grant.resource_kinds.iter().collect();
        if unique.len() != grant.resource_kinds.len() {
            bail!("Intent authorization resources must be unique.");
        }
    }
    Ok(())
}

fn validate_action(action: &ProposedAction) -> anyhow::Result<()> {
    if !matches!(
        action.action.as_str(),
        "login"
            | "send"
            | "submit"
            | "upload"
            | "download"
            | "delete"
            | "purchase"
            | "install"
            | "run_command"
            | "write_file"
            | "system_permission"
            | "answer"
            | "guide"
            | "observe_screen"
            | "open_application"
            | "open_url"
            | "click_element"
            | "type_text"
            | "press_key"
            | "scroll"
            | "drag"
            | "read_file"
            | "record_activity_signal"
    ) || action.description.is_empty()
        || action
            .operation
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 100)
        || action.parameters.len() > 64
        || action.parameters.iter().any(|(key, value)| {
            key.is_empty()
                || key.len() > 100
                || match value {
                    Value::String(value) => value.chars().count() > 100_000,
                    Value::Array(values) => {
                        values.len() > 100
                            || values.iter().any(|value| {
                                value
                                    .as_str()
                                    .is_none_or(|value| value.chars().count() > 8_000)
                            })
                    }
                    _ => true,
                }
        })
    {
        bail!("The proposed action is invalid.");
    }
    if let Some(effect) = &action.effect {
        effect.validate()?;
    }
    Ok(())
}

fn valid_grant_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn effect(
    kind: &str,
    resource_kind: Option<&str>,
    reversibility: &str,
    externality: &str,
    communication: &str,
    overwrite: &str,
    sensitive_data_transfer: SensitiveDataTransfer,
) -> ActionEffect {
    ActionEffect {
        kind: kind.to_owned(),
        resource_kind: resource_kind.map(str::to_owned),
        reversibility: reversibility.to_owned(),
        externality: externality.to_owned(),
        communication: communication.to_owned(),
        overwrite: overwrite.to_owned(),
        sensitive_data_transfer,
    }
}

fn effect_free() -> ActionEffect {
    effect(
        "none",
        None,
        "none",
        "local",
        "none",
        "none",
        SensitiveDataTransfer::Boolean(false),
    )
}

fn unknown_effect(resource_kind: &str) -> ActionEffect {
    effect(
        "unknown",
        Some(resource_kind),
        "unknown",
        "unknown",
        "unknown",
        "unknown",
        SensitiveDataTransfer::Unknown("unknown".to_owned()),
    )
}

fn consequence_effect(consequence: &str) -> ActionEffect {
    match consequence {
        "login" => effect(
            "authentication_or_credential",
            Some("application"),
            "reversible",
            "external",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ),
        "send" => effect(
            "send_communication",
            Some("message"),
            "reversible",
            "external",
            "send",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ),
        "submit" => unknown_effect("form_submission"),
        "upload" => effect(
            "sensitive_transfer",
            Some("generic_private_resource"),
            "reversible",
            "external",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(true),
        ),
        "download" => effect(
            "create_resource",
            Some("download"),
            "reversible",
            "local",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ),
        "delete" => effect(
            "delete_or_archive",
            Some("generic_private_resource"),
            "destructive",
            "cloud_private",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ),
        "purchase" => effect(
            "financial_or_trade",
            Some("generic_private_resource"),
            "reversible",
            "external",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ),
        "install" => effect(
            "install",
            Some("application"),
            "reversible",
            "local",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ),
        "run_command" => effect(
            "workspace_command",
            Some("workspace_repository"),
            "reversible",
            "local",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ),
        "write_file" => effect(
            "workspace_write",
            Some("workspace_file"),
            "reversible",
            "local",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ),
        "system_permission" => effect(
            "system_permission",
            Some("application"),
            "reversible",
            "local",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ),
        _ => effect_free(),
    }
}

fn resolve_action_effect(action: &ProposedAction) -> anyhow::Result<ActionEffect> {
    let consequence = action
        .parameters
        .get("declaredConsequence")
        .and_then(Value::as_str)
        .unwrap_or(&action.action);
    let declared = consequence_effect(consequence);
    let mut resolved = match &action.effect {
        Some(proposed) => raise_action_effect(declared, proposed.clone()),
        None => declared,
    };
    if matches!(
        resolved.communication.as_str(),
        "send" | "invite" | "notify"
    ) {
        let resource = resolved
            .resource_kind
            .as_deref()
            .unwrap_or("message")
            .to_owned();
        resolved = effect(
            "send_communication",
            Some(&resource),
            "reversible",
            "external",
            &resolved.communication,
            "none",
            SensitiveDataTransfer::Boolean(false),
        );
    } else if resolved.reversibility == "destructive" {
        let resource = resolved
            .resource_kind
            .as_deref()
            .unwrap_or("generic_private_resource")
            .to_owned();
        resolved = effect(
            "delete_or_archive",
            Some(&resource),
            "destructive",
            "cloud_private",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        );
    } else if resolved.overwrite == "unexpected" {
        let resource = resolved
            .resource_kind
            .as_deref()
            .unwrap_or("generic_private_resource")
            .to_owned();
        resolved = effect(
            "unexpected_overwrite",
            Some(&resource),
            "reversible",
            "cloud_private",
            "none",
            "unexpected",
            SensitiveDataTransfer::Boolean(false),
        );
    } else if resolved.externality == "public" {
        let resource = resolved
            .resource_kind
            .as_deref()
            .unwrap_or("generic_public_resource")
            .to_owned();
        resolved = effect(
            "publish",
            Some(&resource),
            "reversible",
            "public",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        );
    } else if resolved.sensitive_data_transfer == SensitiveDataTransfer::Boolean(true) {
        let resource = resolved
            .resource_kind
            .as_deref()
            .unwrap_or("generic_private_resource")
            .to_owned();
        resolved = effect(
            "sensitive_transfer",
            Some(&resource),
            "reversible",
            "external",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(true),
        );
    }
    raised_visible_effect(action, resolved)
}

fn raised_visible_effect(
    action: &ProposedAction,
    current: ActionEffect,
) -> anyhow::Result<ActionEffect> {
    if parameter_string(action, "targetOpaque") == Some("true")
        || parameter_string(action, "observationStale") == Some("true")
    {
        return Ok(unknown_effect(
            current
                .resource_kind
                .as_deref()
                .unwrap_or("generic_private_resource"),
        ));
    }
    let recipients = action
        .parameters
        .get("recipients")
        .or_else(|| action.parameters.get("attendees"));
    let has_recipients = recipients.is_some_and(|value| match value {
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(values) => !values.is_empty(),
        _ => false,
    });
    let text = visible_risk_text(action);
    if has_recipients || VISIBLE_SEND_PATTERN.is_match(&text) {
        let calendar = action
            .effect
            .as_ref()
            .and_then(|value| value.resource_kind.as_deref())
            == Some("calendar_event");
        return Ok(effect(
            "send_communication",
            Some(if calendar {
                "calendar_event"
            } else if action.parameters.contains_key("subject") {
                "email"
            } else {
                "message"
            }),
            "reversible",
            "external",
            if calendar { "invite" } else { "send" },
            "none",
            SensitiveDataTransfer::Boolean(false),
        ));
    }
    let resource = current
        .resource_kind
        .as_deref()
        .unwrap_or("generic_private_resource");
    if VISIBLE_DELETE_PATTERN.is_match(&text) {
        return Ok(effect(
            "delete_or_archive",
            Some(resource),
            "destructive",
            "cloud_private",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ));
    }
    if VISIBLE_FINANCIAL_PATTERN.is_match(&text) {
        return Ok(effect(
            "financial_or_trade",
            Some("generic_private_resource"),
            "reversible",
            "external",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ));
    }
    if VISIBLE_AUTH_PATTERN.is_match(&text) {
        return Ok(effect(
            "authentication_or_credential",
            Some("application"),
            "reversible",
            "external",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ));
    }
    if VISIBLE_PERMISSION_PATTERN.is_match(&text) {
        return Ok(effect(
            "system_permission",
            Some("application"),
            "reversible",
            "local",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ));
    }
    if VISIBLE_INSTALL_PATTERN.is_match(&text) {
        return Ok(effect(
            "install",
            Some("application"),
            "reversible",
            "local",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ));
    }
    if VISIBLE_PUBLISH_PATTERN.is_match(&text) {
        return Ok(effect(
            "publish",
            Some("generic_public_resource"),
            "reversible",
            "public",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ));
    }
    if VISIBLE_DEPLOY_PATTERN.is_match(&text) {
        return Ok(effect(
            "deploy",
            Some("generic_public_resource"),
            "reversible",
            "public",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ));
    }
    if VISIBLE_MERGE_PATTERN.is_match(&text) {
        return Ok(effect(
            "merge",
            Some("pull_request"),
            "reversible",
            "external",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(false),
        ));
    }
    if VISIBLE_TRANSFER_PATTERN.is_match(&text) {
        return Ok(effect(
            "sensitive_transfer",
            Some(resource),
            "reversible",
            "external",
            "none",
            "none",
            SensitiveDataTransfer::Boolean(true),
        ));
    }
    if current.kind == "none" && VISIBLE_SUBMIT_PATTERN.is_match(&text) {
        return Ok(unknown_effect("form_submission"));
    }
    current
        .validate()
        .context("The resolved action effect is invalid.")?;
    Ok(current)
}

fn raise_action_effect(host: ActionEffect, proposed: ActionEffect) -> ActionEffect {
    if is_hard_confirm_effect(&host) {
        return host;
    }
    if is_hard_confirm_effect(&proposed) {
        return proposed;
    }
    if host.kind == "none" {
        return proposed;
    }
    if proposed.kind == "none" {
        return host;
    }
    if host.kind != proposed.kind || host.resource_kind != proposed.resource_kind {
        return unknown_effect(
            host.resource_kind
                .as_deref()
                .or(proposed.resource_kind.as_deref())
                .unwrap_or("generic_private_resource"),
        );
    }
    host
}

fn is_hard_confirm_effect(effect: &ActionEffect) -> bool {
    HARD_CONFIRM_EFFECTS.contains(&effect.kind.as_str())
        || matches!(
            effect.communication.as_str(),
            "send" | "invite" | "notify" | "unknown"
        )
        || matches!(effect.reversibility.as_str(), "destructive" | "unknown")
        || matches!(effect.overwrite.as_str(), "unexpected" | "unknown")
        || matches!(
            effect.externality.as_str(),
            "external" | "public" | "unknown"
        )
        || effect.sensitive_data_transfer != SensitiveDataTransfer::Boolean(false)
}

fn visible_risk_text(action: &ProposedAction) -> String {
    let mut values = vec![action.description.clone()];
    if let Some(target) = &action.target {
        values.push(target.clone());
    }
    for key in [
        "application",
        "ariaLabel",
        "controlLabel",
        "controlValue",
        "href",
        "role",
        "visibleText",
    ] {
        if let Some(value) = action.parameters.get(key) {
            match value {
                Value::String(value) => values.push(value.clone()),
                Value::Array(items) => {
                    values.extend(items.iter().filter_map(Value::as_str).map(str::to_owned))
                }
                _ => {}
            }
        }
    }
    values.join(" ").chars().take(120_000).collect()
}

fn hosted_tool_supports(action: &ProposedAction) -> bool {
    let (Some(tool), Some(operation)) = (&action.tool_id, &action.operation) else {
        return false;
    };
    if tool == "connector.gmail" {
        return crate::connectors::catalog::tool("gmail", operation).is_some();
    }
    tool_catalog::by_id(tool)
        .is_some_and(|candidate| candidate.operations.iter().any(|value| value == operation))
}

fn activity_signal_allowed(goal: &PolicyGoal, action: &ProposedAction) -> bool {
    let Some(activity) = goal.activity.as_ref() else {
        return false;
    };
    if activity.get("insightPolicy").and_then(Value::as_str) != Some("evidence_candidates")
        || activity.get("policyAcknowledged").and_then(Value::as_bool) != Some(true)
        || action.operation.as_deref() != Some("record")
        || action.action != "record_activity_signal"
        || action.target.as_deref() != activity.get("attemptId").and_then(Value::as_str)
    {
        return false;
    }
    let Some(criterion_id) = parameter_string(action, "criterionId") else {
        return false;
    };
    let Some(tag) = parameter_string(action, "tag") else {
        return false;
    };
    activity
        .pointer("/activity/criteria")
        .and_then(Value::as_array)
        .is_some_and(|criteria| {
            criteria.iter().any(|criterion| {
                criterion.get("id").and_then(Value::as_str) == Some(criterion_id)
                    && criterion
                        .get("tags")
                        .and_then(Value::as_array)
                        .is_some_and(|tags| tags.iter().any(|value| value.as_str() == Some(tag)))
            })
        })
}

fn target_is_admissible(action: &ProposedAction) -> bool {
    if action.action != "open_url" {
        return true;
    }
    let Some(target) = action.target.as_deref() else {
        return true;
    };
    let Ok(url) = Url::parse(target) else {
        return false;
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    is_public_hostname(host)
}

fn is_public_hostname(host: &str) -> bool {
    let normalized = host
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
    match normalized.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => {
            !(address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified())
        }
        Ok(IpAddr::V6(address)) => {
            let segments = address.segments();
            let unique_local = segments[0] & 0xfe00 == 0xfc00;
            let link_local = segments[0] & 0xffc0 == 0xfe80;
            !(address.is_loopback() || address.is_unspecified() || unique_local || link_local)
        }
        Err(_) => true,
    }
}

fn is_tro_approval_ui_action(action: &ProposedAction) -> bool {
    if !matches!(
        action.tool_id.as_deref(),
        Some("desktop.control" | "computer.control")
    ) {
        return false;
    }
    let text = [
        Some(action.description.as_str()),
        action.target.as_deref(),
        parameter_string(action, "application"),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    (APPROVAL_PATTERN.is_match(&text) && TROCODE_PATTERN.is_match(&text))
        || INTERNAL_APPROVAL_PATTERN.is_match(&text)
}

fn is_sensitive(goal: &PolicyGoal, action: &ProposedAction, effect: &ActionEffect) -> bool {
    if is_hard_confirm_effect(effect) {
        return true;
    }
    let computer_control = matches!(
        action.tool_id.as_deref(),
        Some("desktop.control" | "computer.control")
    );
    let routine_control = matches!(
        action.action.as_str(),
        "click_element" | "type_text" | "press_key" | "scroll" | "drag"
    );
    goal.autonomy_mode == "strict"
        && ((computer_control && routine_control) || effect.kind != "none")
}

fn sensitive_reason(
    goal: &PolicyGoal,
    action: &ProposedAction,
    effect: &ActionEffect,
) -> &'static str {
    if is_hard_confirm_effect(effect) {
        "The host-normalized effect requires exact approval."
    } else if goal.autonomy_mode == "strict"
        && (matches!(
            action.tool_id.as_deref(),
            Some("desktop.control" | "computer.control")
        ) || effect.kind != "none")
    {
        "Strict autonomy confirms every mutation."
    } else {
        "The action is outside routine policy."
    }
}

fn matches_intent_authorization(
    contract: &IntentAuthorizationContract,
    effect: &ActionEffect,
) -> bool {
    let Some(resource) = effect.resource_kind.as_deref() else {
        return false;
    };
    if effect.reversibility != "reversible"
        || !matches!(effect.externality.as_str(), "local" | "cloud_private")
        || !matches!(effect.communication.as_str(), "none" | "draft")
        || !matches!(effect.overwrite.as_str(), "none" | "requested")
        || effect.sensitive_data_transfer != SensitiveDataTransfer::Boolean(false)
    {
        return false;
    }
    contract.grants.iter().any(|grant| {
        grant.effect_kind == effect.kind
            && grant
                .resource_kinds
                .iter()
                .any(|candidate| candidate == resource)
    })
}

fn parameter_string<'a>(action: &'a ProposedAction, key: &str) -> Option<&'a str> {
    action.parameters.get(key).and_then(Value::as_str)
}

fn decision(
    status: &str,
    effect: ActionEffect,
    authorization_source: &str,
    approval_required: bool,
    consequential: bool,
    summary: &str,
    next_actions: &[&str],
) -> PolicyDecision {
    PolicyDecision {
        terminal: None,
        status: status.to_owned(),
        effect,
        authorization_source: authorization_source.to_owned(),
        approval_required,
        consequential,
        summary: summary.to_owned(),
        next_actions: next_actions
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_json::json;

    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct IntentFixture {
        request: String,
        execution_profile: String,
        revision: u32,
        expected_digest: String,
        expected: Vec<ExpectedGrant>,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct ExpectedGrant {
        effect_kind: String,
        resource_kinds: Vec<String>,
        permits_safe_defaults: bool,
    }

    #[test]
    fn intent_compiler_matches_shared_typescript_fixtures() {
        let fixtures: Vec<IntentFixture> = serde_json::from_str(include_str!(
            "../../../../test/fixtures/intent-authorization-cases.json"
        ))
        .expect("valid intent fixtures");
        for fixture in fixtures {
            let contract = compile_intent_authorization(
                &fixture.request,
                &fixture.execution_profile,
                fixture.revision,
            )
            .expect("intent contract");
            let actual = contract
                .grants
                .iter()
                .map(|grant| ExpectedGrant {
                    effect_kind: grant.effect_kind.clone(),
                    resource_kinds: grant.resource_kinds.clone(),
                    permits_safe_defaults: grant.permits_safe_defaults,
                })
                .collect::<Vec<_>>();
            assert_eq!(actual, fixture.expected);
            assert_eq!(
                intent_authorization_digest(&contract).expect("digest"),
                fixture.expected_digest
            );
        }
    }

    #[test]
    fn workspace_instruction_allows_reversible_write_without_approval() {
        let contract = compile_intent_authorization("Update the workspace file.", "workspace", 1)
            .expect("contract");
        let input: EvaluateActionInput = serde_json::from_value(json!({
            "goal": {
                "schemaVersion": 8,
                "autonomyMode": "balanced",
                "activity": null,
                "intentAuthorization": contract
            },
            "action": {
                "action": "write_file",
                "toolId": "workspace.filesystem",
                "operation": "write_file",
                "effect": {
                    "kind": "workspace_write",
                    "resourceKind": "workspace_file",
                    "reversibility": "reversible",
                    "externality": "local",
                    "communication": "none",
                    "overwrite": "requested",
                    "sensitiveDataTransfer": false
                },
                "description": "Update the workspace file.",
                "parameters": {}
            },
            "proposedEffect": {
                "kind": "workspace_write",
                "resourceKind": "workspace_file",
                "reversibility": "reversible",
                "externality": "local",
                "communication": "none",
                "overwrite": "requested",
                "sensitiveDataTransfer": false
            },
            "supported": true
        }))
        .expect("policy input");
        let result = evaluate_action(input).expect("policy result");
        assert_eq!(result.status, "allowed");
        assert_eq!(result.authorization_source, "user_instruction");
        assert!(!result.approval_required);
    }

    #[test]
    fn visible_send_is_raised_to_exact_approval() {
        let input: EvaluateActionInput = serde_json::from_value(json!({
            "goal": {
                "schemaVersion": 8,
                "autonomyMode": "balanced",
                "activity": null,
                "intentAuthorization": empty_intent_authorization(1)
            },
            "action": {
                "action": "click_element",
                "toolId": "desktop.control",
                "operation": "click",
                "effect": {
                    "kind": "none",
                    "resourceKind": null,
                    "reversibility": "none",
                    "externality": "local",
                    "communication": "none",
                    "overwrite": "none",
                    "sensitiveDataTransfer": false
                },
                "description": "Click the visible Send button.",
                "target": "Send",
                "parameters": {}
            },
            "proposedEffect": {
                "kind": "none",
                "resourceKind": null,
                "reversibility": "none",
                "externality": "local",
                "communication": "none",
                "overwrite": "none",
                "sensitiveDataTransfer": false
            },
            "supported": true
        }))
        .expect("policy input");
        let result = evaluate_action(input).expect("policy result");
        assert_eq!(result.status, "needs_approval");
        assert_eq!(result.effect.kind, "send_communication");
    }
}
