import type {
  TaskHistory,
  TaskUpdate,
} from '../../shared/contracts';

/** Persistence port. New task history is owned locally by Electron main. */
export interface TaskHistoryStore {
  close(): Promise<void>;
  initialize(): Promise<void>;
  load(ownerId: string): Promise<TaskHistory>;
  save(ownerId: string, update: TaskUpdate): Promise<void>;
}
