import { describe, expect, it } from 'vitest';

import {
  HOSTED_TOOL_CONTRACTS,
  assertStrictFunctionSchema,
  hostedToolContractByModelName,
} from './agent-tool-contracts';

describe('canonical hosted tool catalog', () => {
  it('contains unique, recursively strict tools', () => {
    expect(new Set(HOSTED_TOOL_CONTRACTS.map((tool) => tool.toolId)).size).toBe(
      HOSTED_TOOL_CONTRACTS.length,
    );
    expect(
      new Set(HOSTED_TOOL_CONTRACTS.map((tool) => tool.modelName)).size,
    ).toBe(HOSTED_TOOL_CONTRACTS.length);
    for (const tool of HOSTED_TOOL_CONTRACTS) {
      expect(() => assertStrictFunctionSchema(tool.parameters)).not.toThrow();
    }
  });

  it('defines direct YouTube navigation without a CUA prerequisite', () => {
    const openUrl = hostedToolContractByModelName('open_url');
    expect(openUrl).toMatchObject({
      toolId: 'browser.navigate',
      operations: ['open_url'],
      prerequisites: [],
      parameters: {
        additionalProperties: false,
        required: ['url', 'reason'],
      },
    });
    expect(openUrl?.parameters.properties).toEqual({
      url: { type: 'string', maxLength: 8_000 },
      reason: { type: 'string', maxLength: 500 },
    });
  });

  it('rejects a nested permissive strict schema', () => {
    expect(() =>
      assertStrictFunctionSchema({
        type: 'object',
        additionalProperties: false,
        required: ['input'],
        properties: {
          input: {
            type: 'object',
            additionalProperties: true,
            required: [],
            properties: {},
          },
        },
      }),
    ).toThrow(/additionalProperties/u);
  });
});
