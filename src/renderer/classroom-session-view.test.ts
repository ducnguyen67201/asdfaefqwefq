import { describe, expect, it } from 'vitest';

import type {
  ClassroomDirectiveNotice,
  ClassroomSessionProjection,
} from '../shared/contracts';

import {
  classroomDirectiveMessage,
  classroomSessionView,
} from './classroom-session-view';

const session: ClassroomSessionProjection = {
  activity: {
    launchTarget: 'current_surface',
    objective: 'Build a small Scratch scene.',
    title: 'Scratch loops',
    requiresSubmission: false,
  },
  activityVersionId: '00000000-0000-4000-8000-000000000003',
  attemptId: '00000000-0000-4000-8000-000000000004',
  attemptState: 'in_progress',
  autoCoachConsent: false,
  autoOpenConsent: false,
  currentDirective: null,
  joinedAt: '2026-08-25T00:00:00.000Z',
  leftAt: null,
  role: 'student',
  run: {
    id: '00000000-0000-4000-8000-000000000002',
    mode: 'live',
    state: 'open',
    status: 'live',
  },
  space: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Saturday Scratch',
  },
};

describe('classroomSessionView', () => {
  it('keeps Help, Check, Ready, and Leave separate during live work', () => {
    expect(classroomSessionView(session)).toMatchObject({
      canAskForHelp: true,
      canCheck: true,
      canLeave: true,
      canMarkReady: true,
      label: 'Class live',
      tone: 'live',
    });
  });

  it('uses only explicit lifecycle state for Help and review', () => {
    expect(
      classroomSessionView({ ...session, attemptState: 'blocked' }),
    ).toMatchObject({
      canAskForHelp: false,
      canCheck: true,
      label: 'Help requested',
    });
    expect(
      classroomSessionView({ ...session, attemptState: 'ready_for_review' }),
    ).toMatchObject({
      canMarkReady: false,
      label: 'Ready for review',
    });
    expect(
      classroomSessionView({ ...session, attemptState: 'assigned' }),
    ).toMatchObject({ canMarkReady: true, label: 'Class live' });
    expect(
      classroomSessionView({
        ...session,
        activity: { ...session.activity, requiresSubmission: true },
      }),
    ).toMatchObject({ canMarkReady: false });
  });

  it('disables classroom work in the lobby and after leaving', () => {
    expect(
      classroomSessionView({
        ...session,
        run: { ...session.run, state: 'draft', status: 'lobby' },
      }),
    ).toMatchObject({
      canAskForHelp: false,
      canCheck: false,
      canLeave: true,
      canMarkReady: false,
      label: 'Waiting for teacher',
    });
    expect(
      classroomSessionView({
        ...session,
        leftAt: '2026-08-25T01:00:00.000Z',
      }),
    ).toMatchObject({
      canAskForHelp: false,
      canCheck: false,
      canLeave: false,
      canMarkReady: false,
      label: 'Class ended',
    });
    expect(
      classroomSessionView({ ...session, attemptState: 'withdrawn' }),
    ).toMatchObject({
      canAskForHelp: false,
      canCheck: false,
      canMarkReady: false,
      label: 'Attempt withdrawn',
    });
  });
});

describe('classroomDirectiveMessage', () => {
  const exerciseNotice: ClassroomDirectiveNotice = {
    directive: {
      id: '00000000-0000-4000-8000-000000000005',
      instruction: 'Complete loops A and B.',
      kind: 'exercise',
      delivery: 'manual_only',
      criterionIds: [],
      sequence: 1,
      createdAt: '2026-08-25T00:05:00.000Z',
    },
    status: 'received',
  };

  it('describes delivery outcomes without implying background observation', () => {
    expect(classroomDirectiveMessage(exerciseNotice)).toBe(
      'New exercise from your teacher',
    );
    expect(
      classroomDirectiveMessage({ ...exerciseNotice, status: 'opened' }),
    ).toBe('Opened in your browser');
    expect(
      classroomDirectiveMessage({ ...exerciseNotice, status: 'open_failed' }),
    ).toBe('Could not open this link');
    expect(
      classroomDirectiveMessage({
        directive: {
          ...exerciseNotice.directive,
          kind: 'explain_assignment',
          delivery: 'consent_required',
        },
        status: 'received',
      }),
    ).toBe('Your teacher asked Tro to explain');
  });
});
