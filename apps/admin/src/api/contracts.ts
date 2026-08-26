import { z } from 'zod';

const pageSchema = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const classroomRoleSchema = z.enum([
  'unassigned',
  'teacher',
  'student',
]);
export type ClassroomRole = z.infer<typeof classroomRoleSchema>;

export const adminUserSchema = z.object({
  accessCodeId: z.string().nullable(),
  blockedAt: z.string().nullable(),
  classroomRole: classroomRoleSchema,
  codeLabel: z.string().nullable(),
  createdAt: z.string(),
  email: z.string(),
  id: z.string(),
  lastSeenAt: z.string().nullable(),
  name: z.string(),
  plan: z.string(),
  status: z.enum(['active', 'blocked']),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const usersResponseSchema = z.object({
  items: z.array(adminUserSchema),
  page: pageSchema,
  summary: z.object({
    activeUsers: z.number().int().nonnegative(),
    blockedUsers: z.number().int().nonnegative(),
    totalUsers: z.number().int().nonnegative(),
  }),
});
export type UsersResponse = z.infer<typeof usersResponseSchema>;

export const usageLaneSchema = z.enum([
  'realtime_transcription',
  'responses',
  'speech',
  'transcription',
]);
export type UsageLane = z.infer<typeof usageLaneSchema>;

const usageItemSchema = z.object({
  activityTitle: z.string().nullable(),
  amountMicroUsd: z.number(),
  audioDurationMs: z.number(),
  cacheWriteTokens: z.number(),
  cachedInputTokens: z.number(),
  characterCount: z.number(),
  createdAt: z.string(),
  durationMs: z.number(),
  id: z.string(),
  inputTokens: z.number(),
  lane: usageLaneSchema,
  model: z.string(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
  taskId: z.string(),
  usageSource: z.string(),
  user: z.object({
    email: z.string(),
    id: z.string(),
    name: z.string(),
    plan: z.string(),
  }),
});
export type UsageItem = z.infer<typeof usageItemSchema>;

const usageSeriesItemSchema = z.object({
  requests: z.number().int().nonnegative(),
  spendMicroUsd: z.number(),
  startedAt: z.string(),
  tokens: z.number(),
});
export type UsageSeriesItem = z.infer<typeof usageSeriesItemSchema>;

export const usageResponseSchema = z.object({
  items: z.array(usageItemSchema),
  page: pageSchema,
  series: z.object({
    granularity: z.enum(['hour', 'day', 'month']),
    items: z.array(usageSeriesItemSchema),
  }),
  summary: z.object({
    activeUsers: z.number().int().nonnegative(),
    totalRequests: z.number().int().nonnegative(),
    totalSpendMicroUsd: z.number(),
    totalTokens: z.number(),
  }),
});
export type UsageResponse = z.infer<typeof usageResponseSchema>;

export const accessCodeSchema = z.object({
  activeSeats: z.number().int().nonnegative(),
  assignedSeats: z.number().int().nonnegative(),
  claimState: z.enum(['claimed', 'shared', 'unclaimed']),
  code: z.string().nullable(),
  createdAt: z.string(),
  distributionMode: z.enum(['organization', 'shared']),
  id: z.string(),
  label: z.string().nullable(),
  maxUsers: z.number().int().positive(),
  organizer: z
    .object({ email: z.string(), name: z.string().nullable() })
    .nullable(),
  pausedAt: z.string().nullable(),
  pendingSeats: z.number().int().nonnegative(),
  plan: z.string(),
  redeemedUsers: z.number().int().nonnegative(),
  remainingUsers: z.number().int().nonnegative(),
  retrievable: z.boolean(),
  status: z.enum(['available', 'full', 'paused']),
});
export type AccessCode = z.infer<typeof accessCodeSchema>;

export const accessCodesResponseSchema = z.object({
  items: z.array(accessCodeSchema),
  page: pageSchema,
  summary: z.object({
    availableCodes: z.number().int().nonnegative(),
    fullCodes: z.number().int().nonnegative(),
    pausedCodes: z.number().int().nonnegative(),
    retrievableCodes: z.number().int().nonnegative(),
    totalCodes: z.number().int().nonnegative(),
    totalRedemptions: z.number().int().nonnegative(),
  }),
});
export type AccessCodesResponse = z.infer<typeof accessCodesResponseSchema>;

export const createdCodeSchema = z.object({
  code: z.string(),
  createdAt: z.string(),
  distributionMode: z.enum(['organization', 'shared']),
  id: z.string(),
  label: z.string().nullable(),
  maxUsers: z.number().int().positive(),
  plan: z.string(),
});
export type CreatedCode = z.infer<typeof createdCodeSchema>;

export const createdCodesResponseSchema = z.object({
  items: z.array(createdCodeSchema),
});

const codeUserSchema = z.object({
  email: z.string(),
  id: z.string(),
  name: z.string().nullable(),
  redeemedAt: z.string().nullable(),
  role: z.string().nullable(),
  state: z.enum(['active', 'pending']),
  status: z.enum(['active', 'blocked']),
});
export type CodeUser = z.infer<typeof codeUserSchema>;

export const codeUsersResponseSchema = z.object({
  code: z.object({
    assignedSeats: z.number().int().nonnegative(),
    distributionMode: z.enum(['organization', 'shared']),
    id: z.string(),
    label: z.string().nullable(),
    maxUsers: z.number().int().positive(),
    plan: z.string(),
    redeemedUsers: z.number().int().nonnegative(),
  }),
  items: z.array(codeUserSchema),
  page: pageSchema,
});
export type CodeUsersResponse = z.infer<typeof codeUsersResponseSchema>;

export interface CreateCodesInput {
  count: number;
  distributionMode: 'organization' | 'shared';
  label: string | null;
  maxUsers: number;
  plan: string;
}
