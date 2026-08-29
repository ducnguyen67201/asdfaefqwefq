import { describe, expect, it, vi } from 'vitest';

import manifest from '../../../protocol/agent-runtime.v5.manifest.json';

import { HostedTaskClient, HostedTaskOutcomeUnknownError } from './hosted-task-client';

const input = {
  clientTaskId: '00000000-0000-4000-8000-000000000001',
  taskId: '00000000-0000-4000-8000-000000000002',
  request: 'Help with this exercise.',
  executionProfile: 'everyday' as const,
  workspaceSelectionId: null,
  activityAttemptId: '00000000-0000-4000-8000-000000000003',
  activityIntent: 'help' as const,
};

const record = {
  id: '00000000-0000-4000-8000-000000000004',
  taskId: input.taskId,
  clientTaskId: input.clientTaskId,
  request: input.request,
  executionProfile: input.executionProfile,
  workspaceSelectionId: null,
  protocolVersion: 5,
  protocolDigest: manifest.protocolDigest,
  toolCatalogDigest: manifest.toolCatalogDigest,
  publicSummary: 'Waiting for the OpenAI Agents SDK worker.',
  authorityContract: {
    schemaVersion: 10,
    id: '00000000-0000-4000-8000-000000000005',
    originalRequest: input.request,
    runtimeKind: 'openai_agents_sdk',
    executionProfile: input.executionProfile,
    workspaceSelectionId: null,
    activity: null,
    limits: {
      maxImages: 20,
      maxMicroUsd: 5_000_000,
      maxMinutes: 30,
      maxModelSamples: 40,
      maxToolCalls: 30,
    },
  },
  projection: {
    state: 'awaiting_orchestrator',
    runVersion: 1,
    phase: 'paused',
    terminal: false,
    availableActions: ['steer', 'cancel'],
    waitingOn: null,
    failure: null,
    cancellationSource: null,
  },
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  newlyCreated: true,
};

describe('HostedTaskClient.submit', () => {
  it('retries an unknown POST outcome with the same idempotency identity', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(Response.json(record));
    const client = new HostedTaskClient({
      accessTokenProvider: async () => 'token',
      apiBaseUrl: 'https://api.example.com',
      fetchImpl,
    });

    await expect(client.submit(input)).resolves.toMatchObject({ id: record.id });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(
      fetchImpl.mock.calls[1]?.[1]?.body,
    );
  });

  it('keeps repeated transport failures as an unknown outcome', async () => {
    const client = new HostedTaskClient({
      accessTokenProvider: async () => 'token',
      apiBaseUrl: 'https://api.example.com',
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
    });

    await expect(client.submit(input)).rejects.toBeInstanceOf(
      HostedTaskOutcomeUnknownError,
    );
  });

  it('does not retry a definitive client rejection', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: 'Invalid task.' }, { status: 400 }));
    const client = new HostedTaskClient({
      accessTokenProvider: async () => 'token',
      apiBaseUrl: 'https://api.example.com',
      fetchImpl,
    });

    await expect(client.submit(input)).rejects.toThrow('Invalid task.');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('HostedTaskClient.list', () => {
  it('restores legacy protocol-v2 runs whose unavailable digests are null', async () => {
    const legacyRecord = {
      id: '10000000-0000-4000-8000-000000000001',
      taskId: '10000000-0000-4000-8000-000000000002',
      clientTaskId: '10000000-0000-4000-8000-000000000003',
      request: 'Open YouTube.',
      executionProfile: 'everyday',
      workspaceSelectionId: null,
      state: 'completed',
      protocolVersion: 2,
      protocolDigest: null,
      toolCatalogDigest: null,
      runVersion: 1,
      outcomeRevision: 1,
      publicSummary: 'Opened YouTube.',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:01:00.000Z',
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [] }))
      .mockResolvedValueOnce(Response.json({ items: [legacyRecord] }));
    const client = new HostedTaskClient({
      accessTokenProvider: async () => 'token',
      apiBaseUrl: 'https://api.example.com',
      fetchImpl,
    });

    const runs = await client.list();

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: legacyRecord.id,
      protocolVersion: 2,
    });
    expect(runs[0]?.protocolDigest).toBeUndefined();
    expect(runs[0]?.toolCatalogDigest).toBeUndefined();
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/v1/agent-runtime/v5/tasks',
      expect.any(Object),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/v1/tasks',
      expect.any(Object),
    );
  });

  it('keeps canonical protocol-v5 digest validation strict', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({
        items: [{
          ...record,
          protocolDigest: null,
          toolCatalogDigest: null,
        }],
      }));
    const client = new HostedTaskClient({
      accessTokenProvider: async () => 'token',
      apiBaseUrl: 'https://api.example.com',
      fetchImpl,
    });

    await expect(client.list()).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
