import { randomUUID } from 'node:crypto';

import {
  AgentTaskContractV11Schema,
  CancelTaskRequestSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  type ClassroomSessionProjection,
  type TaskRoute,
  type TaskSnapshot,
} from '../../shared/contracts';
import type { TrustedToolExecutionContext } from '../agent/runtime-tool-registry';
import { shouldObserveInitialScreenContext } from '../agent/screen-context-policy';
import type { TaskRuntime } from '../agent/task-runtime';
import type { AgentRuntimeAdapter } from '../agent-runtime/agent-runtime-adapter';
import type { EncryptedAgentStateStore } from '../agent-runtime/encrypted-agent-state-store';
import type { CoachRuntime } from '../coach/coach-runtime';
import type { ActivityContextService } from '../knowledge/activity-context-service';
import type { ActivityProgressReporter } from '../knowledge/activity-progress-reporter';
import type { ClassroomSessionService } from '../knowledge/classroom-session-service';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

import { routeTaskRequest } from './task-request-router';

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
  classroomSessionService?: Pick<ClassroomSessionService, 'activeStudentAttemptId' | 'latestDirective' | 'onChange'>;
  coachRuntime?: Pick<CoachRuntime, 'cancel' | 'shutdown' | 'start'>;
  currentOwnerId?(): Promise<string>;
  fastCoachEnabled?: boolean;
  localRuntime?: AgentRuntimeAdapter;
  state?: EncryptedAgentStateStore;
  workspaceSelectionService?: Pick<WorkspaceSelectionService, 'resolve'>;
}

export class TaskApplicationService {
  private readonly executionContexts = new Map<string, TrustedToolExecutionContext>();
  private readonly inheritedClassroomTasks = new Set<string>();
  private readonly routes = new Map<string, TaskRoute>();

  constructor(
    private readonly runtime: TaskRuntime,
    private readonly options: TaskApplicationServiceOptions = {},
  ) {
    options.classroomSessionService?.onChange((session) => {
      this.cancelInvalidClassroomTasks(session);
    });
  }

  async submitAndStart(input: unknown): Promise<TaskSnapshot> {
    const request = SubmitTaskRequestSchema.parse(input);
    if (!this.options.state || !this.options.currentOwnerId) {
      throw new Error('Local task persistence is not configured.');
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
    const routeDecision = this.fastCoachEnabled()
      ? routeTaskRequest({
          activityLaunchTarget: attempt?.definition.launchTarget ?? null,
          executionProfile,
          intent: request.activityIntent,
          requestedMode: request.requestedMode,
          screenContext: request.screenContext,
          text: request.text,
        })
      : { route: 'agent' as const, requiresObservation: false };
    if (routeDecision.route === 'agent' && !this.options.localRuntime) {
      throw new Error('The local Agents SDK runtime is not configured.');
    }
    if (routeDecision.route === 'coach' && !this.options.coachRuntime) {
      throw new Error('Tro Coach is not configured.');
    }
    const ownerId = await this.options.currentOwnerId();
    const priorProgress = routeDecision.route === 'coach' && attempt
      ? await this.options.state.findLatestCoachProgress(
          ownerId,
          attempt.attemptId,
          attempt.activityVersionId,
        )
      : null;
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

    const authorityExecutionProfile = routeDecision.route === 'coach'
      ? 'everyday'
      : executionProfile;
    const authority = AgentTaskContractV11Schema.parse({
      schemaVersion: 11,
      id: randomUUID(),
      originalRequest: request.text,
      runtimeKind: routeDecision.route === 'coach' ? 'coach' : 'openai_agents_sdk',
      route: routeDecision.route,
      executionProfile: authorityExecutionProfile,
      workspace: routeDecision.route === 'coach' ? null : workspace ?? null,
      activity: activity ?? null,
      coachProgress: priorProgress,
      limits: DEFAULT_LIMITS,
    });
    try {
      const snapshot = this.runtime.submit(
        { ...request, activityAttemptId, executionProfile },
        { authority, taskId },
      );
      await this.options.state.create(ownerId, snapshot);
      const started = this.runtime.start({ taskId });
      const executionContext: TrustedToolExecutionContext = {
        activity: authority.activity,
        executionProfile: authority.executionProfile,
        taskId,
        workspace: authority.workspace,
      };
      this.executionContexts.set(taskId, executionContext);
      this.routes.set(taskId, routeDecision.route);
      if (activity && joinedAttemptId === activityAttemptId) {
        this.inheritedClassroomTasks.add(taskId);
      }
      if (routeDecision.route === 'coach') {
        await this.options.coachRuntime!.start({
          taskId,
          request: request.text,
          activity: authority.activity,
          requiresObservation: routeDecision.requiresObservation,
          priorProgress,
        });
      } else {
        await this.options.localRuntime!.start({
          executionContext,
          maxTurns: authority.limits.maxModelSamples,
          request: request.text,
          ...(
            authority.executionProfile !== 'workspace' &&
            (authority.activity?.activity.launchTarget === 'current_surface' ||
              shouldObserveInitialScreenContext(request.text, request.screenContext))
              ? {
                  requiredInitialTool: {
                    modelName: 'observe_context',
                    arguments: {
                      operation: 'observe',
                      scope: 'auto',
                      reason: 'Ground the response in the current visible context.',
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
      }
      return started;
    } catch (error) {
      this.executionContexts.delete(taskId);
      this.inheritedClassroomTasks.delete(taskId);
      this.routes.delete(taskId);
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
    if (this.routes.get(request.taskId) === 'coach') {
      this.options.coachRuntime?.cancel(request.taskId);
    } else {
      this.options.localRuntime?.cancel(request.taskId, request.source);
    }
    this.executionContexts.delete(request.taskId);
    this.inheritedClassroomTasks.delete(request.taskId);
    this.routes.delete(request.taskId);
    return this.runtime.cancel(request);
  }

  async cancelActiveTasks(): Promise<void> {
    for (const taskId of this.executionContexts.keys()) {
      if (this.routes.get(taskId) === 'coach') this.options.coachRuntime?.cancel(taskId);
      else this.options.localRuntime?.cancel(taskId, 'shutdown');
    }
  }

  respond(input: unknown): TaskSnapshot {
    return this.runtime.respondToInteraction(RespondToInteractionRequestSchema.parse(input));
  }

  async steer(input: unknown): Promise<TaskSnapshot> {
    const request = SteerTaskRequestSchema.parse(input);
    if (this.routes.get(request.taskId) === 'coach') {
      throw new Error('Start a new request to change what Tro Coach is teaching.');
    }
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
      if (!goal || (goal.schemaVersion === 11 && goal.route === 'coach')) {
        this.runtime.restore(state.snapshot);
        this.runtime.complete(state.snapshot.taskId, {
          status: 'failed',
          finalOutput: null,
          message: 'Restart Coach to capture fresh screen context.',
        });
        continue;
      }
      this.runtime.restore(state.snapshot);
      const executionContext: TrustedToolExecutionContext = {
        activity: goal.activity,
        executionProfile: goal.executionProfile,
        taskId: state.snapshot.taskId,
        workspace: goal.workspace,
      };
      this.executionContexts.set(state.snapshot.taskId, executionContext);
      this.routes.set(state.snapshot.taskId, 'agent');
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

  finish(taskId: string): void {
    this.executionContexts.delete(taskId);
    this.inheritedClassroomTasks.delete(taskId);
    this.routes.delete(taskId);
  }

  private fastCoachEnabled(): boolean {
    return this.options.fastCoachEnabled ?? process.env.TROCODE_FAST_COACH_ENABLED !== 'false';
  }

  private cancelInvalidClassroomTasks(session: ClassroomSessionProjection | null): void {
    for (const [taskId, route] of this.routes) {
      if (!this.inheritedClassroomTasks.has(taskId)) continue;
      const goal = this.runtime.getSnapshot(taskId).goal;
      const activity = goal?.activity;
      if (!activity) continue;
      const invalid =
        !session ||
        session.attemptId !== activity.attemptId ||
        session.activityVersionId !== activity.activityVersionId ||
        session.run.state !== 'open' ||
        ['submitted', 'completed', 'withdrawn'].includes(session.attemptState);
      if (!invalid) continue;
      if (route === 'coach') this.options.coachRuntime?.cancel(taskId);
      else this.options.localRuntime?.cancel(taskId, 'replacement');
      this.routes.delete(taskId);
      this.executionContexts.delete(taskId);
      this.inheritedClassroomTasks.delete(taskId);
      this.runtime.cancel({ taskId, source: 'replacement' });
    }
  }
}
