import { randomUUID } from 'node:crypto';

import {
  CancelTaskRequestSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SteerTaskRequestSchema,
  SubmitTaskRequestSchema,
  type HostedTaskEvent,
  type HostedTaskRecord,
  type TaskSnapshot,
} from '../../shared/contracts';
import {
  isLegacyHostedTaskTerminal,
  legacyHostedStateForEvent,
} from '../../shared/legacy-agent-runtime-v2';
import type { TrustedToolExecutionContext } from '../agent/runtime-tool-registry';
import type { TaskRuntime } from '../agent/task-runtime';
import type { ActivityContextService } from '../knowledge/activity-context-service';
import type { ActivityProgressReporter } from '../knowledge/activity-progress-reporter';
import type { ClassroomSessionService } from '../knowledge/classroom-session-service';
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
  workspaceSelectionService?: Pick<WorkspaceSelectionService, 'resolve'>;
  hostedTaskClient?: Pick<
    HostedTaskClient,
    'cancel' | 'get' | 'list' | 'steer' | 'submit' | 'subscribe'
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
    try {
      if (!this.options.hostedTaskClient) {
        throw new Error('The Rust agent runtime is not configured.');
      }
      const record = await this.options.hostedTaskClient.submit({
        clientTaskId: randomUUID(),
        taskId,
        request: request.text,
        executionProfile,
        workspaceSelectionId: request.workspaceSelectionId,
        activityAttemptId,
        activityIntent: request.activityIntent,
      });
      if (
        record.contractSchemaVersion !== 10 ||
        record.contract?.schemaVersion !== 10
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
    const record = await this.options.hostedTaskClient.cancel(
      hosted.record.id,
      hosted.record.runVersion,
      request.source,
    );
    hosted.record = record;
    hosted.snapshot = projectHostedTask(record, undefined, hosted.snapshot);
    return hosted.snapshot;
  }

  async cancelActiveTasks(): Promise<void> {
    if (!this.options.hostedTaskClient) return;
    const active = [...this.hostedByTask.entries()].filter(
      ([, hosted]) =>
        !(hosted.record.lifecycle?.terminal ??
          isLegacyHostedTaskTerminal(hosted.record.state)),
    );
    await Promise.allSettled(
      active.map(async ([taskId, hosted]) => {
        const record = await this.options.hostedTaskClient?.cancel(
          hosted.record.id,
          hosted.record.runVersion,
          'shutdown',
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
        record.contractSchemaVersion !== 10 ||
        record.contract?.schemaVersion !== 10
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
      };
      return hosted.snapshot;
    }
    throw new Error('The task is not owned by the Rust runtime.');
  }

  hostedExecutionContext(runId: string): TrustedToolExecutionContext | undefined {
    for (const [taskId, entry] of this.hostedByTask) {
      if (entry.record.id !== runId) continue;
      const goal = entry.snapshot.goal;
      if (goal?.schemaVersion !== 10) return undefined;
      return {
        activity: goal.activity,
        executionProfile: goal.executionProfile,
        taskId,
        workspace: goal.workspace,
      };
    }
    return undefined;
  }

  async restoreHostedRuns(): Promise<number> {
    if (!this.options.hostedTaskClient) return 0;
    const records = await this.options.hostedTaskClient.list();
    const active = records.filter(
      (record) =>
        !(record.lifecycle?.terminal ??
          isLegacyHostedTaskTerminal(record.state)),
    );
    let restored = 0;
    for (const record of active) {
      if (this.hostedByTask.has(record.taskId)) continue;
      const workspace = record.workspaceSelectionId
        ? await this.options.workspaceSelectionService?.resolve(record.workspaceSelectionId)
        : null;
      if (record.executionProfile === 'workspace' && !workspace) continue;
      if (record.contractSchemaVersion !== 10 || record.contract?.schemaVersion !== 10) continue;
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
        current.snapshot = {
          ...current.snapshot,
          updatedAt: new Date().toISOString(),
          lastEvent: current.snapshot.lastEvent
            ? {
                ...current.snapshot.lastEvent,
                status: 'warning',
                summary:
                  error instanceof Error
                    ? `Hosted task connection failed: ${error.message}`
                    : 'Hosted task connection failed.',
              }
            : null,
        };
      });
  }

  private applyHostedEvent(taskId: string, event: HostedTaskEvent): void {
    const hosted = this.hostedByTask.get(taskId);
    if (!hosted) return;
    if (
      event.runVersion !== undefined &&
      event.runVersion < hosted.record.runVersion
    ) {
      return;
    }
    const lifecycle = event.lifecycle;
    const legacyState = lifecycle
      ? undefined
      : legacyHostedStateForEvent(event.type);
    hosted.record = {
      ...hosted.record,
      state: lifecycle?.state ?? legacyState ?? hosted.record.state,
      runVersion: lifecycle?.runVersion ?? hosted.record.runVersion,
      ...(lifecycle ? { lifecycle } : {}),
      publicSummary: event.summary,
      updatedAt: event.createdAt,
    };
    hosted.snapshot = this.runtime.projectHostedSnapshot(
      projectHostedTask(hosted.record, event, hosted.snapshot),
    );
    const lastEvent = hosted.snapshot.lastEvent;
    if (!lastEvent) return;
    if (
      hosted.record.lifecycle?.terminal ??
      isLegacyHostedTaskTerminal(hosted.record.state)
    ) {
      hosted.controller.abort();
      void this.options.onHostedTerminal?.(taskId);
    }
  }
}
