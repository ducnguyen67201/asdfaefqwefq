ALTER TABLE organization_audit_events
  DROP CONSTRAINT IF EXISTS organization_audit_events_action_check;

ALTER TABLE organization_audit_events
  ADD CONSTRAINT organization_audit_events_action_check CHECK (
    action IN (
      'organization.claimed',
      'organization.member_added',
      'organization.member_joined',
      'organization.pending_cancelled',
      'organization.profile_updated'
    )
  );
