import { randomUUID } from 'node:crypto';

import { OpenAIProvider } from '@openai/agents';
import OpenAI from 'openai';

export class EphemeralCredentialStore {
  private value: string | null = null;

  replace(value: string): void { this.value = value; }
  clear(): void { this.value = null; }
  require(): string {
    if (!this.value) throw new Error('agent_runtime_credential_unavailable');
    return this.value;
  }
}

export interface LocalModelIdentity {
  readonly agentTurnId: string;
  readonly taskId: string;
}

export interface UserModelClients {
  readonly openai: OpenAI;
  readonly provider: OpenAIProvider;
}

export type ModelRequestEvent =
  | 'model_request_started'
  | 'model_request_completed'
  | 'model_request_rejected'
  | 'model_request_failed';

export interface ModelRequestDiagnostic {
  readonly agentTurnId: string;
  readonly clientRequestId: string;
  readonly durationMs: number | null;
  readonly event: ModelRequestEvent;
  readonly inputItemCount: number | null;
  readonly model: string | null;
  readonly serverRequestId: string | null;
  readonly status: number | null;
  readonly taskId: string;
  readonly toolChoice: string | null;
  readonly toolCount: number | null;
}

export type ModelRequestDiagnosticSink = (diagnostic: ModelRequestDiagnostic) => void;

interface RequestSummary {
  readonly inputItemCount: number | null;
  readonly model: string | null;
  readonly toolChoice: string | null;
  readonly toolCount: number | null;
}

function boundedLabel(value: unknown, maxLength = 128): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function summarizeToolChoice(value: unknown): string | null {
  const direct = boundedLabel(value, 32);
  if (direct) return direct;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const choice = value as Record<string, unknown>;
  const type = boundedLabel(choice.type, 32);
  const name = boundedLabel(choice.name, 64);
  return type === 'function' && name ? `function:${name}` : type;
}

function summarizeRequest(body: BodyInit | null | undefined): RequestSummary {
  const empty: RequestSummary = {
    inputItemCount: null,
    model: null,
    toolChoice: null,
    toolCount: null,
  };
  if (typeof body !== 'string') return empty;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
    const request = parsed as Record<string, unknown>;
    return {
      inputItemCount: Array.isArray(request.input) ? request.input.length : null,
      model: boundedLabel(request.model),
      toolChoice: summarizeToolChoice(request.tool_choice),
      toolCount: Array.isArray(request.tools) ? request.tools.length : null,
    };
  } catch {
    return empty;
  }
}

function emitDiagnostic(
  sink: ModelRequestDiagnosticSink,
  diagnostic: ModelRequestDiagnostic,
): void {
  try {
    sink(diagnostic);
  } catch {
    // Diagnostics must never change model request behavior.
  }
}

/** Routes the SDK through Rust's authenticated provider/accounting boundary. */
export class UserOpenAIClientFactory {
  constructor(
    private readonly apiBaseUrl: () => string,
    private readonly credential: EphemeralCredentialStore,
  ) {}

  create(
    identity: LocalModelIdentity,
    onDiagnostic: ModelRequestDiagnosticSink = () => undefined,
  ): UserModelClients {
    const authenticatedFetch: typeof fetch = async (input, init) => {
      const clientRequestId = randomUUID();
      const startedAt = Date.now();
      const summary = summarizeRequest(init?.body);
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${this.credential.require()}`);
      headers.set('x-trocode-agent-turn-id', identity.agentTurnId);
      headers.set('x-trocode-task-id', identity.taskId);
      headers.set('x-trocode-request-id', clientRequestId);
      const base = {
        agentTurnId: identity.agentTurnId,
        clientRequestId,
        inputItemCount: summary.inputItemCount,
        model: summary.model,
        taskId: identity.taskId,
        toolChoice: summary.toolChoice,
        toolCount: summary.toolCount,
      } as const;
      emitDiagnostic(onDiagnostic, {
        ...base,
        durationMs: null,
        event: 'model_request_started',
        serverRequestId: null,
        status: null,
      });
      try {
        const response = await fetch(input, { ...init, headers });
        emitDiagnostic(onDiagnostic, {
          ...base,
          durationMs: Date.now() - startedAt,
          event: response.ok ? 'model_request_completed' : 'model_request_rejected',
          serverRequestId: boundedLabel(response.headers.get('x-request-id')),
          status: response.status,
        });
        return response;
      } catch (error) {
        emitDiagnostic(onDiagnostic, {
          ...base,
          durationMs: Date.now() - startedAt,
          event: 'model_request_failed',
          serverRequestId: null,
          status: null,
        });
        throw error;
      }
    };
    const openai = new OpenAI({
      apiKey: this.credential.require(),
      baseURL: `${this.apiBaseUrl().replace(/\/+$/u, '')}/v1/openai`,
      fetch: authenticatedFetch,
      maxRetries: 0,
    });
    return {
      openai,
      provider: new OpenAIProvider({ openAIClient: openai, useResponses: true }),
    };
  }
}
