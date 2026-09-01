import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ResolvedToolInvocation } from './agent-contracts';
import type { DesktopObservation } from './execution-contracts';
import { TaskExecutionCoordinator } from './execution-coordinator';

function observation(taskId: string, route: DesktopObservation['route']): DesktopObservation {
  return {
    capturedAt: '2026-09-01T00:00:00.000Z',
    degraded: false,
    fingerprint: 'a'.repeat(64),
    observationId: randomUUID(),
    route,
    taskId,
    text: 'Scratch exercise',
  };
}

function cuaStub() {
  return {
    endTaskSession: vi.fn(async (_taskId: string) => {
      void _taskId;
    }),
    executeCommand: vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'The native command completed.',
    })),
    executeCuaTool: vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'The dynamic CUA command completed.',
    })),
    executeSurfaceCommand: vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'The semantic command completed.',
    })),
    inspectSurfaceRegion: vi.fn(() => {
      throw new Error('A crop was not expected.');
    }),
    observe: vi.fn(async (): Promise<DesktopObservation> => {
      throw new Error('An observation was not expected.');
    }),
    observeCurrentSurface: vi.fn(
      async (): Promise<DesktopObservation | undefined> => undefined,
    ),
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

function observeInvocation(scope: 'auto' | 'desktop'): ResolvedToolInvocation {
  return {
    callId: `observe-${scope}`,
    input: {
      observationId: null,
      operation: 'observe',
      query: null,
      reason: 'Understand the visible exercise.',
      region: null,
      scope,
    },
    kind: 'observe',
    modelName: 'observe_context',
    operation: 'observe',
    toolId: 'computer.observe',
  };
}

describe('TaskExecutionCoordinator local dispatch', () => {
  it('uses the current application surface without preparing a desktop capture', async () => {
    const taskId = randomUUID();
    const cua = cuaStub();
    const surface = observation(taskId, 'window_accessibility');
    cua.observeCurrentSurface.mockResolvedValue(surface);
    const prepareDesktopObservation = vi.fn();
    const coordinator = new TaskExecutionCoordinator({
      cua,
      prepareDesktopObservation,
    });

    const result = await coordinator.dispatchTool(observeInvocation('auto'), {
      signal: new AbortController().signal,
      taskId,
    });

    expect(result.observation).toBe(surface);
    expect(cua.observe).not.toHaveBeenCalled();
    expect(prepareDesktopObservation).not.toHaveBeenCalled();
  });

  it('prepares and cleans up a desktop fallback after an auto surface miss', async () => {
    const taskId = randomUUID();
    const cua = cuaStub();
    const desktop = observation(taskId, 'desktop_vision');
    cua.observe.mockResolvedValue(desktop);
    const cleanup = vi.fn(async () => undefined);
    const prepareDesktopObservation = vi.fn(async () => cleanup);
    const coordinator = new TaskExecutionCoordinator({
      cua,
      prepareDesktopObservation,
    });

    const result = await coordinator.dispatchTool(observeInvocation('auto'), {
      signal: new AbortController().signal,
      taskId,
    });

    expect(result.observation).toBe(desktop);
    expect(cua.observeCurrentSurface).toHaveBeenCalledOnce();
    expect(prepareDesktopObservation).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('uses desktop scope directly and cleans up after a capture failure', async () => {
    const taskId = randomUUID();
    const cua = cuaStub();
    cua.observe.mockRejectedValue(new Error('Screen Recording denied.'));
    const cleanup = vi.fn(async () => undefined);
    const coordinator = new TaskExecutionCoordinator({
      cua,
      prepareDesktopObservation: async () => cleanup,
    });

    await expect(coordinator.dispatchTool(observeInvocation('desktop'), {
      signal: new AbortController().signal,
      taskId,
    })).rejects.toThrow('Screen Recording denied.');

    expect(cua.observeCurrentSurface).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

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
      toolDispatcher: { dispatch },
    });

    await expect(coordinator.dispatchTool(controlInvocation(), {
      signal: new AbortController().signal,
      taskId,
    })).rejects.toThrow('Native dispatch failed.');

    expect(cua.startTaskSession).toHaveBeenCalledWith(taskId, expect.any(AbortSignal));
    expect(changes).toEqual([true, false]);
  });

  it('presents local guidance after pointing at the requested target', async () => {
    const taskId = randomUUID();
    const cua = cuaStub();
    const presentGuidance = vi.fn(async () => undefined);
    const coordinator = new TaskExecutionCoordinator({
      cua,
      presentGuidance,
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

    const result = await coordinator.dispatchTool(invocation, {
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
      toolDispatcher: {
        dispatch: vi.fn(async () => ({
          status: 'confirmed' as const,
          summary: 'Native dispatch completed.',
        })),
      },
    });
    const taskIds = [randomUUID(), randomUUID()];
    for (const taskId of taskIds) {
      await coordinator.dispatchTool(controlInvocation(), {
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
