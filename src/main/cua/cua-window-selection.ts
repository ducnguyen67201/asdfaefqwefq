import type { CuaWindow } from './cua-semantic-contracts';

const TROCODE_PATTERN = /\btro(?:\s*code)?\b/iu;

export interface CuaWindowIdentity {
  processId: number;
  windowId: number;
}

export function sameWindowIdentity(
  left: CuaWindowIdentity,
  right: CuaWindowIdentity,
): boolean {
  return left.processId === right.processId && left.windowId === right.windowId;
}

export function externalWindowCandidates(
  windows: readonly CuaWindow[],
  ownProcessId: number,
): CuaWindow[] {
  return windows.filter(
    (window) =>
      window.pid !== ownProcessId &&
      !TROCODE_PATTERN.test(window.app_name) &&
      !TROCODE_PATTERN.test(window.title) &&
      window.is_on_screen &&
      window.on_current_space &&
      window.bounds.width > 0 &&
      window.bounds.height > 0,
  );
}

export function selectFrontmostExternalWindow(
  windows: readonly CuaWindow[],
  ownProcessId: number,
): CuaWindow | undefined {
  const candidates = externalWindowCandidates(windows, ownProcessId);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const ranked = candidates.filter(
    (window): window is CuaWindow & { z_index: number } =>
      typeof window.z_index === 'number',
  );
  if (ranked.length !== candidates.length) return undefined;
  const highest = Math.max(...ranked.map((window) => window.z_index));
  const leaders = ranked.filter((window) => window.z_index === highest);
  return leaders.length === 1 ? leaders[0] : undefined;
}

export function selectExternalWindow(
  windows: readonly CuaWindow[],
  ownProcessId: number,
  previous?: CuaWindowIdentity,
): CuaWindow | undefined {
  const candidates = externalWindowCandidates(windows, ownProcessId);
  if (previous) {
    const retained = candidates.find(
      (window) =>
        window.pid === previous.processId &&
        window.window_id === previous.windowId,
    );
    if (retained) return retained;
  }
  return selectFrontmostExternalWindow(candidates, ownProcessId);
}
