import { randomUUID } from 'node:crypto';

import { ActivityContextSchema, type ActivityContext, type GuidanceClaim, type HostedAttemptContext } from '../../shared/contracts';

import type { KnowledgeSpaceClient } from './knowledge-space-client';

export class ActivityContextService {
  constructor(private readonly client: KnowledgeSpaceClient) {}

  inspect(attemptId: string): Promise<HostedAttemptContext> {
    return this.client.getAttempt(attemptId);
  }

  createForClassroomGuidance(
    attempt: HostedAttemptContext,
    claim: GuidanceClaim,
  ): ActivityContext {
    if (
      attempt.attemptId !== claim.attemptId ||
      attempt.activityVersionId !== claim.activityVersionId
    )
      throw new Error('Assignment version changed.');
    return ActivityContextSchema.parse({
      attemptId: attempt.attemptId,
      workSessionId: claim.workSessionId,
      activityVersionId: attempt.activityVersionId,
      runId: attempt.run.id,
      space: attempt.space,
      activity: attempt.definition,
      purpose: 'work',
      currentDirective: null,
      insightPolicy: attempt.run.insightPolicy,
      insightPolicyVersion: attempt.run.insightPolicyVersion,
      policyAcknowledged:
        attempt.acknowledgedPolicyVersion === attempt.run.insightPolicyVersion,
      sourceCatalog: attempt.sourceCatalog,
      priorProgress: attempt.priorProgress,
    });
  }

  async create(
    attempt: HostedAttemptContext,
    taskId: string,
    launchKind: 'none' | 'workspace' | 'current_surface',
    purpose: 'work' | 'help' | 'check' = 'work',
    currentDirective: ActivityContext['currentDirective'] = null,
  ): Promise<ActivityContext> {
    const attemptId = attempt.attemptId;
    const workSession = await this.client.createWorkSession(attemptId, { clientId: randomUUID(), taskId, launchKind, purpose });
    return ActivityContextSchema.parse({
      attemptId, workSessionId: workSession.id, activityVersionId: attempt.activityVersionId, runId: attempt.run.id,
      space: attempt.space,
      activity: attempt.definition,
      purpose,
      currentDirective,
      insightPolicy: attempt.run.insightPolicy,
      insightPolicyVersion: attempt.run.insightPolicyVersion,
      policyAcknowledged: attempt.acknowledgedPolicyVersion === attempt.run.insightPolicyVersion,
      sourceCatalog: attempt.sourceCatalog,
      priorProgress: attempt.priorProgress,
    });
  }
}
