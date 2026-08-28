CREATE TABLE IF NOT EXISTS knowledge_class_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL,
  space_id UUID NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (CHAR_LENGTH(title) BETWEEN 1 AND 240),
  state TEXT NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'open', 'closed', 'archived')),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (space_id, client_id)
);
CREATE INDEX IF NOT EXISTS knowledge_class_sessions_space_page_idx
  ON knowledge_class_sessions(space_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS knowledge_class_session_activities (
  session_id UUID NOT NULL REFERENCES knowledge_class_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  activity_version_id UUID NOT NULL REFERENCES knowledge_activity_versions(id) ON DELETE RESTRICT,
  run_id UUID NOT NULL UNIQUE REFERENCES knowledge_activity_runs(id) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, position),
  UNIQUE (session_id, activity_version_id)
);
CREATE INDEX IF NOT EXISTS knowledge_class_session_activities_version_idx
  ON knowledge_class_session_activities(activity_version_id);

INSERT INTO knowledge_class_sessions (
  id, client_id, space_id, title, state, created_by, created_at, updated_at
)
SELECT
  runs.id,
  runs.client_id,
  runs.space_id,
  LEFT(COALESCE(NULLIF(BTRIM(versions.definition->>'title'), ''), 'Session'), 240),
  runs.state,
  runs.created_by,
  runs.created_at,
  runs.updated_at
FROM knowledge_activity_runs runs
JOIN knowledge_activity_versions versions ON versions.id=runs.activity_version_id
ON CONFLICT DO NOTHING;

INSERT INTO knowledge_class_session_activities (
  session_id, position, activity_version_id, run_id
)
SELECT runs.id, 0, runs.activity_version_id, runs.id
FROM knowledge_activity_runs runs
JOIN knowledge_class_sessions sessions ON sessions.id=runs.id
ON CONFLICT DO NOTHING;

COMMENT ON TABLE knowledge_class_sessions IS
  'Teacher-facing lesson sessions. Each session launches an ordered playlist of immutable activity versions.';
COMMENT ON TABLE knowledge_class_session_activities IS
  'Compatibility mapping from a session playlist to the existing per-activity Run execution model.';
