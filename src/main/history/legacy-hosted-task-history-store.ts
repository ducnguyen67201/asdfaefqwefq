import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  TaskHistorySchema,
  TaskSnapshotSchema,
  type TaskHistory,
  type TaskUpdate,
} from '../../shared/contracts';

import type { TaskHistoryStore } from './task-history-store';

const LegacyHistorySchema = z.object({
  items: z.array(z.object({
    taskId: z.string().uuid(),
    state: z.enum(['completed', 'blocked', 'failed', 'cancelled', 'expired']),
    executionProfile: z.enum(['everyday', 'workspace']),
    summary: z.string().max(1_000),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }).strict()).max(50),
}).strict();

export class LegacyHostedTaskHistoryStore implements TaskHistoryStore {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessTokenProvider: () => Promise<string | null>,
  ) {}

  async initialize(): Promise<void> {}
  async close(): Promise<void> {}
  async save(ownerId: string, update: TaskUpdate): Promise<void> {
    void ownerId;
    void update;
    // Explicitly read-only; new tasks are always written to the local store.
  }

  async load(ownerId: string): Promise<TaskHistory> {
    void ownerId;
    const token = await this.accessTokenProvider();
    if (!token || !this.apiBaseUrl) return emptyLegacyHistory();
    let history: z.infer<typeof LegacyHistorySchema>;
    try {
      const response = await fetch(`${this.apiBaseUrl.replace(/\/+$/u, '')}/v1/legacy-agent-history`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return emptyLegacyHistory();
      history = LegacyHistorySchema.parse(await response.json());
    } catch {
      return emptyLegacyHistory();
    }
    const snapshots = history.items.map((item) => {
      const phase = item.state === 'expired' ? 'failed' : item.state;
      const event = {
        eventId: randomUUID(), taskId: item.taskId, phase,
        timestamp: item.updatedAt, status: item.state === 'completed' ? 'success' as const : 'error' as const,
        summary: item.summary || 'Legacy hosted task', nextActions: [], artifacts: [],
      };
      return TaskSnapshotSchema.parse({
        taskId: item.taskId,
        request: 'Legacy hosted task',
        phase,
        goal: null,
        messages: [],
        pendingInteraction: null,
        progress: null,
        queuedSteering: [],
        runtimeResume: null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        lastEvent: event,
      });
    });
    return TaskHistorySchema.parse({
      events: snapshots.flatMap((snapshot) => snapshot.lastEvent ? [snapshot.lastEvent] : []),
      snapshots,
      persistence: { mode: 'postgres', summary: 'Read-only legacy hosted task history.' },
    });
  }
}

function emptyLegacyHistory(): TaskHistory {
  return TaskHistorySchema.parse({
    events: [], snapshots: [],
    persistence: { mode: 'postgres', summary: 'No legacy hosted task history is available.' },
  });
}
