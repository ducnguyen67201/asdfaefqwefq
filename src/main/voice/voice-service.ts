import { z } from 'zod';

import {
  ConfigureVoiceRequestSchema,
  VOICE_TRANSCRIPTION_MODEL,
  TranscribeVoiceSegmentRequestSchema,
  VoiceSegmentTranscriptionSchema,
  VoiceStatusSchema,
  type VoiceSegmentTranscription,
  type VoiceStatus,
} from '../../shared/contracts';
import type { RustDesktopEngineClient } from '../engine/rust-desktop-engine-client';
import type { AppPreferencesService } from '../preferences/app-preferences-service';

const OpenAIErrorResponseSchema = z.object({
  error: z
    .union([
      z.string().min(1).max(2_000),
      z.object({ message: z.string().min(1).max(2_000) }),
    ])
    .optional(),
});

const OpenAIModelResponseSchema = z.object({
  id: z.literal(VOICE_TRANSCRIPTION_MODEL),
});

const HostedTranscriptionResponseSchema = VoiceSegmentTranscriptionSchema.omit({
  sequence: true,
  utteranceId: true,
}).extend({
  usageSource: z.enum(['actual', 'missing']).optional(),
});

function apiErrorMessage(responseBody: unknown): string | undefined {
  const apiError = OpenAIErrorResponseSchema.safeParse(responseBody);
  if (!apiError.success) return undefined;
  if (typeof apiError.data.error === 'string') return apiError.data.error;
  return apiError.data.error?.message;
}

export interface VoiceCredentialStore {
  read(): Promise<string | null>;
  write(apiKey: string): Promise<void>;
}

type VoiceDiagnosticProperties = Record<string, string | number | boolean>;
type VoiceDiagnosticLogger = (
  event: string,
  properties?: VoiceDiagnosticProperties,
) => void;

interface VoiceServiceOptions {
  accessTokenProvider?: () => Promise<string | null>;
  apiBaseUrl?: string;
  credentialStore: VoiceCredentialStore;
  diagnosticLogger?: VoiceDiagnosticLogger;
  environmentApiKey?: string;
  logger?: Pick<Console, 'error'>;
  preferencesService?: Pick<AppPreferencesService, 'getPrimaryLanguage'>;
  rustEngine: Pick<
    RustDesktopEngineClient,
    'transcribeVoice' | 'validateVoiceCredential'
  >;
}

const SECRET_PATTERN = /\b(?:ek|sk|tro_live)[-_][a-z0-9._-]+/gi;

function defaultVoiceDiagnosticLogger(
  event: string,
  properties: VoiceDiagnosticProperties = {},
): void {
  if (process.env.NODE_ENV === 'test') return;
  const details =
    Object.keys(properties).length > 0 ? ` ${JSON.stringify(properties)}` : '';
  console.info(`[voice:main] ${event}${details}`);
}

function diagnosticErrorProperties(error: unknown): VoiceDiagnosticProperties {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const rawMessage =
    error instanceof Error ? error.message : 'Unknown voice service error.';
  return {
    errorMessage: rawMessage.replace(SECRET_PATTERN, '[redacted]').slice(0, 500),
    errorName: name,
  };
}

function readyStatus(): VoiceStatus {
  return VoiceStatusSchema.parse({
    model: VOICE_TRANSCRIPTION_MODEL,
    provider: 'openai',
    state: 'ready',
    summary: 'OpenAI GPT Transcribe is configured.',
  });
}

export class VoiceService {
  private readonly accessTokenProvider?: () => Promise<string | null>;
  private readonly apiBaseUrl: string;
  private readonly credentialStore: VoiceCredentialStore;
  private readonly diagnosticLogger: VoiceDiagnosticLogger;
  private readonly environmentApiKey?: string;
  private readonly logger: Pick<Console, 'error'>;
  private readonly preferencesService: Pick<
    AppPreferencesService,
    'getPrimaryLanguage'
  >;

  private readonly rustEngine: Pick<
    RustDesktopEngineClient,
    'transcribeVoice' | 'validateVoiceCredential'
  >;

  constructor({
    accessTokenProvider,
    apiBaseUrl,
    credentialStore,
    diagnosticLogger = defaultVoiceDiagnosticLogger,
    environmentApiKey = process.env.OPENAI_API_KEY,
    logger = console,
    preferencesService = { getPrimaryLanguage: async () => 'en' },
    rustEngine,
  }: VoiceServiceOptions) {
    this.accessTokenProvider = accessTokenProvider;
    this.apiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
    this.credentialStore = credentialStore;
    this.diagnosticLogger = diagnosticLogger;
    this.environmentApiKey = environmentApiKey?.trim() || undefined;
    this.logger = logger;
    this.preferencesService = preferencesService;
    this.rustEngine = rustEngine;
  }

  async getStatus(): Promise<VoiceStatus> {
    this.diagnosticLogger('status.check-start');
    try {
      const credential = await this.readCredential();
      if (credential) {
        this.diagnosticLogger('status.ready');
        return readyStatus();
      }
      this.diagnosticLogger('status.not-configured');
      return VoiceStatusSchema.parse({
        model: VOICE_TRANSCRIPTION_MODEL,
        provider: 'openai',
        state: 'not_configured',
        summary: this.apiBaseUrl
          ? 'Sign in with Google to use voice input.'
          : 'OPENAI_API_KEY is missing from Doppler. Add it and restart Tro.',
      });
    } catch (error) {
      this.diagnosticLogger('status.failed', diagnosticErrorProperties(error));
      return VoiceStatusSchema.parse({
        model: VOICE_TRANSCRIPTION_MODEL,
        provider: 'openai',
        state: 'error',
        summary: 'Tro could not read the encrypted voice credential.',
      });
    }
  }

  async configure(input: unknown): Promise<VoiceStatus> {
    this.diagnosticLogger('configure.start');
    if (this.apiBaseUrl) {
      throw new Error('Tro voice is managed by the hosted service.');
    }
    const { apiKey } = ConfigureVoiceRequestSchema.parse(input);
    await this.validateTranscriptionAccess(apiKey);
    await this.credentialStore.write(apiKey);
    this.diagnosticLogger('configure.ready');
    return readyStatus();
  }

  async transcribeSegment(input: unknown): Promise<VoiceSegmentTranscription> {
    const request = TranscribeVoiceSegmentRequestSchema.parse(input);
    const credential = await this.readCredential();
    if (!credential) {
      throw new Error(
        this.apiBaseUrl
          ? 'Sign in with Google to use voice input.'
          : 'OPENAI_API_KEY is missing from Doppler. Add it and restart Tro.',
      );
    }
    const language = await this.preferencesService.getPrimaryLanguage();
    const startedAt = Date.now();
    this.diagnosticLogger('segment.request-start', {
      byteCount: Math.floor((request.audioBase64.length * 3) / 4),
      durationMs: request.durationMs,
      model: VOICE_TRANSCRIPTION_MODEL,
      requestId: request.requestId,
      sequence: request.sequence,
    });

    let responseBody: unknown;
    let responseStatus: number;
    try {
      const rustResponse = await this.rustEngine.transcribeVoice({
        apiBaseUrl: this.apiBaseUrl,
        credential,
        audioBase64: request.audioBase64,
        clientDurationMs: request.durationMs,
        language,
        requestId: request.requestId,
        utteranceId: request.utteranceId,
      });
      responseBody = rustResponse.body;
      responseStatus = rustResponse.status;
    } catch (error) {
      this.diagnosticLogger(
        'segment.request-failed',
        diagnosticErrorProperties(error),
      );
      this.logger.error('[voice] GPT Transcribe segment request failed.', {
        durationMs: request.durationMs,
        error: diagnosticErrorProperties(error),
        requestId: request.requestId,
        sequence: request.sequence,
      });
      throw new Error(
        error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'OpenAI voice transcription timed out.'
          : 'Tro could not reach voice transcription.',
        { cause: error },
      );
    }

    if (responseStatus < 200 || responseStatus >= 300) {
      const detail = apiErrorMessage(responseBody);
      this.diagnosticLogger('segment.rejected', { status: responseStatus });
      throw new Error(detail || 'OpenAI rejected the voice segment.');
    }

    let parsed: z.infer<typeof HostedTranscriptionResponseSchema>;
    try {
      parsed = HostedTranscriptionResponseSchema.parse(responseBody);
    } catch (error) {
      this.diagnosticLogger(
        'segment.response-invalid',
        diagnosticErrorProperties(error),
      );
      throw new Error('Voice transcription returned an invalid response.', {
        cause: error,
      });
    }
    this.diagnosticLogger('segment.completed', {
      audioDurationMs: parsed.audioDurationMs,
      billedSeconds: parsed.billedSeconds,
      durationMs: Date.now() - startedAt,
      model: VOICE_TRANSCRIPTION_MODEL,
      requestId: request.requestId,
      sequence: request.sequence,
    });
    return VoiceSegmentTranscriptionSchema.parse({
      ...parsed,
      sequence: request.sequence,
      utteranceId: request.utteranceId,
    });
  }

  private async readCredential(): Promise<string | null> {
    if (this.apiBaseUrl) {
      const accessToken = await this.accessTokenProvider?.();
      this.diagnosticLogger(
        accessToken ? 'credential.available' : 'credential.missing',
        { source: 'hosted-session' },
      );
      return accessToken ?? null;
    }
    if (this.environmentApiKey) {
      this.diagnosticLogger('credential.available', { source: 'environment' });
      return this.environmentApiKey;
    }
    const storedApiKey = await this.credentialStore.read();
    this.diagnosticLogger(
      storedApiKey ? 'credential.available' : 'credential.missing',
      { source: 'encrypted-store' },
    );
    return storedApiKey;
  }

  private async validateTranscriptionAccess(apiKey: string): Promise<void> {
    const response = await this.rustEngine.validateVoiceCredential(apiKey);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        apiErrorMessage(response.body) || 'OpenAI rejected the voice credential.',
      );
    }
    OpenAIModelResponseSchema.parse(response.body);
  }
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (
    url.protocol !== 'https:' &&
    url.hostname !== '127.0.0.1' &&
    url.hostname !== 'localhost'
  ) {
    throw new Error('TROCODE_API_BASE_URL must use HTTPS.');
  }
  return url.toString().replace(/\/+$/, '');
}
