import { describe, expect, it, vi } from 'vitest';

import type { HostedTaskRecord } from '../../shared/contracts';
import type { TaskExecutionCoordinator } from '../agent/execution-coordinator';
import { compileIntentAuthorization } from '../agent/intent-authorization';
import { compileOutcomeContract } from '../agent/outcome-contract';
import { TaskRuntime } from '../agent/task-runtime';

import { HostedTaskOutcomeUnknownError } from './hosted-task-client';
import { TaskApplicationService } from './task-application-service';

describe('TaskApplicationService', () => {
  it('owns submit-before-start ordering and resumes interactions', async () => {
    const order: string[] = [];
    const runtime = {
      submit: vi.fn(() => {
        order.push('submit');
        return { taskId: 'task-1' };
      }),
      respondToInteraction: vi.fn(() => ({ taskId: 'task-1' })),
    } as unknown as TaskRuntime;
    const execution = {
      resume: vi.fn(),
      start: vi.fn(() => {
        order.push('start');
        return { taskId: 'task-1', phase: 'planning' };
      }),
    } as unknown as TaskExecutionCoordinator;
    const service = new TaskApplicationService(runtime, execution);

    await expect(
      service.submitAndStart({ text: 'Do useful work.' }),
    ).resolves.toMatchObject({ phase: 'planning' });
    expect(order).toEqual(['submit', 'start']);
    expect(runtime.submit).toHaveBeenCalledWith(
      {
        activityAttemptId: null,
        activityIntent: 'work',
        executionProfile: 'everyday',
        text: 'Do useful work.',
        workspaceSelectionId: null,
      },
      {
        activity: null,
        autonomyMode: 'balanced',
        executionProfile: 'everyday',
        runtimeKind: 'openai_agents',
        taskId: expect.any(String),
        workspace: null,
      },
    );
    service.respond({ taskId: 'task-1' });
    expect(execution.resume).toHaveBeenCalledWith('task-1');
  });

  it('resolves a trusted Workspace identity before compiling the contract', async () => {
    const workspace = {
      selectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      canonicalPath: '/tmp/project',
      displayName: 'project',
      selectedAt: '2026-08-18T00:00:00.000Z',
    };
    const runtime = {
      submit: vi.fn(() => ({ taskId: 'task-workspace' })),
    } as unknown as TaskRuntime;
    const execution = {
      start: vi.fn(() => ({ taskId: 'task-workspace', phase: 'planning' })),
    } as unknown as TaskExecutionCoordinator;
    const resolve = vi.fn(async () => workspace);
    const service = new TaskApplicationService(runtime, execution, {
      appPreferencesService: {
        get: vi.fn(async () => ({
          appLanguage: 'en' as const,
          autonomyMode: 'strict' as const,
          muteSystemAudioWhileSpeaking: false,
          primaryLanguage: 'en' as const,
        })),
      },
      workspaceSelectionService: { resolve },
    });

    await service.submitAndStart({
      executionProfile: 'workspace',
      text: 'Fix the tests.',
      workspaceSelectionId: workspace.selectionId,
    });

    expect(resolve).toHaveBeenCalledWith(workspace.selectionId);
    expect(runtime.submit).toHaveBeenCalledWith(
      expect.objectContaining({ activityAttemptId: null, executionProfile: 'workspace' }),
      expect.objectContaining({
        activity: null,
        autonomyMode: 'strict',
        runtimeKind: 'openai_agents',
        taskId: expect.any(String),
        workspace,
      }),
    );
  });

  it('creates the hosted Work Session before compiling a trusted Activity contract', async () => {
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const activity = { workSessionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    const order: string[] = [];
    const inspect = vi.fn(async () => ({
      attemptId,
      definition: { launchTarget: 'current_surface' as const },
    }));
    const create = vi.fn(async (_attempt, allocatedTaskId) => {
      order.push('create');
      expect(allocatedTaskId).toMatch(/[0-9a-f-]{36}/u);
      return activity;
    });
    const bind = vi.fn();
    const runtime = {
      submit: vi.fn((_request, options) => {
        order.push('submit');
        return { taskId: options.taskId };
      }),
    } as unknown as TaskRuntime;
    const execution = {
      start: vi.fn(({ taskId: allocatedTaskId }) => ({ taskId: allocatedTaskId, phase: 'planning' })),
    } as unknown as TaskExecutionCoordinator;
    const service = new TaskApplicationService(runtime, execution, {
      activityContextService: { create, inspect } as never,
      activityProgressReporter: { bind, fail: vi.fn() },
    });
    const result = await service.submitAndStart({
      activityAttemptId: attemptId,
      text: 'Why does this fail?',
    });
    expect(result.phase).toBe('planning');
    expect(inspect).toHaveBeenCalledWith(attemptId);
    expect(order).toEqual(['create', 'submit']);
    expect(bind).toHaveBeenCalledWith(result.taskId, activity.workSessionId);
    expect(result.taskId).not.toBe(taskId);
  });

  it('inherits the active student Attempt for Help while explicit Attempts take precedence', async () => {
    const inheritedAttemptId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const explicitAttemptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const directive = {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      sequence: 2,
      kind: 'exercise' as const,
      delivery: 'manual_only' as const,
      instruction: 'Work on part B.',
      criterionIds: ['part-b'],
      createdAt: '2026-08-21T00:00:00.000Z',
    };
    const inspect = vi.fn(async (attemptId: string) => ({
      attemptId,
      definition: { launchTarget: 'current_surface' as const },
    }));
    const create = vi.fn(async (
      _attempt: unknown,
      _taskId: string,
      _launchTarget: string,
      purpose: string,
    ) => ({
      workSessionId: '12121212-1212-4121-8121-121212121212',
      purpose,
    }));
    const runtime = {
      submit: vi.fn((_request: unknown, options: { taskId: string }) => ({ taskId: options.taskId })),
    } as unknown as TaskRuntime;
    const execution = {
      start: vi.fn(({ taskId }: { taskId: string }) => ({ taskId, phase: 'planning' })),
    } as unknown as TaskExecutionCoordinator;
    const service = new TaskApplicationService(runtime, execution, {
      activityContextService: { create, inspect } as never,
      activityProgressReporter: { bind: vi.fn(), fail: vi.fn() },
      classroomSessionService: {
        activeStudentAttemptId: () => inheritedAttemptId,
        latestDirective: () => directive,
      },
    });

    await service.submitAndStart({
      text: 'Please help me with this step.',
      activityIntent: 'help',
    });
    await service.submitAndStart({
      text: 'Check the other assignment.',
      activityAttemptId: explicitAttemptId,
      activityIntent: 'check',
    });

    expect(inspect).toHaveBeenNthCalledWith(1, inheritedAttemptId);
    expect(inspect).toHaveBeenNthCalledWith(2, explicitAttemptId);
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attemptId: inheritedAttemptId }),
      expect.any(String),
      'current_surface',
      'help',
      directive,
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attemptId: explicitAttemptId }),
      expect.any(String),
      'current_surface',
      'check',
      null,
    );
    expect(runtime.submit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        activityAttemptId: inheritedAttemptId,
        activityIntent: 'help',
      }),
      expect.objectContaining({ activity: expect.objectContaining({ purpose: 'help' }) }),
    );
  });

  it('keeps Help and Check scoped to an active class Attempt', async () => {
    const service = new TaskApplicationService(
      { submit: vi.fn() } as unknown as TaskRuntime,
      { start: vi.fn() } as unknown as TaskExecutionCoordinator,
    );

    await expect(service.submitAndStart({
      text: 'Can you check this?',
      activityIntent: 'check',
    })).rejects.toThrow('Join an active class');
  });

  it('marks the Work Session failed when task launch cannot start', async () => {
    const fail = vi.fn(async () => undefined);
    const bind = vi.fn();
    const service = new TaskApplicationService(
      { submit: vi.fn(() => { throw new Error('runtime unavailable'); }) } as unknown as TaskRuntime,
      { start: vi.fn() } as unknown as TaskExecutionCoordinator,
      {
        activityContextService: {
          inspect: vi.fn(async () => ({
            attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            definition: { launchTarget: 'current_surface' as const },
          })),
          create: vi.fn(async () => ({
            workSessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          })),
        } as never,
        activityProgressReporter: { bind, fail },
      },
    );

    await expect(service.submitAndStart({
      activityAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      text: 'Check my work.',
    })).rejects.toThrow('runtime unavailable');
    const taskId = bind.mock.calls[0]?.[0];
    expect(fail).toHaveBeenCalledWith(taskId);
  });

  it('does not report a hosted Work Session as failed when launch outcome is unknown', async () => {
    const fail = vi.fn(async () => undefined);
    const service = new TaskApplicationService(
      {} as TaskRuntime,
      {} as TaskExecutionCoordinator,
      {
        activityContextService: {
          inspect: vi.fn(async () => ({
            attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            definition: { launchTarget: 'current_surface' as const },
          })),
          create: vi.fn(async () => ({
            workSessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          })),
        } as never,
        activityProgressReporter: { bind: vi.fn(), fail },
        hostedTaskClient: {
          submit: vi.fn(async () => {
            throw new HostedTaskOutcomeUnknownError(new Error('offline'));
          }),
        } as never,
        useHostedRuntime: () => true,
      },
    );

    await expect(service.submitAndStart({
      activityAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      text: 'Check my work.',
    })).rejects.toBeInstanceOf(HostedTaskOutcomeUnknownError);
    expect(fail).not.toHaveBeenCalled();
  });

  it('rebinds restored hosted Activity runs to their Work Sessions', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const workSessionId = '22222222-2222-4222-8222-222222222222';
    const bind = vi.fn();
    const outcomeContract = compileOutcomeContract('Continue the exercise.');
    const intentAuthorization = compileIntentAuthorization('Continue the exercise.');
    const record = {
      id: '33333333-3333-4333-8333-333333333333',
      taskId,
      clientTaskId: '44444444-4444-4444-8444-444444444444',
      request: 'Continue the exercise.',
      executionProfile: 'everyday' as const,
      workspaceSelectionId: null,
      state: 'planning' as const,
      protocolVersion: 2,
      runVersion: 1,
      outcomeRevision: 1,
      contractSchemaVersion: 8 as const,
      autonomyMode: 'balanced' as const,
      outcomeContract,
      intentAuthorization,
      activity: {
        attemptId: '55555555-5555-4555-8555-555555555555',
        workSessionId,
        purpose: 'work' as const,
      },
      publicSummary: 'Planning.',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    };
    const runtime = {
      submit: vi.fn(),
      start: vi.fn(() => ({ taskId, phase: 'planning', goal: null })),
    } as unknown as TaskRuntime;
    const service = new TaskApplicationService(
      runtime,
      {} as TaskExecutionCoordinator,
      {
        activityProgressReporter: { bind, fail: vi.fn() },
        hostedTaskClient: {
          list: vi.fn(async () => [record]),
          subscribe: vi.fn(async () => undefined),
        } as never,
      },
    );

    await expect(service.restoreHostedRuns()).resolves.toBe(1);
    expect(bind).toHaveBeenCalledWith(taskId, workSessionId);
  });

  it('uses the backend v8 projection as the local hosted task authority', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const outcomeContract = compileOutcomeContract('Create a calendar event.');
    const intentAuthorization = compileIntentAuthorization('Create a calendar event.');
    const runtime = {
      submit: vi.fn(() => ({ taskId })),
      start: vi.fn(() => ({ taskId, phase: 'planning', goal: null })),
    } as unknown as TaskRuntime;
    const execution = {} as TaskExecutionCoordinator;
    const submit = vi.fn(async (input: {
      clientTaskId: string;
      taskId: string;
      request: string;
    }) => ({
      id: '22222222-2222-4222-8222-222222222222',
      taskId: input.taskId,
      clientTaskId: input.clientTaskId,
      request: input.request,
      executionProfile: 'everyday' as const,
      workspaceSelectionId: null,
      state: 'queued' as const,
      protocolVersion: 2,
      runVersion: 1,
      outcomeRevision: 1,
      contractSchemaVersion: 8 as const,
      autonomyMode: 'balanced' as const,
      outcomeContract,
      intentAuthorization,
      publicSummary: 'Queued.',
      createdAt: '2026-08-21T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
    }));
    const service = new TaskApplicationService(runtime, execution, {
      hostedTaskClient: {
        submit,
        subscribe: vi.fn(async () => undefined),
      } as never,
      useHostedRuntime: () => true,
    });

    await service.submitAndStart({ text: 'Create a calendar event.' });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        activityAttemptId: null,
        activityIntent: 'work',
        autonomyMode: 'balanced',
        taskId: expect.any(String),
      }),
    );
    expect(runtime.submit).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Create a calendar event.' }),
      expect.objectContaining({
        intentAuthorization,
        outcomeContract,
        autonomyMode: 'balanced',
      }),
    );
  });

  it('refreshes the backend authority projection after hosted steering', async () => {
    const runtime = new TaskRuntime({ intentAuthorizationEnabled: false });
    const outcomeContract = compileOutcomeContract('Create a calendar event.');
    const intentAuthorization = compileIntentAuthorization(
      'Create a calendar event.',
    );
    let record: HostedTaskRecord | undefined;
    const submit = vi.fn(async (input: {
      clientTaskId: string;
      taskId: string;
      request: string;
    }) => {
      const created = {
        id: '22222222-2222-4222-8222-222222222222',
        taskId: input.taskId,
        clientTaskId: input.clientTaskId,
        request: input.request,
        executionProfile: 'everyday' as const,
        workspaceSelectionId: null,
        state: 'queued' as const,
        protocolVersion: 2,
        runVersion: 1,
        outcomeRevision: 1,
        contractSchemaVersion: 8 as const,
        autonomyMode: 'balanced' as const,
        outcomeContract,
        intentAuthorization,
        publicSummary: 'Queued.',
        createdAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
      };
      record = created;
      return created;
    });
    const get = vi.fn(async () => {
      if (!record) throw new Error('Expected a submitted hosted record.');
      return {
        ...record,
        outcomeRevision: 2,
        outcomeContract: { ...outcomeContract, revision: 2 },
        intentAuthorization: compileIntentAuthorization(
          'Create a calendar event. Also create a document.',
          { revision: 2 },
        ),
        updatedAt: '2026-08-21T00:01:00.000Z',
      };
    });
    const steer = vi.fn(async () => undefined);
    const service = new TaskApplicationService(
      runtime,
      {} as TaskExecutionCoordinator,
      {
        hostedTaskClient: {
          get,
          steer,
          submit,
          subscribe: vi.fn(async () => undefined),
        } as never,
        useHostedRuntime: () => true,
      },
    );
    const started = await service.submitAndStart({
      text: 'Create a calendar event.',
    });
    const revised = await service.steer({
      taskId: started.taskId,
      instruction: 'Also create a document.',
    });

    expect(steer).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    expect(revised.goal).toMatchObject({
      schemaVersion: 8,
      intentAuthorization: { revision: 2 },
      outcomeContract: { revision: 2 },
    });
  });
});
