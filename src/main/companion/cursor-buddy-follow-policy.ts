export const CURSOR_BUDDY_ACTIVE_FOLLOW_INTERVAL_MS = 16;
export const CURSOR_BUDDY_IDLE_FOLLOW_INTERVAL_MS = 125;
export const CURSOR_BUDDY_FOLLOW_ACTIVE_TAIL_MS = 250;

interface CursorBuddyFollowScheduleInput {
  activeUntil: number;
  cursorMoved: boolean;
  now: number;
}

interface CursorBuddyFollowSchedule {
  activeUntil: number;
  delayMs: number;
}

/**
 * Track at animation cadence while the pointer moves, then reduce polling once
 * the pointer has remained still for a short tail.
 */
export function nextCursorBuddyFollowSchedule({
  activeUntil,
  cursorMoved,
  now,
}: CursorBuddyFollowScheduleInput): CursorBuddyFollowSchedule {
  const nextActiveUntil = cursorMoved
    ? now + CURSOR_BUDDY_FOLLOW_ACTIVE_TAIL_MS
    : activeUntil;

  return {
    activeUntil: nextActiveUntil,
    delayMs:
      now < nextActiveUntil
        ? CURSOR_BUDDY_ACTIVE_FOLLOW_INTERVAL_MS
        : CURSOR_BUDDY_IDLE_FOLLOW_INTERVAL_MS,
  };
}
