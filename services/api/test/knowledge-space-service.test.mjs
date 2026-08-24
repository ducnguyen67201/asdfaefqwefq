import assert from 'node:assert/strict';
import test from 'node:test';

import { KnowledgeSpaceService } from '../src/knowledge-space-service.mjs';

function serviceWith(spaceRepository) {
  return new KnowledgeSpaceService({
    hmacKey: 'test-knowledge-space-hmac-key-at-least-32-characters',
    sourceRepository: {},
    spaceRepository,
    uploadService: {},
  });
}

test('only Admin-assigned Teachers can create class workspaces', async () => {
  const calls = [];
  const repository = {
    classroomRole: async () => 'student',
    create: async (input) => {
      calls.push(input);
      return input;
    },
  };
  await assert.rejects(
    serviceWith(repository).create('student-1', {
      clientId: '11111111-1111-4111-8111-111111111111',
      description: '',
      name: 'Class 8A',
      purposeLabel: 'Class',
    }),
    (error) => error?.code === 'teacher_role_required' && error?.status === 403,
  );
  assert.deepEqual(calls, []);

  repository.classroomRole = async () => 'teacher';
  repository.countOwned = async () => 0;
  await serviceWith(repository).create('teacher-1', {
    clientId: '11111111-1111-4111-8111-111111111111',
    description: '',
    name: 'Class 8A',
    purposeLabel: 'Class',
  });
  assert.equal(calls[0].ownerUserId, 'teacher-1');
});

test('fails closed when an account role and class membership diverge', async () => {
  const service = serviceWith({
    membershipContext: async () => ({
      classroomRole: 'student',
      spaceRole: 'facilitator',
    }),
  });
  await assert.rejects(
    service.role('student-1', 'space-1', 'space.read'),
    (error) => error?.code === 'classroom_role_mismatch' && error?.status === 403,
  );
});

test('class owners can add Teachers while other Teachers can add Students', async () => {
  const additions = [];
  const repository = {
    addMembers: async (input) => {
      additions.push(input);
      return { addedEmails: input.emails };
    },
    membershipContext: async (_spaceId, userId) => ({
      classroomRole: 'teacher',
      spaceRole: userId === 'owner-1' ? 'owner' : 'facilitator',
    }),
  };
  const service = serviceWith(repository);
  await service.addMembers('owner-1', 'space-1', {
    clientId: '11111111-1111-4111-8111-111111111111',
    emails: ['teacher@example.com'],
    role: 'facilitator',
  });
  await service.addMembers('teacher-1', 'space-1', {
    clientId: '22222222-2222-4222-8222-222222222222',
    emails: ['student@example.com'],
    role: 'participant',
  });
  assert.equal(additions.length, 2);

  await assert.rejects(
    service.addMembers('teacher-1', 'space-1', {
      clientId: '33333333-3333-4333-8333-333333333333',
      emails: ['teacher-2@example.com'],
      role: 'facilitator',
    }),
    (error) => error?.code === 'space_forbidden' && error?.status === 403,
  );
});

test('invite redemption rejects a role that Admin did not assign', async () => {
  const service = serviceWith({
    redeemInvite: async () => ({ kind: 'role_mismatch' }),
  });
  await assert.rejects(
    service.redeemInvite('student-1', 'TROSPACE-TESTCODE'),
    (error) =>
      error?.code === 'classroom_role_mismatch' && error?.status === 403,
  );
});
