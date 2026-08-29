import { describe, expect, it } from 'vitest';

import {
  TransactionalMemorySession,
  constructBrokeredProvider,
  constructDeferredToolSurface,
  proveInputCompaction,
  proveSerializedResume,
} from './compatibility-proof-fixture.js';

describe('Agents SDK compatibility proof', () => {
  it('serializes an interruption and resumes the original call exactly once', async () => {
    await expect(proveSerializedResume()).resolves.toEqual({
      callId: 'proof_call_1',
      finalOutput: 'proof complete',
    });
  });

  it('applies session transactions idempotently and rejects operation conflicts', async () => {
    const session = new TransactionalMemorySession('transaction-proof');
    const transaction = {
      operationId: 'append-1',
      transaction: {
        type: 'append_items' as const,
        items: [
          {
            type: 'message' as const,
            role: 'user' as const,
            content: [{ type: 'input_text' as const, text: 'hello' }],
          },
        ],
      },
    };
    await session.applyHistoryTransaction(transaction);
    await session.applyHistoryTransaction(transaction);
    expect(await session.getItems()).toHaveLength(1);

    await expect(
      session.applyHistoryTransaction({
        operationId: 'append-1',
        transaction: { type: 'append_items', items: [] },
      }),
    ).rejects.toThrow('session_operation_conflict');
  });

  it('compacts local history through one atomic replacement', async () => {
    await expect(proveInputCompaction()).resolves.toEqual([
      { type: 'compaction', encrypted_content: 'proof-compaction' },
    ]);
  });

  it('constructs deferred namespaced tools and a brokered zero-retry provider', () => {
    expect(constructDeferredToolSurface()).toHaveLength(2);
    expect(constructBrokeredProvider()).toBeDefined();
  });
});
