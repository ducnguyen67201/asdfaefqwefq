ALTER TABLE knowledge_activity_runs
  DROP CONSTRAINT IF EXISTS knowledge_activity_runs_target_kind_check;
ALTER TABLE knowledge_activity_runs
  ADD CONSTRAINT knowledge_activity_runs_target_kind_check
  CHECK (target_kind IN ('group', 'participants', 'room'));

ALTER TABLE knowledge_activity_runs
  DROP CONSTRAINT IF EXISTS knowledge_activity_runs_check;
ALTER TABLE knowledge_activity_runs
  DROP CONSTRAINT IF EXISTS knowledge_activity_runs_target_group_check;
ALTER TABLE knowledge_activity_runs
  ADD CONSTRAINT knowledge_activity_runs_target_group_check
  CHECK ((target_kind = 'group') = (target_group_id IS NOT NULL));

ALTER TABLE knowledge_activity_attempts
  DROP CONSTRAINT IF EXISTS knowledge_activity_attempts_state_check;
ALTER TABLE knowledge_activity_attempts
  ADD CONSTRAINT knowledge_activity_attempts_state_check
  CHECK (state IN (
    'assigned', 'in_progress', 'blocked', 'ready_for_review',
    'submitted', 'completed', 'withdrawn'
  ));
ALTER TABLE knowledge_activity_attempts
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS knowledge_activity_attempts_review_queue_idx
  ON knowledge_activity_attempts(run_id, updated_at DESC, id DESC)
  WHERE state IN ('ready_for_review', 'submitted');

ALTER TABLE knowledge_activity_work_sessions
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'work';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_activity_work_sessions_purpose_check'
  ) THEN
    ALTER TABLE knowledge_activity_work_sessions
      ADD CONSTRAINT knowledge_activity_work_sessions_purpose_check
      CHECK (purpose IN ('work', 'help', 'check'));
  END IF;
END $$;

WITH ranked_open_help AS (
  SELECT id,ROW_NUMBER() OVER (
    PARTITION BY attempt_id ORDER BY requested_at,id
  ) AS position
  FROM knowledge_attempt_help_requests
  WHERE resolved_at IS NULL
)
UPDATE knowledge_attempt_help_requests requests
SET resolved_at=NOW()
FROM ranked_open_help ranked
WHERE requests.id=ranked.id AND ranked.position > 1;
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_attempt_help_one_open_idx
  ON knowledge_attempt_help_requests(attempt_id)
  WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_live_room_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES knowledge_activity_runs(id) ON DELETE CASCADE,
  code_digest BYTEA NOT NULL UNIQUE CHECK (OCTET_LENGTH(code_digest) = 32),
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 2000),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND max_uses),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, client_id)
);
CREATE INDEX IF NOT EXISTS knowledge_live_room_codes_run_idx
  ON knowledge_live_room_codes(run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_run_participations (
  run_id UUID NOT NULL REFERENCES knowledge_activity_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt_id UUID NOT NULL UNIQUE REFERENCES knowledge_activity_attempts(id) ON DELETE RESTRICT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, user_id)
);
CREATE INDEX IF NOT EXISTS knowledge_run_participations_user_idx
  ON knowledge_run_participations(user_id, updated_at DESC);

CREATE SEQUENCE IF NOT EXISTS knowledge_run_directive_sequence;
CREATE TABLE IF NOT EXISTS knowledge_run_directives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES knowledge_activity_runs(id) ON DELETE CASCADE,
  activity_version_id UUID NOT NULL REFERENCES knowledge_activity_versions(id) ON DELETE RESTRICT,
  sequence BIGINT NOT NULL DEFAULT nextval('knowledge_run_directive_sequence'),
  kind TEXT NOT NULL CHECK (kind IN ('exercise', 'open_url')),
  delivery TEXT NOT NULL CHECK (delivery IN ('auto_eligible', 'manual_only')),
  payload JSONB NOT NULL CHECK (OCTET_LENGTH(payload::TEXT) <= 16384),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, client_id),
  UNIQUE (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS knowledge_run_directives_delta_idx
  ON knowledge_run_directives(run_id, sequence);

CREATE TABLE IF NOT EXISTS knowledge_run_directive_claims (
  directive_id UUID NOT NULL REFERENCES knowledge_run_directives(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (directive_id, user_id)
);

CREATE TABLE IF NOT EXISTS knowledge_attempt_review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  attempt_id UUID NOT NULL REFERENCES knowledge_activity_attempts(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('complete', 'return')),
  reviewed_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, client_id)
);

COMMENT ON TABLE knowledge_run_participations IS
  'Explicit room lifecycle only. It does not contain cursor, typing, screen, or inferred behavior telemetry.';
COMMENT ON TABLE knowledge_run_directive_claims IS
  'A claim prevents duplicate automatic handling; it is not proof that the operating system opened the URL.';
