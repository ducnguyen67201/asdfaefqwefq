import {
  DesktopInvocationV4Schema,
  DesktopResultV4Schema,
  type DesktopInvocationV4,
  type DesktopResultV4,
} from '../../shared/agent-runtime-protocol';
import { type ActionEffect, type GoalSpec } from '../../shared/contracts';
import type { DesktopObservation } from '../agent/execution-contracts';
import type { RuntimeToolDispatcher } from '../agent/runtime-tool-dispatcher';
import type {
  InteractionToolInput,
  RuntimeToolRegistry,
} from '../agent/runtime-tool-registry';

import type { ComputerPermissionCoordinator } from './computer-permission-coordinator';
import {
  HOSTED_AGENT_PROTOCOL_DIGEST,
  HOSTED_AGENT_TOOL_CATALOG_DIGEST,
  hostedToolMetadata,
} from './desktop-worker-protocol';

export interface DesktopToolWorkerOptions {
  commitResult(result: DesktopResultV4): Promise<void>;
  permissionCoordinator?: Pick<ComputerPermissionCoordinator, 'requireReady'>;
  dispatcher: Pick<RuntimeToolDispatcher, 'dispatch'>;
  goalProvider(runId: string): GoalSpec | undefined;
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
  taskIdProvider(runId: string): string | undefined;
}

const MAX_RECENT_RESULTS = 500;

function effectsMatch(
  left: ActionEffect,
  right: DesktopInvocationV4['effect'],
): boolean {
  return (
    left.kind === right.kind &&
    left.resourceKind === right.resourceKind &&
    left.reversibility === right.reversibility &&
    left.externality === right.externality &&
    left.communication === right.communication &&
    left.overwrite === right.overwrite &&
    left.sensitiveDataTransfer === right.sensitiveDataTransfer
  );
}

export class DesktopToolWorker {
  private readonly recent = new Map<string, DesktopResultV4>();
  private readonly latestObservations = new Map<string, DesktopObservation>();

  constructor(private readonly options: DesktopToolWorkerOptions) {}

  async handle(input: unknown, signal = new AbortController().signal): Promise<DesktopResultV4> {
    const envelope = DesktopInvocationV4Schema.parse(input);
    const cached = this.recent.get(envelope.invocationId);
    if (cached) {
      await this.options.commitResult(cached);
      return cached;
    }
    const result = await this.execute(envelope, signal).catch((error: unknown) => ({
      invocationId: envelope.invocationId,
      status: signal.aborted ? 'cancelled' as const : 'failed' as const,
      summary: error instanceof Error ? error.message.slice(0, 1_000) : 'Desktop execution failed.',
      evidence: [],
    }));
    const parsed = DesktopResultV4Schema.parse(result);
    this.remember(parsed);
    await this.options.commitResult(parsed);
    return parsed;
  }

  private async execute(
    envelope: DesktopInvocationV4,
    signal: AbortSignal,
  ): Promise<DesktopResultV4> {
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
    const metadata = hostedToolMetadata(envelope.toolId, envelope.operation);
    if (!metadata) {
      return this.result(
        envelope,
        'not_executed',
        'The desktop invocation tool metadata did not match.',
      );
    }
    const goal = this.options.goalProvider(envelope.runId);
    if (!goal) return this.result(envelope, 'not_executed', 'The local task authority is unavailable.');
    const taskId = this.options.taskIdProvider(envelope.runId);
    if (!taskId) return this.result(envelope, 'not_executed', 'The hosted run is not mapped to a local task.');
    const latestObservation =
      this.options.latestObservationProvider?.(envelope.runId) ??
      this.latestObservations.get(envelope.runId);
    const definition = this.options.registry
      .list({ goal, latestObservation, taskId })
      .find((candidate) => candidate.id === envelope.toolId);
    if (!definition || !definition.operations.includes(envelope.operation)) {
      return this.result(envelope, 'not_executed', 'The desktop does not support this tool operation.');
    }
    const normalizedInput =
      envelope.toolId === 'computer.control' || envelope.toolId === 'desktop.control'
        ? {
            ...envelope.input,
            effect: envelope.input.effect ?? envelope.effect,
            attendees: envelope.input.attendees ?? null,
          }
        : envelope.input;
    const parsedInput = definition.parse(JSON.stringify(normalizedInput));
    const invocation = definition.normalize(
      parsedInput,
      { arguments: JSON.stringify(envelope.input), callId: envelope.callId, name: definition.modelName },
      {
        goal,
        latestObservation,
        taskId,
      },
    );
    if (invocation.operation !== envelope.operation || invocation.toolId !== envelope.toolId) {
      return this.result(envelope, 'not_executed', 'The normalized tool identity did not match the signed envelope.');
    }
    if (
      invocation.action &&
      (!invocation.action.effect ||
        !effectsMatch(invocation.action.effect, envelope.effect))
    ) {
      return this.result(
        envelope,
        'not_executed',
        'The normalized tool effect did not match the server-owned invocation.',
      );
    }
    if (metadata.prerequisites.length > 0) {
      const outcome = await this.options.permissionCoordinator?.requireReady({
        invocation: envelope,
        requirements: metadata.prerequisites,
        taskId,
      });
      if (!outcome) {
        return this.result(
          envelope,
          'not_executed',
          'Computer permission is required before this tool can run.',
        );
      }
      if (outcome === 'continue_without_computer') {
        return this.result(
          envelope,
          'not_executed',
          'Computer use was skipped at the user\'s request.',
        );
      }
    }
    if (!await this.options.requestExecuting(envelope.invocationId, envelope.runVersion)) {
      return this.result(envelope, 'not_executed', 'The one-time executing transition was stale or unavailable.');
    }
    const outcome = invocation.toolId === 'task.interaction'
      ? {
          status: 'confirmed' as const,
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
      : await this.options.dispatcher.dispatch(invocation, {
          signal,
          taskId,
        });
    if (outcome.observation) {
      this.latestObservations.set(envelope.runId, outcome.observation);
    }
    const evidence = envelope.obligations.map((obligation) => {
      const status = outcome.status === 'confirmed'
        ? 'supports' as const
        : outcome.status === 'unknown'
          ? 'unknown' as const
          : 'contradicts' as const;
      if (obligation.verifierKind === 'application_surface') {
        const surface = outcome.data?.applicationSurfaceEvidence as {
          observationId?: string;
          observationFingerprint?: string;
        } | undefined;
        return {
          criterionId: obligation.criterionId,
          source: 'fresh_observation' as const,
          status: surface?.observationId && surface.observationFingerprint ? status : 'unknown' as const,
          ...(surface?.observationId ? { observationId: surface.observationId } : {}),
          ...(surface?.observationFingerprint ? { observationFingerprint: surface.observationFingerprint } : {}),
          summary: outcome.summary,
        };
      }
      return {
        criterionId: obligation.criterionId,
        source: obligation.verifierKind === 'browser_semantic'
          ? 'browser_dom' as const
          : obligation.verifierKind === 'filesystem_effect'
            ? 'filesystem' as const
            : 'tool_result' as const,
        status,
        summary: outcome.summary,
      };
    });
    return DesktopResultV4Schema.parse({
      invocationId: envelope.invocationId,
      status: outcome.status,
      summary: outcome.summary,
      ...(outcome.data ? { data: outcome.data } : {}),
      ...(outcome.imageDataUrl
        ? {
            visual: {
              dataBase64: outcome.imageDataUrl.split(',', 2)[1],
              detail: 'original',
              mimeType: outcome.imageDataUrl.startsWith('data:image/png')
                ? 'image/png'
                : 'image/jpeg',
              observationId:
                String((outcome.data?.crop as { observationId?: string } | undefined)?.observationId),
            },
          }
        : {}),
      evidence,
    });
  }

  private result(
    envelope: DesktopInvocationV4,
    status: DesktopResultV4['status'],
    summary: string,
  ): DesktopResultV4 {
    return DesktopResultV4Schema.parse({
      invocationId: envelope.invocationId,
      status,
      summary,
      evidence: envelope.obligations.map((obligation) => ({
        criterionId: obligation.criterionId,
        source: obligation.verifierKind === 'application_surface' ? 'fresh_observation' : 'tool_result',
        status: status === 'unknown' ? 'unknown' : 'contradicts',
        summary,
      })),
    });
  }

  private remember(result: DesktopResultV4): void {
    this.recent.set(result.invocationId, result);
    while (this.recent.size > MAX_RECENT_RESULTS) {
      const oldest = this.recent.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.recent.delete(oldest);
    }
  }
}
