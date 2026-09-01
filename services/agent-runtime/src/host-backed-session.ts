import type {
  AgentInputItem,
  RunContextAwareSession,
  SessionHistoryTransactionArgs,
  SessionHistoryTransactionAwareSession,
} from '@openai/agents';

import { childRequestId, type HostBridge } from './host-bridge.js';
import { digest } from './serialization.js';

export interface LocalAgentRunContext {
  readonly bridge: HostBridge;
  readonly identity: TurnIdentity;
  readonly signal: AbortSignal;
}

export interface TurnIdentity {
  readonly agentId: string;
  readonly delegationId: string | null;
  readonly graphVersion: string;
  readonly parentAgentId: string | null;
  readonly threadId: string;
  readonly turnId: string;
}

export interface ChildTurnIdentity extends TurnIdentity {
  readonly requestId: string;
  readonly sequence: number;
}

export function turnMessageIdentity(
  bridge: HostBridge,
  identity: TurnIdentity,
): ChildTurnIdentity {
  return {
    ...identity,
    requestId: childRequestId(),
    sequence: bridge.nextSequence(identity.turnId),
  };
}

export class HostBackedSession
  implements RunContextAwareSession<LocalAgentRunContext>, SessionHistoryTransactionAwareSession
{
  readonly acceptsRunContext = true as const;
  private revision = 0;

  constructor(private readonly context: LocalAgentRunContext) {}

  async getSessionId(): Promise<string> {
    return this.context.identity.threadId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const requestId = childRequestId();
    const response = await this.context.bridge.request({
      ...turnMessageIdentity(this.context.bridge, this.context.identity),
      requestId,
      kind: 'session.read',
      limit: limit ?? null,
    }, { signal: this.context.signal });
    if (response.kind !== 'session.read.result') throw new Error('unexpected_session_read_response');
    this.revision = response.revision;
    return response.items as AgentInputItem[];
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    const operationDigest = digest({ type: 'append_items', items });
    const requestId = childRequestId();
    const response = await this.context.bridge.request({
      ...turnMessageIdentity(this.context.bridge, this.context.identity),
      requestId,
      kind: 'session.append',
      expectedRevision: this.revision,
      operationId: `session:${this.revision}:${operationDigest}`,
      operationDigest,
      items: items as Record<string, unknown>[],
    }, { signal: this.context.signal });
    if (response.kind !== 'session.append.result') throw new Error('unexpected_session_append_response');
    this.revision = response.revision;
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const items = await this.getItems();
    const item = items.at(-1);
    if (!item) return undefined;
    await this.replace([item], []);
    return item;
  }

  async clearSession(): Promise<void> {
    await this.replace(await this.getItems(), []);
  }

  async applyHistoryTransaction(args: SessionHistoryTransactionArgs): Promise<void> {
    if (args.transaction.type === 'append_items') {
      await this.addItems(args.transaction.items);
      return;
    }
    if (args.transaction.type === 'replace_suffix') {
      await this.replace(args.transaction.expectedSuffix, args.transaction.replacement);
      return;
    }
  }

  private async replace(expectedSuffix: AgentInputItem[], replacement: AgentInputItem[]): Promise<void> {
    const transaction = { type: 'replace_suffix', expectedSuffix, replacement } as const;
    const operationDigest = digest(transaction);
    const requestId = childRequestId();
    const response = await this.context.bridge.request({
      ...turnMessageIdentity(this.context.bridge, this.context.identity),
      requestId,
      kind: 'session.replace',
      expectedRevision: this.revision,
      operationId: `session:${this.revision}:${operationDigest}`,
      operationDigest,
      expectedSuffix: expectedSuffix as Record<string, unknown>[],
      replacement: replacement as Record<string, unknown>[],
    }, { signal: this.context.signal });
    if (response.kind !== 'session.replace.result') throw new Error('unexpected_session_replace_response');
    this.revision = response.revision;
  }
}

/** Makes SDK clear+add compaction one compare-and-replace host transaction. */
export class AtomicCompactionDelegate implements RunContextAwareSession<LocalAgentRunContext> {
  readonly acceptsRunContext = true as const;
  private stagedSuffix: AgentInputItem[] | undefined;

  constructor(private readonly delegate: HostBackedSession) {}

  getSessionId(): Promise<string> { return this.delegate.getSessionId(); }
  getItems(limit?: number): Promise<AgentInputItem[]> { return this.delegate.getItems(limit); }
  popItem(): Promise<AgentInputItem | undefined> { return this.delegate.popItem(); }

  async addItems(items: AgentInputItem[]): Promise<void> {
    if (!this.stagedSuffix) return this.delegate.addItems(items);
    const expectedSuffix = this.stagedSuffix;
    this.stagedSuffix = undefined;
    await this.delegate.applyHistoryTransaction({
      operationId: `compact:${digest({ expectedSuffix, replacement: items })}`,
      transaction: { type: 'replace_suffix', expectedSuffix, replacement: items },
    });
  }

  async clearSession(): Promise<void> { this.stagedSuffix = await this.delegate.getItems(); }
  abortStagedReplacement(): void { this.stagedSuffix = undefined; }
}
