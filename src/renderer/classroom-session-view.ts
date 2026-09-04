import type {
  ClassroomDirectiveNotice,
  ClassroomSessionProjection,
} from '../shared/contracts';

export type ClassroomSessionTone = 'attention' | 'ended' | 'live' | 'waiting';

export interface ClassroomSessionView {
  canAskForHelp: boolean;
  canCheck: boolean;
  canLeave: boolean;
  canMarkReady: boolean;
  description: string;
  label: string;
  tone: ClassroomSessionTone;
}

export function classroomSessionView(
  session: ClassroomSessionProjection,
): ClassroomSessionView {
  if (
    session.run.status === 'ended' ||
    session.leftAt ||
    session.attemptState === 'completed' ||
    session.attemptState === 'withdrawn'
  ) {
    return {
      canAskForHelp: false,
      canCheck: false,
      canLeave: !session.leftAt && session.run.status !== 'ended',
      canMarkReady: false,
      description: session.attemptState === 'completed'
        ? 'Your teacher completed this Attempt.'
        : session.attemptState === 'withdrawn'
          ? 'This Attempt is no longer active. Your prior work remains saved.'
          : 'Your work is still saved. This class session is no longer active.',
      label: session.attemptState === 'completed'
        ? 'Completed'
        : session.attemptState === 'withdrawn'
          ? 'Attempt withdrawn'
          : 'Class ended',
      tone: 'ended',
    };
  }

  if (session.run.status === 'lobby') {
    return {
      canAskForHelp: false,
      canCheck: false,
      canLeave: true,
      canMarkReady: false,
      description:
        'You are in. Tro will receive the exercise when your teacher starts class.',
      label: 'Waiting for teacher',
      tone: 'waiting',
    };
  }

  if (session.attemptState === 'blocked') {
    return {
      canAskForHelp: false,
      canCheck: true,
      canLeave: true,
      canMarkReady: true,
      description:
        'Your teacher can see that you asked for help. Tro can guide your next step now.',
      label: 'Help requested',
      tone: 'attention',
    };
  }

  if (session.attemptState === 'ready_for_review') {
    return {
      canAskForHelp: true,
      canCheck: true,
      canLeave: true,
      canMarkReady: false,
      description:
        'Your teacher can review this Attempt. You can still ask Tro to check another detail.',
      label: 'Ready for review',
      tone: 'attention',
    };
  }

  if (session.attemptState === 'submitted') {
    return {
      canAskForHelp: false,
      canCheck: false,
      canLeave: true,
      canMarkReady: false,
      description:
        'Your reviewed files were submitted and are waiting for teacher review.',
      label: 'Submitted',
      tone: 'attention',
    };
  }

  return {
    canAskForHelp: true,
    canCheck: true,
    canLeave: true,
    canMarkReady: !session.activity.requiresSubmission,
    description:
      'Class context is active. Tro knows the published exercise when you ask for help.',
    label: 'Class live',
    tone: 'live',
  };
}

export function classroomDirectiveMessage(
  notice: ClassroomDirectiveNotice,
): string {
  if (notice.status === 'opened') return 'Opened in your browser';
  if (notice.status === 'open_failed') return 'Could not open this link';
  if (notice.status === 'dismissed') return 'Dismissed';
  if (notice.directive.kind === 'open_url') return 'New link from your teacher';
  if (notice.directive.kind === 'explain_assignment') {
    return 'Your teacher asked Tro to explain';
  }
  return 'New exercise from your teacher';
}
