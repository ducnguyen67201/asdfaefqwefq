import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CursorBuddySnapshotSchema,
  type CompanionGuidance,
  type CursorBuddySnapshot,
} from '../../shared/contracts';

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
  const secondStep: CursorBuddyStep = {
    copy: {
      expectedOutcome: 'The variable dialog is visible.',
      hook: 'Next!',
      instruction: 'Choose Make a Variable.',
      reason: 'This creates the score holder.',
    },
    language: 'en',
    screenPoint: { x: 900, y: 300 },
    target: 'Make a Variable button',
    taskId: step.taskId,
  };
  return {
    controller,
    dependencies,
    events,
    getUserCursor,
    showHighlight,
    snapshots,
    secondStep,
    step,
  };
}

describe('CursorBuddyController', () => {
  it('presents every step serially without returning to the real cursor between them', async () => {
    const {
      controller,
      events,
      getUserCursor,
      showHighlight,
      snapshots,
      secondStep,
      step,
    } = setup();
    controller.start();
    expect(getUserCursor).toHaveBeenCalledTimes(1);

    const presentation = controller.presentSequence([step, secondStep], {
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await presentation;

    expect(events).toEqual(expect.arrayContaining([
      'callout:presenting:Ready? Open Variables. It stores changing numbers.',
      'speak:Ready? Open Variables. It stores changing numbers.',
      'callout:presenting:Next! Choose Make a Variable. This creates the score holder.',
      'speak:Next! Choose Make a Variable. This creates the score holder.',
      'highlight:show',
      'highlight:hide',
    ]));
    expect(snapshots.map((snapshot) => snapshot.phase)).toEqual(
      expect.arrayContaining([
        'following',
        'gliding',
        'demonstrating',
        'explaining',
      ]),
    );
    expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('waiting');
    expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('checking');
    expect(getUserCursor).toHaveBeenCalledTimes(1);
    expect(showHighlight).toHaveBeenNthCalledWith(1, step.screenPoint, undefined);
    expect(showHighlight).toHaveBeenNthCalledWith(2, secondStep.screenPoint, undefined);
    await expect(Promise.resolve(presentation)).resolves.toEqual({ outcome: 'presented' });
    controller.finishSession(step.taskId);
    await vi.advanceTimersByTimeAsync(260);
    expect(getUserCursor.mock.calls.length).toBeGreaterThan(1);
    controller.stop();
  });

  it('does not expose a learner wait or checking phase', async () => {
    const { controller, snapshots, step } = setup();
    controller.start();
    const presentation = controller.presentSequence([step], {
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(240);
    await expect(presentation).resolves.toEqual({ outcome: 'presented' });

    expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('waiting');
    expect(snapshots.map((snapshot) => snapshot.phase)).not.toContain('checking');
  });

  it('starts the next step only after the current narration finishes', async () => {
    const { controller, dependencies, secondStep, step } = setup();
    const firstNarration = deferred<void>();
    const secondNarration = deferred<void>();
    dependencies.speak = vi.fn()
      .mockReturnValueOnce({ cancel: vi.fn(), completion: firstNarration.promise })
      .mockReturnValueOnce({ cancel: vi.fn(), completion: secondNarration.promise });
    controller.start();
    const presentation = controller.presentSequence([step, secondStep], {
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(240);

    expect(dependencies.speak).toHaveBeenCalledTimes(1);
    firstNarration.resolve();
    await vi.advanceTimersByTimeAsync(420);
    expect(dependencies.speak).toHaveBeenCalledTimes(2);
    secondNarration.resolve();
    await expect(presentation).resolves.toEqual({ outcome: 'presented' });
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

  it('keeps following the user cursor while thinking', async () => {
    const { controller, events, getUserCursor } = setup();
    controller.start();
    const initialPosition = controller.currentSnapshot.position;
    getUserCursor.mockReturnValue({ x: 420, y: 360 });

    controller.handleActivity({
      appLanguage: 'en',
      destination: { kind: 'task', label: 'Scratch' },
      mode: 'task',
      phase: 'processing',
      transcript: 'Help with Scratch',
    });
    await vi.advanceTimersByTimeAsync(125);

    expect(getUserCursor.mock.calls.length).toBeGreaterThan(1);
    expect(controller.currentSnapshot).toMatchObject({
      busy: true,
      phase: 'thinking',
    });
    expect(controller.currentSnapshot.position).not.toEqual(initialPosition);
    expect(events).toContain('callout:move');
    controller.stop();
  });

  it('keeps an existing thinking callout anchored when presentation becomes unavailable', async () => {
    const { controller, dependencies, events } = setup();
    dependencies.canShowThinking = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    controller.start();
    controller.handleWorkState('processing');

    await vi.advanceTimersByTimeAsync(16);

    expect(events).toContain('callout:presenting:I\'m looking at your work…');
    expect(events).toContain('callout:move');
    expect(controller.currentSnapshot).toMatchObject({
      busy: true,
      phase: 'thinking',
    });
    controller.stop();
  });

  it('resumes following with only one scheduled follow tick', async () => {
    const { controller, getUserCursor } = setup();
    controller.start();
    controller.handleWorkState('processing');

    controller.handleWorkState('idle');
    expect(getUserCursor).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(16);
    expect(getUserCursor).toHaveBeenCalledTimes(3);
    controller.stop();
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

});
