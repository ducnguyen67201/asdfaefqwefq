import assert from 'node:assert/strict';
import test from 'node:test';

import { LiveClassroomService } from '../src/live-classroom-service.mjs';

const ids = {
  activityVersionId: '00000000-0000-4000-8000-000000000001',
  clientId: '00000000-0000-4000-8000-000000000002',
  runId: '00000000-0000-4000-8000-000000000003',
  spaceId: '00000000-0000-4000-8000-000000000004',
};

function setup(overrides = {}) {
  const repository = {
    createRoomCode: async (input) => ({ id: ids.clientId, maxUses: input.maxUses, usedCount: 0, expiresAt: input.expiresAt.toISOString(), revokedAt: null, createdAt: new Date(0).toISOString(), newlyCreated: true }),
    runContext: async () => ({
      id: ids.runId,
      spaceId: ids.spaceId,
      activityVersionId: ids.activityVersionId,
      mode: 'live',
      state: 'open',
      targetKind: 'room',
      definition: {
        title: 'Loops',
        objective: 'Practice loops.',
        criteria: [{ id: 'loop', title: 'Loop' }],
        sessionPolicy: { allowRoomJoin: true, allowedOrigins: ['https://learn.example.com'] },
      },
    }),
    createDirective: async (input) => ({ ...input.directive, delivery: input.delivery }),
    ...overrides,
  };
  const operations = [];
  const service = new LiveClassroomService({
    hmacKey: 'test-key-that-is-not-used-in-production',
    repository,
    spaceService: { role: async (_userId, _spaceId, operation) => operations.push(operation) },
  });
  return { operations, repository, service };
}

test('room code creation is deterministic for an idempotency client id and role checked', async () => {
  const captured = [];
  const { operations, service } = setup({
    createRoomCode: async (input) => { captured.push(input); return { newlyCreated: captured.length === 1 }; },
  });
  const first = await service.createRoomCode('teacher', ids.spaceId, ids.runId, { clientId: ids.clientId, expiresAt: null, maxUses: 40 });
  const second = await service.createRoomCode('teacher', ids.spaceId, ids.runId, { clientId: ids.clientId, expiresAt: null, maxUses: 40 });
  assert.equal(first.code, second.code);
  assert.match(first.code, /^TRO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/u);
  assert.equal(captured[0].codeDigest.length, 32);
  assert.deepEqual(operations, ['run.room_manage', 'run.room_manage']);
});

test('room creation rejects disabled, non-room, and invalid-expiry configurations', async () => {
  const disabled = setup({
    runContext: async () => ({
      id: ids.runId,
      spaceId: ids.spaceId,
      activityVersionId: ids.activityVersionId,
      mode: 'live',
      state: 'draft',
      targetKind: 'room',
      definition: { sessionPolicy: { allowRoomJoin: false, allowedOrigins: [] } },
    }),
  }).service;
  await assert.rejects(
    () => disabled.createRoomCode('teacher', ids.spaceId, ids.runId, {
      clientId: ids.clientId,
      expiresAt: null,
      maxUses: 20,
    }),
    (error) => error.code === 'room_join_disabled',
  );

  const nonRoom = setup({
    runContext: async () => ({
      id: ids.runId,
      mode: 'async',
      state: 'draft',
      targetKind: 'participants',
      definition: { sessionPolicy: { allowRoomJoin: true, allowedOrigins: [] } },
    }),
  }).service;
  await assert.rejects(
    () => nonRoom.createRoomCode('teacher', ids.spaceId, ids.runId, {
      clientId: ids.clientId,
      expiresAt: null,
      maxUses: 20,
    }),
    (error) => error.code === 'room_run_required',
  );

  const { service } = setup();
  await assert.rejects(
    () => service.createRoomCode('teacher', ids.spaceId, ids.runId, {
      clientId: ids.clientId,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      maxUses: 20,
    }),
    (error) => error.code === 'room_expiry_invalid',
  );
});

test('directive creation validates published criteria and computes delivery on the server', async () => {
  const { operations, service } = setup();
  const result = await service.createDirective('teacher', ids.spaceId, ids.runId, {
    clientId: ids.clientId,
    directive: {
      kind: 'open_url',
      instruction: 'Open the loop exercise.',
      criterionIds: ['loop'],
      url: 'https://learn.example.com/loops?day=1',
    },
  });
  assert.equal(result.delivery, 'auto_eligible');
  assert.equal(result.origin, 'https://learn.example.com');
  assert.deepEqual(operations, ['run.directive_manage']);

  await assert.rejects(
    () => service.createDirective('teacher', ids.spaceId, ids.runId, {
      clientId: ids.clientId,
      directive: { kind: 'exercise', instruction: 'Unknown.', criterionIds: ['unknown'] },
    }),
    (error) => error.code === 'directive_criterion_invalid',
  );
});

test('private, multicast, and credential-bearing directive URLs fail closed', async () => {
  const { service } = setup();
  for (const url of [
    'https://127.0.0.1/work',
    'https://[fe90::1]/work',
    'https://[ff02::1]/work',
    'https://user:secret@example.com/work',
  ]) {
    await assert.rejects(
      () => service.createDirective('teacher', ids.spaceId, ids.runId, {
        clientId: ids.clientId,
        directive: { kind: 'open_url', instruction: 'Open.', criterionIds: [], url },
      }),
      (error) => error.code === 'directive_url_invalid',
    );
  }
});

test('room joining passes only a digest to the repository and review actions remain role checked', async () => {
  const joined = [];
  const reviewed = [];
  const { operations, service } = setup({
    joinRoom: async (input) => {
      joined.push(input);
      return { attemptId: '00000000-0000-4000-8000-000000000010' };
    },
    reviewAttempt: async (input) => {
      reviewed.push(input);
      return { attemptId: input.attemptId, state: 'completed', action: input.action };
    },
  });

  await service.join('student-1', {
    clientId: ids.clientId,
    code: 'TRO-ABCD-EFGH-JKLM',
  });
  assert.equal(joined[0].code, undefined);
  assert.equal(joined[0].codeDigest.length, 32);
  assert.equal(joined[0].userId, 'student-1');

  const result = await service.review(
    'teacher-1',
    ids.spaceId,
    ids.runId,
    '00000000-0000-4000-8000-000000000010',
    { clientId: ids.clientId, action: 'complete' },
  );
  assert.equal(result.state, 'completed');
  assert.deepEqual(operations, ['attempt.review']);
  assert.equal(reviewed[0].userId, 'teacher-1');
});
