import { createHash } from 'node:crypto';

import {
  Agent,
  OpenAIProvider,
  OpenAIResponsesCompactionSession,
  RunContext,
  Runner,
  RunState,
  Usage,
  tool,
  toolNamespace,
  toolSearchTool,
  type AgentInputItem,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type RunContextAwareSession,
  type SessionHistoryTransactionArgs,
  type SessionHistoryTransactionAwareSession,
} from '@openai/agents';
import OpenAI from 'openai';
import { z } from 'zod';

export interface ProofContext {
  readonly runId: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sameItems(left: readonly AgentInputItem[], right: readonly AgentInputItem[]): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** Test-only reference for the persistence semantics implemented by RustSession. */
export class TransactionalMemorySession
  implements
    RunContextAwareSession<ProofContext>,
    SessionHistoryTransactionAwareSession
{
  readonly acceptsRunContext = true as const;

  private items: AgentInputItem[] = [];

  private readonly operationDigests = new Map<string, string>();

  constructor(private readonly sessionId: string) {}

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const selected = limit === undefined ? this.items : this.items.slice(-limit);
    return structuredClone(selected);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    this.items.push(...structuredClone(items));
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.items.pop();
  }

  async clearSession(): Promise<void> {
    this.items = [];
  }

  async replaceHistoryWithCompaction(items: AgentInputItem[]): Promise<void> {
    this.items = structuredClone(items);
  }

  async applyHistoryTransaction(args: SessionHistoryTransactionArgs): Promise<void> {
    const operationDigest = digest(args.transaction);
    const existingDigest = this.operationDigests.get(args.operationId);
    if (existingDigest !== undefined) {
      if (existingDigest !== operationDigest) {
        throw new Error('session_operation_conflict');
      }
      return;
    }

    const next = structuredClone(this.items);
    if (args.transaction.type === 'append_items') {
      next.push(...structuredClone(args.transaction.items));
    } else {
      const expected = args.transaction.expectedSuffix;
      const suffixStart = next.length - expected.length;
      if (
        suffixStart < 0 ||
        !sameItems(next.slice(suffixStart), expected)
      ) {
        throw new Error('session_suffix_conflict');
      }
      next.splice(
        suffixStart,
        expected.length,
        ...structuredClone(args.transaction.replacement),
      );
    }

    this.items = next;
    this.operationDigests.set(args.operationId, operationDigest);
  }
}

/**
 * The released SDK compaction decorator currently calls clearSession() followed
 * by addItems(). This delegate makes those two calls one durable replacement:
 * clear only stages the old suffix, and add commits replace_suffix atomically.
 */
export class AtomicCompactionDelegate implements RunContextAwareSession<ProofContext> {
  readonly acceptsRunContext = true as const;

  private stagedSuffix: AgentInputItem[] | undefined;

  constructor(private readonly delegate: TransactionalMemorySession) {}

  getSessionId(): Promise<string> {
    return this.delegate.getSessionId();
  }

  getItems(limit?: number): Promise<AgentInputItem[]> {
    return this.delegate.getItems(limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (this.stagedSuffix === undefined) {
      await this.delegate.addItems(items);
      return;
    }

    const expectedSuffix = this.stagedSuffix;
    this.stagedSuffix = undefined;
    await this.delegate.applyHistoryTransaction({
      operationId: `compact:${digest({ expectedSuffix, replacement: items })}`,
      transaction: {
        type: 'replace_suffix',
        expectedSuffix,
        replacement: items,
      },
    });
  }

  popItem(): Promise<AgentInputItem | undefined> {
    if (this.stagedSuffix !== undefined) {
      throw new Error('compaction_replacement_in_progress');
    }
    return this.delegate.popItem();
  }

  async clearSession(): Promise<void> {
    this.stagedSuffix = await this.delegate.getItems();
  }

  abortStagedReplacement(): void {
    this.stagedSuffix = undefined;
  }
}

class ToolThenFinalModel implements Model {
  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const input = Array.isArray(request.input) ? request.input : [];
    const hasToolResult = input.some((item) => item.type === 'function_call_result');
    return {
      usage: new Usage(),
      responseId: hasToolResult ? 'proof_response_2' : 'proof_response_1',
      output: hasToolResult
        ? [
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'proof complete' }],
            },
          ]
        : [
            {
              type: 'function_call',
              callId: 'proof_call_1',
              name: 'proof_action',
              arguments: JSON.stringify({ value: 'run' }),
              status: 'completed',
            },
          ],
    };
  }

  getStreamedResponse(request: ModelRequest): AsyncIterable<never> {
    void request;
    throw new Error('The compatibility proof uses non-streaming model responses.');
  }
}

class TerminalRecoveryModel implements Model {
  private calls = 0;

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    const input = JSON.stringify(request.input);
    if (
      this.calls === 2 &&
      (!input.includes('initial complete') || !input.includes('Also open a new tab.'))
    ) {
      throw new Error('Fresh steering turn did not inherit durable session history.');
    }
    return {
      usage: new Usage(),
      responseId: `terminal_recovery_${this.calls}`,
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: this.calls === 1 ? 'initial complete' : 'steering complete',
            },
          ],
        },
      ],
    };
  }

  getStreamedResponse(request: ModelRequest): AsyncIterable<never> {
    void request;
    throw new Error('The compatibility proof uses non-streaming model responses.');
  }
}

export interface CompatibilityGraph {
  readonly agent: Agent<ProofContext, 'text'>;
  readonly executedCallIds: string[];
  readonly runner: Runner;
}

export function createCompatibilityGraph(): CompatibilityGraph {
  const executedCallIds: string[] = [];
  const proofTool = tool({
    name: 'proof_action',
    description: 'Execute the compatibility proof action.',
    parameters: z.object({ value: z.literal('run') }).strict(),
    needsApproval: true,
    execute: async (_input, _context, details) => {
      const callId = details?.toolCall?.callId;
      if (!callId) throw new Error('missing_sdk_call_id');
      executedCallIds.push(callId);
      return JSON.stringify({ status: 'confirmed', callId });
    },
  });
  const model = new ToolThenFinalModel();
  const agent = new Agent<ProofContext, 'text'>({
    name: 'TroCompatibilityProof',
    instructions: 'Call proof_action exactly once, then finish.',
    model,
    modelSettings: {
      parallelToolCalls: false,
      retry: { maxRetries: 0 },
      store: false,
      toolChoice: 'auto',
    },
    tools: [proofTool],
  });
  const runner = new Runner({
    model,
    modelSettings: {
      parallelToolCalls: false,
      retry: { maxRetries: 0 },
      store: false,
    },
    traceIncludeSensitiveData: false,
    tracingDisabled: true,
  });
  return { agent, executedCallIds, runner };
}

export async function proveSerializedResume(): Promise<{
  callId: string;
  finalOutput: string;
}> {
  const firstGraph = createCompatibilityGraph();
  const session = new TransactionalMemorySession('proof-session');
  const first = await firstGraph.runner.run(firstGraph.agent, 'run the proof', {
    context: { runId: 'proof-run' },
    maxTurns: 4,
    session,
  });
  if (first.interruptions.length !== 1 || firstGraph.executedCallIds.length !== 0) {
    throw new Error('SDK did not pause exactly once before tool execution.');
  }

  const serialized = first.state.toString();
  const secondGraph = createCompatibilityGraph();
  const restored = await RunState.fromStringWithContext(
    secondGraph.agent,
    serialized,
    new RunContext<ProofContext>({ runId: 'proof-run' }),
  );
  const [interruption] = restored.getInterruptions();
  if (!interruption) throw new Error('Serialized SDK state lost its interruption.');
  restored.approve(interruption);

  const resumed = await secondGraph.runner.run(secondGraph.agent, restored, {
    maxTurns: 4,
    session,
  });
  if (
    resumed.finalOutput !== 'proof complete' ||
    secondGraph.executedCallIds.length !== 1 ||
    secondGraph.executedCallIds[0] !== 'proof_call_1'
  ) {
    throw new Error('Serialized SDK state did not preserve exactly-once call identity.');
  }
  return { callId: secondGraph.executedCallIds[0], finalOutput: resumed.finalOutput };
}

export async function proveTerminalCheckpointRecovery(): Promise<{
  restoredOutput: string;
  steeredOutput: string;
}> {
  const model = new TerminalRecoveryModel();
  const agent = new Agent<ProofContext, 'text'>({
    name: 'TroTerminalRecoveryProof',
    instructions: 'Finish each requested turn.',
    model,
  });
  const runner = new Runner({
    model,
    traceIncludeSensitiveData: false,
    tracingDisabled: true,
  });
  const session = new TransactionalMemorySession('terminal-recovery-proof');
  const initial = await runner.run(agent, 'Open Chrome.', {
    context: { runId: 'terminal-recovery-run' },
    maxTurns: 4,
    session,
  });
  const restored = await RunState.fromStringWithContext(
    agent,
    initial.state.toString(),
    new RunContext<ProofContext>({ runId: 'terminal-recovery-run' }),
  );
  const currentStep = restored.toJSON().currentStep;
  if (currentStep?.type !== 'next_step_final_output') {
    throw new Error('Serialized terminal state lost its final output.');
  }
  const steered = await runner.run(agent, 'Also open a new tab.', {
    context: { runId: 'terminal-recovery-run' },
    maxTurns: 4,
    session,
  });
  if (steered.finalOutput !== 'steering complete') {
    throw new Error('Fresh SDK turn did not apply late steering.');
  }
  return {
    restoredOutput: currentStep.output,
    steeredOutput: steered.finalOutput,
  };
}

export function constructDeferredToolSurface(): readonly unknown[] {
  const deferred = tool({
    name: 'future_action',
    description: 'A future CUA capability discovered at runtime.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    } as const,
    strict: true,
    deferLoading: true,
    execute: async (input) => JSON.stringify(input),
  });
  const namespaced = toolNamespace({
    name: 'cua',
    description: 'Capabilities advertised by the active CUA driver.',
    tools: [deferred] as const,
  });
  return [...namespaced, toolSearchTool()];
}

export function constructBrokeredProvider(): OpenAIProvider {
  const client = new OpenAI({
    apiKey: 'not-a-provider-key',
    baseURL: 'http://127.0.0.1:9/internal/agent-orchestrator/v1/openai/v1',
    maxRetries: 0,
  });
  return new OpenAIProvider({ openAIClient: client, useResponses: true });
}

export async function proveInputCompaction(): Promise<AgentInputItem[]> {
  const underlying = new TransactionalMemorySession('compaction-proof');
  const delegate = new AtomicCompactionDelegate(underlying);
  await delegate.addItems([
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'a long conversation' }],
    },
    {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'prior response' }],
    },
  ]);

  const compactRequests: unknown[] = [];
  const client = {
    responses: {
      compact: async (request: unknown) => {
        compactRequests.push(request);
        return {
          output: [{ type: 'compaction', encrypted_content: 'proof-compaction' }],
          usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        };
      },
    },
  };
  const session = new OpenAIResponsesCompactionSession({
    client: client as never,
    compactionMode: 'input',
    model: 'gpt-5.6-sol',
    underlyingSession: delegate,
  });
  await session.runCompaction({ compactionMode: 'input', force: true, store: false });
  const request = compactRequests[0] as Record<string, unknown> | undefined;
  if (!request || !Array.isArray(request.input) || 'previous_response_id' in request) {
    throw new Error('Compaction did not use authoritative local-input mode.');
  }
  return underlying.getItems();
}
