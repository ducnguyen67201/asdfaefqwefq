import type { z } from 'zod';

import type * as C from './classroom-broadcast-contracts';
export const CLASSROOM_BROADCAST_CHANNELS = {
  selectTeacherClassroom: 'classroom:teacher-select',
  clearTeacherClassroom: 'classroom:teacher-clear',
  getTeacherClassroom: 'classroom:teacher-get',
  teacherClassroomChanged: 'classroom:teacher-changed',
  getClassroomBroadcastDrafts: 'classroom:drafts-get',
  classroomBroadcastDraftsChanged: 'classroom:drafts-changed',
  confirmClassroomBroadcast: 'classroom:broadcast-confirm',
  cancelClassroomBroadcast: 'classroom:broadcast-cancel',
  reconcileClassroomBroadcast: 'classroom:broadcast-reconcile',
  getClassroomBroadcastNotice: 'classroom:broadcast-notice',
  classroomBroadcastChanged: 'classroom:broadcast-changed',
  openClassroomBroadcastAssignment: 'classroom:broadcast-open-assignment',
  openClassroomBroadcastLink: 'classroom:broadcast-open-link',
  dismissClassroomBroadcast: 'classroom:broadcast-dismiss',
  setClassroomGuidanceConsent: 'classroom:guidance-consent',
  startClassroomExplanation: 'classroom:explanation-start',
  continueClassroomExplanation: 'classroom:explanation-continue',
  stopClassroomExplanation: 'classroom:explanation-stop',
  getClassroomGuidanceState: 'classroom:guidance-state',
  classroomGuidanceChanged: 'classroom:guidance-changed',
  getClassroomGuidanceSummary: 'classroom:guidance-summary',
} as const;
export interface ClassroomDesktopApi {
  selectTeacherClassroom(
    input: z.infer<typeof C.TeacherClassroomSelectSchema>,
  ): Promise<C.TeacherClassroomSelection>;
  clearTeacherClassroom(
    input: z.infer<typeof C.TeacherClassroomClearSchema>,
  ): Promise<void>;
  getTeacherClassroom(): Promise<C.TeacherClassroomSelection | null>;
  onTeacherClassroomChanged(
    listener: (selection: C.TeacherClassroomSelection | null) => void,
  ): () => void;
  getClassroomBroadcastDrafts(input: {
    taskId: string;
  }): Promise<C.BroadcastDraftProjection>;
  onClassroomBroadcastDraftsChanged(
    listener: (projection: C.BroadcastDraftProjection) => void,
  ): () => void;
  confirmClassroomBroadcast(
    input: z.infer<typeof C.BroadcastDraftActionSchema>,
  ): Promise<C.ClassroomBroadcastDraft>;
  cancelClassroomBroadcast(
    input: z.infer<typeof C.BroadcastDraftActionSchema>,
  ): Promise<C.ClassroomBroadcastDraft>;
  reconcileClassroomBroadcast(
    input: z.infer<typeof C.BroadcastDraftLookupSchema>,
  ): Promise<C.ClassroomBroadcastDraft>;
  getClassroomBroadcastNotice(): Promise<C.BroadcastNotice | null>;
  onClassroomBroadcastChanged(
    listener: (notice: C.BroadcastNotice | null) => void,
  ): () => void;
  openClassroomBroadcastAssignment(input: {
    broadcastId: string;
  }): Promise<{ attemptId: string }>;
  openClassroomBroadcastLink(input: { broadcastId: string }): Promise<void>;
  dismissClassroomBroadcast(input: { broadcastId: string }): Promise<void>;
  setClassroomGuidanceConsent(
    input: z.infer<typeof C.GuidanceConsentRequestSchema>,
  ): Promise<C.GuidanceState>;
  startClassroomExplanation(
    input: z.infer<typeof C.GuidanceStartLocalSchema>,
  ): Promise<C.GuidanceState>;
  continueClassroomExplanation(
    input: C.GuidanceContinue,
  ): Promise<C.GuidanceState>;
  stopClassroomExplanation(input: {
    guidanceId: string;
  }): Promise<C.GuidanceState>;
  getClassroomGuidanceState(): Promise<C.GuidanceState>;
  onClassroomGuidanceChanged(
    listener: (state: C.GuidanceState) => void,
  ): () => void;
  getClassroomGuidanceSummary(input: {
    spaceId: string;
    sessionId: string;
    broadcastId: string;
  }): Promise<z.infer<typeof C.GuidanceSummarySchema>>;
}
