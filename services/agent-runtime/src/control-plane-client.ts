import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { RuntimeConfig } from './config.js';
import {
  ApplySessionTransactionResponseSchema,
  ClaimRunResponseSchema,
  PutCheckpointResponseSchema,
  QueueToolCallResponseSchema,
  RunLeaseResponseSchema,
  RunMutationResponseSchema,
  SessionItemsResponseSchema,
  SteeringUpdatesResponseSchema,
  ToolCallResultSchema,
  WorkerHeartbeatResponseSchema,
  WorkerRegistrationResponseSchema,
  type ApplySessionTransactionRequest,
  type ClaimedRun,
  type PutCheckpointRequest,
  type QueueToolCallRequest,
  type SessionItemsResponse,
  type SteeringUpdate,
  type ToolCallResult,
} from './protocol.js';

const ErrorSchema = z
  .object({
    code: z.string().max(100).optional(),
    error: z.string().max(1_000).optional(),
    message: z.string().max(1_000).optional(),
    retryable: z.boolean().optional(),
  })
  .passthrough();

export class ControlPlaneError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'ControlPlaneError';
  }
}

export class RunLease {
  private currentRunVersion: number;

  constructor(
    readonly runId: string,
    readonly workerId: string,
    runVersion: number,
  ) {
    this.currentRunVersion = runVersion;
  }

  get runVersion(): number {
    return this.currentRunVersion;
  }

  update(runVersion: number): void {
    if (runVersion < this.currentRunVersion) {
      throw new Error('run_version_regressed');
    }
    this.currentRunVersion = runVersion;
  }
}

export interface RegisteredWorker {
  readonly expiresAt: string;
  readonly workerId: string;
}

export class ControlPlaneClient {
  private readonly baseUrl: string;

  constructor(private readonly config: RuntimeConfig) {
    this.baseUrl = `${config.apiBaseUrl}/internal/agent-orchestrator/v1`;
  }

  async register(instanceId: string, signal?: AbortSignal): Promise<RegisteredWorker> {
    return this.request(
      'POST',
      '/workers/register',
      {
        instanceId,
        protocolVersion: 1,
        protocolDigest: this.config.orchestratorProtocolDigest,
        releaseVersion: this.config.releaseVersion,
        sdkVersion: this.config.sdkVersion,
        graphVersion: this.config.graphVersion,
      },
      WorkerRegistrationResponseSchema,
      signal,
    );
  }

  async heartbeat(workerId: string, signal?: AbortSignal): Promise<string> {
    const response = await this.request(
      'POST',
      `/workers/${encodeURIComponent(workerId)}/heartbeat`,
      { releaseVersion: this.config.releaseVersion },
      WorkerHeartbeatResponseSchema,
      signal,
    );
    return response.expiresAt;
  }

  async claim(workerId: string, signal?: AbortSignal): Promise<ClaimedRun | null> {
    const response = await this.request(
      'POST',
      '/runs/claim',
      {
        workerId,
        sdkVersion: this.config.sdkVersion,
        graphVersion: this.config.graphVersion,
      },
      ClaimRunResponseSchema,
      signal,
    );
    return response.run;
  }

  async renew(lease: RunLease, signal?: AbortSignal): Promise<void> {
    const response = await this.request(
      'POST',
      `/runs/${lease.runId}/lease`,
      {
        workerId: lease.workerId,
        expectedRunVersion: lease.runVersion,
        action: 'renew',
      },
      RunLeaseResponseSchema,
      signal,
    );
    lease.update(response.runVersion);
  }

  async release(lease: RunLease, signal?: AbortSignal): Promise<void> {
    const response = await this.request(
      'POST',
      `/runs/${lease.runId}/lease`,
      {
        workerId: lease.workerId,
        expectedRunVersion: lease.runVersion,
        action: 'release',
      },
      RunLeaseResponseSchema,
      signal,
    );
    lease.update(response.runVersion);
  }

  getSession(lease: RunLease, signal?: AbortSignal): Promise<SessionItemsResponse> {
    const query = new URLSearchParams({
      workerId: lease.workerId,
      expectedRunVersion: String(lease.runVersion),
    });
    return this.request(
      'GET',
      `/runs/${lease.runId}/session?${query.toString()}`,
      undefined,
      SessionItemsResponseSchema,
      signal,
    );
  }

  steeringUpdates(
    lease: RunLease,
    afterSequence: number,
    signal?: AbortSignal,
  ): Promise<{ readonly items: SteeringUpdate[] }> {
    const query = new URLSearchParams({
      workerId: lease.workerId,
      expectedRunVersion: String(lease.runVersion),
      afterSequence: String(afterSequence),
    });
    return this.request(
      'GET',
      `/runs/${lease.runId}/steering?${query.toString()}`,
      undefined,
      SteeringUpdatesResponseSchema,
      signal,
    );
  }

  async applySessionTransaction(
    lease: RunLease,
    request: Omit<ApplySessionTransactionRequest, 'workerId' | 'expectedRunVersion'>,
    signal?: AbortSignal,
  ): Promise<{ readonly replayed: boolean; readonly revision: number }> {
    return this.request(
      'POST',
      `/runs/${lease.runId}/session/transactions`,
      {
        ...request,
        workerId: lease.workerId,
        expectedRunVersion: lease.runVersion,
      },
      ApplySessionTransactionResponseSchema,
      signal,
    );
  }

  async putCheckpoint(
    lease: RunLease,
    request: Omit<PutCheckpointRequest, 'workerId' | 'expectedRunVersion'>,
    signal?: AbortSignal,
  ): Promise<number> {
    const response = await this.request(
      'PUT',
      `/runs/${lease.runId}/checkpoint`,
      {
        ...request,
        workerId: lease.workerId,
        expectedRunVersion: lease.runVersion,
      },
      PutCheckpointResponseSchema,
      signal,
    );
    lease.update(response.runVersion);
    return response.checkpointRevision;
  }

  async queueToolCall(
    lease: RunLease,
    request: Omit<QueueToolCallRequest, 'workerId' | 'expectedRunVersion'>,
    signal?: AbortSignal,
  ): Promise<{ readonly invocationId: string; readonly replayed: boolean }> {
    const response = await this.request(
      'POST',
      `/runs/${lease.runId}/tool-calls`,
      {
        ...request,
        workerId: lease.workerId,
        expectedRunVersion: lease.runVersion,
      },
      QueueToolCallResponseSchema,
      signal,
    );
    lease.update(response.runVersion);
    return response;
  }

  getToolResult(
    lease: RunLease,
    callId: string,
    signal?: AbortSignal,
  ): Promise<ToolCallResult> {
    const query = new URLSearchParams({ workerId: lease.workerId });
    return this.request(
      'GET',
      `/runs/${lease.runId}/tool-calls/${encodeURIComponent(callId)}?${query.toString()}`,
      undefined,
      ToolCallResultSchema,
      signal,
    );
  }

  async activity(
    lease: RunLease,
    sequence: number,
    kind: 'run_started' | 'status' | 'tool_started' | 'tool_completed',
    summary: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.request(
      'POST',
      `/runs/${lease.runId}/activity`,
      {
        workerId: lease.workerId,
        expectedRunVersion: lease.runVersion,
        sequence,
        kind,
        summary,
      },
      RunMutationResponseSchema,
      signal,
    );
    lease.update(response.runVersion);
  }

  async complete(
    lease: RunLease,
    finalOutput: string,
    appliedControlSequence: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.request(
      'POST',
      `/runs/${lease.runId}/complete`,
      {
        workerId: lease.workerId,
        expectedRunVersion: lease.runVersion,
        appliedControlSequence,
        finalOutput,
      },
      RunMutationResponseSchema,
      signal,
    );
    lease.update(response.runVersion);
  }

  async fail(
    lease: RunLease,
    failure: {
      readonly stage:
        | 'provider_request'
        | 'provider_dispatch'
        | 'tool_execution'
        | 'session'
        | 'runtime';
      readonly code:
        | 'provider_request_rejected'
        | 'provider_unavailable'
        | 'provider_outcome_unknown'
        | 'tool_outcome_unknown'
        | 'internal_runtime_error'
        | 'session_conflict'
        | 'graph_version_mismatch';
      readonly message: string;
      readonly retryable: boolean;
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await this.request(
      'POST',
      `/runs/${lease.runId}/fail`,
      {
        workerId: lease.workerId,
        expectedRunVersion: lease.runVersion,
        ...failure,
      },
      RunMutationResponseSchema,
      signal,
    );
    lease.update(response.runVersion);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.serviceToken}`,
        'content-type': 'application/json',
        'x-trocode-request-id': randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
    const text = await response.text();
    const value: unknown = text.length === 0 ? {} : JSON.parse(text);
    if (!response.ok) {
      const parsed = ErrorSchema.safeParse(value);
      throw new ControlPlaneError(
        response.status,
        parsed.success ? (parsed.data.code ?? 'internal_error') : 'invalid_response',
        parsed.success ? (parsed.data.retryable ?? false) : false,
        parsed.success
          ? (parsed.data.message ?? parsed.data.error ?? 'Control plane request failed.')
          : 'Control plane returned an invalid error response.',
      );
    }
    return schema.parse(value);
  }
}

export type AgentControlPlane = Pick<
  ControlPlaneClient,
  'applySessionTransaction' | 'getSession' | 'getToolResult'
>;

export type ToolCheckpointControlPlane = Pick<
  ControlPlaneClient,
  'putCheckpoint' | 'queueToolCall'
>;
