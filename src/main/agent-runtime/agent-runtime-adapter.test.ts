import type { UtilityProcess } from 'electron';
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  LocalAgentHostMessageSchema,
  type LocalAgentHostMessage,
} from '../../../services/agent-runtime/src/protocol';

import { LocalAgentRuntime } from './agent-runtime-adapter';

vi.mock('electron', () => ({
  utilityProcess: { fork: vi.fn() },
}));

class FakeUtilityProcess extends EventEmitter {
  readonly messages: LocalAgentHostMessage[] = [];
  killed = false;

  constructor(private readonly behavior: 'ready' | 'exit') {
    super();
  }

  launch(): void {
    queueMicrotask(() => this.emit('spawn'));
  }

  postMessage(input: unknown): void {
    const message = LocalAgentHostMessageSchema.parse(input);
    this.messages.push(message);
    if (message.kind !== 'runtime.initialize') return;
    if (this.behavior === 'exit') {
      queueMicrotask(() => this.emit('exit', 17));
      return;
    }
    queueMicrotask(() => this.emit('message', {
      kind: 'runtime.ready',
      requestId: message.requestId,
      runtime: message.expected,
    }));
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

function runtimeWith(process: FakeUtilityProcess): LocalAgentRuntime {
  return new LocalAgentRuntime({
    accessTokenProvider: async () => 'user-session-credential',
    apiBaseUrl: 'https://api.example.test',
    coordinator: {
      dispatchTool: vi.fn(),
      endTask: vi.fn(async () => undefined),
    },
    forkUtilityProcess: () => {
      process.launch();
      return process as unknown as UtilityProcess;
    },
    isPackaged: false,
    repositoryRoot: '/repo',
    resourcesPath: '/resources',
    runtimeReadyTimeoutMs: 100,
    state: {} as never,
    tools: {
      endTask: vi.fn(),
      freeze: vi.fn(),
      resolve: vi.fn(),
    } as never,
  });
}

describe('LocalAgentRuntime process supervision', () => {
  it('sends credentials only after a compatible runtime handshake', async () => {
    const process = new FakeUtilityProcess('ready');
    await runtimeWith(process).initialize();

    expect(process.messages.map((message) => message.kind)).toEqual([
      'runtime.initialize',
      'runtime.replaceCredential',
    ]);
    expect(process.messages[0]).not.toHaveProperty('credential');
    expect(process.messages[1]).toMatchObject({
      credential: 'user-session-credential',
    });
  });

  it('fails promptly when the utility process exits before readiness', async () => {
    const process = new FakeUtilityProcess('exit');

    await expect(runtimeWith(process).initialize()).rejects.toThrow(
      'exited before it was ready',
    );
  });
});
