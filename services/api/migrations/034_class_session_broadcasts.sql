ALTER TABLE knowledge_class_sessions ADD COLUMN broadcast_sequence BIGINT NOT NULL DEFAULT 0
  CHECK (broadcast_sequence BETWEEN 0 AND 9007199254740991);
ALTER TABLE knowledge_class_session_activities ADD CONSTRAINT session_activity_broadcast_target
  UNIQUE (session_id, run_id, activity_version_id);
CREATE TABLE IF NOT EXISTS knowledge_class_session_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES knowledge_class_sessions(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  kind TEXT NOT NULL CHECK (kind IN ('assignment','exercise','open_url')),
  payload JSONB NOT NULL,
  payload_digest TEXT NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_run_id UUID,
  activity_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id,client_id), UNIQUE(session_id,sequence),
  FOREIGN KEY(session_id,target_run_id,activity_version_id)
    REFERENCES knowledge_class_session_activities(session_id,run_id,activity_version_id),
  CHECK ((kind='assignment' AND target_run_id IS NOT NULL AND activity_version_id IS NOT NULL)
    OR (kind<>'assignment' AND target_run_id IS NULL AND activity_version_id IS NULL))
);
CREATE INDEX class_broadcast_created_idx ON knowledge_class_session_broadcasts(session_id,created_at);
