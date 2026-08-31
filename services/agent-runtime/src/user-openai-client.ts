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

/** Routes the SDK through Rust's authenticated provider/accounting boundary. */
export class UserOpenAIClientFactory {
  constructor(
    private readonly apiBaseUrl: () => string,
    private readonly credential: EphemeralCredentialStore,
  ) {}

  create(identity: LocalModelIdentity): UserModelClients {
    const authenticatedFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${this.credential.require()}`);
      headers.set('x-trocode-agent-turn-id', identity.agentTurnId);
      headers.set('x-trocode-task-id', identity.taskId);
      headers.set('x-trocode-request-id', randomUUID());
      return fetch(input, { ...init, headers });
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
