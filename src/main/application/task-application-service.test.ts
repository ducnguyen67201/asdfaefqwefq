import { describe, expect, it, vi } from 'vitest';

import type { TaskSnapshot } from '../../shared/contracts';
import { TaskRuntime } from '../agent/task-runtime';

import { TaskApplicationService } from './task-application-service';

function localDependencies() {
  const localRuntime = {
    kind: 'local' as const,
    cancel: vi.fn(),
    health: vi.fn(() => null),
    initialize: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    start: vi.fn(async (_input: unknown) => {
      void _input;
    }),
    steer: vi.fn(),
  };
  const state = {
    create: vi.fn(async (ownerId: string, snapshot: TaskSnapshot) => {
      void ownerId;
      void snapshot;
    }),
    listActive: vi.fn(async (): Promise<Array<{ snapshot: TaskSnapshot }>> => []),
  };
  return { localRuntime, state };
}

describe('TaskApplicationService', () => {
  it('fails closed when the local Agents SDK runtime is not configured', async () => {
    const service = new TaskApplicationService(new TaskRuntime());

    await expect(service.submitAndStart({ text: 'Open Chrome.' })).rejects.toThrow(
      'local Agents SDK runtime is not configured',
    );
  });

  it('persists local authority before starting the SDK turn', async () => {
    const runtime = new TaskRuntime();
    const { localRuntime, state } = localDependencies();
    const order: string[] = [];
    state.create.mockImplementation(async () => { order.push('persist'); });
    localRuntime.start.mockImplementation(async () => { order.push('start'); });
    const service = new TaskApplicationService(runtime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });

    const snapshot = await service.submitAndStart({
      executionProfile: 'everyday',
      text: 'Create a calendar event.',
    });

    expect(order).toEqual(['persist', 'start']);
    expect(snapshot).toMatchObject({
      phase: 'planning',
      goal: { runtimeKind: 'openai_agents_sdk', schemaVersion: 10 },
      runtimeResume: { kind: 'local_agents_sdk' },
    });
    expect(localRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      threadId: snapshot.taskId,
      request: 'Create a calendar event.',
    }));
    expect(localRuntime.start.mock.calls[0]?.[0]).not.toHaveProperty(
      'requiredInitialTool',
    );
  });

  it('requires an initial context observation for visible-context requests', async () => {
    const runtime = new TaskRuntime();
    const { localRuntime, state } = localDependencies();
    const service = new TaskApplicationService(runtime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });

    const snapshot = await service.submitAndStart({
      executionProfile: 'everyday',
      text: 'Làm sao làm bài tập Scratch này?',
    });

    expect(localRuntime.start).toHaveBeenCalledWith(expect.objectContaining({
      threadId: snapshot.taskId,
      requiredInitialTool: {
        modelName: 'observe_context',
        arguments: {
          operation: 'observe',
          scope: 'auto',
          reason: 'Ground the response in the current visible context.',
          query: null,
          observationId: null,
          region: null,
        },
      },
    }));
  });

  it('does not grant screen observation to Workspace requests', async () => {
    const runtime = new TaskRuntime();
    const { localRuntime, state } = localDependencies();
    const selectionId = 'bc8d20ad-5a9d-40db-870f-1d0ce0bc59cd';
    const service = new TaskApplicationService(runtime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
      workspaceSelectionService: {
        resolve: vi.fn(async () => ({
          canonicalPath: '/trusted/workspace',
          displayName: 'workspace',
          selectedAt: '2026-09-01T00:00:00.000Z',
          selectionId,
        })),
      },
    });

    await service.submitAndStart({
      executionProfile: 'workspace',
      text: 'Explain this file on my screen.',
      workspaceSelectionId: selectionId,
    });

    expect(localRuntime.start.mock.calls[0]?.[0]).not.toHaveProperty(
      'requiredInitialTool',
    );
  });

  it('routes steer and cancel directly to the local runtime', async () => {
    const runtime = new TaskRuntime();
    const { localRuntime, state } = localDependencies();
    const service = new TaskApplicationService(runtime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });
    const task = await service.submitAndStart({
      executionProfile: 'everyday',
      text: 'Draft a short note.',
    });

    await service.steer({ taskId: task.taskId, instruction: 'Make it warmer.' });
    await service.cancel({ taskId: task.taskId, source: 'stop_button' });

    expect(localRuntime.steer).toHaveBeenCalledWith(task.taskId, 'Make it warmer.');
    expect(localRuntime.cancel).toHaveBeenCalledWith(task.taskId, 'stop_button');
    expect(runtime.getSnapshot(task.taskId).phase).toBe('cancelled');
  });

  it('restores durable local v10 tasks', async () => {
    const runtime = new TaskRuntime();
    const { localRuntime, state } = localDependencies();
    const seedService = new TaskApplicationService(runtime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });
    const snapshot = await seedService.submitAndStart({
      executionProfile: 'everyday',
      text: 'Continue the task.',
    });
    state.listActive.mockResolvedValue([{ snapshot }]);
    const restoredRuntime = new TaskRuntime();
    const restoredService = new TaskApplicationService(restoredRuntime, {
      currentOwnerId: async () => 'owner-1',
      localRuntime,
      state: state as never,
    });

    await expect(restoredService.restoreLocalTasks()).resolves.toBe(1);
    expect(localRuntime.resume).toHaveBeenCalledWith(
      snapshot.taskId,
      expect.objectContaining({ taskId: snapshot.taskId }),
    );
  });
});
