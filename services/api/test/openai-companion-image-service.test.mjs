import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GPT_IMAGE_MODEL,
  ModelCatalog,
} from '../src/model-catalog.mjs';
import { OpenAiCompanionImageService } from '../src/openai-companion-image-service.mjs';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const SECRET_PROMPT = 'make-this-a-private-blue-space-cat';

function providerPayload(overrides = {}) {
  return {
    data: [{ b64_json: PNG.toString('base64') }],
    usage: {
      input_tokens: 2,
      input_tokens_details: { image_tokens: 1, text_tokens: 1 },
      output_tokens: 200,
    },
    ...overrides,
  };
}

function harness(fetchImpl, overrides = {}) {
  const lifecycle = [];
  const logs = [];
  const budgetService = {
    companionGenerationSnapshot: async () => ({
      limit: 5,
      periodEndsAt: '2026-09-01T00:00:00.000Z',
      periodStartsAt: '2026-08-01T00:00:00.000Z',
      remaining: 4,
      used: 1,
    }),
    markDispatched: async () => lifecycle.push('dispatched'),
    markUncertain: async () => lifecycle.push('uncertain'),
    release: async () => lifecycle.push('released'),
    reserve: async (value) => lifecycle.push(['reserved', value]),
    settle: async (value) => {
      lifecycle.push(['settled', value]);
      if (overrides.settleError) throw new Error('settlement unavailable');
    },
  };
  return {
    lifecycle,
    logs,
    service: new OpenAiCompanionImageService({
      budgetService,
      catalog: new ModelCatalog(),
      fetchImpl,
      logger: { info: (value) => logs.push(value) },
      openAiApiKey: 'sk-test-not-real',
      reservationMicroUsd: 50_000,
    }),
  };
}

function input(overrides = {}) {
  return {
    body: {
      imageBase64: PNG.toString('base64'),
      mimeType: 'image/png',
      prompt: SECRET_PROMPT,
      ...overrides,
    },
    planId: 'free',
    requestId: REQUEST_ID,
    safetyIdentifier: 'safety-hash',
    userId: 'student-1',
  };
}

test('sends one exact fixed image edit and settles modality usage', async () => {
  let fetchCount = 0;
  let request;
  const { lifecycle, logs, service } = harness(async (url, options) => {
    fetchCount += 1;
    request = { options, url };
    return new Response(JSON.stringify(providerPayload()), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  });

  const result = await service.execute(input());
  assert.equal(fetchCount, 1);
  assert.equal(request.url, 'https://api.openai.com/v1/images/edits');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer sk-test-not-real');
  assert.equal(request.options.headers['OpenAI-Safety-Identifier'], 'safety-hash');
  const form = request.options.body;
  assert.deepEqual([...form.keys()].sort(), [
    'background',
    'image[]',
    'model',
    'moderation',
    'n',
    'output_format',
    'prompt',
    'quality',
    'size',
  ]);
  assert.equal(form.get('model'), GPT_IMAGE_MODEL);
  assert.equal(form.get('n'), '1');
  assert.equal(form.get('size'), '1024x1024');
  assert.equal(form.get('quality'), 'low');
  assert.equal(form.get('background'), 'transparent');
  assert.equal(form.get('output_format'), 'png');
  assert.equal(form.get('moderation'), 'auto');
  assert.match(form.get('prompt'), /<student_customization>/u);
  assert.match(form.get('prompt'), new RegExp(SECRET_PROMPT, 'u'));
  assert.equal(form.get('input_fidelity'), null);
  assert.equal(form.get('image[]').name, 'reference.png');
  assert.equal(result.imageBase64, PNG.toString('base64'));
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.model, GPT_IMAGE_MODEL);
  assert.deepEqual(
    lifecycle.map((entry) => (Array.isArray(entry) ? entry[0] : entry)),
    ['reserved', 'dispatched', 'settled'],
  );
  const settlement = lifecycle.find((entry) => entry[0] === 'settled')[1];
  assert.equal(settlement.actualMicroUsd, 6_013);
  assert.deepEqual(
    {
      inputImageTokens: settlement.usage.inputImageTokens,
      inputTextTokens: settlement.usage.inputTextTokens,
      outputImageTokens: settlement.usage.outputImageTokens,
    },
    { inputImageTokens: 1, inputTextTokens: 1, outputImageTokens: 200 },
  );
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes(SECRET_PROMPT), false);
  assert.equal(logs[0].includes(PNG.toString('base64')), false);
});

test('rejects invalid source before reserving or fetching', async () => {
  let fetchCount = 0;
  const { lifecycle, service } = harness(async () => {
    fetchCount += 1;
    throw new Error('must not fetch');
  });
  await assert.rejects(service.execute(input({ imageBase64: 'AAAA' })), {
    code: 'invalid_companion_image_request',
    status: 400,
  });
  assert.equal(fetchCount, 0);
  assert.deepEqual(lifecycle, []);
});

test('known provider rejection releases the slot without relaying content', async () => {
  const { lifecycle, service } = harness(async () =>
    new Response(JSON.stringify({ error: { message: SECRET_PROMPT } }), {
      status: 400,
    }));
  await assert.rejects(service.execute(input()), (error) => {
    assert.equal(error.code, 'companion_image_rejected');
    assert.equal(error.status, 422);
    assert.equal(error.message.includes(SECRET_PROMPT), false);
    return true;
  });
  assert.deepEqual(
    lifecycle.map((entry) => (Array.isArray(entry) ? entry[0] : entry)),
    ['reserved', 'dispatched', 'released'],
  );
});

test('network failure and malformed success are uncertain and never retried', async (t) => {
  await t.test('network failure', async () => {
    let fetchCount = 0;
    const { lifecycle, service } = harness(async () => {
      fetchCount += 1;
      throw new Error('timeout');
    });
    await assert.rejects(service.execute(input()), {
      code: 'ambiguous_dispatch',
      status: 502,
    });
    assert.equal(fetchCount, 1);
    assert.equal(lifecycle.at(-1), 'uncertain');
  });

  await t.test('missing usage', async () => {
    let fetchCount = 0;
    const { lifecycle, service } = harness(async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(providerPayload({ usage: undefined })), {
        status: 200,
      });
    });
    await assert.rejects(service.execute(input()), {
      code: 'ambiguous_response',
      status: 502,
    });
    assert.equal(fetchCount, 1);
    assert.equal(lifecycle.at(-1), 'uncertain');
  });

  await t.test('declared oversized response', async () => {
    let fetchCount = 0;
    const { lifecycle, service } = harness(async () => {
      fetchCount += 1;
      return new Response('{}', {
        headers: { 'Content-Length': String(12 * 1_024 * 1_024 + 1) },
        status: 200,
      });
    });
    await assert.rejects(service.execute(input()), {
      code: 'ambiguous_response',
      status: 502,
    });
    assert.equal(fetchCount, 1);
    assert.equal(lifecycle.at(-1), 'uncertain');
  });

  await t.test('settlement failure after provider completion', async () => {
    let fetchCount = 0;
    const { lifecycle, service } = harness(
      async () => {
        fetchCount += 1;
        return new Response(JSON.stringify(providerPayload()), { status: 200 });
      },
      { settleError: true },
    );
    await assert.rejects(service.execute(input()), {
      code: 'ambiguous_response',
      status: 502,
    });
    assert.equal(fetchCount, 1);
    assert.equal(lifecycle.at(-1), 'uncertain');
  });
});
