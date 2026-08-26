import type { TaskSnapshot } from '../shared/contracts';
import {
  isLegacyTaskPhaseSteerable,
  isLegacyTaskPhaseTerminal,
} from '../shared/legacy-agent-runtime-v2';

type PhaseSnapshot = Pick<TaskSnapshot, 'phase'> &
  Partial<Pick<TaskSnapshot, 'lifecycle' | 'pendingInteraction'>>;

export function isTaskTerminal(snapshot: PhaseSnapshot | null): boolean {
  return Boolean(
    snapshot &&
      (snapshot.lifecycle?.terminal ??
        isLegacyTaskPhaseTerminal(snapshot.phase)),
  );
}

export function isTaskCancellable(
  snapshot: PhaseSnapshot | null,
): boolean {
  return Boolean(
    snapshot &&
      (snapshot.lifecycle
        ? !snapshot.lifecycle.terminal &&
          snapshot.lifecycle.availableActions.includes('cancel')
        : !isLegacyTaskPhaseTerminal(snapshot.phase)),
  );
}

export function isTaskSteerable(snapshot: PhaseSnapshot | null): boolean {
  return Boolean(
    snapshot &&
      (snapshot.lifecycle
        ? !snapshot.lifecycle.terminal &&
          snapshot.lifecycle.availableActions.includes('steer')
        : isLegacyTaskPhaseSteerable(snapshot.phase)),
  );
}

export function shouldAutoStartTask(
  snapshot: PhaseSnapshot | null,
  options: { agentReady: boolean; isBusy: boolean },
): boolean {
  return (
    snapshot?.phase === 'ready' &&
    options.agentReady &&
    !options.isBusy
  );
}

export function shouldStopTaskForEscape(
  event: Pick<KeyboardEvent, 'key' | 'repeat' | 'target'>,
  snapshot: PhaseSnapshot | null,
  context: { documentHasFocus: boolean; modalOpen: boolean },
): boolean {
  const target = event.target as {
    isContentEditable?: boolean;
    tagName?: string;
    getAttribute?(name: string): string | null;
  } | null;
  const editable = Boolean(
    target &&
      (target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName ?? '') ||
        target.getAttribute?.('role') === 'textbox'),
  );
  return (
    event.key === 'Escape' &&
    !event.repeat &&
    context.documentHasFocus &&
    !context.modalOpen &&
    !editable &&
    snapshot?.lifecycle?.waitingOn?.kind !== 'permission' &&
    !snapshot?.pendingInteraction &&
    isTaskCancellable(snapshot)
  );
}
