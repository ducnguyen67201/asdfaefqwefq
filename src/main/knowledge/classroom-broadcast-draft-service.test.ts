import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  ClassroomBroadcastReceipt,
  ClassroomBroadcastPayload,
} from '../../shared/contracts';
import { TaskRuntime } from '../agent/task-runtime';
import { EncryptedAgentStateStore } from '../agent-runtime/encrypted-agent-state-store';

import { classroomBroadcastDigest } from './classroom-assignment-resolver';
import { ClassroomBroadcastDraftService } from './classroom-broadcast-draft-service';
import { classroomFixture } from './classroom-broadcast.fixture';
import { TeacherClassroomContextService } from './teacher-classroom-context-service';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const f = classroomFixture();
  const directory = await mkdtemp(path.join(tmpdir(), 'tro-broadcast-'));
  directories.push(directory);
  const cipher = {
    isAvailable: async () => true,
    encrypt: async (value: string) => Buffer.from(value).reverse(),
    decrypt: async (value: Buffer) => Buffer.from(value).reverse().toString(),
  };
  const store = new EncryptedAgentStateStore({
    baseDirectory: directory,
    cipher,
  });
  await store.initialize();
  const taskId = randomUUID();
  const runtime = new TaskRuntime();
  await store.create(
    'teacher',
    runtime.submit(
      { text: 'Explain assignment 1' },
      {
        taskId,
        authority: {
          schemaVersion: 11,
          id: randomUUID(),
          originalRequest: 'Explain assignment 1',
          runtimeKind: 'openai_agents_sdk',
          route: 'agent',
          executionProfile: 'everyday',
          workspace: null,
          activity: null,
          coachProgress: null,
          limits: {
            maxImages: 20,
            maxMicroUsd: 100000,
            maxMinutes: 30,
            maxModelSamples: 40,
            maxToolCalls: 30,
          },
        },
      },
    ),
  );
  const binding = {
    spaceId: f.binding.spaceId,
    sessionId: f.binding.sessionId,
    spaceName: f.binding.spaceName,
    sessionTitle: f.binding.sessionTitle,
    verifiedAt: f.binding.verifiedAt,
  };
  const context = new TeacherClassroomContextService(
    {
      capabilities: async () => ({
        knowledgeSpaces: { enabled: true, contractVersion: 2 },
        classroomBroadcasts: { contractVersion: 1 },
        classroomGuidance: { contractVersion: 1 },
      }),
      teacherClassroomContext: async () => ({
        binding,
        sessionState: 'open',
        assignments: [f.assignment],
      }),
    },
    async () => 'teacher',
  );
  await context.select(binding.spaceId, binding.sessionId);
  let receipt: ClassroomBroadcastReceipt | null = null;
  const commit = vi.fn(
    async (
      _space: string,
      _session: string,
      clientId: string,
      payload: ClassroomBroadcastPayload,
    ) => {
      receipt = {
        clientId,
        broadcast: { ...f.broadcast, payload },
        payloadDigest: classroomBroadcastDigest(payload),
        newlyCreated: true,
      };
      return receipt;
    },
  );
  const lookup = vi.fn(async () => ({ receipt }));
  const service = new ClassroomBroadcastDraftService({
    state: store,
    context,
    client: {
      commitClassroomBroadcast: commit,
      lookupClassroomBroadcast: lookup,
    },
    owner: async () => 'teacher',
  });
  return { ...f, store, service, context, commit, lookup, taskId };
}
describe('durable classroom preview', () => {
  it('prepares idempotently, persists encrypted, and sends once on concurrent confirmation', async () => {
    const f = await fixture();
    const prepared = await f.service.prepare(
      f.taskId,
      'call-1',
      f.binding,
      f.prepare,
    );
    expect(prepared.status).toBe('prepared');
    await f.service.prepare(f.taskId, 'call-1', f.binding, f.prepare);
    expect((await f.service.list(f.taskId)).drafts).toHaveLength(1);
    expect(f.commit).not.toHaveBeenCalled();
    const draft = (await f.service.list(f.taskId)).drafts[0]!;
    const action = {
      taskId: f.taskId,
      draftId: draft.draftId,
      revision: draft.revision,
    };
    const result = await Promise.all([
      f.service.confirm(action),
      f.service.confirm(action),
    ]);
    expect(result.every((d) => d.state === 'sent')).toBe(true);
    expect(f.commit).toHaveBeenCalledOnce();
    await expect(f.store.readOwnedThread('student', f.taskId)).rejects.toThrow(
      'owner',
    );
  });
  it('never repeats a POST after an unknown save, even if receipt lookup is empty', async () => {
    const f = await fixture();
    await f.service.prepare(f.taskId, 'call', f.binding, f.prepare);
    const draft = (await f.service.list(f.taskId)).drafts[0]!;
    f.commit.mockRejectedValueOnce(new Error('connection lost'));
    const action = {
      taskId: f.taskId,
      draftId: draft.draftId,
      revision: draft.revision,
    };
    expect((await f.service.confirm(action)).state).toBe('unknown');
    expect(
      (
        await f.service.reconcile({
          taskId: action.taskId,
          draftId: action.draftId,
        })
      ).state,
    ).toBe('unknown');
    await f.service.confirm(action);
    expect(f.commit).toHaveBeenCalledOnce();
    expect(
      (await f.store.readOwnedThread('teacher', f.taskId)).broadcastDrafts[0]!
        .state,
    ).toBe('unknown');
  });
  it('refuses stale class selections and cancelled previews', async () => {
    const f = await fixture();
    await f.service.prepare(f.taskId, 'call', f.binding, f.prepare);
    const draft = (await f.service.list(f.taskId)).drafts[0]!;
    f.context.clear();
    expect((await f.service.list(f.taskId)).drafts[0]!.state).toBe('stale');
    await expect(
      f.service.confirm({
        taskId: f.taskId,
        draftId: draft.draftId,
        revision: 1,
      }),
    ).rejects.toThrow('changed');
    expect(f.commit).not.toHaveBeenCalled();
  });
});
