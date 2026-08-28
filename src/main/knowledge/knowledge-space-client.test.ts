import { describe, expect, it, vi } from 'vitest';

import { KnowledgeSpaceClient } from './knowledge-space-client';

describe('KnowledgeSpaceClient capabilities', () => {
  it('authenticates the per-user capability request', async () => {
    const accessTokenProvider = vi.fn(async () => 'tro_live_token');
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            knowledgeSpaces: { contractVersion: 2, enabled: true },
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        ),
    );
    const client = new KnowledgeSpaceClient(
      'https://api.example.com',
      accessTokenProvider,
      fetchImpl,
    );

    await expect(client.capabilities()).resolves.toEqual({
      knowledgeSpaces: { contractVersion: 2, enabled: true },
    });
    expect(accessTokenProvider).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/v1/capabilities',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer tro_live_token',
        }),
      }),
    );
  });

  it('lists published Activities and creates a multi-Activity Session', async () => {
    const spaceId = '11111111-1111-4111-8111-111111111111';
    const activityVersionId = '22222222-2222-4222-8222-222222222222';
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const runId = '44444444-4444-4444-8444-444444444444';
    const now = '2026-08-26T12:00:00.000Z';
    const fetchImpl = vi.fn<typeof fetch>(async (_request, init) => {
      const payload = {
        activityId: '55555555-5555-4555-8555-555555555555',
        allowedOrigins: [],
        allowRoomJoin: true,
        criteria: [],
        objective: 'Debug a converter.',
        publishedAt: now,
        title: 'Temperature converter',
        versionId: activityVersionId,
        versionNumber: 1,
      };
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({ items: [payload] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({
          activities: [{
            activityVersionId,
            allowedOrigins: [],
            allowRoomJoin: true,
            criteria: [],
            objective: payload.objective,
            position: 0,
            runId,
            title: payload.title,
          }],
          createdAt: now,
          id: sessionId,
          newlyCreated: true,
          state: 'draft',
          title: 'Week 1',
          updatedAt: now,
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 201 },
      );
    });
    const client = new KnowledgeSpaceClient(
      'https://api.example.com',
      vi.fn(async () => 'token'),
      fetchImpl,
    );

    await expect(client.listPublishedActivities(spaceId)).resolves.toMatchObject({
      items: [{ versionId: activityVersionId }],
    });
    await expect(client.createClassSession({
      activityVersionIds: [activityVersionId],
      clientId: '66666666-6666-4666-8666-666666666666',
      spaceId,
      title: 'Week 1',
    })).resolves.toMatchObject({
      id: sessionId,
      activities: [{ runId }],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `https://api.example.com/v1/spaces/${spaceId}/activities`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `https://api.example.com/v1/spaces/${spaceId}/sessions`,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
