/**
 * Read-only protocol-v2 compatibility boundary.
 *
 * New task creation and desktop execution must use agent-runtime-protocol.ts.
 */
export {
  HostedDesktopInvocationSchema as LegacyHostedDesktopInvocationV2Schema,
  HostedTaskEventSchema as LegacyHostedTaskEventV2Schema,
  HostedTaskListSchema as LegacyHostedTaskListV2Schema,
  HostedTaskRecordSchema as LegacyHostedTaskRecordV2Schema,
  HostedWorkerSessionSchema as LegacyHostedWorkerSessionV2Schema,
  type HostedDesktopInvocation as LegacyHostedDesktopInvocationV2,
  type HostedTaskEvent as LegacyHostedTaskEventV2,
  type HostedTaskRecord as LegacyHostedTaskRecordV2,
} from './contracts';

import type { HostedTaskRecord, TaskPhase } from './contracts';

const LEGACY_TERMINAL_STATES: ReadonlySet<HostedTaskRecord['state']> = new Set([
  'completed',
  'blocked',
  'failed',
  'cancelled',
  'expired',
]);

export function isLegacyHostedTaskTerminal(
  state: HostedTaskRecord['state'],
): boolean {
  return LEGACY_TERMINAL_STATES.has(state);
}

export function legacyTaskPhaseForHostedState(
  state: HostedTaskRecord['state'],
): TaskPhase {
  switch (state) {
    case 'queued':
    case 'compiling_outcomes':
      return 'ready';
    case 'planning':
    case 'recovering':
      return 'planning';
    case 'awaiting_worker':
      return 'paused';
    case 'awaiting_permission':
      return 'awaiting_permission';
    case 'executing_tool':
      return 'acting';
    case 'awaiting_input':
      return 'awaiting_input';
    case 'awaiting_approval':
      return 'awaiting_approval';
    case 'verifying':
      return 'verifying';
    case 'completed':
      return 'completed';
    case 'blocked':
      return 'blocked';
    case 'failed':
    case 'expired':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

export function legacyHostedStateForEvent(
  eventType: string,
): HostedTaskRecord['state'] | undefined {
  return {
    'run.awaiting_worker': 'awaiting_worker',
    'run.blocked': 'blocked',
    'run.cancelled': 'cancelled',
    'run.completed': 'completed',
    'run.outcomes_incomplete': 'blocked',
    'run.planning': 'planning',
    'tool.completed': 'verifying',
    'tool.requested': 'awaiting_worker',
  }[eventType] as HostedTaskRecord['state'] | undefined;
}

const LEGACY_TERMINAL_PHASES: ReadonlySet<TaskPhase> = new Set([
  'completed',
  'blocked',
  'failed',
  'cancelled',
]);

export function isLegacyTaskPhaseTerminal(phase: TaskPhase): boolean {
  return LEGACY_TERMINAL_PHASES.has(phase);
}

const LEGACY_STEERABLE_PHASES: ReadonlySet<TaskPhase> = new Set([
  'planning',
  'observing',
  'acting',
  'verifying',
  'paused',
]);

export function isLegacyTaskPhaseSteerable(phase: TaskPhase): boolean {
  return LEGACY_STEERABLE_PHASES.has(phase);
}
