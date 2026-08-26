import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
  ActivateCompanionCandidateRequestSchema,
  ActivateSavedCompanionRequestSchema,
  CompanionAppearanceSchema,
  CompanionCustomizationStatusSchema,
  CompanionGenerationQuotaSchema,
  GenerateCompanionImageRequestSchema,
  MAX_COMPANION_IMAGE_BYTES,
  TROCODE_COMPANION_SCHEME,
  type CompanionAppearance,
  type CompanionCandidate,
  type CompanionCustomizationStatus,
  type CompanionGenerationQuota,
  type GenerateCompanionImageRequest,
  type SavedCompanion,
} from '../../shared/contracts';

const CANDIDATE_TTL_MS = 10 * 60 * 1_000;
const MAX_HOSTED_RESPONSE_BYTES = 12 * 1_024 * 1_024;
const MAX_GENERATED_IMAGE_BYTES = 8 * 1_024 * 1_024;
const MAX_ACTIVE_IMAGE_BYTES = 1 * 1_024 * 1_024;
const MAX_SAVED_COMPANIONS = 50;
const MAX_ISO_TIMESTAMP_MS = 253_402_300_799_999;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ACTIVE_FILE_PATTERN = /^active-(\d+)-([0-9a-f]{64})\.enc$/u;
const SELECTION_FILE_NAME = 'selection.enc';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface ImageSize {
  height: number;
  width: number;
}

interface NativeImageLike {
  getSize(): ImageSize;
  isEmpty(): boolean;
  resize(options: {
    height?: number;
    quality: 'best';
    width?: number;
  }): NativeImageLike;
  toPNG(): Buffer;
}

interface NativeImageAdapter {
  createFromBuffer(buffer: Buffer): NativeImageLike;
}

interface SafeStorageAdapter {
  decryptStringAsync(buffer: Buffer): Promise<{
    result: string;
    shouldReEncrypt: boolean;
  }>;
  encryptStringAsync(value: string): Promise<Buffer>;
  isAsyncEncryptionAvailable(): Promise<boolean>;
}

interface CompanionCustomizationServiceOptions {
  accessTokenProvider(): Promise<string | null>;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  nativeImage: NativeImageAdapter;
  now?: () => number;
  publish(appearance: CompanionAppearance): void;
  safeStorage: SafeStorageAdapter;
  userDataPath: string;
  uuid?: () => string;
}

interface CandidateRecord {
  bytes: Buffer;
  expiresAt: number;
  id: string;
  ownerKey: string;
}

interface ActiveRecord {
  bytes: Buffer;
  createdAt: number;
  hash: string;
}

const ActiveEnvelopeSchema = z
  .object({
    pngBase64: z.string().min(4).max(Math.ceil(MAX_ACTIVE_IMAGE_BYTES / 3) * 4),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    version: z.literal(1),
  })
  .strict();

const SelectionEnvelopeSchema = z
  .object({
    activeHash: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
    version: z.literal(1),
  })
  .strict();

const HostedQuotaStatusSchema = z
  .object({
    quota: CompanionGenerationQuotaSchema.nullable(),
    state: z.enum(['available', 'unavailable']),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict();

const HostedGenerationResponseSchema = z
  .object({
    imageBase64: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4),
    mimeType: z.literal('image/png'),
    model: z.string().trim().min(1).max(100),
    quota: CompanionGenerationQuotaSchema,
  })
  .strict();

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function activeFileParts(
  name: string,
): { hash: string; timestamp: number } | null {
  const match = ACTIVE_FILE_PATTERN.exec(name);
  const timestamp = Number(match?.[1]);
  if (
    !match?.[2] ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > MAX_ISO_TIMESTAMP_MS
  ) {
    return null;
  }
  return { hash: match[2], timestamp };
}

function ownerKey(userId: string): string {
  return sha256(`trocode-companion-owner-v1\0${userId}`);
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.byteLength >= PNG_SIGNATURE.byteLength &&
    buffer.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
  );
}

function isJpeg(buffer: Buffer): boolean {
  return (
    buffer.byteLength >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff &&
    buffer.at(-2) === 0xff &&
    buffer.at(-1) === 0xd9
  );
}

function decodeCanonicalBase64(value: string, maxBytes: number): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > maxBytes ||
    bytes.toString('base64') !== value
  ) {
    throw new Error('Image data is not bounded canonical base64.');
  }
  return bytes;
}

function imageSize(image: NativeImageLike): ImageSize {
  if (image.isEmpty()) throw new Error('Image could not be decoded.');
  const size = image.getSize();
  if (
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width < 16 ||
    size.height < 16 ||
    size.width > 8_192 ||
    size.height > 8_192
  ) {
    throw new Error('Image dimensions are outside the supported range.');
  }
  return size;
}

function assetHeaders(): Headers {
  return new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'image/png',
    'X-Content-Type-Options': 'nosniff',
  });
}

function statusResponse(status: number): Response {
  return new Response(null, {
    headers: { 'Cache-Control': 'no-store' },
    status,
  });
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('Response body exceeds the byte limit.');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('response-size-limit');
      throw new Error('Response body exceeds the byte limit.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function errorSummary(code: unknown, status: number): string {
  if (code === 'companion_generation_limit_reached') {
    return 'You have used all 5 companion generations for this month.';
  }
  if (code === 'companion_image_rejected') {
    return 'That image could not be used for a student companion. Try another reference or prompt.';
  }
  if (code === 'ambiguous_dispatch' || code === 'ambiguous_response') {
    return 'The generation result is uncertain, so Tro did not retry it.';
  }
  if (code === 'companion_generation_unavailable' || status === 403) {
    return 'Companion generation is not available for this account.';
  }
  if (status === 429) return 'Too many requests. Please wait before trying again.';
  return 'Companion generation is temporarily unavailable.';
}

export class CompanionCustomizationService {
  private active: ActiveRecord | null = null;

  private readonly apiBaseUrl: string;

  private candidate: CandidateRecord | null = null;

  private currentOwnerKey: string | null = null;

  private readonly fetchImpl: typeof fetch;

  private lastQuota: CompanionGenerationQuota | null = null;

  private readonly now: () => number;

  private saved: ActiveRecord[] = [];

  private readonly uuid: () => string;

  constructor(private readonly options: CompanionCustomizationServiceOptions) {
    this.apiBaseUrl = options.apiBaseUrl.trim().replace(/\/+$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.uuid = options.uuid ?? randomUUID;
  }

  async setCurrentOwner(userId: string | null): Promise<void> {
    this.candidate = null;
    this.lastQuota = null;
    this.active = null;
    this.saved = [];
    this.currentOwnerKey = userId ? ownerKey(userId) : null;
    if (!this.currentOwnerKey) {
      this.options.publish({ kind: 'default' });
      return;
    }
    if (await this.options.safeStorage.isAsyncEncryptionAvailable()) {
      this.saved = await this.readSaved();
      const selection = await this.readSelection();
      this.active = selection.exists
        ? (this.saved.find((record) => record.hash === selection.activeHash) ?? null)
        : (this.saved[0] ?? null);
    }
    this.options.publish(this.appearance());
  }

  async getStatus(): Promise<CompanionCustomizationStatus> {
    if (!this.currentOwnerKey) {
      return this.status('unavailable', 'Sign in to customize the cursor companion.');
    }
    if (!(await this.options.safeStorage.isAsyncEncryptionAvailable())) {
      return this.status(
        'unavailable',
        'Secure local storage is unavailable on this device.',
      );
    }
    if (!this.apiBaseUrl) {
      return this.status(
        'unavailable',
        'Companion generation requires the hosted Tro service.',
      );
    }
    const accessToken = await this.options.accessTokenProvider();
    if (!accessToken) {
      return this.status('unavailable', 'Sign in to customize the cursor companion.');
    }
    try {
      const response = await this.fetchImpl(
        `${this.apiBaseUrl}/v1/companion-images/quota`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body = await readBoundedBody(response, 32_000);
      if (!response.ok) {
        return this.status(
          'error',
          errorSummary(JSON.parse(body.toString('utf8'))?.code, response.status),
        );
      }
      const hosted = HostedQuotaStatusSchema.parse(
        JSON.parse(body.toString('utf8')),
      );
      this.lastQuota = hosted.quota;
      return this.status(hosted.state, hosted.summary);
    } catch {
      return this.status(
        'error',
        'Companion generation status is temporarily unavailable.',
      );
    }
  }

  async generate(
    rawRequest: GenerateCompanionImageRequest,
  ): Promise<CompanionCustomizationStatus> {
    const request = GenerateCompanionImageRequestSchema.parse(rawRequest);
    if (!this.currentOwnerKey) throw new Error('Sign in before generating a companion.');
    if (!(await this.options.safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure local storage is unavailable on this device.');
    }
    if (!this.apiBaseUrl) throw new Error('Companion generation requires hosted Tro.');
    const accessToken = await this.options.accessTokenProvider();
    if (!accessToken) throw new Error('Sign in before generating a companion.');
    const normalized = this.normalizeSource(request);
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.apiBaseUrl}/v1/openai/images/companion-edits`,
        {
          body: JSON.stringify({
            imageBase64: normalized.toString('base64'),
            mimeType: 'image/png',
            prompt: request.prompt,
          }),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Trocode-Request-Id': request.requestId,
          },
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(135_000),
        },
      );
    } catch {
      throw new Error(
        'Companion generation may have completed, so Tro did not retry it.',
      );
    }
    let responseBody: Buffer;
    try {
      responseBody = await readBoundedBody(
        response,
        response.ok ? MAX_HOSTED_RESPONSE_BYTES : 32_000,
      );
    } catch {
      throw new Error(
        'Companion generation may have completed, so Tro did not retry it.',
      );
    }
    if (!response.ok) {
      let code: unknown;
      try {
        code = JSON.parse(responseBody.toString('utf8'))?.code;
      } catch {
        code = null;
      }
      throw new Error(errorSummary(code, response.status));
    }
    try {
      const hosted = HostedGenerationResponseSchema.parse(
        JSON.parse(responseBody.toString('utf8')),
      );
      const generated = decodeCanonicalBase64(
        hosted.imageBase64,
        MAX_GENERATED_IMAGE_BYTES,
      );
      if (!isPng(generated)) {
        throw new Error('Generated companion is not a PNG.');
      }
      const decoded = this.options.nativeImage.createFromBuffer(generated);
      const generatedSize = imageSize(decoded);
      if (generatedSize.width !== generatedSize.height) {
        throw new Error('Generated companion must be square.');
      }
      const activeBytes = decoded
        .resize({ height: 128, quality: 'best', width: 128 })
        .toPNG();
      if (
        !isPng(activeBytes) ||
        activeBytes.byteLength === 0 ||
        activeBytes.byteLength > MAX_ACTIVE_IMAGE_BYTES
      ) {
        throw new Error('Generated companion could not be normalized.');
      }
      const id = this.uuid();
      this.candidate = {
        bytes: Buffer.from(activeBytes),
        expiresAt: this.now() + CANDIDATE_TTL_MS,
        id,
        ownerKey: this.currentOwnerKey,
      };
      this.lastQuota = hosted.quota;
    } catch {
      throw new Error(
        'Companion generation completed, but Tro could not use its result, so it did not retry it.',
      );
    }
    return this.status('available', 'Your companion preview is ready.');
  }

  async activateCandidate(
    rawRequest: { candidateId: string },
  ): Promise<CompanionCustomizationStatus> {
    const request = ActivateCompanionCandidateRequestSchema.parse(rawRequest);
    const candidate = this.currentCandidate();
    if (!candidate || candidate.id !== request.candidateId) {
      throw new Error('This companion preview expired. Generate a new one.');
    }
    if (!(await this.options.safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure local storage is unavailable on this device.');
    }
    const hash = sha256(candidate.bytes);
    await this.writeSaved(candidate.bytes, hash);
    this.saved = await this.readSaved();
    const saved = this.saved.find((record) => record.hash === hash) ?? null;
    if (!saved) {
      throw new Error('Tro could not save this companion securely.');
    }
    await this.writeSelection(hash);
    this.active = saved;
    this.candidate = null;
    const appearance = this.appearance();
    this.options.publish(appearance);
    return this.status('available', 'Your custom companion is active.');
  }

  async activateSaved(
    rawRequest: { companionId: string },
  ): Promise<CompanionCustomizationStatus> {
    const request = ActivateSavedCompanionRequestSchema.parse(rawRequest);
    this.requireOwnerKey();
    if (!(await this.options.safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure local storage is unavailable on this device.');
    }
    const saved = this.saved.find((record) => record.hash === request.companionId);
    if (!saved) throw new Error('This saved companion is no longer available.');
    await this.writeSelection(saved.hash);
    this.active = saved;
    this.candidate = null;
    const appearance = this.appearance();
    this.options.publish(appearance);
    return this.status('available', 'Your saved companion is active.');
  }

  async useDefault(): Promise<CompanionCustomizationStatus> {
    this.requireOwnerKey();
    if (!(await this.options.safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Secure local storage is unavailable on this device.');
    }
    await this.writeSelection(null);
    this.candidate = null;
    this.active = null;
    this.options.publish({ kind: 'default' });
    return this.status('available', 'The default companion is active.');
  }

  async handleRequest(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return statusResponse(405);
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return statusResponse(404);
    }
    if (
      url.protocol !== `${TROCODE_COMPANION_SCHEME}:` ||
      url.hostname !== 'asset' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      url.toString() !== request.url
    ) {
      return statusResponse(404);
    }
    let bytes: Buffer | null = null;
    const activeMatch = /^\/active\/([0-9a-f]{64})$/u.exec(url.pathname);
    const candidateMatch = /^\/candidate\/([^/]+)$/u.exec(url.pathname);
    if (activeMatch?.[1]) {
      bytes =
        this.saved.find((record) => record.hash === activeMatch[1])?.bytes ?? null;
    } else if (candidateMatch?.[1] && UUID_PATTERN.test(candidateMatch[1])) {
      const candidate = this.currentCandidate();
      if (candidate?.id === candidateMatch[1]) bytes = candidate.bytes;
    }
    if (!bytes) return statusResponse(404);
    return new Response(
      request.method === 'HEAD' ? null : Uint8Array.from(bytes),
      {
        headers: assetHeaders(),
        status: 200,
      },
    );
  }

  private normalizeSource(request: GenerateCompanionImageRequest): Buffer {
    const source = decodeCanonicalBase64(
      request.imageBase64,
      MAX_COMPANION_IMAGE_BYTES,
    );
    if (
      (request.mimeType === 'image/png' && !isPng(source)) ||
      (request.mimeType === 'image/jpeg' && !isJpeg(source))
    ) {
      throw new Error('Image content does not match its file type.');
    }
    let image = this.options.nativeImage.createFromBuffer(source);
    const size = imageSize(image);
    if (Math.max(size.width, size.height) > 1_024) {
      image =
        size.width >= size.height
          ? image.resize({ quality: 'best', width: 1_024 })
          : image.resize({ height: 1_024, quality: 'best' });
    }
    const normalized = image.toPNG();
    if (
      !isPng(normalized) ||
      normalized.byteLength === 0 ||
      normalized.byteLength > MAX_COMPANION_IMAGE_BYTES
    ) {
      throw new Error('Image could not be normalized within the size limit.');
    }
    return normalized;
  }

  private appearance(): CompanionAppearance {
    return CompanionAppearanceSchema.parse(
      this.active
        ? {
            assetUrl: `${TROCODE_COMPANION_SCHEME}://asset/active/${this.active.hash}`,
            kind: 'custom',
            revision: this.active.hash,
          }
        : { kind: 'default' },
    );
  }

  private candidateDescriptor(): CompanionCandidate | null {
    const candidate = this.currentCandidate();
    if (!candidate) return null;
    return {
      assetUrl: `${TROCODE_COMPANION_SCHEME}://asset/candidate/${candidate.id}`,
      expiresAt: new Date(candidate.expiresAt).toISOString(),
      id: candidate.id,
    };
  }

  private currentCandidate(): CandidateRecord | null {
    if (
      !this.candidate ||
      this.candidate.ownerKey !== this.currentOwnerKey ||
      this.candidate.expiresAt <= this.now()
    ) {
      this.candidate = null;
      return null;
    }
    return this.candidate;
  }

  private savedDescriptors(): SavedCompanion[] {
    return this.saved.map((record) => ({
      assetUrl: `${TROCODE_COMPANION_SCHEME}://asset/active/${record.hash}`,
      createdAt: new Date(record.createdAt).toISOString(),
      id: record.hash,
    }));
  }

  private status(
    state: 'available' | 'unavailable' | 'error',
    summary: string,
  ): CompanionCustomizationStatus {
    return CompanionCustomizationStatusSchema.parse({
      appearance: this.appearance(),
      candidate: this.candidateDescriptor(),
      quota: state === 'available' ? this.lastQuota : null,
      savedCompanions: this.savedDescriptors(),
      state: state === 'available' && !this.lastQuota ? 'unavailable' : state,
      summary,
    });
  }

  private requireOwnerKey(): string {
    if (!this.currentOwnerKey) throw new Error('Sign in before changing a companion.');
    return this.currentOwnerKey;
  }

  private ownerDirectory(key: string): string {
    return path.join(this.options.userDataPath, 'companion-customizations', key);
  }

  private async activeFileNames(directory: string): Promise<string[]> {
    try {
      const names = await readdir(directory);
      return names
        .filter((name) => activeFileParts(name) !== null)
        .sort((left, right) => {
          const leftTimestamp = activeFileParts(left)?.timestamp ?? 0;
          const rightTimestamp = activeFileParts(right)?.timestamp ?? 0;
          return rightTimestamp - leftTimestamp;
        });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async writeSaved(bytes: Buffer, hash: string): Promise<void> {
    if (this.saved.some((record) => record.hash === hash)) return;
    const key = this.requireOwnerKey();
    const directory = this.ownerDirectory(key);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const existing = await this.activeFileNames(directory);
    const envelope = ActiveEnvelopeSchema.parse({
      pngBase64: bytes.toString('base64'),
      sha256: hash,
      version: 1,
    });
    const encrypted = await this.options.safeStorage.encryptStringAsync(
      JSON.stringify(envelope),
    );
    const newestTimestamp = activeFileParts(existing[0] ?? '')?.timestamp ?? 0;
    const timestamp = Math.max(this.now(), newestTimestamp + 1);
    const name = `active-${timestamp}-${hash}.enc`;
    await writeFile(path.join(directory, name), encrypted.toString('base64'), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const savedNames = await this.activeFileNames(directory);
    for (const overflow of savedNames.slice(MAX_SAVED_COMPANIONS)) {
      await rm(path.join(directory, overflow), { force: true });
    }
  }

  private async readSaved(): Promise<ActiveRecord[]> {
    const key = this.requireOwnerKey();
    const directory = this.ownerDirectory(key);
    const records: ActiveRecord[] = [];
    const seen = new Set<string>();
    for (const name of (await this.activeFileNames(directory)).slice(
      0,
      MAX_SAVED_COMPANIONS,
    )) {
      try {
        const fileParts = activeFileParts(name);
        if (!fileParts) throw new Error('Invalid filename.');
        const encoded = await readFile(path.join(directory, name), 'utf8');
        const decrypted = await this.options.safeStorage.decryptStringAsync(
          Buffer.from(encoded, 'base64'),
        );
        const envelope = ActiveEnvelopeSchema.parse(JSON.parse(decrypted.result));
        const bytes = decodeCanonicalBase64(
          envelope.pngBase64,
          MAX_ACTIVE_IMAGE_BYTES,
        );
        if (
          !isPng(bytes) ||
          sha256(bytes) !== envelope.sha256 ||
          fileParts.hash !== envelope.sha256 ||
          seen.has(envelope.sha256)
        ) {
          throw new Error('Invalid saved companion.');
        }
        const decoded = this.options.nativeImage.createFromBuffer(bytes);
        const size = imageSize(decoded);
        if (size.width !== 128 || size.height !== 128) {
          throw new Error('Invalid saved companion dimensions.');
        }
        if (decrypted.shouldReEncrypt) {
          const encrypted = await this.options.safeStorage.encryptStringAsync(
            JSON.stringify(envelope),
          );
          await writeFile(
            path.join(directory, name),
            encrypted.toString('base64'),
            { encoding: 'utf8', mode: 0o600 },
          );
        }
        seen.add(envelope.sha256);
        records.push({
          bytes,
          createdAt: fileParts.timestamp,
          hash: envelope.sha256,
        });
      } catch {
        await rm(path.join(directory, name), { force: true });
      }
    }
    return records;
  }

  private async readSelection(): Promise<{
    activeHash: string | null;
    exists: boolean;
  }> {
    const key = this.requireOwnerKey();
    const selectionPath = path.join(
      this.ownerDirectory(key),
      SELECTION_FILE_NAME,
    );
    try {
      const encoded = await readFile(selectionPath, 'utf8');
      const decrypted = await this.options.safeStorage.decryptStringAsync(
        Buffer.from(encoded, 'base64'),
      );
      const envelope = SelectionEnvelopeSchema.parse(
        JSON.parse(decrypted.result),
      );
      if (decrypted.shouldReEncrypt) {
        await this.writeSelection(envelope.activeHash);
      }
      return { activeHash: envelope.activeHash, exists: true };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { activeHash: null, exists: false };
      }
      await rm(selectionPath, { force: true });
      return { activeHash: null, exists: true };
    }
  }

  private async writeSelection(activeHash: string | null): Promise<void> {
    const key = this.requireOwnerKey();
    const directory = this.ownerDirectory(key);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const envelope = SelectionEnvelopeSchema.parse({ activeHash, version: 1 });
    const encrypted = await this.options.safeStorage.encryptStringAsync(
      JSON.stringify(envelope),
    );
    await writeFile(
      path.join(directory, SELECTION_FILE_NAME),
      encrypted.toString('base64'),
      { encoding: 'utf8', mode: 0o600 },
    );
  }
}
