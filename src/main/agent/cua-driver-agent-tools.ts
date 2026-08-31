import { createHash } from 'node:crypto';

import {
  assertStrictFunctionSchema,
  type JsonSchema,
  type StrictJsonObjectSchema,
} from '../../shared/agent-tool-contracts';
import type { CuaDriverCatalog } from '../cua/cua-semantic-contracts';

import type { RuntimeToolDefinition } from './runtime-tool-registry';

/** Projects the installed CUA inventory into SDK function tools at turn freeze. */
export function createCuaDriverToolDefinitions(
  catalog: CuaDriverCatalog,
): RuntimeToolDefinition<Record<string, unknown>>[] {
  return catalog.tools.map((tool) => {
    const toolId = cuaToolId(tool.name);
    const parameters = strictify(tool.inputSchema);
    assertStrictFunctionSchema(parameters);
    return {
      id: toolId,
      modelName: tool.modelName,
      description: tool.description,
      driverCatalogDigest: catalog.driverCatalogDigest,
      operations: [tool.name],
      parameters,
      parse: (argumentsJson) => {
        const value: unknown = JSON.parse(argumentsJson);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`CUA tool ${tool.name} requires an object input.`);
        }
        return normalizeDriverInput(
          value as Record<string, unknown>,
          tool.inputSchema,
        );
      },
      normalize: (input, call) => ({
        callId: call.callId,
        driverCatalogDigest: catalog.driverCatalogDigest,
        input,
        kind: 'direct',
        modelName: call.name,
        operation: tool.name,
        toolId,
      }),
    };
  });
}

function cuaToolId(name: string): `cua.${string}` {
  if (name.length <= 96) return `cua.${name}`;
  const suffix = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return `cua.${name.slice(0, 87)}_${suffix}`;
}

function strictify(input: Record<string, unknown>): StrictJsonObjectSchema {
  const cloned = strictNode(structuredClone(input));
  if (cloned.type !== 'object' || !cloned.properties || Array.isArray(cloned.properties)) {
    throw new Error('CUA tool schemas must be JSON object schemas.');
  }
  return cloned as StrictJsonObjectSchema;
}

function strictNode(input: unknown): JsonSchema {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const node = input as Record<string, unknown>;
  if (node.type === 'object') {
    const properties = node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)
      ? node.properties as Record<string, unknown>
      : {};
    const originallyRequired = new Set(
      Array.isArray(node.required)
        ? node.required.filter((name): name is string => typeof name === 'string')
        : [],
    );
    node.properties = Object.fromEntries(Object.entries(properties).map(([name, value]) => {
      const strict = strictNode(value);
      return [name, originallyRequired.has(name) ? strict : nullable(strict)];
    }));
    node.required = Object.keys(properties);
    node.additionalProperties = false;
  }
  if (node.items) node.items = strictNode(node.items);
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(node[keyword])) node[keyword] = node[keyword].map(strictNode);
  }
  return node;
}

function nullable(schema: JsonSchema): JsonSchema {
  if (schema.type === 'null') return schema;
  if (Array.isArray(schema.anyOf) && schema.anyOf.some((candidate) => candidate.type === 'null')) {
    return schema;
  }
  return { anyOf: [schema, { type: 'null' }] };
}

function normalizeDriverInput(
  input: Record<string, unknown>,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === 'string')
      : [],
  );
  return Object.fromEntries(Object.entries(input).flatMap(([name, value]) => {
    if (value === null && !required.has(name)) return [];
    const property = properties[name];
    if (value && typeof value === 'object' && !Array.isArray(value) && property && typeof property === 'object' && !Array.isArray(property)) {
      return [[name, normalizeDriverInput(value as Record<string, unknown>, property as Record<string, unknown>)]];
    }
    return [[name, value]];
  }));
}
