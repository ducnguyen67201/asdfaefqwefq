import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  AgentTaskContractV8Schema,
  ConsumeApprovalGrantRequestSchema,
  DecideApprovalRequestSchema,
  RequestApprovalSchema,
  RequestTaskInputSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SubmitTaskRequestSchema,
  TaskSnapshotSchema,
  TaskUpdateSchema,
  type HostedTaskAuthorityContract,
  type PendingInteraction,
  type TaskEvent,
  type TaskMessage,
  type TaskSnapshot,
  type WorkspaceIdentity,
} from '../../shared/contracts';

import { createActionDigest } from './action-approval';

const APPROVAL_TTL_MS = 5 * 60 * 1_000;
const MAX_TASK_MESSAGES = 200;

export interface HostedTaskProjectionOptions {
  authority: HostedTaskAuthorityContract;
  taskId: string;
  workspace: WorkspaceIdentity | null;
}

interface TaskRuntimeOptions {
  now?: () => Date;
}

interface LocalEvent {
  nextActions?: string[];
  status?: TaskEvent['status'];
  summary: string;
}

function projectAuthority(
  authority: HostedTaskAuthorityContract,
  workspace: WorkspaceIdentity | null,
) {
  const projected: Record<string, unknown> = { ...authority };
  delete projected.workspaceSelectionId;
  return AgentTaskContractV8Schema.parse({ ...projected, workspace });
}

/**
 * Desktop projection of a Rust-owned task.
 *
 * This class owns only renderer-facing state and short-lived native approval /
 * clarification UI. It cannot compile goals, plan, sample a model, evaluate
 * policy, verify completion, or transition the canonical backend run.
 */
export class TaskRuntime extends EventEmitter {
  private readonly tasks = new Map<string, TaskSnapshot>();

  private readonly now: () => Date;

  constructor(options: TaskRuntimeOptions = {}) {
    super();
    this.now = options.now ?? (() => new Date());
  }

  submit(input: unknown, options: HostedTaskProjectionOptions): TaskSnapshot {
    const request = SubmitTaskRequestSchema.parse(input);
    if (request.text !== options.authority.originalRequest) {
      throw new Error('The Rust authority contract does not match the task request.');
    }
    if (
      options.authority.workspaceSelectionId !==
      (options.workspace?.selectionId ?? null)
    ) {
      throw new Error('The Rust authority contract does not match the trusted workspace.');
    }
    const goal = projectAuthority(options.authority, options.workspace);
    const timestamp = this.timestamp();
    const snapshot = TaskSnapshotSchema.parse({
      taskId: options.taskId,
      request: request.text,
      phase: 'ready',
      goal,
      messages: [
        {
          messageId: randomUUID(),
          taskId: options.taskId,
          role: 'user',
          kind: 'request',
          text: request.text,
          timestamp,
        },
      ],
      pendingInteraction: null,
      approvalGrant: null,
      progress: {
        kind: 'tool_calls',
        completed: 0,
        limit: goal.limits.maxToolCalls,
      },
      outcomes: {
        contractRevision: goal.outcomeContract.revision,
        criterionResults: goal.outcomeContract.criteria.map((criterion) => ({
          criterionId: criterion.id,
          status: 'pending',
          evidenceIds: [],
        })),
        evidence: [],
      },
      queuedSteering: [],
      runtimeResume: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEvent: null,
    });
    return this.commit(snapshot, {
      summary: 'Task authority received from the Rust runtime.',
      nextActions: ['Wait for the hosted run to begin.'],
    });
  }

  start(input: unknown): TaskSnapshot {
    const { taskId } = StartTaskRequestSchema.parse(input);
    const snapshot = this.getTask(taskId);
    if (snapshot.phase !== 'ready') {
      throw new Error(`Task ${taskId} is not ready to start.`);
    }
    return this.commit({ ...snapshot, phase: 'planning' }, {
      summary: 'The Rust runtime started the task.',
      nextActions: ['Wait for hosted task events.'],
    });
  }

  getSnapshot(taskId: string): TaskSnapshot {
    return TaskSnapshotSchema.parse(this.getTask(taskId));
  }

  projectHostedSnapshot(input: unknown): TaskSnapshot {
    const snapshot = TaskSnapshotSchema.parse(input);
    this.tasks.set(snapshot.taskId, snapshot);
    if (snapshot.lastEvent) {
      this.emit(
        'task-update',
        TaskUpdateSchema.parse({ event: snapshot.lastEvent, snapshot }),
      );
    }
    return snapshot;
  }

  synchronizeHostedAuthority(
    taskId: string,
    authority: HostedTaskAuthorityContract,
  ): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    const workspace =
      snapshot.goal?.schemaVersion === 8 ? snapshot.goal.workspace : null;
    if (authority.workspaceSelectionId !== (workspace?.selectionId ?? null)) {
      throw new Error('The revised Rust authority changed the trusted workspace.');
    }
    const goal = projectAuthority(authority, workspace);
    const previousResults = new Map(
      snapshot.outcomes?.criterionResults.map((result) => [
        result.criterionId,
        result,
      ]) ?? [],
    );
    const criterionIds = new Set(
      goal.outcomeContract.criteria.map((criterion) => criterion.id),
    );
    const next = TaskSnapshotSchema.parse({
      ...snapshot,
      goal,
      approvalGrant: null,
      outcomes: {
        contractRevision: goal.outcomeContract.revision,
        criterionResults: goal.outcomeContract.criteria.map(
          (criterion) =>
            previousResults.get(criterion.id) ?? {
              criterionId: criterion.id,
              status: 'pending',
              evidenceIds: [],
            },
        ),
        evidence:
          snapshot.outcomes?.evidence.filter((evidence) =>
            criterionIds.has(evidence.criterionId),
          ) ?? [],
      },
    });
    this.tasks.set(taskId, next);
    return next;
  }

  requestInput(input: unknown): TaskSnapshot {
    const request = RequestTaskInputSchema.parse(input);
    const snapshot = this.assertInteractionAvailable(request.taskId);
    const timestamp = this.timestamp();
    const interaction: PendingInteraction = {
      id: randomUUID(),
      taskId: snapshot.taskId,
      kind: 'clarification',
      prompt: request.prompt,
      createdAt: timestamp,
      ...(request.choices ? { choices: request.choices } : {}),
    };
    return this.commit(
      this.appendMessage(
        { ...snapshot, pendingInteraction: interaction, phase: 'awaiting_input' },
        { kind: 'clarification', role: 'assistant', text: request.prompt },
        timestamp,
      ),
      {
        status: 'warning',
        summary: request.prompt,
        nextActions: ['Answer the clarification to continue the Rust task.'],
      },
    );
  }

  respondToInteraction(input: unknown): TaskSnapshot {
    const request = RespondToInteractionRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const pending = this.matchPending(snapshot, request.interactionId);
    if (pending.kind !== 'clarification') {
      throw new Error('The pending interaction requires an approval decision.');
    }
    const timestamp = this.timestamp();
    return this.commit(
      this.appendMessage(
        { ...snapshot, pendingInteraction: null, phase: 'planning' },
        { kind: 'answer', role: 'user', text: request.text },
        timestamp,
      ),
      {
        summary: 'The clarification answer was returned to the Rust runtime.',
        nextActions: ['Wait for hosted task events.'],
      },
    );
  }

  requestApproval(input: unknown): TaskSnapshot {
    const request = RequestApprovalSchema.parse(input);
    const snapshot = this.assertInteractionAvailable(request.taskId);
    const createdAt = this.timestamp();
    const expiresAt = new Date(
      this.now().getTime() + APPROVAL_TTL_MS,
    ).toISOString();
    const interaction: PendingInteraction = {
      id: randomUUID(),
      taskId: snapshot.taskId,
      kind: 'approval',
      prompt: request.prompt,
      createdAt,
      expiresAt,
      actionDigest: createActionDigest(
        request.action,
        snapshot.goal?.schemaVersion === 8
          ? snapshot.goal.intentAuthorization.revision
          : null,
      ),
      action: request.action,
      consequence: request.consequence,
    };
    return this.commit(
      this.appendMessage(
        {
          ...snapshot,
          approvalGrant: null,
          pendingInteraction: interaction,
          phase: 'awaiting_approval',
        },
        { kind: 'approval_request', role: 'assistant', text: request.prompt },
        createdAt,
      ),
      {
        status: 'warning',
        summary: request.prompt,
        nextActions: ['Approve or deny this exact Rust-authorized action.'],
      },
    );
  }

  decideApproval(input: unknown): TaskSnapshot {
    const request = DecideApprovalRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const pending = this.matchPending(snapshot, request.interactionId);
    if (pending.kind !== 'approval') {
      throw new Error('The pending interaction requires a clarification answer.');
    }
    if (
      pending.actionDigest !== request.actionDigest ||
      createActionDigest(
        pending.action,
        snapshot.goal?.schemaVersion === 8
          ? snapshot.goal.intentAuthorization.revision
          : null,
      ) !== request.actionDigest
    ) {
      throw new Error('The approval action digest does not match.');
    }
    if (Date.parse(pending.expiresAt) <= this.now().getTime()) {
      throw new Error('The pending approval has expired.');
    }
    const approved = request.decision === 'approve';
    const timestamp = this.timestamp();
    return this.commit(
      this.appendMessage(
        {
          ...snapshot,
          pendingInteraction: null,
          phase: 'planning',
          approvalGrant: approved
            ? {
                interactionId: pending.id,
                actionDigest: pending.actionDigest,
                action: pending.action,
                approvedAt: timestamp,
                expiresAt: pending.expiresAt,
              }
            : null,
        },
        {
          kind: 'approval_decision',
          role: 'user',
          text: approved
            ? 'Approved the exact proposed action.'
            : 'Denied the proposed action.',
        },
        timestamp,
      ),
      {
        status: approved ? 'success' : 'warning',
        summary: approved ? 'Exact action approved.' : 'Action denied.',
        nextActions: ['Return the decision to the Rust runtime.'],
      },
    );
  }

  consumeApprovalGrant(input: unknown): TaskSnapshot {
    const request = ConsumeApprovalGrantRequestSchema.parse(input);
    const snapshot = this.getTask(request.taskId);
    const grant = snapshot.approvalGrant;
    if (!grant) throw new Error(`Task ${request.taskId} has no approved action grant.`);
    const digest = createActionDigest(
      request.action,
      snapshot.goal?.schemaVersion === 8
        ? snapshot.goal.intentAuthorization.revision
        : null,
    );
    if (
      grant.actionDigest !== digest ||
      createActionDigest(
        grant.action,
        snapshot.goal?.schemaVersion === 8
          ? snapshot.goal.intentAuthorization.revision
          : null,
      ) !== digest
    ) {
      throw new Error('The approved action grant does not match this action.');
    }
    if (Date.parse(grant.expiresAt) <= this.now().getTime()) {
      throw new Error('The approved action grant has expired.');
    }
    return this.commit(
      { ...snapshot, approvalGrant: null, phase: 'acting' },
      {
        summary: `Dispatching the exact approved action: ${grant.action.description}`,
        nextActions: ['Wait for the Rust runtime to record the result.'],
      },
    );
  }

  private assertInteractionAvailable(taskId: string): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    if (snapshot.pendingInteraction) {
      throw new Error('Resolve the pending interaction before creating another.');
    }
    return snapshot;
  }

  private matchPending(
    snapshot: TaskSnapshot,
    interactionId: string,
  ): PendingInteraction {
    if (!snapshot.pendingInteraction) {
      throw new Error(`Task ${snapshot.taskId} has no pending interaction.`);
    }
    if (snapshot.pendingInteraction.id !== interactionId) {
      throw new Error('The interaction ID does not match the pending request.');
    }
    return snapshot.pendingInteraction;
  }

  private appendMessage(
    snapshot: TaskSnapshot,
    details: Pick<TaskMessage, 'kind' | 'role' | 'text'>,
    timestamp: string,
  ): TaskSnapshot {
    return {
      ...snapshot,
      messages: [
        ...snapshot.messages,
        {
          messageId: randomUUID(),
          taskId: snapshot.taskId,
          ...details,
          timestamp,
        },
      ].slice(-MAX_TASK_MESSAGES),
    };
  }

  private commit(snapshot: TaskSnapshot, details: LocalEvent): TaskSnapshot {
    const timestamp = this.timestamp();
    const event: TaskEvent = {
      eventId: randomUUID(),
      taskId: snapshot.taskId,
      phase: snapshot.phase,
      timestamp,
      status: details.status ?? 'success',
      summary: details.summary,
      nextActions: details.nextActions ?? [],
      artifacts: [],
    };
    const next = TaskSnapshotSchema.parse({
      ...snapshot,
      updatedAt: timestamp,
      lastEvent: event,
    });
    this.tasks.set(next.taskId, next);
    this.emit('task-update', TaskUpdateSchema.parse({ event, snapshot: next }));
    return next;
  }

  private getTask(taskId: string): TaskSnapshot {
    const snapshot = this.tasks.get(taskId);
    if (!snapshot) throw new Error(`Task ${taskId} does not exist.`);
    return snapshot;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
