import {
  GPT_IMAGE_MODEL,
  IMAGE_CATALOG_VERSION,
} from './model-catalog.mjs';

const OPENAI_IMAGE_EDITS_URL = 'https://api.openai.com/v1/images/edits';
const MAX_SOURCE_BYTES = 5 * 1_024 * 1_024;
const MAX_OUTPUT_BYTES = 8 * 1_024 * 1_024;
const MAX_PROVIDER_RESPONSE_BYTES = 12 * 1_024 * 1_024;
const MAX_TOKEN_COUNT = 2_000_000_000;
const PROVIDER_TIMEOUT_MS = 130_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class CompanionImageServiceError extends Error {
  constructor(status, message, code = 'companion_image_error') {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function isStrictBase64(value) {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const contentLength = value.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    if (!isDigit && !isUpper && !isLower && code !== 43 && code !== 47) {
      return false;
    }
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}

function decodeStrictBase64(value, maxBytes) {
  if (
    typeof value !== 'string' ||
    value.length < 4 ||
    value.length % 4 !== 0 ||
    !isStrictBase64(value)
  ) {
    throw new Error('Image data must be strict base64.');
  }
  const result = Buffer.from(value, 'base64');
  if (result.byteLength === 0 || result.byteLength > maxBytes) {
    throw new Error('Image data exceeds its byte limit.');
  }
  if (result.toString('base64') !== value) {
    throw new Error('Image data is not canonical base64.');
  }
  return result;
}

function requirePng(buffer) {
  if (
    buffer.byteLength < PNG_SIGNATURE.byteLength ||
    !buffer.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
  ) {
    throw new Error('Image data must be PNG.');
  }
}

function boundedToken(name, value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOKEN_COUNT) {
    throw new Error(`${name} must be a bounded nonnegative integer.`);
  }
  return value;
}

function parseProviderPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Provider image response must be an object.');
  }
  if (!Array.isArray(value.data) || value.data.length !== 1) {
    throw new Error('Provider image response must contain exactly one image.');
  }
  const imageBase64 = value.data[0]?.b64_json;
  const image = decodeStrictBase64(imageBase64, MAX_OUTPUT_BYTES);
  requirePng(image);
  const usage = value.usage;
  const details = usage?.input_tokens_details;
  const inputTextTokens = boundedToken('input text tokens', details?.text_tokens);
  const inputImageTokens = boundedToken('input image tokens', details?.image_tokens);
  const outputImageTokens = boundedToken('output image tokens', usage?.output_tokens);
  const inputTokens = boundedToken('input tokens', usage?.input_tokens);
  if (inputTokens !== inputTextTokens + inputImageTokens) {
    throw new Error('Provider input-token totals are inconsistent.');
  }
  return {
    imageBase64,
    usage: { inputImageTokens, inputTextTokens, inputTokens, outputImageTokens },
  };
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw new Error('Provider image response exceeds its byte limit.');
  }
  if (!response.body) throw new Error('Provider image response is empty.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel('response-size-limit');
      throw new Error('Provider image response exceeds its byte limit.');
    }
    chunks.push(Buffer.from(value));
  }
  const body = Buffer.concat(chunks, total);
  return JSON.parse(body.toString('utf8'));
}

function providerPrompt(userPrompt) {
  return [
    'Create exactly one friendly, age-appropriate cursor companion based on the reference image.',
    'Show one centered subject on a transparent background with a bold clean silhouette and high contrast.',
    'Keep recognizable safe traits from the reference and make the result legible at 29 pixels.',
    'Do not include text, letters, logos, watermarks, frames, extra subjects, or unsafe content.',
    '<student_customization>',
    userPrompt,
    '</student_customization>',
  ].join('\n');
}

function isRejectedBeforeInference(status) {
  return [400, 401, 403, 404, 422].includes(status);
}

export class OpenAiCompanionImageService {
  constructor({
    budgetService,
    catalog,
    fetchImpl = fetch,
    logger = console,
    openAiApiKey,
    reservationMicroUsd,
  }) {
    this.budgetService = budgetService;
    this.catalog = catalog;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.openAiApiKey = openAiApiKey;
    this.reservationMicroUsd = reservationMicroUsd;
  }

  async execute(input) {
    const startedAt = Date.now();
    let source;
    const prompt = typeof input.body?.prompt === 'string' ? input.body.prompt.trim() : '';
    try {
      if (input.body?.mimeType !== 'image/png') throw new Error('PNG is required.');
      if (prompt.length < 1 || prompt.length > 400) throw new Error('Prompt is invalid.');
      if (!UUID_PATTERN.test(input.requestId)) throw new Error('Request ID is invalid.');
      source = decodeStrictBase64(input.body.imageBase64, MAX_SOURCE_BYTES);
      requirePng(source);
    } catch {
      throw new CompanionImageServiceError(
        400,
        'Choose a valid PNG and customization prompt.',
        'invalid_companion_image_request',
      );
    }

    await this.budgetService.reserve({
      catalogVersion: IMAGE_CATALOG_VERSION,
      lane: 'image_generation',
      model: GPT_IMAGE_MODEL,
      planId: input.planId,
      requestId: input.requestId,
      reservedMicroUsd: this.reservationMicroUsd,
      taskId: input.requestId,
      userId: input.userId,
    });

    const form = new FormData();
    form.append('image[]', new Blob([source], { type: 'image/png' }), 'reference.png');
    form.set('model', GPT_IMAGE_MODEL);
    form.set('prompt', providerPrompt(prompt));
    form.set('n', '1');
    form.set('size', '1024x1024');
    form.set('quality', 'low');
    form.set('background', 'transparent');
    form.set('output_format', 'png');
    form.set('moderation', 'auto');

    await this.budgetService.markDispatched(input.userId, input.requestId);
    let response;
    try {
      response = await this.fetchImpl(OPENAI_IMAGE_EDITS_URL, {
        body: form,
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
          'OpenAI-Safety-Identifier': input.safetyIdentifier,
        },
        method: 'POST',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
    } catch {
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new CompanionImageServiceError(
        502,
        'Companion generation may have completed, so Tro did not retry it.',
        'ambiguous_dispatch',
      );
    }

    if (!response.ok) {
      if (isRejectedBeforeInference(response.status)) {
        await this.budgetService.release(
          input.userId,
          input.requestId,
          'rejected_before_inference',
        );
        throw new CompanionImageServiceError(
          422,
          'That image could not be used for a student companion. Try a different reference or prompt.',
          'companion_image_rejected',
        );
      }
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new CompanionImageServiceError(
        502,
        'Companion generation may have completed, so Tro did not retry it.',
        'ambiguous_dispatch',
      );
    }

    let parsed;
    try {
      parsed = parseProviderPayload(await readBoundedJson(response));
    } catch {
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new CompanionImageServiceError(
        502,
        'Companion generation returned an uncertain result, so Tro did not retry it.',
        'ambiguous_response',
      );
    }

    const actualMicroUsd = this.catalog.calculateImageUsageCost({
      inputImageTokens: parsed.usage.inputImageTokens,
      inputTextTokens: parsed.usage.inputTextTokens,
      model: GPT_IMAGE_MODEL,
      outputImageTokens: parsed.usage.outputImageTokens,
    });
    let quota;
    try {
      await this.budgetService.settle({
        actualMicroUsd,
        durationMs: Date.now() - startedAt,
        requestId: input.requestId,
        usage: {
          cacheWriteTokens: 0,
          cachedInputTokens: 0,
          inputImageTokens: parsed.usage.inputImageTokens,
          inputTextTokens: parsed.usage.inputTextTokens,
          inputTokens: parsed.usage.inputTokens,
          model: GPT_IMAGE_MODEL,
          outputImageTokens: parsed.usage.outputImageTokens,
          outputTokens: parsed.usage.outputImageTokens,
          reasoningTokens: 0,
          source: 'actual',
        },
        userId: input.userId,
      });
      quota = await this.budgetService.companionGenerationSnapshot(
        input.userId,
        input.planId,
      );
    } catch {
      try {
        await this.budgetService.markUncertain(input.userId, input.requestId);
      } catch {
        // Preserve the original accounting failure and never replay the edit.
      }
      throw new CompanionImageServiceError(
        502,
        'Companion generation completed, but Tro could not confirm its usage status, so it did not retry it.',
        'ambiguous_response',
      );
    }
    this.logger.info(
      JSON.stringify({
        byteCount: source.byteLength,
        durationMs: Date.now() - startedAt,
        event: 'companion.image.completed',
        inputImageTokens: parsed.usage.inputImageTokens,
        inputTextTokens: parsed.usage.inputTextTokens,
        lane: 'image_generation',
        microUsd: actualMicroUsd,
        model: GPT_IMAGE_MODEL,
        outputImageTokens: parsed.usage.outputImageTokens,
        quotaRemaining: quota.remaining,
        requestId: input.requestId,
      }),
    );
    return {
      imageBase64: parsed.imageBase64,
      mimeType: 'image/png',
      model: GPT_IMAGE_MODEL,
      quota,
    };
  }
}
