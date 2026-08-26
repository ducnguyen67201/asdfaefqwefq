ALTER TABLE access_codes
  ADD COLUMN IF NOT EXISTS distribution_mode TEXT NOT NULL DEFAULT 'shared';

ALTER TABLE access_codes
  DROP CONSTRAINT IF EXISTS access_codes_distribution_mode_check;

ALTER TABLE access_codes
  ADD CONSTRAINT access_codes_distribution_mode_check CHECK (
    distribution_mode IN ('shared', 'organization')
  );

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL UNIQUE REFERENCES access_codes(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  email TEXT NOT NULL CHECK (CHAR_LENGTH(email) BETWEEN 3 AND 320),
  email_normalized TEXT NOT NULL CHECK (
    email_normalized = LOWER(BTRIM(email_normalized))
  ),
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('organizer', 'member')),
  invited_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  CHECK (
    (user_id IS NULL AND joined_at IS NULL)
    OR (user_id IS NOT NULL AND joined_at IS NOT NULL)
  ),
  CHECK (
    role <> 'organizer'
    OR (user_id IS NOT NULL AND joined_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_email_active_uidx
  ON organization_memberships(email_normalized)
  WHERE removed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_user_active_uidx
  ON organization_memberships(user_id)
  WHERE user_id IS NOT NULL AND removed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_organizer_uidx
  ON organization_memberships(organization_id)
  WHERE role = 'organizer' AND removed_at IS NULL;

CREATE INDEX IF NOT EXISTS organization_memberships_organization_created_idx
  ON organization_memberships(organization_id, created_at, id)
  WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS organization_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_membership_id UUID REFERENCES organization_memberships(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN (
      'organization.claimed',
      'organization.member_added',
      'organization.member_joined',
      'organization.pending_cancelled'
    )
  ),
  detail JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (
    OCTET_LENGTH(detail::TEXT) <= 2048
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS organization_audit_events_organization_created_idx
  ON organization_audit_events(organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_organization_redemption_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM access_codes
    WHERE id = NEW.access_code_id
      AND distribution_mode = 'organization'
  ) AND NOT EXISTS (
    SELECT 1
    FROM organizations
    JOIN organization_memberships
      ON organization_memberships.organization_id = organizations.id
     AND organization_memberships.user_id = NEW.user_id
     AND organization_memberships.joined_at IS NOT NULL
     AND organization_memberships.removed_at IS NULL
    WHERE organizations.access_code_id = NEW.access_code_id
  ) THEN
    RAISE EXCEPTION 'organization-managed access requires active membership'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'access_code_redemptions_organization_membership_check';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS access_code_redemptions_organization_membership_trigger
  ON access_code_redemptions;

CREATE TRIGGER access_code_redemptions_organization_membership_trigger
  BEFORE INSERT ON access_code_redemptions
  FOR EACH ROW
  EXECUTE FUNCTION enforce_organization_redemption_membership();

COMMENT ON COLUMN access_codes.distribution_mode IS
  'shared lets each user redeem the code; organization delegates seats to one organizer.';

COMMENT ON COLUMN organization_memberships.email_normalized IS
  'Lowercase verified Google email used only to claim a reserved seat at sign-in.';
