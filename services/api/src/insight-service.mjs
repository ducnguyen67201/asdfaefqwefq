import { deriveSupportSuggestions } from './knowledge-space-policy.mjs';

export class InsightService {
  constructor({ activityRepository, spaceService }) { this.activityRepository = activityRepository; this.spaceService = spaceService; }
  async dashboard(userId, spaceId, runId, sinceSequence = null) {
    await this.spaceService.role(userId, spaceId, 'insight.read');
    const runState = await this.activityRepository.runState(runId, spaceId);
    if (!runState) {
      const error = new Error('Run not found.');
      error.status = 404;
      error.code = 'run_not_found';
      throw error;
    }
    const projection = await this.activityRepository.dashboard(runId, spaceId, sinceSequence);
    if (projection.kind === 'delta') return { ...projection, runState };
    const counts = Object.create(null);
    for (const row of projection.participants) counts[row.state] = (counts[row.state] ?? 0) + 1;
    return {
      ...projection,
      runState,
      counts,
      helpQueue: projection.participants.filter((row) => row.status === 'needs_help').sort((a, b) => a.helpRequestedAt.localeCompare(b.helpRequestedAt)),
      suggestions: deriveSupportSuggestions({
        activeParticipants: projection.participants.length,
        criterionEvidence: projection.criterionEvidence,
        participants: projection.participants.map((row) => ({ id: row.id, helpRequested: row.status === 'needs_help' })),
      }),
      patterns: projection.criterionEvidence,
    };
  }
}
