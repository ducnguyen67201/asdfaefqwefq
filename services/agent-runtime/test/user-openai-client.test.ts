import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EphemeralCredentialStore,
  UserOpenAIClientFactory,
} from '../src/user-openai-client.js';

afterEach(() => vi.unstubAllGlobals());

describe('UserOpenAIClientFactory', () => {
  it('uses the public authenticated proxy with accounting identities', async () => {
    const request = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        id: 'response-1',
        object: 'response',
        status: 'completed',
        output: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', request);
    const credential = new EphemeralCredentialStore();
    credential.replace('ephemeral-user-token');
    const taskId = randomUUID();
    const agentTurnId = randomUUID();
    const clients = new UserOpenAIClientFactory(
      () => 'https://api.example.com',
      credential,
    ).create({ agentTurnId, taskId });

    await clients.openai.responses.create({ model: 'gpt-test', input: 'hello' });

    const [url, init] = request.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    expect(String(url)).toContain('/v1/openai/responses');
    expect(headers.get('authorization')).toBe('Bearer ephemeral-user-token');
    expect(headers.get('x-trocode-agent-turn-id')).toBe(agentTurnId);
    expect(headers.get('x-trocode-task-id')).toBe(taskId);
    expect(request).toHaveBeenCalledOnce();
  });

  it('clears credentials from memory on sign-out', () => {
    const credential = new EphemeralCredentialStore();
    credential.replace('ephemeral-user-token');
    credential.clear();

    expect(() => credential.require()).toThrow('credential_unavailable');
  });
});
