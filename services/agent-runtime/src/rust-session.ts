import type {
  AgentInputItem,
  RunContextAwareSession,
  SessionHistoryTransactionArgs,
  SessionHistoryTransactionAwareSession,
} from '@openai/agents';

import type { AgentControlPlane, RunLease } from './control-plane-client.js';
import { digest } from './serialization.js';

export interface AgentRunContext {
  readonly client: AgentControlPlane;
  readonly lease: RunLease;
  readonly signal: AbortSignal;
}

export class RustSession
  implements
    RunContextAwareSession<AgentRunContext>,
    SessionHistoryTransactionAwareSession
{
  readonly acceptsRunContext = true as const;

  private revision: number;

  constructor(
    private readonly client: AgentControlPlane,
    private readonly lease: RunLease,
    initialRevision: number,
    private readonly signal?: AbortSignal,
  ) {
    this.revision = initialRevision;
  }

  async getSessionId(): Promise<string> {
    return this.lease.runId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const snapshot = await this.client.getSession(this.lease, this.signal);
    this.revision = snapshot.revision;
    const items = snapshot.items as AgentInputItem[];
    return limit === undefined ? items : items.slice(-limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    await this.commit({ type: 'append_items', items });
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const items = await this.getItems();
    const item = items.at(-1);
    if (item === undefined) return undefined;
    await this.commit({ type: 'replace_suffix', expectedSuffix: [item], replacement: [] });
    return item;
  }

  async clearSession(): Promise<void> {
    const expectedItems = await this.getItems();
    await this.commit({ type: 'clear', expectedItems });
  }

  async replaceHistoryWithCompaction(items: AgentInputItem[]): Promise<void> {
    const expectedSuffix = await this.getItems();
    await this.commit({ type: 'replace_suffix', expectedSuffix, replacement: items });
  }

  async applyHistoryTransaction(args: SessionHistoryTransactionArgs): Promise<void> {
    const operationDigest = digest(args.transaction);
    const expectedSessionRevision = this.revision;
    const result = await this.client.applySessionTransaction(
      this.lease,
      {
        expectedSessionRevision,
        operationId: `sdk:${expectedSessionRevision}:${digest({
          operationDigest,
          operationId: args.operationId,
        })}`,
        operationDigest,
        transaction: args.transaction,
      },
      this.signal,
    );
    this.revision = result.revision;
  }

  private async commit(transaction: SessionTransaction): Promise<void> {
    const operationDigest = digest(transaction);
    const expectedSessionRevision = this.revision;
    const result = await this.client.applySessionTransaction(
      this.lease,
      {
        expectedSessionRevision,
        operationId: `session:${expectedSessionRevision}:${operationDigest}`,
        operationDigest,
        transaction,
      },
      this.signal,
    );
    this.revision = result.revision;
  }
}

type SessionTransaction =
  | { readonly type: 'append_items'; readonly items: AgentInputItem[] }
  | {
      readonly type: 'replace_suffix';
      readonly expectedSuffix: AgentInputItem[];
      readonly replacement: AgentInputItem[];
    }
  | { readonly type: 'clear'; readonly expectedItems: AgentInputItem[] };

/**
 * The SDK's released compaction decorator clears and then adds. This adapter
 * stages the clear and commits one compare-and-replace transaction on add.
 */
export class AtomicCompactionDelegate implements RunContextAwareSession<AgentRunContext> {
  readonly acceptsRunContext = true as const;

  private stagedSuffix: AgentInputItem[] | undefined;

  constructor(private readonly delegate: RustSession) {}

  getSessionId(): Promise<string> {
    return this.delegate.getSessionId();
  }

  getItems(limit?: number): Promise<AgentInputItem[]> {
    return this.delegate.getItems(limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (this.stagedSuffix === undefined) {
      await this.delegate.addItems(items);
      return;
    }
    const expectedSuffix = this.stagedSuffix;
    this.stagedSuffix = undefined;
    await this.delegate.applyHistoryTransaction({
      operationId: `compact:${digest({ expectedSuffix, replacement: items })}`,
      transaction: { type: 'replace_suffix', expectedSuffix, replacement: items },
    });
  }

  popItem(): Promise<AgentInputItem | undefined> {
    if (this.stagedSuffix !== undefined) {
      throw new Error('compaction_replacement_in_progress');
    }
    return this.delegate.popItem();
  }

  async clearSession(): Promise<void> {
    this.stagedSuffix = await this.delegate.getItems();
  }

  abortStagedReplacement(): void {
    this.stagedSuffix = undefined;
  }
}
