import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { HostedTaskAuthorityContractV10 } from '../../shared/contracts';

import { TaskRuntime } from './task-runtime';

function authority(request: string): HostedTaskAuthorityContractV10 {
  return {
    schemaVersion: 10,
    id: randomUUID(),
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
}

function submit(runtime: TaskRuntime, request = 'Send the message.') {
  return runtime.submit(
    { text: request },
    { authority: authority(request), taskId: randomUUID(), workspace: null },
  );
}

describe('TaskRuntime Rust projection', () => {
  it('requires an exact Rust authority contract', () => {
    const runtime = new TaskRuntime();

    expect(() =>
      runtime.submit(
        { text: 'Different request.' },
        {
          authority: authority('Canonical request.'),
          taskId: randomUUID(),
          workspace: null,
        },
      ),
    ).toThrow('does not match the task request');
  });

  it('keeps clarification as the only local pending interaction', () => {
    const runtime = new TaskRuntime();
    const task = submit(runtime);
    const waiting = runtime.requestInput({
      prompt: 'Which account should Tro use?',
      taskId: task.taskId,
      choices: [{ id: 'work', label: 'Work' }],
    });
    const interaction = waiting.pendingInteraction;
    expect(interaction?.kind).toBe('clarification');
    if (!interaction) throw new Error('missing clarification');

    const answered = runtime.respondToInteraction({
      taskId: task.taskId,
      interactionId: interaction.id,
      kind: 'answer',
      text: 'Use my work account.',
    });
    expect(answered).toMatchObject({ pendingInteraction: null, phase: 'planning' });
  });

  it('forwards canonical hosted snapshots to renderer subscribers', () => {
    const runtime = new TaskRuntime();
    const task = submit(runtime);
    const listener = vi.fn();
    runtime.on('task-update', listener);
    const event = {
      eventId: randomUUID(),
      taskId: task.taskId,
      phase: 'completed' as const,
      timestamp: new Date().toISOString(),
      status: 'success' as const,
      summary: 'Rust completed the task.',
      nextActions: [],
      artifacts: [],
    };

    runtime.projectHostedSnapshot({ ...task, phase: 'completed', lastEvent: event });

    expect(listener).toHaveBeenCalledWith({
      event,
      snapshot: expect.objectContaining({ phase: 'completed' }),
    });
  });
});
