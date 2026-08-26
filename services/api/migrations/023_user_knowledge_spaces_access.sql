ALTER TABLE users
  ADD COLUMN IF NOT EXISTS knowledge_spaces_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE admin_audit_events
  DROP CONSTRAINT IF EXISTS admin_audit_events_action_check;

ALTER TABLE admin_audit_events
  ADD CONSTRAINT admin_audit_events_action_check CHECK (
    action IN (
      'user.blocked',
      'user.unblocked',
      'user.access_code_granted',
      'user.classroom_role_updated',
      'user.knowledge_spaces_access_updated',
      'access_codes.created',
      'access_codes.paused',
      'access_codes.resumed',
      'access_codes.deleted'
    )
  );

COMMENT ON COLUMN users.knowledge_spaces_enabled IS
  'Per-account access to Knowledge Spaces and classroom UI. Defaults on; administrators may disable it.';
