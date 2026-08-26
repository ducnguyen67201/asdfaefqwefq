import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanionCustomizationService } from './companion-customization-service';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const SOURCE_PNG = Buffer.from([...PNG_SIGNATURE, 1]);
const NORMALIZED_PNG = Buffer.from([...PNG_SIGNATURE, 2]);
const GENERATED_PNG = Buffer.from([...PNG_SIGNATURE, 3]);
const ACTIVE_PNG = Buffer.from([...PNG_SIGNATURE, 4]);
const GENERATED_PNG_2 = Buffer.from([...PNG_SIGNATURE, 5]);
const ACTIVE_PNG_2 = Buffer.from([...PNG_SIGNATURE, 6]);
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CANDIDATE_ID = '22222222-2222-4222-8222-222222222222';
const quota = {
  limit: 5,
  periodEndsAt: '2026-09-01T00:00:00.000Z',
  periodStartsAt: '2026-08-01T00:00:00.000Z',
  remaining: 4,
  used: 1,
} as const;

function imageFor(buffer: Buffer, width?: number, height?: number) {
  const marker = buffer[8];
  let size = { height: 512, width: 1_024 };
  if (width && height) {
    size = { height, width };
  } else if (marker === 1) {
    size = { height: 1_024, width: 2_048 };
  } else if (marker === 3 || marker === 5) {
    size = { height: 1_024, width: 1_024 };
  } else if (marker === 4 || marker === 6) {
    size = { height: 128, width: 128 };
  }
  return {
    getSize: () => size,
    isEmpty: () => false,
    resize: (options: { height?: number; width?: number }) => {
      if (options.width === 128 && options.height === 128) {
        return imageFor(marker === 5 ? ACTIVE_PNG_2 : ACTIVE_PNG, 128, 128);
      }
      return imageFor(
        NORMALIZED_PNG,
        options.width ?? Math.round((size.width / size.height) * (options.height ?? 1)),
        options.height ?? Math.round((size.height / size.width) * (options.width ?? 1)),
      );
    },
    toPNG: () => {
      if (marker === 1 || marker === 2) return NORMALIZED_PNG;
      if (marker === 3) return GENERATED_PNG;
      if (marker === 5) return GENERATED_PNG_2;
      return marker === 6 ? ACTIVE_PNG_2 : ACTIVE_PNG;
    },
  };
}

const nativeImage = {
  createFromBuffer: (buffer: Buffer) => imageFor(buffer),
};

function xor(value: Buffer): Buffer {
  return Buffer.from(value.map((byte) => byte ^ 0xaa));
}

function safeStorage(available = true, shouldReEncrypt = false) {
  return {
    decryptStringAsync: async (buffer: Buffer) => ({
      result: xor(buffer).toString('utf8'),
      shouldReEncrypt,
    }),
    encryptStringAsync: async (value: string) => xor(Buffer.from(value)),
    isAsyncEncryptionAvailable: async () => available,
  };
}

describe('CompanionCustomizationService', () => {
  let root: string;
  let now: number;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'tro-companion-test-'));
    now = Date.parse('2026-08-25T00:00:00.000Z');
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  function harness(overrides: {
    available?: boolean;
    fetchImpl?: typeof fetch;
    generatedImages?: Buffer[];
    shouldReEncrypt?: boolean;
  } = {}) {
    const calls: Array<{ body?: unknown; method?: string; url: string }> = [];
    const publish = vi.fn();
    let generationIndex = 0;
    const fetchImpl: typeof fetch =
      overrides.fetchImpl ??
      (async (input, init) => {
        const url = String(input);
        calls.push({ body: init?.body, method: init?.method, url });
        if (url.endsWith('/v1/companion-images/quota')) {
          return new Response(
            JSON.stringify({ quota, state: 'available', summary: 'Ready.' }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            imageBase64:
              (overrides.generatedImages?.[generationIndex++] ?? GENERATED_PNG).toString(
                'base64',
              ),
            mimeType: 'image/png',
            model: 'gpt-image-2-2026-04-21',
            quota,
          }),
          { status: 200 },
        );
      }) as typeof fetch;
    const service = new CompanionCustomizationService({
      accessTokenProvider: async () => 'opaque-hosted-token',
      apiBaseUrl: 'https://api.trocode.test/',
      fetchImpl,
      nativeImage,
      now: () => now,
      publish,
      safeStorage: safeStorage(overrides.available, overrides.shouldReEncrypt),
      userDataPath: root,
      uuid: () => CANDIDATE_ID,
    });
    return { calls, publish, service };
  }

  it('normalizes one source, keeps a memory preview, then encrypts activation', async () => {
    const { calls, publish, service } = harness();
    await service.setCurrentOwner('student-a');
    await expect(service.getStatus()).resolves.toMatchObject({
      appearance: { kind: 'default' },
      quota,
      state: 'available',
    });
    const generated = await service.generate({
      imageBase64: SOURCE_PNG.toString('base64'),
      mimeType: 'image/png',
      prompt: 'Make it a blue space cat.',
      requestId: REQUEST_ID,
    });
    expect(generated.candidate?.id).toBe(CANDIDATE_ID);
    expect(calls).toHaveLength(2);
    const posted = JSON.parse(String(calls[1]?.body));
    expect(posted.imageBase64).toBe(NORMALIZED_PNG.toString('base64'));
    expect(posted.mimeType).toBe('image/png');
    expect(posted.prompt).toBe('Make it a blue space cat.');

    const preview = await service.handleRequest(
      new Request(generated.candidate?.assetUrl ?? ''),
    );
    expect(preview.status).toBe(200);
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(ACTIVE_PNG);
    const previewHead = await service.handleRequest(
      new Request(generated.candidate?.assetUrl ?? '', { method: 'HEAD' }),
    );
    expect(previewHead.status).toBe(200);
    expect(previewHead.headers.get('Cache-Control')).toBe('no-store');
    expect(Buffer.from(await previewHead.arrayBuffer())).toHaveLength(0);
    const activated = await service.activateCandidate({
      candidateId: CANDIDATE_ID,
    });
    expect(activated.appearance.kind).toBe('custom');
    expect(activated.candidate).toBeNull();
    expect(activated.savedCompanions).toHaveLength(1);
    expect(publish).toHaveBeenLastCalledWith(activated.appearance);

    const ownerDirectories = await readdir(
      path.join(root, 'companion-customizations'),
    );
    const encryptedFiles = await readdir(
      path.join(root, 'companion-customizations', ownerDirectories[0] as string),
    );
    expect(encryptedFiles).toHaveLength(2);
    const activeFile = encryptedFiles.find((name) => name.startsWith('active-'));
    expect(activeFile).toBeDefined();
    const stored = await readFile(
      path.join(
        root,
        'companion-customizations',
        ownerDirectories[0] as string,
        activeFile as string,
      ),
      'utf8',
    );
    expect(stored).not.toContain(ACTIVE_PNG.toString('base64'));

    const activeUrl =
      activated.appearance.kind === 'custom'
        ? activated.appearance.assetUrl
        : '';
    await expect(service.useDefault()).resolves.toMatchObject({
      appearance: { kind: 'default' },
      savedCompanions: [expect.objectContaining({ id: activated.savedCompanions[0]?.id })],
    });
    expect(
      await readdir(
        path.join(root, 'companion-customizations', ownerDirectories[0] as string),
      ),
    ).toHaveLength(2);
    expect((await service.handleRequest(new Request(activeUrl))).status).toBe(200);
  });

  it('isolates active assets by owner and restores the first owner', async () => {
    const first = harness();
    await first.service.setCurrentOwner('student-a');
    await first.service.getStatus();
    const generated = await first.service.generate({
      imageBase64: SOURCE_PNG.toString('base64'),
      mimeType: 'image/png',
      prompt: 'cat',
      requestId: REQUEST_ID,
    });
    await first.service.activateCandidate({ candidateId: generated.candidate?.id ?? '' });
    await first.service.setCurrentOwner('student-b');
    expect(first.publish).toHaveBeenLastCalledWith({ kind: 'default' });
    await first.service.setCurrentOwner('student-a');
    expect(first.publish.mock.calls.at(-1)?.[0]).toMatchObject({ kind: 'custom' });
  });

  it('retains created companions and persists switching between them and default', async () => {
    const first = harness({ generatedImages: [GENERATED_PNG, GENERATED_PNG_2] });
    await first.service.setCurrentOwner('student-a');
    await first.service.getStatus();

    const firstPreview = await first.service.generate({
      imageBase64: SOURCE_PNG.toString('base64'),
      mimeType: 'image/png',
      prompt: 'cat',
      requestId: REQUEST_ID,
    });
    const firstActive = await first.service.activateCandidate({
      candidateId: firstPreview.candidate?.id ?? '',
    });
    const firstId = firstActive.savedCompanions[0]?.id ?? '';

    now += 100;
    const secondPreview = await first.service.generate({
      imageBase64: SOURCE_PNG.toString('base64'),
      mimeType: 'image/png',
      prompt: 'fox',
      requestId: REQUEST_ID,
    });
    const secondActive = await first.service.activateCandidate({
      candidateId: secondPreview.candidate?.id ?? '',
    });
    expect(secondActive.savedCompanions).toHaveLength(2);
    expect(secondActive.savedCompanions[0]?.id).not.toBe(firstId);

    const switched = await first.service.activateSaved({ companionId: firstId });
    expect(switched.appearance).toMatchObject({
      kind: 'custom',
      revision: firstId,
    });
    expect(switched.savedCompanions).toHaveLength(2);

    const defaultStatus = await first.service.useDefault();
    expect(defaultStatus.appearance).toEqual({ kind: 'default' });
    expect(defaultStatus.savedCompanions).toHaveLength(2);

    const restored = harness();
    await restored.service.setCurrentOwner('student-a');
    const restoredStatus = await restored.service.getStatus();
    expect(restoredStatus.appearance).toEqual({ kind: 'default' });
    expect(restoredStatus.savedCompanions).toHaveLength(2);
  });

  it('preflights secure storage before any hosted request', async () => {
    const { calls, service } = harness({ available: false });
    await service.setCurrentOwner('student-a');
    await expect(
      service.generate({
        imageBase64: SOURCE_PNG.toString('base64'),
        mimeType: 'image/png',
        prompt: 'cat',
        requestId: REQUEST_ID,
      }),
    ).rejects.toThrow(/Secure local storage/u);
    expect(calls).toHaveLength(0);
  });

  it('recovers an older encrypted asset and rewrites it for key rotation', async () => {
    const first = harness();
    await first.service.setCurrentOwner('student-a');
    await first.service.getStatus();
    const generated = await first.service.generate({
      imageBase64: SOURCE_PNG.toString('base64'),
      mimeType: 'image/png',
      prompt: 'cat',
      requestId: REQUEST_ID,
    });
    await first.service.activateCandidate({
      candidateId: generated.candidate?.id ?? '',
    });
    const [ownerDirectory] = await readdir(
      path.join(root, 'companion-customizations'),
    );
    const directory = path.join(
      root,
      'companion-customizations',
      ownerDirectory as string,
    );
    now += 100;
    await writeFile(
      path.join(directory, `active-${now}-${'f'.repeat(64)}.enc`),
      Buffer.from('corrupt-ciphertext').toString('base64'),
      'utf8',
    );

    const restored = harness({ shouldReEncrypt: true });
    await restored.service.setCurrentOwner('student-a');
    expect(restored.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'custom' }),
    );
    const files = await readdir(directory);
    expect(files).toHaveLength(2);
    expect(files.every((name) => !name.includes('f'.repeat(64)))).toBe(true);
  });

  it('does not retry a completed hosted response that cannot be decoded', async () => {
    let fetchCount = 0;
    const { service } = harness({
      fetchImpl: (async () => {
        fetchCount += 1;
        return new Response(
          JSON.stringify({
            imageBase64: 'AAAA',
            mimeType: 'image/png',
            model: 'gpt-image-2-2026-04-21',
            quota,
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    await service.setCurrentOwner('student-a');
    await expect(
      service.generate({
        imageBase64: SOURCE_PNG.toString('base64'),
        mimeType: 'image/png',
        prompt: 'cat',
        requestId: REQUEST_ID,
      }),
    ).rejects.toThrow(/did not retry/u);
    expect(fetchCount).toBe(1);
  });

  it('expires candidate tickets and rejects arbitrary protocol methods and paths', async () => {
    const { service } = harness();
    await service.setCurrentOwner('student-a');
    await service.getStatus();
    const generated = await service.generate({
      imageBase64: SOURCE_PNG.toString('base64'),
      mimeType: 'image/png',
      prompt: 'cat',
      requestId: REQUEST_ID,
    });
    expect(
      (
        await service.handleRequest(
          new Request(generated.candidate?.assetUrl ?? '', { method: 'POST' }),
        )
      ).status,
    ).toBe(405);
    expect(
      (
        await service.handleRequest(
          new Request('trocode-companion://asset/candidate/not-a-ticket'),
        )
      ).status,
    ).toBe(404);
    now += 10 * 60 * 1_000 + 1;
    expect(
      (
        await service.handleRequest(
          new Request(generated.candidate?.assetUrl ?? ''),
        )
      ).status,
    ).toBe(404);
    await expect(
      service.activateCandidate({ candidateId: CANDIDATE_ID }),
    ).rejects.toThrow(/expired/u);
  });
});
