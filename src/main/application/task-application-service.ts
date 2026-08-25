import { randomUUID } from 'node:crypto';

import {
  CancelTaskRequestSchema,
  DecideApprovalRequestSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  type GoalSpec,
  type HostedTaskEvent,
  type HostedTaskRecord,
  type TaskSnapshot,
} from '../../shared/contracts';
import type { TaskRuntime } from '../agent/task-runtime';
import type { ActivityContextService } from '../knowledge/activity-context-service';
import type { ActivityProgressReporter } from '../knowledge/activity-progress-reporter';
import type { ClassroomSessionService } from '../knowledge/classroom-session-service';
import type { AppPreferencesService } from '../preferences/app-preferences-service';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

import {
  HostedTaskOutcomeUnknownError,
  projectHostedTask,
  type HostedTaskClient,
} from './hosted-task-client';

interface TaskApplicationServiceOptions {
  activityContextService?: Pick<ActivityContextService, 'create' | 'inspect'>;
  activityProgressReporter?: Pick<ActivityProgressReporter, 'bind' | 'fail'>;
  classroomSessionService?: Pick<ClassroomSessionService, 'activeStudentAttemptId' | 'latestDirective'>;
  appPreferencesService?: Pick<AppPreferencesService, 'get'>;
  workspaceSelectionService?: Pick<WorkspaceSelectionService, 'resolve'>;
  hostedTaskClient?: Pick<
    HostedTaskClient,
    'cancel' | 'decideApproval' | 'get' | 'list' | 'steer' | 'submit' | 'subscribe'
  >;
  onHostedTerminal?: (taskId: string) => Promise<void> | void;
}

export class TaskApplicationService {
  private readonly hostedByTask = new Map<string, {
    controller: AbortController;
    record: HostedTaskRecord;
    snapshot: TaskSnapshot;
  }>();

  constructor(
    private readonly runtime: TaskRuntime,
    private readonly options: TaskApplicationServiceOptions = {},
  ) {}

  async submitAndStart(input: unknown): Promise<TaskSnapshot> {
    const request = SubmitTaskRequestSchema.parse(input);
    const preferences = await this.options.appPreferencesService?.get();
    const joinedAttemptId = this.options.classroomSessionService?.activeStudentAttemptId() ?? null;
    const activityAttemptId = request.activityAttemptId ?? joinedAttemptId;
    if (!activityAttemptId && request.activityIntent !== 'work') {
      throw new Error('Join an active class before using Help or Check.');
    }
    const attempt = activityAttemptId
      ? await this.options.activityContextService?.inspect(activityAttemptId)
      : null;
    if (activityAttemptId && !attempt) {
      throw new Error('This assigned Activity is unavailable.');
    }
    const executionProfile = attempt?.definition.launchTarget === 'workspace'
      ? 'workspace'
      : activityAttemptId
        ? 'everyday'
        : request.executionProfile;
    const workspace = request.workspaceSelectionId
      ? await this.options.workspaceSelectionService?.resolve(
          request.workspaceSelectionId,
        )
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
    if (activityAttemptId && !activity) {
      throw new Error('Could not create the Activity Work Session.');
    }
    if (activity) this.options.activityProgressReporter?.bind(taskId, activity.workSessionId);
    const autonomyMode = preferences?.autonomyMode ?? 'balanced';
    try {
      if (!this.options.hostedTaskClient) {
        throw new Error('The Rust agent runtime is not configured.');
      }
      const record = await this.options.hostedTaskClient.submit({
        clientTaskId: randomUUID(),
        taskId,
        request: request.text,
        autonomyMode,
        executionProfile,
        workspaceSelectionId: request.workspaceSelectionId,
        activityAttemptId,
        activityIntent: request.activityIntent,
      });
      if (
        record.contractSchemaVersion !== 8 ||
        !record.contract
      ) {
        throw new Error('The hosted runtime did not return a compatible task authority contract.');
      }
      if (
        activity &&
        (
          !record.contract.activity ||
          record.contract.activity.attemptId !== activity.attemptId ||
          record.contract.activity.workSessionId !== activity.workSessionId ||
          record.contract.activity.purpose !== request.activityIntent
        )
      ) {
        throw new Error('The hosted runtime returned mismatched Activity authority.');
      }
      this.runtime.submit(
        { ...request, activityAttemptId, executionProfile },
        {
          authority: record.contract,
          taskId,
          workspace: workspace ?? null,
        },
      );
      const snapshot = this.runtime.start({ taskId });
      this.attachHostedRun(record, snapshot);
      return snapshot;
    } catch (error) {
      if (!(error instanceof HostedTaskOutcomeUnknownError)) {
        await this.options.activityProgressReporter?.fail(taskId);
      }
      throw error;
    }
  }

  start(input: unknown): TaskSnapshot {
    const request = StartTaskRequestSchema.parse(input);
    const hosted = this.hostedByTask.get(request.taskId);
    if (!hosted) throw new Error('The task is not owned by the Rust runtime.');
    return hosted.snapshot;
  }

  async cancel(input: unknown): Promise<TaskSnapshot> {
    const request = CancelTaskRequestSchema.parse(input);
    const hosted = this.hostedByTask.get(request.taskId);
    if (!hosted || !this.options.hostedTaskClient) {
      throw new Error('The task is not owned by the Rust runtime.');
    }
    const record = await this.options.hostedTaskClient.cancel(hosted.record.id);
    hosted.record = record;
    hosted.snapshot = projectHostedTask(record, undefined, hosted.snapshot);
    return hosted.snapshot;
  }

  async cancelActiveTasks(): Promise<void> {
    if (!this.options.hostedTaskClient) return;
    const active = [...this.hostedByTask.entries()].filter(([, hosted]) =>
      !['completed', 'blocked', 'failed', 'cancelled', 'expired'].includes(
        hosted.record.state,
      ),
    );
    await Promise.allSettled(
      active.map(async ([taskId, hosted]) => {
        const record = await this.options.hostedTaskClient?.cancel(
          hosted.record.id,
        );
        if (!record) return;
        hosted.record = record;
        hosted.snapshot = projectHostedTask(record, undefined, hosted.snapshot);
        hosted.controller.abort();
        await this.options.onHostedTerminal?.(taskId);
      }),
    );
  }

  respond(input: unknown): TaskSnapshot {
    const request = RespondToInteractionRequestSchema.parse(input);
    if (!this.hostedByTask.has(request.taskId)) {
      throw new Error('The task is not owned by the Rust runtime.');
    }
    return this.runtime.respondToInteraction(request);
  }

  decideApproval(input: unknown): TaskSnapshot {
    const request = DecideApprovalRequestSchema.parse(input);
    if (!this.hostedByTask.has(request.taskId)) {
      throw new Error('The task is not owned by the Rust runtime.');
    }
    return this.runtime.decideApproval(request);
  }

  async steer(input: unknown): Promise<TaskSnapshot> {
    const request = SteerTaskRequestSchema.parse(input);
    const hosted = this.hostedByTask.get(request.taskId);
    if (hosted && this.options.hostedTaskClient) {
      await this.options.hostedTaskClient.steer(
        hosted.record.id,
        randomUUID(),
        request.instruction,
      );
      const record = await this.options.hostedTaskClient.get(hosted.record.id);
      if (
        record.contractSchemaVersion !== 8 ||
        !record.contract
      ) {
        throw new Error('The revised hosted authority contract is incompatible.');
      }
      const synchronized = this.runtime.synchronizeHostedAuthority(
        hosted.record.taskId,
        record.contract,
      );
      hosted.record = record;
      hosted.snapshot = {
        ...hosted.snapshot,
        goal: synchronized.goal,
        outcomes: synchronized.outcomes,
        approvalGrant: null,
      };
      return hosted.snapshot;
    }
    throw new Error('The task is not owned by the Rust runtime.');
  }

  hostedGoal(runId: string): GoalSpec | undefined {
    return [...this.hostedByTask.values()].find((entry) => entry.record.id === runId)
      ?.snapshot.goal ?? undefined;
  }

  taskIdForHostedRun(runId: string): string | undefined {
    for (const [taskId, entry] of this.hostedByTask) {
      if (entry.record.id === runId) return taskId;
    }
    return undefined;
  }

  async restoreHostedRuns(): Promise<number> {
    if (!this.options.hostedTaskClient) return 0;
    const records = await this.options.hostedTaskClient.list();
    const active = records.filter((record) =>
      !['completed', 'blocked', 'failed', 'cancelled', 'expired'].includes(record.state),
    );
    let restored = 0;
    for (const record of active) {
      if (this.hostedByTask.has(record.taskId)) continue;
      const workspace = record.workspaceSelectionId
        ? await this.options.workspaceSelectionService?.resolve(record.workspaceSelectionId)
        : null;
      if (record.executionProfile === 'workspace' && !workspace) continue;
      if (record.contractSchemaVersion !== 8 || !record.contract) continue;
      this.runtime.submit(
        {
          activityAttemptId: record.activity?.attemptId ?? null,
          activityIntent: record.activity?.purpose ?? 'work',
          executionProfile: record.executionProfile,
          text: record.request,
          workspaceSelectionId: record.workspaceSelectionId,
        },
        {
          authority: record.contract,
          taskId: record.taskId,
          workspace: workspace ?? null,
        },
      );
      const snapshot = this.runtime.start({ taskId: record.taskId });
      if (record.contract.activity) {
        this.options.activityProgressReporter?.bind(
          record.taskId,
          record.contract.activity.workSessionId,
        );
      }
      this.attachHostedRun(record, snapshot);
      restored += 1;
    }
    return restored;
  }

  private attachHostedRun(record: HostedTaskRecord, snapshot: TaskSnapshot): void {
    if (!this.options.hostedTaskClient) return;
    const taskId = record.taskId;
    const controller = new AbortController();
    this.hostedByTask.set(taskId, { controller, record, snapshot });
    void this.options.hostedTaskClient
      .subscribe(
        record.id,
        (event) => this.applyHostedEvent(taskId, event),
        controller.signal,
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const current = this.hostedByTask.get(taskId);
        if (!current) return;
        this.applyHostedEvent(taskId, {
          id: randomUUID(),
          runId: current.record.id,
          sequence: Number.MAX_SAFE_INTEGER,
          type: 'run.connection_failed',
          summary: error instanceof Error
            ? `Hosted task connection failed: ${error.message}`
            : 'Hosted task connection failed.',
          createdAt: new Date().toISOString(),
        });
      });
  }

  private applyHostedEvent(taskId: string, event: HostedTaskEvent): void {
    const hosted = this.hostedByTask.get(taskId);
    if (!hosted) return;
    const stateByType: Partial<Record<string, HostedTaskRecord['state']>> = {
      'run.awaiting_worker': 'awaiting_worker',
      'run.blocked': 'blocked',
      'run.cancelled': 'cancelled',
      'run.completed': 'completed',
      'run.connection_failed': 'recovering',
      'run.outcomes_incomplete': 'blocked',
      'run.planning': 'planning',
      'tool.completed': 'verifying',
      'tool.requested': 'awaiting_worker',
    };
    hosted.record = {
      ...hosted.record,
      state: stateByType[event.type] ?? hosted.record.state,
      publicSummary: event.summary,
      updatedAt: event.createdAt,
    };
    hosted.snapshot = this.runtime.projectHostedSnapshot(
      projectHostedTask(hosted.record, event, hosted.snapshot),
    );
    const lastEvent = hosted.snapshot.lastEvent;
    if (!lastEvent) return;
    if (['completed', 'blocked', 'failed', 'cancelled', 'expired'].includes(hosted.record.state)) {
      hosted.controller.abort();
      void this.options.onHostedTerminal?.(taskId);
    }
  }
}
