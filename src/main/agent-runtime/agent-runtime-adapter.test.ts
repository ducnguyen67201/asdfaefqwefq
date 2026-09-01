import type { UtilityProcess } from 'electron';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  LocalAgentHostMessageSchema,
  type LocalAgentHostMessage,
} from '../../../services/agent-runtime/src/protocol';
import type { ToolExecutionResult } from '../agent/agent-contracts';
import type { DesktopObservation } from '../agent/execution-contracts';

import {
  LocalAgentRuntime,
  executionContextAfterToolResult,
  normalizeLocalToolResult,
  pendingToolResumeDisposition,
} from './agent-runtime-adapter';

vi.mock('electron', () => ({
  utilityProcess: { fork: vi.fn() },
}));

class FakeUtilityProcess extends EventEmitter {
  readonly messages: LocalAgentHostMessage[] = [];
  killed = false;

  constructor(private readonly behavior: 'ready' | 'exit') {
    super();
  }

  launch(): void {
    queueMicrotask(() => this.emit('spawn'));
  }

  postMessage(input: unknown): void {
    const message = LocalAgentHostMessageSchema.parse(input);
    this.messages.push(message);
    if (message.kind === 'runtime.validateCatalog') {
      queueMicrotask(() => this.emit('message', {
        kind: 'runtime.catalogValidated',
        requestId: message.requestId,
        acceptedModelNames: message.tools.map((tool) => tool.modelName),
        rejected: [],
      }));
      return;
    }
    if (message.kind !== 'runtime.initialize') return;
    if (this.behavior === 'exit') {
      queueMicrotask(() => this.emit('exit', 17));
      return;
    }
    queueMicrotask(() => this.emit('message', {
      kind: 'runtime.ready',
      requestId: message.requestId,
      runtime: message.expected,
    }));
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function runtimeWith(process: FakeUtilityProcess): LocalAgentRuntime {
  return new LocalAgentRuntime({
    accessTokenProvider: async () => 'user-session-credential',
    apiBaseUrl: 'https://api.example.test',
    coordinator: {
      dispatchTool: vi.fn(),
      endTask: vi.fn(async () => undefined),
    },
    forkUtilityProcess: () => {
      process.launch();
      return process as unknown as UtilityProcess;
    },
    isPackaged: false,
    repositoryRoot: '/repo',
    resourcesPath: '/resources',
    runtimeReadyTimeoutMs: 100,
    state: {} as never,
    tools: {
      endTask: vi.fn(),
      freeze: vi.fn(),
      resolve: vi.fn(),
    } as never,
  });
}

describe('LocalAgentRuntime process supervision', () => {
  it('rechecks undispatched pending tools but replays journaled effects', () => {
    const invocation = {
      callId: 'call-1',
      idempotencyDigest: 'a'.repeat(64),
      operation: 'click',
      result: null,
      status: 'checkpointed' as const,
      toolId: 'computer.control',
      updatedAt: '2026-09-01T07:30:00.000Z',
    };

    expect(pendingToolResumeDisposition(null)).toBe('recheck');
    expect(pendingToolResumeDisposition(invocation)).toBe('recheck');
    expect(pendingToolResumeDisposition({
      ...invocation,
      status: 'executing',
    })).toBe('replay');
    expect(pendingToolResumeDisposition({
      ...invocation,
      result: {
        status: 'completed',
        summary: 'The click completed.',
        data: null,
        imageDataUrl: null,
      },
      status: 'completed',
    })).toBe('replay');
    expect(pendingToolResumeDisposition({
      ...invocation,
      result: {
        status: 'completed',
        summary: 'Captured an observation.',
        data: null,
        imageDataUrl: 'data:image/png;base64,aW1hZ2U=',
      },
      status: 'completed',
      toolId: 'computer.observe',
    })).toBe('reobserve');
  });

  it('sends credentials only after a compatible runtime handshake', async () => {
    const process = new FakeUtilityProcess('ready');
    await runtimeWith(process).initialize();

    expect(process.messages.map((message) => message.kind)).toEqual([
      'runtime.initialize',
      'runtime.replaceCredential',
    ]);
    expect(process.messages[0]).not.toHaveProperty('credential');
    expect(process.messages[1]).toMatchObject({
      credential: 'user-session-credential',
    });
  });

  it('fails promptly when the utility process exits before readiness', async () => {
    const process = new FakeUtilityProcess('exit');

    await expect(runtimeWith(process).initialize()).rejects.toThrow(
      'exited before it was ready',
    );
  });

  it('validates a catalog through the bundled SDK process before task start', async () => {
    const process = new FakeUtilityProcess('ready');
    const runtime = runtimeWith(process);
    await runtime.initialize();
    const validation = await runtime.validateToolCatalog(
      [{
        toolId: 'cua.valid_action',
        modelName: 'valid_action',
        description: 'Valid action.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: [],
        },
        operations: ['valid_action'],
        driverCatalogDigest: 'a'.repeat(64),
      }],
      'b'.repeat(64),
    );

    expect(validation).toMatchObject({
      acceptedModelNames: ['valid_action'],
      rejected: [],
    });
    expect(process.messages.map((message) => message.kind)).toContain(
      'runtime.validateCatalog',
    );
  });
});

describe('LocalAgentRuntime observation delivery', () => {
  const observation: DesktopObservation = {
    capturedAt: '2026-09-01T02:00:00.000Z',
    degraded: false,
    fingerprint: 'a'.repeat(64),
    observationId: '0f157354-9ed4-4dc8-a1fa-9020f13a7710',
    route: 'window_vision',
    screenshot: {
      dataBase64: 'aW1hZ2U=',
      mimeType: 'image/png',
    },
    surface: { application: 'Scratch', kind: 'native_app' },
    taskId: '475131d4-d970-46c9-85ca-8ddc4d3f85db',
    text: 'Scratch shows an exercise asking for a repeat loop.',
  };

  const toolResult: ToolExecutionResult = {
    observation,
    status: 'confirmed',
    summary: 'Captured a fresh application-surface observation.',
  };

  it('returns observation metadata and the screenshot to the model', () => {
    expect(normalizeLocalToolResult(toolResult)).toEqual({
      status: 'completed',
      summary: 'Captured a fresh application-surface observation.',
      data: {
        observation: {
          capturedAt: observation.capturedAt,
          degraded: false,
          observationId: observation.observationId,
          route: 'window_vision',
          surface: observation.surface,
          text: observation.text,
        },
      },
      imageDataUrl: 'data:image/png;base64,aW1hZ2U=',
    });
  });

  it('keeps the latest observation available for the next grounded tool call', () => {
    const context = {
      activity: null,
      executionProfile: 'everyday' as const,
      taskId: observation.taskId,
      workspace: null,
    };

    const updated = executionContextAfterToolResult(context, toolResult);

    expect(updated).not.toBe(context);
    expect(updated.latestObservation).toBe(observation);
    expect(context).not.toHaveProperty('latestObservation');
  });
});
