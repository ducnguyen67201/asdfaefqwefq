import assert from 'node:assert/strict';
import test from 'node:test';

import { ActivityDefinitionSchema, BulkAddSpaceMembersSchema, InitiateUploadSchema } from '../src/knowledge-space-contracts.mjs';
import { canTransition, isRunOpen } from '../src/activity-lifecycle.mjs';
import { canClassroomRoleUseSpaceRole, canRecordEvidence, canSpaceRole, deriveSupportSuggestions } from '../src/knowledge-space-policy.mjs';

test('neutral Activity definitions are bounded and do not require education terminology', () => {
  const definition = ActivityDefinitionSchema.parse({
    title: 'Incident response drill', objective: 'Restore the service safely.',
    instructions: 'Inspect evidence and follow the runbook.', launchTarget: 'workspace',
  });
  assert.equal(definition.guidancePolicy.hintMode, 'guided');
  assert.equal(ActivityDefinitionSchema.safeParse({ ...definition, instructions: 'x'.repeat(24_001) }).success, false);
  assert.equal(InitiateUploadSchema.safeParse({ files: [] }).success, false);
});

test('role operations and lifecycle transitions fail closed', () => {
  assert.equal(canSpaceRole('owner', 'member.manage'), true);
  assert.equal(canSpaceRole('facilitator', 'space.delete'), false);
  assert.equal(canSpaceRole('participant', 'activity.publish'), false);
  assert.equal(canTransition('attempt', 'assigned', 'in_progress'), true);
  assert.equal(canTransition('attempt', 'assigned', 'completed'), false);
  assert.equal(isRunOpen({ state: 'open', opensAt: null, closesAt: null }), true);
});

test('Admin classroom roles must match class membership roles', () => {
  assert.equal(canClassroomRoleUseSpaceRole('teacher', 'owner'), true);
  assert.equal(canClassroomRoleUseSpaceRole('teacher', 'facilitator'), true);
  assert.equal(canClassroomRoleUseSpaceRole('teacher', 'participant'), true);
  assert.equal(canClassroomRoleUseSpaceRole('student', 'participant'), true);
  assert.equal(canClassroomRoleUseSpaceRole('student', 'facilitator'), false);
  assert.equal(canClassroomRoleUseSpaceRole('unassigned', 'participant'), false);
});

test('bulk class membership is bounded and accepts registered email batches', () => {
  const result = BulkAddSpaceMembersSchema.safeParse({
    clientId: '11111111-1111-4111-8111-111111111111',
    emails: ['student@example.com'],
    role: 'participant',
  });
  assert.equal(result.success, true);
  assert.equal(BulkAddSpaceMembersSchema.safeParse({
    clientId: '11111111-1111-4111-8111-111111111111',
    emails: ['not-an-email'],
    role: 'participant',
  }).success, false);
  assert.equal(BulkAddSpaceMembersSchema.safeParse({
    clientId: '11111111-1111-4111-8111-111111111111',
    emails: Array.from({ length: 501 }, (_, index) => `student-${index}@example.com`),
    role: 'participant',
  }).success, false);
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
});
