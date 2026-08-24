import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

import pg from 'pg';

import { runMigrations } from '../../src/migrate.mjs';
import { PostgresActivityRepository } from '../../src/activity-repository.mjs';
import { PostgresLiveClassroomRepository } from '../../src/live-classroom-repository.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();

test(
  'Knowledge Space migrations and lexical search work in PostgreSQL',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured.' },
  async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    try {
      await runMigrations(pool);
      const tables = await pool.query(
        `SELECT to_regclass('public.knowledge_spaces') AS spaces,
                to_regclass('public.knowledge_source_chunks') AS chunks,
                to_regclass('public.knowledge_activity_attempts') AS attempts`,
      );
      assert.equal(tables.rows[0].spaces, 'knowledge_spaces');
      assert.equal(tables.rows[0].chunks, 'knowledge_source_chunks');
      assert.equal(tables.rows[0].attempts, 'knowledge_activity_attempts');

      const search = await pool.query(
        `SELECT websearch_to_tsquery('simple', 'shopping cart loop') @@
                to_tsvector('simple', 'debug the shopping cart loop') AS matches`,
      );
      assert.equal(search.rows[0].matches, true);
    } finally {
      await pool.end();
    }
  },
);

test(
  'a 200-student room admits each student once and preserves stronger roles',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured.', timeout: 120_000 },
  async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 16 });
    const prefix = `room-load-${randomUUID()}`;
    const ownerId = `${prefix}-owner`;
    const studentIds = Array.from({ length: 200 }, (_, index) => `${prefix}-student-${index}`);
    const overflowStudentId = `${prefix}-student-overflow`;
    const spaceId = randomUUID();
    const activityId = randomUUID();
    const activityVersionId = randomUUID();
    const runId = randomUUID();
    const roomCodeId = randomUUID();
    const codeDigest = randomBytes(32);
    const definition = {
      title: 'Concurrent loops lab',
      objective: 'Join one bounded live class.',
      instructions: 'Complete the published exercise.',
      launchTarget: 'current_surface',
      guidancePolicy: { answerReveal: 'after_attempt', hintMode: 'guided', maxHintLevel: 2 },
      criteria: [],
      completionPolicy: { requiresSubmission: true, requiresFacilitatorConfirmation: true },
      sessionPolicy: { allowRoomJoin: true, allowedOrigins: ['https://class.example'] },
    };
    try {
      await runMigrations(pool);
      await pool.query(
        `INSERT INTO users (id,email,name)
         SELECT id,id || '@example.test','Room test user'
         FROM UNNEST($1::text[]) AS ids(id)
         ON CONFLICT (id) DO NOTHING`,
        [[ownerId, ...studentIds, overflowStudentId]],
      );
      await pool.query(
        `INSERT INTO knowledge_spaces (id,client_id,owner_user_id,name,description)
         VALUES ($1,$2,$3,'Concurrent room','Integration fixture')`,
        [spaceId, randomUUID(), ownerId],
      );
      await pool.query(
        `INSERT INTO knowledge_space_members (space_id,user_id,role)
         VALUES ($1,$2,'owner'),($1,$3,'facilitator')`,
        [spaceId, ownerId, studentIds[0]],
      );
      await pool.query(
        `INSERT INTO knowledge_activities
           (id,client_id,space_id,state,draft_definition,created_by)
         VALUES ($1,$2,$3,'published',$4::jsonb,$5)`,
        [activityId, randomUUID(), spaceId, JSON.stringify(definition), ownerId],
      );
      await pool.query(
        `INSERT INTO knowledge_activity_versions
           (id,activity_id,version_number,definition,content_hash,published_by)
         VALUES ($1,$2,1,$3::jsonb,$4,$5)`,
        [activityVersionId, activityId, JSON.stringify(definition), 'a'.repeat(64), ownerId],
      );
      await pool.query(
        `INSERT INTO knowledge_activity_runs
           (id,client_id,space_id,activity_version_id,mode,state,target_kind,
            insight_policy,created_by)
         VALUES ($1,$2,$3,$4,'live','open','room','explicit_and_operational',$5)`,
        [runId, randomUUID(), spaceId, activityVersionId, ownerId],
      );
      await pool.query(
        `INSERT INTO knowledge_live_room_codes
           (id,client_id,run_id,code_digest,max_uses,expires_at,created_by)
         VALUES ($1,$2,$3,$4,200,NOW() + INTERVAL '1 hour',$5)`,
        [roomCodeId, randomUUID(), runId, codeDigest, ownerId],
      );

      const repository = new PostgresLiveClassroomRepository(pool);
      const joined = await Promise.all(studentIds.map((userId) =>
        repository.joinRoom({ clientId: randomUUID(), codeDigest, userId }),
      ));
      assert.equal(joined.filter(Boolean).length, 200);
      assert.equal(new Set(joined.map((session) => session.attemptId)).size, 200);

      const rejoined = await repository.joinRoom({
        clientId: randomUUID(),
        codeDigest,
        userId: studentIds[0],
      });
      assert.equal(rejoined.attemptId, joined[0].attemptId);
      const restored = await repository.currentSessionForUser(studentIds[1]);
      assert.equal(restored.attemptId, joined[1].attemptId);
      assert.equal(restored.run.status, 'live');
      const directive = await repository.createDirective({
        activityVersionId,
        clientId: randomUUID(),
        delivery: 'auto_eligible',
        directive: {
          kind: 'open_url',
          instruction: 'Open the published exercise.',
          criterionIds: [],
          url: 'https://class.example/exercise?part=1',
          origin: 'https://class.example',
        },
        runId,
        spaceId,
        userId: ownerId,
      });
      const claims = await Promise.all([
        repository.claimDirective({
          attemptId: joined[1].attemptId,
          clientId: randomUUID(),
          directiveId: directive.id,
          userId: studentIds[1],
        }),
        repository.claimDirective({
          attemptId: joined[1].attemptId,
          clientId: randomUUID(),
          directiveId: directive.id,
          userId: studentIds[1],
        }),
      ]);
      assert.equal(claims.filter((claim) => claim.execute).length, 1);
      assert.equal(await repository.claimDirective({
        attemptId: joined[2].attemptId,
        clientId: randomUUID(),
        directiveId: directive.id,
        userId: studentIds[1],
      }), null);
      const deltas = await repository.listDirectives({
        attemptId: joined[1].attemptId,
        sinceSequence: 0,
        userId: studentIds[1],
      });
      assert.deepEqual(deltas.items.map((item) => item.id), [directive.id]);
      assert.equal(deltas.attemptState, 'assigned');

      const activityRepository = new PostgresActivityRepository(pool);
      const helpResults = await Promise.all([
        activityRepository.requestHelp(joined[4].attemptId, studentIds[4], randomUUID()),
        activityRepository.requestHelp(joined[4].attemptId, studentIds[4], randomUUID()),
      ]);
      assert.deepEqual(helpResults.map((result) => result.requested), [true, true]);
      const openHelp = await pool.query(
        `SELECT COUNT(*)::int AS value FROM knowledge_attempt_help_requests
         WHERE attempt_id=$1 AND resolved_at IS NULL`,
        [joined[4].attemptId],
      );
      assert.equal(openHelp.rows[0].value, 1);
      const failedSession = await activityRepository.createWorkSession({
        attemptId: joined[5].attemptId,
        clientId: randomUUID(),
        taskId: randomUUID(),
        launchKind: 'current_surface',
        purpose: 'work',
        userId: studentIds[5],
      });
      await activityRepository.updateWorkSession({
        workSessionId: failedSession.id,
        state: 'failed',
        userId: studentIds[5],
      });
      const dashboard = await activityRepository.dashboard(runId, spaceId);
      assert.equal(
        dashboard.participants.find((row) => row.attemptId === joined[4].attemptId)?.status,
        'needs_help',
      );
      assert.equal(
        dashboard.participants.find((row) => row.attemptId === joined[5].attemptId)?.status,
        'launch_failed',
      );
      const explainClient = await pool.connect();
      try {
        await explainClient.query('BEGIN');
        await explainClient.query('SET LOCAL enable_seqscan=off');
        const explain = await explainClient.query(
          `EXPLAIN SELECT id FROM knowledge_run_directives
           WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 100`,
          [runId, 0],
        );
        assert.match(
          explain.rows.map((row) => row['QUERY PLAN']).join('\n'),
          /knowledge_run_directives_delta_idx/u,
        );
      } finally {
        await explainClient.query('ROLLBACK').catch(() => undefined);
        explainClient.release();
      }

      await pool.query(
        `UPDATE knowledge_activity_attempts
         SET state='ready_for_review',ready_at=NOW()
         WHERE id=$1`,
        [joined[3].attemptId],
      );
      await repository.leaveSession({
        attemptId: joined[3].attemptId,
        userId: studentIds[3],
      });
      const readyAfterLeave = await activityRepository.dashboard(runId, spaceId);
      assert.equal(
        readyAfterLeave.participants.find((row) => row.attemptId === joined[3].attemptId)?.status,
        'ready',
      );
      const reviewClientId = randomUUID();
      const reviews = await Promise.all([
        repository.reviewAttempt({
          action: 'complete',
          attemptId: joined[3].attemptId,
          clientId: reviewClientId,
          runId,
          spaceId,
          userId: ownerId,
        }),
        repository.reviewAttempt({
          action: 'complete',
          attemptId: joined[3].attemptId,
          clientId: reviewClientId,
          runId,
          spaceId,
          userId: ownerId,
        }),
      ]);
      assert.deepEqual(
        reviews.map((review) => review.newlyCreated).sort(),
        [false, true],
      );
      const counts = await pool.query(
        `SELECT
           (SELECT used_count FROM knowledge_live_room_codes WHERE id=$1) AS used_count,
           (SELECT COUNT(*)::int FROM knowledge_run_participations WHERE run_id=$2) AS participations,
           (SELECT COUNT(*)::int FROM knowledge_activity_attempts WHERE run_id=$2) AS attempts,
           (SELECT role FROM knowledge_space_members WHERE space_id=$3 AND user_id=$4) AS retained_role`,
        [roomCodeId, runId, spaceId, studentIds[0]],
      );
      assert.deepEqual(counts.rows[0], {
        used_count: 200,
        participations: 200,
        attempts: 200,
        retained_role: 'facilitator',
      });
      assert.equal(await repository.joinRoom({
        clientId: randomUUID(),
        codeDigest,
        userId: overflowStudentId,
      }), null);
      await repository.revokeRoomCodes(runId, spaceId);
      assert.equal(await repository.joinRoom({
        clientId: randomUUID(),
        codeDigest,
        userId: studentIds[0],
      }), null);
    } finally {
      await pool.query('DELETE FROM knowledge_activity_run_events WHERE run_id=$1', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_attempt_help_requests WHERE attempt_id IN (SELECT id FROM knowledge_activity_attempts WHERE run_id=$1)', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_attempt_review_actions WHERE attempt_id IN (SELECT id FROM knowledge_activity_attempts WHERE run_id=$1)', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_activity_work_sessions WHERE attempt_id IN (SELECT id FROM knowledge_activity_attempts WHERE run_id=$1)', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_run_directive_claims WHERE directive_id IN (SELECT id FROM knowledge_run_directives WHERE run_id=$1)', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_run_directives WHERE run_id=$1', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_run_participations WHERE run_id=$1', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_activity_attempts WHERE run_id=$1', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_activity_assignments WHERE run_id=$1', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_live_room_codes WHERE run_id=$1', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_activity_runs WHERE id=$1', [runId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_activity_versions WHERE id=$1', [activityVersionId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_activities WHERE id=$1', [activityId]).catch(() => undefined);
      await pool.query('DELETE FROM knowledge_spaces WHERE id=$1', [spaceId]).catch(() => undefined);
      await pool.query('DELETE FROM users WHERE id = ANY($1::text[])', [[ownerId, ...studentIds, overflowStudentId]]).catch(() => undefined);
      await pool.end();
    }
  },
);
