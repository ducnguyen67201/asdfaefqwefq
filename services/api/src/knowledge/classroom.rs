#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClassroomRole {
    Unassigned,
    Teacher,
    Student,
}

impl ClassroomRole {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "unassigned" => Some(Self::Unassigned),
            "teacher" => Some(Self::Teacher),
            "student" => Some(Self::Student),
            _ => None,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unassigned => "unassigned",
            Self::Teacher => "teacher",
            Self::Student => "student",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SpaceRole {
    Owner,
    Facilitator,
    Participant,
}

impl SpaceRole {
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "owner" => Some(Self::Owner),
            "facilitator" => Some(Self::Facilitator),
            "participant" => Some(Self::Participant),
            _ => None,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Facilitator => "facilitator",
            Self::Participant => "participant",
        }
    }

    #[must_use]
    pub const fn expected_classroom_role(self) -> ClassroomRole {
        match self {
            Self::Owner | Self::Facilitator => ClassroomRole::Teacher,
            Self::Participant => ClassroomRole::Student,
        }
    }
}

#[must_use]
pub const fn classroom_role_allows_space_role(
    classroom_role: ClassroomRole,
    space_role: SpaceRole,
) -> bool {
    match classroom_role {
        ClassroomRole::Teacher => true,
        ClassroomRole::Student => matches!(space_role, SpaceRole::Participant),
        ClassroomRole::Unassigned => false,
    }
}

#[must_use]
pub const fn can_add_member(actor: SpaceRole, requested: SpaceRole) -> bool {
    match actor {
        SpaceRole::Owner => matches!(requested, SpaceRole::Facilitator | SpaceRole::Participant),
        SpaceRole::Facilitator => matches!(requested, SpaceRole::Participant),
        SpaceRole::Participant => false,
    }
}

#[must_use]
pub fn classroom_role_conflicts_with_memberships<'a>(
    classroom_role: ClassroomRole,
    membership_roles: impl IntoIterator<Item = &'a str>,
) -> bool {
    membership_roles.into_iter().any(|role| {
        SpaceRole::parse(role)
            .is_none_or(|space_role| !classroom_role_allows_space_role(classroom_role, space_role))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_roles_bound_space_roles() {
        assert!(classroom_role_allows_space_role(
            ClassroomRole::Teacher,
            SpaceRole::Participant
        ));
        assert!(classroom_role_allows_space_role(
            ClassroomRole::Student,
            SpaceRole::Participant
        ));
        assert!(!classroom_role_allows_space_role(
            ClassroomRole::Student,
            SpaceRole::Facilitator
        ));
        assert!(classroom_role_allows_space_role(
            ClassroomRole::Teacher,
            SpaceRole::Facilitator
        ));
        assert!(!classroom_role_allows_space_role(
            ClassroomRole::Unassigned,
            SpaceRole::Participant
        ));
    }

    #[test]
    fn owners_and_facilitators_have_distinct_roster_authority() {
        assert!(can_add_member(SpaceRole::Owner, SpaceRole::Facilitator));
        assert!(can_add_member(SpaceRole::Owner, SpaceRole::Participant));
        assert!(!can_add_member(
            SpaceRole::Facilitator,
            SpaceRole::Facilitator
        ));
        assert!(can_add_member(
            SpaceRole::Facilitator,
            SpaceRole::Participant
        ));
        assert!(!can_add_member(
            SpaceRole::Participant,
            SpaceRole::Participant
        ));
    }

    #[test]
    fn role_changes_reject_incompatible_active_memberships() {
        assert!(classroom_role_conflicts_with_memberships(
            ClassroomRole::Unassigned,
            ["participant"]
        ));
        assert!(classroom_role_conflicts_with_memberships(
            ClassroomRole::Student,
            ["facilitator"]
        ));
        assert!(!classroom_role_conflicts_with_memberships(
            ClassroomRole::Student,
            ["participant"]
        ));
        assert!(!classroom_role_conflicts_with_memberships(
            ClassroomRole::Teacher,
            ["owner", "participant"]
        ));
    }
}
