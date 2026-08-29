import { z } from 'zod';

export const AGENT_ORCHESTRATOR_PROTOCOL_VERSION = 1 as const;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const JsonObjectSchema = z.record(z.string().min(1).max(200), z.unknown());
const AgentItemSchema = z.record(z.string().min(1).max(200), z.unknown());

export const WorkerRegistrationRequestSchema = z
  .object({
    instanceId: UuidSchema,
    protocolVersion: z.literal(AGENT_ORCHESTRATOR_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    releaseVersion: z.string().trim().min(1).max(100),
    sdkVersion: z.string().trim().min(1).max(100),
    graphVersion: DigestSchema,
  })
  .strict();

export const WorkerRegistrationResponseSchema = z
  .object({
    workerId: UuidSchema,
    expiresAt: TimestampSchema,
  })
  .strict();

export const WorkerHeartbeatRequestSchema = z
  .object({ releaseVersion: z.string().trim().min(1).max(100) })
  .strict();

export const WorkerHeartbeatResponseSchema = z
  .object({ expiresAt: TimestampSchema })
  .strict();

export const OrchestratorToolSpecSchema = z
  .object({
    toolId: z.string().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u),
    operation: z.string().trim().min(1).max(100).nullable(),
    operationSelector: JsonObjectSchema.nullable(),
    modelName: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/u),
    namespace: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u),
    description: z.string().trim().min(1).max(20_000),
    inputSchema: JsonObjectSchema,
    deferred: z.boolean(),
    executor: z.enum(['desktop', 'connector']),
    driverCatalogDigest: DigestSchema.nullable(),
  })
  .strict();

export const OrchestratorLimitsSchema = z
  .object({
    deadlineAt: TimestampSchema,
    maxModelSamples: z.number().int().positive().max(100),
    maxToolCalls: z.number().int().nonnegative().max(100),
    maxOutputCharacters: z.number().int().positive().max(100_000),
    maxSessionItems: z.number().int().positive().max(10_000),
  })
  .strict();

export const SerializedCheckpointSchema = z
  .object({
    revision: z.number().int().positive(),
    state: z.string().min(2).max(10_000_000),
    sdkVersion: z.string().min(1).max(100),
    graphVersion: DigestSchema,
    pendingCallId: z.string().min(1).max(255).nullable(),
  })
  .strict();

export const ClaimedRunSchema = z
  .object({
    runId: UuidSchema,
    runVersion: z.number().int().positive(),
    request: z.string().trim().min(2).max(8_000),
    model: z.string().trim().min(1).max(100),
    sdkVersion: z.string().trim().min(1).max(100),
    graphVersion: DigestSchema,
    protocolDigest: DigestSchema,
    toolCatalogDigest: DigestSchema,
    sessionRevision: z.number().int().nonnegative(),
    lastControlSequence: z.number().int().nonnegative(),
    tools: z.array(OrchestratorToolSpecSchema).max(512),
    limits: OrchestratorLimitsSchema,
    checkpoint: SerializedCheckpointSchema.nullable(),
  })
  .strict();

export const ClaimRunRequestSchema = z
  .object({
    workerId: UuidSchema,
    sdkVersion: z.string().trim().min(1).max(100),
    graphVersion: DigestSchema,
  })
  .strict();

export const ClaimRunResponseSchema = z
  .object({ run: ClaimedRunSchema.nullable() })
  .strict();

export const RunLeaseRequestSchema = z
  .object({
    workerId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    action: z.enum(['renew', 'release']),
  })
  .strict();

export const RunLeaseResponseSchema = z
  .object({ runVersion: z.number().int().positive(), expiresAt: TimestampSchema.nullable() })
  .strict();

export const SessionItemsResponseSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    items: z.array(AgentItemSchema).max(10_000),
  })
  .strict();

export const SessionTransactionSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('append_items'), items: z.array(AgentItemSchema).max(2_000) })
    .strict(),
  z
    .object({
      type: z.literal('replace_suffix'),
      expectedSuffix: z.array(AgentItemSchema).max(10_000),
      replacement: z.array(AgentItemSchema).max(10_000),
    })
    .strict(),
  z
    .object({ type: z.literal('clear'), expectedItems: z.array(AgentItemSchema).max(10_000) })
    .strict(),
]);

export const ApplySessionTransactionRequestSchema = z
  .object({
    workerId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    expectedSessionRevision: z.number().int().nonnegative(),
    operationId: z.string().trim().min(1).max(255),
    operationDigest: DigestSchema,
    transaction: SessionTransactionSchema,
  })
  .strict();

export const ApplySessionTransactionResponseSchema = z
  .object({ revision: z.number().int().nonnegative(), replayed: z.boolean() })
  .strict();

export const PutCheckpointRequestSchema = z
  .object({
    workerId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    expectedCheckpointRevision: z.number().int().nonnegative(),
    appliedControlSequence: z.number().int().nonnegative(),
    sdkVersion: z.string().trim().min(1).max(100),
    graphVersion: DigestSchema,
    pendingCallId: z.string().trim().min(1).max(255).nullable(),
    state: z.string().min(2).max(10_000_000),
  })
  .strict();

export const PutCheckpointResponseSchema = z
  .object({ checkpointRevision: z.number().int().positive(), runVersion: z.number().int().positive() })
  .strict();

export const SteeringUpdateSchema = z
  .object({
    sequence: z.number().int().positive(),
    instruction: z.string().trim().min(1).max(8_000),
  })
  .strict();

export const SteeringUpdatesResponseSchema = z
  .object({ items: z.array(SteeringUpdateSchema).max(20) })
  .strict();

export const QueueToolCallRequestSchema = z
  .object({
    workerId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    callId: z.string().trim().min(1).max(255),
    toolId: z.string().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u),
    operation: z.string().trim().min(1).max(100),
    arguments: JsonObjectSchema,
    catalogDigest: DigestSchema,
    driverCatalogDigest: DigestSchema.nullable(),
    sdkVersion: z.string().trim().min(1).max(100),
    graphVersion: DigestSchema,
    idempotencyDigest: DigestSchema,
  })
  .strict();

export const QueueToolCallResponseSchema = z
  .object({
    invocationId: UuidSchema,
    runVersion: z.number().int().positive(),
    replayed: z.boolean(),
  })
  .strict();

export const ToolCallResultSchema = z
  .object({
    status: z.enum([
      'pending',
      'confirmed',
      'failed',
      'denied',
      'not_executed',
      'unknown',
      'cancelled',
      'expired',
    ]),
    summary: z.string().trim().min(1).max(1_000),
    data: JsonObjectSchema.nullable(),
  })
  .strict();

export const ActivityRequestSchema = z
  .object({
    workerId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    sequence: z.number().int().positive(),
    kind: z.enum(['run_started', 'status', 'tool_started', 'tool_completed']),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const CompleteRunRequestSchema = z
  .object({
    workerId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    finalOutput: z.string().trim().min(1).max(8_000),
  })
  .strict();

export const FailRunRequestSchema = z
  .object({
    workerId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    stage: z.enum([
      'provider_request',
      'provider_dispatch',
      'tool_execution',
      'session',
      'runtime',
    ]),
    code: z.enum([
      'provider_request_rejected',
      'provider_unavailable',
      'provider_outcome_unknown',
      'tool_outcome_unknown',
      'internal_runtime_error',
      'session_conflict',
      'graph_version_mismatch',
    ]),
    message: z.string().trim().min(1).max(1_000),
    retryable: z.boolean(),
  })
  .strict();

export const RunMutationResponseSchema = z
  .object({ runVersion: z.number().int().positive() })
  .strict();

export const OrchestratorErrorSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{0,99}$/u),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
  })
  .strict();

export const AgentOrchestratorProtocolDocumentV1Schema = z
  .object({
    workerRegistrationRequest: WorkerRegistrationRequestSchema,
    workerRegistrationResponse: WorkerRegistrationResponseSchema,
    workerHeartbeatRequest: WorkerHeartbeatRequestSchema,
    workerHeartbeatResponse: WorkerHeartbeatResponseSchema,
    claimRunRequest: ClaimRunRequestSchema,
    claimRunResponse: ClaimRunResponseSchema,
    runLeaseRequest: RunLeaseRequestSchema,
    runLeaseResponse: RunLeaseResponseSchema,
    sessionItemsResponse: SessionItemsResponseSchema,
    applySessionTransactionRequest: ApplySessionTransactionRequestSchema,
    applySessionTransactionResponse: ApplySessionTransactionResponseSchema,
    putCheckpointRequest: PutCheckpointRequestSchema,
    putCheckpointResponse: PutCheckpointResponseSchema,
    steeringUpdatesResponse: SteeringUpdatesResponseSchema,
    queueToolCallRequest: QueueToolCallRequestSchema,
    queueToolCallResponse: QueueToolCallResponseSchema,
    toolCallResult: ToolCallResultSchema,
    activityRequest: ActivityRequestSchema,
    completeRunRequest: CompleteRunRequestSchema,
    failRunRequest: FailRunRequestSchema,
    runMutationResponse: RunMutationResponseSchema,
    error: OrchestratorErrorSchema,
  })
  .strict();

export type ClaimedRun = z.infer<typeof ClaimedRunSchema>;
export type OrchestratorToolSpec = z.infer<typeof OrchestratorToolSpecSchema>;
export type ClaimRunRequest = z.infer<typeof ClaimRunRequestSchema>;
export type SessionItemsResponse = z.infer<typeof SessionItemsResponseSchema>;
export type ApplySessionTransactionRequest = z.infer<
  typeof ApplySessionTransactionRequestSchema
>;
export type PutCheckpointRequest = z.infer<typeof PutCheckpointRequestSchema>;
export type SteeringUpdate = z.infer<typeof SteeringUpdateSchema>;
export type QueueToolCallRequest = z.infer<typeof QueueToolCallRequestSchema>;
export type ToolCallResult = z.infer<typeof ToolCallResultSchema>;
