import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ClassroomBroadcastFeed } from '../../shared/contracts';

import { ClassroomBroadcastService } from './classroom-broadcast-service';
import { classroomFixture } from './classroom-broadcast.fixture';
import { ClassroomSessionService } from './classroom-session-service';

const noTimer = (() => 1) as unknown as typeof setTimeout;
function fixture() {
  const f = classroomFixture();
  const sessions = new ClassroomSessionService({
    getCurrentClassroomSession: vi.fn(),
    joinRoom: vi.fn(),
    leaveClassroom: vi.fn(),
  });
  sessions.activate(f.session);
  const list = vi.fn(async (): Promise<ClassroomBroadcastFeed> => ({
    sessionId: f.binding.sessionId,
    sessionState: 'open',
    items: [f.broadcast],
    maxSequence: 1,
  }));
  const open = vi.fn(async () => undefined);
  const service = new ClassroomBroadcastService({
    client: {
      capabilities: async () => ({
        knowledgeSpaces: { enabled: true, contractVersion: 2 },
        classroomBroadcasts: { contractVersion: 1 },
      }),
      listClassroomBroadcasts: list,
      resolveBroadcastAssignment: vi.fn(async () => ({
        attemptId: f.session.attemptId,
      })),
    },
    sessionService: sessions,
    openExternal: open,
    setTimer: noTimer,
    clearTimer: vi.fn(),
  });
  service.start();
  return { ...f, sessions, list, service, open };
}
describe('student session broadcast feed', () => {
  it('publishes the verified session even before its first broadcast', async () => {
    const f = fixture();
    const received = vi.fn();
    f.service.onBroadcast(received);
    f.list.mockResolvedValueOnce({ sessionId: f.binding.sessionId, sessionState: 'open', items: [], maxSequence: 0 });
    await f.service.pollNow();
    expect(f.service.get()).toMatchObject({ sessionId: f.binding.sessionId, broadcast: null, offline: false });
    expect(received).not.toHaveBeenCalled();
    f.service.stop();
  });
  it('keeps an active explanation available while newer notices arrive', async () => {
    const f = fixture();
    await f.service.pollNow();
    f.service.retain(f.broadcast.id);
    const items = Array.from({ length: 25 }, (_, i) => ({ ...f.broadcast, id: randomUUID(), sequence: i + 2 }));
    f.list.mockResolvedValueOnce({ sessionId: f.binding.sessionId, sessionState: 'open', items, maxSequence: 26 });
    await f.service.pollNow();
    expect(f.service.trusted(f.broadcast.id)).not.toBeNull();
    expect(f.service.trusted(items[0]!.id)).toBeNull();
    f.service.release(f.broadcast.id);
    f.list.mockResolvedValueOnce({ sessionId: f.binding.sessionId, sessionState: 'open', items: [{ ...f.broadcast, id: randomUUID(), sequence: 27 }], maxSequence: 27 });
    await f.service.pollNow();
    expect(f.service.trusted(f.broadcast.id)).toBeNull();
    f.service.stop();
  });
  it('starts from latest then uses its own cursor without opening anything', async () => {
    const f = fixture();
    const received = vi.fn();
    f.service.onBroadcast(received);
    await f.service.pollNow();
    expect(f.list).toHaveBeenLastCalledWith(
      f.session.attemptId,
      undefined,
      expect.any(AbortSignal),
    );
    expect(received).toHaveBeenLastCalledWith(f.broadcast, 'initial_snapshot');
    f.list.mockResolvedValueOnce({
      sessionId: f.binding.sessionId,
      sessionState: 'open',
      items: [{ ...f.broadcast, sequence: 2 }],
      maxSequence: 2,
    });
    await f.service.pollNow();
    expect(f.list).toHaveBeenLastCalledWith(
      f.session.attemptId,
      1,
      expect.any(AbortSignal),
    );
    expect(received.mock.calls[1]![1]).toBe('live_delta');
    expect(f.open).not.toHaveBeenCalled();
    expect(await f.service.openAssignment(f.broadcast.id)).toEqual({
      attemptId: f.session.attemptId,
    });
    f.service.stop();
  });
  it('discards A→B→A late responses', async () => {
    const f = fixture();
    let resolve!: (v: ClassroomBroadcastFeed) => void;
    f.list.mockImplementationOnce(
      () => new Promise((done) => (resolve = done)),
    );
    const poll = f.service.pollNow();
    await vi.waitFor(() => expect(f.list).toHaveBeenCalled());
    f.sessions.clear();
    f.sessions.activate(f.session);
    resolve({
      sessionId: f.binding.sessionId,
      sessionState: 'open',
      items: [f.broadcast],
      maxSequence: 1,
    });
    await poll;
    expect(f.service.get()).toBeNull();
    await f.service.pollNow();
    expect(f.service.get()?.broadcast?.id).toBe(f.broadcast.id);
    f.service.stop();
  });
  it('marks reconnect catch-up as manual and clears terminal sessions', async () => {
    const f = fixture();
    const received = vi.fn();
    f.service.onBroadcast(received);
    await f.service.pollNow();
    f.list.mockRejectedValueOnce(new Error('offline'));
    await f.service.pollNow();
    expect(f.service.get()?.offline).toBe(true);
    await f.service.pollNow();
    expect(received).toHaveBeenLastCalledWith(f.broadcast, 'initial_snapshot');
    f.list.mockResolvedValueOnce({
      sessionId: f.binding.sessionId,
      sessionState: 'closed',
      items: [],
      maxSequence: 1,
    });
    await f.service.pollNow();
    expect(f.service.get()).toBeNull();
    f.service.stop();
  });
});
