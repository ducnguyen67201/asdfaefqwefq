import {
  DesktopInvocationV5Schema,
  DesktopResultV5Schema,
  type DesktopInvocationV5,
  type DesktopResultV5,
} from '../../shared/agent-runtime-protocol';
import type {
  ResolvedToolInvocation,
  ToolExecutionResult,
} from '../agent/agent-contracts';
import type { DesktopObservation } from '../agent/execution-contracts';
import type { RuntimeToolDispatcher } from '../agent/runtime-tool-dispatcher';
import type {
  InteractionToolInput,
  RuntimeToolRegistry,
  TrustedToolExecutionContext,
} from '../agent/runtime-tool-registry';
import type { CuaService } from '../cua/cua-service';

import type { ComputerPermissionCoordinator } from './computer-permission-coordinator';
import {
  HOSTED_AGENT_PROTOCOL_DIGEST,
  HOSTED_AGENT_TOOL_CATALOG_DIGEST,
  hostedToolMetadata,
} from './desktop-worker-protocol';

export interface DesktopToolWorkerOptions {
  commitResult(result: DesktopResultV5): Promise<void>;
  cua?: Pick<CuaService, 'cuaToolCatalog' | 'executeCuaTool'>;
  permissionCoordinator?: Pick<ComputerPermissionCoordinator, 'requireReady'>;
  dispatcher: Pick<RuntimeToolDispatcher, 'dispatch'>;
  executionContextProvider(runId: string): TrustedToolExecutionContext | undefined;
  interactionProvider?: (
    runId: string,
    input: InteractionToolInput,
  ) => Promise<string>;
  latestObservationProvider?: (runId: string) => DesktopObservation | undefined;
  registry: Pick<RuntimeToolRegistry, 'list' | 'supports'>;
  requestExecuting(
    invocationId: string,
    expectedRunVersion: number,
  ): Promise<boolean>;
}

const MAX_RECENT_RESULTS = 500;

export class DesktopToolWorker {
  private readonly recent = new Map<string, DesktopResultV5>();
  private readonly latestObservations = new Map<string, DesktopObservation>();

  constructor(private readonly options: DesktopToolWorkerOptions) {}

  async handle(input: unknown, signal = new AbortController().signal): Promise<DesktopResultV5> {
    const envelope = DesktopInvocationV5Schema.parse(input);
    const cached = this.recent.get(envelope.invocationId);
    if (cached) {
      await this.options.commitResult(cached);
      return cached;
    }
    const result = await this.execute(envelope, signal).catch((error: unknown) => ({
      invocationId: envelope.invocationId,
      status: signal.aborted ? 'cancelled' as const : 'failed' as const,
      summary: error instanceof Error ? error.message.slice(0, 1_000) : 'Desktop execution failed.',
    }));
    const parsed = DesktopResultV5Schema.parse(result);
    this.remember(parsed);
    await this.options.commitResult(parsed);
    return parsed;
  }

  private async execute(
    envelope: DesktopInvocationV5,
    signal: AbortSignal,
  ): Promise<DesktopResultV5> {
    if (
      envelope.protocolDigest !== HOSTED_AGENT_PROTOCOL_DIGEST ||
      envelope.toolCatalogDigest !== HOSTED_AGENT_TOOL_CATALOG_DIGEST
    ) {
      return this.result(
        envelope,
        'not_executed',
        'The backend and desktop tool schemas do not match.',
      );
    }
    if (Date.parse(envelope.expiresAt) <= Date.now()) {
      return this.result(envelope, 'not_executed', 'The desktop invocation expired.');
    }
    const dynamicCua = envelope.toolId === 'cua.driver';
    const metadata = dynamicCua
      ? {
          prerequisites: ['accessibility', 'screen_recording'] as const,
        }
      : hostedToolMetadata(envelope.toolId, envelope.operation);
    if (!metadata) {
      return this.result(
        envelope,
        'not_executed',
        'The desktop invocation tool metadata did not match.',
      );
    }
    const executionContext = this.options.executionContextProvider(envelope.runId);
    if (!executionContext) {
      return this.result(envelope, 'not_executed', 'The trusted execution context is unavailable.');
    }
    const { taskId } = executionContext;
    const latestObservation =
      this.options.latestObservationProvider?.(envelope.runId) ??
      this.latestObservations.get(envelope.runId);
    let invocation: ResolvedToolInvocation;
    if (dynamicCua) {
      const catalog = this.options.cua?.cuaToolCatalog();
      const tool = catalog?.tools.find(
        (candidate) => candidate.name === envelope.operation,
      );
      if (
        !catalog ||
        !tool ||
        envelope.driverCatalogDigest !== catalog.driverCatalogDigest
      ) {
        return this.result(
          envelope,
          'not_executed',
          'The CUA invocation does not match the installed driver catalog.',
        );
      }
      invocation = {
        callId: envelope.callId,
        input: envelope.input,
        kind: 'desktop',
        modelName: `cua.${tool.name}`,
        operation: tool.name,
        toolId: 'cua.driver',
      };
    } else {
      if (envelope.driverCatalogDigest !== null) {
        return this.result(
          envelope,
          'not_executed',
          'A static desktop tool cannot claim a CUA driver catalog.',
        );
      }
      const definition = this.options.registry
        .list({ ...executionContext, latestObservation })
        .find((candidate) => candidate.id === envelope.toolId);
      if (!definition || !definition.operations.includes(envelope.operation)) {
        return this.result(envelope, 'not_executed', 'The desktop does not support this tool operation.');
      }
      const parsedInput = definition.parse(JSON.stringify(envelope.input));
      invocation = definition.normalize(
        parsedInput,
        { arguments: JSON.stringify(envelope.input), callId: envelope.callId, name: definition.modelName },
        {
          ...executionContext,
          latestObservation,
        },
      );
    }
    if (invocation.operation !== envelope.operation || invocation.toolId !== envelope.toolId) {
      return this.result(envelope, 'not_executed', 'The normalized tool identity did not match the signed envelope.');
    }
    let expectedRunVersion = envelope.runVersion;
    if (metadata.prerequisites.length > 0) {
      const permission = await this.options.permissionCoordinator?.requireReady({
        invocation: envelope,
        requirements: metadata.prerequisites,
        taskId,
      });
      if (!permission) {
        return this.result(
          envelope,
          'not_executed',
          'Computer permission is required before this tool can run.',
        );
      }
      if (permission.outcome === 'continue_without_computer') {
        return this.result(
          envelope,
          'not_executed',
          'Computer use was skipped at the user\'s request.',
        );
      }
      expectedRunVersion = permission.runVersion;
    }
    if (!await this.options.requestExecuting(envelope.invocationId, expectedRunVersion)) {
      return this.result(envelope, 'not_executed', 'The one-time executing transition was stale or unavailable.');
    }
    try {
      const outcome: ToolExecutionResult = invocation.toolId === 'task.interaction'
        ? {
            status: 'confirmed',
            summary: 'The user answered the clarification request.',
            data: {
              answer: await this.options.interactionProvider?.(
                envelope.runId,
                invocation.input as InteractionToolInput,
              ) ?? (() => {
                throw new Error('Hosted clarification is unavailable.');
              })(),
            },
          }
        : dynamicCua
          ? await this.options.cua!.executeCuaTool(
              taskId,
              invocation.operation,
              invocation.input as Record<string, unknown>,
              envelope.driverCatalogDigest!,
              signal,
            )
          : await this.options.dispatcher.dispatch(invocation, {
              signal,
              taskId,
            });
      if (outcome.observation) {
        this.latestObservations.set(envelope.runId, outcome.observation);
      }
      const data = resultData(outcome);
      const visual = resultVisual(outcome);
      return DesktopResultV5Schema.parse({
        invocationId: envelope.invocationId,
        status: outcome.status,
        summary: outcome.summary,
        ...(data ? { data } : {}),
        ...(visual ? { visual } : {}),
      });
    } catch {
      return this.result(
        envelope,
        'unknown',
        'Tool execution stopped after dispatch; the outcome is unknown and will not be retried.',
      );
    }
  }

  private result(
    envelope: DesktopInvocationV5,
    status: DesktopResultV5['status'],
    summary: string,
  ): DesktopResultV5 {
    return DesktopResultV5Schema.parse({
      invocationId: envelope.invocationId,
      status,
      summary,
    });
  }

  private remember(result: DesktopResultV5): void {
    this.recent.set(result.invocationId, result);
    while (this.recent.size > MAX_RECENT_RESULTS) {
      const oldest = this.recent.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.recent.delete(oldest);
    }
  }
}

function resultData(outcome: ToolExecutionResult): Record<string, unknown> | undefined {
  if (!outcome.observation) return outcome.data;
  const observation: Partial<DesktopObservation> = { ...outcome.observation };
  delete observation.screenshot;
  return { ...outcome.data, observation };
}

function resultVisual(outcome: ToolExecutionResult): DesktopResultV5['visual'] | undefined {
  if (outcome.imageDataUrl) {
    const [header, dataBase64] = outcome.imageDataUrl.split(',', 2);
    const observationId =
      (outcome.data?.crop as { observationId?: unknown } | undefined)?.observationId ??
      outcome.observation?.observationId;
    if (
      dataBase64 &&
      typeof observationId === 'string' &&
      (header === 'data:image/png;base64' || header === 'data:image/jpeg;base64')
    ) {
      return {
        dataBase64,
        detail: 'original',
        mimeType: header === 'data:image/png;base64' ? 'image/png' : 'image/jpeg',
        observationId,
      };
    }
  }
  const screenshot = outcome.observation?.screenshot;
  if (
    screenshot &&
    (screenshot.mimeType === 'image/png' || screenshot.mimeType === 'image/jpeg')
  ) {
    return {
      dataBase64: screenshot.dataBase64,
      detail: 'original',
      mimeType: screenshot.mimeType,
      observationId: outcome.observation!.observationId,
    };
  }
  return undefined;
}
