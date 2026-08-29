DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM agent_runs
    WHERE orchestrator_kind = 'openai_agents_sdk'
      AND state NOT IN ('completed','blocked','failed','cancelled','expired')
  ) THEN
    RAISE EXCEPTION
      'cannot freeze per-run tool surfaces while OpenAI Agents SDK runs are nonterminal';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS agent_run_tool_snapshots (
  run_id UUID PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  protocol_digest TEXT NOT NULL CHECK (protocol_digest ~ '^[a-f0-9]{64}$'),
  tool_catalog_digest TEXT NOT NULL CHECK (tool_catalog_digest ~ '^[a-f0-9]{64}$'),
  sdk_version TEXT NOT NULL CHECK (length(sdk_version) BETWEEN 1 AND 100),
  graph_version TEXT NOT NULL CHECK (graph_version ~ '^[a-f0-9]{64}$'),
  snapshot_digest TEXT NOT NULL CHECK (snapshot_digest ~ '^[a-f0-9]{64}$'),
  tools_ciphertext BYTEA NOT NULL,
  tools_iv BYTEA NOT NULL,
  tools_tag BYTEA NOT NULL,
  tools_key_version INTEGER NOT NULL CHECK (tools_key_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_run_tool_snapshots_compatibility_idx
  ON agent_run_tool_snapshots(
    protocol_digest,
    tool_catalog_digest,
    sdk_version,
    graph_version
  );

COMMENT ON TABLE agent_run_tool_snapshots IS
  'Encrypted immutable tool surface offered to one Agents SDK run and reused for every recovery claim.';
