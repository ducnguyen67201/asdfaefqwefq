import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { LearnerActionGate } from './learner-action-gate';

describe('LearnerActionGate', () => {
  it('does not capture while the learner is idle', async () => {
    vi.useFakeTimers();
    const gate = new LearnerActionGate();
    const observe = vi.fn(async () => ({ fingerprint: 'a' }));
    const controller = new AbortController();
    const result = gate.wait({
      baselineFingerprint: 'a',
      observe,
      signal: controller.signal,
      taskId: randomUUID(),
      timeoutMs: 20_000,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(observe).not.toHaveBeenCalled();
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    vi.useRealTimers();
  });

  it('can wait indefinitely without polling until activity or cancellation', async () => {
    vi.useFakeTimers();
    const gate = new LearnerActionGate();
    const observe = vi.fn(async () => ({ fingerprint: 'a' }));
    const controller = new AbortController();
    const result = gate.wait({
      baselineFingerprint: 'a',
      observe,
      signal: controller.signal,
      taskId: randomUUID(),
      timeoutMs: null,
    });

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(observe).not.toHaveBeenCalled();
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    vi.useRealTimers();
  });

  it('captures once after debounced coarse learner activity', async () => {
    vi.useFakeTimers();
    const gate = new LearnerActionGate();
    let notifyActivity = (): void => undefined;
    const observe = vi.fn(async () => ({ fingerprint: 'b' }));
    const result = gate.wait({
      baselineFingerprint: 'a',
      debounceMs: 50,
      observe,
      signal: new AbortController().signal,
      subscribeToActivity: (listener) => {
        notifyActivity = () => listener('pointer');
        return () => undefined;
      },
      taskId: randomUUID(),
      timeoutMs: 1_000,
    });

    notifyActivity();
    await vi.advanceTimersByTimeAsync(49);
    expect(observe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({
      kind: 'changed',
      observation: { fingerprint: 'b' },
    });
    expect(observe).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('supports repeat, pause, resume, and explicit continue', async () => {
    vi.useFakeTimers();
    const gate = new LearnerActionGate();
    const taskId = randomUUID();
    const onRepeat = vi.fn(async () => undefined);
    const onPauseChange = vi.fn();
    const observe = vi.fn(async () => ({ fingerprint: 'a' }));
    const result = gate.wait({
      baselineFingerprint: 'a',
      observe,
      onPauseChange,
      onRepeat,
      signal: new AbortController().signal,
      taskId,
      timeoutMs: 1_000,
    });

    expect(gate.handleAction({ action: 'repeat', taskId })).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(onRepeat).toHaveBeenCalledOnce();
    expect(gate.handleAction({ action: 'toggle_pause', taskId })).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(onPauseChange).toHaveBeenCalledWith(true);
    expect(gate.handleAction({ action: 'toggle_pause', taskId })).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(onPauseChange).toHaveBeenCalledWith(false);
    expect(gate.handleAction({ action: 'continue', taskId })).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ kind: 'confirmed' });
    vi.useRealTimers();
  });

  it('rejects actions without an active gate and honors cancellation', async () => {
    vi.useFakeTimers();
    const gate = new LearnerActionGate();
    const taskId = randomUUID();
    expect(gate.handleAction({ action: 'continue', taskId })).toBe(false);
    const controller = new AbortController();
    const result = gate.wait({
      baselineFingerprint: 'a',
      observe: vi.fn(async () => ({ fingerprint: 'a' })),
      signal: controller.signal,
      taskId,
      timeoutMs: 1_000,
    });
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await vi.runAllTimersAsync();
    await rejection;
    vi.useRealTimers();
  });
});
