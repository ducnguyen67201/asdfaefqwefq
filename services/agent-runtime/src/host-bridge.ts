import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  LocalAgentHostMessageSchema,
  type LocalAgentChildMessage,
  type LocalAgentHostMessage,
} from './protocol.js';

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): this;
  postMessage(value: unknown): void;
}

interface PendingResponse {
  readonly reject: (error: Error) => void;
  readonly resolve: (message: LocalAgentHostMessage) => void;
}

interface HostRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Typed bidirectional bridge; credentials never leave this process over logs. */
export class HostBridge extends EventEmitter {
  private readonly pending = new Map<string, PendingResponse>();
  private readonly sequences = new Map<string, number>();

  constructor(private readonly port: ParentPortLike) {
    super();
    port.on('message', (event) => this.receive(event.data));
  }

  send(message: LocalAgentChildMessage): void {
    this.port.postMessage(message);
  }

  nextSequence(turnId: string): number {
    const next = (this.sequences.get(turnId) ?? 0) + 1;
    this.sequences.set(turnId, next);
    return next;
  }

  request<T extends LocalAgentChildMessage>(
    message: T,
    options: HostRequestOptions = {},
  ): Promise<LocalAgentHostMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(() => reject(new Error('host_protocol_request_timed_out'))),
        options.timeoutMs ?? 30_000,
      );
      const abort = (): void => finish(() => reject(new Error('host_protocol_request_cancelled')));
      const finish = (complete: () => void): void => {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        this.pending.delete(message.requestId);
        complete();
      };
      this.pending.set(message.requestId, {
        resolve: (response) => finish(() => resolve(response)),
        reject: (error) => finish(() => reject(error)),
      });
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      this.send(message);
    });
  }

  failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private receive(input: unknown): void {
    const parsed = LocalAgentHostMessageSchema.safeParse(input);
    if (!parsed.success) {
      this.failPending(new Error('invalid_host_protocol_message'));
      this.emit('protocol-error', parsed.error);
      return;
    }
    const message = parsed.data;
    if ('responseTo' in message) {
      const pending = this.pending.get(message.responseTo);
      if (!pending) {
        this.emit('protocol-error', new Error('unexpected_host_response'));
        return;
      }
      pending.resolve(message);
      return;
    }
    this.emit('message', message);
  }
}

export function childRequestId(): string {
  return randomUUID();
}

export function electronParentPort(): ParentPortLike {
  const candidate = (process as NodeJS.Process & { parentPort?: ParentPortLike | null }).parentPort;
  if (!candidate) throw new Error('agent_runtime_requires_electron_utility_process');
  return candidate;
}
