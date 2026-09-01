import type { TaskPhase } from './contracts';

const TERMINAL_PHASES: ReadonlySet<TaskPhase> = new Set([
  'completed',
  'blocked',
  'failed',
  'cancelled',
]);

const STEERABLE_PHASES: ReadonlySet<TaskPhase> = new Set([
  'planning',
  'observing',
  'acting',
  'verifying',
  'paused',
]);

export function isTaskPhaseTerminal(phase: TaskPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export function isTaskPhaseSteerable(phase: TaskPhase): boolean {
  return STEERABLE_PHASES.has(phase);
}
