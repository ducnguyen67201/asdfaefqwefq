import { describe, expect, it, vi } from 'vitest';

import manifest from '../../../protocol/agent-runtime.v3.manifest.json';
import { HOST_ALWAYS_CONFIRM_EFFECTS } from '../../shared/contracts';

import { HostedTaskClient, HostedTaskOutcomeUnknownError } from './hosted-task-client';

const input = {
  clientTaskId: '00000000-0000-4000-8000-000000000001',
  taskId: '00000000-0000-4000-8000-000000000002',
  request: 'Help with this exercise.',
  autonomyMode: 'balanced' as const,
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
  protocolVersion: 3,
  protocolDigest: manifest.protocolDigest,
  toolCatalogDigest: manifest.toolCatalogDigest,
  outcomeRevision: 1,
  publicSummary: 'Queued.',
  authorityContract: {
    schemaVersion: 8,
    id: '00000000-0000-4000-8000-000000000005',
    originalRequest: input.request,
    runtimeKind: 'rust_hosted',
    executionProfile: input.executionProfile,
    autonomyMode: input.autonomyMode,
    workspaceSelectionId: null,
    activity: null,
    outcomeContract: {
      schemaVersion: 1,
      revision: 1,
      completionMode: 'all_required',
      criteria: [{
        id: 'assistant-output',
        description: 'Return a user-facing answer.',
        required: true,
        verifier: { kind: 'assistant_output', constraints: [] },
      }],
    },
    intentAuthorization: {
      schemaVersion: 1,
      revision: 1,
      source: 'user_instruction',
      grants: [],
    },
    approvalPolicy: {
      alwaysConfirmEffects: [...HOST_ALWAYS_CONFIRM_EFFECTS],
    },
    limits: {
      maxImages: 20,
      maxMicroUsd: 5_000_000,
      maxMinutes: 30,
      maxModelSamples: 40,
      maxToolCalls: 30,
    },
  },
  projection: {
    state: 'queued',
    runVersion: 1,
    phase: 'ready',
    terminal: false,
    availableActions: ['cancel'],
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
