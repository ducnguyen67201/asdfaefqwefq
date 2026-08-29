import { describe, expect, it, vi } from 'vitest';

import { ConnectorClient } from './connector-client';

const attempt = {
  attemptId: '11111111-1111-4111-8111-111111111111',
  catalogKey: 'gmail',
  expiresAt: '2026-08-26T08:00:00.000Z',
  status: 'pending',
} as const;

describe('ConnectorClient', () => {
  it('treats an unavailable connector list endpoint as a disabled feature', async () => {
    const client = new ConnectorClient(
      'https://api.tro.test',
      async () => 'token',
      vi.fn(async () => undefined),
      vi.fn(async () => new Response(JSON.stringify({
        code: 'not_found',
        error: 'Endpoint not found.',
      }), { status: 404 })) as typeof fetch,
    );

    await expect(client.list()).resolves.toEqual({
      catalog: [],
      connections: [],
      enabled: false,
    });
  });

  it('keeps the OAuth URL in main and opens only the pinned Google host', async () => {
    const openExternal = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      attempt,
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=connector',
    }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const client = new ConnectorClient(
      'https://api.tro.test',
      async () => 'token',
      openExternal,
      fetchImpl as typeof fetch,
    );

    await expect(client.connect('gmail')).resolves.toEqual(attempt);
    expect(openExternal).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=connector',
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.tro.test/v1/connectors/gmail/attempts',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('rejects an authorization URL on another origin', async () => {
    const openExternal = vi.fn(async () => undefined);
    const client = new ConnectorClient(
      'https://api.tro.test',
      async () => 'token',
      openExternal,
      vi.fn(async () => new Response(JSON.stringify({
        attempt,
        authorizationUrl: 'https://evil.example/oauth',
      }), { status: 201 })) as typeof fetch,
    );

    await expect(client.connect('gmail')).rejects.toThrow('untrusted authorization URL');
    expect(openExternal).not.toHaveBeenCalled();
  });
});
