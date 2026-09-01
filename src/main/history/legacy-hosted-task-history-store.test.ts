import { afterEach, describe, expect, it, vi } from 'vitest';

import { LegacyHostedTaskHistoryStore } from './legacy-hosted-task-history-store';

afterEach(() => vi.unstubAllGlobals());

describe('LegacyHostedTaskHistoryStore', () => {
  it('maps only terminal legacy rows into read-only history', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      items: [{
        taskId: '11111111-1111-4111-8111-111111111111',
        state: 'completed',
        executionProfile: 'everyday',
        summary: 'Legacy task completed.',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:01:00.000Z',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    const store = new LegacyHostedTaskHistoryStore(
      'https://api.example.com',
      async () => 'opaque-session',
    );

    const history = await store.load('owner-1');

    expect(history.snapshots).toEqual([
      expect.objectContaining({ phase: 'completed', runtimeResume: null }),
    ]);
    expect(history.persistence).toMatchObject({ mode: 'postgres' });
    expect(request).toHaveBeenCalledWith(
      'https://api.example.com/v1/legacy-agent-history',
      expect.objectContaining({ headers: { authorization: 'Bearer opaque-session' } }),
    );
  });

  it('does not write new tasks to the legacy backend', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const store = new LegacyHostedTaskHistoryStore('', async () => null);

    await store.save('owner-1', {} as never);

    expect(request).not.toHaveBeenCalled();
  });

  it('keeps legacy history optional when the network is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const store = new LegacyHostedTaskHistoryStore(
      'https://api.example.com',
      async () => 'opaque-session',
    );

    await expect(store.load('owner-1')).resolves.toMatchObject({
      events: [],
      snapshots: [],
    });
  });
});
