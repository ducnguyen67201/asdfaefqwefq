import { z } from 'zod';

import {
  ConnectorAttemptStatusSchema,
  ConnectorListSchema,
  type ConnectorAttemptStatus,
  type ConnectorList,
} from '../../shared/contracts';

const BeginResponseSchema = z.object({
  attempt: ConnectorAttemptStatusSchema,
  authorizationUrl: z.string().url().max(8_192),
}).strict();

const DisconnectResponseSchema = z.object({ disconnected: z.literal(true) }).strict();
const HostedErrorSchema = z.object({
  code: z.string().min(1).max(100).optional(),
  error: z.string().min(1).max(1_000),
}).passthrough();

export class ConnectorClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessTokenProvider: () => Promise<string | null>,
    private readonly openExternal: (url: string) => Promise<unknown>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  list(): Promise<ConnectorList> {
    return this.request('/v1/connectors', { method: 'GET' }, ConnectorListSchema);
  }

  async connect(catalogKey: string): Promise<ConnectorAttemptStatus> {
    const key = encodeCatalogKey(catalogKey);
    const started = await this.request(
      `/v1/connectors/${key}/attempts`,
      this.json('POST', {}),
      BeginResponseSchema,
    );
    const authorizationUrl = new URL(started.authorizationUrl);
    if (
      authorizationUrl.protocol !== 'https:' ||
      authorizationUrl.hostname !== 'accounts.google.com' ||
      authorizationUrl.pathname !== '/o/oauth2/v2/auth' ||
      authorizationUrl.username ||
      authorizationUrl.password
    ) {
      throw new Error('Connector service returned an untrusted authorization URL.');
    }
    await this.openExternal(authorizationUrl.toString());
    return started.attempt;
  }

  attempt(attemptId: string): Promise<ConnectorAttemptStatus> {
    return this.request(
      `/v1/connectors/attempts/${encodeURIComponent(z.string().uuid().parse(attemptId))}`,
      { method: 'GET' },
      ConnectorAttemptStatusSchema,
    );
  }

  async disconnect(connectionId: string): Promise<ConnectorList> {
    const id = encodeURIComponent(z.string().uuid().parse(connectionId));
    await this.request(
      `/v1/connectors/connections/${id}`,
      { method: 'DELETE' },
      DisconnectResponseSchema,
    );
    return this.list();
  }

  private json(method: string, body: unknown): RequestInit {
    return {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method,
    };
  }

  private async request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    const baseUrl = this.apiBaseUrl.trim().replace(/\/+$/u, '');
    if (!baseUrl) throw new Error('Connected applications require the hosted Tro service.');
    const token = await this.accessTokenProvider();
    if (!token) throw new Error('Sign in to manage connected applications.');
    const response = await this.fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = HostedErrorSchema.safeParse(body);
      throw new Error(error.success ? error.data.error : `Connector service returned HTTP ${response.status}.`);
    }
    return schema.parse(body);
  }
}

function encodeCatalogKey(value: string): string {
  const key = z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/u).parse(value);
  return encodeURIComponent(key);
}
