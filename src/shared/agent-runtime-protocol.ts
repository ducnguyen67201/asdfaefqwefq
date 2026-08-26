import { z } from 'zod';

export const AGENT_RUNTIME_PROTOCOL_VERSION = 3 as const;

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });

export const AgentRuntimeRolloutModeV3Schema = z
  .enum(['observe', 'dual', 'enforce'])
  .meta({ id: 'AgentRuntimeRolloutModeV3' });

export const AgentRunStateV3Schema = z
  .enum([
    'queued',
    'compiling_outcomes',
    'planning',
    'awaiting_worker',
    'awaiting_permission',
    'executing_tool',
    'awaiting_input',
    'awaiting_approval',
    'verifying',
    'recovering',
    'completed',
    'blocked',
    'failed',
    'cancelled',
    'expired',
  ])
  .meta({ id: 'AgentRunStateV3' });

export const AgentRunPhaseV3Schema = z
  .enum([
    'ready',
    'planning',
    'paused',
    'awaiting_permission',
    'awaiting_input',
    'awaiting_approval',
    'acting',
    'verifying',
    'completed',
    'blocked',
    'failed',
    'cancelled',
  ])
  .meta({ id: 'AgentRunPhaseV3' });

export const AgentRunActionV3Schema = z
  .enum([
    'steer',
    'cancel',
    'respond',
    'approve',
    'deny',
    'open_system_settings',
    'continue_without_computer',
    'retry_as_new_task',
  ])
  .meta({ id: 'AgentRunActionV3' });

export const CancellationSourceV3Schema = z
  .enum([
    'stop_button',
    'focused_escape',
    'replacement',
    'sign_out',
    'shutdown',
  ])
  .meta({ id: 'CancellationSourceV3' });

export const ComputerPermissionV3Schema = z
  .enum(['accessibility', 'screen_recording'])
  .meta({ id: 'ComputerPermissionV3' });

export const AgentRunFailureStageV3Schema = z
  .enum([
    'negotiation',
    'provider_request',
    'provider_dispatch',
    'tool_execution',
    'verification',
    'runtime',
  ])
  .meta({ id: 'AgentRunFailureStageV3' });

export const AgentRunFailureCodeV3Schema = z
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
  .meta({ id: 'AgentRunFailureCodeV3' });

export const AgentRuntimeErrorCodeV3Schema = z
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
  .meta({ id: 'AgentRuntimeErrorCodeV3' });

export const ActionEffectKindV3Schema = z
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
  .meta({ id: 'ActionEffectKindV3' });

export const ResourceKindV3Schema = z
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
  .meta({ id: 'ResourceKindV3' });

export const ActionEffectV3Schema = z
  .object({
    kind: ActionEffectKindV3Schema,
    resourceKind: ResourceKindV3Schema.nullable(),
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
  .meta({ id: 'ActionEffectV3' });

export const ProposedActionV3Schema = z
  .object({
    action: z.enum([
      'login', 'send', 'submit', 'upload', 'download', 'delete', 'purchase',
      'install', 'run_command', 'write_file', 'system_permission', 'answer',
      'guide', 'observe_screen', 'open_application', 'open_url', 'click_element',
      'type_text', 'press_key', 'scroll', 'drag', 'read_file',
      'record_activity_signal',
    ]),
    toolId: z.string().trim().min(3).max(100)
      .regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/u).optional(),
    operation: z.string().trim().min(1).max(100).optional(),
    effect: ActionEffectV3Schema.optional(),
    description: z.string().min(1).max(2_000),
    target: z.string().max(2_000).optional(),
    parameters: z.record(
      z.string().min(1).max(100),
      z.union([z.string().max(100_000), z.array(z.string().max(8_000)).max(100)]),
    ).refine((parameters) => Object.keys(parameters).length <= 64),
  })
  .strict()
  .meta({ id: 'ProposedActionV3' });

export const WaitingOnV3Schema = z
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
        requiredPermissions: z.array(ComputerPermissionV3Schema).min(1).max(2),
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
    z
      .object({
        kind: z.literal('approval'),
        interactionId: UuidSchema,
        actionDigest: DigestSchema,
        action: ProposedActionV3Schema,
        consequence: z.string().min(1).max(2_000),
        expiresAt: TimestampSchema,
        since: TimestampSchema,
      })
      .strict(),
  ])
  .meta({ id: 'WaitingOnV3' });

export const AgentRunFailureV3Schema = z
  .object({
    stage: AgentRunFailureStageV3Schema,
    code: AgentRunFailureCodeV3Schema,
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
  })
  .strict()
  .meta({ id: 'AgentRunFailureV3' });

export const AgentRunProjectionV3Schema = z
  .object({
    state: AgentRunStateV3Schema,
    runVersion: z.number().int().positive(),
    phase: AgentRunPhaseV3Schema,
    terminal: z.boolean(),
    availableActions: z.array(AgentRunActionV3Schema).max(4),
    waitingOn: WaitingOnV3Schema.nullable(),
    failure: AgentRunFailureV3Schema.nullable(),
    cancellationSource: CancellationSourceV3Schema.nullable(),
  })
  .strict()
  .meta({ id: 'AgentRunProjectionV3' });

export const AgentRuntimeStatusV3Schema = z
  .object({
    protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    toolCatalogDigest: DigestSchema,
    supportedReadVersions: z.array(z.union([z.literal(2), z.literal(3)])),
    supportedStartVersions: z.array(z.union([z.literal(2), z.literal(3)])),
    rolloutMode: AgentRuntimeRolloutModeV3Schema,
    workerRequired: z.boolean(),
    enabled: z.boolean(),
  })
  .strict()
  .meta({ id: 'AgentRuntimeStatusV3' });

export const AgentRuntimeNegotiationV3Schema = z
  .object({
    protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    toolCatalogDigest: DigestSchema,
  })
  .strict()
  .meta({ id: 'AgentRuntimeNegotiationV3' });

export const SubmitAgentTaskRequestV3Schema = AgentRuntimeNegotiationV3Schema.extend({
  clientTaskId: UuidSchema,
  taskId: UuidSchema,
  request: z.string().trim().min(2).max(8_000),
  autonomyMode: z.enum(['balanced', 'strict']),
  executionProfile: z.enum(['everyday', 'workspace']),
  workspaceSelectionId: UuidSchema.nullable(),
  activityAttemptId: UuidSchema.nullable(),
  activityIntent: z.enum(['work', 'help', 'check']),
})
  .strict()
  .meta({ id: 'SubmitAgentTaskRequestV3' });

export const OutcomeProjectionV3Schema = z
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
  .meta({ id: 'OutcomeProjectionV3' });

export const AgentTaskRecordV3Schema = z
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
    projection: AgentRunProjectionV3Schema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    newlyCreated: z.boolean(),
  })
  .strict()
  .meta({ id: 'AgentTaskRecordV3' });

export const AgentTaskListV3Schema = z
  .object({
    items: z.array(AgentTaskRecordV3Schema).max(100),
  })
  .strict()
  .meta({ id: 'AgentTaskListV3' });

export const AgentTaskEventV3Schema = z
  .object({
    id: UuidSchema,
    runId: UuidSchema,
    sequence: z.number().int().positive(),
    eventType: z.string().trim().min(1).max(80),
    summary: z.string().trim().min(1).max(1_000),
    finalOutput: z.string().trim().min(1).max(8_000).nullable(),
    outcomeRevision: z.number().int().positive().nullable(),
    outcomes: z.array(OutcomeProjectionV3Schema).max(20),
    projection: AgentRunProjectionV3Schema,
    createdAt: TimestampSchema,
  })
  .strict()
  .meta({ id: 'AgentTaskEventV3' });

export const CancelAgentTaskRequestV3Schema = AgentRuntimeNegotiationV3Schema.extend({
  clientCommandId: UuidSchema,
  expectedRunVersion: z.number().int().positive(),
  source: CancellationSourceV3Schema,
})
  .strict()
  .meta({ id: 'CancelAgentTaskRequestV3' });

export const DesktopWorkerCapabilitiesV3Schema = AgentRuntimeNegotiationV3Schema.extend({
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
  .meta({ id: 'DesktopWorkerCapabilitiesV3' });

export const DesktopWorkerSessionV3Schema = z
  .object({
    id: UuidSchema,
    protocolVersion: z.literal(AGENT_RUNTIME_PROTOCOL_VERSION),
    protocolDigest: DigestSchema,
    toolCatalogDigest: DigestSchema,
    connectedAt: TimestampSchema,
    expiresAt: TimestampSchema,
  })
  .strict()
  .meta({ id: 'DesktopWorkerSessionV3' });

export const DesktopInvocationV3Schema = z
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
    effect: ActionEffectV3Schema,
    intentRevision: z.number().int().positive().max(10_000),
    approvalRequired: z.boolean(),
    authorizationSource: z.enum([
      'routine',
      'user_instruction',
      'exact_approval',
      'none',
    ]),
    consequential: z.boolean(),
    permissionInteractionId: UuidSchema.nullable(),
    permissionRequirements: z.array(ComputerPermissionV3Schema).max(2),
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
  .meta({ id: 'DesktopInvocationV3' });

export const DesktopResultV3Schema = z
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
  .meta({ id: 'DesktopResultV3' });

export const PermissionWaitRequestV3Schema = z
  .object({
    invocationId: UuidSchema,
    interactionId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    requiredPermissions: z.array(ComputerPermissionV3Schema).min(1).max(2),
  })
  .strict()
  .meta({ id: 'PermissionWaitRequestV3' });

export const PermissionDecisionRequestV3Schema = z
  .object({
    invocationId: UuidSchema,
    interactionId: UuidSchema,
    expectedRunVersion: z.number().int().positive(),
    decision: z.enum(['granted', 'continue_without_computer']),
  })
  .strict()
  .meta({ id: 'PermissionDecisionRequestV3' });

export const ApprovalDecisionRequestV3Schema = z
  .object({
    interactionId: UuidSchema,
    actionDigest: DigestSchema,
    expectedRunVersion: z.number().int().positive(),
    clientCommandId: UuidSchema,
    decision: z.enum(['approve', 'deny']),
  })
  .strict()
  .meta({ id: 'ApprovalDecisionRequestV3' });

export const AgentRuntimeErrorV3Schema = z
  .object({
    code: AgentRuntimeErrorCodeV3Schema,
    error: z.string().min(1).max(1_000).optional(),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
    currentProjection: AgentRunProjectionV3Schema.nullable(),
  })
  .strict()
  .meta({ id: 'AgentRuntimeErrorV3' });

export const AgentRuntimeProtocolDocumentV3Schema = z
  .object({
    status: AgentRuntimeStatusV3Schema,
    negotiation: AgentRuntimeNegotiationV3Schema,
    submitRequest: SubmitAgentTaskRequestV3Schema,
    taskRecord: AgentTaskRecordV3Schema,
    taskList: AgentTaskListV3Schema,
    taskEvent: AgentTaskEventV3Schema,
    cancelRequest: CancelAgentTaskRequestV3Schema,
    workerCapabilities: DesktopWorkerCapabilitiesV3Schema,
    workerSession: DesktopWorkerSessionV3Schema,
    desktopInvocation: DesktopInvocationV3Schema,
    desktopResult: DesktopResultV3Schema,
    permissionWaitRequest: PermissionWaitRequestV3Schema,
    permissionDecisionRequest: PermissionDecisionRequestV3Schema,
    approvalDecisionRequest: ApprovalDecisionRequestV3Schema,
    error: AgentRuntimeErrorV3Schema,
  })
  .strict()
  .meta({ id: 'AgentRuntimeProtocolDocumentV3' });

export type AgentRuntimeStatusV3 = z.infer<typeof AgentRuntimeStatusV3Schema>;
export type ComputerPermissionV3 = z.infer<typeof ComputerPermissionV3Schema>;
export type AgentRunActionV3 = z.infer<typeof AgentRunActionV3Schema>;
export type AgentRunProjectionV3 = z.infer<typeof AgentRunProjectionV3Schema>;
export type AgentTaskRecordV3 = z.infer<typeof AgentTaskRecordV3Schema>;
export type AgentTaskEventV3 = z.infer<typeof AgentTaskEventV3Schema>;
export type CancelAgentTaskRequestV3 = z.infer<typeof CancelAgentTaskRequestV3Schema>;
export type DesktopWorkerCapabilitiesV3 = z.infer<typeof DesktopWorkerCapabilitiesV3Schema>;
export type DesktopInvocationV3 = z.infer<typeof DesktopInvocationV3Schema>;
export type DesktopResultV3 = z.infer<typeof DesktopResultV3Schema>;
export type PermissionWaitRequestV3 = z.infer<typeof PermissionWaitRequestV3Schema>;
export type PermissionDecisionRequestV3 = z.infer<typeof PermissionDecisionRequestV3Schema>;
export type ApprovalDecisionRequestV3 = z.infer<typeof ApprovalDecisionRequestV3Schema>;

const terminalStates = new Set<AgentRunProjectionV3['state']>([
  'completed',
  'blocked',
  'failed',
  'cancelled',
  'expired',
]);

export function validateAgentRunProjectionV3(
  projection: AgentRunProjectionV3,
): AgentRunProjectionV3 {
  const parsed = AgentRunProjectionV3Schema.parse(projection);
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
  if (
    (parsed.state === 'awaiting_approval') !==
    (parsed.waitingOn?.kind === 'approval')
  ) {
    throw new Error('Approval wait metadata does not match run state.');
  }
  return parsed;
}
