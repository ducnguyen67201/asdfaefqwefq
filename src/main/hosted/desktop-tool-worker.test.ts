import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { GoalSpec, WorkspaceIdentity } from '../../shared/contracts';
import { RuntimeToolRegistry } from '../agent/runtime-tool-registry';

import { DesktopToolWorker } from './desktop-tool-worker';
import {
  HOSTED_AGENT_PROTOCOL_DIGEST,
  HOSTED_AGENT_TOOL_CATALOG_DIGEST,
} from './desktop-worker-protocol';

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 4,
    protocolDigest: HOSTED_AGENT_PROTOCOL_DIGEST,
    toolCatalogDigest: HOSTED_AGENT_TOOL_CATALOG_DIGEST,
    invocationId: randomUUID(),
    runId: randomUUID(),
    runVersion: 1,
    callId: 'call-1',
    toolId: 'application.launch',
    operation: 'launch',
    effect: {
      kind: 'none',
      resourceKind: null,
      reversibility: 'none',
      externality: 'local',
      communication: 'none',
      overwrite: 'none',
      sensitiveDataTransfer: false,
    },
    consequential: false,
    permissionInteractionId: null,
    permissionRequirements: [],
    input: { application: 'chrome', reason: 'Open Chrome.' },
    obligations: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function hostedGoal(
  request: string,
  workspace: WorkspaceIdentity | null = null,
): GoalSpec {
  return {
    schemaVersion: 9,
    id: randomUUID(),
    originalRequest: request,
    runtimeKind: 'rust_hosted',
    executionProfile: workspace ? 'workspace' : 'everyday',
    workspace,
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
    limits: {
      maxImages: 20,
      maxMicroUsd: 5_000_000,
      maxMinutes: 30,
      maxModelSamples: 40,
      maxToolCalls: 30,
    },
  };
}

describe('DesktopToolWorker', () => {
  it('rejects an expired envelope before asking to execute', async () => {
    const commitResult = vi.fn(async () => undefined);
    const requestExecuting = vi.fn(async () => true);
    const input = envelope({ expiresAt: new Date(Date.now() - 1).toISOString() });
    const goal = hostedGoal('Open Chrome.');
    const worker = new DesktopToolWorker({
      commitResult,
      dispatcher: { dispatch: vi.fn() },
      goalProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting,
      taskIdProvider: () => goal.id,
    });

    const result = await worker.handle(input);

    expect(result.status).toBe('not_executed');
    expect(requestExecuting).not.toHaveBeenCalled();
    expect(commitResult).toHaveBeenCalledOnce();
  });

  it('returns the same committed result for duplicate delivery', async () => {
    const commitResult = vi.fn(async () => undefined);
    const dispatch = vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'Chrome is visible.',
      data: {
        applicationSurfaceEvidence: {
          observationFingerprint: 'a'.repeat(64),
          observationId: randomUUID(),
        },
      },
    }));
    const input = envelope();
    const goal = hostedGoal('Open Chrome.');
    const worker = new DesktopToolWorker({
      commitResult,
      dispatcher: { dispatch },
      goalProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => true),
      taskIdProvider: () => goal.id,
    });

    const first = await worker.handle(input);
    const second = await worker.handle(input);

    expect(second).toEqual(first);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(commitResult).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch when the one-time executing transition is stale', async () => {
    const dispatch = vi.fn();
    const goal = hostedGoal('Open Chrome.');
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: { dispatch },
      goalProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => false),
      taskIdProvider: () => goal.id,
    });

    const result = await worker.handle(envelope());

    expect(result).toMatchObject({ status: 'not_executed' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('opens Mở YouTube through direct navigation without computer permission', async () => {
    const dispatch = vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'YouTube is open.',
    }));
    const requireReady = vi.fn(async () => ({
      outcome: 'granted' as const,
      runVersion: 1,
    }));
    const goal = hostedGoal('Mở YouTube.');
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: { dispatch },
      goalProvider: () => goal,
      permissionCoordinator: { requireReady },
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => true),
      taskIdProvider: () => goal.id,
    });

    const result = await worker.handle(envelope({
      toolId: 'browser.navigate',
      operation: 'open_url',
      input: {
        url: 'https://www.youtube.com/',
        reason: 'Mở YouTube.',
      },
    }));

    expect(result).toMatchObject({
      status: 'confirmed',
      summary: 'YouTube is open.',
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(requireReady).not.toHaveBeenCalled();
  });

  it('dispatches a registered sensitive desktop action after the one-time transition', async () => {
    const requestExecuting = vi.fn(async () => true);
    const goal = hostedGoal('Send the visible message.');
    const observationId = randomUUID();
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: {
        dispatch: vi.fn(async () => ({ status: 'confirmed' as const, summary: 'Sent.' })),
      },
      goalProvider: () => goal,
      latestObservationProvider: () => ({
        capturedAt: new Date().toISOString(),
        coordinateSpace: {
          screenHeight: 1_000,
          screenWidth: 1_000,
          screenshotHeight: 1_000,
          screenshotWidth: 1_000,
        },
        degraded: false,
        fingerprint: 'a'.repeat(64),
        observationId,
        route: 'desktop_vision',
        taskId: goal.id,
        text: 'A send button is visible.',
      }),
      permissionCoordinator: {
        requireReady: vi.fn(async () => ({
          outcome: 'granted' as const,
          runVersion: 1,
        })),
      },
      registry: new RuntimeToolRegistry(),
      requestExecuting,
      taskIdProvider: () => goal.id,
    });
    const result = await worker.handle(envelope({
      toolId: 'desktop.control',
      operation: 'click',
      effect: {
        kind: 'send_communication',
        resourceKind: 'email',
        reversibility: 'reversible',
        externality: 'external',
        communication: 'send',
        overwrite: 'none',
        sensitiveDataTransfer: false,
      },
      consequential: true,
      input: {
        observationId,
        observationFingerprint: 'a'.repeat(64),
        consequence: 'send',
        description: 'Send the visible message.',
        target: 'Send button',
        sendPayload: {
          account: 'sender@example.com',
          attachments: null,
          body: 'Hello.',
          recipients: ['recipient@example.com'],
          subject: 'Update',
          threadId: null,
        },
        command: { kind: 'click', x: 500, y: 500, button: 'left', count: 1 },
      },
    }));
    expect(result).toMatchObject({ status: 'confirmed', summary: 'Sent.' });
    expect(requestExecuting).toHaveBeenCalledWith(
      expect.any(String),
      1,
    );
  });

  it('claims execution with the run version returned after permission resumes', async () => {
    const requestExecuting = vi.fn(async () => true);
    const goal = hostedGoal('Inspect the current screen.');
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: {
        dispatch: vi.fn(async () => ({
          status: 'confirmed' as const,
          summary: 'Screen inspected.',
        })),
      },
      goalProvider: () => goal,
      permissionCoordinator: {
        requireReady: vi.fn(async () => ({
          outcome: 'granted' as const,
          runVersion: 3,
        })),
      },
      registry: new RuntimeToolRegistry(),
      requestExecuting,
      taskIdProvider: () => goal.id,
    });

    const result = await worker.handle(envelope({
      toolId: 'desktop.observe',
      operation: 'observe',
      input: {
        reason: 'Inspect the current screen.',
      },
    }));

    expect(result.status).toBe('confirmed');
    expect(requestExecuting).toHaveBeenCalledWith(expect.any(String), 3);
  });

  it('commits a registered Workspace effect without a user-decision callback', async () => {
    const goal = hostedGoal('Update the workspace file.', {
        selectionId: '11111111-1111-4111-8111-111111111111',
        canonicalPath: '/tmp/project',
        displayName: 'project',
        selectedAt: '2026-08-21T00:00:00.000Z',
    });
    const requestExecuting = vi.fn(async () => true);
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: {
        dispatch: vi.fn(async () => ({ status: 'confirmed' as const, summary: 'Updated.' })),
      },
      goalProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting,
      taskIdProvider: () => goal.id,
    });
    const result = await worker.handle(envelope({
      toolId: 'workspace.filesystem',
      operation: 'write_file',
      effect: {
        kind: 'workspace_write',
        resourceKind: 'workspace_file',
        reversibility: 'reversible',
        externality: 'local',
        communication: 'none',
        overwrite: 'requested',
        sensitiveDataTransfer: false,
      },
      consequential: true,
      input: { path: 'src/example.ts', content: 'export {};' },
    }));

    expect(result.status).toBe('confirmed');
    expect(requestExecuting).toHaveBeenCalledWith(
      expect.any(String),
      1,
    );
  });

  it('dispatches an arbitrary bounded Workspace command without semantic classification', async () => {
    const goal = hostedGoal('Run the requested release command.', {
      selectionId: '11111111-1111-4111-8111-111111111111',
      canonicalPath: '/tmp/project',
      displayName: 'project',
      selectedAt: '2026-08-21T00:00:00.000Z',
    });
    const dispatch = vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'Command completed.',
    }));
    const requestExecuting = vi.fn(async () => true);
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: { dispatch },
      goalProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting,
      taskIdProvider: () => goal.id,
    });

    const result = await worker.handle(envelope({
      toolId: 'workspace.terminal',
      operation: 'run_command',
      effect: {
        kind: 'workspace_command',
        resourceKind: 'workspace_repository',
        reversibility: 'unknown',
        externality: 'unknown',
        communication: 'unknown',
        overwrite: 'unknown',
        sensitiveDataTransfer: 'unknown',
      },
      consequential: true,
      input: {
        command: 'git push origin main && curl https://example.com/hook',
        timeoutMs: 120_000,
      },
    }));

    expect(result.status).toBe('confirmed');
    expect(requestExecuting).toHaveBeenCalledWith(expect.any(String), 1);
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
