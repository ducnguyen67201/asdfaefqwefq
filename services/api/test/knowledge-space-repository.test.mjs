import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresKnowledgeSpaceRepository } from '../src/knowledge-space-repository.mjs';

function sequencedPool(responses) {
  const queries = [];
  const client = {
    query: async (sql, parameters = []) => {
      queries.push({ parameters, sql });
      return responses.shift() ?? { rows: [] };
    },
    release: () => {
      client.released = true;
    },
    released: false,
  };
  return {
    client,
    pool: {
      connect: async () => client,
      query: client.query,
    },
    queries,
  };
}

test('bulk member add resolves registered matching roles and stores an idempotent result', async () => {
  const spaceId = '11111111-1111-4111-8111-111111111111';
  const batchId = '22222222-2222-4222-8222-222222222222';
  const { client, pool, queries } = sequencedPool([
    { rows: [] },
    { rows: [] },
    { rows: [] },
    {
      rows: [
        {
          blocked_at: null,
          classroom_role: 'student',
          email: 'new@example.com',
          id: 'student-new',
        },
        {
          blocked_at: null,
          classroom_role: 'student',
          email: 'existing@example.com',
          id: 'student-existing',
        },
        {
          blocked_at: null,
          classroom_role: 'teacher',
          email: 'teacher@example.com',
          id: 'teacher-1',
        },
      ],
    },
    { rows: [{ user_id: 'student-existing' }] },
    { rows: [] },
    { rows: [] },
    { rows: [] },
  ]);
  const repository = new PostgresKnowledgeSpaceRepository(pool);
  const result = await repository.addMembers({
    clientId: batchId,
    emails: [
      'NEW@example.com',
      'existing@example.com',
      'teacher@example.com',
      'missing@example.com',
      'new@example.com',
    ],
    role: 'participant',
    spaceId,
    userId: 'teacher-owner',
  });

  assert.deepEqual(result, {
    addedEmails: ['new@example.com'],
    alreadyMemberEmails: ['existing@example.com'],
    requestedRole: 'participant',
    roleMismatchEmails: ['teacher@example.com'],
    spaceId,
    unavailableEmails: ['missing@example.com'],
  });
  assert.match(queries[3].sql, /FROM users[\s\S]+FOR UPDATE/u);
  assert.match(queries[5].sql, /INSERT INTO knowledge_space_members/u);
  assert.deepEqual(queries[5].parameters, [
    spaceId,
    'participant',
    ['student-new'],
  ]);
  assert.match(queries[6].sql, /knowledge_space_member_batches/u);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(client.released, true);
});

test('bulk member add returns the stored batch result on retry', async () => {
  const result = {
    addedEmails: ['student@example.com'],
    alreadyMemberEmails: [],
    requestedRole: 'participant',
    roleMismatchEmails: [],
    spaceId: '11111111-1111-4111-8111-111111111111',
    unavailableEmails: [],
  };
  const { pool, queries } = sequencedPool([
    { rows: [] },
    { rows: [] },
    { rows: [{ result }] },
    { rows: [] },
  ]);
  const repository = new PostgresKnowledgeSpaceRepository(pool);
  assert.deepEqual(
    await repository.addMembers({
      clientId: '22222222-2222-4222-8222-222222222222',
      emails: ['student@example.com'],
      role: 'participant',
      spaceId: result.spaceId,
      userId: 'teacher-owner',
    }),
    result,
  );
  assert.equal(
    queries.some((query) => query.sql.includes('INSERT INTO knowledge_space_members')),
    false,
  );
  assert.equal(queries.at(-1).sql, 'COMMIT');
});
