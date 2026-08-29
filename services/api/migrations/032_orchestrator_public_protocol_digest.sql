ALTER TABLE agent_orchestrator_workers
  ADD COLUMN IF NOT EXISTS public_protocol_digest TEXT;

DO $$
BEGIN
  ALTER TABLE agent_orchestrator_workers
    ADD CONSTRAINT agent_orchestrator_workers_public_protocol_digest_format
    CHECK (
      public_protocol_digest IS NULL
      OR public_protocol_digest ~ '^[a-f0-9]{64}$'
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS agent_orchestrator_workers_compatibility_idx
  ON agent_orchestrator_workers(
    protocol_version,
    protocol_digest,
    public_protocol_digest,
    heartbeat_at DESC
  )
  WHERE disconnected_at IS NULL;

COMMENT ON COLUMN agent_orchestrator_workers.public_protocol_digest IS
  'Public agent-runtime digest this SDK worker was built to execute.';
