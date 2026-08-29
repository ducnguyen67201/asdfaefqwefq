import { randomUUID } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TaskPhaseSchema,
  type AppPreferences,
  type CompanionPetNudgeDraft,
  type TaskPhase,
  type TaskSnapshot,
  type TaskUpdate,
} from '../../shared/contracts';

import {
  TASK_PET_BUSY_RETRY_MS,
  TASK_PET_FIRST_DELAY_MS,
  TASK_PET_INTERVAL_MS,
  TASK_PET_VISIBLE_MS,
  TaskPetService,
  taskPetMood,
} from './task-pet-service';

const TASK_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_TASK_ID = '00000000-0000-4000-8000-000000000002';
const NUDGE_IDS = [
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
];

function snapshot(
  phase: TaskPhase,
  taskId = TASK_ID,
): TaskSnapshot {
  return {
    approvalGrant: null,
    createdAt: '2026-08-29T00:00:00.000Z',
    goal: null,
    lastEvent: null,
    messages: [],
    outcomes: null,
    pendingInteraction: null,
    phase,
    progress: null,
    queuedSteering: [],
    request: 'Complete a useful task.',
    runtimeResume: null,
    taskId,
    updatedAt: '2026-08-29T00:00:00.000Z',
  };
}

function update(phase: TaskPhase, taskId = TASK_ID): TaskUpdate {
  const current = snapshot(phase, taskId);
  const event = {
    artifacts: [],
    eventId: randomUUID(),
    nextActions: [],
    phase,
    status: 'success' as const,
    summary: `Task is ${phase}.`,
    taskId,
    timestamp: current.updatedAt,
  };
  return { event, snapshot: { ...current, lastEvent: event } };
}

function preferences(initial: AppPreferences = {
  appLanguage: 'en',
  autonomyMode: 'balanced',
  classroomPetEnabled: true,
  muteSystemAudioWhileSpeaking: false,
  primaryLanguage: 'en',
}) {
  let current = initial;
  const listeners = new Set<(value: AppPreferences) => void>();
  return {
    get: vi.fn(async () => current),
    onChange(listener: (value: AppPreferences) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(next: AppPreferences) {
      current = next;
      for (const listener of listeners) listener(next);
    },
  };
}

async function flushPreferences(): Promise<void> {
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('taskPetMood', () => {
  const expected = {
    idle: null,
    interpreting: 'thinking',
    clarifying: 'thinking',
    ready: null,
    awaiting_input: null,
    awaiting_approval: null,
    planning: 'thinking',
    observing: 'working',
    acting: 'working',
    verifying: 'verifying',
    paused: null,
    awaiting_permission: null,
    blocked: null,
    completed: null,
    failed: null,
    cancelled: null,
  } as const;

  it.each(TaskPhaseSchema.options)('maps %s exhaustively', (phase) => {
    expect(taskPetMood(snapshot(phase))).toBe(expected[phase]);
  });

  it('suppresses encouragement when a pending interaction needs the user', () => {
    expect(
      taskPetMood({
        ...snapshot('clarifying'),
        pendingInteraction: {
          createdAt: '2026-08-29T00:00:00.000Z',
          id: randomUUID(),
          kind: 'clarification',
          prompt: 'Which option should I use?',
          taskId: TASK_ID,
        },
      }),
    ).toBeNull();
  });
});

describe('TaskPetService', () => {
  function setup(options: { canPresent?: () => boolean; initialPreferences?: AppPreferences } = {}) {
    const preferencesService = preferences(options.initialPreferences);
    const present = vi.fn((nudge: CompanionPetNudgeDraft) => Boolean(nudge));
    const dismiss = vi.fn();
    let idIndex = 0;
    const service = new TaskPetService({
      preferencesService,
      canPresent: options.canPresent ?? (() => true),
      present,
      dismiss,
      createId: () =>
        NUDGE_IDS[idIndex++] ??
        '00000000-0000-4000-8000-000000000103',
    });
    service.start();
    return { dismiss, preferencesService, present, service };
  }

  it('presents the first nudge at the exact 20 second boundary', async () => {
    const { present, service } = setup();
    await flushPreferences();
    service.handleTaskUpdate(update('planning'));
    await vi.advanceTimersByTimeAsync(TASK_PET_FIRST_DELAY_MS - 1);
    expect(present).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en', mood: 'thinking' }),
    );
    service.stop();
  });

  it('keeps the original first-delay timer across eligible phase changes', async () => {
    const { present, service } = setup();
    await flushPreferences();
    service.handleTaskUpdate(update('planning'));
    await vi.advanceTimersByTimeAsync(10_000);
    service.handleTaskUpdate(update('acting'));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(present).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({ mood: 'working' }),
    );
    service.stop();
  });

  it('dismisses after five seconds and waits two minutes before repeating', async () => {
    const { dismiss, present, service } = setup();
    await flushPreferences();
    service.handleTaskUpdate(update('verifying'));
    await vi.advanceTimersByTimeAsync(TASK_PET_FIRST_DELAY_MS);
    await vi.advanceTimersByTimeAsync(TASK_PET_VISIBLE_MS);
    expect(dismiss).toHaveBeenCalledWith(NUDGE_IDS[0]);
    await vi.advanceTimersByTimeAsync(TASK_PET_INTERVAL_MS - 1);
    expect(present).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(present).toHaveBeenCalledTimes(2);
    expect(present.mock.calls[1]?.[0].message).not.toBe(
      present.mock.calls[0]?.[0].message,
    );
    service.stop();
  });

  it('retries a busy surface without constructing a stale draft', async () => {
    let available = false;
    const { present, service } = setup({ canPresent: () => available });
    await flushPreferences();
    service.handleTaskUpdate(update('acting'));
    await vi.advanceTimersByTimeAsync(TASK_PET_FIRST_DELAY_MS);
    expect(present).not.toHaveBeenCalled();
    available = true;
    await vi.advanceTimersByTimeAsync(TASK_PET_BUSY_RETRY_MS);
    expect(present).toHaveBeenCalledOnce();
    service.stop();
  });

  it('drops callbacks captured for a stale task identity', async () => {
    const callbacks: Array<() => void> = [];
    const preferencesService = preferences();
    const present = vi.fn();
    const service = new TaskPetService({
      preferencesService,
      canPresent: () => true,
      present,
      dismiss: vi.fn(),
      setTimer: ((callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      }) as unknown as typeof setTimeout,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
    });
    service.start();
    await flushPreferences();
    service.handleTaskUpdate(update('planning'));
    const stale = callbacks[0];
    service.handleTaskUpdate(update('acting', SECOND_TASK_ID));
    stale?.();
    expect(present).not.toHaveBeenCalled();
    service.stop();
  });

  it.each(['ready', 'awaiting_input', 'awaiting_approval', 'awaiting_permission', 'blocked', 'completed', 'failed', 'cancelled'] as const)(
    'clears a running nudge when the task becomes %s',
    async (phase) => {
      const { dismiss, present, service } = setup();
      await flushPreferences();
      service.handleTaskUpdate(update('acting'));
      await vi.advanceTimersByTimeAsync(TASK_PET_FIRST_DELAY_MS);
      service.handleTaskUpdate(update(phase));
      expect(dismiss).toHaveBeenCalledWith(NUDGE_IDS[0]);
      await vi.runAllTimersAsync();
      expect(present).toHaveBeenCalledTimes(1);
      service.stop();
    },
  );

  it('dismisses and stays inert when the desktop pet preference is disabled', async () => {
    const { dismiss, preferencesService, present, service } = setup();
    await flushPreferences();
    service.handleTaskUpdate(update('acting'));
    await vi.advanceTimersByTimeAsync(TASK_PET_FIRST_DELAY_MS);
    preferencesService.publish({
      appLanguage: 'en',
      autonomyMode: 'balanced',
      classroomPetEnabled: false,
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: 'en',
    });
    expect(dismiss).toHaveBeenCalledWith(NUDGE_IDS[0]);
    await vi.runAllTimersAsync();
    expect(present).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it('uses the Vietnamese catalogue without immediate repetition', async () => {
    const { present, service } = setup({
      initialPreferences: {
        appLanguage: 'vi',
        autonomyMode: 'balanced',
        classroomPetEnabled: true,
        muteSystemAudioWhileSpeaking: false,
        primaryLanguage: 'vi',
      },
    });
    await flushPreferences();
    service.handleTaskUpdate(update('planning'));
    await vi.advanceTimersByTimeAsync(TASK_PET_FIRST_DELAY_MS);
    await vi.advanceTimersByTimeAsync(TASK_PET_VISIBLE_MS + TASK_PET_INTERVAL_MS);
    expect(present).toHaveBeenCalledTimes(2);
    expect(present.mock.calls[0]?.[0].language).toBe('vi');
    expect(present.mock.calls[1]?.[0].message).not.toBe(
      present.mock.calls[0]?.[0].message,
    );
    service.stop();
  });
});
