import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ResolvedToolInvocation } from './agent-contracts';
import { TaskExecutionCoordinator } from './execution-coordinator';
import { TaskRuntime } from './task-runtime';

function cuaStub() {
  return {
    endTaskSession: vi.fn(async (_taskId: string) => {
      void _taskId;
    }),
    executeCommand: vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'The native command completed.',
    })),
    executeSurfaceCommand: vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'The semantic command completed.',
    })),
    inspectSurfaceRegion: vi.fn(() => {
      throw new Error('A crop was not expected.');
    }),
    observe: vi.fn(async () => {
      throw new Error('An observation was not expected.');
    }),
    observeCurrentSurface: vi.fn(async () => undefined),
    prepareBrowserAccess: vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'Browser access is ready.',
    })),
    startTaskSession: vi.fn(async (
      _taskId: string,
      _signal?: AbortSignal,
    ) => {
      void _taskId;
      void _signal;
    }),
  };
}

function controlInvocation(): ResolvedToolInvocation {
  return {
    callId: 'control-call',
    input: { command: { kind: 'point', x: 500, y: 500 } },
    kind: 'desktop',
    modelName: 'control_desktop',
    operation: 'execute',
    toolId: 'desktop.control',
  };
}

describe('TaskExecutionCoordinator hosted dispatch', () => {
  it('opens and always closes the desktop-control indicator around dispatch', async () => {
    const taskId = randomUUID();
    const cua = cuaStub();
    const changes: boolean[] = [];
    const dispatch = vi.fn(async () => {
      throw new Error('Native dispatch failed.');
    });
    const coordinator = new TaskExecutionCoordinator({
      cua,
      onDesktopControlChange: async (_taskId, active) => {
        changes.push(active);
      },
      runtime: new TaskRuntime(),
      toolDispatcher: { dispatch },
    });

    await expect(coordinator.dispatchHostedTool(controlInvocation(), {
      signal: new AbortController().signal,
      taskId,
    })).rejects.toThrow('Native dispatch failed.');

    expect(cua.startTaskSession).toHaveBeenCalledWith(taskId, expect.any(AbortSignal));
    expect(changes).toEqual([true, false]);
  });

  it('presents hosted guidance after pointing at the requested target', async () => {
    const taskId = randomUUID();
    const cua = cuaStub();
    const presentGuidance = vi.fn(async () => undefined);
    const coordinator = new TaskExecutionCoordinator({
      cua,
      presentGuidance,
      runtime: new TaskRuntime(),
    });
    const invocation: ResolvedToolInvocation = {
      callId: 'guidance-call',
      input: {
        description: 'Choose the highlighted button.',
        region: null,
        x: 200,
        y: 300,
      },
      kind: 'guidance',
      modelName: 'show_guidance',
      operation: 'show',
      toolId: 'task.guidance',
    };

    const result = await coordinator.dispatchHostedTool(invocation, {
      signal: new AbortController().signal,
      taskId,
    });

    expect(cua.executeCommand).toHaveBeenCalledWith(
      taskId,
      { kind: 'point', x: 200, y: 300 },
      expect.any(AbortSignal),
    );
    expect(presentGuidance).toHaveBeenCalledOnce();
    expect(result.status).toBe('confirmed');
  });

  it('ends every active native task session during shutdown', async () => {
    const cua = cuaStub();
    const coordinator = new TaskExecutionCoordinator({
      cua,
      runtime: new TaskRuntime(),
      toolDispatcher: {
        dispatch: vi.fn(async () => ({
          status: 'confirmed' as const,
          summary: 'Native dispatch completed.',
        })),
      },
    });
    const taskIds = [randomUUID(), randomUUID()];
    for (const taskId of taskIds) {
      await coordinator.dispatchHostedTool(controlInvocation(), {
        signal: new AbortController().signal,
        taskId,
      });
    }

    await coordinator.shutdown();

    expect(cua.endTaskSession).toHaveBeenCalledTimes(2);
    expect(cua.endTaskSession.mock.calls.map(([taskId]) => taskId).sort())
      .toEqual([...taskIds].sort());
  });
});
