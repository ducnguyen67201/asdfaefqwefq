use super::protocol::{AgentRunActionV3, AgentRunPhaseV3, AgentRunStateV3};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TransitionCommand {
    CompileOutcomes,
    Plan,
    WaitForWorker,
    WaitForPermission,
    ExecuteTool,
    WaitForInput,
    WaitForApproval,
    Verify,
    Recover,
    Complete,
    Block,
    Fail,
    Cancel { consequential_execution: bool },
    Expire,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LifecycleProjection {
    pub actions: Vec<AgentRunActionV3>,
    pub phase: AgentRunPhaseV3,
    pub terminal: bool,
}

pub fn transition(
    from: &AgentRunStateV3,
    command: TransitionCommand,
) -> Result<AgentRunStateV3, &'static str> {
    use AgentRunStateV3::{
        AwaitingApproval, AwaitingInput, AwaitingPermission, AwaitingWorker, Blocked, Cancelled,
        CompilingOutcomes, Completed, ExecutingTool, Expired, Failed, Planning, Queued, Recovering,
        Verifying,
    };
    use TransitionCommand::{
        Block, Cancel, CompileOutcomes as Compile, Complete, ExecuteTool, Expire, Fail, Plan,
        Recover, Verify, WaitForApproval, WaitForInput, WaitForPermission, WaitForWorker,
    };

    if matches!(from, Completed | Blocked | Failed | Cancelled | Expired) {
        return Err("terminal agent runs cannot transition");
    }
    if let Cancel {
        consequential_execution,
    } = command
    {
        return Ok(
            if matches!(from, ExecutingTool) && consequential_execution {
                Blocked
            } else {
                Cancelled
            },
        );
    }
    if matches!(command, Fail) {
        return Ok(Failed);
    }
    if matches!(command, Expire) {
        return Ok(Expired);
    }

    let next = match (from, command) {
        (Queued, Compile) => CompilingOutcomes,
        (Queued | CompilingOutcomes | Recovering | Verifying, Plan) => Planning,
        (Planning | Recovering, WaitForWorker) => AwaitingWorker,
        (Planning | AwaitingWorker | Recovering, WaitForPermission) => AwaitingPermission,
        (Planning | AwaitingWorker | AwaitingPermission | Recovering, ExecuteTool) => ExecutingTool,
        (CompilingOutcomes | Planning | Recovering, WaitForInput) => AwaitingInput,
        (Planning | Recovering, WaitForApproval) => AwaitingApproval,
        (Planning | ExecutingTool | Recovering, Verify) => Verifying,
        (
            Planning | AwaitingWorker | AwaitingPermission | AwaitingInput | AwaitingApproval
            | ExecutingTool | Verifying,
            Recover,
        ) => Recovering,
        (Planning | Verifying, Complete) => Completed,
        (Planning | ExecutingTool | Verifying | Recovering, Block) => Blocked,
        _ => return Err("agent runtime transition is not allowed"),
    };
    Ok(next)
}

#[must_use]
pub fn project(state: &AgentRunStateV3) -> LifecycleProjection {
    use AgentRunActionV3::{
        Approve, Cancel, ContinueWithoutComputer, Deny, OpenSystemSettings, Respond, Steer,
    };
    use AgentRunPhaseV3::{
        Acting, AwaitingApproval as ApprovalPhase, AwaitingInput as InputPhase,
        AwaitingPermission as PermissionPhase, Blocked as BlockedPhase,
        Cancelled as CancelledPhase, Completed as CompletedPhase, Failed as FailedPhase, Paused,
        Planning as PlanningPhase, Ready, Verifying as VerifyingPhase,
    };
    use AgentRunStateV3::{
        AwaitingApproval, AwaitingInput, AwaitingPermission, AwaitingWorker, Blocked, Cancelled,
        CompilingOutcomes, Completed, ExecutingTool, Expired, Failed, Planning, Queued, Recovering,
        Verifying,
    };

    let (phase, terminal, actions) = match state {
        Queued | CompilingOutcomes => (Ready, false, vec![Cancel]),
        Planning | Recovering => (PlanningPhase, false, vec![Steer, Cancel]),
        AwaitingWorker => (Paused, false, vec![Steer, Cancel]),
        AwaitingPermission => (
            PermissionPhase,
            false,
            vec![OpenSystemSettings, ContinueWithoutComputer, Cancel],
        ),
        AwaitingInput => (InputPhase, false, vec![Respond, Cancel]),
        AwaitingApproval => (ApprovalPhase, false, vec![Approve, Deny, Cancel]),
        ExecutingTool => (Acting, false, vec![Cancel]),
        Verifying => (VerifyingPhase, false, vec![Cancel]),
        Completed => (CompletedPhase, true, Vec::new()),
        Blocked => (BlockedPhase, true, Vec::new()),
        Failed | Expired => (FailedPhase, true, Vec::new()),
        Cancelled => (CancelledPhase, true, Vec::new()),
    };
    LifecycleProjection {
        actions,
        phase,
        terminal,
    }
}

#[cfg(test)]
mod tests {
    use super::{TransitionCommand, project, transition};
    use crate::agent::protocol::AgentRunStateV3;

    #[test]
    fn blocked_is_terminal_and_never_cancellable() {
        let projection = project(&AgentRunStateV3::Blocked);
        assert!(projection.terminal);
        assert!(projection.actions.is_empty());
        assert_eq!(
            transition(
                &AgentRunStateV3::Blocked,
                TransitionCommand::Cancel {
                    consequential_execution: false,
                },
            ),
            Err("terminal agent runs cannot transition")
        );
    }

    #[test]
    fn permission_is_a_durable_nonterminal_wait() {
        let next = transition(
            &AgentRunStateV3::AwaitingWorker,
            TransitionCommand::WaitForPermission,
        )
        .expect("permission wait is allowed");
        let projection = project(&next);
        assert!(!projection.terminal);
        assert_eq!(projection.actions.len(), 3);
    }

    #[test]
    fn consequential_cancel_preserves_unknown_outcome() {
        assert_eq!(
            transition(
                &AgentRunStateV3::ExecutingTool,
                TransitionCommand::Cancel {
                    consequential_execution: true,
                },
            ),
            Ok(AgentRunStateV3::Blocked)
        );
    }
}
