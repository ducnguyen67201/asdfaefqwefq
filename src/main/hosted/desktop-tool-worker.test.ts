import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceIdentity } from '../../shared/contracts';
import { createCuaSemanticToolDefinitions } from '../agent/cua-semantic-agent-tools';
import {
  RuntimeToolRegistry,
  type TrustedToolExecutionContext,
} from '../agent/runtime-tool-registry';
import { createCuaDriverCatalog } from '../cua/cua-semantic-contracts';

import {
  DesktopToolWorker,
  fitDesktopResultForTransport,
} from './desktop-tool-worker';
import {
  HOSTED_AGENT_PROTOCOL_DIGEST,
  HOSTED_AGENT_TOOL_CATALOG_DIGEST,
} from './desktop-worker-protocol';

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 5,
    protocolDigest: HOSTED_AGENT_PROTOCOL_DIGEST,
    toolCatalogDigest: HOSTED_AGENT_TOOL_CATALOG_DIGEST,
    driverCatalogDigest: null,
    invocationId: randomUUID(),
    runId: randomUUID(),
    runVersion: 1,
    callId: 'call-1',
    toolId: 'application.launch',
    operation: 'launch',
    permissionInteractionId: null,
    permissionRequirements: [],
    input: { application: 'chrome', reason: 'Open Chrome.' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function hostedGoal(
  _request: string,
  workspace: WorkspaceIdentity | null = null,
): TrustedToolExecutionContext {
  return {
    activity: null,
    executionProfile: workspace ? 'workspace' : 'everyday',
    taskId: randomUUID(),
    workspace,
  };
}

describe('DesktopToolWorker', () => {
  it('compacts an oversized result while preserving grounded observation context', () => {
    const observationId = randomUUID();
    const fitted = fitDesktopResultForTransport({
      invocationId: randomUUID(),
      status: 'confirmed',
      summary: 'Captured a detailed desktop observation.',
      data: {
        observation: {
          capturedAt: new Date().toISOString(),
          coordinateSpace: {
            screenHeight: 900,
            screenWidth: 1_440,
            screenshotHeight: 900,
            screenshotWidth: 1_440,
          },
          degraded: false,
          elements: [{
            ref: 'e1',
            role: 'button',
            name: 'Open'.repeat(5_000),
            value: 'value'.repeat(10_000),
          }],
          fingerprint: 'a'.repeat(64),
          observationId,
          route: 'desktop_vision',
          structuredState: 'state'.repeat(20_000),
          taskId: randomUUID(),
          text: 'Chrome is visible. '.repeat(5_000),
        },
      },
      visual: {
        dataBase64: 'aW1hZ2U=',
        detail: 'original',
        mimeType: 'image/png',
        observationId,
      },
    }, 30_000);

    expect(new TextEncoder().encode(JSON.stringify(fitted)).byteLength).toBeLessThanOrEqual(30_000);
    expect(fitted.data?.resultDataTruncated).toBe(true);
    expect(fitted.data?.observation).toMatchObject({
      coordinateSpace: { screenshotHeight: 900, screenshotWidth: 1_440 },
      elements: [{ ref: 'e1', role: 'button' }],
      observationId,
    });
    expect(
      (fitted.data?.observation as { structuredState?: unknown }).structuredState,
    ).toBeUndefined();
    expect(fitted.visual?.observationId).toBe(observationId);

    const oversizedVisual = fitDesktopResultForTransport({
      ...fitted,
      visual: {
        dataBase64: '💥'.repeat(10_000),
        detail: 'original',
        mimeType: 'image/png',
        observationId,
      },
    }, 30_000);
    expect(new TextEncoder().encode(JSON.stringify(oversizedVisual)).byteLength)
      .toBeLessThanOrEqual(30_000);
    expect(oversizedVisual.visual).toBeUndefined();
    expect(oversizedVisual.data?.visualOmittedForTransport).toBe(true);
  });

  it('rejects an expired envelope before asking to execute', async () => {
    const commitResult = vi.fn(async () => undefined);
    const requestExecuting = vi.fn(async () => true);
    const input = envelope({ expiresAt: new Date(Date.now() - 1).toISOString() });
    const goal = hostedGoal('Open Chrome.');
    const worker = new DesktopToolWorker({
      commitResult,
      dispatcher: { dispatch: vi.fn() },
      executionContextProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting,
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
      executionContextProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => true),
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
      executionContextProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => false),
    });

    const result = await worker.handle(envelope());

    expect(result).toMatchObject({ status: 'not_executed' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reports a post-dispatch exception as unknown so it cannot be replayed', async () => {
    const dispatch = vi.fn(async () => {
      throw new Error('Connection dropped after dispatch.');
    });
    const goal = hostedGoal('Open Chrome.');
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: { dispatch },
      executionContextProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => true),
    });

    const result = await worker.handle(envelope());

    expect(result).toMatchObject({
      status: 'unknown',
      summary:
        'Tool execution stopped after dispatch; the outcome is unknown and will not be retried.',
    });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('reports an invalid post-dispatch result as unknown so it cannot be replayed', async () => {
    const dispatch = vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'x'.repeat(1_001),
    }));
    const goal = hostedGoal('Open Chrome.');
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: { dispatch },
      executionContextProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => true),
    });

    const result = await worker.handle(envelope());

    expect(result).toMatchObject({
      status: 'unknown',
      summary:
        'Tool execution stopped after dispatch; the outcome is unknown and will not be retried.',
    });
    expect(dispatch).toHaveBeenCalledOnce();
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
      executionContextProvider: () => goal,
      permissionCoordinator: { requireReady },
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => true),
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

  it('dispatches a registered desktop action after the one-time transition', async () => {
    const requestExecuting = vi.fn(async () => true);
    const goal = hostedGoal('Send the visible message.');
    const observationId = randomUUID();
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: {
        dispatch: vi.fn(async () => ({ status: 'confirmed' as const, summary: 'Sent.' })),
      },
      executionContextProvider: () => goal,
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
        taskId: goal.taskId,
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
    });
    const result = await worker.handle(envelope({
      toolId: 'desktop.control',
      operation: 'click',
      input: {
        observationId,
        observationFingerprint: 'a'.repeat(64),
        description: 'Send the visible message.',
        target: 'Send button',
        command: { kind: 'click', x: 500, y: 500, button: 'left', count: 1 },
      },
    }));
    expect(result).toMatchObject({ status: 'confirmed', summary: 'Sent.' });
    expect(requestExecuting).toHaveBeenCalledWith(
      expect.any(String),
      1,
    );
  });

  it('dispatches a purchase-labelled desktop action without policy classification', async () => {
    const dispatch = vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'Clicked the purchase button.',
    }));
    const requestExecuting = vi.fn(async () => true);
    const goal = hostedGoal('Purchase the visible item.');
    const observationId = randomUUID();
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: { dispatch },
      executionContextProvider: () => goal,
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
        taskId: goal.taskId,
        text: 'A purchase button is visible.',
      }),
      permissionCoordinator: {
        requireReady: vi.fn(async () => ({
          outcome: 'granted' as const,
          runVersion: 1,
        })),
      },
      registry: new RuntimeToolRegistry(),
      requestExecuting,
    });

    const result = await worker.handle(envelope({
      toolId: 'desktop.control',
      operation: 'click',
      input: {
        observationId,
        description: 'Purchase the visible item.',
        target: 'Purchase button',
        command: { kind: 'click', x: 500, y: 500, button: 'left', count: 1 },
      },
    }));

    expect(result).toMatchObject({ status: 'confirmed' });
    expect(requestExecuting).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('dispatches a delete-labelled semantic action without policy classification', async () => {
    const dispatch = vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'Clicked the delete button.',
    }));
    const requestExecuting = vi.fn(async () => true);
    const goal = hostedGoal('Delete the visible item.');
    const observationId = randomUUID();
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: { dispatch },
      executionContextProvider: () => goal,
      latestObservationProvider: () => ({
        capturedAt: new Date().toISOString(),
        degraded: false,
        elements: [{ ref: 'e1', role: 'button', name: 'Delete' }],
        fingerprint: 'a'.repeat(64),
        observationId,
        route: 'window_accessibility',
        surface: { application: 'Example', kind: 'native_app' },
        taskId: goal.taskId,
        text: 'A delete button is visible.',
      }),
      permissionCoordinator: {
        requireReady: vi.fn(async () => ({
          outcome: 'granted' as const,
          runVersion: 1,
        })),
      },
      registry: new RuntimeToolRegistry(createCuaSemanticToolDefinitions({
        browserPrepareAvailable: () => true,
        semanticAvailable: () => true,
      })),
      requestExecuting,
    });

    const result = await worker.handle(envelope({
      toolId: 'computer.control',
      operation: 'click_element',
      input: {
        observationId,
        description: 'Delete the visible item.',
        target: 'Delete',
        command: {
          kind: 'click_element',
          ref: 'e1',
          button: 'left',
          count: 1,
        },
      },
    }));

    expect(result).toMatchObject({ status: 'confirmed' });
    expect(requestExecuting).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
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
      executionContextProvider: () => goal,
      permissionCoordinator: {
        requireReady: vi.fn(async () => ({
          outcome: 'granted' as const,
          runVersion: 3,
        })),
      },
      registry: new RuntimeToolRegistry(),
      requestExecuting,
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

  it('returns observation metadata and visual evidence to the hosted SDK', async () => {
    const goal = hostedGoal('Inspect the current screen.');
    const observationId = randomUUID();
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      dispatcher: {
        dispatch: vi.fn(async () => ({
          status: 'confirmed' as const,
          summary: 'Captured a fresh desktop observation.',
          observation: {
            capturedAt: new Date().toISOString(),
            coordinateSpace: {
              screenHeight: 900,
              screenWidth: 1_440,
              screenshotHeight: 900,
              screenshotWidth: 1_440,
            },
            degraded: false,
            fingerprint: 'a'.repeat(64),
            observationId,
            route: 'desktop_vision' as const,
            screenshot: {
              dataBase64: Buffer.from('desktop screenshot').toString('base64'),
              mimeType: 'image/png',
            },
            taskId: goal.taskId,
            text: 'Chrome is visible with an empty address bar.',
          },
        })),
      },
      executionContextProvider: () => goal,
      permissionCoordinator: {
        requireReady: vi.fn(async () => ({ outcome: 'granted' as const, runVersion: 1 })),
      },
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => true),
    });

    const result = await worker.handle(envelope({
      toolId: 'desktop.observe',
      operation: 'observe',
      input: { reason: 'Inspect the current screen.' },
    }));

    expect(result.data?.observation).toMatchObject({
      coordinateSpace: { screenshotHeight: 900, screenshotWidth: 1_440 },
      observationId,
      text: 'Chrome is visible with an empty address bar.',
    });
    expect((result.data?.observation as { screenshot?: unknown }).screenshot).toBeUndefined();
    expect(result.visual).toEqual({
      dataBase64: Buffer.from('desktop screenshot').toString('base64'),
      detail: 'original',
      mimeType: 'image/png',
      observationId,
    });
  });

  it('commits a registered Workspace write without a user-decision callback', async () => {
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
      executionContextProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting,
    });
    const result = await worker.handle(envelope({
      toolId: 'workspace.filesystem',
      operation: 'write_file',
      input: { path: 'src/example.ts', content: 'export {};' },
    }));

    expect(result.status).toBe('confirmed');
    expect(requestExecuting).toHaveBeenCalledWith(
      expect.any(String),
      1,
    );
  });

  it('dispatches an arbitrary Workspace command without semantic classification', async () => {
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
      executionContextProvider: () => goal,
      registry: new RuntimeToolRegistry(),
      requestExecuting,
    });

    const result = await worker.handle(envelope({
      toolId: 'workspace.terminal',
      operation: 'run_command',
      input: {
        command: 'git push origin main && curl https://example.com/hook',
        timeoutMs: 120_000,
      },
    }));

    expect(result.status).toBe('confirmed');
    expect(requestExecuting).toHaveBeenCalledWith(expect.any(String), 1);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it('dispatches a newly discovered CUA tool through the generic driver adapter', async () => {
    const goal = hostedGoal('Use the future CUA capability.');
    const catalog = createCuaDriverCatalog(
      {
        driverVersion: '0.20.0',
        contractVersion: '0.7.0',
        toolsListSchemaVersion: '1',
        capabilityVersion: '2',
      },
      {
        capability_version: '2',
        schema_version: '1',
        tools: [{
          name: 'future_cua_action',
          description: 'A future driver tool.',
          capabilities: ['future.action'],
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        }],
      },
    );
    const executeCuaTool = vi.fn(async () => ({
      status: 'confirmed' as const,
      summary: 'Future tool completed.',
    }));
    const dispatch = vi.fn();
    const worker = new DesktopToolWorker({
      commitResult: vi.fn(async () => undefined),
      cua: {
        cuaToolCatalog: () => catalog,
        executeCuaTool,
      },
      dispatcher: { dispatch },
      executionContextProvider: () => goal,
      permissionCoordinator: {
        requireReady: vi.fn(async ({ invocation }) => ({
          outcome: 'granted' as const,
          runVersion: invocation.runVersion,
        })),
      },
      registry: new RuntimeToolRegistry(),
      requestExecuting: vi.fn(async () => true),
    });

    const result = await worker.handle(envelope({
      driverCatalogDigest: catalog.driverCatalogDigest,
      toolId: 'cua.driver',
      operation: 'future_cua_action',
      input: { value: 'hello' },
    }));

    expect(result.status).toBe('confirmed');
    expect(dispatch).not.toHaveBeenCalled();
    expect(executeCuaTool).toHaveBeenCalledWith(
      goal.taskId,
      'future_cua_action',
      { value: 'hello' },
      catalog.driverCatalogDigest,
      expect.any(AbortSignal),
    );
  });
});
