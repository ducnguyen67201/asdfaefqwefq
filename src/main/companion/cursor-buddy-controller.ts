import {
  CompanionGuidanceSchema,
  CursorBuddySnapshotSchema,
  MAX_COACH_SEQUENCE_STEPS,
  type AppLanguage,
  type CompanionCoachCopy,
  type CompanionGuidance,
  type CompanionState,
  type CompanionVoiceActivity,
  type CursorBuddySnapshot,
} from '../../shared/contracts';

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
  copy: CompanionCoachCopy;
  language: AppLanguage;
  screenPoint: Point;
  screenRegion?: Rectangle;
  target?: string;
  taskId: string;
}

export interface CursorBuddySequenceContext {
  onStepStart?(
    step: CursorBuddyStep,
    index: number,
    total: number,
  ): Promise<void> | void;
  signal: AbortSignal;
}

export interface CursorBuddyPresentationResult {
  outcome: 'presented' | 'unavailable';
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
const BETWEEN_STEPS_MS = 180;
const RETURN_RICH_MS = 260;

export class CursorBuddyController {
  private activeAbort: AbortController | null = null;
  private activeGeneration = 0;
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

  cancelGuidance(): void {
    if (!this.sessionTaskId && !this.activeAbort) return;
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

  async presentSequence(
    steps: readonly CursorBuddyStep[],
    context: CursorBuddySequenceContext,
  ): Promise<CursorBuddyPresentationResult> {
    if (steps.length < 1 || steps.length > MAX_COACH_SEQUENCE_STEPS) {
      throw new Error(
        `Cursor Buddy requires a sequence of 1 to ${MAX_COACH_SEQUENCE_STEPS} steps.`,
      );
    }
    const taskId = steps[0]!.taskId;
    if (steps.some((step) => step.taskId !== taskId)) {
      throw new Error('Every Cursor Buddy sequence step must belong to one task.');
    }
    if (!this.running || !this.dependencies.canPresent()) {
      return { outcome: 'unavailable' };
    }

    this.beginSession(taskId);
    this.cancelActive();
    this.clearFollowTimer();
    const generation = ++this.activeGeneration;
    const abort = new AbortController();
    this.activeAbort = abort;
    const onContextAbort = (): void => abort.abort();
    context.signal.addEventListener('abort', onContextAbort, { once: true });
    if (context.signal.aborted) abort.abort();

    try {
      for (const [index, step] of steps.entries()) {
        this.assertActive(generation, abort.signal);
        await context.onStepStart?.(step, index, steps.length);
        this.assertActive(generation, abort.signal);
        const outcome = await this.presentSequenceStep(
          step,
          generation,
          abort.signal,
          index,
          steps.length,
        );
        if (outcome === 'unavailable') return { outcome };
        if (index < steps.length - 1) {
          await this.delay(BETWEEN_STEPS_MS, abort.signal);
        }
      }
      return { outcome: 'presented' };
    } catch (error) {
      this.dependencies.log(
        error instanceof Error && error.name === 'AbortError'
          ? 'guidance.cancelled'
          : 'guidance.failed',
        {
          phase: this.snapshot.phase,
          taskId,
        },
      );
      throw error;
    } finally {
      context.signal.removeEventListener('abort', onContextAbort);
      if (this.isActive(generation)) {
        this.activeAbort = null;
        this.dependencies.hideHighlight();
      }
    }
  }

  private async presentSequenceStep(
    step: CursorBuddyStep,
    generation: number,
    signal: AbortSignal,
    index: number,
    total: number,
  ): Promise<'presented' | 'unavailable'> {
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
    const narration = `${step.copy.hook} ${step.copy.instruction} ${step.copy.reason}`;
    const guidance = this.guidanceFor(step, narration, side, index, total);
    let speech: CursorBuddySpeechHandle | null = null;
    this.dependencies.log('guidance.started', {
      phase: `step_${index + 1}_of_${total}`,
      taskId: step.taskId,
    });

    try {
      this.dependencies.hideHighlight();
      if (!this.dependencies.showCallout(guidance, this.currentPosition, side)) {
        return 'unavailable';
      }
      this.publish('gliding', true);
      await this.animateTo(targetPosition, signal, (position) => {
        this.dependencies.moveCallout(position, side);
      });
      this.assertActive(generation, signal);
      if (!this.dependencies.showHighlight(step.screenPoint, step.screenRegion)) {
        return 'unavailable';
      }
      this.publish('demonstrating', true);
      await this.delay(CLICK_PULSE_MS, signal);
      this.assertActive(generation, signal);
      this.publish('explaining', true);
      speech = this.dependencies.speak(narration, signal, step.taskId);
      await speech.completion;
      this.assertActive(generation, signal);
      this.dependencies.log('guidance.completed', {
        phase: `step_${index + 1}_of_${total}`,
        taskId: step.taskId,
      });
      return 'presented';
    } finally {
      speech?.cancel();
      this.dependencies.hideHighlight();
    }
  }

  private guidanceFor(
    step: CursorBuddyStep,
    message: string,
    side: 'left' | 'right',
    index: number,
    total: number,
  ): CompanionGuidance {
    return CompanionGuidanceSchema.parse({
      coach: step.copy,
      kind: 'guidance',
      language: step.language,
      message,
      phase: 'presenting',
      playback: 'playing',
      sequence: { current: index + 1, total },
      side,
      taskId: step.taskId,
      ...(step.target ? { target: step.target.slice(0, 80) } : {}),
    });
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
    this.clearFollowTimer();
    this.dependencies.hideCallout();
    this.publish('following', false);
    this.followOnce();
  }

  private followOnce(): void {
    if (!this.running || this.sessionTaskId) return;
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
    const isThinking = this.snapshot.phase === 'thinking';
    this.setPosition(
      position,
      isThinking ? 'thinking' : 'following',
      isThinking,
    );
    if (isThinking) {
      const side = chooseCursorBuddyCalloutSide(
        position,
        display,
        this.dependencies.calloutSize,
        this.dependencies.cursorSize,
      );
      this.dependencies.moveCallout(position, side);
    }
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
