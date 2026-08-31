import { describe, expect, it } from 'vitest';

import type { CuaDriverCatalog } from '../cua/cua-semantic-contracts';

import { createCuaDriverToolDefinitions } from './cua-driver-agent-tools';
import { RuntimeToolRegistry } from './runtime-tool-registry';

const catalog: CuaDriverCatalog = {
  driverVersion: '0.19.3',
  contractVersion: '1',
  toolsListSchemaVersion: '1',
  capabilityVersion: '2026-08',
  driverCatalogDigest: 'a'.repeat(64),
  tools: [{
    name: 'new_driver_ability',
    modelName: 'new_driver_ability',
    description: 'Exercise a newly discovered driver ability.',
    injectSession: false,
    inputSchema: {
      type: 'object',
      properties: {
        requiredValue: { type: 'string' },
        optionalValue: { type: 'string' },
      },
      required: ['requiredValue'],
    },
  }],
};

describe('dynamic CUA agent tools', () => {
  it('registers a newly discovered ability without changing a static contract', () => {
    const [definition] = createCuaDriverToolDefinitions(catalog);
    if (!definition) throw new Error('missing dynamic definition');
    const registry = new RuntimeToolRegistry([definition]);
    const frozen = registry.freeze({ taskId: '11111111-1111-4111-8111-111111111111' });

    expect(frozen.tools[0]).toMatchObject({
      toolId: 'cua.new_driver_ability',
      driverCatalogDigest: catalog.driverCatalogDigest,
    });
    expect(frozen.tools[0]?.inputSchema.required).toEqual([
      'requiredValue',
      'optionalValue',
    ]);
    expect(frozen.tools[0]?.inputSchema.properties.optionalValue).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
  });

  it('removes SDK-required null placeholders before driver dispatch', () => {
    const [definition] = createCuaDriverToolDefinitions(catalog);
    if (!definition) throw new Error('missing dynamic definition');

    expect(definition.parse(JSON.stringify({
      requiredValue: 'present',
      optionalValue: null,
    }))).toEqual({ requiredValue: 'present' });
  });
});
