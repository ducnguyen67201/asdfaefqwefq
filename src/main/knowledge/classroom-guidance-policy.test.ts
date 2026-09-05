import { describe, expect, it } from 'vitest';

import { classroomFixture } from './classroom-broadcast.fixture';
import {
  canAutomaticallyExplain,
  canObserveClassroomExplanation,
  pendingClassroomExplanations,
} from './classroom-guidance-policy';
describe('student explanation admission', () => {
  it('uses granted macOS permissions or an already connected Windows/Linux source', () => {
    const status = { state: 'ready' as const, platform: 'darwin' as const, available: true, summary: 'Ready', nextActions: [] };
    expect(canObserveClassroomExplanation(status)).toBe(false);
    expect(canObserveClassroomExplanation({ ...status, permissions: { accessibility: true, screenRecording: true } })).toBe(true);
    expect(canObserveClassroomExplanation({ ...status, state: 'permission_required' })).toBe(false);
    for (const platform of ['win32', 'linux'] as const) {
      expect(canObserveClassroomExplanation({ ...status, platform })).toBe(true);
      expect(canObserveClassroomExplanation({ ...status, platform, state: 'disconnected' })).toBe(false);
    }
  });
  it('requires a fresh live delta after consent while idle', () => {
    const { broadcast } = classroomFixture();
    const now = Date.parse(broadcast.createdAt);
    const input = {
      broadcast,
      provenance: 'live_delta' as const,
      consentSessionId: broadcast.sessionId,
      consentEnabledAt: now - 1,
      consentSequence: 0,
      busy: false,
      now,
    };
    expect(canAutomaticallyExplain(input)).toBe(true);
    for (const change of [
      { provenance: 'initial_snapshot' as const },
      { busy: true },
      { consentSessionId: null },
      { consentEnabledAt: now + 1 },
      { consentSequence: 1 },
      { now: now + 600_001 },
    ])
      expect(canAutomaticallyExplain({ ...input, ...change })).toBe(false);
  });
  it('retains five notices, replaces a target, and ignores ordinary assignment opens', () => {
    const fixtures = Array.from({ length: 6 }, classroomFixture);
    let pending = fixtures.reduce(
      (all, f) => pendingClassroomExplanations(all, f.broadcast),
      [] as (typeof fixtures)[0]['broadcast'][],
    );
    expect(pending).toHaveLength(5);
    const replacement = {
      ...fixtures[5]!.broadcast,
      id: fixtures[0]!.broadcast.id,
    };
    pending = pendingClassroomExplanations(pending, replacement);
    expect(pending).toHaveLength(5);
    const original = fixtures[0]!.broadcast;
    expect(
      pendingClassroomExplanations(pending, {
        ...original,
        payload: {
          ...fixtures[0]!.broadcast.payload,
          kind: 'exercise',
          instruction: 'Read.',
        },
      }),
    ).toBe(pending);
  });
});
