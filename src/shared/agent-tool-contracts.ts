export type JsonSchema = Record<string, unknown>;

export interface StrictJsonObjectSchema extends JsonSchema {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, JsonSchema>;
  required: string[];
}

export const objectSchema = (
  properties: Record<string, JsonSchema>,
  required: string[],
): StrictJsonObjectSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

export function assertStrictFunctionSchema(
  schema: unknown,
  path = 'parameters',
): asserts schema is StrictJsonObjectSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`Model tool schema at ${path} must be an object.`);
  }
  const node = schema as Record<string, unknown>;
  if ('const' in node && typeof node.type !== 'string') {
    throw new Error(
      `Model tool schema at ${path} uses const without an explicit type.`,
    );
  }
  if (node.type === 'object') {
    if (node.additionalProperties !== false) {
      throw new Error(
        `Strict model tool object at ${path} must set additionalProperties to false.`,
      );
    }
    if (!node.properties || typeof node.properties !== 'object') {
      throw new Error(
        `Strict model tool object at ${path} must define properties.`,
      );
    }
    const properties = node.properties as Record<string, unknown>;
    const required = Array.isArray(node.required) ? node.required : [];
    for (const [name, propertySchema] of Object.entries(properties)) {
      if (!required.includes(name)) {
        throw new Error(
          `Strict model tool property ${path}.${name} is not required.`,
        );
      }
      assertStrictFunctionSchema(
        propertySchema,
        `${path}.properties.${name}`,
      );
    }
  }
  for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
    const alternatives = node[keyword];
    if (!Array.isArray(alternatives)) continue;
    alternatives.forEach((alternative, index) =>
      assertStrictFunctionSchema(
        alternative,
        `${path}.${keyword}[${index}]`,
      ),
    );
  }
  if (node.items !== undefined) {
    assertStrictFunctionSchema(node.items, `${path}.items`);
  }
}
