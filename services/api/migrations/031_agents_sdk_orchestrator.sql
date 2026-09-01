DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM agent_runs
    WHERE state NOT IN ('completed','blocked','failed','cancelled','expired')
  ) THEN
    RAISE EXCEPTION 'cannot cut over the agent orchestrator while nonterminal runs exist';
  END IF;
END
$$;

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS orchestrator_kind TEXT,
  ADD COLUMN IF NOT EXISTS orchestrator_graph_version TEXT,
  ADD COLUMN IF NOT EXISTS sdk_version TEXT,
  ADD COLUMN IF NOT EXISTS session_revision BIGINT NOT NULL DEFAULT 0;

UPDATE agent_runs
SET orchestrator_kind = 'rust_responses_v2'
WHERE orchestrator_kind IS NULL;

ALTER TABLE agent_runs
  ALTER COLUMN orchestrator_kind SET NOT NULL;
ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_orchestrator_kind_check,
  ADD CONSTRAINT agent_runs_orchestrator_kind_check CHECK (
    orchestrator_kind IN ('rust_responses_v2','openai_agents_sdk')
  ),
  DROP CONSTRAINT IF EXISTS agent_runs_orchestrator_metadata_check,
  ADD CONSTRAINT agent_runs_orchestrator_metadata_check CHECK (
    orchestrator_kind <> 'openai_agents_sdk' OR (
      orchestrator_graph_version ~ '^[a-f0-9]{64}$'
      AND length(sdk_version) BETWEEN 1 AND 100
    )
  ),
  DROP CONSTRAINT IF EXISTS agent_runs_session_revision_check,
  ADD CONSTRAINT agent_runs_session_revision_check CHECK (session_revision >= 0),
  DROP CONSTRAINT IF EXISTS agent_runs_state_check,
  ADD CONSTRAINT agent_runs_state_check CHECK (state IN (
    'queued','compiling_outcomes','planning','awaiting_orchestrator','running',
    'awaiting_worker','awaiting_permission','executing_tool','awaiting_input',
    'verifying','recovering','completed','blocked','failed','cancelled','expired'
  ));

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_failure_stage_check,
  ADD CONSTRAINT agent_runs_failure_stage_check CHECK (
    failure_stage IS NULL OR failure_stage IN (
      'negotiation','provider_request','provider_dispatch','tool_execution',
      'verification','session','runtime'
    )
  ),
  DROP CONSTRAINT IF EXISTS agent_runs_failure_code_check,
  ADD CONSTRAINT agent_runs_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
      'provider_request_rejected','provider_unavailable','provider_outcome_unknown',
      'tool_outcome_unknown','required_outcome_unverified','internal_runtime_error',
      'permission_unavailable','orchestrator_unavailable','session_conflict',
      'graph_version_mismatch','run_expired'
    )
  );

ALTER TABLE agent_run_checkpoints
  ADD COLUMN IF NOT EXISTS runtime_kind TEXT NOT NULL DEFAULT 'rust_responses_v2',
  ADD COLUMN IF NOT EXISTS state_schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sdk_version TEXT,
  ADD COLUMN IF NOT EXISTS graph_version TEXT,
  ADD COLUMN IF NOT EXISTS pending_call_id TEXT,
  ADD COLUMN IF NOT EXISTS applied_control_sequence BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkpoint_revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE agent_run_checkpoints
  DROP CONSTRAINT IF EXISTS agent_run_checkpoints_runtime_kind_check,
  ADD CONSTRAINT agent_run_checkpoints_runtime_kind_check CHECK (
    runtime_kind IN ('rust_responses_v2','openai_agents_sdk')
  ),
  DROP CONSTRAINT IF EXISTS agent_run_checkpoints_state_schema_version_check,
  ADD CONSTRAINT agent_run_checkpoints_state_schema_version_check CHECK (
    state_schema_version > 0
  ),
  DROP CONSTRAINT IF EXISTS agent_run_checkpoints_checkpoint_revision_check,
  ADD CONSTRAINT agent_run_checkpoints_checkpoint_revision_check CHECK (
    checkpoint_revision > 0
  ),
  DROP CONSTRAINT IF EXISTS agent_run_checkpoints_control_sequence_check,
  ADD CONSTRAINT agent_run_checkpoints_control_sequence_check CHECK (
    applied_control_sequence >= 0
  ),
  DROP CONSTRAINT IF EXISTS agent_run_checkpoints_sdk_metadata_check,
  ADD CONSTRAINT agent_run_checkpoints_sdk_metadata_check CHECK (
    runtime_kind <> 'openai_agents_sdk' OR (
      length(sdk_version) BETWEEN 1 AND 100
      AND graph_version ~ '^[a-f0-9]{64}$'
    )
  );

-- Legacy checkpoints were versioned by run_version. Preserve that ordering when
-- introducing the SDK checkpoint revision; otherwise every existing row keeps
-- the column default of 1 and runs with multiple checkpoints violate the new
-- unique index below.
UPDATE agent_run_checkpoints
SET checkpoint_revision = run_version
WHERE runtime_kind = 'rust_responses_v2';

CREATE UNIQUE INDEX IF NOT EXISTS agent_run_checkpoints_revision_idx
  ON agent_run_checkpoints(run_id, checkpoint_revision);

CREATE TABLE IF NOT EXISTS agent_session_mutations (
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 255),
  operation_digest TEXT NOT NULL CHECK (operation_digest ~ '^[a-f0-9]{64}$'),
  resulting_revision BIGINT NOT NULL CHECK (resulting_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, operation_id),
  UNIQUE (run_id, resulting_revision)
);

CREATE TABLE IF NOT EXISTS agent_orchestrator_workers (
  id UUID PRIMARY KEY,
  instance_id UUID NOT NULL UNIQUE,
  protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
  protocol_digest TEXT NOT NULL CHECK (protocol_digest ~ '^[a-f0-9]{64}$'),
  release_version TEXT NOT NULL CHECK (length(release_version) BETWEEN 1 AND 100),
  sdk_version TEXT NOT NULL CHECK (length(sdk_version) BETWEEN 1 AND 100),
  graph_version TEXT NOT NULL CHECK (graph_version ~ '^[a-f0-9]{64}$'),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  disconnected_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_model_dispatches (
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  request_kind TEXT NOT NULL CHECK (request_kind IN ('response','compact')),
  provider_request_id UUID NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('dispatched','completed','unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (run_id, request_digest)
);

ALTER TABLE agent_run_events
  ADD COLUMN IF NOT EXISTS agent_turn_id UUID
  REFERENCES agent_turns(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS agent_run_events_agent_turn_idx
  ON agent_run_events(agent_turn_id)
  WHERE agent_turn_id IS NOT NULL;

ALTER TABLE agent_tool_invocations
  ADD COLUMN IF NOT EXISTS catalog_digest TEXT,
  ADD COLUMN IF NOT EXISTS driver_catalog_digest TEXT,
  ADD COLUMN IF NOT EXISTS sdk_version TEXT,
  ADD COLUMN IF NOT EXISTS graph_version TEXT;

ALTER TABLE agent_tool_invocations
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_catalog_digest_check,
  ADD CONSTRAINT agent_tool_invocations_catalog_digest_check CHECK (
    catalog_digest IS NULL OR catalog_digest ~ '^[a-f0-9]{64}$'
  ),
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_driver_catalog_digest_check,
  ADD CONSTRAINT agent_tool_invocations_driver_catalog_digest_check CHECK (
    driver_catalog_digest IS NULL OR driver_catalog_digest ~ '^[a-f0-9]{64}$'
  );

DROP INDEX IF EXISTS agent_runs_claim_idx;
CREATE INDEX agent_runs_claim_idx
  ON agent_runs(orchestrator_kind, state, lease_expires_at, created_at)
  WHERE state IN (
    'queued','awaiting_orchestrator','recovering','running',
    'awaiting_worker','awaiting_permission','executing_tool'
  );
CREATE INDEX IF NOT EXISTS agent_orchestrator_workers_available_idx
  ON agent_orchestrator_workers(expires_at DESC)
  WHERE disconnected_at IS NULL;
CREATE INDEX IF NOT EXISTS agent_tool_invocations_terminal_wait_idx
  ON agent_tool_invocations(run_id, call_id, state)
  WHERE state IN (
    'confirmed','failed','denied','not_executed','unknown','cancelled','expired'
  );

COMMENT ON COLUMN agent_runs.orchestrator_kind IS
  'The sole reasoning-loop owner for this run. New v5 rows use openai_agents_sdk.';
COMMENT ON TABLE agent_session_mutations IS
  'Idempotency ledger for atomic Agents SDK Session history transactions.';
COMMENT ON TABLE agent_orchestrator_workers IS
  'Private OpenAI Agents SDK worker releases and expiring health leases.';
COMMENT ON TABLE agent_model_dispatches IS
  'Content-free no-replay ledger for model and compaction requests; repeated request digests terminate as ambiguous.';
COMMENT ON COLUMN agent_run_events.agent_turn_id IS
  'Idempotency link for user-authored steering events; null for runtime-generated events.';
