import { randomUUID } from 'node:crypto';

import {
  AgentTaskContractV10Schema,
  CancelTaskRequestSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  type TaskSnapshot,
} from '../../shared/contracts';
import type { TrustedToolExecutionContext } from '../agent/runtime-tool-registry';
import { shouldObserveInitialScreenContext } from '../agent/screen-context-policy';
import type { TaskRuntime } from '../agent/task-runtime';
import { createWalkthroughState } from '../agent/walkthrough-policy';
import type { AgentRuntimeAdapter } from '../agent-runtime/agent-runtime-adapter';
import type { EncryptedAgentStateStore } from '../agent-runtime/encrypted-agent-state-store';
import type { ActivityContextService } from '../knowledge/activity-context-service';
import type { ActivityProgressReporter } from '../knowledge/activity-progress-reporter';
import type { ClassroomSessionService } from '../knowledge/classroom-session-service';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

const DEFAULT_LIMITS = {
  maxImages: 20,
  maxMicroUsd: 5_000_000,
  maxMinutes: 30,
  maxModelSamples: 40,
  maxToolCalls: 30,
} as const;

interface TaskApplicationServiceOptions {
  activityContextService?: Pick<ActivityContextService, 'create' | 'inspect'>;
  activityProgressReporter?: Pick<ActivityProgressReporter, 'bind' | 'fail'>;
  classroomSessionService?: Pick<ClassroomSessionService, 'activeStudentAttemptId' | 'latestDirective'>;
  currentOwnerId?(): Promise<string>;
  localRuntime?: AgentRuntimeAdapter;
  state?: EncryptedAgentStateStore;
  workspaceSelectionService?: Pick<WorkspaceSelectionService, 'resolve'>;
}

export class TaskApplicationService {
  private readonly executionContexts = new Map<string, TrustedToolExecutionContext>();

  constructor(
    private readonly runtime: TaskRuntime,
    private readonly options: TaskApplicationServiceOptions = {},
  ) {}

  async submitAndStart(input: unknown): Promise<TaskSnapshot> {
    const request = SubmitTaskRequestSchema.parse(input);
    if (!this.options.localRuntime || !this.options.state || !this.options.currentOwnerId) {
      throw new Error('The local Agents SDK runtime is not configured.');
    }
    const joinedAttemptId = this.options.classroomSessionService?.activeStudentAttemptId() ?? null;
    const activityAttemptId = request.activityAttemptId ?? joinedAttemptId;
    if (!activityAttemptId && request.activityIntent !== 'work') {
      throw new Error('Join an active class before using Help or Check.');
    }
    const attempt = activityAttemptId
      ? await this.options.activityContextService?.inspect(activityAttemptId)
      : null;
    if (activityAttemptId && !attempt) throw new Error('This assigned Activity is unavailable.');
    const executionProfile = attempt?.definition.launchTarget === 'workspace'
      ? 'workspace'
      : activityAttemptId ? 'everyday' : request.executionProfile;
    const workspace = request.workspaceSelectionId
      ? await this.options.workspaceSelectionService?.resolve(request.workspaceSelectionId)
      : null;
    if (executionProfile === 'workspace' && !workspace) {
      throw new Error('Select a trusted workspace before starting Workspace mode.');
    }
    if (executionProfile !== 'workspace' && workspace) {
      throw new Error('This Activity does not grant Workspace authority.');
    }
    const taskId = randomUUID();
    const activity = attempt
      ? await this.options.activityContextService?.create(
          attempt,
          taskId,
          attempt.definition.launchTarget,
          request.activityIntent,
          joinedAttemptId === activityAttemptId
            ? this.options.classroomSessionService?.latestDirective() ?? null
            : null,
        )
      : null;
    if (activityAttemptId && !activity) throw new Error('Could not create the Activity Work Session.');
    if (activity) this.options.activityProgressReporter?.bind(taskId, activity.workSessionId);

    const authority = AgentTaskContractV10Schema.parse({
      schemaVersion: 10,
      id: randomUUID(),
      originalRequest: request.text,
      runtimeKind: 'openai_agents_sdk',
      executionProfile,
      workspace: workspace ?? null,
      activity: activity ?? null,
      limits: DEFAULT_LIMITS,
    });
    try {
      const walkthroughState = createWalkthroughState(
        authority.executionProfile !== 'workspace' ? request.text : false,
      );
      const snapshot = this.runtime.submit(
        { ...request, activityAttemptId, executionProfile },
        { authority, taskId },
      );
      await this.options.state.create(await this.options.currentOwnerId(), snapshot);
      const started = this.runtime.start({ taskId });
      const executionContext: TrustedToolExecutionContext = {
        activity: authority.activity,
        executionProfile: authority.executionProfile,
        taskId,
        workspace: authority.workspace,
      };
      this.executionContexts.set(taskId, executionContext);
      await this.options.localRuntime.start({
        executionContext,
        maxTurns: authority.limits.maxModelSamples,
        request: request.text,
        walkthroughState,
        ...(
          authority.executionProfile !== 'workspace' &&
          (authority.activity?.activity.launchTarget === 'current_surface' ||
            shouldObserveInitialScreenContext(request.text))
            ? {
                requiredInitialTool: {
                  modelName: 'observe_context',
                  arguments: {
                    operation: 'observe',
                    scope: walkthroughState.enabled ? 'desktop' : 'auto',
                    reason: walkthroughState.enabled
                      ? 'Ground the first teacher walkthrough step in the desktop.'
                      : 'Ground the response in the current visible context.',
                    query: null,
                    observationId: null,
                    region: null,
                  },
                },
              }
            : {}
        ),
        threadId: taskId,
      });
      return started;
    } catch (error) {
      this.executionContexts.delete(taskId);
      try {
        const snapshot = this.runtime.getSnapshot(taskId);
        if (!['completed', 'failed', 'cancelled', 'blocked'].includes(snapshot.phase)) {
          this.runtime.complete(taskId, {
            status: 'failed',
            finalOutput: null,
            message: error instanceof Error
              ? error.message
              : 'The local agent could not start.',
          });
        }
      } catch {
        // Persistence or authority validation may fail before a task exists.
      }
      await this.options.activityProgressReporter?.fail(taskId);
      throw error;
    }
  }

  start(input: unknown): TaskSnapshot {
    const request = StartTaskRequestSchema.parse(input);
    return this.runtime.getSnapshot(request.taskId);
  }

  async cancel(input: unknown): Promise<TaskSnapshot> {
    const request = CancelTaskRequestSchema.parse(input);
    this.options.localRuntime?.cancel(request.taskId, request.source);
    this.executionContexts.delete(request.taskId);
    return this.runtime.cancel(request);
  }

  async cancelActiveTasks(): Promise<void> {
    for (const taskId of this.executionContexts.keys()) {
      this.options.localRuntime?.cancel(taskId, 'shutdown');
    }
  }

  respond(input: unknown): TaskSnapshot {
    return this.runtime.respondToInteraction(RespondToInteractionRequestSchema.parse(input));
  }

  async steer(input: unknown): Promise<TaskSnapshot> {
    const request = SteerTaskRequestSchema.parse(input);
    this.options.localRuntime?.steer(request.taskId, request.instruction);
    return this.runtime.steer(request);
  }

  executionContext(taskId: string): TrustedToolExecutionContext | undefined {
    return this.executionContexts.get(taskId);
  }

  async restoreLocalTasks(): Promise<number> {
    if (!this.options.state || !this.options.localRuntime || !this.options.currentOwnerId) return 0;
    const states = await this.options.state.listActive(await this.options.currentOwnerId());
    let restored = 0;
    for (const state of states) {
      const goal = state.snapshot.goal;
      if (goal?.schemaVersion !== 10) continue;
      this.runtime.restore(state.snapshot);
      const executionContext: TrustedToolExecutionContext = {
        activity: goal.activity,
        executionProfile: goal.executionProfile,
        taskId: state.snapshot.taskId,
        workspace: goal.workspace,
      };
      this.executionContexts.set(state.snapshot.taskId, executionContext);
      try {
        await this.options.localRuntime.resume(state.snapshot.taskId, executionContext);
        restored += 1;
      } catch (error) {
        this.runtime.complete(state.snapshot.taskId, {
          status: 'failed', finalOutput: null,
          message: error instanceof Error ? error.message : 'The local checkpoint could not be resumed.',
        });
      }
    }
    return restored;
  }

  finish(taskId: string): void { this.executionContexts.delete(taskId); }
}
