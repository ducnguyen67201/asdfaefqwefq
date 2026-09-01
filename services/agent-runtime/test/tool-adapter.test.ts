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
  it('normalizes only the first interruption to the required exact call', () => {
    const observeContext: LocalRuntimeToolSpec = {
      toolId: 'computer.observe',
      modelName: 'observe_context',
      description: 'Observe or inspect the current visible context.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          operation: {
            type: 'string',
            enum: ['observe', 'inspect_surface_region'],
          },
          scope: {
            anyOf: [
              { type: 'string', enum: ['auto', 'desktop'] },
              { type: 'null' },
            ],
          },
        },
        required: ['operation', 'scope'],
      },
      operations: ['observe', 'inspect_surface_region'],
      driverCatalogDigest: digest,
    };
    const requiredInitialTool = {
      modelName: 'observe_context',
      arguments: { operation: 'observe', scope: 'auto' },
    };
    const surface = new ToolSurfaceFactory().create(
      [observeContext],
      digest,
      requiredInitialTool,
    );

    const first = surface.resolve({
      rawItem: {
        type: 'function_call',
        callId: 'call-1',
        name: 'observe_context',
        arguments: 'model arguments are ignored for the required call',
      },
    } as never);
    const second = surface.resolve({
      rawItem: {
        type: 'function_call',
        callId: 'call-2',
        name: 'observe_context',
        arguments: JSON.stringify({ operation: 'observe', scope: 'desktop' }),
      },
    } as never);

    expect(first).toMatchObject({
      arguments: requiredInitialTool.arguments,
      operation: 'observe',
    });
    expect(second).toMatchObject({
      arguments: { operation: 'observe', scope: 'desktop' },
      operation: 'observe',
    });
  });

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

  it('rejects schemas that the Agents SDK would rewrite', () => {
    const optional = toolSpec('optional_value', {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'string' } },
      required: [],
    });

    const admission = new ToolSurfaceFactory().inspect([optional], digest);

    expect(admission.acceptedModelNames).toEqual([]);
    expect(admission.rejected[0]).toMatchObject({
      modelName: 'optional_value',
      toolId: 'cua.optional_value',
    });
    expect(admission.rejected[0]?.message).toContain('rewrote model schema');
  });
});
