ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS protocol_digest TEXT,
  ADD COLUMN IF NOT EXISTS tool_catalog_digest TEXT,
  ADD COLUMN IF NOT EXISTS failure_stage TEXT,
  ADD COLUMN IF NOT EXISTS failure_code TEXT,
  ADD COLUMN IF NOT EXISTS failure_retryable BOOLEAN,
  ADD COLUMN IF NOT EXISTS cancellation_source TEXT,
  ADD COLUMN IF NOT EXISTS permission_interaction_id UUID,
  ADD COLUMN IF NOT EXISTS permission_invocation_id UUID,
  ADD COLUMN IF NOT EXISTS permission_requirements JSONB,
  ADD COLUMN IF NOT EXISTS last_client_command_id UUID;

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_state_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_state_check CHECK (state IN (
    'queued','compiling_outcomes','planning','awaiting_worker','awaiting_permission',
    'executing_tool','awaiting_input','awaiting_approval','verifying','recovering',
    'completed','blocked','failed','cancelled','expired'
  ));

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_protocol_digest_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_protocol_digest_check CHECK (
    protocol_version < 3 OR (
      protocol_digest ~ '^[a-f0-9]{64}$'
      AND tool_catalog_digest ~ '^[a-f0-9]{64}$'
    )
  );

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_failure_stage_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_failure_stage_check CHECK (
    failure_stage IS NULL OR failure_stage IN (
      'negotiation','provider_request','provider_dispatch','tool_execution',
      'verification','runtime'
    )
  );

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_failure_code_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
      'provider_request_rejected','provider_unavailable','provider_outcome_unknown',
      'effect_outcome_unknown','required_outcome_unverified','internal_runtime_error',
      'permission_unavailable','run_expired'
    )
  );

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_cancellation_source_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_cancellation_source_check CHECK (
    cancellation_source IS NULL OR cancellation_source IN (
      'stop_button','focused_escape','replacement','sign_out','shutdown'
    )
  );

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_permission_wait_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_permission_wait_check CHECK (
    (state = 'awaiting_permission') = (
      permission_interaction_id IS NOT NULL
      AND permission_invocation_id IS NOT NULL
      AND permission_requirements IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE agent_run_events
  ADD COLUMN IF NOT EXISTS run_version INTEGER,
  ADD COLUMN IF NOT EXISTS projection JSONB;

ALTER TABLE agent_tool_invocations
  ADD COLUMN IF NOT EXISTS permission_interaction_id UUID,
  ADD COLUMN IF NOT EXISTS permission_requirements JSONB;
ALTER TABLE agent_tool_invocations
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_state_check;
ALTER TABLE agent_tool_invocations
  ADD CONSTRAINT agent_tool_invocations_state_check CHECK (state IN (
    'requested','delivered','awaiting_permission','executing','confirmed','failed',
    'denied','not_executed','unknown','cancelled','expired'
  ));

ALTER TABLE agent_worker_sessions
  ADD COLUMN IF NOT EXISTS protocol_digest TEXT,
  ADD COLUMN IF NOT EXISTS tool_catalog_digest TEXT;
ALTER TABLE agent_worker_sessions
  DROP CONSTRAINT IF EXISTS agent_worker_sessions_protocol_digest_check;
ALTER TABLE agent_worker_sessions
  ADD CONSTRAINT agent_worker_sessions_protocol_digest_check CHECK (
    protocol_version < 3 OR (
      protocol_digest ~ '^[a-f0-9]{64}$'
      AND tool_catalog_digest ~ '^[a-f0-9]{64}$'
    )
  );

DROP INDEX IF EXISTS agent_runs_claim_idx;
CREATE INDEX agent_runs_claim_idx
  ON agent_runs(state, lease_expires_at, created_at)
  WHERE state IN ('queued','planning','recovering','verifying');

CREATE INDEX IF NOT EXISTS agent_runs_permission_wait_idx
  ON agent_runs(state, deadline_at)
  WHERE state = 'awaiting_permission';

CREATE INDEX IF NOT EXISTS agent_tool_invocations_permission_wait_idx
  ON agent_tool_invocations(run_id, permission_interaction_id)
  WHERE state = 'awaiting_permission';

COMMENT ON COLUMN agent_runs.protocol_digest IS
  'SHA-256 of the canonical v3 wire schema. Null for legacy v2 rows.';
COMMENT ON COLUMN agent_runs.tool_catalog_digest IS
  'SHA-256 of the canonical hosted tool catalog. Null for legacy v2 rows.';
COMMENT ON COLUMN agent_runs.permission_interaction_id IS
  'Stable interaction used to reconstruct and resume a durable permission wait.';
