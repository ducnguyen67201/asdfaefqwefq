import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  AgentTaskContractV10Schema,
  RequestTaskInputSchema,
  RespondToInteractionRequestSchema,
  StartTaskRequestSchema,
  SubmitTaskRequestSchema,
  TaskSnapshotSchema,
  TaskUpdateSchema,
  type HostedTaskAuthorityContractV10,
  type PendingInteraction,
  type TaskEvent,
  type TaskMessage,
  type TaskSnapshot,
  type WorkspaceIdentity,
} from '../../shared/contracts';

const MAX_TASK_MESSAGES = 200;

export interface HostedTaskProjectionOptions {
  authority: HostedTaskAuthorityContractV10;
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
  authority: HostedTaskAuthorityContractV10,
  workspace: WorkspaceIdentity | null,
) {
  const projected: Record<string, unknown> = { ...authority };
  delete projected.workspaceSelectionId;
  return AgentTaskContractV10Schema.parse({ ...projected, workspace });
}

/**
 * Desktop projection of a Rust-owned task.
 *
 * This class owns only renderer-facing state and short-lived clarification UI.
 * It cannot compile goals, plan, sample a model, evaluate
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
      progress: {
        kind: 'tool_calls',
        completed: 0,
        limit: goal.limits.maxToolCalls,
      },
      outcomes: null,
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
    authority: HostedTaskAuthorityContractV10,
  ): TaskSnapshot {
    const snapshot = this.getTask(taskId);
    const workspace =
      snapshot.goal?.schemaVersion === 10 ? snapshot.goal.workspace : null;
    if (authority.workspaceSelectionId !== (workspace?.selectionId ?? null)) {
      throw new Error('The revised Rust authority changed the trusted workspace.');
    }
    const goal = projectAuthority(authority, workspace);
    const next = TaskSnapshotSchema.parse({
      ...snapshot,
      goal,
      outcomes: null,
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
    this.matchPending(snapshot, request.interactionId);
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
