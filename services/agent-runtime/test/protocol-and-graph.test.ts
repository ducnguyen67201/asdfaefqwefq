import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { graphVersion, ROOT_AGENT_DEFINITION } from '../src/config.js';
import {
  LOCAL_AGENT_CAPABILITIES,
  LOCAL_AGENT_PROTOCOL_DIGEST,
  LOCAL_AGENT_PROTOCOL_VERSION,
  LOCAL_AGENT_ROOT_ID,
  LOCAL_AGENT_SDK_VERSION,
  LocalAgentHostMessageSchema,
  LocalRuntimeCapabilitiesSchema,
  type LocalRuntimeToolSpec,
} from '../src/protocol.js';

const digest = 'a'.repeat(64);

function tool(toolId: string, modelName: string): LocalRuntimeToolSpec {
  return {
    toolId,
    modelName,
    description: `Execute ${modelName}.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    operations: ['execute'],
    driverCatalogDigest: null,
  };
}

describe('local agent protocol and graph', () => {
  it('publishes one stable root agent with future lineage inactive', () => {
    expect(ROOT_AGENT_DEFINITION.agentId).toBe(LOCAL_AGENT_ROOT_ID);
    expect(ROOT_AGENT_DEFINITION.handoffTargets).toEqual([]);
    expect(LOCAL_AGENT_CAPABILITIES).toContain('dynamicTools');
    expect(LOCAL_AGENT_CAPABILITIES).not.toContain('handoffs');
  });

  it('binds graph versions to a sorted fixed tool catalog', () => {
    const left = tool('browser.open', 'open_browser');
    const right = tool('computer.observe', 'observe_computer');

    expect(graphVersion([left, right], 'gpt-test')).toBe(
      graphVersion([right, left], 'gpt-test'),
    );
    expect(graphVersion([left], 'gpt-test')).not.toBe(
      graphVersion([right], 'gpt-test'),
    );
  });

  it('rejects unknown host message fields and wrong protocol versions', () => {
    const valid = {
      kind: 'runtime.initialize',
      requestId: randomUUID(),
      apiBaseUrl: 'https://api.example.com',
      requiredCapabilities: ['sessions'],
      expected: {
        protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
        protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
        sdkVersion: LOCAL_AGENT_SDK_VERSION,
        graphVersion: digest,
        capabilities: [...LOCAL_AGENT_CAPABILITIES],
      },
    };

    expect(LocalAgentHostMessageSchema.safeParse(valid).success).toBe(true);
    expect(LocalAgentHostMessageSchema.safeParse({ ...valid, credential: 'secret' }).success).toBe(false);
    expect(LocalAgentHostMessageSchema.safeParse({
      ...valid,
      expected: { ...valid.expected, protocolVersion: 2 },
    }).success).toBe(false);
  });

  it('rejects capability labels the bundled runtime does not implement', () => {
    const parsed = LocalRuntimeCapabilitiesSchema.safeParse({
      protocolVersion: LOCAL_AGENT_PROTOCOL_VERSION,
      protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
      sdkVersion: LOCAL_AGENT_SDK_VERSION,
      graphVersion: digest,
      capabilities: [...LOCAL_AGENT_CAPABILITIES, 'mcp'],
    });

    expect(parsed.success).toBe(false);
  });
});
