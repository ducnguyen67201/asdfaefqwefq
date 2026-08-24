import { z } from 'zod';

import { isPublicHostname } from './classroom-directive-policy.mjs';

export const KNOWLEDGE_LIMITS = Object.freeze({
  activityCriteria: 40,
  activityInstructionsChars: 24_000,
  dashboardPage: 500,
  evidencePerSession: 20,
  filesPerBatch: 100,
  fileBytes: 25 * 1024 * 1024,
  folderBytes: 250 * 1024 * 1024,
  searchCharacters: 12_000,
  searchResults: 6,
  roomCodeChars: 32,
  roomParticipants: 2_000,
  directiveCharacters: 4_000,
  directivesPerPage: 100,
});

export const UuidSchema = z.string().uuid();
export const SpaceRoleSchema = z.enum(['owner', 'facilitator', 'participant']);
export const SourceRoleSchema = z.enum([
  'reference',
  'instructions',
  'rubric',
  'starter',
  'submission',
]);
export const SourceVersionStateSchema = z.enum([
  'pending_upload',
  'processing',
  'ready',
  'failed',
]);
export const ActivityStateSchema = z.enum(['draft', 'published', 'archived']);
export const RunModeSchema = z.enum(['live', 'async', 'hybrid']);
export const RunStateSchema = z.enum(['draft', 'open', 'closed', 'archived']);
export const AttemptStateSchema = z.enum([
  'assigned',
  'in_progress',
  'blocked',
  'ready_for_review',
  'submitted',
  'completed',
  'withdrawn',
]);
export const WorkSessionStateSchema = z.enum([
  'created',
  'active',
  'paused',
  'completed',
  'cancelled',
  'failed',
]);
export const WorkSessionPurposeSchema = z.enum(['work', 'help', 'check']);
export const GuidancePolicySchema = z.object({
  answerReveal: z.enum(['allowed', 'after_attempt', 'never']).default('allowed'),
  hintMode: z.enum(['direct', 'guided', 'socratic']).default('guided'),
  maxHintLevel: z.number().int().min(0).max(5).default(3),
});
export const CriterionSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/u),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2_000).default(''),
  tags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});
export const ActivityDefinitionSchema = z.object({
  title: z.string().trim().min(1).max(240),
  objective: z.string().trim().min(1).max(4_000),
  instructions: z
    .string()
    .trim()
    .min(1)
    .max(KNOWLEDGE_LIMITS.activityInstructionsChars),
  launchTarget: z.enum(['none', 'workspace', 'current_surface']),
  guidancePolicy: GuidancePolicySchema.default({
    answerReveal: 'allowed',
    hintMode: 'guided',
    maxHintLevel: 3,
  }),
  criteria: z.array(CriterionSchema).max(KNOWLEDGE_LIMITS.activityCriteria).default([]),
  completionPolicy: z
    .object({
      requiresSubmission: z.boolean().default(false),
      requiresFacilitatorConfirmation: z.boolean().default(false),
    })
    .default({
      requiresFacilitatorConfirmation: false,
      requiresSubmission: false,
    }),
  sessionPolicy: z
    .object({
      allowedOrigins: z.array(
        z.string().trim().url().max(2_000).superRefine((value, context) => {
          try {
            const url = new URL(value);
            if (
              url.protocol !== 'https:' || url.username || url.password ||
              !isPublicHostname(url.hostname) || url.origin !== value
            ) {
              context.addIssue({ code: 'custom', message: 'Use an exact HTTPS origin without credentials or a path.' });
            }
          } catch {
            context.addIssue({ code: 'custom', message: 'Use a valid HTTPS origin.' });
          }
        }),
      ).max(20).default([]),
      allowRoomJoin: z.boolean().default(false),
    })
    .default({ allowedOrigins: [], allowRoomJoin: false }),
});

export const CreateSpaceSchema = z.object({
  clientId: UuidSchema,
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4_000).default(''),
  purposeLabel: z.string().trim().max(120).nullable().default(null),
}).strict();
export const UpdateSpaceSchema = CreateSpaceSchema.omit({ clientId: true }).partial().strict();
export const CreateGroupSchema = z.object({
  clientId: UuidSchema,
  name: z.string().trim().min(1).max(240),
}).strict();
export const CreateInviteSchema = z.object({
  clientId: UuidSchema,
  groupId: UuidSchema.nullable().default(null),
  role: z.enum(['facilitator', 'participant']),
  maxUses: z.number().int().min(1).max(10_000),
  expiresAt: z.string().datetime().nullable().default(null),
}).strict();
export const RedeemInviteSchema = z.object({ code: z.string().trim().min(8).max(128) }).strict();

export const UploadFileSchema = z.object({
  clientId: UuidSchema,
  relativePath: z.string().trim().min(1).max(2_000),
  displayName: z.string().trim().min(1).max(255),
  mediaType: z.enum(['text/plain', 'text/markdown', 'application/pdf']),
  byteSize: z.number().int().positive().max(KNOWLEDGE_LIMITS.fileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  role: SourceRoleSchema,
}).strict();
export const InitiateUploadSchema = z.object({
  files: z.array(UploadFileSchema).min(1).max(KNOWLEDGE_LIMITS.filesPerBatch),
}).strict().superRefine((value, context) => {
  const bytes = value.files.reduce((total, file) => total + file.byteSize, 0);
  if (bytes > KNOWLEDGE_LIMITS.folderBytes) {
    context.addIssue({ code: 'custom', message: 'Upload batch is too large.', path: ['files'] });
  }
});
export const CompleteUploadSchema = z.object({
  clientId: UuidSchema,
  sourceVersionId: UuidSchema,
}).strict();
export const CommitSubmissionSchema = z.object({ clientId: UuidSchema }).strict();

export const SaveActivityDraftSchema = z.object({
  clientId: UuidSchema,
  definition: ActivityDefinitionSchema,
  sourceVersionIds: z.array(UuidSchema).max(200).default([]),
}).strict();
export const PublishActivitySchema = z.object({ clientId: UuidSchema }).strict();
export const RunTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('group'), groupId: UuidSchema }).strict(),
  z.object({ kind: z.literal('participants'), userIds: z.array(z.string().trim().min(1).max(255)).min(1).max(2_000) }).strict(),
  z.object({ kind: z.literal('room') }).strict(),
]);
export const CreateRunSchema = z.object({
  clientId: UuidSchema,
  activityVersionId: UuidSchema,
  mode: RunModeSchema,
  opensAt: z.string().datetime().nullable().default(null),
  closesAt: z.string().datetime().nullable().default(null),
  target: RunTargetSchema,
  insightPolicy: z.enum(['explicit_and_operational', 'evidence_candidates']).default('explicit_and_operational'),
}).strict().superRefine((run, context) => {
  if (run.opensAt && run.closesAt && run.opensAt >= run.closesAt) {
    context.addIssue({ code: 'custom', message: 'Run close time must follow open time.', path: ['closesAt'] });
  }
  if (run.target.kind === 'room' && run.mode === 'async') {
    context.addIssue({ code: 'custom', message: 'Room Runs must use live or hybrid mode.', path: ['mode'] });
  }
});
export const AttemptAcknowledgeSchema = z.object({
  policyVersion: z.string().trim().min(1).max(64),
}).strict();
export const RequestHelpSchema = z.object({ clientId: UuidSchema }).strict();
export const CreateWorkSessionSchema = z.object({
  clientId: UuidSchema,
  taskId: UuidSchema,
  launchKind: z.enum(['none', 'workspace', 'current_surface']),
  purpose: WorkSessionPurposeSchema.default('work'),
}).strict();
export const UpdateWorkSessionSchema = z.object({
  state: WorkSessionStateSchema,
  helpRequested: z.boolean().optional(),
  hintLevel: z.number().int().min(0).max(5).optional(),
}).strict();
export const RecordEvidenceSchema = z.object({
  clientId: UuidSchema,
  workSessionId: UuidSchema,
  criterionId: z.string().trim().min(1).max(80),
  tag: z.string().trim().min(1).max(80),
  provenance: z.enum(['participant', 'host', 'agent_candidate', 'facilitator']),
  resultCode: z.enum(['observed', 'passed', 'failed', 'blocked', 'needs_review']),
}).strict();
export const SearchKnowledgeSchema = z.object({
  query: z.string().trim().min(2).max(1_000),
  limit: z.number().int().min(1).max(KNOWLEDGE_LIMITS.searchResults).default(KNOWLEDGE_LIMITS.searchResults),
}).strict();

export const CreateLiveRoomCodeSchema = z.object({
  clientId: UuidSchema,
  expiresAt: z.string().datetime().nullable().default(null),
  maxUses: z.number().int().min(1).max(KNOWLEDGE_LIMITS.roomParticipants).default(200),
}).strict();
export const JoinLiveRoomSchema = z.object({
  clientId: UuidSchema,
  code: z.string().trim().min(8).max(KNOWLEDGE_LIMITS.roomCodeChars),
}).strict();
export const LiveRoomMutationSchema = z.object({ clientId: UuidSchema }).strict();
export const SessionDirectiveInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('exercise'),
    instruction: z.string().trim().min(1).max(KNOWLEDGE_LIMITS.directiveCharacters),
    criterionIds: z.array(z.string().trim().min(1).max(80)).max(KNOWLEDGE_LIMITS.activityCriteria).default([]),
  }).strict(),
  z.object({
    kind: z.literal('open_url'),
    instruction: z.string().trim().min(1).max(KNOWLEDGE_LIMITS.directiveCharacters),
    criterionIds: z.array(z.string().trim().min(1).max(80)).max(KNOWLEDGE_LIMITS.activityCriteria).default([]),
    url: z.string().trim().url().max(2_000),
  }).strict(),
]);
export const CreateSessionDirectiveSchema = z.object({
  clientId: UuidSchema,
  directive: SessionDirectiveInputSchema,
}).strict();
export const ClaimSessionDirectiveSchema = z.object({ clientId: UuidSchema }).strict();
export const ReadyAttemptSchema = z.object({ clientId: UuidSchema }).strict();
export const ReviewAttemptSchema = z.object({
  clientId: UuidSchema,
  action: z.enum(['complete', 'return']),
}).strict();
export const ResolveAttemptHelpSchema = z.object({ clientId: UuidSchema }).strict();

export const CursorPageSchema = z.object({
  cursor: z.string().trim().min(1).max(512).nullable(),
  items: z.array(z.unknown()),
});

export function publicValidationError(error) {
  if (!(error instanceof z.ZodError)) return null;
  return {
    code: 'invalid_request',
    error: 'Request data is invalid.',
    issues: error.issues.slice(0, 12).map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
