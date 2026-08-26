CREATE TABLE IF NOT EXISTS connector_oauth_attempts (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_key TEXT NOT NULL CHECK (catalog_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  state_digest BYTEA NOT NULL UNIQUE CHECK (octet_length(state_digest) = 32),
  secret_ciphertext BYTEA NOT NULL CHECK (octet_length(secret_ciphertext) BETWEEN 1 AND 16384),
  secret_iv BYTEA NOT NULL CHECK (octet_length(secret_iv) = 12),
  secret_tag BYTEA NOT NULL CHECK (octet_length(secret_tag) = 16),
  secret_key_version INTEGER NOT NULL CHECK (secret_key_version > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','processing','connected','denied','failed','expired'
  )),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 80),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS connector_oauth_attempts_user_idx
  ON connector_oauth_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS connector_oauth_attempts_expiry_idx
  ON connector_oauth_attempts(expires_at) WHERE status IN ('pending','processing');

CREATE TABLE IF NOT EXISTS connector_connections (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_key TEXT NOT NULL CHECK (catalog_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  status TEXT NOT NULL DEFAULT 'connecting' CHECK (status IN (
    'connecting','connected','reauthorize','contract_changed','error','disconnected'
  )),
  token_ciphertext BYTEA CHECK (token_ciphertext IS NULL OR octet_length(token_ciphertext) BETWEEN 1 AND 65536),
  token_iv BYTEA CHECK (token_iv IS NULL OR octet_length(token_iv) = 12),
  token_tag BYTEA CHECK (token_tag IS NULL OR octet_length(token_tag) = 16),
  token_key_version INTEGER CHECK (token_key_version IS NULL OR token_key_version > 0),
  granted_scopes TEXT[] NOT NULL DEFAULT '{}',
  token_expires_at TIMESTAMPTZ,
  active_snapshot_id UUID,
  active_schema_digest TEXT CHECK (
    active_schema_digest IS NULL OR active_schema_digest ~ '^[a-f0-9]{64}$'
  ),
  refresh_lease_owner UUID,
  refresh_lease_expires_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, catalog_key),
  CHECK (
    (token_ciphertext IS NULL AND token_iv IS NULL AND token_tag IS NULL AND token_key_version IS NULL)
    OR
    (token_ciphertext IS NOT NULL AND token_iv IS NOT NULL AND token_tag IS NOT NULL AND token_key_version IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS connector_connections_user_idx
  ON connector_connections(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS connector_tool_snapshots (
  id UUID PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES connector_connections(id) ON DELETE CASCADE,
  catalog_key TEXT NOT NULL CHECK (catalog_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  schema_digest TEXT NOT NULL CHECK (schema_digest ~ '^[a-f0-9]{64}$'),
  policy_digest TEXT NOT NULL CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
  tools JSONB NOT NULL CHECK (jsonb_typeof(tools) = 'array'),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS connector_tool_snapshots_active_idx
  ON connector_tool_snapshots(connection_id) WHERE active;
CREATE INDEX IF NOT EXISTS connector_tool_snapshots_connection_idx
  ON connector_tool_snapshots(connection_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connector_connections_active_snapshot_fk'
      AND conrelid = 'connector_connections'::regclass
  ) THEN
    ALTER TABLE connector_connections
      ADD CONSTRAINT connector_connections_active_snapshot_fk
      FOREIGN KEY (active_snapshot_id) REFERENCES connector_tool_snapshots(id) ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS connector_audit_events (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES connector_connections(id) ON DELETE SET NULL,
  catalog_key TEXT NOT NULL CHECK (catalog_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  outcome TEXT NOT NULL CHECK (outcome IN ('success','denied','failed','unknown')),
  safe_details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(safe_details) = 'object')
);
CREATE INDEX IF NOT EXISTS connector_audit_events_user_idx
  ON connector_audit_events(user_id, created_at DESC);

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS approval_interaction_id UUID,
  ADD COLUMN IF NOT EXISTS approval_invocation_id UUID,
  ADD COLUMN IF NOT EXISTS approval_action_digest TEXT,
  ADD COLUMN IF NOT EXISTS approval_action JSONB,
  ADD COLUMN IF NOT EXISTS approval_expires_at TIMESTAMPTZ;

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_approval_wait_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_approval_wait_check CHECK (
    state <> 'awaiting_approval' OR (
      approval_interaction_id IS NOT NULL
      AND approval_invocation_id IS NOT NULL
      AND approval_action_digest ~ '^[a-f0-9]{64}$'
      AND approval_action IS NOT NULL
      AND approval_expires_at IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE agent_tool_invocations
  ADD COLUMN IF NOT EXISTS executor_kind TEXT NOT NULL DEFAULT 'desktop',
  ADD COLUMN IF NOT EXISTS connector_connection_id UUID REFERENCES connector_connections(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS connector_snapshot_id UUID REFERENCES connector_tool_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approval_interaction_id UUID,
  ADD COLUMN IF NOT EXISTS approval_action_digest TEXT,
  ADD COLUMN IF NOT EXISTS approval_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_lease_owner UUID,
  ADD COLUMN IF NOT EXISTS execution_lease_expires_at TIMESTAMPTZ;

ALTER TABLE agent_tool_invocations
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_executor_kind_check;
ALTER TABLE agent_tool_invocations
  ADD CONSTRAINT agent_tool_invocations_executor_kind_check
    CHECK (executor_kind IN ('desktop','connector'));
ALTER TABLE agent_tool_invocations
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_connector_route_check;
ALTER TABLE agent_tool_invocations
  ADD CONSTRAINT agent_tool_invocations_connector_route_check CHECK (
    (executor_kind = 'desktop' AND connector_connection_id IS NULL AND connector_snapshot_id IS NULL)
    OR
    (executor_kind = 'connector' AND connector_connection_id IS NOT NULL AND connector_snapshot_id IS NOT NULL)
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS agent_runs_approval_wait_idx
  ON agent_runs(approval_expires_at) WHERE state = 'awaiting_approval';
CREATE INDEX IF NOT EXISTS agent_tool_invocations_connector_pending_idx
  ON agent_tool_invocations(state, expires_at)
  WHERE executor_kind = 'connector' AND state IN ('requested','executing');

COMMENT ON TABLE connector_connections IS
  'User-owned verified connector credentials. OAuth tokens are stored only in versioned AES-GCM envelopes.';
COMMENT ON TABLE connector_tool_snapshots IS
  'Immutable reviewed MCP tool contracts pinned to agent route maps.';
COMMENT ON COLUMN connector_audit_events.safe_details IS
  'Identifiers and fixed status codes only; never OAuth values, arguments, or connector content.';
