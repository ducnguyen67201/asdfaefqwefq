import { OpenAIResponsesCompactionSession, type AgentInputItem } from '@openai/agents';
import { describe, expect, it } from 'vitest';

import type { AgentControlPlane } from '../src/control-plane-client.js';
import { RunLease } from '../src/control-plane-client.js';
import { AtomicCompactionDelegate, RustSession } from '../src/rust-session.js';

class MemoryControlPlane implements AgentControlPlane {
  items: AgentInputItem[] = [];

  revision = 0;

  mutations = new Map<string, { digest: string; revision: number }>();

  operationIds: string[] = [];

  transactions: unknown[] = [];

  async getSession() {
    return { revision: this.revision, items: structuredClone(this.items) as never[] };
  }

  async applySessionTransaction(
    _lease: RunLease,
    request: Parameters<AgentControlPlane['applySessionTransaction']>[1],
  ) {
    this.operationIds.push(request.operationId);
    const replay = this.mutations.get(request.operationId);
    if (replay) {
      if (replay.digest !== request.operationDigest) throw new Error('session_conflict');
      return { revision: replay.revision, replayed: true };
    }
    if (request.expectedSessionRevision !== this.revision) throw new Error('session_conflict');
    this.transactions.push(request.transaction);
    const transaction = request.transaction;
    if (transaction.type === 'append_items') {
      this.items.push(...(structuredClone(transaction.items) as AgentInputItem[]));
    } else if (transaction.type === 'replace_suffix') {
      this.items.splice(
        this.items.length - transaction.expectedSuffix.length,
        transaction.expectedSuffix.length,
        ...(structuredClone(transaction.replacement) as AgentInputItem[]),
      );
    } else {
      this.items = [];
    }
    this.revision += 1;
    this.mutations.set(request.operationId, {
      digest: request.operationDigest,
      revision: this.revision,
    });
    return { revision: this.revision, replayed: false };
  }

  async getToolResult(): Promise<never> {
    throw new Error('not used');
  }
}

describe('Rust-backed SDK session compaction', () => {
  it('scopes identical session mutations to their starting revision', async () => {
    const control = new MemoryControlPlane();
    const session = new RustSession(
      control,
      new RunLease(
        '4e49660f-47b2-4e1c-a7f5-b9ea93e4e720',
        '989104b5-ea79-49d5-a125-87930712bd84',
        1,
      ),
      0,
    );
    const repeatedItem: AgentInputItem = {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Use the existing window.' }],
    };

    await session.addItems([repeatedItem]);
    await session.addItems([repeatedItem]);

    expect(control.items).toEqual([repeatedItem, repeatedItem]);
    expect(control.operationIds).toHaveLength(2);
    expect(control.operationIds[0]).not.toBe(control.operationIds[1]);
  });

  it('commits clear plus add as one atomic suffix replacement', async () => {
    const control = new MemoryControlPlane();
    const lease = new RunLease(
      '4e49660f-47b2-4e1c-a7f5-b9ea93e4e720',
      '989104b5-ea79-49d5-a125-87930712bd84',
      1,
    );
    const underlying = new RustSession(control, lease, 0);
    const atomic = new AtomicCompactionDelegate(underlying);
    await atomic.addItems([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'goal' }] },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'working' }],
      },
    ]);
    const client = {
      responses: {
        compact: async () => ({
          output: [{ type: 'compaction', encrypted_content: 'compact-state' }],
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        }),
      },
    };
    const session = new OpenAIResponsesCompactionSession({
      client: client as never,
      compactionMode: 'input',
      model: 'gpt-5.6-sol',
      underlyingSession: atomic,
    });

    await session.runCompaction({ force: true, store: false, compactionMode: 'input' });

    expect(control.items).toEqual([{ type: 'compaction', encrypted_content: 'compact-state' }]);
    expect(control.transactions).toHaveLength(2);
    expect(control.transactions[1]).toMatchObject({ type: 'replace_suffix' });
  });
});
