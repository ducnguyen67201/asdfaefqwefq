import { createHash } from 'node:crypto';

import {
  assertStrictFunctionSchema,
  jsonSchemaHasType,
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
  if (jsonSchemaHasType(node, 'object')) {
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
  if (Array.isArray(node.items)) {
    node.items = node.items.map(strictNode);
  } else if (node.items) {
    node.items = strictNode(node.items);
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(node[keyword])) node[keyword] = node[keyword].map(strictNode);
  }
  for (const keyword of ['$defs', 'definitions'] as const) {
    const definitions = node[keyword];
    if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
      continue;
    }
    node[keyword] = Object.fromEntries(
      Object.entries(definitions).map(([name, definition]) => [
        name,
        strictNode(definition),
      ]),
    );
  }
  if (
    node.additionalProperties &&
    typeof node.additionalProperties === 'object' &&
    !Array.isArray(node.additionalProperties)
  ) {
    node.additionalProperties = strictNode(node.additionalProperties);
  }
  return node;
}

function nullable(schema: JsonSchema): JsonSchema {
  if (jsonSchemaHasType(schema, 'null')) return schema;
  if (Array.isArray(schema.anyOf) && schema.anyOf.some((candidate) => candidate.type === 'null')) {
    return schema;
  }
  return { anyOf: [schema, { type: 'null' }] };
}

function normalizeDriverInput(
  input: Record<string, unknown>,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const selectedSchema = schemaForValue(schema, input);
  const properties = selectedSchema.properties && typeof selectedSchema.properties === 'object' && !Array.isArray(selectedSchema.properties)
    ? selectedSchema.properties as Record<string, unknown>
    : {};
  const required = new Set(
    Array.isArray(selectedSchema.required)
      ? selectedSchema.required.filter((name): name is string => typeof name === 'string')
      : [],
  );
  return Object.fromEntries(Object.entries(input).flatMap(([name, value]) => {
    if (value === null && !required.has(name)) return [];
    const property = properties[name];
    return [[name, normalizeDriverValue(value, property)]];
  }));
}

function normalizeDriverValue(value: unknown, schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return value;
  const selectedSchema = schemaForValue(
    schema as Record<string, unknown>,
    value,
  );
  if (Array.isArray(value)) {
    const items = selectedSchema.items;
    if (!items || Array.isArray(items)) return value;
    return value.map((item) => normalizeDriverValue(item, items));
  }
  if (value && typeof value === 'object') {
    return normalizeDriverInput(
      value as Record<string, unknown>,
      selectedSchema,
    );
  }
  return value;
}

function schemaForValue(
  schema: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> {
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const alternatives = schema[keyword];
    if (!Array.isArray(alternatives)) continue;
    const match = alternatives.find(
      (candidate): candidate is Record<string, unknown> =>
        Boolean(
          candidate &&
          typeof candidate === 'object' &&
          !Array.isArray(candidate) &&
          schemaMatchesValue(candidate, value),
        ),
    );
    if (match) return match;
  }
  return schema;
}

function schemaMatchesValue(
  schema: Record<string, unknown>,
  value: unknown,
): boolean {
  if (value === null) return jsonSchemaHasType(schema, 'null');
  if (Array.isArray(value)) return jsonSchemaHasType(schema, 'array');
  if (typeof value === 'object') return jsonSchemaHasType(schema, 'object');
  if (typeof value === 'string') return jsonSchemaHasType(schema, 'string');
  if (typeof value === 'boolean') return jsonSchemaHasType(schema, 'boolean');
  if (typeof value === 'number') {
    return jsonSchemaHasType(schema, 'number') || jsonSchemaHasType(schema, 'integer');
  }
  return false;
}
