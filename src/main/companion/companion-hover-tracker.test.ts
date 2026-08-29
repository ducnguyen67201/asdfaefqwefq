import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMPANION_HOVER_INTERVAL_MS,
  CompanionHoverTracker,
  insetRectangle,
  pointInRectangle,
  supportsCompanionHover,
} from './companion-hover-tracker';

beforeEach(() => {
  vi.useFakeTimers();
});

describe('companion hover geometry', () => {
  it('uses inclusive left/top and exclusive right/bottom edges', () => {
    const bounds = { height: 20, width: 20, x: -10, y: -20 };
    expect(pointInRectangle({ x: -10, y: -20 }, bounds)).toBe(true);
    expect(pointInRectangle({ x: 9, y: -1 }, bounds)).toBe(true);
    expect(pointInRectangle({ x: 10, y: 0 }, bounds)).toBe(false);
    expect(pointInRectangle({ x: -11, y: -20 }, bounds)).toBe(false);
  });

  it('applies a bounded transparent-corner inset', () => {
    expect(insetRectangle({ height: 112, width: 112, x: 20, y: 30 })).toEqual({
      height: 96,
      width: 96,
      x: 28,
      y: 38,
    });
  });

  it.each([
    ['darwin', undefined, true],
    ['win32', undefined, true],
    ['linux', 'x11', true],
    ['linux', 'WAYLAND', false],
  ] as const)('gates %s/%s as %s', (platform, sessionType, supported) => {
    expect(supportsCompanionHover(platform, sessionType)).toBe(supported);
  });
});

describe('CompanionHoverTracker', () => {
  function setup(options: { eligible?: boolean; platform?: string; sessionType?: string } = {}) {
    let point = { x: 0, y: 0 };
    let eligible = options.eligible ?? true;
    const publish = vi.fn();
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    const tracker = new CompanionHoverTracker({
      getCompanionBounds: () => ({ height: 112, width: 112, x: -20, y: -20 }),
      getCursorPoint: () => point,
      isEligible: () => eligible,
      onEnter,
      onLeave,
      platform: options.platform ?? 'darwin',
      publish,
      sessionType: options.sessionType,
    });
    return {
      onEnter,
      onLeave,
      publish,
      setEligible(value: boolean) {
        eligible = value;
      },
      setPoint(x: number, y: number) {
        point = { x, y };
      },
      tracker,
    };
  }

  it('publishes only transitions while sampling at 10 Hz', async () => {
    const subject = setup();
    subject.setPoint(-5, -5);
    subject.tracker.start();
    expect(subject.publish.mock.calls).toEqual([[false], [true]]);
    expect(subject.onEnter).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(COMPANION_HOVER_INTERVAL_MS * 3);
    expect(subject.publish).toHaveBeenCalledTimes(2);

    subject.setPoint(100, 100);
    await vi.advanceTimersByTimeAsync(COMPANION_HOVER_INTERVAL_MS);
    expect(subject.publish).toHaveBeenLastCalledWith(false);
    expect(subject.onLeave).toHaveBeenCalledOnce();
    subject.tracker.stop();
  });

  it('clears hover and pauses polling when eligibility is lost', async () => {
    const subject = setup();
    subject.setPoint(0, 0);
    subject.tracker.start();
    subject.setEligible(false);
    subject.tracker.synchronizeEligibility();
    expect(subject.publish).toHaveBeenLastCalledWith(false);
    expect(subject.onLeave).toHaveBeenCalledOnce();

    const calls = subject.publish.mock.calls.length;
    await vi.advanceTimersByTimeAsync(COMPANION_HOVER_INTERVAL_MS * 3);
    expect(subject.publish).toHaveBeenCalledTimes(calls);
    subject.tracker.stop();
  });

  it('stays inert on Wayland and publishes a safe initial false', async () => {
    const subject = setup({ platform: 'linux', sessionType: 'wayland' });
    subject.setPoint(0, 0);
    subject.tracker.start();
    await vi.advanceTimersByTimeAsync(COMPANION_HOVER_INTERVAL_MS * 3);

    expect(subject.publish.mock.calls).toEqual([[false]]);
    expect(subject.onEnter).not.toHaveBeenCalled();
    subject.tracker.stop();
  });

  it('is idempotent across repeated starts and stops', () => {
    const subject = setup({ eligible: false });
    subject.tracker.start();
    subject.tracker.start();
    subject.tracker.stop();
    subject.tracker.stop();
    expect(subject.publish.mock.calls).toEqual([[false]]);
  });
});
