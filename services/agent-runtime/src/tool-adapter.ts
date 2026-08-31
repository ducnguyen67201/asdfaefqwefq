import { tool, type FunctionTool, type RunToolApprovalItem } from '@openai/agents';

import { turnMessageIdentity, type LocalAgentRunContext } from './host-backed-session.js';
import { childRequestId } from './host-bridge.js';
import type { LocalRuntimeToolSpec, LocalToolExecutionResult } from './protocol.js';
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
  readonly idempotencyDigest: string;
  readonly modelName: string;
  readonly operation: string;
  readonly toolId: string;
}

export interface ToolSurface {
  readonly tools: readonly unknown[];
  markCheckpointed(call: PendingToolCall): void;
  resolve(interruption: RunToolApprovalItem): PendingToolCall;
}

export class ToolSurfaceFactory {
  create(specs: readonly LocalRuntimeToolSpec[], catalogDigest: string): ToolSurface {
    const byName = new Map<string, LocalRuntimeToolSpec>();
    const checkpointed = new Map<string, PendingToolCall>();
    const tools = specs.map((spec) => {
      if (byName.has(spec.modelName)) throw new Error('duplicate_model_tool_name');
      byName.set(spec.modelName, spec);
      return tool({
        name: spec.modelName,
        description: spec.description,
        parameters: spec.inputSchema as never,
        strict: true,
        needsApproval: true,
        execute: async (_input: Record<string, unknown>, context, details) => {
          const callId = details?.toolCall?.callId;
          if (!callId || !context) throw new Error('missing_sdk_tool_context');
          const pending = checkpointed.get(callId);
          if (!pending) throw new Error('tool_effect_without_durable_checkpoint');
          checkpointed.delete(callId);
          const runtime = context.context as LocalAgentRunContext;
          const requestId = childRequestId();
          const response = await runtime.bridge.request({
            ...turnMessageIdentity(runtime.bridge, runtime.identity),
            requestId,
            kind: 'tool.execute',
            callId: pending.callId,
            toolId: pending.toolId,
            modelName: pending.modelName,
            operation: pending.operation,
            arguments: pending.arguments,
            catalogDigest: pending.catalogDigest,
            driverCatalogDigest: pending.driverCatalogDigest,
            idempotencyDigest: pending.idempotencyDigest,
          }, { signal: runtime.signal, timeoutMs: 180_000 });
          if (response.kind !== 'tool.execute.result') throw new Error('unexpected_tool_execute_response');
          return modelToolResult(response.result, pending.callId);
        },
      }) as FunctionTool<LocalAgentRunContext, never, unknown>;
    });

    return {
      tools,
      markCheckpointed: (call) => checkpointed.set(call.callId, call),
      resolve: (interruption) => {
        const raw = interruption.rawItem;
        if (raw.type !== 'function_call') throw new Error('unsupported_sdk_interruption');
        const spec = byName.get(raw.name);
        if (!spec) throw new Error('unknown_sdk_tool_interruption');
        const parsed: unknown = JSON.parse(raw.arguments);
        if (!isRecord(parsed)) throw new Error('invalid_sdk_tool_arguments');
        const operation = resolveOperation(spec, parsed);
        const value = {
          arguments: parsed,
          callId: raw.callId,
          catalogDigest,
          driverCatalogDigest: spec.driverCatalogDigest,
          modelName: spec.modelName,
          operation,
          toolId: spec.toolId,
        };
        return { ...value, idempotencyDigest: digest(value) };
      },
    };
  }
}

function modelToolResult(result: LocalToolExecutionResult, callId: string): unknown {
  if (result.status === 'unknown') throw new ToolOutcomeUnknownError(callId);
  if (result.status === 'cancelled') {
    const error = new Error(result.summary);
    error.name = 'AbortError';
    throw error;
  }
  const text = JSON.stringify({ status: result.status, summary: result.summary, data: result.data });
  if (!result.imageDataUrl) return text;
  return [{ type: 'text', text }, { type: 'image', image: result.imageDataUrl, detail: 'high' }];
}

function resolveOperation(spec: LocalRuntimeToolSpec, input: Record<string, unknown>): string {
  if (spec.operations.length === 1) return spec.operations[0] as string;
  const candidate = input.kind ?? input.operation ?? input.action;
  if (typeof candidate === 'string' && spec.operations.includes(candidate)) return candidate;
  throw new Error('unresolved_tool_operation');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
