import { createHmac } from 'node:crypto';

import { directiveDelivery } from './classroom-directive-policy.mjs';

function digestRoomCode(code, hmacKey) {
  return createHmac('sha256', hmacKey).update(code.trim().toUpperCase()).digest();
}

function deterministicRoomCode(hmacKey, runId, clientId) {
  const compact = createHmac('sha256', hmacKey)
    .update(`live-room:${runId}:${clientId}`)
    .digest('base64url')
    .replace(/[^a-z0-9]/giu, '')
    .slice(0, 12)
    .toUpperCase();
  return `TRO-${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`;
}

function missingRun() {
  const error = new Error('Run not found.');
  error.status = 404;
  error.code = 'run_not_found';
  throw error;
}

export class LiveClassroomService {
  constructor({ hmacKey, repository, spaceService }) {
    this.hmacKey = hmacKey;
    this.repository = repository;
    this.spaceService = spaceService;
  }

  async createRoomCode(userId, spaceId, runId, input, limits = null) {
    await this.spaceService.role(userId, spaceId, 'run.room_manage');
    const run = await this.repository.runContext(runId, spaceId);
    if (!run) missingRun();
    if (run.targetKind !== 'room' || !['live', 'hybrid'].includes(run.mode)) {
      const error = new Error('Room admission requires a live or hybrid Room Run.');
      error.status = 409; error.code = 'room_run_required'; throw error;
    }
    if (run.definition.sessionPolicy?.allowRoomJoin !== true) {
      const error = new Error('Publish this Activity with room joining enabled first.');
      error.status = 409; error.code = 'room_join_disabled'; throw error;
    }
    const code = deterministicRoomCode(this.hmacKey, runId, input.clientId);
    const maximum = Math.min(input.maxUses, limits?.groupParticipants ?? input.maxUses);
    const requestedExpiry = input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + 8 * 60 * 60 * 1000);
    const latestExpiry = Date.now() + 24 * 60 * 60 * 1000;
    if (requestedExpiry.getTime() <= Date.now() || requestedExpiry.getTime() > latestExpiry) {
      const error = new Error('Room codes must expire within the next 24 hours.');
      error.status = 400; error.code = 'room_expiry_invalid'; throw error;
    }
    const result = await this.repository.createRoomCode({
      ...input,
      codeDigest: digestRoomCode(code, this.hmacKey),
      expiresAt: requestedExpiry,
      maxUses: maximum,
      runId,
      spaceId,
      userId,
    });
    if (!result) missingRun();
    return { ...result, code };
  }

  async revokeRoomCode(userId, spaceId, runId) {
    await this.spaceService.role(userId, spaceId, 'run.room_manage');
    if (!await this.repository.runContext(runId, spaceId)) missingRun();
    return this.repository.revokeRoomCodes(runId, spaceId);
  }

  join(userId, input) {
    const { code, ...mutation } = input;
    return this.repository.joinRoom({
      ...mutation,
      codeDigest: digestRoomCode(code, this.hmacKey),
      userId,
    });
  }

  session(userId, attemptId) { return this.repository.sessionForAttempt(attemptId, userId); }
  currentSession(userId) { return this.repository.currentSessionForUser(userId); }
  leave(userId, attemptId, input) { return this.repository.leaveSession({ ...input, attemptId, userId }); }

  async createDirective(userId, spaceId, runId, input) {
    await this.spaceService.role(userId, spaceId, 'run.directive_manage');
    const run = await this.repository.runContext(runId, spaceId);
    if (!run) missingRun();
    if (run.state !== 'open') {
      const error = new Error('Start the class before broadcasting.');
      error.status = 409; error.code = 'run_not_open'; throw error;
    }
    const criterionIds = new Set((run.definition.criteria ?? []).map((criterion) => criterion.id));
    if (input.directive.criterionIds.some((criterionId) => !criterionIds.has(criterionId))) {
      const error = new Error('A directive criterion is not part of the published Activity.');
      error.status = 400; error.code = 'directive_criterion_invalid'; throw error;
    }
    const decision = directiveDelivery(input.directive, run.definition.sessionPolicy?.allowedOrigins ?? []);
    const directive = input.directive.kind === 'open_url'
      ? { ...input.directive, url: decision.url, origin: decision.origin }
      : input.directive;
    const result = await this.repository.createDirective({
      activityVersionId: run.activityVersionId,
      clientId: input.clientId,
      delivery: decision.delivery,
      directive,
      runId,
      spaceId,
      userId,
    });
    if (!result) missingRun();
    return result;
  }

  directives(userId, attemptId, sinceSequence) {
    return this.repository.listDirectives({ attemptId, sinceSequence, userId });
  }

  claimDirective(userId, attemptId, directiveId, input) {
    return this.repository.claimDirective({ ...input, attemptId, directiveId, userId });
  }

  ready(userId, attemptId) { return this.repository.readyAttempt({ attemptId, userId }); }

  async review(userId, spaceId, runId, attemptId, input) {
    await this.spaceService.role(userId, spaceId, 'attempt.review');
    return this.repository.reviewAttempt({ ...input, attemptId, runId, spaceId, userId });
  }

  async resolveHelp(userId, spaceId, runId, attemptId) {
    await this.spaceService.role(userId, spaceId, 'help.resolve');
    return this.repository.resolveHelp({ attemptId, runId, spaceId });
  }
}
