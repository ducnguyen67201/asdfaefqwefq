import type {
  CompanionGuidanceAction,
  CompanionGuidanceActionRequest,
} from '../../shared/contracts';

export interface LearnerObservation {
  fingerprint: string;
}

export type LearnerActionOutcome<TObservation extends LearnerObservation = LearnerObservation> =
  | { kind: 'changed'; observation: TObservation }
  | { kind: 'confirmed' }
  | { kind: 'timed_out' };

interface PendingGate {
  actions: CompanionGuidanceAction[];
  activityAt: number | null;
  wake: (() => void) | null;
}

export type LearnerActivityKind = 'pointer' | 'keyboard' | 'scroll';
export type LearnerActivitySubscription = (
  onActivity: (kind: LearnerActivityKind) => void,
) => () => void;

export interface WaitForLearnerOptions<TObservation extends LearnerObservation> {
  baselineFingerprint: string;
  debounceMs?: number;
  observe(): Promise<TObservation>;
  onPauseChange?(paused: boolean): void;
  onRepeat?(): Promise<void> | void;
  signal: AbortSignal;
  subscribeToActivity?: LearnerActivitySubscription;
  taskId: string;
  timeoutMs?: number | null;
}

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_TIMEOUT_MS = 75_000;

/** Owns learner-controlled waits without exposing screen capture to the renderer. */
export class LearnerActionGate {
  private readonly pending = new Map<string, PendingGate>();

  handleAction(request: CompanionGuidanceActionRequest): boolean {
    const pending = this.pending.get(request.taskId);
    if (!pending) return false;
    pending.actions.push(request.action);
    pending.wake?.();
    return true;
  }

  async wait<TObservation extends LearnerObservation>(
    options: WaitForLearnerOptions<TObservation>,
  ): Promise<LearnerActionOutcome<TObservation>> {
    if (this.pending.has(options.taskId)) {
      throw new Error('A learner-action gate is already active for this task.');
    }
    if (options.signal.aborted) throw abortError();

    const pending: PendingGate = { actions: [], activityAt: null, wake: null };
    this.pending.set(options.taskId, pending);
    const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const timeoutMs = options.timeoutMs === undefined
      ? DEFAULT_TIMEOUT_MS
      : options.timeoutMs;
    const deadline = timeoutMs === null ? null : Date.now() + timeoutMs;
    let paused = false;
    const unsubscribe = options.subscribeToActivity?.(() => {
      pending.activityAt = Date.now();
      pending.wake?.();
    }) ?? (() => undefined);

    try {
      for (;;) {
        if (deadline !== null && Date.now() >= deadline) {
          return { kind: 'timed_out' };
        }
        const action = pending.actions.shift();
        if (action) {
          if (action === 'continue') return { kind: 'confirmed' };
          if (action === 'repeat') {
            await options.onRepeat?.();
            options.onPauseChange?.(paused);
            continue;
          }
          paused = !paused;
          options.onPauseChange?.(paused);
          continue;
        }
        if (paused || pending.activityAt === null) {
          await waitForWake(
            pending,
            deadline === null ? null : Math.max(1, deadline - Date.now()),
            options.signal,
          );
          continue;
        }

        const observedActivityAt = pending.activityAt;
        await waitForWake(pending, debounceMs, options.signal);
        if (pending.actions.length > 0 || paused) continue;
        if (pending.activityAt !== observedActivityAt) continue;
        pending.activityAt = null;

        try {
          const observation = await options.observe();
          if (observation.fingerprint !== options.baselineFingerprint) {
            return { kind: 'changed', observation };
          }
        } catch (error) {
          if (options.signal.aborted) throw error;
        }
      }
    } finally {
      unsubscribe();
      this.pending.delete(options.taskId);
      options.onPauseChange?.(false);
    }
  }
}

function waitForWake(
  pending: PendingGate,
  delayMs: number | null,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (pending.wake === onWake) pending.wake = null;
      if (error) reject(error);
      else resolve();
    };
    const onAbort = (): void => finish(abortError());
    const onWake = (): void => finish();
    const timer = delayMs === null ? null : setTimeout(onWake, delayMs);
    pending.wake = onWake;
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function abortError(): Error {
  const error = new Error('The learner-action wait was cancelled.');
  error.name = 'AbortError';
  return error;
}
