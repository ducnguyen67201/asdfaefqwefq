import assert from 'node:assert/strict';
import test from 'node:test';

import { ActivityDefinitionSchema, CreateRunSchema, InitiateUploadSchema, RunTargetSchema } from '../src/knowledge-space-contracts.mjs';
import { canTransition, canWorkOnAttempt, isRunOpen } from '../src/activity-lifecycle.mjs';
import { canRecordEvidence, canSpaceRole, deriveSupportSuggestions } from '../src/knowledge-space-policy.mjs';
import { directiveDelivery, parsePublicHttpsUrl } from '../src/classroom-directive-policy.mjs';
import { InsightService } from '../src/insight-service.mjs';

test('neutral Activity definitions are bounded and do not require education terminology', () => {
  const definition = ActivityDefinitionSchema.parse({
    title: 'Incident response drill', objective: 'Restore the service safely.',
    instructions: 'Inspect evidence and follow the runbook.', launchTarget: 'workspace',
  });
  assert.equal(definition.guidancePolicy.hintMode, 'guided');
  assert.deepEqual(definition.sessionPolicy, { allowRoomJoin: false, allowedOrigins: [] });
  assert.equal(ActivityDefinitionSchema.safeParse({
    ...definition,
    sessionPolicy: { allowRoomJoin: true, allowedOrigins: ['https://127.0.0.1'] },
  }).success, false);
  assert.equal(ActivityDefinitionSchema.safeParse({ ...definition, instructions: 'x'.repeat(24_001) }).success, false);
  assert.equal(InitiateUploadSchema.safeParse({ files: [] }).success, false);
});

test('role operations and lifecycle transitions fail closed', () => {
  assert.equal(canSpaceRole('owner', 'member.manage'), true);
  assert.equal(canSpaceRole('facilitator', 'space.delete'), false);
  assert.equal(canSpaceRole('participant', 'activity.publish'), false);
  assert.equal(canSpaceRole('facilitator', 'run.directive_manage'), true);
  assert.equal(canSpaceRole('participant', 'attempt.ready_own'), true);
  assert.equal(canTransition('attempt', 'assigned', 'in_progress'), true);
  assert.equal(canTransition('attempt', 'assigned', 'completed'), false);
  assert.equal(canTransition('attempt', 'in_progress', 'ready_for_review'), true);
  assert.equal(canTransition('attempt', 'assigned', 'ready_for_review'), true);
  assert.equal(canTransition('attempt', 'ready_for_review', 'in_progress'), true);
  assert.equal(canTransition('workSession', 'created', 'failed'), true);
  assert.equal(canTransition('workSession', 'paused', 'failed'), true);
  assert.equal(canWorkOnAttempt('ready_for_review'), true);
  assert.equal(canWorkOnAttempt('submitted'), false);
  assert.deepEqual(RunTargetSchema.parse({ kind: 'room' }), { kind: 'room' });
  assert.equal(CreateRunSchema.safeParse({
    clientId: '00000000-0000-4000-8000-000000000001',
    activityVersionId: '00000000-0000-4000-8000-000000000002',
    mode: 'async',
    target: { kind: 'room' },
  }).success, false);
  assert.equal(isRunOpen({ state: 'open', opensAt: null, closesAt: null }), true);
});

test('classroom link delivery is public-HTTPS-only and auto eligibility comes from published origins', () => {
  const directive = { kind: 'open_url', instruction: 'Open the exercise.', criterionIds: [], url: 'https://learn.example.com/task?id=1' };
  assert.deepEqual(directiveDelivery(directive, ['https://learn.example.com']), {
    delivery: 'auto_eligible',
    origin: 'https://learn.example.com',
    url: 'https://learn.example.com/task?id=1',
  });
  assert.equal(directiveDelivery(directive, []).delivery, 'manual_only');
  assert.equal(parsePublicHttpsUrl('http://example.com'), null);
  assert.equal(parsePublicHttpsUrl('https://127.0.0.1/task'), null);
  assert.equal(parsePublicHttpsUrl('https://user:secret@example.com/task'), null);
});

test('agent evidence requires the exact attempt, acknowledged policy, and allowlists', () => {
  const base = {
    attemptUserId: 'participant-1', criterionIds: ['loops'], insightPolicy: 'evidence_candidates',
    policyAcknowledged: true, provenance: 'agent_candidate', sessionAttemptId: 'attempt-1',
    targetAttemptId: 'attempt-1', tagAllowlist: ['debugging'], userId: 'participant-1',
    criterionId: 'loops', tag: 'debugging',
  };
  assert.equal(canRecordEvidence(base), true);
  assert.equal(canRecordEvidence({ ...base, targetAttemptId: 'attempt-2' }), false);
  assert.equal(canRecordEvidence({ ...base, policyAcknowledged: false }), false);
});

test('cohort suggestions require five participants and thirty percent corroboration', () => {
  const evidence = [{ criterionId: 'loops', participantCount: 6, corroboratedCount: 2, agentCandidateCount: 1 }];
  assert.deepEqual(deriveSupportSuggestions({ activeParticipants: 20, criterionEvidence: evidence, participants: [] })[0], {
    kind: 'group_clarification', criterionId: 'loops', participantCount: 6, activeParticipants: 20, confidence: 'moderate',
  });
  assert.deepEqual(deriveSupportSuggestions({ activeParticipants: 4, criterionEvidence: evidence, participants: [] }), []);
  assert.deepEqual(deriveSupportSuggestions({
    activeParticipants: 1,
    criterionEvidence: [],
    participants: [{ id: 'participant-1', helpRequested: false, blockedSessionCount: 99 }],
  }), []);
});

test('dashboard responses carry authoritative Run state on snapshots and deltas', async () => {
  const projections = [
    {
      kind: 'snapshot',
      participants: [
        { id: 'active', state: 'blocked', status: 'needs_help', helpRequestedAt: '2026-08-25T00:00:00.000Z' },
        { id: 'left', state: 'blocked', status: 'left', helpRequestedAt: '2026-08-25T00:01:00.000Z' },
      ],
      criterionEvidence: [],
      maxSequence: 3,
    },
    { kind: 'delta', events: [], maxSequence: 3 },
  ];
  const service = new InsightService({
    activityRepository: {
      runState: async () => 'open',
      dashboard: async () => projections.shift(),
    },
    spaceService: { role: async () => 'facilitator' },
  });

  const snapshot = await service.dashboard('teacher-1', 'space-1', 'run-1');
  assert.equal(snapshot.runState, 'open');
  assert.deepEqual(snapshot.helpQueue.map((row) => row.id), ['active']);
  assert.deepEqual(snapshot.suggestions.map((row) => row.participantId), ['active']);
  assert.equal(
    (await service.dashboard('teacher-1', 'space-1', 'run-1', 3)).runState,
    'open',
  );
});
