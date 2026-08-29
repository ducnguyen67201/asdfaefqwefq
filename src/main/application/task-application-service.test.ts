import { describe, expect, it, vi } from 'vitest';

import type {
  HostedTaskAuthorityContractV10,
  HostedTaskRecord,
} from '../../shared/contracts';
import { TaskRuntime } from '../agent/task-runtime';

import { HostedTaskOutcomeUnknownError } from './hosted-task-client';
import { TaskApplicationService } from './task-application-service';

function hostedRecord(
  taskId: string,
  overrides: Partial<HostedTaskRecord> = {},
): HostedTaskRecord {
  const request = overrides.request ?? 'Create a calendar event.';
  const contract: HostedTaskAuthorityContractV10 = {
    schemaVersion: 10,
    id: '55555555-5555-4555-8555-555555555555',
    originalRequest: request,
    runtimeKind: 'openai_agents_sdk',
    executionProfile: 'everyday',
    workspaceSelectionId: null,
    activity: null,
    limits: {
      maxImages: 20,
      maxMicroUsd: 5_000_000,
      maxMinutes: 30,
      maxModelSamples: 40,
      maxToolCalls: 30,
    },
  };
  return {
    activity: null,
    clientTaskId: '44444444-4444-4444-8444-444444444444',
    contractSchemaVersion: 10,
    createdAt: '2026-08-25T00:00:00.000Z',
    executionProfile: 'everyday',
    id: '33333333-3333-4333-8333-333333333333',
    contract,
    protocolVersion: 5,
    publicSummary: 'Waiting for the OpenAI Agents SDK worker.',
    request,
    runVersion: 1,
    state: 'planning',
    taskId,
    updatedAt: '2026-08-25T00:00:00.000Z',
    workspaceSelectionId: null,
    ...overrides,
  };
}

describe('TaskApplicationService', () => {
  it('fails closed when the Rust backend is not configured', async () => {
    const runtime = new TaskRuntime();
    const service = new TaskApplicationService(runtime);

    await expect(service.submitAndStart({ text: 'Open Chrome.' })).rejects.toThrow(
      'Rust agent runtime is not configured',
    );
    expect(() => runtime.getSnapshot('11111111-1111-4111-8111-111111111111'))
      .toThrow();
  });

  it('uses the backend v10 projection as the only local execution context', async () => {
    const runtime = new TaskRuntime();
    const submit = vi.fn(async (input: { taskId: string }) =>
      hostedRecord(input.taskId));
    const service = new TaskApplicationService(runtime, {
      hostedTaskClient: {
        submit,
        subscribe: vi.fn(async () => undefined),
      } as never,
    });

    const snapshot = await service.submitAndStart({
      text: 'Create a calendar event.',
    });

    expect(submit).toHaveBeenCalledOnce();
    expect(snapshot.goal).toMatchObject({
      runtimeKind: 'openai_agents_sdk',
      schemaVersion: 10,
    });
    expect(snapshot.outcomes).toBeNull();
    expect(service.start({ taskId: snapshot.taskId })).toEqual(snapshot);
  });

  it('does not mark a Work Session failed when hosted submission is unknown', async () => {
    const fail = vi.fn(async () => undefined);
    const service = new TaskApplicationService(
      new TaskRuntime(),
      {
        activityContextService: {
          create: vi.fn(async () => ({
            workSessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          })),
          inspect: vi.fn(async () => ({
            attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            definition: { launchTarget: 'current_surface' as const },
          })),
        } as never,
        activityProgressReporter: { bind: vi.fn(), fail },
        hostedTaskClient: {
          submit: vi.fn(async () => {
            throw new HostedTaskOutcomeUnknownError(new Error('offline'));
          }),
        } as never,
      },
    );

    await expect(service.submitAndStart({
      activityAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      text: 'Check my work.',
    })).rejects.toBeInstanceOf(HostedTaskOutcomeUnknownError);
    expect(fail).not.toHaveBeenCalled();
  });

  it('restores and steers only hosted Rust runs', async () => {
    const runtime = new TaskRuntime();
    const taskId = '11111111-1111-4111-8111-111111111111';
    let record = hostedRecord(taskId);
    const get = vi.fn(async () => record);
    const service = new TaskApplicationService(runtime, {
      hostedTaskClient: {
        get,
        list: vi.fn(async () => [record]),
        steer: vi.fn(async () => undefined),
        subscribe: vi.fn(async () => undefined),
      } as never,
    });

    await expect(service.restoreHostedRuns()).resolves.toBe(1);
    const revised = await service.steer({
      instruction: 'Also create a document.',
      taskId,
    });
    record = { ...record, state: 'recovering' };

    expect(get).toHaveBeenCalledWith(record.id);
    expect(revised.goal).toMatchObject({
      runtimeKind: 'openai_agents_sdk',
      schemaVersion: 10,
    });
    expect(revised.outcomes).toBeNull();
  });
});
