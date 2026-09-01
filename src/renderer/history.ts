import type { TaskEvent, TaskSnapshot } from '../shared/contracts';
import { isTaskPhaseTerminal } from '../shared/task-lifecycle';

export interface HistoryEntry {
  events: TaskEvent[];
  finalResponse: string | null;
  objective: string;
  phase: 'completed' | 'blocked' | 'failed' | 'cancelled';
  progress: TaskSnapshot['progress'];
  snapshot: TaskSnapshot;
  toolsUsed: string[];
  updatedAt: string;
}

export function createHistoryEntries(
  snapshots: readonly TaskSnapshot[],
  events: readonly TaskEvent[],
): HistoryEntry[] {
  const snapshotsByTaskId = new Map<string, TaskSnapshot>();
  for (const snapshot of snapshots) {
    snapshotsByTaskId.set(snapshot.taskId, snapshot);
  }

  const eventsByTaskId = new Map<string, Map<string, TaskEvent>>();
  for (const event of events) {
    const taskEvents = eventsByTaskId.get(event.taskId) ?? new Map();
    taskEvents.set(event.eventId, event);
    eventsByTaskId.set(event.taskId, taskEvents);
  }

  return [...snapshotsByTaskId.values()]
    .filter((snapshot) =>
      snapshot.lifecycle?.terminal ??
      isTaskPhaseTerminal(snapshot.phase),
    )
    .map((snapshot) => {
      const taskEvents = [
        ...(eventsByTaskId.get(snapshot.taskId)?.values() ?? []),
      ].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      const finalResponse = [...snapshot.messages]
        .reverse()
        .find(
          (message) =>
            message.role === 'assistant' && message.kind === 'answer',
        )?.text ?? null;
      return {
        events: taskEvents,
        finalResponse,
        objective: snapshot.request,
        phase: snapshot.phase as HistoryEntry['phase'],
        progress: snapshot.progress,
        snapshot,
        toolsUsed: [
          ...new Set(
            taskEvents.flatMap((event) =>
              event.tool ? [event.tool.toolId] : [],
            ),
          ),
        ],
        updatedAt: snapshot.updatedAt,
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
