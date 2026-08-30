import {
  Agent,
  OpenAIResponsesCompactionSession,
  Runner,
} from '@openai/agents';

import { BrokeredOpenAIClientFactory } from './brokered-openai-client.js';
import { AGENT_INSTRUCTIONS, type RuntimeConfig } from './config.js';
import type { RunLease } from './control-plane-client.js';
import type { ClaimedRun } from './protocol.js';
import {
  AtomicCompactionDelegate,
  RustSession,
  type AgentRunContext,
} from './rust-session.js';
import { ToolSurfaceFactory, type ToolSurface } from './tool-adapter.js';

export interface AgentGraph {
  readonly agent: Agent<AgentRunContext, 'text'>;
  readonly session: OpenAIResponsesCompactionSession;
  readonly toolSurface: ToolSurface;
}

export class AgentGraphFactory {
  readonly runner: Runner;

  private readonly clients: BrokeredOpenAIClientFactory;

  private readonly tools: ToolSurfaceFactory;

  constructor(private readonly config: RuntimeConfig) {
    this.clients = new BrokeredOpenAIClientFactory(config);
    this.tools = new ToolSurfaceFactory(config);
    this.runner = new Runner({
      modelSettings: modelSettings(),
      traceIncludeSensitiveData: false,
      tracingDisabled: true,
    });
  }

  async create(
    claim: ClaimedRun,
    lease: RunLease,
    client: AgentRunContext['client'],
    signal: AbortSignal,
  ): Promise<AgentGraph> {
    if (
      claim.sdkVersion !== this.config.sdkVersion ||
      claim.graphVersion !== this.config.graphVersion ||
      claim.protocolDigest !== this.config.publicProtocolDigest
    ) {
      throw new Error('graph_version_mismatch');
    }
    const brokered = this.clients.create({ runId: claim.runId, workerId: lease.workerId });
    const model = await brokered.provider.getModel(claim.model);
    const toolSurface = this.tools.create(claim.tools, claim.toolCatalogDigest);
    const agent = new Agent<AgentRunContext, 'text'>({
      name: 'Tro',
      instructions: AGENT_INSTRUCTIONS,
      model,
      modelSettings: modelSettings(),
      tools: toolSurface.tools as never,
    });
    const underlying = new RustSession(
      client,
      lease,
      claim.sessionRevision,
      signal,
    );
    const atomic = new AtomicCompactionDelegate(underlying);
    const session = new OpenAIResponsesCompactionSession({
      client: brokered.openai,
      compactionMode: 'input',
      model: claim.model as never,
      shouldTriggerCompaction: ({ sessionItems }) =>
        sessionItems.length >= this.config.compactionItemThreshold,
      underlyingSession: atomic,
    });
    return { agent, session, toolSurface };
  }
}

function modelSettings(): {
  readonly maxTokens: number;
  readonly parallelToolCalls: false;
  readonly retry: { readonly maxRetries: 0 };
  readonly store: false;
  readonly toolChoice: 'auto';
} {
  return {
    maxTokens: 4_000,
    parallelToolCalls: false,
    retry: { maxRetries: 0 },
    store: false,
    toolChoice: 'auto',
  };
}
