import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { HostBackedSession, type LocalAgentRunContext } from '../src/host-backed-session.js';
import { HostBridge } from '../src/host-bridge.js';

class FakeParentPort extends EventEmitter {
  readonly sent: unknown[] = [];

  postMessage(value: unknown): void { this.sent.push(value); }
  receive(value: unknown): void { this.emit('message', { data: value }); }
}

function context(port: FakeParentPort): LocalAgentRunContext {
  return {
    bridge: new HostBridge(port),
    identity: {
      agentId: 'tro.root',
      delegationId: null,
      graphVersion: 'a'.repeat(64),
      parentAgentId: null,
      threadId: randomUUID(),
      turnId: randomUUID(),
    },
    signal: new AbortController().signal,
  };
}

describe('HostBackedSession', () => {
  it('uses host revisions for idempotent append operations', async () => {
    const port = new FakeParentPort();
    const runContext = context(port);
    const session = new HostBackedSession(runContext);
    const append = session.addItems([{
      role: 'user',
      content: [{ type: 'input_text', text: 'hello' }],
    }]);
    const request = port.sent[0] as Record<string, unknown>;

    expect(request).toMatchObject({ kind: 'session.append', expectedRevision: 0 });
    port.receive({
      ...identityFrom(request),
      kind: 'session.append.result',
      requestId: randomUUID(),
      responseTo: request.requestId,
      revision: 1,
      replayed: false,
    });

    await expect(append).resolves.toBeUndefined();
  });

  it('cancels outstanding host requests with the turn signal', async () => {
    const port = new FakeParentPort();
    const controller = new AbortController();
    const runContext = { ...context(port), signal: controller.signal };
    const session = new HostBackedSession(runContext);
    const pending = session.getItems();

    controller.abort();

    await expect(pending).rejects.toThrow('cancelled');
  });
});

function identityFrom(request: Record<string, unknown>) {
  return {
    threadId: request.threadId,
    turnId: request.turnId,
    agentId: request.agentId,
    parentAgentId: request.parentAgentId,
    delegationId: request.delegationId,
    graphVersion: request.graphVersion,
    sequence: Number(request.sequence) + 1,
  };
}
