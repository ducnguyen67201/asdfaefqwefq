import { randomUUID } from 'node:crypto';

import {
  AppPreferencesSchema,
  ClassroomSessionProjectionSchema,
  CompanionPetNudgeDraftSchema,
  type AppLanguage,
  type AppPreferences,
  type ClassroomSessionProjection,
  type CompanionPetMood,
  type CompanionPetNudgeDraft,
} from '../../shared/contracts';
import type { ClassroomSessionService } from '../knowledge/classroom-session-service';
import type { AppPreferencesService } from '../preferences/app-preferences-service';

export const CLASSROOM_PET_FIRST_WORKING_DELAY_MS = 120_000;
export const CLASSROOM_PET_TRANSITION_DELAY_MS = 1_500;
export const CLASSROOM_PET_INTERVAL_MS = 480_000;
export const CLASSROOM_PET_VISIBLE_MS = 7_000;
export const CLASSROOM_PET_BUSY_RETRY_MS = 60_000;

const CLASSROOM_PET_MESSAGES: Readonly<
  Record<AppLanguage, Record<CompanionPetMood, readonly string[]>>
> = {
  en: {
    encouraging: [
      "You've got this. One small step at a time.",
      'Keep going—steady progress counts.',
      'Your Tro pet is cheering for your next small step.',
    ],
    waiting: [
      'Asking for help was a smart move. Keep your notes nearby while you wait.',
      'A pause is okay. You can review what you already know while you wait.',
      'Help is on the way. Take a breath and keep your place.',
    ],
    celebrating: [
      "Nice work—your task is ready. Take a breath, then check one thing you're proud of.",
      'Well done. Your work is marked ready—enjoy a quiet moment with Tro.',
      'That milestone is complete. Take a breath and notice what you learned.',
    ],
  },
  vi: {
    encouraging: [
      'Bạn làm được mà. Từng bước nhỏ thôi nhé.',
      'Tiếp tục nhé—tiến bộ đều đặn luôn đáng quý.',
      'Bạn Tro đang cổ vũ cho bước nhỏ tiếp theo của bạn.',
    ],
    waiting: [
      'Nhờ giúp đỡ là một lựa chọn tốt. Giữ ghi chú bên cạnh trong lúc chờ nhé.',
      'Tạm dừng một chút cũng không sao. Bạn có thể xem lại điều mình đã biết.',
      'Trong lúc chờ, hãy hít thở nhẹ và giữ nguyên chỗ đang làm nhé.',
    ],
    celebrating: [
      'Làm tốt lắm—bài của bạn đã sẵn sàng. Hít thở một chút rồi xem lại điều bạn tự hào nhé.',
      'Tuyệt lắm. Bài đã được đánh dấu sẵn sàng—hãy thư giãn một chút cùng Tro.',
      'Bạn đã hoàn thành cột mốc này. Hãy nghỉ một nhịp và nhớ lại điều vừa học nhé.',
    ],
  },
};

interface ClassroomPetDependencies {
  sessionService: Pick<ClassroomSessionService, 'get' | 'onChange'>;
  preferencesService: Pick<AppPreferencesService, 'get' | 'onChange'>;
  canPresent(): boolean;
  present(nudge: CompanionPetNudgeDraft): boolean;
  dismiss(id: string): void;
  createId?: () => string;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export function classroomPetMood(
  session: ClassroomSessionProjection | null,
): CompanionPetMood | null {
  if (
    !session ||
    session.leftAt ||
    session.run.state !== 'open' ||
    session.run.status !== 'live' ||
    session.attemptState === 'withdrawn'
  ) {
    return null;
  }

  switch (session.attemptState) {
    case 'assigned':
    case 'in_progress':
      return 'encouraging';
    case 'blocked':
      return 'waiting';
    case 'ready_for_review':
    case 'submitted':
    case 'completed':
      return 'celebrating';
  }
  return null;
}

export class ClassroomPetService {
  private readonly createId: () => string;

  private readonly setTimer: typeof setTimeout;

  private readonly clearTimer: typeof clearTimeout;

  private timer: ReturnType<typeof setTimeout> | null = null;

  private stopSessionListener: (() => void) | null = null;

  private stopPreferencesListener: (() => void) | null = null;

  private session: ClassroomSessionProjection | null = null;

  private preferences: AppPreferences | null = null;

  private attemptId: string | null = null;

  private mood: CompanionPetMood | null = null;

  private activeNudgeId: string | null = null;

  private lastMessage: string | null = null;

  private messageIndex = 0;

  private generation = 0;

  private lifecycle = 0;

  private started = false;

  constructor(private readonly dependencies: ClassroomPetDependencies) {
    this.createId = dependencies.createId ?? randomUUID;
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const lifecycle = ++this.lifecycle;
    this.stopSessionListener = this.dependencies.sessionService.onChange(
      (session) => this.synchronizeSession(session),
    );
    this.stopPreferencesListener = this.dependencies.preferencesService.onChange(
      (preferences) => this.synchronizePreferences(preferences),
    );
    this.synchronizeSession(this.dependencies.sessionService.get());
    void this.dependencies.preferencesService
      .get()
      .then((preferences) => {
        if (this.started && this.lifecycle === lifecycle) {
          this.synchronizePreferences(preferences);
        }
      })
      .catch(() => undefined);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.lifecycle += 1;
    this.stopSessionListener?.();
    this.stopSessionListener = null;
    this.stopPreferencesListener?.();
    this.stopPreferencesListener = null;
    this.invalidatePresentation();
    this.session = null;
    this.preferences = null;
    this.attemptId = null;
    this.mood = null;
    this.lastMessage = null;
    this.messageIndex = 0;
  }

  interrupt(): void {
    if (!this.started || !this.activeNudgeId) return;
    this.invalidatePresentation();
    if (this.isEligible()) this.schedule(CLASSROOM_PET_INTERVAL_MS);
  }

  private synchronizeSession(value: ClassroomSessionProjection | null): void {
    const session = value
      ? ClassroomSessionProjectionSchema.parse(value)
      : null;
    const nextMood = classroomPetMood(session);
    const nextAttemptId = nextMood ? session?.attemptId ?? null : null;
    const attemptChanged = nextAttemptId !== this.attemptId;
    const moodChanged = nextMood !== this.mood;
    this.session = session;

    if (!attemptChanged && !moodChanged) return;

    this.invalidatePresentation();
    this.attemptId = nextAttemptId;
    this.mood = nextMood;
    if (attemptChanged) {
      this.lastMessage = null;
      this.messageIndex = 0;
    }
    if (!this.isEligible()) return;

    this.schedule(
      moodChanged && !attemptChanged
        ? CLASSROOM_PET_TRANSITION_DELAY_MS
        : this.initialDelay(nextMood),
    );
  }

  private synchronizePreferences(value: AppPreferences): void {
    const preferences = AppPreferencesSchema.parse(value);
    const wasEnabled = this.preferences?.classroomPetEnabled ?? false;
    this.preferences = preferences;

    if (!preferences.classroomPetEnabled) {
      this.invalidatePresentation();
      return;
    }
    if (!wasEnabled && this.mood) {
      this.invalidatePresentation();
      this.schedule(this.initialDelay(this.mood));
    }
  }

  private initialDelay(mood: CompanionPetMood | null): number {
    return mood === 'encouraging'
      ? CLASSROOM_PET_FIRST_WORKING_DELAY_MS
      : CLASSROOM_PET_TRANSITION_DELAY_MS;
  }

  private isEligible(): boolean {
    return Boolean(
      this.started &&
        this.preferences?.classroomPetEnabled &&
        this.attemptId &&
        this.mood &&
        classroomPetMood(this.session) === this.mood,
    );
  }

  private schedule(delay: number): void {
    if (!this.isEligible() || this.timer) return;
    const expectedAttemptId = this.attemptId;
    const expectedGeneration = this.generation;
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (
        !this.started ||
        expectedGeneration !== this.generation ||
        expectedAttemptId !== this.attemptId
      ) {
        return;
      }
      this.presentDueNudge();
    }, delay);
  }

  private presentDueNudge(): void {
    if (!this.isEligible() || !this.mood || !this.preferences) return;

    let canPresent = false;
    try {
      canPresent = this.dependencies.canPresent();
    } catch {
      canPresent = false;
    }
    if (!canPresent) {
      this.schedule(CLASSROOM_PET_BUSY_RETRY_MS);
      return;
    }

    const message = this.nextMessage(this.preferences.appLanguage, this.mood);
    const nudge = CompanionPetNudgeDraftSchema.parse({
      id: this.createId(),
      language: this.preferences.appLanguage,
      message,
      mood: this.mood,
    });
    let presented = false;
    try {
      presented = this.dependencies.present(nudge);
    } catch {
      presented = false;
    }
    if (!presented) {
      this.schedule(CLASSROOM_PET_BUSY_RETRY_MS);
      return;
    }

    this.activeNudgeId = nudge.id;
    const expectedAttemptId = this.attemptId;
    const expectedGeneration = this.generation;
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (
        expectedGeneration !== this.generation ||
        expectedAttemptId !== this.attemptId ||
        this.activeNudgeId !== nudge.id
      ) {
        return;
      }
      this.activeNudgeId = null;
      this.dependencies.dismiss(nudge.id);
      this.schedule(CLASSROOM_PET_INTERVAL_MS);
    }, CLASSROOM_PET_VISIBLE_MS);
  }

  private nextMessage(
    language: AppLanguage,
    mood: CompanionPetMood,
  ): string {
    const catalogue = CLASSROOM_PET_MESSAGES[language][mood];
    const fallback = catalogue[0];
    if (!fallback) throw new Error('Classroom pet catalogue is empty.');
    let message = catalogue[this.messageIndex % catalogue.length] ?? fallback;
    this.messageIndex += 1;
    if (message === this.lastMessage && catalogue.length > 1) {
      message = catalogue[this.messageIndex % catalogue.length] ?? fallback;
      this.messageIndex += 1;
    }
    this.lastMessage = message;
    return message;
  }

  private invalidatePresentation(): void {
    this.generation += 1;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (this.activeNudgeId) {
      const id = this.activeNudgeId;
      this.activeNudgeId = null;
      this.dependencies.dismiss(id);
    }
  }
}
