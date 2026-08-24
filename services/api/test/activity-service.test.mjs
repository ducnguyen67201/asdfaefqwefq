import assert from 'node:assert/strict';
import test from 'node:test';

import { ActivityService } from '../src/activity-service.mjs';

test('a Help Work Session opens the explicit teacher queue before creating agent context', async () => {
  const order = [];
  const attemptId = '00000000-0000-4000-8000-000000000001';
  const clientId = '00000000-0000-4000-8000-000000000002';
  const repository = {
    attemptContext: async () => ({
      attemptId,
      state: 'in_progress',
      run: { state: 'open', opensAt: null, closesAt: null },
      definition: { launchTarget: 'current_surface' },
    }),
    requestHelp: async (requestedAttemptId, userId, requestedClientId) => {
      order.push('help');
      assert.deepEqual(
        [requestedAttemptId, userId, requestedClientId],
        [attemptId, 'student-1', clientId],
      );
      return { requested: true, state: 'blocked' };
    },
    createWorkSession: async (input) => {
      order.push('session');
      return input;
    },
  };
  const service = new ActivityService({
    activityRepository: repository,
    objectStore: {},
    spaceService: {},
    uploadService: {},
  });

  const result = await service.createWorkSession('student-1', attemptId, {
    clientId,
    taskId: '00000000-0000-4000-8000-000000000003',
    launchKind: 'current_surface',
    purpose: 'help',
  });

  assert.deepEqual(order, ['help', 'session']);
  assert.equal(result.purpose, 'help');
});

test('ordinary and Check Work Sessions do not open the Help queue', async () => {
  const requestHelp = async () => {
    throw new Error('must not be called');
  };
  const repository = {
    attemptContext: async () => ({
      state: 'in_progress',
      run: { state: 'open', opensAt: null, closesAt: null },
      definition: { launchTarget: 'none' },
    }),
    requestHelp,
    createWorkSession: async (input) => input,
  };
  const service = new ActivityService({
    activityRepository: repository,
    objectStore: {},
    spaceService: {},
    uploadService: {},
  });

  await service.createWorkSession(
    'student-1',
    '00000000-0000-4000-8000-000000000001',
    {
      clientId: '00000000-0000-4000-8000-000000000002',
      taskId: '00000000-0000-4000-8000-000000000003',
      launchKind: 'none',
      purpose: 'check',
    },
  );
});

test('submitted Attempts cannot open Help or Work Sessions while awaiting review', async () => {
  const attemptId = '00000000-0000-4000-8000-000000000001';
  const service = new ActivityService({
    activityRepository: {
      attemptContext: async () => ({
        attemptId,
        state: 'submitted',
        run: { state: 'open', opensAt: null, closesAt: null },
        definition: { launchTarget: 'current_surface' },
      }),
      requestHelp: async () => { throw new Error('must not be called'); },
      createWorkSession: async () => { throw new Error('must not be called'); },
    },
    objectStore: {},
    spaceService: {},
    uploadService: {},
  });

  await assert.rejects(
    () => service.requestHelp('student-1', attemptId, '00000000-0000-4000-8000-000000000002'),
    (error) => error.code === 'attempt_not_active',
  );
  await assert.rejects(
    () => service.createWorkSession('student-1', attemptId, {
      clientId: '00000000-0000-4000-8000-000000000002',
      taskId: '00000000-0000-4000-8000-000000000003',
      launchKind: 'current_surface',
      purpose: 'work',
    }),
    (error) => error.code === 'attempt_not_active',
  );
  await assert.rejects(
    () => service.initiateSubmission('student-1', attemptId, {
      files: [{ byteSize: 10 }],
    }),
    (error) => error.code === 'attempt_not_active',
  );
});
