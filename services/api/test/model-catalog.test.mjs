import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GPT_IMAGE_MODEL,
  IMAGE_CATALOG_VERSION,
  ModelCatalog,
} from '../src/model-catalog.mjs';

test('image catalog calculates exact modality-specific micro-USD', () => {
  const catalog = new ModelCatalog();
  assert.equal(IMAGE_CATALOG_VERSION, '2026-04-21');
  assert.equal(
    catalog.calculateImageUsageCost({
      inputImageTokens: 0,
      inputTextTokens: 0,
      model: GPT_IMAGE_MODEL,
      outputImageTokens: 200,
    }),
    6_000,
  );
  assert.equal(
    catalog.calculateImageUsageCost({
      inputImageTokens: 1,
      inputTextTokens: 1,
      model: GPT_IMAGE_MODEL,
      outputImageTokens: 1,
    }),
    43,
  );
  assert.throws(
    () =>
      catalog.calculateImageUsageCost({
        inputImageTokens: -1,
        inputTextTokens: 0,
        model: GPT_IMAGE_MODEL,
        outputImageTokens: 0,
      }),
    /bounded nonnegative/u,
  );
  assert.throws(
    () =>
      catalog.calculateImageUsageCost({
        inputImageTokens: 0,
        inputTextTokens: 2_000_000_001,
        model: GPT_IMAGE_MODEL,
        outputImageTokens: 0,
      }),
    /bounded nonnegative/u,
  );
});

test('model catalog calculates exact integer micro-USD including cache lanes', () => {
  const catalog = new ModelCatalog();
  assert.equal(
    catalog.calculateUsageCost({
      cacheWriteTokens: 100,
      cachedInputTokens: 400,
      inputTokens: 1_000,
      model: 'gpt-5.6-luna',
      outputTokens: 200,
    }),
    373,
  );
  assert.throws(
    () =>
      catalog.calculateUsageCost({
        cacheWriteTokens: 700,
        cachedInputTokens: 400,
        inputTokens: 1_000,
        model: 'gpt-5.6-luna',
        outputTokens: 0,
      }),
    /cannot exceed input tokens/,
  );
});

test('reservation estimation prices output caps and current images conservatively', () => {
  const estimate = new ModelCatalog().estimateResponsesReservation({
    input: [
      {
        output: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,aA==' }],
        type: 'function_call_output',
      },
    ],
    instructions: 'stable',
    max_output_tokens: 2_000,
    model: 'gpt-5.6-luna',
    tools: [],
  });
  assert.equal(estimate.imageCount, 1);
  assert(estimate.inputTokens >= 20_000);
  assert(estimate.microUsd > 2_400);
});

test('Sol pricing and long-context multipliers are applied', () => {
  const catalog = new ModelCatalog();
  assert.equal(catalog.calculateUsageCost({
    cacheWriteTokens: 0,
    cachedInputTokens: 0,
    inputTokens: 1_000_000,
    model: 'gpt-5.6-sol',
    outputTokens: 1_000_000,
  }), 55_000_000);
});
