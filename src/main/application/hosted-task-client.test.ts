import { describe, expect, it, vi } from 'vitest';

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
  state: 'queued',
  protocolVersion: 2,
  runVersion: 1,
  outcomeRevision: 1,
  publicSummary: 'Queued.',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
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
