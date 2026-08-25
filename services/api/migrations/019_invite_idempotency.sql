ALTER TABLE knowledge_space_invites
  ADD COLUMN IF NOT EXISTS code_ciphertext BYTEA;

COMMENT ON COLUMN knowledge_space_invites.code_ciphertext IS
  'Authenticated encrypted invite code used only to return the original response for an idempotent create replay.';
