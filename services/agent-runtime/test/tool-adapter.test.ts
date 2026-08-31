import { describe, expect, it } from 'vitest';

import type { LocalRuntimeToolSpec } from '../src/protocol.js';
import { ToolSurfaceFactory } from '../src/tool-adapter.js';

const digest = 'a'.repeat(64);

function toolSpec(
  toolId: string,
  inputSchema: LocalRuntimeToolSpec['inputSchema'],
): LocalRuntimeToolSpec {
  return {
    toolId: `cua.${toolId}`,
    modelName: toolId,
    description: `Exercise the ${toolId} CUA capability.`,
    inputSchema,
    operations: [toolId],
    driverCatalogDigest: digest,
  };
}

describe('SDK tool adapter', () => {
  it('constructs strict SDK tools from normalized nullable CUA object branches', () => {
    const startSession = toolSpec('start_session', {
      type: 'object',
      additionalProperties: false,
      properties: {
        cursor_theme: {
          anyOf: [
            {
              type: ['object', 'null'],
              additionalProperties: false,
              properties: {
                reduced_motion: {
                  anyOf: [
                    { type: 'string', enum: ['auto', 'on', 'off'] },
                    { type: 'null' },
                  ],
                },
                theme_id: { type: 'string' },
              },
              required: ['reduced_motion', 'theme_id'],
            },
            { type: 'null' },
          ],
        },
      },
      required: ['cursor_theme'],
    });
    const verifyState = toolSpec('verify_state', {
      type: 'object',
      additionalProperties: false,
      properties: {
        expect: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              element: {
                anyOf: [
                  {
                    type: ['object', 'null'],
                    additionalProperties: false,
                    properties: {
                      enabled: { type: ['boolean', 'null'] },
                      selector: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          label_contains: {
                            anyOf: [{ type: 'string' }, { type: 'null' }],
                          },
                          role: {
                            anyOf: [{ type: 'string' }, { type: 'null' }],
                          },
                        },
                        required: ['label_contains', 'role'],
                      },
                    },
                    required: ['enabled', 'selector'],
                  },
                  { type: 'null' },
                ],
              },
            },
            required: ['element'],
          },
        },
      },
      required: ['expect'],
    });

    expect(() =>
      new ToolSurfaceFactory().create(
        [startSession, verifyState],
        digest,
      ),
    ).not.toThrow();
  });
});
