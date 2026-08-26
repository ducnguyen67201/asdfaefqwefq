export const COMPANION_ACTIVE_FOLLOW_INTERVAL_MS = 16;
export const COMPANION_IDLE_FOLLOW_INTERVAL_MS = 125;
export const COMPANION_FOLLOW_ACTIVE_TAIL_MS = 250;

interface CompanionFollowScheduleInput {
  activeUntil: number;
  cursorMoved: boolean;
  gliding: boolean;
  now: number;
}

interface CompanionFollowSchedule {
  activeUntil: number;
  delayMs: number;
}

/**
 * Keep full-rate tracking while the pointer is moving, then let Electron idle
 * after a short tail. Guided glides always retain the full animation cadence.
 */
export function nextCompanionFollowSchedule({
  activeUntil,
  cursorMoved,
  gliding,
  now,
}: CompanionFollowScheduleInput): CompanionFollowSchedule {
  const nextActiveUntil = cursorMoved
    ? now + COMPANION_FOLLOW_ACTIVE_TAIL_MS
    : activeUntil;
  const isActive = gliding || now < nextActiveUntil;

  return {
    activeUntil: nextActiveUntil,
    delayMs: isActive
      ? COMPANION_ACTIVE_FOLLOW_INTERVAL_MS
      : COMPANION_IDLE_FOLLOW_INTERVAL_MS,
  };
}
