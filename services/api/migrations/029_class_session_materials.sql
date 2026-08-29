CREATE TABLE IF NOT EXISTS knowledge_class_session_materials (
  session_id UUID NOT NULL REFERENCES knowledge_class_sessions(id) ON DELETE CASCADE,
  source_version_id UUID NOT NULL REFERENCES knowledge_source_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY (session_id, source_version_id)
);
CREATE INDEX IF NOT EXISTS knowledge_class_session_materials_source_idx
  ON knowledge_class_session_materials(source_version_id, session_id);

COMMENT ON TABLE knowledge_class_session_materials IS
  'Many-to-many pins from a class Session to immutable material versions. One material version may support multiple Sessions.';
