import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  HOST_ALWAYS_CONFIRM_EFFECTS,
  type HostedTaskAuthorityContract,
} from '../../shared/contracts';

import { TaskRuntime } from './task-runtime';

function authority(request: string): HostedTaskAuthorityContract {
  return {
    schemaVersion: 8,
    id: randomUUID(),
    originalRequest: request,
    runtimeKind: 'rust_hosted',
    executionProfile: 'everyday',
    autonomyMode: 'balanced',
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
    approvalPolicy: { alwaysConfirmEffects: [...HOST_ALWAYS_CONFIRM_EFFECTS] },
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

const sendAction = {
  action: 'send' as const,
  toolId: 'desktop.control' as const,
  operation: 'click',
  effect: {
    kind: 'send_communication' as const,
    resourceKind: 'message' as const,
    reversibility: 'reversible' as const,
    externality: 'external' as const,
    communication: 'send' as const,
    overwrite: 'none' as const,
    sensitiveDataTransfer: false as const,
  },
  description: 'Send the exact message.',
};

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

  it('binds and consumes one exact local approval without reevaluating policy', () => {
    const runtime = new TaskRuntime();
    const task = submit(runtime);
    const waiting = runtime.requestApproval({
      action: sendAction,
      consequence: sendAction.description,
      prompt: sendAction.description,
      taskId: task.taskId,
    });
    const interaction = waiting.pendingInteraction;
    expect(interaction?.kind).toBe('approval');
    if (!interaction || interaction.kind !== 'approval') throw new Error('missing approval');

    const approved = runtime.decideApproval({
      taskId: task.taskId,
      interactionId: interaction.id,
      kind: 'approval',
      decision: 'approve',
      actionDigest: interaction.actionDigest,
    });
    expect(approved.approvalGrant?.actionDigest).toBe(interaction.actionDigest);
    expect(runtime.consumeApprovalGrant({ taskId: task.taskId, action: sendAction }))
      .toMatchObject({ approvalGrant: null, phase: 'acting' });
    expect(() =>
      runtime.consumeApprovalGrant({ taskId: task.taskId, action: sendAction }),
    ).toThrow('no approved action grant');
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
