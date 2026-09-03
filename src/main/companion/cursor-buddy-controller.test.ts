import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CursorBuddySnapshotSchema,
  type CompanionGuidance,
  type CursorBuddySnapshot,
} from '../../shared/contracts';
import type { LearnerActionOutcome } from '../presentation/learner-action-gate';

import {
  CursorBuddyController,
  type CursorBuddyControllerDependencies,
  type CursorBuddyStep,
} from './cursor-buddy-controller';

afterEach(() => {
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function setup() {
  vi.useFakeTimers();
  const events: string[] = [];
  const snapshots: CursorBuddySnapshot[] = [];
  const gate = deferred<LearnerActionOutcome>();
  const getUserCursor = vi.fn(() => ({ x: 100, y: 120 }));
  const showHighlight = vi.fn(() => {
    events.push('highlight:show');
    return true;
  });
  const dependencies: CursorBuddyControllerDependencies = {
    animationSettings: () => ({
      prefersReducedMotion: true,
      shouldRenderRichAnimation: false,
    }),
    calloutSize: { height: 196, width: 380 },
    canPresent: () => true,
    canShowThinking: () => true,
    clearTimer: clearTimeout,
    cursorSize: { height: 44, width: 44 },
    getDisplayBounds: () => ({ x: 0, y: 0, height: 800, width: 1200 }),
    getUserCursor,
    hideCallout: () => events.push('callout:hide'),
    hideHighlight: () => events.push('highlight:hide'),
    learnerGate: {
      handleAction: vi.fn(() => true),
      wait: vi.fn(() => gate.promise) as unknown as
        CursorBuddyControllerDependencies['learnerGate']['wait'],
    },
    log: vi.fn(),
    moveCallout: () => events.push('callout:move'),
    now: Date.now,
    publishSnapshot: (snapshot) =>
      snapshots.push(CursorBuddySnapshotSchema.parse(snapshot)),
    setCursorPosition: () => events.push('cursor:move'),
    setTimer: setTimeout,
    showCallout: (guidance: CompanionGuidance) => {
      events.push(`callout:${guidance.phase}:${guidance.message}`);
      return true;
    },
    showHighlight,
    speak: (text) => {
      events.push(`speak:${text}`);
      return { cancel: vi.fn(), completion: Promise.resolve() };
    },
    toRendererPosition: (position) => position,
  };
  const controller = new CursorBuddyController(dependencies);
  const step: CursorBuddyStep = {
    baselineFingerprint: 'a'.repeat(64),
    copy: {
      expectedOutcome: 'The Variables palette is visible.',
      hook: 'Ready?',
      instruction: 'Open Variables.',
      reason: 'It stores changing numbers.',
    },
    language: 'en',
    screenPoint: { x: 500, y: 100 },
    taskId: randomUUID(),
  };
  return {
    controller,
    dependencies,
    events,
    gate,
    getUserCursor,
    showHighlight,
    snapshots,
    step,
  };
}

describe('CursorBuddyController', () => {
  it('owns the complete non-mutating teaching sequence', async () => {
    const {
      controller,
      dependencies,
      events,
      gate,
      getUserCursor,
      showHighlight,
      snapshots,
      step,
    } = setup();
    controller.start();
    expect(getUserCursor).toHaveBeenCalledTimes(1);

    const presentation = controller.presentStep(step, {
      observe: vi.fn(async () => ({ fingerprint: 'b'.repeat(64) })),
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(240);

    expect(events).toEqual(expect.arrayContaining([
      'callout:presenting:Ready? Open Variables. It stores changing numbers.',
      'speak:Ready? Open Variables. It stores changing numbers.',
      'highlight:show',
      'callout:waiting:Open Variables. It stores changing numbers.',
    ]));
    expect(snapshots.map((snapshot) => snapshot.phase)).toEqual(
      expect.arrayContaining([
        'following',
        'gliding',
        'demonstrating',
        'waiting',
      ]),
    );
    expect(getUserCursor).toHaveBeenCalledTimes(1);
    expect(showHighlight).toHaveBeenCalledWith(step.screenPoint, undefined);
    expect(dependencies.learnerGate.wait).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: null }),
    );

    gate.resolve({ kind: 'confirmed' });
    await expect(presentation).resolves.toEqual({ learnerActivity: 'confirmed' });
    expect(events).not.toContain('highlight:hide');
    expect(snapshots.at(-1)).toMatchObject({ busy: true, phase: 'checking' });
    expect(events).toContain("callout:checking:Let's check what changed…");
    controller.finishSession(step.taskId);
    expect(events).toContain('highlight:hide');
    expect(events).toContain('callout:hide');
    controller.stop();
  });

  it('returns the stable full observation and stays pinned between model decisions', async () => {
    const { controller, gate, getUserCursor, snapshots, step } = setup();
    controller.start();
    const presentation = controller.presentStep(step, {
      observe: vi.fn(async () => ({ fingerprint: 'b'.repeat(64), marker: 'full evidence' })),
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(240);
    gate.resolve({
      kind: 'changed',
      observation: { fingerprint: 'b'.repeat(64), marker: 'full evidence' },
    } as LearnerActionOutcome);
    await expect(presentation).resolves.toEqual({
      learnerActivity: 'changed',
      observation: { fingerprint: 'b'.repeat(64), marker: 'full evidence' },
    });
    expect(snapshots.at(-1)?.phase).toBe('checking');
    expect(getUserCursor).toHaveBeenCalledTimes(1);
    controller.finishSession(step.taskId);
  });

  it('starts the learner timer only after narration finishes', async () => {
    const { controller, dependencies, gate, step } = setup();
    const narration = deferred<void>();
    dependencies.speak = vi.fn(() => ({
      cancel: vi.fn(),
      completion: narration.promise,
    }));
    controller.start();
    const presentation = controller.presentStep(step, {
      observe: vi.fn(async () => ({ fingerprint: 'b'.repeat(64) })),
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(240);

    expect(dependencies.learnerGate.wait).not.toHaveBeenCalled();
    narration.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(dependencies.learnerGate.wait).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: null }),
    );

    gate.resolve({ kind: 'timed_out' });
    await presentation;
    controller.stop();
  });

  it('shows local thinking feedback without an LLM or speech call', () => {
    const { controller, events, snapshots } = setup();
    controller.start();
    controller.handleActivity({
      appLanguage: 'vi',
      destination: { kind: 'task', label: 'Scratch' },
      mode: 'task',
      phase: 'processing',
      transcript: 'Giúp em làm bài này',
    });

    expect(snapshots.at(-1)).toMatchObject({ busy: true, phase: 'thinking' });
    expect(events).toContain('callout:presenting:Mình đang nhìn bài của em…');
    expect(events.some((event) => event.startsWith('speak:'))).toBe(false);
  });

  it('keeps thinking continuous across an accepted voice Task handoff', () => {
    const { controller, events, snapshots } = setup();
    controller.start();
    controller.handleActivity({
      appLanguage: 'en',
      destination: { kind: 'task', label: 'Scratch' },
      mode: 'task',
      phase: 'committing',
      transcript: 'Help with Scratch',
    });
    controller.handleActivity({
      appLanguage: 'en',
      destination: { kind: 'task', label: 'Scratch' },
      mode: 'task',
      phase: 'complete',
      transcript: 'Help with Scratch',
    });

    expect(snapshots.at(-1)).toMatchObject({ busy: true, phase: 'thinking' });
    expect(events.filter((event) => event === 'callout:hide')).toHaveLength(0);
    controller.stop();
  });

  it('routes learner controls only to the active step', async () => {
    const { controller, dependencies, gate, step } = setup();
    controller.start();
    const presentation = controller.presentStep(step, {
      observe: vi.fn(async () => ({ fingerprint: 'b'.repeat(64) })),
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(240);

    expect(controller.handleAction({ action: 'repeat', taskId: randomUUID() })).toBe(false);
    expect(controller.handleAction({ action: 'repeat', taskId: step.taskId })).toBe(true);
    expect(dependencies.learnerGate.handleAction).toHaveBeenCalledOnce();

    gate.resolve({ kind: 'timed_out' });
    await presentation;
    controller.stop();
  });
});
