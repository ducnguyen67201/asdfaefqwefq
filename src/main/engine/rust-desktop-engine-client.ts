import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';

import {
  type PrimaryLanguage,
} from '../../shared/contracts';

const ENGINE_PROTOCOL_VERSION = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const STARTUP_TIMEOUT_MS = 120_000;
const VOICE_REQUEST_TIMEOUT_MS = 35_000;
const MAX_PROTOCOL_BUFFER = 1_000_000;

const EngineHealthSchema = z.object({
  engine: z.literal('rust'),
  protocolVersion: z.literal(ENGINE_PROTOCOL_VERSION),
  features: z.array(z.enum([
    'google_oauth',
    'voice',
  ])),
}).strict().superRefine((value, context) => {
  for (const feature of [
    'google_oauth',
    'voice',
  ] as const) {
    if (!value.features.includes(feature)) {
      context.addIssue({
        code: 'custom',
        message: `The Rust desktop engine is missing ${feature}.`,
        path: ['features'],
      });
    }
  }
});

const EngineResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    id: z.string().uuid(),
    ok: z.literal(true),
    result: z.unknown(),
  }).strict(),
  z.object({
    id: z.string().uuid().nullable(),
    ok: z.literal(false),
    error: z.object({ message: z.string().trim().min(1).max(1_000) }).strict(),
  }).strict(),
]);

const RustVoiceResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: z.unknown(),
}).strict();

const GoogleOauthExchangeResponseSchema = z.object({
  idToken: z.string().min(1).max(16_384),
}).strict();

export interface RustVoiceTranscriptionInput {
  apiBaseUrl: string;
  credential: string;
  audioBase64: string;
  clientDurationMs: number;
  language: PrimaryLanguage;
  requestId: string;
  utteranceId: string;
}

export type RustVoiceResponse = z.infer<typeof RustVoiceResponseSchema>;

export interface RustDesktopEngineTransport {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface RustDesktopEngineCommand {
  args: string[];
  cwd?: string;
  executable: string;
}

interface ResolveEngineCommandOptions {
  cargoExecutable?: string;
  enginePath?: string;
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  repositoryRoot: string;
  resourcesPath: string;
}

interface RustDesktopEngineClientOptions {
  transport: RustDesktopEngineTransport;
}

interface JsonLineEngineTransportOptions {
  command: RustDesktopEngineCommand;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  reject(error: Error): void;
  resolve(value: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

export class RustDesktopEngineClient {
  private startPromise: Promise<void> | null = null;

  constructor(private readonly options: RustDesktopEngineClientOptions) {}

  start(): Promise<void> {
    this.startPromise ??= this.startEngine();
    return this.startPromise;
  }

  async stop(): Promise<void> {
    await this.options.transport.stop();
    this.startPromise = null;
  }

  async exchangeGoogleOauthCode(input: {
    clientId: string;
    code: string;
    codeVerifier: string;
    expectedNonce: string;
    redirectUri: string;
  }): Promise<{ idToken: string }> {
    await this.start();
    return GoogleOauthExchangeResponseSchema.parse(
      await this.options.transport.request(
        'oauth.google_exchange',
        input,
        VOICE_REQUEST_TIMEOUT_MS,
      ),
    );
  }

  async transcribeVoice(
    input: RustVoiceTranscriptionInput,
  ): Promise<RustVoiceResponse> {
    await this.start();
    return RustVoiceResponseSchema.parse(
      await this.options.transport.request(
        'voice.transcribe',
        input,
        VOICE_REQUEST_TIMEOUT_MS,
      ),
    );
  }

  async validateVoiceCredential(apiKey: string): Promise<RustVoiceResponse> {
    await this.start();
    return RustVoiceResponseSchema.parse(
      await this.options.transport.request(
        'voice.validate_credential',
        { apiKey },
        VOICE_REQUEST_TIMEOUT_MS,
      ),
    );
  }

  private async startEngine(): Promise<void> {
    await this.options.transport.start();
    EngineHealthSchema.parse(
      await this.options.transport.request('health', {}, STARTUP_TIMEOUT_MS),
    );
  }
}

export class JsonLineEngineTransport implements RustDesktopEngineTransport {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private stderr = '';

  constructor(private readonly options: JsonLineEngineTransportOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(
      this.options.command.executable,
      this.options.command.args,
      {
        cwd: this.options.command.cwd,
        env: process.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.consume(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4_000);
    });
    child.once('error', (error) => this.fail(error));
    child.once('exit', (code, signal) => {
      this.fail(new Error(
        `Rust desktop engine exited (${code ?? signal ?? 'unknown'}).${
          this.stderr ? ` ${this.stderr.trim()}` : ''
        }`,
      ));
    });
    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off('error', onError);
        resolve();
      };
      const onError = (error: Error): void => {
        child.off('spawn', onSpawn);
        reject(error);
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  request(
    method: string,
    params: unknown,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<unknown> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.killed) {
      return Promise.reject(new Error('The Rust desktop engine is not running.'));
    }
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Rust desktop engine ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { reject, resolve, timer });
      child.stdin.write(
        `${JSON.stringify({ id, method, params })}\n`,
        'utf8',
        (error) => {
          if (!error) return;
          const pending = this.pending.get(id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(id);
          pending.reject(error);
        },
      );
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.buffer = '';
    this.stderr = '';
    this.rejectPending(new Error('The Rust desktop engine stopped.'));
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    child.kill('SIGTERM');
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_PROTOCOL_BUFFER) {
      this.fail(new Error('The Rust desktop engine returned an oversized response.'));
      return;
    }
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.fail(new Error('The Rust desktop engine returned malformed JSON.'));
        return;
      }
      const response = EngineResponseSchema.safeParse(parsed);
      if (!response.success || !response.data.id) {
        this.fail(new Error('The Rust desktop engine returned an invalid response.'));
        return;
      }
      const pending = this.pending.get(response.data.id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(response.data.id);
      if (response.data.ok) pending.resolve(response.data.result);
      else pending.reject(new Error(response.data.error.message));
    }
  }

  private fail(error: Error): void {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && !child.killed) child.kill('SIGTERM');
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function resolveRustDesktopEngineCommand({
  cargoExecutable = 'cargo',
  enginePath,
  isPackaged,
  platform = process.platform,
  repositoryRoot,
  resourcesPath,
}: ResolveEngineCommandOptions): RustDesktopEngineCommand {
  if (enginePath) {
    if (!path.isAbsolute(enginePath)) {
      throw new Error('TROCODE_DESKTOP_ENGINE_PATH must be absolute.');
    }
    return { executable: enginePath, args: ['desktop-engine'] };
  }
  if (isPackaged) {
    return {
      executable: path.join(
        resourcesPath,
        platform === 'win32' ? 'trocode-api.exe' : 'trocode-api',
      ),
      args: ['desktop-engine'],
    };
  }
  return {
    executable: cargoExecutable,
    args: [
      'run',
      '--quiet',
      '--manifest-path',
      path.join(repositoryRoot, 'services/api/Cargo.toml'),
      '--locked',
      '--bin',
      'trocode-api',
      '--',
      'desktop-engine',
    ],
    cwd: repositoryRoot,
  };
}

export function createRustDesktopEngineClient(
  options: ResolveEngineCommandOptions,
): RustDesktopEngineClient {
  return new RustDesktopEngineClient({
    transport: new JsonLineEngineTransport({
      command: resolveRustDesktopEngineCommand(options),
    }),
  });
}
