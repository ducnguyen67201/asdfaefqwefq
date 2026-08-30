import { describe, expect, it } from 'vitest';

import {
  CURSOR_BUDDY_ACTIVE_FOLLOW_INTERVAL_MS,
  CURSOR_BUDDY_FOLLOW_ACTIVE_TAIL_MS,
  CURSOR_BUDDY_IDLE_FOLLOW_INTERVAL_MS,
  nextCursorBuddyFollowSchedule,
} from './cursor-buddy-follow-policy';

describe('cursor buddy follow cadence', () => {
  it('cuts stationary pointer polling by more than eighty percent', () => {
    const baselinePollsPerMinute = Math.ceil(
      60_000 / CURSOR_BUDDY_ACTIVE_FOLLOW_INTERVAL_MS,
    );
    const idlePollsPerMinute = Math.ceil(
      60_000 / CURSOR_BUDDY_IDLE_FOLLOW_INTERVAL_MS,
    );

    expect(baselinePollsPerMinute).toBe(3_750);
    expect(idlePollsPerMinute).toBe(480);
    expect(idlePollsPerMinute / baselinePollsPerMinute).toBeLessThan(0.2);
  });

  it('uses full-rate tracking while the pointer moves and during its active tail', () => {
    const movement = nextCursorBuddyFollowSchedule({
      activeUntil: 0,
      cursorMoved: true,
      now: 1_000,
    });

    expect(movement).toEqual({
      activeUntil: 1_000 + CURSOR_BUDDY_FOLLOW_ACTIVE_TAIL_MS,
      delayMs: CURSOR_BUDDY_ACTIVE_FOLLOW_INTERVAL_MS,
    });
    expect(
      nextCursorBuddyFollowSchedule({
        activeUntil: movement.activeUntil,
        cursorMoved: false,
        now: movement.activeUntil - 1,
      }).delayMs,
    ).toBe(CURSOR_BUDDY_ACTIVE_FOLLOW_INTERVAL_MS);
  });

  it('returns to idle cadence after pointer movement settles', () => {
    expect(
      nextCursorBuddyFollowSchedule({
        activeUntil: 1_250,
        cursorMoved: false,
        now: 1_250,
      }),
    ).toEqual({
      activeUntil: 1_250,
      delayMs: CURSOR_BUDDY_IDLE_FOLLOW_INTERVAL_MS,
    });
  });
});
