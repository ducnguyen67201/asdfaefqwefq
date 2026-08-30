DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM agent_runs
    WHERE state NOT IN ('completed','blocked','failed','cancelled','expired')
  ) THEN
    RAISE EXCEPTION 'cannot remove action policy metadata while nonterminal agent runs exist';
  END IF;

  IF EXISTS (SELECT 1 FROM agent_runs WHERE state = 'awaiting_approval') THEN
    RAISE EXCEPTION 'cannot remove legacy approval state while awaiting_approval runs exist';
  END IF;
END
$$;

DROP INDEX IF EXISTS agent_runs_approval_wait_idx;
DROP INDEX IF EXISTS agent_tool_invocations_policy_idx;

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_approval_wait_check,
  DROP CONSTRAINT IF EXISTS agent_runs_state_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_state_check CHECK (state IN (
    'queued','compiling_outcomes','planning','awaiting_worker','awaiting_permission',
    'executing_tool','awaiting_input','verifying','recovering','completed','blocked',
    'failed','cancelled','expired'
  ));
ALTER TABLE agent_runs
  DROP COLUMN IF EXISTS approval_interaction_id,
  DROP COLUMN IF EXISTS approval_invocation_id,
  DROP COLUMN IF EXISTS approval_action_digest,
  DROP COLUMN IF EXISTS approval_action,
  DROP COLUMN IF EXISTS approval_expires_at;

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_failure_code_check;
UPDATE agent_runs
SET failure_code = 'tool_outcome_unknown'
WHERE failure_code = 'effect_outcome_unknown';
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_failure_code_check CHECK (
    failure_code IS NULL OR failure_code IN (
      'provider_request_rejected','provider_unavailable','provider_outcome_unknown',
      'tool_outcome_unknown','required_outcome_unverified',
      'internal_runtime_error','permission_unavailable','run_expired'
    )
  );

ALTER TABLE agent_tool_invocations
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_effect_kind_check,
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_resource_kind_check,
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_effect_resource_consistency_check,
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_authorization_source_check,
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_intent_revision_check,
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_execution_authorization_check,
  DROP CONSTRAINT IF EXISTS agent_tool_invocations_policy_consistency_check;
ALTER TABLE agent_tool_invocations
  DROP COLUMN IF EXISTS authorization_source,
  DROP COLUMN IF EXISTS intent_revision,
  DROP COLUMN IF EXISTS approval_required,
  DROP COLUMN IF EXISTS approval_interaction_id,
  DROP COLUMN IF EXISTS approval_action_digest,
  DROP COLUMN IF EXISTS approval_expires_at,
  DROP COLUMN IF EXISTS consequential,
  DROP COLUMN IF EXISTS effect_kind,
  DROP COLUMN IF EXISTS resource_kind;

ALTER TABLE agent_outcome_criteria
  DROP CONSTRAINT IF EXISTS agent_outcome_criteria_verifier_kind_check;
UPDATE agent_outcome_criteria
SET verifier_kind = CASE verifier_kind
  WHEN 'filesystem_effect' THEN 'filesystem_result'
  WHEN 'tool_effect' THEN 'tool_result'
  ELSE verifier_kind
END;
ALTER TABLE agent_outcome_criteria
  ADD CONSTRAINT agent_outcome_criteria_verifier_kind_check CHECK (verifier_kind IN (
    'assistant_output','application_surface','browser_semantic',
    'filesystem_result','tool_result','semantic_judge'
  ));

ALTER TABLE connector_tool_snapshots
  RENAME COLUMN policy_digest TO catalog_contract_digest;

COMMENT ON COLUMN connector_tool_snapshots.catalog_contract_digest IS
  'Digest of the reviewed connector tool contract used to validate the immutable schema snapshot.';
