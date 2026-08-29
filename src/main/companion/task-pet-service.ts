import { randomUUID } from 'node:crypto';

import {
  AppPreferencesSchema,
  CompanionPetNudgeDraftSchema,
  TaskUpdateSchema,
  type AppLanguage,
  type AppPreferences,
  type CompanionPetNudgeDraft,
  type TaskSnapshot,
} from '../../shared/contracts';
import type { AppPreferencesService } from '../preferences/app-preferences-service';

export const TASK_PET_FIRST_DELAY_MS = 20_000;
export const TASK_PET_INTERVAL_MS = 120_000;
export const TASK_PET_VISIBLE_MS = 5_000;
export const TASK_PET_BUSY_RETRY_MS = 20_000;

export type TaskPetMood = 'thinking' | 'working' | 'verifying';

const TASK_PET_MESSAGES: Readonly<
  Record<AppLanguage, Record<TaskPetMood, readonly string[]>>
> = {
  en: {
    thinking: [
      "I'm mapping this out carefully.",
      'One thoughtful step at a time.',
      "I'm finding a clear path forward.",
    ],
    working: [
      "I'm on it—steady progress.",
      'Working through the next step now.',
      'Making careful progress for you.',
    ],
    verifying: [
      "I'm checking the result carefully.",
      'A quick verification pass is underway.',
      'Checking the details before I finish.',
    ],
  },
  vi: {
    thinking: [
      'Mình đang suy nghĩ thật cẩn thận.',
      'Từng bước suy nghĩ rõ ràng nhé.',
      'Mình đang tìm hướng xử lý phù hợp.',
    ],
    working: [
      'Mình đang làm đây—tiến triển đều đặn.',
      'Mình đang xử lý bước tiếp theo.',
      'Mình đang tiến hành thật cẩn thận.',
    ],
    verifying: [
      'Mình đang kiểm tra kết quả cẩn thận.',
      'Mình đang rà soát lại một lượt.',
      'Mình đang kiểm tra chi tiết trước khi xong.',
    ],
  },
};

interface TaskPetDependencies {
  preferencesService: Pick<AppPreferencesService, 'get' | 'onChange'>;
  canPresent(): boolean;
  present(nudge: CompanionPetNudgeDraft): boolean;
  dismiss(id: string): void;
  createId?: () => string;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export function taskPetMood(snapshot: TaskSnapshot): TaskPetMood | null {
  if (snapshot.pendingInteraction) return null;
  switch (snapshot.phase) {
    case 'interpreting':
    case 'clarifying':
    case 'planning':
      return 'thinking';
    case 'observing':
    case 'acting':
      return 'working';
    case 'verifying':
      return 'verifying';
    case 'idle':
    case 'ready':
    case 'awaiting_input':
    case 'awaiting_approval':
    case 'paused':
    case 'awaiting_permission':
    case 'blocked':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return null;
  }
  return null;
}

export class TaskPetService {
  private readonly createId: () => string;

  private readonly setTimer: typeof setTimeout;

  private readonly clearTimer: typeof clearTimeout;

  private timer: ReturnType<typeof setTimeout> | null = null;

  private stopPreferencesListener: (() => void) | null = null;

  private snapshot: TaskSnapshot | null = null;

  private preferences: AppPreferences | null = null;

  private taskId: string | null = null;

  private mood: TaskPetMood | null = null;

  private activeNudgeId: string | null = null;

  private lastMessage: string | null = null;

  private messageIndex = 0;

  private generation = 0;

  private lifecycle = 0;

  private started = false;

  constructor(private readonly dependencies: TaskPetDependencies) {
    this.createId = dependencies.createId ?? randomUUID;
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const lifecycle = ++this.lifecycle;
    this.stopPreferencesListener = this.dependencies.preferencesService.onChange(
      (preferences) => this.synchronizePreferences(preferences),
    );
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
    this.stopPreferencesListener?.();
    this.stopPreferencesListener = null;
    this.invalidatePresentation();
    this.snapshot = null;
    this.preferences = null;
    this.taskId = null;
    this.mood = null;
    this.lastMessage = null;
    this.messageIndex = 0;
  }

  handleTaskUpdate(value: unknown): void {
    const update = TaskUpdateSchema.parse(value);
    const nextSnapshot = update.snapshot;
    const nextMood = taskPetMood(nextSnapshot);
    const taskChanged = nextSnapshot.taskId !== this.taskId;
    const moodChanged = nextMood !== this.mood;
    this.snapshot = nextSnapshot;

    if (taskChanged) {
      this.invalidatePresentation();
      this.taskId = nextSnapshot.taskId;
      this.mood = nextMood;
      this.lastMessage = null;
      this.messageIndex = 0;
      if (this.isEligible()) this.schedule(TASK_PET_FIRST_DELAY_MS);
      return;
    }

    if (!moodChanged) return;
    const hadEligibleMood = this.mood !== null;
    const hadVisibleNudge = this.activeNudgeId !== null;
    this.mood = nextMood;

    if (!nextMood) {
      this.invalidatePresentation();
      return;
    }

    if (!hadEligibleMood) {
      this.invalidatePresentation();
      this.schedule(TASK_PET_FIRST_DELAY_MS);
      return;
    }

    if (hadVisibleNudge) {
      this.invalidatePresentation();
      this.schedule(TASK_PET_INTERVAL_MS);
    }
  }

  interrupt(): void {
    if (!this.started || !this.activeNudgeId) return;
    this.invalidatePresentation();
    if (this.isEligible()) this.schedule(TASK_PET_INTERVAL_MS);
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
      this.schedule(TASK_PET_FIRST_DELAY_MS);
    }
  }

  private isEligible(): boolean {
    const snapshot = this.snapshot;
    return Boolean(
      this.started &&
        this.preferences?.classroomPetEnabled &&
        this.taskId &&
        this.mood &&
        snapshot?.taskId === this.taskId &&
        taskPetMood(snapshot) === this.mood,
    );
  }

  private schedule(delay: number): void {
    if (!this.isEligible() || this.timer) return;
    const expectedTaskId = this.taskId;
    const expectedGeneration = this.generation;
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (
        !this.started ||
        expectedGeneration !== this.generation ||
        expectedTaskId !== this.taskId
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
      this.schedule(TASK_PET_BUSY_RETRY_MS);
      return;
    }

    const nudge = CompanionPetNudgeDraftSchema.parse({
      id: this.createId(),
      language: this.preferences.appLanguage,
      message: this.nextMessage(this.preferences.appLanguage, this.mood),
      mood: this.mood,
    });
    let presented = false;
    try {
      presented = this.dependencies.present(nudge);
    } catch {
      presented = false;
    }
    if (!presented) {
      this.schedule(TASK_PET_BUSY_RETRY_MS);
      return;
    }

    this.activeNudgeId = nudge.id;
    const expectedTaskId = this.taskId;
    const expectedGeneration = this.generation;
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (
        expectedGeneration !== this.generation ||
        expectedTaskId !== this.taskId ||
        this.activeNudgeId !== nudge.id
      ) {
        return;
      }
      this.activeNudgeId = null;
      this.dependencies.dismiss(nudge.id);
      this.schedule(TASK_PET_INTERVAL_MS);
    }, TASK_PET_VISIBLE_MS);
  }

  private nextMessage(language: AppLanguage, mood: TaskPetMood): string {
    const catalogue = TASK_PET_MESSAGES[language][mood];
    const fallback = catalogue[0];
    if (!fallback) throw new Error('Task pet catalogue is empty.');
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
