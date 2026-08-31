import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_MODEL, graphVersion } from '../src/config.js';
import type { HostBridge } from '../src/host-bridge.js';
import { LocalRuntimeServer } from '../src/local-runtime-server.js';
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
});
