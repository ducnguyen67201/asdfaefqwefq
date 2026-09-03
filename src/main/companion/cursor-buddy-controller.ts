import {
  CompanionGuidanceSchema,
  CursorBuddySnapshotSchema,
  type AppLanguage,
  type CompanionCoachCopy,
  type CompanionGuidance,
  type CompanionGuidanceActionRequest,
  type CompanionState,
  type CompanionVoiceActivity,
  type CursorBuddySnapshot,
} from '../../shared/contracts';
import type {
  LearnerActionGate,
  LearnerActionOutcome,
  LearnerActivitySubscription,
  LearnerObservation,
} from '../presentation/learner-action-gate';

import { nextCursorBuddyFollowSchedule } from './cursor-buddy-follow-policy';
import {
  chooseCursorBuddyCalloutSide,
  cursorBuddyGlideDuration,
  interpolateCursorBuddyPosition,
  placeCursorBuddyAtTarget,
  placeCursorBuddyNearUserCursor,
  type GuidanceAnimationSettings,
  type Point,
  type Rectangle,
  type Size,
} from './cursor-buddy-geometry';

export interface CursorBuddySpeechHandle {
  cancel(): void;
  completion: Promise<unknown>;
}

export interface CursorBuddyStep {
  baselineFingerprint: string;
  copy: CompanionCoachCopy;
  language: AppLanguage;
  screenPoint: Point;
  screenRegion?: Rectangle;
  target?: string;
  taskId: string;
}

export interface CursorBuddyStepContext<TObservation extends LearnerObservation> {
  observe(signal: AbortSignal): Promise<TObservation>;
  signal: AbortSignal;
}

export interface CursorBuddyPresentationResult<TObservation extends LearnerObservation> {
  learnerActivity: 'changed' | 'confirmed' | 'timed_out';
  observation?: TObservation;
}

export interface CursorBuddyControllerDependencies {
  animationSettings(): GuidanceAnimationSettings;
  calloutSize: Size;
  canPresent(): boolean;
  canShowThinking(): boolean;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
  cursorSize: Size;
  getDisplayBounds(point: Point): Rectangle;
  getUserCursor(): Point;
  hideCallout(): void;
  hideHighlight(): void;
  learnerGate: Pick<LearnerActionGate, 'handleAction' | 'wait'>;
  subscribeToLearnerActivity?: LearnerActivitySubscription;
  log(event: string, metadata: { phase: string; taskId: string }): void;
  moveCallout(anchor: Point, side: 'left' | 'right'): void;
  publishSnapshot(snapshot: CursorBuddySnapshot): void;
  setCursorPosition(position: Point): void;
  showCallout(guidance: CompanionGuidance, anchor: Point, side: 'left' | 'right'): boolean;
  showHighlight(point: Point, region?: Rectangle): boolean;
  speak(text: string, signal: AbortSignal, taskId?: string): CursorBuddySpeechHandle;
  toRendererPosition(position: Point): Point;
  setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  now(): number;
}

const CLICK_PULSE_MS = 240;
const LEARNER_RESPONSE_WINDOW_MS = 15_000;
const RETURN_RICH_MS = 260;

export class CursorBuddyController {
  private activeAbort: AbortController | null = null;
  private activeGeneration = 0;
  private activeTaskId: string | null = null;
  private sessionTaskId: string | null = null;
  private currentPosition: Point = { x: 0, y: 0 };
  private followActiveUntil = 0;
  private followTimer: ReturnType<typeof setTimeout> | null = null;
  private lastObservedCursor: Point | null = null;
  private running = false;
  private snapshot: CursorBuddySnapshot = CursorBuddySnapshotSchema.parse({
    busy: false,
    phase: 'following',
    position: { x: 0, y: 0 },
  });

  constructor(private readonly dependencies: CursorBuddyControllerDependencies) {}

  get currentSnapshot(): CursorBuddySnapshot {
    return { ...this.snapshot, position: { ...this.snapshot.position } };
  }

  get hasActiveGuidance(): boolean {
    return this.sessionTaskId !== null;
  }

  get activeSessionTaskId(): string | null {
    return this.sessionTaskId;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.followOnce();
  }

  stop(): void {
    if (!this.running && !this.activeAbort) return;
    this.running = false;
    this.sessionTaskId = null;
    this.cancelActive();
    this.clearFollowTimer();
    this.dependencies.hideHighlight();
    this.dependencies.hideCallout();
  }

  dispose(): void {
    this.stop();
  }

  handleActivity(activity: CompanionVoiceActivity | null): void {
    if (!this.running || this.sessionTaskId) return;
    const thinking =
      activity?.phase === 'processing' ||
      activity?.phase === 'committing' ||
      (activity?.mode === 'task' && activity.phase === 'complete');
    if (!thinking) {
      if (this.snapshot.phase === 'thinking') this.resumeFollowing();
      return;
    }
    this.showThinking(activity.appLanguage ?? 'en');
  }

  handleWorkState(state: CompanionState, language: AppLanguage = 'en'): void {
    if (!this.running || this.sessionTaskId) return;
    if (state === 'sending' || state === 'processing' || state === 'working') {
      this.showThinking(language);
      return;
    }
    if (this.snapshot.phase === 'thinking') this.resumeFollowing();
  }

  private showThinking(language: AppLanguage): void {
    this.clearFollowTimer();
    this.publish('thinking', true);
    if (!this.dependencies.canShowThinking()) return;
    const guidance = CompanionGuidanceSchema.parse({
      kind: 'thinking',
      language,
      message:
        language === 'vi'
          ? 'Mình đang nhìn bài của em…'
          : "I'm looking at your work…",
      phase: 'presenting',
      playback: 'playing',
      side: 'right',
    });
    const bounds = this.dependencies.getDisplayBounds(this.currentPosition);
    const side = chooseCursorBuddyCalloutSide(
      this.currentPosition,
      bounds,
      this.dependencies.calloutSize,
      this.dependencies.cursorSize,
    );
    this.dependencies.showCallout(guidance, this.currentPosition, side);
  }

  handleAction(request: CompanionGuidanceActionRequest): boolean {
    if (request.taskId !== this.activeTaskId) return false;
    return this.dependencies.learnerGate.handleAction(request);
  }

  cancelGuidance(): void {
    if (!this.sessionTaskId && !this.activeTaskId) return;
    this.sessionTaskId = null;
    this.cancelActive();
    this.dependencies.hideHighlight();
    this.dependencies.hideCallout();
    this.resumeFollowing();
  }

  beginSession(taskId: string): void {
    if (!this.running || this.sessionTaskId === taskId) return;
    this.cancelActive();
    this.clearFollowTimer();
    this.sessionTaskId = taskId;
  }

  finishSession(taskId: string): void {
    if (this.sessionTaskId !== taskId) return;
    this.sessionTaskId = null;
    this.cancelActive();
    this.dependencies.hideHighlight();
    this.dependencies.hideCallout();
    void this.returnToUserCursor();
  }

  async presentStep<TObservation extends LearnerObservation>(
    step: CursorBuddyStep,
    context: CursorBuddyStepContext<TObservation>,
  ): Promise<CursorBuddyPresentationResult<TObservation>> {
    if (!this.running || !this.dependencies.canPresent()) {
      return { learnerActivity: 'timed_out' };
    }

    this.beginSession(step.taskId);
    this.cancelActive();
    this.clearFollowTimer();
    const generation = ++this.activeGeneration;
    const abort = new AbortController();
    this.activeAbort = abort;
    this.activeTaskId = step.taskId;
    const onContextAbort = (): void => abort.abort();
    context.signal.addEventListener('abort', onContextAbort, { once: true });
    if (context.signal.aborted) abort.abort();

    const targetDisplay = this.dependencies.getDisplayBounds(step.screenPoint);
    const targetPosition = placeCursorBuddyAtTarget(
      step.screenPoint,
      targetDisplay,
      this.dependencies.cursorSize,
    );
    const side = chooseCursorBuddyCalloutSide(
      targetPosition,
      targetDisplay,
      this.dependencies.calloutSize,
      this.dependencies.cursorSize,
    );
    const explanation = `${step.copy.instruction} ${step.copy.reason}`;
    const narration = `${step.copy.hook} ${explanation}`;
    const presentingGuidance = this.guidanceFor(
      step,
      narration,
      'presenting',
      side,
    );
    const waitingMessage = explanation;
    let speech: CursorBuddySpeechHandle | null = null;
    let sessionContinues = false;
    this.dependencies.log('guidance.started', {
      phase: 'gliding',
      taskId: step.taskId,
    });

    try {
      this.assertActive(generation, abort.signal);
      if (!this.dependencies.showCallout(
        presentingGuidance,
        this.currentPosition,
        side,
      )) {
        return { learnerActivity: 'timed_out' };
      }
      this.publish('gliding', true);
      speech = this.dependencies.speak(narration, abort.signal, step.taskId);
      const highlightShown = await this.animateTo(
        targetPosition,
        abort.signal,
        (position) => {
          this.dependencies.moveCallout(position, side);
        },
      ).then(async () => {
        this.assertActive(generation, abort.signal);
        if (!this.dependencies.showHighlight(step.screenPoint, step.screenRegion)) {
          return false;
        }
        this.publish('demonstrating', true);
        await this.delay(CLICK_PULSE_MS, abort.signal);
        return true;
      });
      this.assertActive(generation, abort.signal);
      if (!highlightShown) {
        return { learnerActivity: 'timed_out' };
      }

      await speech.completion;
      this.assertActive(generation, abort.signal);

      this.dependencies.showCallout(
        this.guidanceFor(step, waitingMessage, 'waiting', side),
        this.currentPosition,
        side,
      );
      this.publish('waiting', false);
      const outcome = await this.dependencies.learnerGate.wait({
        baselineFingerprint: step.baselineFingerprint,
        observe: () => context.observe(abort.signal),
        onPauseChange: (paused) => {
          if (!this.isActive(generation)) return;
          const phase = paused ? 'paused' : 'waiting';
          this.dependencies.showCallout(
            this.guidanceFor(step, waitingMessage, phase, side),
            this.currentPosition,
            side,
          );
          this.publish(phase, false);
        },
        onRepeat: async () => {
          this.assertActive(generation, abort.signal);
          this.dependencies.showCallout(
            this.guidanceFor(step, explanation, 'presenting', side),
            this.currentPosition,
            side,
          );
          this.publish('explaining', true);
          const replay = this.dependencies.speak(
            `${step.copy.hook} ${explanation}`,
            abort.signal,
            step.taskId,
          );
          await replay.completion;
          this.assertActive(generation, abort.signal);
          this.dependencies.showCallout(
            this.guidanceFor(step, waitingMessage, 'waiting', side),
            this.currentPosition,
            side,
          );
          this.publish('waiting', false);
        },
        signal: abort.signal,
        subscribeToActivity: this.dependencies.subscribeToLearnerActivity,
        timeoutMs: null,
        taskId: step.taskId,
      });
      speech.cancel();
      const result = this.toResult(outcome);
      if (outcome.kind !== 'timed_out') this.showChecking(step, side);
      sessionContinues = true;
      this.dependencies.log('guidance.completed', {
        phase: outcome.kind,
        taskId: step.taskId,
      });
      return result;
    } catch (error) {
      this.dependencies.log(
        error instanceof Error && error.name === 'AbortError'
          ? 'guidance.cancelled'
          : 'guidance.failed',
        {
          phase: this.snapshot.phase,
          taskId: step.taskId,
        },
      );
      throw error;
    } finally {
      context.signal.removeEventListener('abort', onContextAbort);
      speech?.cancel();
      if (this.isActive(generation)) {
        this.activeAbort = null;
        this.activeTaskId = null;
        if (!sessionContinues) this.dependencies.hideHighlight();
        if (!sessionContinues && this.sessionTaskId === step.taskId) {
          this.sessionTaskId = null;
        }
        if (this.sessionTaskId !== step.taskId) {
          this.dependencies.hideCallout();
          await this.returnToUserCursor();
        }
      }
    }
  }

  private guidanceFor(
    step: CursorBuddyStep,
    message: string,
    phase: 'presenting' | 'waiting' | 'paused',
    side: 'left' | 'right',
  ): CompanionGuidance {
    return CompanionGuidanceSchema.parse({
      coach: step.copy,
      kind: 'guidance',
      language: step.language,
      message,
      phase,
      playback: phase === 'paused' ? 'paused' : 'playing',
      ...(phase === 'waiting'
        ? { responseWindowSeconds: LEARNER_RESPONSE_WINDOW_MS / 1_000 }
        : {}),
      side,
      taskId: step.taskId,
      ...(step.target ? { target: step.target.slice(0, 80) } : {}),
    });
  }

  private showChecking(step: CursorBuddyStep, side: 'left' | 'right'): void {
    const guidance = CompanionGuidanceSchema.parse({
      kind: 'thinking',
      language: step.language,
      message:
        step.language === 'vi'
          ? 'Để Tro xem em vừa làm gì nhé…'
          : "Let's check what changed…",
      phase: 'checking',
      playback: 'playing',
      side,
      taskId: step.taskId,
    });
    this.dependencies.showCallout(guidance, this.currentPosition, side);
    this.publish('checking', true);
  }

  private toResult<TObservation extends LearnerObservation>(
    outcome: LearnerActionOutcome<TObservation>,
  ): CursorBuddyPresentationResult<TObservation> {
    return outcome.kind === 'changed'
      ? { learnerActivity: 'changed', observation: outcome.observation }
      : { learnerActivity: outcome.kind };
  }

  private async returnToUserCursor(): Promise<void> {
    if (!this.running) return;
    const cursor = this.dependencies.getUserCursor();
    const target = placeCursorBuddyNearUserCursor(
      cursor,
      this.dependencies.getDisplayBounds(cursor),
      this.dependencies.cursorSize,
    );
    const settings = this.dependencies.animationSettings();
    const duration = settings.prefersReducedMotion ? 0 : RETURN_RICH_MS;
    await this.animateTo(target, new AbortController().signal, undefined, duration);
    this.resumeFollowing();
  }

  private resumeFollowing(): void {
    if (!this.running) return;
    this.dependencies.hideCallout();
    this.publish('following', false);
    this.followOnce();
  }

  private followOnce(): void {
    if (!this.running || this.sessionTaskId || this.snapshot.phase === 'thinking') return;
    const cursor = this.dependencies.getUserCursor();
    const moved =
      this.lastObservedCursor?.x !== cursor.x ||
      this.lastObservedCursor?.y !== cursor.y;
    this.lastObservedCursor = cursor;
    const display = this.dependencies.getDisplayBounds(cursor);
    const position = placeCursorBuddyNearUserCursor(
      cursor,
      display,
      this.dependencies.cursorSize,
    );
    this.setPosition(position, 'following', false);
    const now = this.dependencies.now();
    const schedule = nextCursorBuddyFollowSchedule({
      activeUntil: this.followActiveUntil,
      cursorMoved: moved,
      now,
    });
    this.followActiveUntil = schedule.activeUntil;
    this.followTimer = this.dependencies.setTimer(
      () => {
        this.followTimer = null;
        this.followOnce();
      },
      schedule.delayMs,
    );
  }

  private async animateTo(
    target: Point,
    signal: AbortSignal,
    onFrame?: (position: Point) => void,
    forcedDurationMs?: number,
  ): Promise<void> {
    const from = this.currentPosition;
    const settings = this.dependencies.animationSettings();
    const durationMs =
      forcedDurationMs ?? cursorBuddyGlideDuration(from, target, settings);
    if (durationMs === 0 || (from.x === target.x && from.y === target.y)) {
      this.setPosition(target, this.snapshot.phase, this.snapshot.busy);
      onFrame?.(target);
      return;
    }
    const startedAt = this.dependencies.now();
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (error?: Error): void => {
        if (timer) this.dependencies.clearTimer(timer);
        signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = (): void => finish(abortError());
      const frame = (): void => {
        if (signal.aborted) return onAbort();
        const progress = Math.min(1, (this.dependencies.now() - startedAt) / durationMs);
        const position = interpolateCursorBuddyPosition(from, target, progress);
        this.setPosition(position, this.snapshot.phase, this.snapshot.busy);
        onFrame?.(position);
        if (progress >= 1) return finish();
        timer = this.dependencies.setTimer(frame, 16);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      frame();
    });
  }

  private delay(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        this.dependencies.clearTimer(timer);
        reject(abortError());
      };
      const timer = this.dependencies.setTimer(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  private setPosition(position: Point, phase: CursorBuddySnapshot['phase'], busy: boolean): void {
    this.currentPosition = { ...position };
    this.dependencies.setCursorPosition(position);
    this.publish(phase, busy);
  }

  private publish(phase: CursorBuddySnapshot['phase'], busy: boolean): void {
    this.snapshot = CursorBuddySnapshotSchema.parse({
      busy,
      phase,
      position: this.dependencies.toRendererPosition(this.currentPosition),
    });
    this.dependencies.publishSnapshot(this.snapshot);
  }

  private cancelActive(): void {
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.activeTaskId = null;
    this.activeGeneration += 1;
  }

  private clearFollowTimer(): void {
    if (this.followTimer) this.dependencies.clearTimer(this.followTimer);
    this.followTimer = null;
  }

  private isActive(generation: number): boolean {
    return generation === this.activeGeneration;
  }

  private assertActive(generation: number, signal: AbortSignal): void {
    if (!this.isActive(generation) || signal.aborted) throw abortError();
  }
}

function abortError(): Error {
  const error = new Error('The Cursor Buddy presentation was cancelled.');
  error.name = 'AbortError';
  return error;
}
