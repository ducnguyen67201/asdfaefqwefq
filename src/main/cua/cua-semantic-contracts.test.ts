import { describe, expect, it } from 'vitest';

import {
  CuaBrowserStateSchema,
  CuaWindowStateSchema,
  createCuaDriverCatalog,
  deriveCuaSemanticCapabilities,
  parseCuaStructuredResult,
} from './cua-semantic-contracts';

describe('CUA semantic contracts', () => {
  it('projects future driver tools without a Tro allowlist', () => {
    const metadata = {
      driverVersion: '0.20.0',
      contractVersion: '0.7.0',
      toolsListSchemaVersion: '1',
      capabilityVersion: '2',
    };
    const inventory = {
      capability_version: '2',
      schema_version: '1',
      tools: [
        {
          name: 'future_cua_action',
          description: 'A tool added by a future compatible CUA driver.',
          capabilities: ['future.action'],
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              session: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['session', 'value'],
          },
        },
        {
          name: 'end_session',
          description: 'Driver session cleanup.',
          capabilities: ['session.lifecycle.end'],
          inputSchema: {
            type: 'object',
            properties: { session: { type: 'string' } },
            required: ['session'],
          },
        },
      ],
    };

    const catalog = createCuaDriverCatalog(metadata, inventory);

    expect(catalog.driverVersion).toBe('0.20.0');
    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0]).toMatchObject({
      name: 'future_cua_action',
      modelName: 'future_cua_action',
      injectSession: true,
      inputSchema: {
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
    });
    expect(catalog.driverCatalogDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(createCuaDriverCatalog(metadata, inventory)).toEqual(catalog);
  });

  it('derives independent window and browser capability groups', () => {
    expect(
      deriveCuaSemanticCapabilities({
        capability_version: '1',
        schema_version: '1',
        tools: [
          'list_windows',
          'get_window_state',
          'click',
          'type_text',
          'press_key',
          'scroll',
          'get_browser_state',
          'browser_click',
          'browser_type',
          'browser_pointer',
          'browser_prepare',
          'verify_state',
        ].map((name) => ({ name })),
      }),
    ).toEqual({
      browserActions: true,
      browserPrepare: true,
      browserState: true,
      capabilityVersion: '1',
      verification: true,
      windowActions: true,
      windowState: true,
    });
  });

  it('keeps window semantics usable when browser tools are absent', () => {
    const capabilities = deriveCuaSemanticCapabilities({
      capability_version: '1',
      schema_version: '1',
      tools: [
        'list_windows',
        'get_window_state',
        'click',
        'type_text',
        'press_key',
        'scroll',
      ].map((name) => ({ name })),
    });
    expect(capabilities.windowState).toBe(true);
    expect(capabilities.windowActions).toBe(true);
    expect(capabilities.browserState).toBe(false);
  });

  it('parses bounded window and browser state without requiring extensions', () => {
    expect(
      CuaWindowStateSchema.parse({
        snapshot_id: 's12345678',
        elements: [
          {
            element_index: 3,
            element_token: 'opaque',
            role: 'AXButton',
            label: 'Run',
          },
        ],
      }).elements[0]?.label,
    ).toBe('Run');
    expect(
      CuaBrowserStateSchema.parse({
        target_id: 'target',
        tab_id: 'tab',
        refs: [{ ref: 'p1:2', role: 'button', name: 'Run' }],
      }).refs?.[0]?.ref,
    ).toBe('p1:2');
  });

  it('rejects malformed native structured JSON', () => {
    expect(() =>
      parseCuaStructuredResult(
        { rawJson: '{', structuredJson: undefined },
        CuaWindowStateSchema,
      ),
    ).toThrow('malformed structured JSON');
  });
});
