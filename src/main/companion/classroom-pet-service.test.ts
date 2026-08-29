import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AppPreferences,
  ClassroomSessionProjection,
  CompanionPetNudgeDraft,
} from '../../shared/contracts';
import { ClassroomSessionService } from '../knowledge/classroom-session-service';

import {
  CLASSROOM_PET_BUSY_RETRY_MS,
  CLASSROOM_PET_FIRST_WORKING_DELAY_MS,
  CLASSROOM_PET_INTERVAL_MS,
  CLASSROOM_PET_TRANSITION_DELAY_MS,
  CLASSROOM_PET_VISIBLE_MS,
  ClassroomPetService,
  classroomPetMood,
} from './classroom-pet-service';

const ATTEMPT_ID = '00000000-0000-4000-8000-000000000001';
const SECOND_ATTEMPT_ID = '00000000-0000-4000-8000-000000000009';
const NUDGE_IDS = [
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
];

const SESSION: ClassroomSessionProjection = {
  attemptId: ATTEMPT_ID,
  attemptState: 'in_progress',
  run: {
    id: '00000000-0000-4000-8000-000000000002',
    state: 'open',
    mode: 'live',
    status: 'live',
  },
  space: {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Python Lab',
  },
  activityVersionId: '00000000-0000-4000-8000-000000000004',
  activity: {
    title: 'Loops',
    objective: 'Practice loops.',
    launchTarget: 'current_surface',
    requiresSubmission: false,
  },
  currentDirective: null,
  joinedAt: '2026-08-25T00:00:00.000Z',
  leftAt: null,
  role: 'student',
  autoOpenConsent: false,
};

function classroom(session: ClassroomSessionProjection = SESSION) {
  const service = new ClassroomSessionService({
    getCurrentClassroomSession: vi.fn(),
    joinRoom: vi.fn(),
    leaveClassroom: vi.fn(),
  });
  service.activate(session, session.autoOpenConsent);
  return service;
}

function preferences(initial: AppPreferences = {
  appLanguage: 'en',
  autonomyMode: 'balanced',
  classroomPetEnabled: true,
  muteSystemAudioWhileSpeaking: false,
  primaryLanguage: 'en',
  voiceMode: 'dictation',
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

describe('classroomPetMood', () => {
  it.each([
    [null, null],
    [{ ...SESSION, attemptState: 'assigned' }, 'encouraging'],
    [{ ...SESSION, attemptState: 'in_progress' }, 'encouraging'],
    [{ ...SESSION, attemptState: 'blocked' }, 'waiting'],
    [{ ...SESSION, attemptState: 'ready_for_review' }, 'celebrating'],
    [{ ...SESSION, attemptState: 'submitted' }, 'celebrating'],
    [{ ...SESSION, attemptState: 'completed' }, 'celebrating'],
    [{ ...SESSION, attemptState: 'withdrawn' }, null],
    [{ ...SESSION, leftAt: '2026-08-25T00:02:00.000Z' }, null],
    [{ ...SESSION, run: { ...SESSION.run, state: 'closed', status: 'ended' } }, null],
    [{ ...SESSION, run: { ...SESSION.run, state: 'draft', status: 'lobby' } }, null],
  ] as const)('maps explicit classroom state to %s', (session, mood) => {
    expect(classroomPetMood(session)).toBe(mood);
  });
});

describe('ClassroomPetService', () => {
  function setup(options: {
    canPresent?: () => boolean;
    initialPreferences?: AppPreferences;
    session?: ClassroomSessionProjection;
  } = {}) {
    const sessionService = classroom(options.session);
    const preferencesService = preferences(options.initialPreferences);
    const present = vi.fn((nudge: CompanionPetNudgeDraft) => Boolean(nudge));
    const dismiss = vi.fn();
    let idIndex = 0;
    const service = new ClassroomPetService({
      sessionService,
      preferencesService,
      canPresent: options.canPresent ?? (() => true),
      present,
      dismiss,
      createId: () =>
        NUDGE_IDS[idIndex++] ??
        '00000000-0000-4000-8000-000000000103',
    });
    service.start();
    return { dismiss, preferencesService, present, service, sessionService };
  }

  it('waits two minutes before the first working encouragement', async () => {
    const { present, service } = setup();
    await flushPreferences();

    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_FIRST_WORKING_DELAY_MS - 1);
    expect(present).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(present).toHaveBeenCalledOnce();
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'en', mood: 'encouraging' }),
    );
    service.stop();
  });

  it('stays inert outside an eligible live Run', async () => {
    const { present, service } = setup({
      session: {
        ...SESSION,
        run: { ...SESSION.run, state: 'draft', status: 'lobby' },
      },
    });
    await flushPreferences();

    await vi.runAllTimersAsync();
    expect(present).not.toHaveBeenCalled();
    service.stop();
  });

  it('keeps successful nudges at least eight minutes apart', async () => {
    const { dismiss, present, service } = setup();
    await flushPreferences();
    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_FIRST_WORKING_DELAY_MS);
    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_VISIBLE_MS);
    expect(dismiss).toHaveBeenCalledWith(NUDGE_IDS[0]);

    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_INTERVAL_MS - 1);
    expect(present).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(present).toHaveBeenCalledTimes(2);
    expect(present.mock.calls[1]?.[0].message).not.toBe(
      present.mock.calls[0]?.[0].message,
    );
    service.stop();
  });

  it.each([
    ['blocked', 'waiting'],
    ['ready_for_review', 'celebrating'],
    ['submitted', 'celebrating'],
    ['completed', 'celebrating'],
  ] as const)('presents a %s transition as %s', async (state, mood) => {
    const { present, service, sessionService } = setup();
    await flushPreferences();
    sessionService.updateAttemptState(state);

    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_TRANSITION_DELAY_MS - 1);
    expect(present).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({ mood }),
    );
    service.stop();
  });

  it('retries once after a busy surface without creating a nudge', async () => {
    let available = false;
    const { present, service } = setup({ canPresent: () => available });
    await flushPreferences();
    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_FIRST_WORKING_DELAY_MS);
    expect(present).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_BUSY_RETRY_MS - 1);
    expect(present).not.toHaveBeenCalled();
    available = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(present).toHaveBeenCalledOnce();
    service.stop();
  });

  it('interrupts only its visible nudge and resumes at regular cadence', async () => {
    const { dismiss, present, service } = setup();
    await flushPreferences();
    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_FIRST_WORKING_DELAY_MS);
    service.interrupt();
    expect(dismiss).toHaveBeenCalledWith(NUDGE_IDS[0]);

    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_INTERVAL_MS - 1);
    expect(present).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(present).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it('drops callbacks captured for a stale Attempt', async () => {
    const callbacks: Array<() => void> = [];
    const sessionService = classroom();
    const preferencesService = preferences();
    const present = vi.fn((nudge: CompanionPetNudgeDraft) => Boolean(nudge));
    const service = new ClassroomPetService({
      sessionService,
      preferencesService,
      canPresent: () => true,
      present,
      dismiss: vi.fn(),
      createId: () => '00000000-0000-4000-8000-000000000101',
      setTimer: ((callback: () => void) => {
        callbacks.push(callback);
        return callbacks.length;
      }) as unknown as typeof setTimeout,
      clearTimer: vi.fn() as unknown as typeof clearTimeout,
    });
    service.start();
    await flushPreferences();
    const stale = callbacks[0];
    sessionService.activate({ ...SESSION, attemptId: SECOND_ATTEMPT_ID }, false);
    stale?.();

    expect(present).not.toHaveBeenCalled();
    service.stop();
  });

  it('dismisses immediately and stays inert when the preference is disabled', async () => {
    const { dismiss, preferencesService, present, service } = setup();
    await flushPreferences();
    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_FIRST_WORKING_DELAY_MS);
    preferencesService.publish({
      appLanguage: 'en',
      autonomyMode: 'balanced',
      classroomPetEnabled: false,
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: 'en',
      voiceMode: 'dictation',
    });
    expect(dismiss).toHaveBeenCalledWith(NUDGE_IDS[0]);

    await vi.runAllTimersAsync();
    expect(present).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it('uses the current Vietnamese catalogue', async () => {
    const { present, service } = setup({
      initialPreferences: {
        appLanguage: 'vi',
        autonomyMode: 'balanced',
        classroomPetEnabled: true,
        muteSystemAudioWhileSpeaking: false,
        primaryLanguage: 'vi',
        voiceMode: 'task',
      },
    });
    await flushPreferences();
    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_FIRST_WORKING_DELAY_MS);

    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'vi',
        message: expect.stringContaining('Bạn'),
      }),
    );
    service.stop();
  });

  it('clears visible content when the Run ends', async () => {
    const { dismiss, service, sessionService } = setup();
    await flushPreferences();
    await vi.advanceTimersByTimeAsync(CLASSROOM_PET_FIRST_WORKING_DELAY_MS);
    sessionService.updateRunState('closed');

    expect(dismiss).toHaveBeenCalledWith(NUDGE_IDS[0]);
    service.stop();
  });
});
