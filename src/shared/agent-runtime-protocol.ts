import { z } from 'zod';

export const AGENT_RUNTIME_PROTOCOL_VERSION = 4 as const;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });

export const AgentRuntimeRolloutModeV4Schema = z
  .enum(['observe', 'dual', 'enforce'])
  .meta({ id: 'AgentRuntimeRolloutModeV4' });

export const AgentRunStateV4Schema = z
  .enum([
    'queued',
    'compiling_outcomes',
    'planning',
    'awaiting_worker',
    'awaiting_permission',
    'executing_tool',
    'awaiting_input',
    'verifying',
    'recovering',
    'completed',
    'blocked',
    'failed',
    'cancelled',
    'expired',
  ])
  .meta({ id: 'AgentRunStateV4' });

export const AgentRunPhaseV4Schema = z
  .enum([
    'ready',
    'planning',
    'paused',
    'awaiting_permission',
    'awaiting_input',
    'acting',
    'verifying',
    'completed',
    'blocked',
    'failed',
    'cancelled',
  ])
  .meta({ id: 'AgentRunPhaseV4' });

export const AgentRunActionV4Schema = z
  .enum([
    'steer',
    'cancel',
    'respond',
    'open_system_settings',
    'continue_without_computer',
    'retry_as_new_task',
  ])
  .meta({ id: 'AgentRunActionV4' });

export const CancellationSourceV4Schema = z
  .enum([
    'stop_button',
    'focused_escape',
    'replacement',
    'sign_out',
    'shutdown',
  ])
  .meta({ id: 'CancellationSourceV4' });

export const ComputerPermissionV4Schema = z
  .enum(['accessibility', 'screen_recording'])
  .meta({ id: 'ComputerPermissionV4' });

export const AgentRunFailureStageV4Schema = z
  .enum([
    'negotiation',
    'provider_request',
    'provider_dispatch',
    'tool_execution',
    'verification',
    'runtime',
  ])
  .meta({ id: 'AgentRunFailureStageV4' });

export const AgentRunFailureCodeV4Schema = z
  .enum([
    'provider_request_rejected',
    'provider_unavailable',
    'provider_outcome_unknown',
    'effect_outcome_unknown',
    'required_outcome_unverified',
    'internal_runtime_error',
    'permission_unavailable',
    'run_expired',
  ])
  .meta({ id: 'AgentRunFailureCodeV4' });

export const AgentRuntimeErrorCodeV4Schema = z
  .enum([
    'desktop_upgrade_required',
    'backend_upgrade_required',
    'protocol_upgrade_required',
    'tool_catalog_upgrade_required',
    'stale_run_version',
    'transition_rejected',
    'run_not_cancellable',
    'permission_interaction_stale',
    'invalid_agent_runtime_request',
    'agent_runtime_unavailable',
  ])
  .meta({ id: 'AgentRuntimeErrorCodeV4' });

export const ActionEffectKindV4Schema = z
  .enum([
    'none',
    'create_resource',
    'update_resource',
    'rename_resource',
    'move_resource',
    'add_comment',
    'workspace_write',
    'workspace_command',
    'send_communication',
    'delete_or_archive',
    'unexpected_overwrite',
    'publish',
    'deploy',
    'merge',
    'financial_or_trade',
    'authentication_or_credential',
    'system_permission',
    'install',
    'sensitive_transfer',
    'unknown',
  ])
  .meta({ id: 'ActionEffectKindV4' });

export const ResourceKindV4Schema = z
  .enum([
    'calendar_event',
    'document',
    'spreadsheet',
    'spreadsheet_row',
    'workspace_file',
    'workspace_repository',
    'comment',
    'issue',
    'pull_request',
    'email',
    'message',
    'form_submission',
    'download',
    'application',
    'generic_private_resource',
    'generic_public_resource',
  ])
  .meta({ id: 'ResourceKindV4' });

export const ActionEffectV4Schema = z
  .object({
    kind: ActionEffectKindV4Schema,
    resourceKind: ResourceKindV4Schema.nullable(),
    reversibility: z.enum(['none', 'reversible', 'destructive', 'unknown']),
    externality: z.enum([
      'local',
      'cloud_private',
      'external',
      'public',
      'unknown',
    ]),
    communication: z.enum([
      'none',
      'draft',
      'send',
      'invite',
      'notify',
      'unknown',
    ]),
    overwrite: z.enum(['none', 'requested', 'unexpected', 'unknown']),
    sensitiveDataTransfer: z.union([z.boolean(), z.literal('unknown')]),
  })
  .strict()
  .meta({ id: 'ActionEffectV4' });

export const WaitingOnV4Schema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('worker'),
        since: TimestampSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('permission'),
        interactionId: UuidSchema,
        invocationId: UuidSchema,
        requiredPermissions: z.array(ComputerPermissionV4Schema).min(1).max(2),
        since: TimestampSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('input'),
        interactionId: UuidSchema,
        prompt: z.string().min(1).max(2_000),
        choices: z.array(z.string().min(1).max(500)).max(12),
        since: TimestampSchema,
      })
      .strict(),
  ])
  .meta({ id: 'WaitingOnV4' });

export const AgentRunFailureV4Schema = z
  .object({
    stage: AgentRunFailureStageV4Schema,
    code: AgentRunFailureCodeV4Schema,
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
  })
  .strict()
  .meta({ id: 'AgentRunFailureV4' });

export const AgentRunProjectionV4Schema = z
  .object({
    state: AgentRunStateV4Schema,
    runVersion: z.number().int().positive(),
    phase: AgentRunPhaseV4Schema,
    terminal: z.boolean(),
    availableActions: z.array(AgentRunActionV4Schema).max(4),
    waitingOn: WaitingOnV4Schema.nullable(),
    failure: AgentRunFailureV4Schema.nullable(),
    cancellationSource: CancellationSourceV4Schema.nullable(),
  })
  .strict()
  .meta({ id: 'AgentRunProjectionV4' });

export const AgentRuntimeStatusV4Schema = z
  .object({
    protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    toolCatalogDigest: DigestSchema,
    supportedReadVersions: z.array(
      z.union([z.literal(2), z.literal(3), z.literal(4)]),
    ),
    supportedStartVersions: z.array(z.literal(4)),
    rolloutMode: AgentRuntimeRolloutModeV4Schema,
    workerRequired: z.boolean(),
    enabled: z.boolean(),
  })
  .strict()
  .meta({ id: 'AgentRuntimeStatusV4' });

export const AgentRuntimeNegotiationV4Schema = z
  .object({
    protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    toolCatalogDigest: DigestSchema,
  })
  .strict()
  .meta({ id: 'AgentRuntimeNegotiationV4' });

export const SubmitAgentTaskRequestV4Schema = AgentRuntimeNegotiationV4Schema.extend({
  clientTaskId: UuidSchema,
  taskId: UuidSchema,
  request: z.string().trim().min(2).max(8_000),
  executionProfile: z.enum(['everyday', 'workspace']),
  workspaceSelectionId: UuidSchema.nullable(),
  activityAttemptId: UuidSchema.nullable(),
  activityIntent: z.enum(['work', 'help', 'check']),
})
  .strict()
  .meta({ id: 'SubmitAgentTaskRequestV4' });

export const OutcomeProjectionV4Schema = z
  .object({
    criterionId: z.string().min(1).max(80),
    required: z.boolean(),
    status: z.enum(['pending', 'passed', 'failed', 'unknown']),
    verifierKind: z.enum([
      'assistant_output',
      'application_surface',
      'browser_semantic',
      'filesystem_effect',
      'tool_effect',
      'semantic_judge',
    ]),
  })
  .strict()
  .meta({ id: 'OutcomeProjectionV4' });

export const AgentTaskRecordV4Schema = z
  .object({
    id: UuidSchema,
    taskId: UuidSchema,
    clientTaskId: UuidSchema,
    request: z.string().min(2).max(8_000),
    executionProfile: z.enum(['everyday', 'workspace']),
    workspaceSelectionId: UuidSchema.nullable(),
    protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    toolCatalogDigest: DigestSchema,
    outcomeRevision: z.number().int().positive(),
    publicSummary: z.string().max(1_000),
    authorityContract: z.record(z.string(), z.unknown()),
    projection: AgentRunProjectionV4Schema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    newlyCreated: z.boolean(),
  })
  .strict()
  .meta({ id: 'AgentTaskRecordV4' });

export const AgentTaskListV4Schema = z
  .object({
    items: z.array(AgentTaskRecordV4Schema).max(100),
  })
  .strict()
  .meta({ id: 'AgentTaskListV4' });

export const AgentTaskEventV4Schema = z
  .object({
    id: UuidSchema,
    runId: UuidSchema,
    sequence: z.number().int().positive(),
    eventType: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(1_000),
    finalOutput: z.string().trim().min(1).max(8_000).nullable(),
    outcomeRevision: z.number().int().positive().nullable(),
    outcomes: z.array(OutcomeProjectionV4Schema).max(20),
    projection: AgentRunProjectionV4Schema,
    createdAt: TimestampSchema,
  })
  .strict()
  .meta({ id: 'AgentTaskEventV4' });

export const CancelAgentTaskRequestV4Schema = AgentRuntimeNegotiationV4Schema.extend({
  clientCommandId: UuidSchema,
  expectedRunVersion: z.number().int().positive(),
  source: CancellationSourceV4Schema,
})
  .strict()
  .meta({ id: 'CancelAgentTaskRequestV4' });

export const DesktopWorkerCapabilitiesV4Schema = AgentRuntimeNegotiationV4Schema.extend({
  tools: z
    .array(
      z
        .object({
          toolId: z.string().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u),
          operations: z.array(z.string().min(1).max(100)).min(1),
        })
        .strict(),
    )
    .max(32),
})
  .strict()
  .meta({ id: 'DesktopWorkerCapabilitiesV4' });

export const DesktopWorkerSessionV4Schema = z
  .object({
    id: UuidSchema,
    protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    toolCatalogDigest: DigestSchema,
    connectedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .strict()
  .meta({ id: 'DesktopWorkerSessionV4' });

export const DesktopInvocationV4Schema = z
  .object({
    protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    toolCatalogDigest: DigestSchema,
    invocationId: UuidSchema,
    runId: UuidSchema,
    runVersion: z.number().int().positive(),
    callId: z.string().trim().min(1).max(255),
    toolId: z.string().regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u),
    operation: z.string().trim().min(1).max(100),
    effect: ActionEffectV4Schema,
    consequential: z.boolean(),
    permissionInteractionId: UuidSchema.nullable(),
    permissionRequirements: z.array(ComputerPermissionV4Schema).max(2),
    input: z.record(z.string().min(1).max(100), z.unknown()),
    obligations: z
      .array(
        z
          .object({
            criterionId: z.string().min(1).max(80),
            verifierKind: z.enum([
              'application_surface',
              'browser_semantic',
              'filesystem_effect',
              'tool_effect',
            ]),
          })
          .strict(),
      )
      .max(20),
    expiresAt: TimestampSchema,
  })
  .strict()
  .superRefine((invocation, context) => {
    if (invocation.consequential !== (invocation.effect.kind !== 'none')) {
      context.addIssue({
        code: 'custom',
        message: 'Invocation consequence must match its typed effect.',
        path: ['consequential'],
      });
    }
  })
  .meta({ id: 'DesktopInvocationV4' });

export const DesktopResultV4Schema = z
  .object({
    invocationId: UuidSchema,
    status: z.enum([
      'confirmed',
      'failed',
      'denied',
      'not_executed',
      'unknown',
      'cancelled',
    ]),
    summary: z.string().trim().min(1).max(1_000),
    data: z.record(z.string().min(1).max(100), z.unknown()).nullable().optional(),
    visual: z
      .object({
        dataBase64: z.string().min(1).max(40_000_000),
        detail: z.literal('original'),
        mimeType: z.enum(['image/jpeg', 'image/png']),
        observationId: UuidSchema,
      })
      .strict()
      .nullable()
      .optional(),
    evidence: z
      .array(
        z
          .object({
            criterionId: z.string().min(1).max(80),
            source: z.enum([
              'tool_result',
              'fresh_observation',
              'browser_dom',
              'filesystem',
            ]),
            status: z.enum(['supports', 'contradicts', 'unknown']),
            observationId: UuidSchema.nullable(),
            observationFingerprint: DigestSchema.nullable(),
            summary: z.string().trim().min(1).max(1_000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .meta({ id: 'DesktopResultV4' });

export const PermissionWaitRequestV4Schema = z
  .object({
    invocationId: UuidSchema,
    interactionId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    requiredPermissions: z.array(ComputerPermissionV4Schema).min(1).max(2),
  })
  .strict()
  .meta({ id: 'PermissionWaitRequestV4' });

export const PermissionDecisionRequestV4Schema = z
  .object({
    invocationId: UuidSchema,
    interactionId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    decision: z.enum(['granted', 'continue_without_computer']),
  })
  .strict()
  .meta({ id: 'PermissionDecisionRequestV4' });

export const BeginDesktopExecutionRequestV4Schema = z
  .object({
    invocationId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
  })
  .strict()
  .meta({ id: 'BeginDesktopExecutionRequestV4' });

export const AgentRuntimeErrorV4Schema = z
  .object({
    code: AgentRuntimeErrorCodeV4Schema,
    error: z.string().min(1).max(1_000).optional(),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
    currentProjection: AgentRunProjectionV4Schema.nullable(),
  })
  .strict()
  .meta({ id: 'AgentRuntimeErrorV4' });

export const AgentRuntimeProtocolDocumentV4Schema = z
  .object({
    status: AgentRuntimeStatusV4Schema,
    negotiation: AgentRuntimeNegotiationV4Schema,
    submitRequest: SubmitAgentTaskRequestV4Schema,
    taskRecord: AgentTaskRecordV4Schema,
    taskList: AgentTaskListV4Schema,
    taskEvent: AgentTaskEventV4Schema,
    cancelRequest: CancelAgentTaskRequestV4Schema,
    workerCapabilities: DesktopWorkerCapabilitiesV4Schema,
    workerSession: DesktopWorkerSessionV4Schema,
    desktopInvocation: DesktopInvocationV4Schema,
    desktopResult: DesktopResultV4Schema,
    permissionWaitRequest: PermissionWaitRequestV4Schema,
    permissionDecisionRequest: PermissionDecisionRequestV4Schema,
    beginDesktopExecutionRequest: BeginDesktopExecutionRequestV4Schema,
    error: AgentRuntimeErrorV4Schema,
  })
  .strict()
  .meta({ id: 'AgentRuntimeProtocolDocumentV4' });

export type AgentRuntimeStatusV4 = z.infer<typeof AgentRuntimeStatusV4Schema>;
export type ComputerPermissionV4 = z.infer<typeof ComputerPermissionV4Schema>;
export type AgentRunActionV4 = z.infer<typeof AgentRunActionV4Schema>;
export type AgentRunProjectionV4 = z.infer<typeof AgentRunProjectionV4Schema>;
export type AgentTaskRecordV4 = z.infer<typeof AgentTaskRecordV4Schema>;
export type AgentTaskEventV4 = z.infer<typeof AgentTaskEventV4Schema>;
export type CancelAgentTaskRequestV4 = z.infer<typeof CancelAgentTaskRequestV4Schema>;
export type DesktopWorkerCapabilitiesV4 = z.infer<typeof DesktopWorkerCapabilitiesV4Schema>;
export type DesktopInvocationV4 = z.infer<typeof DesktopInvocationV4Schema>;
export type DesktopResultV4 = z.infer<typeof DesktopResultV4Schema>;
export type PermissionWaitRequestV4 = z.infer<typeof PermissionWaitRequestV4Schema>;
export type PermissionDecisionRequestV4 = z.infer<typeof PermissionDecisionRequestV4Schema>;
export type BeginDesktopExecutionRequestV4 = z.infer<
  typeof BeginDesktopExecutionRequestV4Schema
>;

const terminalStates = new Set<AgentRunProjectionV4['state']>([
  'completed',
  'blocked',
  'failed',
  'cancelled',
  'expired',
]);

export function validateAgentRunProjectionV4(
  projection: AgentRunProjectionV4,
): AgentRunProjectionV4 {
  const parsed = AgentRunProjectionV4Schema.parse(projection);
  if (parsed.terminal !== terminalStates.has(parsed.state)) {
    throw new Error('Agent runtime terminal projection does not match state.');
  }
  if (parsed.terminal && parsed.availableActions.includes('cancel')) {
    throw new Error('Terminal agent runs cannot advertise cancellation.');
  }
  if (
    (parsed.state === 'awaiting_permission') !==
    (parsed.waitingOn?.kind === 'permission')
  ) {
    throw new Error('Permission wait metadata does not match run state.');
  }
  return parsed;
}
