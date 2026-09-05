import { z } from 'zod';

const id = z.string().uuid();
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instruction = z.string().trim().min(1).max(4_000);
export const TeacherClassroomBindingSchema = z
  .object({
    ownerId: z.string().min(1).max(500),
    spaceId: id,
    sessionId: id,
    spaceName: z.string().min(1).max(240),
    sessionTitle: z.string().min(1).max(240),
    verifiedAt: z.string().datetime(),
  })
  .strict();
export const TeacherClassroomSelectionSchema = z
  .object({ selectionId: id, binding: TeacherClassroomBindingSchema })
  .strict();
export const SessionAssignmentSchema = z
  .object({
    number: z.number().int().min(1).max(50),
    runId: id,
    activityVersionId: id,
    title: z.string().min(1).max(240),
    objectivePreview: z.string().max(300),
  })
  .strict();
export const TeacherClassroomContextSchema = z
  .object({
    binding: TeacherClassroomBindingSchema.omit({ ownerId: true }),
    sessionState: z.enum(['draft', 'open', 'closed', 'archived']),
    assignments: z.array(SessionAssignmentSchema).max(50),
  })
  .strict();
export const ClassroomBroadcastPayloadSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('assignment'),
      instruction,
      targetRunId: id,
      activityVersionId: id,
      title: z.string().min(1).max(240),
      number: z.number().int().min(1).max(50),
      studentAction: z.enum(['open', 'explain']),
    })
    .strict(),
  z.object({ kind: z.literal('exercise'), instruction }).strict(),
  z
    .object({
      kind: z.literal('open_url'),
      instruction,
      url: z.string().url().max(2_000),
      origin: z.string().url().max(2_000),
    })
    .strict(),
]);
export const ClassroomBroadcastSchema = z
  .object({
    id,
    sessionId: id,
    sequence: revision,
    createdAt: z.string().datetime(),
    delivery: z.literal('manual_only'),
    payload: ClassroomBroadcastPayloadSchema,
  })
  .strict();
export const ClassroomBroadcastReceiptSchema = z
  .object({
    clientId: id,
    broadcast: ClassroomBroadcastSchema,
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    newlyCreated: z.boolean(),
  })
  .strict();
export const ClassroomBroadcastFeedSchema = z
  .object({
    sessionId: id,
    sessionState: z.enum(['draft', 'open', 'closed', 'archived']),
    items: z.array(ClassroomBroadcastSchema).max(100),
    maxSequence: revision,
  })
  .strict();
export const PrepareClassroomBroadcastSchema = z
  .object({
    kind: z.enum(['assignment', 'exercise', 'open_url']),
    studentAction: z.enum(['open', 'explain']).nullable(),
    assignmentNumber: z.number().int().min(1).max(50).nullable(),
    assignmentTitle: z.string().trim().min(1).max(240).nullable(),
    assignmentRunId: id.nullable(),
    instruction: instruction.nullable(),
    url: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();
export const ClassroomBroadcastDraftSchema = z
  .object({
    draftId: id,
    taskId: id,
    sourceCallId: z.string().min(1).max(500),
    binding: TeacherClassroomBindingSchema,
    revision,
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    audience: z.literal('session_participants'),
    payload: ClassroomBroadcastPayloadSchema,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    state: z.enum([
      'prepared',
      'sending',
      'sent',
      'cancelled',
      'expired',
      'stale',
      'failed',
      'unknown',
    ]),
    receipt: ClassroomBroadcastReceiptSchema.nullable().default(null),
    error: z.string().max(500).nullable().default(null),
  })
  .strict();
export const BroadcastDraftProjectionSchema = z
  .object({
    taskId: id,
    revision,
    drafts: z.array(ClassroomBroadcastDraftSchema).max(20),
  })
  .strict();
export const BroadcastDraftActionSchema = z
  .object({ taskId: id, draftId: id, revision })
  .strict();
export const BroadcastDraftLookupSchema = BroadcastDraftActionSchema.omit({
  revision: true,
});
export const BroadcastIdRequestSchema = z.object({ broadcastId: id }).strict();
export const TeacherClassroomSelectSchema = z
  .object({ spaceId: id, sessionId: id })
  .strict();
export const TeacherClassroomClearSchema = z
  .object({ selectionId: id })
  .strict();
export const BroadcastNoticeSchema = z
  .object({
    anchorAttemptId: id,
    sessionId: id,
    revision,
    broadcast: ClassroomBroadcastSchema.nullable(),
    offline: z.boolean(),
  })
  .strict();
export const GuidanceContextModeSchema = z.enum([
  'screen_if_permitted',
  'text_only',
]);
export const GuidanceStatusSchema = z.enum([
  'accepted',
  'active',
  'finished',
  'cancelled',
  'failed',
  'interrupted',
  'unknown',
]);
export const GuidanceStartRequestSchema = z
  .object({
    clientStartId: id,
    taskId: id,
    clientInstanceId: id,
    contextMode: GuidanceContextModeSchema,
  })
  .strict();
export const GuidanceClaimSchema = z
  .object({
    id,
    broadcastId: id,
    sessionId: id,
    anchorAttemptId: id,
    attemptId: id,
    activityVersionId: id,
    workSessionId: id,
    taskId: id,
    clientStartId: id,
    clientInstanceId: id,
    contextMode: GuidanceContextModeSchema,
    status: GuidanceStatusSchema,
    revision,
    createdAt: z.string().datetime(),
    ownedByThisRequest: z.boolean(),
  })
  .strict();
export const GuidanceReportSchema = z
  .object({
    status: GuidanceStatusSchema,
    revision,
    reason: z.string().max(80).nullable(),
  })
  .strict();
export const GuidanceSummarySchema = z
  .object({
    broadcastId: id,
    counts: z.record(GuidanceStatusSchema, z.number().int().nonnegative()),
  })
  .strict();
export const GuidanceConsentRequestSchema = z
  .object({
    sessionId: id,
    enabled: z.boolean(),
    contextMode: GuidanceContextModeSchema,
  })
  .strict();
export const GuidanceStartLocalSchema = z
  .object({ broadcastId: id, contextMode: GuidanceContextModeSchema })
  .strict();
export const GuidanceContinueSchema = z
  .object({
    guidanceId: id,
    stepRevision: revision,
    action: z.enum(['next', 'question', 'finish', 'text_only']),
    text: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict();
export const GuidanceStateSchema = z
  .object({
    revision,
    sessionId: id.nullable(),
    consent: GuidanceConsentRequestSchema.nullable(),
    pending: z.array(ClassroomBroadcastSchema).max(5),
    active: z
      .object({
        guidanceId: id,
        taskId: id,
        broadcastId: id,
        stepRevision: revision,
        phase: z.enum([
          'starting',
          'observing',
          'planning',
          'presenting',
          'waiting',
          'finished',
          'cancelled',
          'failed',
          'unknown',
        ]),
        text: z.string().max(4_000),
        contextMode: GuidanceContextModeSchema,
      })
      .strict()
      .nullable(),
    message: z.string().max(500).nullable(),
  })
  .strict();
export const LocalGuidanceStartJournalSchema = z
  .object({
    lastText: z.string().max(4_000).nullable().optional(),
    modelRequestIds: z.array(id).max(8).optional(),
    ownerId: z.string().min(1).max(500),
    anchorAttemptId: id,
    broadcastId: id,
    request: GuidanceStartRequestSchema,
    claim: GuidanceClaimSchema.nullable(),
    phase: z.enum([
      'claiming',
      'claimed',
      'dispatching',
      'running',
      'terminal',
      'unknown',
    ]),
    modelRequests: revision,
    observations: revision,
    startedAt: z.string().datetime(),
    report: GuidanceReportSchema.nullable(),
  })
  .strict();
export type TeacherClassroomBinding = z.infer<
  typeof TeacherClassroomBindingSchema
>;
export type TeacherClassroomSelection = z.infer<
  typeof TeacherClassroomSelectionSchema
>;
export type TeacherClassroomContext = z.infer<
  typeof TeacherClassroomContextSchema
>;
export type SessionAssignment = z.infer<typeof SessionAssignmentSchema>;
export type ClassroomBroadcastPayload = z.infer<
  typeof ClassroomBroadcastPayloadSchema
>;
export type ClassroomBroadcast = z.infer<typeof ClassroomBroadcastSchema>;
export type ClassroomBroadcastReceipt = z.infer<
  typeof ClassroomBroadcastReceiptSchema
>;
export type ClassroomBroadcastFeed = z.infer<
  typeof ClassroomBroadcastFeedSchema
>;
export type ClassroomBroadcastDraft = z.infer<
  typeof ClassroomBroadcastDraftSchema
>;
export type PrepareClassroomBroadcast = z.infer<
  typeof PrepareClassroomBroadcastSchema
>;
export type BroadcastDraftProjection = z.infer<
  typeof BroadcastDraftProjectionSchema
>;
export type BroadcastNotice = z.infer<typeof BroadcastNoticeSchema>;
export type GuidanceContextMode = z.infer<typeof GuidanceContextModeSchema>;
export type GuidanceClaim = z.infer<typeof GuidanceClaimSchema>;
export type GuidanceStartRequest = z.infer<typeof GuidanceStartRequestSchema>;
export type GuidanceReport = z.infer<typeof GuidanceReportSchema>;
export type GuidanceState = z.infer<typeof GuidanceStateSchema>;
export type GuidanceContinue = z.infer<typeof GuidanceContinueSchema>;
export type LocalGuidanceStartJournal = z.infer<
  typeof LocalGuidanceStartJournalSchema
>;
