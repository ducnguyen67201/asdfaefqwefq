import { describe, expect, it } from 'vitest';

import {
  COMPANION_ACTIVE_FOLLOW_INTERVAL_MS,
  COMPANION_FOLLOW_ACTIVE_TAIL_MS,
  COMPANION_IDLE_FOLLOW_INTERVAL_MS,
  nextCompanionFollowSchedule,
} from './companion-follow-policy';

describe('companion follow cadence', () => {
  it('cuts stationary polling by more than eighty percent', () => {
    const baselinePollsPerMinute = Math.ceil(
      60_000 / COMPANION_ACTIVE_FOLLOW_INTERVAL_MS,
    );
    const idlePollsPerMinute = Math.ceil(
      60_000 / COMPANION_IDLE_FOLLOW_INTERVAL_MS,
    );

    expect(baselinePollsPerMinute).toBe(3_750);
    expect(idlePollsPerMinute).toBe(480);
    expect(idlePollsPerMinute / baselinePollsPerMinute).toBeLessThan(0.2);
  });

  it('uses full-rate tracking while the cursor moves and during the active tail', () => {
    const movement = nextCompanionFollowSchedule({
      activeUntil: 0,
      cursorMoved: true,
      gliding: false,
      now: 1_000,
    });

    expect(movement).toEqual({
      activeUntil: 1_000 + COMPANION_FOLLOW_ACTIVE_TAIL_MS,
      delayMs: COMPANION_ACTIVE_FOLLOW_INTERVAL_MS,
    });
    expect(
      nextCompanionFollowSchedule({
        activeUntil: movement.activeUntil,
        cursorMoved: false,
        gliding: false,
        now: movement.activeUntil - 1,
      }).delayMs,
    ).toBe(COMPANION_ACTIVE_FOLLOW_INTERVAL_MS);
  });

  it('returns to idle cadence after movement settles', () => {
    expect(
      nextCompanionFollowSchedule({
        activeUntil: 1_250,
        cursorMoved: false,
        gliding: false,
        now: 1_250,
      }),
    ).toEqual({
      activeUntil: 1_250,
      delayMs: COMPANION_IDLE_FOLLOW_INTERVAL_MS,
    });
  });

  it('keeps guided glides at full animation cadence', () => {
    expect(
      nextCompanionFollowSchedule({
        activeUntil: 0,
        cursorMoved: false,
        gliding: true,
        now: 5_000,
      }).delayMs,
    ).toBe(COMPANION_ACTIVE_FOLLOW_INTERVAL_MS);
  });
});
