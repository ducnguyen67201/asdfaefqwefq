import {
  HostedTaskEventSchema,
  HostedTaskListSchema,
  HostedTaskRecordSchema,
  type HostedTaskEvent,
  type HostedTaskRecord,
  TaskSnapshotSchema,
  type TaskSnapshot,
} from '../../shared/contracts';

function phaseFor(state: HostedTaskRecord['state']): TaskSnapshot['phase'] {
  switch (state) {
    case 'queued':
    case 'compiling_outcomes': return 'ready';
    case 'planning':
    case 'recovering': return 'planning';
    case 'awaiting_worker': return 'paused';
    case 'executing_tool': return 'acting';
    case 'awaiting_input': return 'awaiting_input';
    case 'awaiting_approval': return 'awaiting_approval';
    case 'verifying': return 'verifying';
    case 'completed': return 'completed';
    case 'blocked': return 'blocked';
    case 'failed':
    case 'expired': return 'failed';
    case 'cancelled': return 'cancelled';
  }
}

export function projectHostedTask(
  run: HostedTaskRecord,
  event?: HostedTaskEvent,
  previous?: TaskSnapshot,
): TaskSnapshot {
  const timestamp = event?.createdAt ?? run.updatedAt;
  const phase = event?.type === 'run.completed' ? 'completed' : phaseFor(run.state);
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
  return TaskSnapshotSchema.parse({
    taskId: run.taskId,
    request: run.request,
    phase,
    goal: previous?.goal ?? null,
    messages: withFinal.slice(-200),
    pendingInteraction: previous?.pendingInteraction ?? null,
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

export interface HostedTaskClientOptions {
  accessTokenProvider(): Promise<string | null>;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  reconnectDelay?: (attempt: number) => number;
}

class HostedRequestError extends Error {
  constructor(message: string, readonly outcomeUnknown: boolean) {
    super(message);
  }
}

export class HostedTaskOutcomeUnknownError extends Error {
  constructor(cause: unknown) {
    super('The hosted task may have started, but Tro could not recover its response.');
    this.cause = cause;
  }
}

function parseEventBlock(block: string): HostedTaskEvent | null {
  const data = block
    .replaceAll('\r\n', '\n')
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  return data ? HostedTaskEventSchema.parse(JSON.parse(data)) : null;
}

export class HostedTaskClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly reconnectDelay: NonNullable<HostedTaskClientOptions['reconnectDelay']>;

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
        return HostedTaskRecordSchema.parse(await this.json('/v1/tasks', {
          method: 'POST',
          body: JSON.stringify(input),
        }));
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
    protocolVersion: number;
    workerRequired: boolean;
  }> {
    const value = await this.json('/v1/agent-runtime/status') as {
      enabled?: unknown;
      protocolVersion?: unknown;
      workerRequired?: unknown;
    };
    if (
      typeof value.enabled !== 'boolean' ||
      value.protocolVersion !== 2 ||
      typeof value.workerRequired !== 'boolean'
    ) {
      throw new Error('Hosted runtime status is incompatible with this desktop.');
    }
    return {
      enabled: value.enabled,
      protocolVersion: value.protocolVersion,
      workerRequired: value.workerRequired,
    };
  }

  async list(): Promise<HostedTaskRecord[]> {
    return HostedTaskListSchema.parse(await this.json('/v1/tasks')).items;
  }

  async get(runId: string): Promise<HostedTaskRecord> {
    return HostedTaskRecordSchema.parse(await this.json(`/v1/tasks/${runId}`));
  }

  async cancel(runId: string): Promise<HostedTaskRecord> {
    return HostedTaskRecordSchema.parse(await this.json(`/v1/tasks/${runId}`, { method: 'DELETE' }));
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
  ): Promise<void> {
    await this.json(`/v1/tasks/${runId}/approval`, {
      method: 'POST',
      body: JSON.stringify(input),
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
        const response = await this.fetchImpl(
          `${this.apiBaseUrl}/v1/tasks/${runId}/events?after=${afterSequence}`,
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
            const event = parseEventBlock(block);
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
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new HostedRequestError(
        body?.error ?? `Hosted task request failed (${response.status}).`,
        response.status >= 500,
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
