import { EventEmitter } from 'node:events';

import {
  BeginDesktopExecutionRequestV5Schema,
  DesktopInvocationV5Schema,
  DesktopResultV5Schema,
  DesktopWorkerSessionV5Schema,
  PermissionDecisionRequestV5Schema,
  PermissionWaitRequestV5Schema,
  type DesktopInvocationV5,
  type DesktopResultV5,
  type DesktopWorkerCapabilitiesV5,
  type PermissionDecisionRequestV5,
  type PermissionWaitRequestV5,
} from '../../shared/agent-runtime-protocol';

export interface DesktopWorkerClientOptions {
  accessTokenProvider(): Promise<string | null>;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  heartbeatMs?: number;
  reconnectDelay?: (attempt: number) => number;
}

function parseSseBlocks(buffer: string): { blocks: string[]; remainder: string } {
  const normalized = buffer.replaceAll('\r\n', '\n');
  const parts = normalized.split('\n\n');
  return { blocks: parts.slice(0, -1), remainder: parts.at(-1) ?? '' };
}

function dataFromBlock(block: string): string | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  return data || null;
}

export class DesktopWorkerClient extends EventEmitter {
  private readonly accessTokenProvider: DesktopWorkerClientOptions['accessTokenProvider'];
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly heartbeatMs: number;
  private readonly reconnectDelay: NonNullable<DesktopWorkerClientOptions['reconnectDelay']>;
  private controller: AbortController | null = null;
  private capabilities: unknown;
  private workerSessionId: string | null = null;

  constructor(options: DesktopWorkerClientOptions) {
    super();
    this.accessTokenProvider = options.accessTokenProvider;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.heartbeatMs = options.heartbeatMs ?? 10_000;
    this.reconnectDelay = options.reconnectDelay ?? ((attempt) => Math.min(5_000, 250 * 2 ** Math.min(attempt, 5)) + Math.floor(Math.random() * 250));
  }

  async start(capabilities: DesktopWorkerCapabilitiesV5): Promise<void> {
    if (this.controller) return;
    this.controller = new AbortController();
    this.capabilities = capabilities;
    try {
      await this.connect(this.controller.signal);
      void this.runLoop(this.controller.signal);
      void this.heartbeatLoop(this.controller.signal);
    } catch (error) {
      this.controller = null;
      this.workerSessionId = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const controller = this.controller;
    const workerSessionId = this.workerSessionId;
    this.controller = null;
    this.workerSessionId = null;
    controller?.abort();
    if (!workerSessionId) return;
    const token = await this.accessTokenProvider().catch(() => null);
    if (!token) return;
    await this.fetchImpl(`${this.apiBaseUrl}/v1/desktop-worker/${workerSessionId}/disconnect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }

  async requestExecuting(
    invocationId: string,
    expectedRunVersion: number,
  ): Promise<boolean> {
    const response = await this.workerPost(
      'executing',
      BeginDesktopExecutionRequestV5Schema.parse({
        invocationId,
        expectedRunVersion,
      }),
    );
    return response?.kind === 'executing';
  }

  async commitResult(input: DesktopResultV5): Promise<void> {
    const result = DesktopResultV5Schema.parse(input);
    const response = await this.workerPost('result', result);
    if (response?.kind !== 'committed' && response?.kind !== 'stale') {
      throw new Error('Desktop result was not accepted by the backend.');
    }
  }

  async requestPermissionWait(
    input: PermissionWaitRequestV5,
  ): Promise<{ interactionId: string; kind: 'waiting'; runVersion: number }> {
    const response = await this.workerPost(
      'permission-wait',
      PermissionWaitRequestV5Schema.parse(input),
    );
    if (
      response.kind !== 'waiting' ||
      typeof response.interactionId !== 'string' ||
      typeof response.runVersion !== 'number'
    ) {
      throw new Error('Computer-permission wait was not recorded.');
    }
    return response as {
      interactionId: string;
      kind: 'waiting';
      runVersion: number;
    };
  }

  async decidePermission(
    input: PermissionDecisionRequestV5,
  ): Promise<{ kind: 'ready' | 'committed'; runVersion: number }> {
    const response = await this.workerPost(
      'permission-decision',
      PermissionDecisionRequestV5Schema.parse(input),
    );
    if (
      !['ready', 'committed'].includes(String(response.kind)) ||
      typeof response.runVersion !== 'number'
    ) {
      throw new Error('Computer-permission decision was not accepted.');
    }
    return response as { kind: 'ready' | 'committed'; runVersion: number };
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    let attempt = 0;
    while (!signal.aborted && this.workerSessionId) {
      try {
        await this.consumeEvents(signal);
        attempt = 0;
      } catch (error) {
        if (signal.aborted) return;
        this.emit('transport-error', error);
        attempt += 1;
        if (error instanceof StaleWorkerSessionError) {
          await this.connect(signal).catch((connectError: unknown) => {
            this.emit('transport-error', connectError);
          });
        }
        await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay(attempt)));
      }
    }
  }

  private async consumeEvents(signal: AbortSignal): Promise<void> {
    const token = await this.requireToken();
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/v1/desktop-worker/events?workerSessionId=${encodeURIComponent(String(this.workerSessionId))}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal },
    );
    if (response.status === 409) throw new StaleWorkerSessionError();
    if (!response.ok || !response.body) throw new Error(`Desktop worker event stream failed (${response.status}).`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) throw new Error('Desktop worker event stream disconnected.');
      pending += decoder.decode(value, { stream: true });
      const parsed = parseSseBlocks(pending);
      pending = parsed.remainder;
      for (const block of parsed.blocks) {
        const data = dataFromBlock(block);
        if (!data) continue;
        const invocation = DesktopInvocationV5Schema.parse(JSON.parse(data));
        this.emit('invocation', invocation satisfies DesktopInvocationV5);
      }
    }
  }

  private async heartbeatLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, this.heartbeatMs));
      if (signal.aborted) return;
      await this.workerPost('heartbeat', {}).catch((error: unknown) => {
        if (!signal.aborted) this.emit('transport-error', error);
      });
    }
  }

  private async workerPost(operation: string, body: unknown): Promise<Record<string, unknown>> {
    if (!this.workerSessionId) throw new Error('Desktop worker is not connected.');
    const token = await this.requireToken();
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/v1/desktop-worker/${this.workerSessionId}/${operation}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error(`Desktop worker ${operation} failed (${response.status}).`);
    return await response.json() as Record<string, unknown>;
  }

  private async connect(signal: AbortSignal): Promise<void> {
    const token = await this.requireToken();
    const response = await this.fetchImpl(`${this.apiBaseUrl}/v1/desktop-worker/connect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(this.capabilities),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Desktop worker connection failed (${response.status}).`);
    }
    const session = DesktopWorkerSessionV5Schema.parse(await response.json());
    this.workerSessionId = session.id;
  }

  private async requireToken(): Promise<string> {
    const token = await this.accessTokenProvider();
    if (!token) throw new Error('Sign in before connecting the desktop worker.');
    return token;
  }
}

class StaleWorkerSessionError extends Error {
  constructor() {
    super('Desktop worker session expired; reconnecting.');
    this.name = 'StaleWorkerSessionError';
  }
}
