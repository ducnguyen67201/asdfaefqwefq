import { randomUUID } from 'node:crypto';

import type {
  TeacherClassroomBinding,
  SessionAssignment,
  ClassroomBroadcast,
  PrepareClassroomBroadcast,
  KnowledgeClassroomSession,
  HostedAttemptContext,
} from '../../shared/contracts';
export function classroomFixture() {
  const binding: TeacherClassroomBinding = {
    ownerId: 'teacher',
    spaceId: randomUUID(),
    sessionId: randomUUID(),
    spaceName: 'Python',
    sessionTitle: 'Lesson 1',
    verifiedAt: new Date().toISOString(),
  };
  const assignment: SessionAssignment = {
    number: 1,
    runId: randomUUID(),
    activityVersionId: randomUUID(),
    title: 'Vòng lặp',
    objectivePreview: 'Understand loops.',
  };
  const prepare: PrepareClassroomBroadcast = {
    kind: 'assignment',
    studentAction: 'explain',
    assignmentNumber: 1,
    assignmentTitle: null,
    assignmentRunId: null,
    instruction: null,
    url: null,
  };
  const broadcast: ClassroomBroadcast = {
    id: randomUUID(),
    sessionId: binding.sessionId,
    sequence: 1,
    createdAt: new Date().toISOString(),
    delivery: 'manual_only',
    payload: {
      kind: 'assignment',
      studentAction: 'explain',
      instruction: 'Explain Assignment 1.',
      targetRunId: assignment.runId,
      activityVersionId: assignment.activityVersionId,
      title: assignment.title,
      number: 1,
    },
  };
  const session: KnowledgeClassroomSession = {
    attemptId: randomUUID(),
    attemptState: 'assigned',
    run: { id: assignment.runId, state: 'open', mode: 'live', status: 'live' },
    space: { id: binding.spaceId, name: 'Python' },
    activityVersionId: assignment.activityVersionId,
    activity: {
      title: assignment.title,
      objective: 'Understand loops.',
      launchTarget: 'current_surface',
      requiresSubmission: false,
    },
    currentDirective: null,
    joinedAt: new Date().toISOString(),
    leftAt: null,
  };
  const attempt: HostedAttemptContext = {
    attemptId: session.attemptId,
    userId: 'student',
    state: 'assigned',
    acknowledgedPolicyVersion: null,
    run: {
      id: assignment.runId,
      state: 'open',
      mode: 'live',
      opensAt: null,
      closesAt: null,
      insightPolicy: 'explicit_and_operational',
      insightPolicyVersion: '1',
    },
    space: session.space,
    activityVersionId: assignment.activityVersionId,
    definition: {
      title: assignment.title,
      objective: 'Understand loops.',
      instructions: 'Read the for loop and explain each iteration.',
      launchTarget: 'workspace',
      guidancePolicy: {
        answerReveal: 'after_attempt',
        hintMode: 'guided',
        maxHintLevel: 2,
      },
      criteria: [],
      completionPolicy: {
        requiresSubmission: false,
        requiresFacilitatorConfirmation: true,
      },
      sessionPolicy: { allowRoomJoin: true, allowedOrigins: [] },
    },
    sourceCatalog: [],
    starterAvailable: false,
    priorProgress: {
      completedCriterionIds: [],
      sessionCount: 0,
      summary: 'No prior work sessions.',
    },
  };
  return { binding, assignment, prepare, broadcast, session, attempt };
}
