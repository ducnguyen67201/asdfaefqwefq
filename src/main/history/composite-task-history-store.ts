import { TaskHistorySchema, type TaskHistory, type TaskUpdate } from '../../shared/contracts';

import type { TaskHistoryStore } from './task-history-store';

export class CompositeTaskHistoryStore implements TaskHistoryStore {
  constructor(
    private readonly writable: TaskHistoryStore,
    private readonly legacy: TaskHistoryStore,
  ) {}

  async initialize(): Promise<void> {
    await this.writable.initialize();
    await this.legacy.initialize();
  }

  async close(): Promise<void> {
    await Promise.all([this.writable.close(), this.legacy.close()]);
  }

  save(ownerId: string, update: TaskUpdate): Promise<void> {
    return this.writable.save(ownerId, update);
  }

  async load(ownerId: string): Promise<TaskHistory> {
    const [local, legacy] = await Promise.all([
      this.writable.load(ownerId),
      this.legacy.load(ownerId),
    ]);
    const byId = new Map(legacy.snapshots.map((snapshot) => [snapshot.taskId, snapshot]));
    for (const snapshot of local.snapshots) byId.set(snapshot.taskId, snapshot);
    const snapshots = [...byId.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return TaskHistorySchema.parse({
      events: [...legacy.events, ...local.events].sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
      snapshots,
      persistence: local.persistence,
    });
  }
}
