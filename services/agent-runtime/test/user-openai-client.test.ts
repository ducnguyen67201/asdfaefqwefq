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

  it('reports safe correlated diagnostics when the proxy rejects a model request', async () => {
    const diagnostics: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'Responses request is invalid.',
    }), {
      status: 400,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'server-request-1',
      },
    })));
    const credential = new EphemeralCredentialStore();
    credential.replace('ephemeral-user-token');
    const taskId = randomUUID();
    const agentTurnId = randomUUID();
    const clients = new UserOpenAIClientFactory(
      () => 'https://api.example.com',
      credential,
    ).create(
      { agentTurnId, taskId },
      (diagnostic) => diagnostics.push(diagnostic),
    );

    await expect(clients.openai.responses.create({
      input: 'private Scratch prompt',
      model: 'gpt-test',
      tool_choice: { type: 'function', name: 'observe_context' },
      tools: [{
        type: 'function',
        name: 'observe_context',
        description: 'Observe the current context.',
        parameters: { type: 'object', properties: {}, required: [] },
        strict: true,
      }],
    })).rejects.toThrow();

    expect(diagnostics).toEqual([
      expect.objectContaining({
        agentTurnId,
        event: 'model_request_started',
        model: 'gpt-test',
        taskId,
        toolChoice: 'function:observe_context',
        toolCount: 1,
      }),
      expect.objectContaining({
        agentTurnId,
        event: 'model_request_rejected',
        serverRequestId: 'server-request-1',
        status: 400,
        taskId,
      }),
    ]);
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain('private Scratch prompt');
    expect(serialized).not.toContain('ephemeral-user-token');
    expect(serialized).not.toContain('parameters');
  });

  it('clears credentials from memory on sign-out', () => {
    const credential = new EphemeralCredentialStore();
    credential.replace('ephemeral-user-token');
    credential.clear();

    expect(() => credential.require()).toThrow('credential_unavailable');
  });
});
