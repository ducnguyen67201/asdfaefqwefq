import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentRunService,
  reviseIntentAuthorization,
} from '../src/agent-run-service.mjs';
import { deterministicOutcomeContract } from '../src/outcome-compiler.mjs';

function harness(intentEnabled, overrides = {}) {
  const submissions = [];
  const crypto = {
    encryptJson(value, aad) {
      return {
        ciphertext: Buffer.from(JSON.stringify(value)),
        iv: Buffer.alloc(12),
        tag: Buffer.alloc(16),
        keyVersion: 1,
        value,
        aad,
      };
    },
  };
  const repository = {
    async submit(input) {
      submissions.push(input);
      return {
        kind: 'created',
        run: {
          id: input.runId,
          taskId: input.taskId,
          clientTaskId: input.clientTaskId,
          executionProfile: input.executionProfile,
          workspaceSelectionId: input.workspaceSelectionId,
          state: 'queued',
          protocolVersion: input.protocolVersion,
          runVersion: 1,
          outcomeRevision: 1,
          publicSummary: input.publicSummary,
          createdAt: '2026-08-21T00:00:00.000Z',
          updatedAt: '2026-08-21T00:00:00.000Z',
        },
      };
    },
  };
  return {
    submissions,
    service: new AgentRunService({
      agentTurnService: {
        create: async () => ({ id: 'agent-turn-1' }),
      },
      crypto,
      intentAuthorizationPolicy: { enabledFor: () => intentEnabled },
      outcomeCompiler: {
        compile: async ({ request, executionProfile }) =>
          deterministicOutcomeContract(request, executionProfile),
      },
      repository,
      ...overrides,
    }),
  };
}

const submission = {
  clientTaskId: '11111111-1111-4111-8111-111111111111',
  taskId: '22222222-2222-4222-8222-222222222222',
  request: 'Create a calendar event.',
  executionProfile: 'everyday',
  workspaceSelectionId: null,
  autonomyMode: 'balanced',
};

test('AgentRunService owns and projects an encrypted v8 intent contract', async () => {
  const { service, submissions } = harness(true);
  const result = await service.submit({ id: 'user-1', plan: 'free' }, submission);

  assert.equal(result.contractSchemaVersion, 8);
  assert.equal(result.protocolVersion, 2);
  assert.ok(result.intentAuthorization.grants.some(
    (grant) => grant.effectKind === 'create_resource' &&
      grant.resourceKinds.includes('calendar_event'),
  ));
  assert.equal(submissions[0].contractEnvelope.aad.schemaVersion, 8);
  assert.equal(submissions[0].contractEnvelope.value.schemaVersion, 8);
});

test('disabled rollout produces a fail-closed v8 projection', async () => {
  const { service } = harness(false);
  const result = await service.submit({ id: 'user-2', plan: 'free' }, {
    ...submission,
    clientTaskId: '33333333-3333-4333-8333-333333333333',
    taskId: '44444444-4444-4444-8444-444444444444',
  });
  assert.equal(result.contractSchemaVersion, 8);
  assert.deepEqual(result.intentAuthorization.grants, []);
});

test('binds a hosted Help run to the authenticated Attempt and Work Session', async () => {
  const attemptId = '55555555-5555-4555-8555-555555555555';
  const workSessionId = '66666666-6666-4666-8666-666666666666';
  const directive = {
    id: '77777777-7777-4777-8777-777777777777',
    sequence: 3,
    kind: 'exercise',
    delivery: 'manual_only',
    instruction: 'Complete exercise B.',
    criterionIds: ['criterion-b'],
    createdAt: '2026-08-21T00:00:00.000Z',
  };
  const activityRepository = {
    attemptContext: async (requestedAttemptId, userId) => {
      assert.equal(requestedAttemptId, attemptId);
      assert.equal(userId, 'student-1');
      return {
        attemptId,
        userId,
        state: 'in_progress',
        acknowledgedPolicyVersion: 'policy-v1',
        run: {
          id: '88888888-8888-4888-8888-888888888888',
          state: 'open',
          mode: 'live',
          opensAt: null,
          closesAt: null,
          insightPolicy: 'explicit_and_operational',
          insightPolicyVersion: 'policy-v1',
        },
        space: {
          id: '99999999-9999-4999-8999-999999999999',
          name: 'Python 101',
        },
        activityVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        definition: {
          title: 'Loops',
          objective: 'Use a loop to solve the exercise.',
          instructions: 'Complete exercise B without revealing the final answer.',
          launchTarget: 'current_surface',
          guidancePolicy: {
            answerReveal: 'after_attempt',
            hintMode: 'guided',
            maxHintLevel: 2,
          },
          criteria: [{
            id: 'criterion-b',
            title: 'Correct loop',
            description: 'The program uses a loop.',
            tags: ['python'],
          }],
          completionPolicy: {
            requiresSubmission: true,
            requiresFacilitatorConfirmation: true,
          },
          sessionPolicy: {
            allowedOrigins: ['https://class.example'],
            allowRoomJoin: true,
          },
        },
        sourceCatalog: [{ title: 'Lesson 3', role: 'instructions' }],
        priorProgress: {
          completedCriterionIds: [],
          sessionCount: 1,
          summary: 'One prior Work Session.',
        },
      };
    },
    workSessionForTask: async (taskId, requestedAttemptId, userId) => {
      assert.equal(taskId, submission.taskId);
      assert.equal(requestedAttemptId, attemptId);
      assert.equal(userId, 'student-1');
      return { id: workSessionId, purpose: 'help', state: 'active' };
    },
  };
  const liveClassroomRepository = {
    sessionForAttempt: async () => ({
      currentDirective: directive,
      leftAt: null,
      run: { state: 'open' },
    }),
  };
  const { service, submissions } = harness(true, {
    activityRepository,
    liveClassroomRepository,
  });

  const result = await service.submit(
    { id: 'student-1', plan: 'free' },
    {
      ...submission,
      request: 'Give me a hint for exercise B.',
      activityAttemptId: attemptId,
      activityIntent: 'help',
    },
  );

  assert.deepEqual(result.activity, submissions[0].contractEnvelope.value.activity);
  assert.equal(result.activity.attemptId, attemptId);
  assert.equal(result.activity.workSessionId, workSessionId);
  assert.equal(result.activity.purpose, 'help');
  assert.deepEqual(result.activity.currentDirective, directive);
  assert.equal(result.activity.policyAcknowledged, true);
});

test('rejects an Activity Attempt that is not owned by the authenticated user', async () => {
  const { service, submissions } = harness(true, {
    activityRepository: {
      attemptContext: async () => null,
      workSessionForTask: async () => {
        throw new Error('must not be called');
      },
    },
  });

  await assert.rejects(
    service.submit(
      { id: 'student-2', plan: 'free' },
      {
        ...submission,
        activityAttemptId: '55555555-5555-4555-8555-555555555555',
        activityIntent: 'check',
      },
    ),
    (error) => error.code === 'activity_attempt_not_found' && error.status === 404,
  );
  assert.equal(submissions.length, 0);
});

test('rejects submitted Attempts and terminal Work Sessions', async () => {
  const attemptId = '55555555-5555-4555-8555-555555555555';
  const submittedHarness = harness(true, {
    activityRepository: {
      attemptContext: async () => ({
        state: 'submitted',
        run: { state: 'open', opensAt: null, closesAt: null },
      }),
      workSessionForTask: async () => {
        throw new Error('must not be called');
      },
    },
  });
  await assert.rejects(
    submittedHarness.service.submit(
      { id: 'student-1', plan: 'free' },
      { ...submission, activityAttemptId: attemptId },
    ),
    (error) => error.code === 'attempt_not_active',
  );

  const failedSessionHarness = harness(true, {
    activityRepository: {
      attemptContext: async () => ({
        state: 'in_progress',
        run: { state: 'open', opensAt: null, closesAt: null },
        definition: { launchTarget: 'current_surface' },
      }),
      workSessionForTask: async () => ({
        id: '66666666-6666-4666-8666-666666666666',
        purpose: 'work',
        state: 'failed',
      }),
    },
  });
  await assert.rejects(
    failedSessionHarness.service.submit(
      { id: 'student-1', plan: 'free' },
      { ...submission, activityAttemptId: attemptId },
    ),
    (error) => error.code === 'activity_session_missing',
  );
});

test('kill switch preserves existing grants while advancing the steering revision', () => {
  const existing = {
    schemaVersion: 8,
    executionProfile: 'everyday',
    intentAuthorization: {
      schemaVersion: 1,
      revision: 3,
      source: 'user_instruction',
      grants: [{
        id: 'create-resource-123456789abc',
        effectKind: 'create_resource',
        resourceKinds: ['calendar_event'],
        permitsSafeDefaults: false,
      }],
    },
  };
  const revised = reviseIntentAuthorization({
    authorityText: 'Also create a public document.',
    contract: existing,
    enabled: false,
  });
  assert.equal(revised.revision, 4);
  assert.deepEqual(revised.grants, existing.intentAuthorization.grants);
});
