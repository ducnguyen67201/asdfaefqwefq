import { randomUUID } from 'node:crypto';

import { OpenAIProvider } from '@openai/agents';
import OpenAI from 'openai';

import type { RuntimeConfig } from './config.js';

export interface BrokerIdentity {
  readonly runId: string;
  readonly workerId: string;
}

export interface BrokeredModelClients {
  readonly openai: OpenAI;
  readonly provider: OpenAIProvider;
}

export class BrokeredOpenAIClientFactory {
  constructor(private readonly config: RuntimeConfig) {}

  create(identity: BrokerIdentity): BrokeredModelClients {
    const brokerFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('x-trocode-agent-run-id', identity.runId);
      headers.set('x-trocode-orchestrator-worker-id', identity.workerId);
      headers.set('x-trocode-request-id', randomUUID());
      return fetch(input, { ...init, headers });
    };
    const openai = new OpenAI({
      apiKey: this.config.serviceToken,
      baseURL: `${this.config.apiBaseUrl}/internal/agent-orchestrator/v1/openai/v1`,
      fetch: brokerFetch,
      maxRetries: 0,
    });
    return {
      openai,
      provider: new OpenAIProvider({ openAIClient: openai, useResponses: true }),
    };
  }
}
