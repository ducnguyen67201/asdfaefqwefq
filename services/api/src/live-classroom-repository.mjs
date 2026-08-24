import { inTransaction, iso } from './knowledge-repository-utils.mjs';

function fail(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function directiveFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sequence: Number(row.sequence),
    kind: row.kind,
    delivery: row.delivery,
    instruction: row.payload.instruction,
    criterionIds: row.payload.criterionIds ?? [],
    ...(row.kind === 'open_url' ? { url: row.payload.url, origin: row.payload.origin } : {}),
    createdAt: iso(row.created_at),
  };
}

export class PostgresLiveClassroomRepository {
  constructor(pool) { this.pool = pool; }

  async runContext(runId, spaceId) {
    const result = await this.pool.query(
      `SELECT runs.id,runs.space_id,runs.activity_version_id,runs.mode,runs.state,runs.target_kind,
              versions.definition,spaces.name AS space_name
       FROM knowledge_activity_runs runs
       JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
       JOIN knowledge_spaces spaces ON spaces.id=runs.space_id
       WHERE runs.id=$1 AND runs.space_id=$2`,
      [runId, spaceId],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      spaceId: row.space_id,
      activityVersionId: row.activity_version_id,
      mode: row.mode,
      state: row.state,
      targetKind: row.target_kind,
      definition: row.definition,
      spaceName: row.space_name,
    } : null;
  }

  async createRoomCode({ clientId, codeDigest, expiresAt, maxUses, runId, spaceId, userId }) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`room-code:${runId}`]);
      const run = await client.query(
        `SELECT id,state,mode,target_kind FROM knowledge_activity_runs
         WHERE id=$1 AND space_id=$2 FOR UPDATE`,
        [runId, spaceId],
      );
      const current = run.rows[0];
      if (!current) return null;
      if (current.target_kind !== 'room' || !['live', 'hybrid'].includes(current.mode)) {
        fail(409, 'room_run_required', 'Room admission requires a live or hybrid Room Run.');
      }
      if (!['draft', 'open'].includes(current.state)) fail(409, 'room_closed', 'This classroom is closed.');
      const existing = await client.query(
        `SELECT id,max_uses,used_count,expires_at,revoked_at,created_at
         FROM knowledge_live_room_codes WHERE run_id=$1 AND client_id=$2`,
        [runId, clientId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        return { id: row.id, maxUses: row.max_uses, usedCount: row.used_count, expiresAt: iso(row.expires_at), revokedAt: iso(row.revoked_at), createdAt: iso(row.created_at), newlyCreated: false };
      }
      await client.query(
        `UPDATE knowledge_live_room_codes SET revoked_at=COALESCE(revoked_at,NOW())
         WHERE run_id=$1 AND revoked_at IS NULL`,
        [runId],
      );
      const inserted = await client.query(
        `INSERT INTO knowledge_live_room_codes
           (client_id,run_id,code_digest,max_uses,expires_at,created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id,max_uses,used_count,expires_at,revoked_at,created_at`,
        [clientId, runId, codeDigest, maxUses, expiresAt, userId],
      );
      const row = inserted.rows[0];
      return { id: row.id, maxUses: row.max_uses, usedCount: row.used_count, expiresAt: iso(row.expires_at), revokedAt: null, createdAt: iso(row.created_at), newlyCreated: true };
    });
  }

  async revokeRoomCodes(runId, spaceId) {
    const result = await this.pool.query(
      `UPDATE knowledge_live_room_codes codes SET revoked_at=COALESCE(codes.revoked_at,NOW())
       FROM knowledge_activity_runs runs
       WHERE codes.run_id=$1 AND runs.id=codes.run_id AND runs.space_id=$2
       RETURNING codes.id,codes.revoked_at`,
      [runId, spaceId],
    );
    return { revoked: result.rowCount > 0, revokedAt: iso(result.rows[0]?.revoked_at ?? null) };
  }

  async joinRoom({ clientId, codeDigest, userId }) {
    return inTransaction(this.pool, async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`live-room-user:${userId}`],
      );
      const found = await client.query(
        `SELECT codes.id AS code_id,codes.max_uses,codes.used_count,codes.expires_at,codes.revoked_at,
                runs.id AS run_id,runs.space_id,runs.activity_version_id,runs.state AS run_state,
                runs.mode,runs.target_kind,versions.definition,spaces.name AS space_name
         FROM knowledge_live_room_codes codes
         JOIN knowledge_activity_runs runs ON runs.id=codes.run_id
         JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
         JOIN knowledge_spaces spaces ON spaces.id=runs.space_id
         WHERE codes.code_digest=$1 FOR UPDATE OF codes,runs`,
        [codeDigest],
      );
      const room = found.rows[0];
      if (!room || room.revoked_at || room.expires_at <= new Date()) return null;
      if (room.target_kind !== 'room' || !['draft', 'open'].includes(room.run_state)) return null;
      if (room.definition?.sessionPolicy?.allowRoomJoin !== true) return null;

      const prior = await client.query(
        `SELECT attempt_id,joined_at,left_at FROM knowledge_run_participations
         WHERE run_id=$1 AND user_id=$2 FOR UPDATE`,
        [room.run_id, userId],
      );
      if (!prior.rows[0] && room.used_count >= room.max_uses) return null;

      const leftOtherRooms = await client.query(
        `UPDATE knowledge_run_participations
         SET left_at=NOW(),updated_at=NOW()
         WHERE user_id=$1 AND run_id<>$2 AND left_at IS NULL
         RETURNING run_id,attempt_id`,
        [userId, room.run_id],
      );
      if (leftOtherRooms.rows.length) {
        await client.query(
          `INSERT INTO knowledge_activity_run_events
             (run_id,attempt_id,event_type,payload)
           SELECT rooms.run_id,rooms.attempt_id,'participant_left',
                  jsonb_build_object('reason','joined_another_room')
           FROM UNNEST($1::uuid[],$2::uuid[])
             AS rooms(run_id,attempt_id)`,
          [
            leftOtherRooms.rows.map((row) => row.run_id),
            leftOtherRooms.rows.map((row) => row.attempt_id),
          ],
        );
      }

      await client.query(
        `INSERT INTO knowledge_space_members (space_id,user_id,role)
         VALUES ($1,$2,'participant')
         ON CONFLICT (space_id,user_id) DO UPDATE SET
           removed_at=NULL,
           role=CASE WHEN knowledge_space_members.removed_at IS NULL
                           AND knowledge_space_members.role IN ('owner','facilitator')
                     THEN knowledge_space_members.role ELSE 'participant' END`,
        [room.space_id, userId],
      );
      const assignment = await client.query(
        `INSERT INTO knowledge_activity_assignments (run_id,user_id)
         VALUES ($1,$2) ON CONFLICT (run_id,user_id) DO UPDATE SET user_id=EXCLUDED.user_id
         RETURNING id`,
        [room.run_id, userId],
      );
      const attempt = await client.query(
        `INSERT INTO knowledge_activity_attempts (run_id,assignment_id,user_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (run_id,user_id) DO UPDATE SET updated_at=knowledge_activity_attempts.updated_at
         RETURNING id,state,updated_at`,
        [room.run_id, assignment.rows[0].id, userId],
      );
      const participation = await client.query(
        `INSERT INTO knowledge_run_participations (run_id,user_id,attempt_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (run_id,user_id) DO UPDATE SET
           attempt_id=EXCLUDED.attempt_id,left_at=NULL,updated_at=NOW()
         RETURNING joined_at,left_at`,
        [room.run_id, userId, attempt.rows[0].id],
      );
      if (!prior.rows[0]) {
        await client.query(
          `UPDATE knowledge_live_room_codes SET used_count=used_count+1 WHERE id=$1`,
          [room.code_id],
        );
      }
      const eventType = prior.rows[0] ? 'participant_rejoined' : 'participant_joined';
      await client.query(
        `INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
         VALUES ($1,$2,$3,jsonb_build_object('status',$4::text))`,
        [room.run_id, attempt.rows[0].id, eventType, room.run_state === 'draft' ? 'lobby' : 'working'],
      );
      const latest = await client.query(
        `SELECT id,sequence,kind,delivery,payload,created_at FROM knowledge_run_directives
         WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1`,
        [room.run_id],
      );
      return {
        attemptId: attempt.rows[0].id,
        attemptState: attempt.rows[0].state,
        run: { id: room.run_id, state: room.run_state, mode: room.mode, status: room.run_state === 'draft' ? 'lobby' : 'live' },
        space: { id: room.space_id, name: room.space_name },
        activityVersionId: room.activity_version_id,
        activity: {
          title: room.definition.title,
          objective: room.definition.objective,
          requiresSubmission: room.definition.completionPolicy?.requiresSubmission === true,
        },
        currentDirective: directiveFromRow(latest.rows[0]),
        joinedAt: iso(participation.rows[0].joined_at),
      };
    });
  }

  async sessionForAttempt(attemptId, userId) {
    const result = await this.pool.query(
      `SELECT participations.joined_at,participations.left_at,
              attempts.id AS attempt_id,attempts.state AS attempt_state,
              runs.id AS run_id,runs.state AS run_state,runs.mode,runs.space_id,runs.activity_version_id,
              versions.definition,spaces.name AS space_name
       FROM knowledge_run_participations participations
       JOIN knowledge_activity_attempts attempts ON attempts.id=participations.attempt_id
       JOIN knowledge_activity_runs runs ON runs.id=participations.run_id
       JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
       JOIN knowledge_spaces spaces ON spaces.id=runs.space_id
       WHERE participations.attempt_id=$1 AND participations.user_id=$2`,
      [attemptId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const latest = await this.pool.query(
      `SELECT id,sequence,kind,delivery,payload,created_at FROM knowledge_run_directives
       WHERE run_id=$1 ORDER BY sequence DESC LIMIT 1`,
      [row.run_id],
    );
    return {
      attemptId: row.attempt_id,
      attemptState: row.attempt_state,
      run: { id: row.run_id, state: row.run_state, mode: row.mode, status: row.run_state === 'draft' ? 'lobby' : row.run_state === 'open' ? 'live' : 'ended' },
      space: { id: row.space_id, name: row.space_name },
      activityVersionId: row.activity_version_id,
      activity: {
        title: row.definition.title,
        objective: row.definition.objective,
        requiresSubmission: row.definition.completionPolicy?.requiresSubmission === true,
      },
      currentDirective: directiveFromRow(latest.rows[0]),
      joinedAt: iso(row.joined_at),
      leftAt: iso(row.left_at),
    };
  }

  async currentSessionForUser(userId) {
    const result = await this.pool.query(
      `SELECT participations.attempt_id
       FROM knowledge_run_participations participations
       JOIN knowledge_activity_runs runs ON runs.id=participations.run_id
       WHERE participations.user_id=$1 AND participations.left_at IS NULL
         AND runs.state IN ('draft','open')
       ORDER BY participations.updated_at DESC,participations.joined_at DESC
       LIMIT 1`,
      [userId],
    );
    const attemptId = result.rows[0]?.attempt_id;
    return attemptId ? this.sessionForAttempt(attemptId, userId) : null;
  }

  async leaveSession({ attemptId, userId }) {
    return inTransaction(this.pool, async (client) => {
      const current = await client.query(
        `SELECT participations.run_id,participations.attempt_id,participations.left_at
         FROM knowledge_run_participations participations
         JOIN knowledge_activity_attempts attempts ON attempts.id=participations.attempt_id
         WHERE participations.attempt_id=$1 AND participations.user_id=$2
         FOR UPDATE OF participations`,
        [attemptId, userId],
      );
      if (!current.rows[0]) return null;
      if (current.rows[0].left_at) {
        return {
          attemptId: current.rows[0].attempt_id,
          leftAt: iso(current.rows[0].left_at),
        };
      }
      const result = await client.query(
        `UPDATE knowledge_run_participations participations
         SET left_at=NOW(),updated_at=NOW()
         WHERE participations.attempt_id=$1 AND participations.user_id=$2
         RETURNING participations.run_id,participations.attempt_id,participations.left_at`,
        [attemptId, userId],
      );
      const row = result.rows[0];
      if (!row) return null;
      await client.query(
        `INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
         VALUES ($1,$2,'participant_left','{}'::jsonb)`,
        [row.run_id, row.attempt_id],
      );
      return { attemptId: row.attempt_id, leftAt: iso(row.left_at) };
    });
  }

  async createDirective({ activityVersionId, clientId, delivery, directive, runId, spaceId, userId }) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`directive:${runId}:${clientId}`]);
      const existing = await client.query(
        `SELECT id,sequence,kind,delivery,payload,created_at FROM knowledge_run_directives
         WHERE run_id=$1 AND client_id=$2`,
        [runId, clientId],
      );
      if (existing.rows[0]) return { ...directiveFromRow(existing.rows[0]), newlyCreated: false };
      const run = await client.query(
        `SELECT state FROM knowledge_activity_runs WHERE id=$1 AND space_id=$2 FOR UPDATE`,
        [runId, spaceId],
      );
      if (!run.rows[0]) return null;
      if (run.rows[0].state !== 'open') fail(409, 'run_not_open', 'Start the class before broadcasting.');
      const rate = await client.query(
        `SELECT COUNT(*)::int AS value FROM knowledge_run_directives
         WHERE run_id=$1 AND created_at > NOW() - INTERVAL '1 minute'`,
        [runId],
      );
      if (rate.rows[0].value >= 30) fail(429, 'directive_rate_limited', 'Too many classroom directives. Try again shortly.');
      const inserted = await client.query(
        `INSERT INTO knowledge_run_directives
           (client_id,run_id,activity_version_id,kind,delivery,payload,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,sequence,kind,delivery,payload,created_at`,
        [clientId, runId, activityVersionId, directive.kind, delivery, directive, userId],
      );
      const row = inserted.rows[0];
      await client.query(
        `INSERT INTO knowledge_activity_run_events (run_id,event_type,payload)
         VALUES ($1,'directive_created',jsonb_build_object('directiveId',$2::text,'kind',$3::text,'sequence',$4::bigint))`,
        [runId, row.id, row.kind, row.sequence],
      );
      return { ...directiveFromRow(row), newlyCreated: true };
    });
  }

  async listDirectives({ attemptId, sinceSequence, userId }) {
    const authority = await this.pool.query(
      `SELECT attempts.run_id,attempts.state AS attempt_state,runs.state
       FROM knowledge_activity_attempts attempts
       JOIN knowledge_run_participations participations ON participations.attempt_id=attempts.id
       JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
       WHERE attempts.id=$1 AND attempts.user_id=$2 AND participations.left_at IS NULL`,
      [attemptId, userId],
    );
    const row = authority.rows[0];
    if (!row) return null;
    const result = await this.pool.query(
      `SELECT id,sequence,kind,delivery,payload,created_at FROM knowledge_run_directives
       WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100`,
      [row.run_id, sinceSequence],
    );
    return {
      attemptState: row.attempt_state,
      runState: row.state,
      items: result.rows.map(directiveFromRow),
      maxSequence: Number(result.rows.at(-1)?.sequence ?? sinceSequence),
    };
  }

  async claimDirective({ attemptId, clientId, directiveId, userId }) {
    return inTransaction(this.pool, async (client) => {
      const authority = await client.query(
        `SELECT directives.id,directives.delivery,directives.kind,directives.payload,runs.state
         FROM knowledge_run_directives directives
         JOIN knowledge_activity_attempts attempts ON attempts.run_id=directives.run_id
         JOIN knowledge_run_participations participations ON participations.attempt_id=attempts.id
         JOIN knowledge_activity_runs runs ON runs.id=directives.run_id
         WHERE directives.id=$1 AND attempts.id=$2 AND attempts.user_id=$3
           AND participations.left_at IS NULL`,
        [directiveId, attemptId, userId],
      );
      const row = authority.rows[0];
      if (!row) return null;
      if (row.state !== 'open' || row.delivery !== 'auto_eligible' || row.kind !== 'open_url') {
        return { execute: false };
      }
      const inserted = await client.query(
        `INSERT INTO knowledge_run_directive_claims (directive_id,user_id,client_id)
         VALUES ($1,$2,$3) ON CONFLICT (directive_id,user_id) DO NOTHING
         RETURNING claimed_at`,
        [directiveId, userId, clientId],
      );
      return inserted.rows[0]
        ? { execute: true, url: row.payload.url, origin: row.payload.origin, claimedAt: iso(inserted.rows[0].claimed_at) }
        : { execute: false };
    });
  }

  async readyAttempt({ attemptId, userId }) {
    return inTransaction(this.pool, async (client) => {
      const locked = await client.query(
        `SELECT attempts.id,attempts.run_id,attempts.state,versions.definition
         FROM knowledge_activity_attempts attempts
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
         JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
         WHERE attempts.id=$1 AND attempts.user_id=$2 FOR UPDATE OF attempts`,
        [attemptId, userId],
      );
      const row = locked.rows[0];
      if (!row) return null;
      if (row.state === 'ready_for_review' || row.state === 'submitted') return { attemptId, state: row.state };
      if (row.definition.completionPolicy?.requiresSubmission) fail(409, 'submission_required', 'Submit the required files before requesting review.');
      if (!['in_progress', 'blocked'].includes(row.state)) fail(409, 'invalid_review_transition', 'This Attempt cannot be marked ready.');
      const updated = await client.query(
        `UPDATE knowledge_activity_attempts SET state='ready_for_review',ready_at=COALESCE(ready_at,NOW()),updated_at=NOW()
         WHERE id=$1 RETURNING state,ready_at`,
        [attemptId],
      );
      await client.query(
        `INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
         VALUES ($1,$2,'attempt_ready',jsonb_build_object('state','ready_for_review'))`,
        [row.run_id, attemptId],
      );
      return { attemptId, state: updated.rows[0].state, readyAt: iso(updated.rows[0].ready_at) };
    });
  }

  async reviewAttempt({ action, attemptId, clientId, runId, spaceId, userId }) {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`review:${attemptId}:${clientId}`]);
      const existing = await client.query(
        `SELECT action,created_at FROM knowledge_attempt_review_actions
         WHERE attempt_id=$1 AND client_id=$2`,
        [attemptId, clientId],
      );
      if (existing.rows[0]) {
        const current = await client.query(`SELECT state FROM knowledge_activity_attempts WHERE id=$1`, [attemptId]);
        return { attemptId, action: existing.rows[0].action, state: current.rows[0]?.state, reviewedAt: iso(existing.rows[0].created_at), newlyCreated: false };
      }
      const locked = await client.query(
        `SELECT attempts.state FROM knowledge_activity_attempts attempts
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
         WHERE attempts.id=$1 AND attempts.run_id=$2 AND runs.space_id=$3 FOR UPDATE OF attempts`,
        [attemptId, runId, spaceId],
      );
      const row = locked.rows[0];
      if (!row) return null;
      const allowed = ['ready_for_review', 'submitted'].includes(row.state);
      if (!allowed) fail(409, 'invalid_review_transition', 'This Attempt is not ready for review.');
      const nextState = action === 'complete' ? 'completed' : 'in_progress';
      const updated = await client.query(
        `UPDATE knowledge_activity_attempts SET state=$2,
           completed_at=CASE WHEN $2='completed' THEN COALESCE(completed_at,NOW()) ELSE NULL END,
           ready_at=CASE WHEN $2='in_progress' THEN NULL ELSE ready_at END,
           updated_at=NOW() WHERE id=$1 RETURNING state,updated_at`,
        [attemptId, nextState],
      );
      const review = await client.query(
        `INSERT INTO knowledge_attempt_review_actions (client_id,attempt_id,action,reviewed_by)
         VALUES ($1,$2,$3,$4) RETURNING created_at`,
        [clientId, attemptId, action, userId],
      );
      await client.query(
        `INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
         VALUES ($1,$2,$3,jsonb_build_object('state',$4::text))`,
        [runId, attemptId, action === 'complete' ? 'attempt_completed' : 'attempt_returned', nextState],
      );
      return { attemptId, action, state: updated.rows[0].state, reviewedAt: iso(review.rows[0].created_at), newlyCreated: true };
    });
  }

  async resolveHelp({ attemptId, runId, spaceId }) {
    return inTransaction(this.pool, async (client) => {
      const attempt = await client.query(
        `SELECT attempts.state FROM knowledge_activity_attempts attempts
         JOIN knowledge_activity_runs runs ON runs.id=attempts.run_id
         WHERE attempts.id=$1 AND attempts.run_id=$2 AND runs.space_id=$3 FOR UPDATE OF attempts`,
        [attemptId, runId, spaceId],
      );
      if (!attempt.rows[0]) return null;
      const resolved = await client.query(
        `UPDATE knowledge_attempt_help_requests SET resolved_at=COALESCE(resolved_at,NOW())
         WHERE attempt_id=$1 AND resolved_at IS NULL RETURNING resolved_at`,
        [attemptId],
      );
      const nextState = attempt.rows[0].state === 'blocked' ? 'in_progress' : attempt.rows[0].state;
      await client.query(
        `UPDATE knowledge_activity_attempts SET state=$2,updated_at=NOW() WHERE id=$1`,
        [attemptId, nextState],
      );
      if (resolved.rowCount > 0) await client.query(
        `INSERT INTO knowledge_activity_run_events (run_id,attempt_id,event_type,payload)
         VALUES ($1,$2,'help_resolved',jsonb_build_object('state',$3::text))`,
        [runId, attemptId, nextState],
      );
      return { attemptId, state: nextState, resolved: resolved.rowCount > 0, resolvedAt: iso(resolved.rows[0]?.resolved_at ?? null) };
    });
  }
}
