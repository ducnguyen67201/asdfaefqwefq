import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { TaskSnapshot, TaskUpdate } from '../../shared/contracts';

import { PresentationCoordinator } from './presentation-coordinator';
import {
  derivePresentationState,
  shouldReadTaskCompletionAloud,
} from './presentation-policy';

function task(phase: TaskSnapshot['phase']): TaskSnapshot {
  const taskId = randomUUID();
  const timestamp = '2026-08-17T00:00:00.000Z';
  return {
    createdAt: timestamp,
    goal: null,
    lastEvent: null,
    messages: [],
    pendingInteraction: null,
    phase,
    progress: null,
    queuedSteering: [],
    runtimeResume: null,
    request: 'Complete a useful task.',
    taskId,
    updatedAt: timestamp,
  };
}

describe('presentation projection', () => {
  it('prioritizes errors, attention, voice, and work without changing task state', () => {
    expect(derivePresentationState({ task: task('failed') })).toBe('error');
    expect(derivePresentationState({ task: task('blocked') })).toBe(
      'needs_attention',
    );
    expect(
      derivePresentationState({
        task: task('planning'),
        voice: {
          appLanguage: 'en',
          destination: { kind: 'task', label: 'Tro task' },
          mode: 'task',
          phase: 'listening',
          transcript: '',
        },
      }),
    ).toBe('listening');
    expect(
      derivePresentationState({
        voice: {
          appLanguage: 'en',
          destination: { kind: 'application', label: 'Editor' },
          message: 'Text kept in your Tro draft.',
          mode: 'dictation',
          phase: 'error',
          transcript: '',
        },
      }),
    ).toBe('error');
    expect(
      derivePresentationState({
        voice: {
          appLanguage: 'en',
          destination: { kind: 'application', label: 'Editor' },
          mode: 'dictation',
          phase: 'complete',
          transcript: '',
        },
      }),
    ).toBe('done');
    expect(derivePresentationState({ task: task('acting') })).toBe('working');
  });

  it('coordinates only validated task updates and emits idempotent state changes', () => {
    const apply = vi.fn();
    const coordinator = new PresentationCoordinator({ apply });
    const snapshot = task('planning');
    const event = {
      artifacts: [],
      eventId: randomUUID(),
      nextActions: [],
      phase: 'planning' as const,
      status: 'success' as const,
      summary: 'Planning.',
      taskId: snapshot.taskId,
      timestamp: snapshot.updatedAt,
    };
    const update: TaskUpdate = {
      event,
      snapshot: { ...snapshot, lastEvent: event },
    };
    coordinator.handleTaskUpdate(update);
    coordinator.handleTaskUpdate(update);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith('thinking', expect.any(Object));
  });
});

describe('read-aloud completion policy', () => {
  it.each([
    'Read my latest email',
    'Open mail and read it',
    'Please read the newest message out loud',
    'Read the following paragraph aloud',
    'Đọc email mới nhất cho tôi nghe',
    'Mở mail và đọc nó',
    'Doc email moi nhat cho toi nghe',
  ])('recognizes an explicit request to hear the result: %s', (request) => {
    expect(
      shouldReadTaskCompletionAloud({ ...task('completed'), request }),
    ).toBe(true);
  });

  it.each([
    'Open my latest email',
    'Check my latest email',
    'Inspect the newest message',
    'Summarize my latest email',
    'Read src/index.ts and fix the startup bug',
    'Read this source file and explain how it works',
    'Read email-client.ts and fix the parsing bug',
    'Read the mail service source code',
    'Read .env aloud',
    'Read src/index.ts aloud',
    'Read README.md aloud',
    'Review README.md before implementing the change',
    'Kiểm tra email mới nhất',
    'Tóm tắt thư mới nhất',
  ])('keeps non-audible and technical reading requests silent: %s', (request) => {
    expect(
      shouldReadTaskCompletionAloud({ ...task('completed'), request }),
    ).toBe(false);
  });
});
