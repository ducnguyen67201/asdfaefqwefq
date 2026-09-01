import { Agent, OpenAIResponsesCompactionSession, Runner } from '@openai/agents';

import { AGENT_INSTRUCTIONS, ROOT_AGENT_DEFINITION, graphVersion, modelSettings } from './config.js';
import {
  AtomicCompactionDelegate,
  HostBackedSession,
  type LocalAgentRunContext,
} from './host-backed-session.js';
import type {
  LocalRuntimeToolSpec,
  RequiredInitialToolCall,
} from './protocol.js';
import { ToolSurfaceFactory, type ToolSurface } from './tool-adapter.js';
import type {
  ModelRequestDiagnosticSink,
  UserOpenAIClientFactory,
} from './user-openai-client.js';

export interface AgentGraph {
  readonly agent: Agent<LocalAgentRunContext, 'text'>;
  readonly session: OpenAIResponsesCompactionSession;
  readonly toolSurface: ToolSurface;
}

export interface AgentGraphInput {
  readonly agentTurnId: string;
  readonly model: string;
  readonly requiredInitialTool: RequiredInitialToolCall | null;
  readonly graphVersion: string;
  readonly taskId: string;
  readonly toolCatalogDigest: string;
  readonly tools: readonly LocalRuntimeToolSpec[];
}

/** The sole TroCode harness around public Agents SDK primitives. */
export class AgentGraphFactory {
  readonly runner = new Runner({
    modelSettings: modelSettings(),
    traceIncludeSensitiveData: false,
    tracingDisabled: true,
  });
  private readonly tools = new ToolSurfaceFactory();

  constructor(
    private readonly clients: UserOpenAIClientFactory,
    private readonly compactionItemThreshold = 80,
  ) {}

  async create(
    input: AgentGraphInput,
    context: LocalAgentRunContext,
    onModelRequestDiagnostic: ModelRequestDiagnosticSink = () => undefined,
  ): Promise<AgentGraph> {
    if (input.graphVersion !== graphVersion(input.tools, input.model)) {
      throw new Error('graph_version_mismatch');
    }
    if (
      input.requiredInitialTool &&
      !input.tools.some(
        (tool) => tool.modelName === input.requiredInitialTool?.modelName,
      )
    ) {
      throw new Error('required_initial_tool_unavailable');
    }
    const clients = this.clients.create(
      { agentTurnId: input.agentTurnId, taskId: input.taskId },
      onModelRequestDiagnostic,
    );
    const model = await clients.provider.getModel(input.model);
    const toolSurface = this.tools.create(
      input.tools,
      input.toolCatalogDigest,
      input.requiredInitialTool,
    );
    const agent = new Agent<LocalAgentRunContext, 'text'>({
      name: ROOT_AGENT_DEFINITION.displayName,
      instructions: AGENT_INSTRUCTIONS,
      model,
      modelSettings: modelSettings(input.requiredInitialTool?.modelName ?? 'auto'),
      tools: toolSurface.tools as never,
    });
    const underlying = new HostBackedSession(context);
    const session = new OpenAIResponsesCompactionSession({
      client: clients.openai,
      compactionMode: 'input',
      model: input.model as never,
      shouldTriggerCompaction: ({ sessionItems }) =>
        sessionItems.length >= this.compactionItemThreshold,
      underlyingSession: new AtomicCompactionDelegate(underlying),
    });
    return { agent, session, toolSurface };
  }
}
