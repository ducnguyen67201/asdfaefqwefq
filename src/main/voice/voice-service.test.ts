import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  LEGACY_VOICE_TRANSCRIPTION_MODEL,
  VOICE_TRANSCRIPTION_MODEL,
} from '../../shared/contracts';
import type { RustDesktopEngineClient } from '../engine/rust-desktop-engine-client';

import { VoiceService, type VoiceCredentialStore } from './voice-service';

const TEST_API_KEY = `sk-test-${'a'.repeat(32)}`;

function wavBase64(durationMs = 300): string {
  const dataBytes = Math.round((durationMs / 1_000) * 16_000 * 2);
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes.toString('base64');
}

function segmentRequest() {
  return {
    audioBase64: wavBase64(),
    durationMs: 300,
    requestId: randomUUID(),
    sequence: 2,
    utteranceId: randomUUID(),
  };
}

function memoryStore(initial: string | null = null): {
  read: ReturnType<typeof vi.fn>;
  store: VoiceCredentialStore;
  write: ReturnType<typeof vi.fn>;
} {
  let value = initial;
  const read = vi.fn(async () => value);
  const write = vi.fn(async (nextValue: string) => {
    value = nextValue;
  });
  return { read, store: { read, write }, write };
}

type VoiceRustEngine = Pick<
  RustDesktopEngineClient,
  'transcribeVoice' | 'validateVoiceCredential'
>;

function rustEngine(
  overrides: Partial<VoiceRustEngine> = {},
): VoiceRustEngine {
  return {
    transcribeVoice: overrides.transcribeVoice ?? vi.fn(async () => ({
      body: {
        audioDurationMs: 300,
        billedSeconds: 0.3,
        model: VOICE_TRANSCRIPTION_MODEL,
        text: 'open YouTube',
      },
      status: 200,
    })),
    validateVoiceCredential:
      overrides.validateVoiceCredential ?? vi.fn(async () => ({
        body: { id: VOICE_TRANSCRIPTION_MODEL },
        status: 200,
      })),
  };
}

describe('VoiceService', () => {
  it('routes hosted transcription through Rust and never reads the local key', async () => {
    const { store, read } = memoryStore(TEST_API_KEY);
    const accessToken = `tro_live_${'a'.repeat(43)}`;
    const request = segmentRequest();
    const transcribeVoice = vi.fn(async () => ({
      body: {
        audioDurationMs: 300,
        billedSeconds: 0.3,
        model: LEGACY_VOICE_TRANSCRIPTION_MODEL,
        text: 'open YouTube',
        usageSource: 'actual',
      },
      status: 200,
    }));
    const engine = rustEngine({ transcribeVoice });
    const service = new VoiceService({
      accessTokenProvider: vi.fn(async () => accessToken),
      apiBaseUrl: 'http://127.0.0.1:8080',
      credentialStore: store,
      preferencesService: {
        getPrimaryLanguage: vi.fn(async () => 'vi' as const),
      },
      rustEngine: engine,
    });

    await expect(service.transcribeSegment(request)).resolves.toMatchObject({
      model: LEGACY_VOICE_TRANSCRIPTION_MODEL,
      sequence: request.sequence,
      text: 'open YouTube',
    });
    expect(read).not.toHaveBeenCalled();
    expect(transcribeVoice).toHaveBeenCalledWith({
      apiBaseUrl: 'http://127.0.0.1:8080',
      audioBase64: request.audioBase64,
      clientDurationMs: 300,
      credential: accessToken,
      language: 'vi',
      requestId: request.requestId,
      utteranceId: request.utteranceId,
    });
  });

  it('routes local development transcription through Rust', async () => {
    const request = segmentRequest();
    const engine = rustEngine();
    const service = new VoiceService({
      credentialStore: memoryStore(TEST_API_KEY).store,
      environmentApiKey: '',
      rustEngine: engine,
    });

    await expect(service.transcribeSegment(request)).resolves.toMatchObject({
      model: VOICE_TRANSCRIPTION_MODEL,
      text: 'open YouTube',
    });
    expect(engine.transcribeVoice).toHaveBeenCalledOnce();
  });

  it('validates credentials in Rust before writing the encrypted local key', async () => {
    const { store, write } = memoryStore();
    const engine = rustEngine();
    const service = new VoiceService({
      credentialStore: store,
      environmentApiKey: '',
      rustEngine: engine,
    });

    await expect(service.configure({ apiKey: TEST_API_KEY })).resolves.toMatchObject({
      state: 'ready',
    });
    expect(engine.validateVoiceCredential).toHaveBeenCalledWith(TEST_API_KEY);
    expect(write).toHaveBeenCalledWith(TEST_API_KEY);
  });

  it('does not persist a credential rejected by Rust', async () => {
    const { store, write } = memoryStore();
    const engine = rustEngine({
      validateVoiceCredential: vi.fn(async () => ({
        body: { error: { message: 'Invalid API key.' } },
        status: 401,
      })),
    });
    const service = new VoiceService({
      credentialStore: store,
      environmentApiKey: '',
      rustEngine: engine,
    });

    await expect(service.configure({ apiKey: TEST_API_KEY })).rejects.toThrow(
      'Invalid API key.',
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('never retries missing, malformed, or timed-out Rust responses', async () => {
    const missing = new VoiceService({
      credentialStore: memoryStore().store,
      environmentApiKey: '',
      rustEngine: rustEngine(),
    });
    await expect(missing.transcribeSegment(segmentRequest())).rejects.toThrow(
      'OPENAI_API_KEY is missing',
    );

    const malformedCall = vi.fn(async () => ({ body: { text: 42 }, status: 200 }));
    const malformed = new VoiceService({
      credentialStore: memoryStore(TEST_API_KEY).store,
      environmentApiKey: '',
      rustEngine: rustEngine({ transcribeVoice: malformedCall }),
    });
    await expect(malformed.transcribeSegment(segmentRequest())).rejects.toThrow(
      'invalid response',
    );
    expect(malformedCall).toHaveBeenCalledOnce();

    const timeoutCall = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const timedOut = new VoiceService({
      credentialStore: memoryStore(TEST_API_KEY).store,
      environmentApiKey: '',
      rustEngine: rustEngine({ transcribeVoice: timeoutCall }),
    });
    await expect(timedOut.transcribeSegment(segmentRequest())).rejects.toThrow(
      'timed out',
    );
    expect(timeoutCall).toHaveBeenCalledOnce();
  });
});
