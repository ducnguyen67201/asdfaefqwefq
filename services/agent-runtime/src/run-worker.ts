import { randomUUID } from 'node:crypto';

import {
  RunContext,
  RunState,
  type AgentInputItem,
  type ModelInputData,
} from '@openai/agents';

import { AgentGraphFactory } from './agent-graph.js';
import type { RuntimeConfig } from './config.js';
import {
  ControlPlaneClient,
  ControlPlaneError,
  RunLease,
} from './control-plane-client.js';
import type { ClaimedRun } from './protocol.js';
import type { AgentRunContext } from './rust-session.js';
import {
  ToolExecutionCheckpoint,
  ToolOutcomeUnknownError,
  abortableDelay,
} from './tool-adapter.js';

export class RunWorker {
  private readonly client: ControlPlaneClient;

  private readonly graphs: AgentGraphFactory;

  private readonly instanceId = randomUUID();

  constructor(private readonly config: RuntimeConfig) {
    this.client = new ControlPlaneClient(config);
    this.graphs = new AgentGraphFactory(config);
  }

  async start(signal: AbortSignal, onReady?: () => void): Promise<void> {
    const registration = await this.client.register(this.instanceId, signal);
    const workerId = registration.workerId;
    onReady?.();
    const heartbeat = setInterval(() => {
      if (signal.aborted) return;
      void this.client.heartbeat(workerId, signal).catch(() => {
        console.error('agent_runtime_worker_heartbeat_failed');
      });
    }, 5_000);
    try {
      while (!signal.aborted) {
        const claim = await this.client.claim(workerId, signal);
        if (claim === null) {
          await abortableDelay(this.config.pollMs, signal);
          continue;
        }
        await this.executeClaim(workerId, claim, signal);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async executeClaim(
    workerId: string,
    claim: ClaimedRun,
    workerSignal: AbortSignal,
  ): Promise<void> {
    const lease = new RunLease(claim.runId, workerId, claim.runVersion);
    const deadlineMs = Math.max(1, Date.parse(claim.limits.deadlineAt) - Date.now());
    const deadlineSignal = AbortSignal.timeout(deadlineMs);
    const leaseController = new AbortController();
    const signal = AbortSignal.any([
      workerSignal,
      deadlineSignal,
      leaseController.signal,
    ]);
    const context: AgentRunContext = { client: this.client, lease, signal };
    const renewal = this.startLeaseRenewal(lease, signal, leaseController);
    let activitySequence = 1;
    try {
      const graph = await this.graphs.create(claim, lease, this.client, signal);
      const toolCheckpoint = new ToolExecutionCheckpoint(this.client, lease, this.config);
      await this.client.activity(
        lease,
        activitySequence++,
        'run_started',
        'OpenAI Agents SDK started the task.',
        signal,
      );
      let checkpointRevision = claim.checkpoint?.revision ?? 0;
      let deliveredControlSequence = claim.lastControlSequence;
      let nextRequest: string | AgentInputItem[] = claim.request;
      let state = claim.checkpoint
        ? await RunState.fromStringWithContext(
            graph.agent,
            claim.checkpoint.state,
            new RunContext(context),
          )
        : undefined;

      if (state && claim.checkpoint?.pendingCallId === null) {
        const currentStep = state.toJSON().currentStep;
        if (currentStep?.type !== 'next_step_final_output') {
          throw new Error('terminal_checkpoint_missing_final_output');
        }
        const finalOutput = boundedFinalOutput(currentStep.output);
        const steeringRequest = await this.completeOrLoadSteering(
          lease,
          finalOutput,
          deliveredControlSequence,
          signal,
        );
        if (steeringRequest === null) return;
        deliveredControlSequence = steeringRequest.sequence;
        nextRequest = steeringRequest.request;
        state = undefined;
      }

      for (;;) {
        const result = await this.graphs.runner.run(
          graph.agent,
          state ?? nextRequest,
          {
            callModelInputFilter: async ({ modelData }) => {
              const updates = await this.client.steeringUpdates(
                lease,
                deliveredControlSequence,
                signal,
              );
              if (updates.items.length === 0) return modelData;
              deliveredControlSequence = Math.max(
                deliveredControlSequence,
                ...updates.items.map((item) => item.sequence),
              );
              return injectSteering(
                modelData,
                updates.items.map((item) => item.instruction),
              );
            },
            context,
            maxTurns: claim.limits.maxModelSamples,
            session: graph.session,
            signal,
          },
        );
        if (result.interruptions.length === 0) {
          checkpointRevision = await this.client.putCheckpoint(
            lease,
            {
              expectedCheckpointRevision: checkpointRevision,
              appliedControlSequence: deliveredControlSequence,
              sdkVersion: this.config.sdkVersion,
              graphVersion: this.config.graphVersion,
              pendingCallId: null,
              state: result.state.toString(),
            },
            signal,
          );
          const finalOutput = boundedFinalOutput(result.finalOutput);
          const steeringRequest = await this.completeOrLoadSteering(
            lease,
            finalOutput,
            deliveredControlSequence,
            signal,
          );
          if (steeringRequest === null) return;
          deliveredControlSequence = steeringRequest.sequence;
          nextRequest = steeringRequest.request;
          state = undefined;
          continue;
        }
        if (result.interruptions.length !== 1) {
          throw new Error('parallel_tool_interruption_not_supported');
        }

        const [interruption] = result.interruptions;
        if (!interruption) throw new Error('missing_sdk_interruption');
        const pending = graph.toolSurface.resolve(interruption);
        checkpointRevision = await toolCheckpoint.commit(
          checkpointRevision,
          deliveredControlSequence,
          result.state.toString(),
          pending,
          signal,
        );
        await this.client.activity(
          lease,
          activitySequence++,
          'tool_started',
          'A tool call was durably queued.',
          signal,
        );
        result.state.approve(interruption);
        state = result.state;
      }
    } catch (error) {
      if (workerSignal.aborted) {
        await this.bestEffortRelease(lease);
        return;
      }
      const failure = classifyFailure(error, deadlineSignal.aborted);
      try {
        await this.client.fail(lease, failure);
      } catch (failError) {
        if (!(failError instanceof ControlPlaneError && failError.code === 'lease_conflict')) {
          throw failError;
        }
      }
    } finally {
      clearInterval(renewal);
    }
  }

  private startLeaseRenewal(
    lease: RunLease,
    signal: AbortSignal,
    leaseController: AbortController,
  ): NodeJS.Timeout {
    return setInterval(() => {
      if (signal.aborted) return;
      void this.client.renew(lease, signal).catch((error: unknown) => {
        if (error instanceof ControlPlaneError && error.code === 'lease_conflict') {
          leaseController.abort(error);
          return;
        }
        console.error('agent_runtime_lease_renewal_failed');
      });
    }, 5_000);
  }

  private async completeOrLoadSteering(
    lease: RunLease,
    finalOutput: string,
    deliveredControlSequence: number,
    signal: AbortSignal,
  ): Promise<{ readonly request: AgentInputItem[]; readonly sequence: number } | null> {
    try {
      await this.client.complete(
        lease,
        finalOutput,
        deliveredControlSequence,
        signal,
      );
      return null;
    } catch (error) {
      if (!(error instanceof ControlPlaneError && error.code === 'steering_pending')) {
        throw error;
      }
    }

    const updates = await this.client.steeringUpdates(
      lease,
      deliveredControlSequence,
      signal,
    );
    if (updates.items.length === 0) {
      throw new Error('steering_pending_without_update');
    }
    return {
      request: steeringInput(updates.items.map((item) => item.instruction)),
      sequence: Math.max(...updates.items.map((item) => item.sequence)),
    };
  }

  private async bestEffortRelease(lease: RunLease): Promise<void> {
    try {
      await this.client.release(lease);
    } catch {
      // A stale lease is already recoverable by another worker.
    }
  }
}

function injectSteering(
  modelData: ModelInputData,
  instructions: readonly string[],
): ModelInputData {
  if (instructions.length === 0) return modelData;
  const input = modelData.input as AgentInputItem[];
  return { ...modelData, input: [...input, ...steeringInput(instructions)] };
}

function steeringInput(instructions: readonly string[]): AgentInputItem[] {
  return instructions.map((instruction) => ({
    role: 'user',
    content: [{ type: 'input_text', text: instruction }],
  }));
}

function boundedFinalOutput(value: unknown): string {
  const output = typeof value === 'string' ? value.trim() : JSON.stringify(value);
  if (!output) throw new Error('empty_agent_output');
  return output.slice(0, 8_000);
}

function classifyFailure(
  error: unknown,
  deadlineExpired: boolean,
): Parameters<ControlPlaneClient['fail']>[1] {
  if (error instanceof ToolOutcomeUnknownError) {
    return {
      stage: 'tool_execution',
      code: 'tool_outcome_unknown',
      message: 'A tool may have completed, so the action was not repeated.',
      retryable: false,
    };
  }
  if (error instanceof ControlPlaneError) {
    if (error.code === 'session_conflict') {
      return {
        stage: 'session',
        code: 'session_conflict',
        message: 'The durable SDK session changed unexpectedly.',
        retryable: false,
      };
    }
    if (error.code === 'graph_version_mismatch' || error.code === 'catalog_mismatch') {
      return {
        stage: 'runtime',
        code: 'graph_version_mismatch',
        message: 'The claimed run is incompatible with this worker release.',
        retryable: false,
      };
    }
    if (error.code === 'provider_outcome_unknown') {
      return {
        stage: 'provider_dispatch',
        code: 'provider_outcome_unknown',
        message: 'The model-provider outcome is unknown and was not retried.',
        retryable: false,
      };
    }
    if (error.code === 'tool_limit_exceeded') {
      return {
        stage: 'runtime',
        code: 'internal_runtime_error',
        message: 'The task reached its server-owned tool-call limit.',
        retryable: false,
      };
    }
    return {
      stage: 'provider_request',
      code: error.retryable ? 'provider_unavailable' : 'provider_request_rejected',
      message: error.retryable
        ? 'The model provider is temporarily unavailable.'
        : 'The orchestrator request was rejected.',
      retryable: error.retryable,
    };
  }
  if (providerOutcomeIsUnknown(error)) {
    return {
      stage: 'provider_dispatch',
      code: 'provider_outcome_unknown',
      message: 'The model-provider outcome is unknown and was not retried.',
      retryable: false,
    };
  }
  if (deadlineExpired) {
    return {
      stage: 'runtime',
      code: 'internal_runtime_error',
      message: 'The task reached its server-owned deadline.',
      retryable: false,
    };
  }
  return {
    stage: 'runtime',
    code: 'internal_runtime_error',
    message: 'The Agents SDK worker could not continue this task.',
    retryable: false,
  };
}

function providerOutcomeIsUnknown(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  if (
    record.code === 'ambiguous_dispatch' ||
    record.code === 'ambiguous_response' ||
    record.code === 'provider_outcome_unknown'
  ) {
    return true;
  }
  return providerOutcomeIsUnknown(record.error);
}
