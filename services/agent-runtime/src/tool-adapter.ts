import {
  tool,
  toolNamespace,
  toolSearchTool,
  type FunctionTool,
  type RunToolApprovalItem,
} from '@openai/agents';

import type { RuntimeConfig } from './config.js';
import type {
  RunLease,
  ToolCheckpointControlPlane,
} from './control-plane-client.js';
import type { OrchestratorToolSpec, ToolCallResult } from './protocol.js';
import type { AgentRunContext } from './rust-session.js';
import { digest } from './serialization.js';

export class ToolOutcomeUnknownError extends Error {
  constructor(readonly callId: string) {
    super('The tool outcome is unknown and cannot be retried.');
    this.name = 'ToolOutcomeUnknownError';
  }
}

export interface PendingToolCall {
  readonly arguments: Record<string, unknown>;
  readonly callId: string;
  readonly catalogDigest: string;
  readonly driverCatalogDigest: string | null;
  readonly graphVersion: string;
  readonly idempotencyDigest: string;
  readonly operation: string;
  readonly sdkVersion: string;
  readonly toolId: string;
}

export interface ToolSurface {
  readonly tools: readonly unknown[];
  resolve(interruption: RunToolApprovalItem): PendingToolCall;
}

export class ToolExecutionCheckpoint {
  constructor(
    private readonly client: ToolCheckpointControlPlane,
    private readonly lease: RunLease,
    private readonly config: RuntimeConfig,
  ) {}

  async commit(
    expectedCheckpointRevision: number,
    appliedControlSequence: number,
    serializedState: string,
    pending: PendingToolCall,
    signal?: AbortSignal,
  ): Promise<number> {
    const revision = await this.client.putCheckpoint(
      this.lease,
      {
        expectedCheckpointRevision,
        appliedControlSequence,
        sdkVersion: this.config.sdkVersion,
        graphVersion: this.config.graphVersion,
        pendingCallId: pending.callId,
        state: serializedState,
      },
      signal,
    );
    await this.client.queueToolCall(this.lease, pending, signal);
    return revision;
  }
}

export class ToolSurfaceFactory {
  constructor(private readonly config: RuntimeConfig) {}

  create(
    specs: readonly OrchestratorToolSpec[],
    catalogDigest: string,
  ): ToolSurface {
    const byQualifiedName = new Map<string, OrchestratorToolSpec>();
    const byBareName = new Map<string, OrchestratorToolSpec | null>();
    const groups = new Map<string, FunctionTool<AgentRunContext, never, unknown>[]>();

    for (const spec of specs) {
      const qualified = key(spec.namespace, spec.modelName);
      if (byQualifiedName.has(qualified)) throw new Error('duplicate_qualified_tool_name');
      byQualifiedName.set(qualified, spec);
      const prior = byBareName.get(spec.modelName);
      byBareName.set(spec.modelName, prior === undefined ? spec : null);

      const remoteTool = tool({
        name: spec.modelName,
        description: spec.description,
        parameters: spec.inputSchema as never,
        strict: true,
        deferLoading: spec.deferred,
        needsApproval: true,
        execute: async (input: Record<string, unknown>, context, details) => {
          const callId = details?.toolCall?.callId;
          if (!callId || !context) throw new Error('missing_sdk_tool_context');
          const runtime = context.context;
          for (;;) {
            const result = await runtime.client.getToolResult(
              runtime.lease,
              callId,
              details.signal ?? runtime.signal,
            );
            if (result.status === 'pending') {
              await abortableDelay(this.config.resultPollMs, details.signal ?? runtime.signal);
              continue;
            }
            if (result.status === 'unknown') throw new ToolOutcomeUnknownError(callId);
            return modelToolResult(result);
          }
        },
      }) as FunctionTool<AgentRunContext, never, unknown>;
      const group = groups.get(spec.namespace) ?? [];
      group.push(remoteTool);
      groups.set(spec.namespace, group);
    }

    const tools: unknown[] = [];
    for (const [namespace, group] of [...groups].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      group.sort((left, right) => left.name.localeCompare(right.name));
      tools.push(
        ...toolNamespace({
          name: namespace,
          description: `Tools provided by the ${namespace} execution surface.`,
          tools: group,
        }),
      );
    }
    if (specs.some((spec) => spec.deferred)) tools.push(toolSearchTool());

    return {
      tools,
      resolve: (interruption) => {
        const raw = interruption.rawItem;
        if (raw.type !== 'function_call') throw new Error('unsupported_sdk_interruption');
        const spec = raw.namespace
          ? byQualifiedName.get(key(raw.namespace, raw.name))
          : byBareName.get(raw.name);
        if (!spec) throw new Error('unknown_sdk_tool_interruption');
        const parsed: unknown = JSON.parse(raw.arguments);
        if (!isRecord(parsed)) throw new Error('invalid_sdk_tool_arguments');
        const operation = resolveOperation(spec, parsed);
        const value = {
          arguments: parsed,
          callId: raw.callId,
          catalogDigest,
          driverCatalogDigest: spec.driverCatalogDigest,
          graphVersion: this.config.graphVersion,
          operation,
          sdkVersion: this.config.sdkVersion,
          toolId: spec.toolId,
        };
        return { ...value, idempotencyDigest: digest(value) };
      },
    };
  }
}

export function modelToolResult(result: ToolCallResult): unknown {
  const text = JSON.stringify({
    status: result.status,
    summary: result.summary,
    data: result.data,
  });
  if (!result.visual) return text;
  return [
    { type: 'text', text },
    {
      type: 'image',
      image: {
        data: result.visual.dataBase64,
        mediaType: result.visual.mimeType,
      },
      detail: 'high',
    },
  ];
}

function resolveOperation(
  spec: OrchestratorToolSpec,
  input: Record<string, unknown>,
): string {
  if (spec.operation !== null) return spec.operation;
  const selector = spec.operationSelector;
  if (!selector) throw new Error('missing_operation_selector');
  const kind = selector.kind;
  if (kind === 'constant' && typeof selector.value === 'string') return selector.value;
  if (kind !== 'json_pointer' || typeof selector.pointer !== 'string') {
    throw new Error('invalid_operation_selector');
  }
  const value = jsonPointer(input, selector.pointer);
  if ((value === null || value === undefined) && typeof selector.nullValue === 'string') {
    return selector.nullValue;
  }
  if (value !== undefined && typeof selector.presentValue === 'string') {
    return selector.presentValue;
  }
  if (typeof value === 'string') return value;
  throw new Error('unresolved_tool_operation');
}

function jsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  if (!pointer.startsWith('/')) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((value, part) => {
      if (Array.isArray(value)) {
        const index = Number(part);
        return Number.isInteger(index) ? value[index] : undefined;
      }
      return isRecord(value) ? value[part] : undefined;
    }, root);
}

function key(namespace: string, name: string): string {
  return `${namespace}:${name}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
