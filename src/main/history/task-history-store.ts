import type {
  TaskHistory,
  TaskUpdate,
} from '../../shared/contracts';

/** Client adapter contract. Durable task history is owned by the Rust API. */
export interface TaskHistoryStore {
  close(): Promise<void>;
  initialize(): Promise<void>;
  load(ownerId: string): Promise<TaskHistory>;
  save(ownerId: string, update: TaskUpdate): Promise<void>;
}
