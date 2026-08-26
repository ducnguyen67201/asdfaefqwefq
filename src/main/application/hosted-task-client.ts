import { randomUUID } from 'node:crypto';

import manifest from '../../../protocol/agent-runtime.v3.manifest.json';
import {
  AgentRuntimeErrorV3Schema,
  AgentRuntimeStatusV3Schema,
  AgentTaskEventV3Schema,
  AgentTaskListV3Schema,
  AgentTaskRecordV3Schema,
  type AgentTaskEventV3,
  type AgentTaskRecordV3,
} from '../../shared/agent-runtime-protocol';
import {
  HostedTaskEventSchema,
  HostedTaskListSchema,
  HostedTaskRecordSchema,
  type HostedTaskEvent,
  type HostedTaskRecord,
  TaskSnapshotSchema,
  type TaskSnapshot,
} from '../../shared/contracts';
import { legacyTaskPhaseForHostedState } from '../../shared/legacy-agent-runtime-v2';

export function projectHostedTask(
  run: HostedTaskRecord,
  event?: HostedTaskEvent,
  previous?: TaskSnapshot,
): TaskSnapshot {
  const timestamp = event?.createdAt ?? run.updatedAt;
  const lifecycle = event?.lifecycle ?? run.lifecycle ?? null;
  const phase = lifecycle?.phase ?? legacyTaskPhaseForHostedState(run.state);
  const messages = previous?.messages ?? [{
    messageId: run.clientTaskId,
    taskId: run.taskId,
    role: 'user' as const,
    kind: 'request' as const,
    text: run.request,
    timestamp: run.createdAt,
  }];
  const withFinal = event?.finalOutput
    ? [...messages, {
        messageId: event.id,
        taskId: run.taskId,
        role: 'assistant' as const,
        kind: 'answer' as const,
        text: event.finalOutput,
        timestamp,
      }]
    : messages;
  const lastEvent = event ? {
    eventId: event.id,
    taskId: run.taskId,
    phase,
    timestamp,
    status: phase === 'failed' ? 'error' as const : phase === 'blocked' ? 'warning' as const : 'success' as const,
    summary: event.finalOutput ?? event.summary,
    nextActions: phase === 'paused' ? ['Keep Tro signed in so the desktop worker can reconnect.'] : [],
    artifacts: [],
  } : null;
  const outcomes = event?.outcomes && event.outcomeRevision
    ? {
        contractRevision: event.outcomeRevision,
        criterionResults: event.outcomes.map((outcome) => ({
          criterionId: outcome.criterionId,
          status: outcome.status,
          evidenceIds: [],
        })),
        evidence: previous?.outcomes?.evidence ?? [],
      }
    : previous?.outcomes ?? null;
  const approvalWait = lifecycle?.waitingOn?.kind === 'approval'
    ? lifecycle.waitingOn
    : null;
  const pendingInteraction = approvalWait
    ? {
        id: approvalWait.interactionId,
        taskId: run.taskId,
        kind: 'approval' as const,
        prompt: approvalWait.consequence,
        consequence: approvalWait.consequence,
        actionDigest: approvalWait.actionDigest,
        action: approvalWait.action,
        createdAt: approvalWait.since,
        expiresAt: approvalWait.expiresAt,
      }
    : previous?.pendingInteraction?.kind === 'approval'
      ? null
      : previous?.pendingInteraction ?? null;
  return TaskSnapshotSchema.parse({
    taskId: run.taskId,
    request: run.request,
    phase,
    lifecycle,
    goal: previous?.goal ?? null,
    messages: withFinal.slice(-200),
    pendingInteraction,
    approvalGrant: null,
    progress: previous?.progress ?? null,
    outcomes,
    queuedSteering: [],
    runtimeResume: null,
    createdAt: run.createdAt,
    updatedAt: timestamp,
    lastEvent,
  });
}

function legacyRecordFromV3(run: AgentTaskRecordV3): HostedTaskRecord {
  return HostedTaskRecordSchema.parse({
    id: run.id,
    taskId: run.taskId,
    clientTaskId: run.clientTaskId,
    request: run.request,
    executionProfile: run.executionProfile,
    workspaceSelectionId: run.workspaceSelectionId,
    state: run.projection.state,
    protocolVersion: run.protocolVersion,
    protocolDigest: run.protocolDigest,
    toolCatalogDigest: run.toolCatalogDigest,
    runVersion: run.projection.runVersion,
    outcomeRevision: run.outcomeRevision,
    publicSummary: run.publicSummary,
    contractSchemaVersion: run.authorityContract.schemaVersion,
    autonomyMode: run.authorityContract.autonomyMode,
    outcomeContract: run.authorityContract.outcomeContract,
    intentAuthorization: run.authorityContract.intentAuthorization,
    contract: run.authorityContract,
    activity: run.authorityContract.activity,
    lifecycle: run.projection,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    newlyCreated: run.newlyCreated,
  });
}

function legacyEventFromV3(event: AgentTaskEventV3): HostedTaskEvent {
  return HostedTaskEventSchema.parse({
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    runVersion: event.projection.runVersion,
    type: event.eventType,
    summary: event.summary,
    ...(event.finalOutput ? { finalOutput: event.finalOutput } : {}),
    ...(event.outcomeRevision ? { outcomeRevision: event.outcomeRevision } : {}),
    outcomes: event.outcomes,
    lifecycle: event.projection,
    createdAt: event.createdAt,
  });
}

export interface HostedTaskClientOptions {
  accessTokenProvider(): Promise<string | null>;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  reconnectDelay?: (attempt: number) => number;
}

class HostedRequestError extends Error {
  constructor(
    message: string,
    readonly outcomeUnknown: boolean,
    readonly status: number | null = null,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

export class HostedTaskOutcomeUnknownError extends Error {
  constructor(cause: unknown) {
    super('The hosted task may have started, but Tro could not recover its response.');
    this.cause = cause;
  }
}

function eventDataFromBlock(block: string): unknown | null {
  const data = block
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  return data ? JSON.parse(data) : null;
}

export class HostedTaskClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly reconnectDelay: NonNullable<HostedTaskClientOptions['reconnectDelay']>;
  private readonly v3RunIds = new Set<string>();

  constructor(private readonly options: HostedTaskClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.reconnectDelay = options.reconnectDelay ?? ((attempt) =>
      Math.min(5_000, 250 * 2 ** Math.min(attempt, 5)) + Math.floor(Math.random() * 250));
  }

  async submit(input: {
    clientTaskId: string;
    taskId: string;
    request: string;
    autonomyMode: 'balanced' | 'strict';
    executionProfile: 'everyday' | 'workspace';
    workspaceSelectionId: string | null;
    activityAttemptId: string | null;
    activityIntent: 'work' | 'help' | 'check';
  }): Promise<HostedTaskRecord> {
    const submitOnce = async () => {
      try {
        const run = AgentTaskRecordV3Schema.parse(await this.json('/v1/agent-runtime/v3/tasks', {
          method: 'POST',
          body: JSON.stringify({
            protocolVersion: 3,
            protocolDigest: manifest.protocolDigest,
            toolCatalogDigest: manifest.toolCatalogDigest,
            ...input,
          }),
        }));
        this.v3RunIds.add(run.id);
        return legacyRecordFromV3(run);
      } catch (error) {
        if (error instanceof HostedRequestError) throw error;
        throw new HostedRequestError(
          error instanceof Error ? error.message : 'Hosted task response was invalid.',
          true,
        );
      }
    };
    try {
      return await submitOnce();
    } catch (error) {
      if (!(error instanceof HostedRequestError) || !error.outcomeUnknown) throw error;
      try {
        return await submitOnce();
      } catch (retryError) {
        if (retryError instanceof HostedRequestError && retryError.outcomeUnknown) {
          throw new HostedTaskOutcomeUnknownError(retryError);
        }
        throw retryError;
      }
    }
  }

  async status(): Promise<{
    enabled: boolean;
    protocolVersion: 2 | 3;
    workerRequired: boolean;
    protocolDigest?: string;
    toolCatalogDigest?: string;
    rolloutMode?: 'observe' | 'dual' | 'enforce';
  }> {
    try {
      const status = AgentRuntimeStatusV3Schema.parse(
        await this.json('/v1/agent-runtime/v3/status'),
      );
      if (
        status.protocolDigest !== manifest.protocolDigest ||
        status.toolCatalogDigest !== manifest.toolCatalogDigest
      ) {
        throw new Error(
          'Tro and the hosted runtime must be upgraded before starting new work.',
        );
      }
      return status;
    } catch (error) {
      if (!(error instanceof HostedRequestError) || error.status !== 404) {
        throw error;
      }
    }
    const legacy = await this.json('/v1/agent-runtime/status') as {
      enabled?: unknown;
      protocolVersion?: unknown;
      workerRequired?: unknown;
    };
    if (
      typeof legacy.enabled !== 'boolean' ||
      legacy.protocolVersion !== 2 ||
      typeof legacy.workerRequired !== 'boolean'
    ) {
      throw new Error('Hosted runtime status is incompatible with this desktop.');
    }
    return {
      enabled: legacy.enabled,
      protocolVersion: 2,
      workerRequired: legacy.workerRequired,
    };
  }

  async list(): Promise<HostedTaskRecord[]> {
    let v3: HostedTaskRecord[] = [];
    try {
      v3 = AgentTaskListV3Schema.parse(
        await this.json('/v1/agent-runtime/v3/tasks'),
      ).items.map((run) => {
        this.v3RunIds.add(run.id);
        return legacyRecordFromV3(run);
      });
    } catch (error) {
      if (!(error instanceof HostedRequestError) || error.status !== 404) {
        throw error;
      }
    }
    const legacy = HostedTaskListSchema.parse(await this.json('/v1/tasks')).items;
    const v3Ids = new Set(v3.map((run) => run.id));
    return [...v3, ...legacy.filter((run) => !v3Ids.has(run.id))];
  }

  async get(runId: string): Promise<HostedTaskRecord> {
    try {
      const run = AgentTaskRecordV3Schema.parse(
        await this.json(`/v1/agent-runtime/v3/tasks/${runId}`),
      );
      this.v3RunIds.add(run.id);
      return legacyRecordFromV3(run);
    } catch (error) {
      if (!(error instanceof HostedRequestError) || error.status !== 404) {
        throw error;
      }
    }
    return HostedTaskRecordSchema.parse(await this.json(`/v1/tasks/${runId}`));
  }

  async cancel(
    runId: string,
    expectedRunVersion?: number,
    source: 'stop_button' | 'focused_escape' | 'replacement' | 'sign_out' | 'shutdown' = 'stop_button',
  ): Promise<HostedTaskRecord> {
    if (this.v3RunIds.has(runId) && expectedRunVersion) {
      try {
        return legacyRecordFromV3(
          AgentTaskRecordV3Schema.parse(
            await this.json(`/v1/agent-runtime/v3/tasks/${runId}/cancel`, {
              method: 'POST',
              body: JSON.stringify({
                protocolVersion: 3,
                protocolDigest: manifest.protocolDigest,
                toolCatalogDigest: manifest.toolCatalogDigest,
                clientCommandId: randomUUID(),
                expectedRunVersion,
                source,
              }),
            }),
          ),
        );
      } catch (error) {
        if (
          error instanceof HostedRequestError &&
          error.status === 409 &&
          ['stale_run_version', 'run_not_cancellable'].includes(error.code ?? '')
        ) {
          return await this.get(runId);
        }
        throw error;
      }
    }
    return HostedTaskRecordSchema.parse(
      await this.json(`/v1/tasks/${runId}`, { method: 'DELETE' }),
    );
  }

  async steer(runId: string, clientTurnId: string, instruction: string): Promise<void> {
    await this.json(`/v1/tasks/${runId}/steering`, {
      method: 'POST',
      body: JSON.stringify({ clientTurnId, instruction }),
    });
  }

  async decideApproval(
    runId: string,
    input: { interactionId: string; actionDigest: string; decision: 'approve' | 'deny' },
    expectedRunVersion?: number,
  ): Promise<void> {
    const v3 = this.v3RunIds.has(runId) && expectedRunVersion;
    await this.json(`${v3 ? '/v1/agent-runtime/v3/tasks' : '/v1/tasks'}/${runId}/approval`, {
      method: 'POST',
      body: JSON.stringify(v3 ? {
        ...input,
        clientCommandId: randomUUID(),
        expectedRunVersion,
      } : input),
    });
  }

  async subscribe(
    runId: string,
    onEvent: (event: HostedTaskEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let afterSequence = 0;
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const token = await this.requireToken();
        const v3 = this.v3RunIds.has(runId);
        const response = await this.fetchImpl(
          `${this.apiBaseUrl}${v3 ? '/v1/agent-runtime/v3/tasks' : '/v1/tasks'}/${runId}/events?after=${afterSequence}`,
          {
            headers: {
              Accept: 'text/event-stream',
              Authorization: `Bearer ${token}`,
              ...(afterSequence > 0 ? { 'Last-Event-ID': String(afterSequence) } : {}),
            },
            signal,
          },
        );
        if (!response.ok || !response.body) throw new Error(`Task event stream failed (${response.status}).`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
          const blocks = pending.split('\n\n');
          pending = blocks.pop() ?? '';
          for (const block of blocks) {
            const data = eventDataFromBlock(block);
            const event = data
              ? v3
                ? legacyEventFromV3(AgentTaskEventV3Schema.parse(data))
                : HostedTaskEventSchema.parse(data)
              : null;
            if (!event || event.sequence <= afterSequence) continue;
            afterSequence = event.sequence;
            onEvent(event);
          }
        }
        attempt = 0;
      } catch {
        if (signal.aborted) return;
        attempt += 1;
      }
      if (!signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay(attempt)));
      }
    }
  }

  private async json(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.requireToken();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new HostedRequestError(
        error instanceof Error ? error.message : 'Hosted task request did not return.',
        true,
      );
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as unknown;
      const v3Error = AgentRuntimeErrorV3Schema.safeParse(body);
      const legacy = body as { code?: string; error?: string } | null;
      throw new HostedRequestError(
        v3Error.success
          ? v3Error.data.message
          : legacy?.error ?? `Hosted task request failed (${response.status}).`,
        response.status >= 500,
        response.status,
        v3Error.success ? v3Error.data.code : legacy?.code ?? null,
      );
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch (error) {
      throw new HostedRequestError(
        error instanceof Error ? error.message : 'Hosted task response was invalid.',
        true,
      );
    }
  }

  private async requireToken(): Promise<string> {
    const token = await this.options.accessTokenProvider();
    if (!token) throw new Error('Sign in before starting a hosted task.');
    return token;
  }
}
