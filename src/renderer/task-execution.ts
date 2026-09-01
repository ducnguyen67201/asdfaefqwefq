import type { ComputerPermission, TaskSnapshot } from '../shared/contracts';
import {
  isTaskPhaseSteerable,
  isTaskPhaseTerminal,
} from '../shared/task-lifecycle';

type PhaseSnapshot = Pick<TaskSnapshot, 'phase'> &
  Partial<Pick<TaskSnapshot, 'lifecycle' | 'pendingInteraction'>>;

export function computerPermissionWaitPresentation(
  requiredPermissions: readonly ComputerPermission[],
): { body: string; title: string } {
  const labels = requiredPermissions.map((permission) =>
    permission === 'accessibility' ? 'Accessibility' : 'Screen Recording');
  const permissionNames = labels.length === 2
    ? `${labels[0]} and ${labels[1]}`
    : labels[0] ?? 'Computer access';
  const verb = labels.length === 1 ? 'is' : 'are';
  const permissionWord = labels.length === 1 ? 'permission' : 'permissions';
  return {
    body:
      `Tro paused computer observation or control because ${permissionNames} ${verb} not ready. ` +
      'Open system settings to grant access, or continue without computer use.',
    title: `${permissionNames} ${permissionWord} required`,
  };
}

export function isTaskTerminal(snapshot: PhaseSnapshot | null): boolean {
  return Boolean(
    snapshot &&
      (snapshot.lifecycle?.terminal ??
        isTaskPhaseTerminal(snapshot.phase)),
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
        : !isTaskPhaseTerminal(snapshot.phase)),
  );
}

export function isTaskSteerable(snapshot: PhaseSnapshot | null): boolean {
  return Boolean(
    snapshot &&
      (snapshot.lifecycle
        ? !snapshot.lifecycle.terminal &&
          snapshot.lifecycle.availableActions.includes('steer')
        : isTaskPhaseSteerable(snapshot.phase)),
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
