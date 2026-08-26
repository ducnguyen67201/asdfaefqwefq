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
});
