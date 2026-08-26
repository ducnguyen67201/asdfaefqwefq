ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS home_banner_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS home_banner_bytes BYTEA;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_home_banner_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_home_banner_check CHECK (
    (home_banner_mime_type IS NULL AND home_banner_bytes IS NULL)
    OR (
      home_banner_mime_type IN ('image/png', 'image/jpeg', 'image/webp')
      AND OCTET_LENGTH(home_banner_bytes) BETWEEN 1 AND 750000
    )
  );

ALTER TABLE organization_audit_events
  DROP CONSTRAINT IF EXISTS organization_audit_events_action_check;

ALTER TABLE organization_audit_events
  ADD CONSTRAINT organization_audit_events_action_check CHECK (
    action IN (
      'organization.claimed',
      'organization.member_added',
      'organization.member_joined',
      'organization.pending_cancelled',
      'organization.profile_updated',
      'organization.home_banner_updated'
    )
  );

COMMENT ON COLUMN organizations.home_banner_bytes IS
  'Optional organizer-managed image shown on the idle home screen for this organization.';
