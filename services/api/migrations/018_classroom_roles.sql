ALTER TABLE users
  ADD COLUMN IF NOT EXISTS classroom_role TEXT NOT NULL DEFAULT 'unassigned';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_classroom_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_classroom_role_check CHECK (
    classroom_role IN ('unassigned', 'teacher', 'student')
  );

CREATE INDEX IF NOT EXISTS users_classroom_role_idx
  ON users(classroom_role, created_at DESC);

UPDATE users
SET classroom_role = 'teacher', updated_at = NOW()
WHERE classroom_role = 'unassigned'
  AND EXISTS (
    SELECT 1
    FROM knowledge_space_members
    WHERE knowledge_space_members.user_id = users.id
      AND knowledge_space_members.removed_at IS NULL
      AND knowledge_space_members.role IN ('owner', 'facilitator')
  );

UPDATE users
SET classroom_role = 'student', updated_at = NOW()
WHERE classroom_role = 'unassigned'
  AND EXISTS (
    SELECT 1
    FROM knowledge_space_members
    WHERE knowledge_space_members.user_id = users.id
      AND knowledge_space_members.removed_at IS NULL
      AND knowledge_space_members.role = 'participant'
  );

CREATE TABLE IF NOT EXISTS knowledge_space_member_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('facilitator', 'participant')),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  result JSONB NOT NULL CHECK (OCTET_LENGTH(result::TEXT) <= 262144),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (space_id, client_id)
);

ALTER TABLE admin_audit_events
  DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check CHECK (
    action IN (
      'user.blocked',
      'user.unblocked',
      'user.access_code_granted',
      'user.classroom_role_updated',
      'access_codes.created',
      'access_codes.paused',
      'access_codes.resumed',
      'access_codes.deleted'
    )
  );

COMMENT ON COLUMN users.classroom_role IS
  'Administrator-assigned product role. Space membership remains the authority for a specific class.';

COMMENT ON TABLE knowledge_space_member_batches IS
  'Idempotency and bounded result records for direct Teacher-managed class membership batches.';
