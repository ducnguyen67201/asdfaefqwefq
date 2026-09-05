ALTER TABLE knowledge_run_directives
  DROP CONSTRAINT IF EXISTS knowledge_run_directives_kind_check;

ALTER TABLE knowledge_run_directives
  ADD CONSTRAINT knowledge_run_directives_kind_check
  CHECK (kind IN ('exercise', 'open_url', 'explain_assignment'));

ALTER TABLE knowledge_run_directives
  DROP CONSTRAINT IF EXISTS knowledge_run_directives_delivery_check;

ALTER TABLE knowledge_run_directives
  ADD CONSTRAINT knowledge_run_directives_delivery_check
  CHECK (delivery IN ('auto_eligible', 'manual_only', 'consent_required'));

COMMENT ON TABLE knowledge_run_directive_claims IS
  'A claim prevents duplicate automatic link or Coach handling; it is not proof that a local action completed.';
