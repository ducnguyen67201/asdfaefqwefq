import { describe, expect, it } from 'vitest';

import {
  CuaBrowserStateSchema,
  CuaWindowStateSchema,
  createCuaDriverCatalog,
  deriveCuaSemanticCapabilities,
  loadCuaDriverCatalog,
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
        {
          name: 'get_config',
          description: 'Read host-owned CUA configuration.',
          capabilities: ['system.config.read'],
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
          },
        },
        {
          name: 'set_config',
          description: 'Change host-owned CUA configuration.',
          capabilities: ['system.config.write'],
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              value: {
                description: 'JSON type depends on the configuration key.',
              },
            },
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
    expect(catalog.tools.map((tool) => tool.name)).not.toContain('get_config');
    expect(catalog.tools.map((tool) => tool.name)).not.toContain('set_config');
    expect(catalog.driverCatalogDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(createCuaDriverCatalog(metadata, inventory)).toEqual(catalog);
  });

  it('uses declared audience metadata and preserves provider schemas exactly', () => {
    const inputSchema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
      },
      required: ['query', 'limit'],
    };
    const result = loadCuaDriverCatalog(
      {
        driverVersion: '0.21.0',
        contractVersion: '0.8.0',
        toolsListSchemaVersion: '2',
        capabilityVersion: '3',
      },
      {
        capability_version: '3',
        schema_version: '2',
        requiredTools: ['future_cua_action'],
        tools: [
          {
            name: 'future_cua_action',
            description: 'A provider-compatible future action.',
            capabilities: ['future.action'],
            audience: 'model',
            schemaDialect: 'openai.function.strict',
            schemaVersion: '1',
            injectSession: false,
            inputSchema,
            modelInputSchema: inputSchema,
          },
          {
            name: 'set_config',
            description: 'Host-owned configuration.',
            capabilities: ['renamed.capability.without.filtering'],
            audience: 'host',
            schemaDialect: 'driver.internal',
            schemaVersion: '9',
            inputSchema: { properties: {} },
          },
        ],
      },
    );

    expect(result.report.state).toBe('ready');
    expect(result.report.hostOwnedTools).toEqual(['set_config']);
    expect(result.catalog?.tools).toHaveLength(1);
    expect(result.catalog?.tools[0]?.inputSchema).toEqual(inputSchema);
    expect(result.catalog?.tools[0]?.schemaAdaptation).toBe('none');
  });

  it('keeps set_config host-owned even when an inventory mislabels its audience', () => {
    const result = loadCuaDriverCatalog(
      {
        driverVersion: '0.21.0',
        contractVersion: '0.8.0',
        toolsListSchemaVersion: '2',
        capabilityVersion: '3',
      },
      {
        capability_version: '3',
        schema_version: '2',
        requiredTools: [],
        tools: [{
          name: 'set_config',
          description: 'Mislabelled configuration mutation.',
          capabilities: ['system.config.write'],
          audience: 'model',
          schemaDialect: 'openai.function.strict',
          schemaVersion: '1',
          inputSchema: { type: 'object', properties: {} },
          modelInputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {},
            required: [],
          },
        }],
      },
    );

    expect(result.catalog?.tools).toEqual([]);
    expect(result.report.hostOwnedTools).toEqual(['set_config']);
    expect(result.report.quarantinedTools[0]).toMatchObject({
      name: 'set_config',
      code: 'reserved_host_tool',
    });
  });

  it('quarantines incompatible optional tools without poisoning valid tools', () => {
    const result = loadCuaDriverCatalog(
      {
        driverVersion: '0.21.0',
        contractVersion: '0.8.0',
        toolsListSchemaVersion: '2',
        capabilityVersion: '3',
      },
      {
        capability_version: '3',
        schema_version: '2',
        requiredTools: [],
        tools: [
          {
            name: 'valid_action',
            description: 'Valid action.',
            capabilities: [],
            audience: 'model',
            schemaDialect: 'openai.function.strict',
            schemaVersion: '1',
            injectSession: false,
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
              required: [],
            },
            modelInputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
              required: [],
            },
          },
          {
            name: 'invalid_action',
            description: 'Invalid action.',
            capabilities: [],
            audience: 'model',
            schemaDialect: 'openai.function.strict',
            schemaVersion: '1',
            injectSession: false,
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: { value: { description: 'Missing a type.' } },
              required: ['value'],
            },
            modelInputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: { value: { description: 'Missing a type.' } },
              required: ['value'],
            },
          },
          {
            name: 'future_dialect_action',
            description: 'Unknown dialect action.',
            capabilities: [],
            audience: 'model',
            schemaDialect: 'future.provider.schema',
            schemaVersion: '1',
            injectSession: false,
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
              required: [],
            },
            modelInputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
              required: [],
            },
          },
        ],
      },
    );

    expect(result.report.state).toBe('degraded');
    expect(result.catalog?.tools.map((tool) => tool.name)).toEqual(['valid_action']);
    expect(result.report.quarantinedTools).toEqual([
      expect.objectContaining({ name: 'invalid_action', code: 'invalid_model_schema' }),
      expect.objectContaining({ name: 'future_dialect_action', code: 'unsupported_schema_dialect' }),
    ]);
    expect(result.report.quarantinedTools[1]?.message).toContain(
      'future.provider.schema@1',
    );
  });

  it('supports pluggable schema dialect validators without allowing mutation', () => {
    const inventory = {
      capability_version: '3',
      schema_version: '2',
      requiredTools: [],
      tools: [{
        name: 'portable_action',
        description: 'Portable action.',
        capabilities: [],
        audience: 'model',
        schemaDialect: 'vendor.portable.strict',
        schemaVersion: '7',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: [],
        },
        modelInputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {},
          required: [],
        },
      }],
    };
    const metadata = {
      driverVersion: '0.21.0',
      contractVersion: '0.8.0',
      toolsListSchemaVersion: '2',
      capabilityVersion: '3',
    };
    const accepted = loadCuaDriverCatalog(metadata, inventory, {
      schemaValidators: [{
        dialect: 'vendor.portable.strict',
        version: '7',
        validate: () => undefined,
      }],
    });
    const mutating = loadCuaDriverCatalog(metadata, inventory, {
      schemaValidators: [{
        dialect: 'vendor.portable.strict',
        version: '7',
        validate: (schema) => {
          schema.description = 'A silently changed schema.';
        },
      }],
    });

    expect(accepted.report.state).toBe('ready');
    expect(accepted.catalog?.tools[0]?.schemaDialect).toBe(
      'vendor.portable.strict',
    );
    expect(mutating.report.quarantinedTools[0]).toMatchObject({
      name: 'portable_action',
      code: 'invalid_model_schema',
    });
    expect(mutating.report.quarantinedTools[0]?.message).toContain('must not mutate');
  });

  it('makes the CUA runtime unavailable when required model tools are incompatible or missing', () => {
    const result = loadCuaDriverCatalog(
      {
        driverVersion: '0.21.0',
        contractVersion: '0.8.0',
        toolsListSchemaVersion: '2',
        capabilityVersion: '3',
      },
      {
        capability_version: '3',
        schema_version: '2',
        requiredTools: ['required_action', 'missing_action'],
        tools: [
          {
            name: 'required_action',
            description: 'Required action.',
            capabilities: [],
            audience: 'model',
            schemaDialect: 'future.provider.schema',
            schemaVersion: '1',
            injectSession: false,
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
              required: [],
            },
            modelInputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {},
              required: [],
            },
          },
        ],
      },
    );

    expect(result.catalog).toBeNull();
    expect(result.report.state).toBe('unavailable');
    expect(result.report.requiredToolFailures.map((failure) => failure.name)).toEqual([
      'required_action',
      'missing_action',
    ]);
  });

  it('requires schema-2 readiness metadata and keeps host session binding out of model schemas', () => {
    const metadata = {
      driverVersion: '0.21.0',
      contractVersion: '0.8.0',
      toolsListSchemaVersion: '2',
      capabilityVersion: '3',
    };
    const missingReadiness = loadCuaDriverCatalog(metadata, {
      capability_version: '3',
      schema_version: '2',
      tools: [],
    });
    const exposedSession = loadCuaDriverCatalog(metadata, {
      capability_version: '3',
      schema_version: '2',
      requiredTools: [],
      tools: [
        {
          name: 'valid_session_action',
          description: 'Valid session-bound action.',
          capabilities: [],
          audience: 'model',
          schemaDialect: 'openai.function.strict',
          schemaVersion: '1',
          injectSession: true,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              session: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['session', 'value'],
          },
          modelInputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
        {
          name: 'session_bound_action',
          description: 'Session-bound action.',
          capabilities: [],
          audience: 'model',
          schemaDialect: 'openai.function.strict',
          schemaVersion: '1',
          injectSession: true,
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { session: { type: 'string' } },
            required: ['session'],
          },
          modelInputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { session: { type: 'string' } },
            required: ['session'],
          },
        },
      ],
    });

    expect(missingReadiness.report).toMatchObject({
      state: 'unavailable',
      compatibilityMessages: [expect.stringContaining('requiredTools')],
    });
    expect(exposedSession.report.quarantinedTools[0]).toMatchObject({
      name: 'session_bound_action',
      code: 'invalid_model_schema',
    });
    expect(exposedSession.report.quarantinedTools[0]?.message).toContain(
      'host-owned session',
    );
    expect(exposedSession.catalog?.tools[0]).toMatchObject({
      name: 'valid_session_action',
      injectSession: true,
      inputSchema: {
        properties: { value: { type: 'string' } },
      },
      driverInputSchema: {
        properties: {
          session: { type: 'string' },
          value: { type: 'string' },
        },
      },
    });
  });

  it('reports legacy schema adaptation instead of silently changing v1 schemas', () => {
    const result = loadCuaDriverCatalog(
      {
        driverVersion: '0.19.3',
        contractVersion: '0.6.0',
        toolsListSchemaVersion: '1',
        capabilityVersion: '1',
      },
      {
        capability_version: '1',
        schema_version: '1',
        tools: [{
          name: 'legacy_action',
          description: 'Legacy optional action.',
          capabilities: ['legacy.action'],
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { optionalValue: { type: 'string' } },
            required: [],
          },
        }],
      },
    );

    expect(result.report.state).toBe('degraded');
    expect(result.report.compatibilityMessages[0]).toContain('legacy');
    expect(result.catalog?.tools[0]?.schemaAdaptation).toBe('legacy-v1');
    expect(result.catalog?.tools[0]?.inputSchema).toMatchObject({
      required: ['optionalValue'],
      properties: {
        optionalValue: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    });
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
