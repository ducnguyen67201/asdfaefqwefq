use anyhow::bail;
use serde::{Deserialize, Serialize};

const EFFECT_KINDS: &[&str] = &[
    "none",
    "create_resource",
    "update_resource",
    "rename_resource",
    "move_resource",
    "add_comment",
    "workspace_write",
    "workspace_command",
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

impl ActionEffect {
    pub fn validate(&self) -> anyhow::Result<()> {
        if !EFFECT_KINDS.contains(&self.kind.as_str()) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_inconsistent_effect_metadata_without_making_an_action_decision() {
        let effect = ActionEffect {
            kind: "none".to_owned(),
            resource_kind: None,
            reversibility: "destructive".to_owned(),
            externality: "local".to_owned(),
            communication: "none".to_owned(),
            overwrite: "none".to_owned(),
            sensitive_data_transfer: SensitiveDataTransfer::Boolean(false),
        };
        assert!(effect.validate().is_err());
    }
}
