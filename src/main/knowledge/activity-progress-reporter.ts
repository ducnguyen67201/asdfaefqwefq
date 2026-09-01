import type { TaskUpdate } from '../../shared/contracts';
import { isTaskPhaseTerminal } from '../../shared/task-lifecycle';

import type { KnowledgeSpaceClient } from './knowledge-space-client';

export class ActivityProgressReporter {
  private readonly sessions = new Map<string, { workSessionId: string; lastSentAt: number }>();

  constructor(private readonly client: Pick<KnowledgeSpaceClient, 'updateWorkSession'>, private readonly now: () => number = Date.now) {}

  bind(taskId: string, workSessionId: string): void {
    this.sessions.set(taskId, { workSessionId, lastSentAt: 0 });
  }

  async fail(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) return;
    this.sessions.delete(taskId);
    try {
      await this.client.updateWorkSession(session.workSessionId, { state: 'failed' });
    } catch {
      // Task creation already failed; delayed hosted state is safer than masking it.
    }
  }

  clear(): void { this.sessions.clear(); }

  async report(update: TaskUpdate): Promise<void> {
    const session = this.sessions.get(update.snapshot.taskId);
    if (!session) return;
    const terminal =
      update.snapshot.lifecycle?.terminal ??
      isTaskPhaseTerminal(update.snapshot.phase);
    const now = this.now();
    if (!terminal && now - session.lastSentAt < 10_000) return;
    session.lastSentAt = now;
    const state = update.snapshot.phase === 'completed'
      ? 'completed'
      : update.snapshot.phase === 'cancelled'
        ? 'cancelled'
        : update.snapshot.phase === 'failed'
          ? 'failed'
          : update.snapshot.phase === 'blocked'
            ? 'paused'
            : 'active';
    try {
      await this.client.updateWorkSession(session.workSessionId, { state });
      if (terminal) this.sessions.delete(update.snapshot.taskId);
    } catch {
      // Local task execution remains authoritative. The renderer can show delayed sync
      // from hosted Attempt state without persisting private task content locally.
    }
  }
}
