import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_MODEL, graphVersion } from '../src/config.js';
import type { HostBridge } from '../src/host-bridge.js';
import {
  LocalRuntimeServer,
  rejectPendingToolAfterRestart,
} from '../src/local-runtime-server.js';
import {
  LOCAL_AGENT_CAPABILITIES,
  LOCAL_AGENT_PROTOCOL_DIGEST,
  LOCAL_AGENT_PROTOCOL_VERSION,
  LOCAL_AGENT_ROOT_ID,
  LOCAL_AGENT_SDK_VERSION,
  type LocalAgentChildMessage,
  type LocalAgentHostMessage,
} from '../src/protocol.js';

class FakeBridge extends EventEmitter {
  readonly sent: LocalAgentChildMessage[] = [];

  send(message: LocalAgentChildMessage): void {
    this.sent.push(message);
  }
}

describe('LocalRuntimeServer', () => {
  it('rejects a checkpointed tool that never ran so the model re-checks current state', () => {
    const reject = vi.fn();
    const interruption = {
      rawItem: {
        type: 'function_call',
        callId: 'call-before-restart',
        name: 'control_surface',
        arguments: JSON.stringify({ observationId: randomUUID() }),
      },
    };

    rejectPendingToolAfterRestart({ reject } as never, interruption as never);

    expect(reject).toHaveBeenCalledOnce();
    expect(reject).toHaveBeenCalledWith(interruption, {
      message: expect.stringMatching(/re-check the current state/i),
    });
  });

  it('releases process lifetime only after an explicit runtime shutdown', async () => {
    const bridge = new FakeBridge();
    const onShutdown = vi.fn();
    new LocalRuntimeServer(bridge as unknown as HostBridge, onShutdown);

    bridge.emit('message', {
      kind: 'runtime.shutdown',
      requestId: randomUUID(),
    } satisfies LocalAgentHostMessage);

    await vi.waitFor(() => expect(onShutdown).toHaveBeenCalledOnce());
  });

  it('reports invalid turn preflight as a fatal protocol command', async () => {
    const bridge = new FakeBridge();
    new LocalRuntimeServer(bridge as unknown as HostBridge);
    const expectedGraphVersion = graphVersion([], DEFAULT_AGENT_MODEL);
    bridge.emit('message', {
      kind: 'runtime.initialize',
      requestId: randomUUID(),
      apiBaseUrl: 'https://api.example.com',
      requiredCapabilities: ['sessions', 'compaction'],
      expected: {
        protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
        protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
        sdkVersion: LOCAL_AGENT_SDK_VERSION,
        graphVersion: expectedGraphVersion,
        capabilities: [...LOCAL_AGENT_CAPABILITIES],
      },
    } satisfies LocalAgentHostMessage);
    bridge.emit('message', {
      kind: 'turn.start',
      requestId: randomUUID(),
      threadId: randomUUID(),
      turnId: randomUUID(),
      agentId: LOCAL_AGENT_ROOT_ID,
      parentAgentId: null,
      delegationId: null,
      graphVersion: 'f'.repeat(64),
      sequence: 1,
      agentTurnId: randomUUID(),
      request: 'Inspect the current application.',
      requiredInitialTool: null,
      model: DEFAULT_AGENT_MODEL,
      maxTurns: 4,
      toolCatalogDigest: 'a'.repeat(64),
      tools: [],
    } satisfies LocalAgentHostMessage);

    await vi.waitFor(() => {
      expect(bridge.sent).toContainEqual(expect.objectContaining({
        kind: 'runtime.fatal',
        code: 'runtime_command_failed',
        message: 'graph_version_mismatch',
      }));
    });
  });

  it('quarantines SDK-incompatible tools individually during catalog startup validation', async () => {
    const bridge = new FakeBridge();
    new LocalRuntimeServer(bridge as unknown as HostBridge);
    const expectedGraphVersion = graphVersion([], DEFAULT_AGENT_MODEL);
    bridge.emit('message', {
      kind: 'runtime.initialize',
      requestId: randomUUID(),
      apiBaseUrl: 'https://api.example.com',
      requiredCapabilities: ['sessions', 'compaction', 'catalogValidation'],
      expected: {
        protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
        protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
        sdkVersion: LOCAL_AGENT_SDK_VERSION,
        graphVersion: expectedGraphVersion,
        capabilities: [...LOCAL_AGENT_CAPABILITIES],
      },
    } satisfies LocalAgentHostMessage);
    const requestId = randomUUID();
    bridge.emit('message', {
      kind: 'runtime.validateCatalog',
      requestId,
      catalogDigest: 'a'.repeat(64),
      tools: [
        {
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
          driverCatalogDigest: 'b'.repeat(64),
        },
        {
          toolId: 'cua.rewritten_action',
          modelName: 'rewritten_action',
          description: 'Would require an SDK rewrite.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { value: { type: 'string' } },
            required: [],
          },
          operations: ['rewritten_action'],
          driverCatalogDigest: 'b'.repeat(64),
        },
      ],
    } satisfies LocalAgentHostMessage);

    await vi.waitFor(() => {
      expect(bridge.sent).toContainEqual({
        kind: 'runtime.catalogValidated',
        requestId,
        acceptedModelNames: ['valid_action'],
        rejected: [
          expect.objectContaining({ modelName: 'rewritten_action' }),
        ],
      });
    });
  });
});
