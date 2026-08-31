import { describe, expect, it } from 'vitest';

import {
  assertStrictFunctionSchema,
  objectSchema,
} from './agent-tool-contracts';

describe('dynamic agent tool schema helpers', () => {
  it('accepts a recursively strict function schema', () => {
    const schema = objectSchema(
      {
        input: objectSchema(
          { value: { type: 'string', maxLength: 100 } },
          ['value'],
        ),
      },
      ['input'],
    );

    expect(() => assertStrictFunctionSchema(schema)).not.toThrow();
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
