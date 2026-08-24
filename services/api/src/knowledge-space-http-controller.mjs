import {
  AttemptAcknowledgeSchema, CommitSubmissionSchema, CompleteUploadSchema, CreateGroupSchema, CreateInviteSchema,
  CreateLiveRoomCodeSchema, CreateRunSchema, CreateSessionDirectiveSchema, CreateSpaceSchema,
  CreateWorkSessionSchema, InitiateUploadSchema, JoinLiveRoomSchema, LiveRoomMutationSchema,
  PublishActivitySchema, RecordEvidenceSchema, RedeemInviteSchema, RequestHelpSchema, SaveActivityDraftSchema,
  ClaimSessionDirectiveSchema, ReadyAttemptSchema, ResolveAttemptHelpSchema, ReviewAttemptSchema,
  KNOWLEDGE_LIMITS, SearchKnowledgeSchema, UpdateWorkSessionSchema, publicValidationError,
} from './knowledge-space-contracts.mjs';
import { HttpError, readJson, requireHostedSession, sendJson } from './http-primitives.mjs';
import { planFor } from './plan-catalog.mjs';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CLASSROOM_JOIN_PEER_LIMIT = KNOWLEDGE_LIMITS.roomParticipants + 400;
const match = (path, expression) => new RegExp(`^${expression}$`, 'iu').exec(path);

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = publicValidationError(result.error);
  const error = new HttpError(400, detail.error, detail.code); error.detail = detail; throw error;
}

export class KnowledgeSpaceHttpController {
  constructor({ accessCodeRepository, activityService, enabled, insightService, liveClassroomService, rateLimiter, searchService, sessionRepository, spaceService }) {
    this.accessCodeRepository = accessCodeRepository; this.activityService = activityService; this.enabled = enabled;
    this.insightService = insightService; this.liveClassroomService = liveClassroomService; this.rateLimiter = rateLimiter; this.searchService = searchService;
    this.sessionRepository = sessionRepository; this.spaceService = spaceService;
  }

  async authorize(request, scope = 'knowledge.read') {
    const session = await requireHostedSession(request, this.sessionRepository);
    const access = await this.accessCodeRepository.getStatus(session.user.id);
    if (access.state !== 'active') throw new HttpError(403, 'Enter a valid access code to use TroCode.', 'access_required');
    const limits = planFor(access.plan);
    const limit = scope === 'knowledge.search'
      ? limits.knowledgeQueriesPerMinute
      : scope === 'knowledge.upload'
        ? limits.uploadInitiatesPerMinute
        : scope === 'classroom.join'
          ? 12
        : request.method === 'GET' ? 180 : 60;
    const rate = await this.rateLimiter.consume({ key: session.user.id, limit, scope, windowMs: 60_000 });
    if (!rate.allowed) { const error = new HttpError(429, 'Too many requests. Please try again shortly.', 'rate_limited'); error.retryAfterSeconds = rate.retryAfterSeconds; throw error; }
    if (scope === 'classroom.join' && request.socket?.remoteAddress) {
      const peerRate = await this.rateLimiter.consume({
        key: request.socket.remoteAddress,
        limit: CLASSROOM_JOIN_PEER_LIMIT,
        scope: 'classroom.join.peer',
        windowMs: 60_000,
      });
      if (!peerRate.allowed) {
        const error = new HttpError(429, 'Too many room join attempts from this network. Try again shortly.', 'room_join_rate_limited');
        error.retryAfterSeconds = peerRate.retryAfterSeconds;
        throw error;
      }
    }
    return { limits, session };
  }

  async handle({ request, response, url }) {
    const path = url.pathname;
    if (request.method === 'GET' && path === '/v1/capabilities') {
      sendJson(response, 200, { knowledgeSpaces: { enabled: this.enabled, contractVersion: 1 } }); return true;
    }
    if (!this.enabled || (!path.startsWith('/v1/spaces') && !path.startsWith('/v1/activities') && !path.startsWith('/v1/runs') && !path.startsWith('/v1/attempts') && !path.startsWith('/v1/work-sessions') && path !== '/v1/uploads/complete' && path !== '/v1/assignments/me' && path !== '/v1/space-invites/redeem' && !path.startsWith('/v1/live-rooms'))) return false;

    const isSearch = request.method === 'POST' && path.endsWith('/knowledge/search');
    const isUpload = request.method === 'POST' && (path.endsWith('/uploads/initiate') || path.endsWith('/submissions/initiate'));
    const isRoomJoin = request.method === 'POST' && path === '/v1/live-rooms/join';
    const authorization = await this.authorize(
      request,
      isSearch
        ? 'knowledge.search'
        : isUpload
          ? 'knowledge.upload'
          : isRoomJoin
            ? 'classroom.join'
            : request.method === 'GET' ? 'knowledge.read' : 'knowledge.write',
    );
    const { limits } = authorization;
    const userId = authorization.session.user.id;
    let route;

    if (request.method === 'GET' && path === '/v1/spaces') {
      sendJson(response, 200, await this.spaceService.list(userId)); return true;
    }
    if (request.method === 'POST' && path === '/v1/spaces') {
      const result = await this.spaceService.create(userId, parse(CreateSpaceSchema, await readJson(request)), limits);
      sendJson(response, result.newlyCreated ? 201 : 200, result, { Location: `/v1/spaces/${result.space.id}` }); return true;
    }
    if (request.method === 'POST' && path === '/v1/space-invites/redeem') {
      const input = parse(RedeemInviteSchema, await readJson(request));
      const result = await this.spaceService.redeemInvite(userId, input.code);
      if (!result) throw new HttpError(400, 'This Space invite is invalid or expired.', 'invite_invalid');
      sendJson(response, 200, result); return true;
    }
    if (request.method === 'POST' && path === '/v1/live-rooms/join') {
      const input = parse(JoinLiveRoomSchema, await readJson(request));
      const result = await this.liveClassroomService.join(userId, input);
      if (!result) throw new HttpError(400, 'This room code is invalid, expired, full, or closed.', 'room_code_invalid');
      sendJson(response, 200, result); return true;
    }
    if (request.method === 'GET' && path === '/v1/live-rooms/current') {
      sendJson(response, 200, {
        session: await this.liveClassroomService.currentSession(userId),
      });
      return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})`)) && request.method === 'GET') {
      const space = await this.spaceService.get(userId, route.groups.spaceId);
      if (!space) throw new HttpError(404, 'Space not found.', 'space_not_found');
      sendJson(response, 200, space); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/sources`)) && request.method === 'GET') {
      sendJson(response, 200, { items: await this.spaceService.listSources(userId, route.groups.spaceId) }); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/uploads/initiate`)) && request.method === 'POST') {
      const uploads = await this.spaceService.initiateUpload(userId, route.groups.spaceId, parse(InitiateUploadSchema, await readJson(request)), limits);
      sendJson(response, 201, { uploads }); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/groups`)) && request.method === 'POST') {
      sendJson(response, 201, await this.spaceService.createGroup(userId, route.groups.spaceId, parse(CreateGroupSchema, await readJson(request)))); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/groups`)) && request.method === 'GET') {
      sendJson(response, 200, { items: await this.spaceService.listGroups(userId, route.groups.spaceId) }); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/members`)) && request.method === 'GET') {
      sendJson(response, 200, { items: await this.spaceService.listMembers(userId, route.groups.spaceId) }); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/invites`)) && request.method === 'POST') {
      sendJson(response, 201, await this.spaceService.createInvite(userId, route.groups.spaceId, parse(CreateInviteSchema, await readJson(request)))); return true;
    }
    if (path === '/v1/uploads/complete' && request.method === 'POST') {
      const result = await this.spaceService.completeUpload(userId, parse(CompleteUploadSchema, await readJson(request)));
      if (!result) throw new HttpError(404, 'Upload not found.', 'upload_not_found');
      sendJson(response, 202, result); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/activities`)) && request.method === 'POST') {
      const activity = await this.activityService.saveDraft(userId, route.groups.spaceId, parse(SaveActivityDraftSchema, await readJson(request)));
      sendJson(response, 201, activity, { Location: `/v1/activities/${activity.id}` }); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/activities/(?<activityId>${UUID})/publish`)) && request.method === 'POST') {
      const version = await this.activityService.publish(userId, route.groups.spaceId, route.groups.activityId, parse(PublishActivitySchema, await readJson(request)));
      if (!version) throw new HttpError(404, 'Activity not found.', 'activity_not_found');
      sendJson(response, version.newlyCreated ? 201 : 200, version); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/runs`)) && request.method === 'POST') {
      const run = await this.activityService.createRun(userId, route.groups.spaceId, parse(CreateRunSchema, await readJson(request)), limits);
      sendJson(response, run.newlyCreated ? 201 : 200, run, { Location: `/v1/runs/${run.id}` }); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/runs/(?<runId>${UUID})/room-code`)) && request.method === 'POST') {
      const room = await this.liveClassroomService.createRoomCode(userId, route.groups.spaceId, route.groups.runId, parse(CreateLiveRoomCodeSchema, await readJson(request)), limits);
      sendJson(response, room.newlyCreated ? 201 : 200, room); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/runs/(?<runId>${UUID})/room-code`)) && request.method === 'DELETE') {
      sendJson(response, 200, await this.liveClassroomService.revokeRoomCode(userId, route.groups.spaceId, route.groups.runId)); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/runs/(?<runId>${UUID})/directives`)) && request.method === 'POST') {
      const directive = await this.liveClassroomService.createDirective(userId, route.groups.spaceId, route.groups.runId, parse(CreateSessionDirectiveSchema, await readJson(request)));
      sendJson(response, directive.newlyCreated ? 201 : 200, directive); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/runs/(?<runId>${UUID})/(?<action>open|close)`)) && request.method === 'POST') {
      const run = await this.activityService.setRunState(userId, route.groups.spaceId, route.groups.runId, route.groups.action === 'open' ? 'open' : 'closed');
      if (!run) throw new HttpError(404, 'Run not found.', 'run_not_found');
      sendJson(response, 200, run); return true;
    }
    if (request.method === 'GET' && path === '/v1/assignments/me') {
      sendJson(response, 200, { items: await this.activityService.listAssigned(userId) }); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})`)) && request.method === 'GET') {
      const attempt = await this.activityService.attempt(userId, route.groups.attemptId);
      if (!attempt) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 200, attempt); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/live-session`)) && request.method === 'GET') {
      const session = await this.liveClassroomService.session(userId, route.groups.attemptId);
      if (!session) throw new HttpError(404, 'Class session not found.', 'class_session_not_found');
      sendJson(response, 200, session); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/live-session/leave`)) && request.method === 'POST') {
      const result = await this.liveClassroomService.leave(userId, route.groups.attemptId, parse(LiveRoomMutationSchema, await readJson(request)));
      if (!result) throw new HttpError(404, 'Class session not found.', 'class_session_not_found');
      sendJson(response, 200, result); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/directives`)) && request.method === 'GET') {
      const raw = url.searchParams.get('sinceSequence') ?? '0';
      const sinceSequence = Number(raw);
      if (!Number.isSafeInteger(sinceSequence) || sinceSequence < 0) throw new HttpError(400, 'sinceSequence is invalid.', 'invalid_request');
      const directives = await this.liveClassroomService.directives(userId, route.groups.attemptId, sinceSequence);
      if (!directives) throw new HttpError(404, 'Class session not found.', 'class_session_not_found');
      sendJson(response, 200, directives); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/directives/(?<directiveId>${UUID})/claim`)) && request.method === 'POST') {
      const claim = await this.liveClassroomService.claimDirective(userId, route.groups.attemptId, route.groups.directiveId, parse(ClaimSessionDirectiveSchema, await readJson(request)));
      if (!claim) throw new HttpError(404, 'Classroom directive not found.', 'directive_not_found');
      sendJson(response, 200, claim); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/ready`)) && request.method === 'POST') {
      parse(ReadyAttemptSchema, await readJson(request));
      const ready = await this.liveClassroomService.ready(userId, route.groups.attemptId);
      if (!ready) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 200, ready); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/starter-files`)) && request.method === 'GET') {
      const files = await this.activityService.starterFiles(userId, route.groups.attemptId);
      if (!files) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 200, { files }); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/submissions/initiate`)) && request.method === 'POST') {
      const uploads = await this.activityService.initiateSubmission(userId, route.groups.attemptId, parse(InitiateUploadSchema, await readJson(request)), limits);
      if (!uploads) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 201, { uploads }); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/submissions/commit`)) && request.method === 'POST') {
      parse(CommitSubmissionSchema, await readJson(request));
      const submission = await this.activityService.commitSubmission(userId, route.groups.attemptId);
      if (!submission) throw new HttpError(409, 'No verified submission files are ready.', 'submission_not_ready');
      sendJson(response, 200, submission); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/acknowledge`)) && request.method === 'POST') {
      const input = parse(AttemptAcknowledgeSchema, await readJson(request));
      if (!await this.activityService.acknowledge(userId, route.groups.attemptId, input.policyVersion)) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 200, { acknowledged: true }); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/help`)) && request.method === 'POST') {
      const input = parse(RequestHelpSchema, await readJson(request));
      const result = await this.activityService.requestHelp(userId, route.groups.attemptId, input.clientId);
      if (!result) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 200, result); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/work-sessions`)) && request.method === 'POST') {
      const workSession = await this.activityService.createWorkSession(userId, route.groups.attemptId, parse(CreateWorkSessionSchema, await readJson(request)));
      if (!workSession) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 201, workSession, { Location: `/v1/work-sessions/${workSession.id}` }); return true;
    }
    if ((route = match(path, `/v1/work-sessions/(?<workSessionId>${UUID})`)) && request.method === 'PATCH') {
      const workSession = await this.activityService.updateWorkSession(userId, route.groups.workSessionId, parse(UpdateWorkSessionSchema, await readJson(request)));
      if (!workSession) throw new HttpError(404, 'Work Session not found.', 'work_session_not_found');
      sendJson(response, 200, workSession); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/knowledge/search`)) && request.method === 'POST') {
      const input = parse(SearchKnowledgeSchema, await readJson(request));
      sendJson(response, 200, await this.searchService.search({ ...input, attemptId: route.groups.attemptId, userId })); return true;
    }
    if ((route = match(path, `/v1/attempts/(?<attemptId>${UUID})/evidence`)) && request.method === 'POST') {
      const evidence = await this.activityService.recordEvidence(userId, route.groups.attemptId, parse(RecordEvidenceSchema, await readJson(request)));
      if (!evidence) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 201, evidence); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/runs/(?<runId>${UUID})/dashboard`)) && request.method === 'GET') {
      const raw = url.searchParams.get('sinceSequence');
      const sinceSequence = raw === null ? null : Number(raw);
      if (raw !== null && (!Number.isSafeInteger(sinceSequence) || sinceSequence < 0)) throw new HttpError(400, 'sinceSequence is invalid.', 'invalid_request');
      sendJson(response, 200, await this.insightService.dashboard(userId, route.groups.spaceId, route.groups.runId, sinceSequence)); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/runs/(?<runId>${UUID})/attempts/(?<attemptId>${UUID})/review`)) && request.method === 'POST') {
      const reviewed = await this.liveClassroomService.review(userId, route.groups.spaceId, route.groups.runId, route.groups.attemptId, parse(ReviewAttemptSchema, await readJson(request)));
      if (!reviewed) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 200, reviewed); return true;
    }
    if ((route = match(path, `/v1/spaces/(?<spaceId>${UUID})/runs/(?<runId>${UUID})/attempts/(?<attemptId>${UUID})/help/resolve`)) && request.method === 'POST') {
      parse(ResolveAttemptHelpSchema, await readJson(request));
      const resolved = await this.liveClassroomService.resolveHelp(userId, route.groups.spaceId, route.groups.runId, route.groups.attemptId);
      if (!resolved) throw new HttpError(404, 'Attempt not found.', 'attempt_not_found');
      sendJson(response, 200, resolved); return true;
    }
    return false;
  }
}
