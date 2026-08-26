# Plan: Organization-Managed Access Codes and Seat Delegation

**Status:** Implemented and validated on 2026-08-25. See `../../reports/organization-managed-access-codes-report.md`.

> **Architecture amendment (2026-08-25):** The implementation follows
> `services/api/README.md`: the hosted backend is fully Rust-owned. The
> JavaScript repository/controller/route work originally described in Tasks 2
> and 3 was removed before review, and the final change creates or modifies no
> `.mjs` files. Migration 021 and a dedicated Bazel integration-test target
> replace the stale dual-backend plan. All later references in this archived
> plan to Node implementation or Node/Rust parity are superseded by this
> amendment.

## Summary

Replace the repeated per-user code-entry flow with a backward-compatible organization seat flow. A newly generated organization-managed code has a fixed capacity; the first approved account to redeem or receive it becomes the organizer, can reserve seats for verified Google email addresses from a new in-app Organization page, and every invited account receives the code's plan automatically at sign-in without seeing or entering the code.

Keep existing shared codes and existing redemptions working exactly as they do today. Capacity must be enforced transactionally across the organizer, active members, and pending email reservations; adding the last available seat must return and display a full-capacity warning, and any later add must fail with a stable `organization_capacity_reached` conflict.

## User Story

As a teacher or organization organizer, I want to redeem one capacity-bearing code and add my members by email, so that they automatically join my organization and receive its Tro plan without each person entering the code.

As a Tro platform administrator, I want to create and inspect organization-managed codes while retaining old shared codes, so that rollout does not revoke or silently change existing access.

## Problem → Solution

Every hosted user currently signs in, chooses Free or enters a shared code, and consumes capacity only when that code is redeemed. The platform administrator is the only person who can grant a code to an existing user. → Add an organization distribution mode, make one organizer the delegated authority for that code, reserve seats by normalized Google email, auto-activate pending members during verified Google sign-in, expose a narrow organizer-only member-management API and Electron UI, and keep legacy shared-code behavior as a compatibility path.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A — standalone free-form feature request
- **PRD Phase**: N/A
- **Estimated Files**: 55 updated or created files
- **Estimated Tasks**: 9 implementation gates
- **New Dependencies**: None
- **External Research**: None needed — the feature uses established PostgreSQL, Node, Rust/Axum, Electron IPC, Zod, and React patterns already pinned in this repository
- **Confidence Score**: 8/10
- **Repository State**: `package-lock.json`, `.claude/PRPs/plans/live-classroom-room-flow.plan.md`, and `.claude/PRPs/plans/repo-wide-rust-tooling-bazel-coverage.plan.md` contain pre-existing user changes. Preserve them; this feature requires no dependency or lockfile edit.
- **Navigation Note**: The injected repository supplement requests `docs/CODEX-NAVIGATION-GUIDE.md`, but that file is absent. The discovery and Mandatory Reading sections below replace it for this implementation.

---

## Requirements Resolved for This Plan

The request is implemented with the following explicit product decisions so implementation does not need another requirements round:

1. **One organization-managed code maps to one organization and one plan.** `access_codes.max_users` remains the seat limit and `access_codes.plan` remains the entitlement source.
2. **The organizer consumes a seat.** A 10-seat code permits one organizer plus nine other non-removed memberships.
3. **The first approved account claims organizer authority.** This may happen by the user redeeming the plaintext code or by a Tro platform admin granting an unclaimed organization code to that user. The operation creates the organization and organizer membership atomically.
4. **Every organizer-added email starts as a pending reservation, even when a matching `users` row already exists.** Only a fresh server-verified Google sign-in may bind the reservation to a user and activate it. This avoids relying on the mutable, non-unique `users.email` column and avoids disclosing account or block status to an organizer; no email is sent and no invite code is shown.
5. **Pending reservations consume capacity.** This prevents an organizer from over-inviting and makes the full-state deterministic.
6. **A repeated same-organization email add is idempotent.** It returns the existing membership and consumes no second seat.
7. **One account or pending email can belong to only one active organization.** Cross-organization conflicts return a stable 409 instead of assigning an arbitrary organization at sign-in.
8. **Only pending reservations may be cancelled in this phase.** This frees typo/unused seats safely. Removing active members, transferring organizer ownership, changing capacity, renaming the organization, and downgrading entitlements are out of scope.
9. **Pausing an organization code blocks its initial claim and new member reservations.** Already active members retain access, and a pending reservation made before the pause may still auto-activate because its seat and approval were already recorded.
10. **Legacy shared codes remain shared.** Existing rows migrate with `distribution_mode = 'shared'`. New dashboard/CLI code creation defaults to `organization`; operators can explicitly select `shared` during the compatibility window.
11. **Organization is a licensing/access boundary, not a Knowledge Space.** Do not automatically create a Knowledge Space or change Space roles, groups, activities, or classroom behavior.

---

## UX Design

### Before

```text
Tro platform admin creates CODE-A (10 users, Pro)
                    │
                    ├─ gives CODE-A to user 1 → user enters code
                    ├─ gives CODE-A to user 2 → user enters code
                    ├─ gives CODE-A to user 3 → user enters code
                    └─ ... every user repeats code entry

Only the platform admin can grant a code to an already registered account.
The shared code itself is the authority and can be forwarded until capacity is full.
```

### After

```text
Tro platform admin creates ORG-A (10 seats, Pro, organization mode)
                    │
                    └─ gives/grants code once to teacher
                                      │
                                      ▼
                            Teacher claims organizer seat (1/10)
                                      │
                         Organization page: add Google emails
                         ┌────────────┼───────────────┐
                         ▼            ▼               ▼
                    known email    new email      last seat added
                    pending seat   pending seat   warning: 10/10 full
                         │            │
                         └────────────┴─ verified Google sign-in
                                               │
                                               ▼
                               account joins automatically on Pro
                               no access-code entry required
```

### Organizer Page

```text
┌──────────────────────────────────────────────────────────────────┐
│ Organization                                                     │
│ Teacher Cohort · Pro                                             │
│                                                                  │
│  Seats assigned  [████████░░]  8 / 10       2 seats remaining    │
│                                                                  │
│  Add member                                                      │
│  [ student@example.com________________________ ] [ Add member ]   │
│  Pending emails activate automatically when that Google account  │
│  signs in to Tro.                                                │
│                                                                  │
│  Members                                                         │
│  Teacher Name     teacher@example.com   Organizer  Active         │
│  Student One      one@example.com       Member     Active         │
│  —                two@example.com       Member     Pending [Cancel]│
└──────────────────────────────────────────────────────────────────┘

When assignedSeats === maxSeats:
┌──────────────────────────────────────────────────────────────────┐
│ ⚠ All 10 seats are assigned. Ask the Tro team for more capacity. │
└──────────────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Code creation | Code has plan and `max_users` only | Platform admin/CLI also selects `organization` or `shared`; organization is the default | Existing rows remain shared |
| First redemption | Any user consumes one shared seat | First user of an organization code creates the organization and becomes organizer | Organizer counts toward capacity |
| Later code use | Anyone with the code may redeem until full | Claimed organization code rejects unassigned redeemers and tells them to ask the organizer | Prevents code forwarding from granting authority |
| Adding users | Platform admin grants only to a registered account | Organizer adds an email in the desktop app; every add reserves a pending seat until that address next completes verified Google sign-in | Prevents account enumeration and unsafe matching against non-unique stored email |
| Member sign-in | User sees plan choice/code gate | Verified pending email is claimed inside session issuance, so membership status is already active | No renderer-only authorization |
| Capacity | Redemption returns an error only after a user enters a full code | Organizer always sees assigned/max/remaining; the last successful add produces a full warning and later adds return 409 | Pending seats count |
| Platform admin inventory | Shows code redemptions | Shows distribution mode, claim state, organizer, pending/active seats, and capacity | Shared-code rows retain old presentation |
| Pending typo | No equivalent state | Organizer may cancel only a pending reservation and recover that seat | Active member removal is deferred |

---

## Strategic Design

### Approach

Add an organization layer beside, not instead of, access-code redemptions:

- `access_codes` owns distribution mode, plan, pause state, and maximum seats.
- `organizations` gives an organization-managed code a stable aggregate and display name.
- `organization_memberships` owns organizer/member role, pending/active identity binding, and seat reservation.
- `access_code_redemptions` remains the authoritative active entitlement link used by existing plan enforcement and provider routes.
- Session issuance converts one exact pending email membership into an active membership plus redemption in the same transaction that upserts the verified Google user and creates the opaque device session.

This preserves every current downstream check that resolves access through `access_code_redemptions`, while adding the role and pending-email state that the current schema cannot represent.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Reuse `knowledge_spaces` as organizations | Reject | Space membership is educational/content authority; plan licensing must not implicitly grant owner/facilitator access to content |
| Replace `access_code_redemptions` with organization memberships | Reject | It would rewrite provider access, budget, admin, and rollback contracts and make the JavaScript/Rust cutover materially riskier |
| Let organizer share a second invite token | Reject | It retains the code-entry annoyance and makes the token, rather than organizer approval, the member authority |
| Add only existing registered users | Reject | It requires every member to sign in and get stuck at the gate before the organizer can add them |
| Send invitation emails | Defer | No mail provider, delivery policy, template, unsubscribe, or bounce handling exists; email reservation alone satisfies automatic join |
| Automatically select the oldest legacy redeemer as organizer | Reject | It silently grants new administrative authority to an existing user |
| Count only active users | Reject | Concurrent/pending invitations could oversubscribe capacity |

### Scope

- Forward-only schema for distribution mode, organizations, memberships, and organization audit events.
- Organization-aware claim/redemption and verified-email auto-provisioning in both the JavaScript release backend and Rust candidate backend.
- Organizer-only current-organization summary, member list, add-email, and cancel-pending APIs.
- Narrow Electron main client, Zod contracts, IPC/preload bridge, and organizer page.
- Platform admin dashboard and both operator CLIs updated for distribution mode and organization seat visibility.
- Backward-compatible route/schema fixtures, documentation, JavaScript tests, Rust tests, desktop tests, and required packaging/Bazel gates.

### NOT Building

- No invitation email, SMS, magic link, QR code, or third-party messaging integration.
- No active-member removal, plan downgrade on removal, organizer transfer, multiple organizers, organization rename, or capacity editing.
- No multiple organizations per user and no nested teams/departments.
- No per-organization shared usage budget; current plan quotas remain per account.
- No Knowledge Space creation, Space role assignment, classroom roster synchronization, or Activity assignment.
- No offline signed-membership organization management; the organizer feature requires the hosted API.
- No exposure of raw Electron IPC, bearer tokens, plaintext access codes, or database identifiers beyond bounded UUIDs in typed contracts.
- No production migration execution, deployment, Railway change, or admin action as part of implementation without separate operator approval.

---

## Data Model and Invariants

### Migration 021

Create `services/api/migrations/021_organization_managed_access.sql` as a forward-only, re-runnable migration. Do not edit migrations 001–018.

```sql
ALTER TABLE access_codes
  ADD COLUMN IF NOT EXISTS distribution_mode TEXT NOT NULL DEFAULT 'shared';

-- Add a named CHECK after dropping only the same named constraint so reruns work.
-- Allowed values: 'shared', 'organization'. Existing rows remain 'shared'.

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
  email_normalized TEXT NOT NULL CHECK (email_normalized = LOWER(BTRIM(email_normalized))),
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
  CHECK (role <> 'organizer' OR (user_id IS NOT NULL AND joined_at IS NOT NULL))
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

CREATE TABLE IF NOT EXISTS organization_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_membership_id UUID REFERENCES organization_memberships(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (
    action IN ('organization.claimed', 'organization.member_added',
               'organization.member_joined', 'organization.pending_cancelled')
  ),
  detail JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (OCTET_LENGTH(detail::TEXT) <= 2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

The implementation may adjust exact constraint names, but it must preserve these invariants:

1. One organization per organization-managed access code.
2. Exactly one non-removed organizer per claimed organization.
3. A verified user and a normalized pending email can each appear in only one non-removed organization membership.
4. Organizer rows are always active and cannot be cancelled by organizer APIs.
5. Every active organization member has exactly one matching `access_code_redemptions` row for the organization's access code.
6. Every pending or active, non-removed membership consumes one seat.
7. `organization_audit_events.detail` never stores plaintext code, access token, raw email, Google token, or display name. Use IDs, counts, and result kind only.
8. Existing access-code rows and redemptions are not backfilled into organizations and gain no organizer authority.

### Capacity Definition

For a shared code:

```text
assigned_seats = COUNT(access_code_redemptions)
```

For an organization code:

```text
assigned_seats = COUNT(organization_memberships WHERE removed_at IS NULL)
```

All list/status responses use one projection:

```text
remainingSeats = max(0, maxUsers - assignedSeats)
isFull         = assignedSeats >= maxUsers
```

Never use a renderer count as authorization. Every claim/add/cancel transaction locks the `access_codes` row and recomputes the database count.

### Organization State

```text
unclaimed organization code
  ├─ paused → cannot claim
  └─ organizer redeem/admin grant
       └─ claimed: organizer membership + redemption + plan
            ├─ add any valid email → pending seat
            │     ├─ verified Google sign-in → active + redemption + plan
            │     └─ organizer cancel → removed, seat freed
            └─ assigned seats == max_users → full
```

Direct redemption behavior:

| Code mode/state | Redeemer | Result |
|---|---|---|
| `shared`, available | Any unlinked active user | Existing redemption behavior |
| `shared`, full/paused | Any new user | Existing 409 behavior |
| `organization`, unclaimed | Unlinked active user | Claim organization as organizer |
| `organization`, claimed | Organizer repeats same code | Idempotent 200 current status |
| `organization`, claimed | Active invited member repeats code | Idempotent 200 current status |
| `organization`, claimed | Any unassigned user | 409 `organization_managed_code` |

---

## API Contracts

Add strict Zod schemas in `src/shared/contracts.ts`; mirror the same JSON shapes from Node and Rust using camelCase.

### Organization Summary

```ts
const OrganizationRoleSchema = z.enum(['organizer', 'member']);

const OrganizationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  role: OrganizationRoleSchema,
  plan: PlanIdSchema,
  capacity: z.object({
    assignedSeats: z.number().int().nonnegative(),
    maxSeats: z.number().int().positive(),
    remainingSeats: z.number().int().nonnegative(),
    state: z.enum(['available', 'full']),
  }),
});
```

`GET /v1/organizations/me`

- Auth: valid opaque device session and active membership.
- Response: `{ organization: OrganizationSummary | null }`.
- Shared-code and Free users receive `organization: null`.
- Members may read their bounded summary; only organizers get the organizer navigation.

### Member List

```ts
const OrganizationMemberSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(320),
  name: z.string().min(1).max(255).nullable(),
  role: OrganizationRoleSchema,
  state: z.enum(['pending', 'active']),
  createdAt: z.string().datetime(),
  joinedAt: z.string().datetime().nullable(),
});
```

`GET /v1/organizations/me/members?limit=50&offset=0`

- Auth: current user must be the non-removed organizer of the organization.
- Response: `{ organization, items, page }`, ordered organizer first, then active/pending by creation time and membership UUID.
- Limits: `limit 1..100`, `offset 0..100000`.

### Add Member

`POST /v1/organizations/me/members`

```json
{ "email": "student@example.com" }
```

- Body must contain exactly one `email`; trim, validate, and normalize to lowercase server-side.
- Rate limit: 30 requests per organizer per 15 minutes and 120 per IP per 15 minutes.
- Lock order: read organizer authorization without taking a conflicting lock, then lock access code → matching membership/capacity rows. The add path never looks up or locks `users` by email.
- Existing matching membership: 200 and `{ newlyCreated: false }`.
- New pending membership: 201 and `{ newlyCreated: true, member, organization }`.
- The response's updated organization summary must already expose `capacity.state = 'full'` when this add filled the last seat.

Stable errors:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `invalid_request` | Body shape/email invalid |
| 403 | `organization_organizer_required` | Signed-in user is not organizer |
| 409 | `organization_capacity_reached` | No seat remains |
| 409 | `organization_code_paused` | Code is paused for new assignments |
| 409 | `email_already_assigned` | Pending/active email belongs to another organization |

### Cancel Pending Member

`DELETE /v1/organizations/me/members/{membershipId}`

- Auth: current organizer only; no organization ID comes from the renderer.
- Only `role = 'member'`, `user_id IS NULL`, `joined_at IS NULL`, and `removed_at IS NULL` may be cancelled.
- Return 200 `{ kind: 'cancelled', memberId, organization }`.
- Active/organizer rows return 409 `organization_member_active`; unknown/cross-organization UUIDs return 404.
- Repeat after cancellation returns 404; it must not decrement capacity twice.

### Platform Admin and Creation Contract

Extend code creation bodies and CLI inputs with:

```text
distributionMode = organization | shared
```

- Browser dashboard default: `organization`.
- Node CLI default: `organization`; `--distribution-mode shared` preserves shared issue behavior.
- Rust CLI default: `organization`; same explicit compatibility flag.
- Existing database rows remain shared because the migration default protects historical inserts.
- Admin list items add `distributionMode`, `claimState`, `organizer`, `assignedSeats`, `activeSeats`, and `pendingSeats`. Preserve legacy `redeemedUsers` for installed/internal consumers during the compatibility window.
- Admin direct grant to an unclaimed organization code claims the target as organizer. A claimed organization code is not selectable in the generic grant dialog.

---

## Entry Points, Data Flow, and State Changes

### Organizer Claim

```text
MembershipGate / Settings promo form
  → DesktopApi.activateMembership({code})
  → preload parses ActivateMembershipRequestSchema
  → trusted IPC sender + Google user
  → MembershipService POST /v1/access-code-redemptions
  → Node/Rust AccessCodeRepository transaction
      lock user
      detect no existing redemption
      lock access code
      validate organization mode, pause, and max_users >= 1
      create organization(name = code label || organizer name)
      create active organizer membership
      create access_code_redemption
      update users.plan
      append content-free organization.claimed audit event
      commit
  → active MembershipStatus
  → App refreshes /v1/organizations/me
  → Organization navigation appears
```

### Organizer Adds Email

```text
OrganizationPage exact email form
  → AddOrganizationMemberRequestSchema in preload and IPC
  → OrganizationClient POST /v1/organizations/me/members
  → backend verifies organizer from session user_id
  → transaction locks organization code and counts non-removed memberships
      existing same membership → idempotent response
      full/paused/conflicting membership → coded 409
      any valid unassigned email → pending membership only
  → updated summary/list
  → role=status success or role=alert full/error message
```

### Pending Member Auto-Join

```text
GoogleAuthService sends verified Google ID token
  → hosted API independently verifies signature/audience/issuer/email_verified
  → SessionRepository.issue transaction
      upsert users row
      reject blocked user
      locate a candidate pending membership by normalized verified email without locking
      lock organization access code, then refetch that membership FOR UPDATE
      prove seat still reserved and no conflicting redemption/user membership
      bind membership.user_id + joined_at
      insert access_code_redemption
      set users.plan from access code
      append organization.member_joined (IDs only)
      insert opaque device session
      commit
  → Electron stores opaque token
  → immediate membership refresh finds active redemption
  → user enters the workspace without code UI
```

### Contracts and Trust Boundaries

- PostgreSQL owns capacity, role, pending/active state, and plan linkage.
- Hosted APIs repeat session, role, code pause, user block, conflict, and capacity checks; renderer visibility never grants organizer permission.
- Shared Zod schemas parse renderer inputs before IPC and parse hosted outputs before returning them to React.
- The renderer never receives the organizer's plaintext code, a bearer token, raw IPC, platform admin token, or arbitrary organization ID authority.
- The verified Google email from the server-side token verifier is the only identity that may claim a pending email reservation. Organizer add never infers identity from an existing `users.email` row.
- Logs contain route/status/request ID only; organization audit events contain IDs/counts only.

---

## Unified Discovery Table

| Category | File:Lines | Existing Pattern | Application to This Feature |
|---|---|---|---|
| Current schema | `services/api/migrations/002_access_codes.sql:1-16` | `access_codes.max_users`; one redemption per user; indexed code usage | Keep redemptions for active entitlement; add separate pending/role tables |
| Plan source | `services/api/migrations/007_free_usage_plan.sql:9-19` | `users.plan` is synchronized from redeemed code | Auto-join and organizer add must update `users.plan` in the same transaction |
| Immutable history | `services/api/migrations/013_access_code_lifecycle.sql:19-20` | Pausing rejects new users while existing redemptions remain active | Pausing blocks claim/new reservations but not active members or already reserved pending claims |
| Login entry | `services/api/src/auth/sessions.rs:63-80`; `services/api/src/session-repository.mjs:18-56` | User upsert and opaque session creation share one transaction | Insert pending-email claim between user upsert and session insertion |
| Access claim | `services/api/src/auth/access_codes.rs:92-175`; `services/api/src/access-code-repository.mjs:123-224` | User and code rows lock before count/insert/plan update | Branch on `distribution_mode`; preserve shared branch and add atomic organizer claim |
| HTTP entry | `services/api/src/http/core.rs:168-223`; `services/api/src/server.mjs:447-542` | Session auth, bounded body, rate limits, explicit status mapping | Mirror for organization routes and stable coded conflicts |
| Error handling | `services/api/src/error.rs:27-89`; `services/api/src/admin-http-controller.mjs:123-207` | Public static/coded error; private source/log details withheld | Use stable organization codes and safe static messages |
| Logging | `services/api/src/http/middleware.rs:11-43`; `services/api/src/server.mjs:1007-1057` | Structured route/status/request timing; 5xx logged without body | Do not add email or code values to logs |
| Admin transaction | `services/api/src/http/admin.rs:590-678`; `services/api/src/admin-repository.mjs:428-521` | Platform grant locks user/code, checks pause/capacity, inserts redemption/plan/audit | Unclaimed organization grant becomes organizer claim; claimed org returns conflict |
| Admin UI | `services/api/public/admin.js:887-1014`; `services/api/public/admin.html:360-483` | Strict-CSP external JS, dialog errors, accessible toast, paginated code selection | Add distribution selector and organization member metadata without inline script |
| Shared contract | `src/shared/contracts.ts:2091-2118`; `src/shared/desktop-api.ts:77-159` | Zod request/response schemas and fixed narrow `DesktopApi` methods | Add exact organization schemas/channels; no generic request method |
| Preload boundary | `src/preload.ts:292-312` | Parse request, invoke exact channel, parse response | Mirror for get/list/add/cancel organization operations |
| IPC authorization | `src/main/ipc/register-ipc.ts:323-352` | Trusted main frame plus signed-in user before membership operation | Require signed-in and active membership before organizer client calls |
| Hosted client | `src/main/knowledge/knowledge-space-client.ts:63-118` | Fixed base URL, token provider, timeout, schema-parsed responses | New `OrganizationClient`; improve error parsing so coded 409 message reaches UI |
| Renderer load | `src/renderer/App.tsx:1293-1351` | Request-generation guard prevents stale membership response commits | Add organization refresh generation guard and clear state on sign-out |
| Navigation | `src/renderer/app-navigation.ts:5-15`; `src/renderer/App.tsx:2125-2205` | Closed `ActiveView` union and role/feature-conditional nav | Add `organization` view only when summary role is organizer |
| UI style | `src/renderer/SettingsPage.tsx:143-223`; `src/index.css:3851-3887` | Accessible card headings, form feedback with alert/status roles | Mirror cards, focusable form, capacity warning, responsive member list |
| Node test style | `services/api/test/access-code-repository.test.mjs:12-38,194-247` | Sequenced fake pool asserts lock/order/no write on conflict | Add organization repository/session/access tests with exact query ordering |
| Rust integration | `services/api/tests/http_compat.rs:156-190,577-683` | Disposable Postgres, router calls, exact status/body assertions | Exercise claim, organizer authorization, pending auto-join, full and legacy paths |
| Contract corpus | `services/api/tests/contract_corpus.rs:99-160` | Route/schema inventories are checked against embedded migrations | Add routes/tables/migration 021 and update counts |
| Rollback ownership | `services/api/README.md:1-15`; `docs/operations/rust-backend-cutover.md:19-25` | New behavior belongs in Rust, while JavaScript remains release oracle until approved cutover | Implement both backends and keep JSON/schema semantics identical |

---

## Mandatory Reading

Files that MUST be read before implementation:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `AGENTS.md` | all | Renderer sandbox, narrow DesktopApi, boundary parsing, required checks |
| P0 | `README.md` | 342-423 | Current hosted code, admin dashboard, Free onboarding, plan ownership, and legacy/offline behavior |
| P0 | `services/api/README.md` | all | Rust source-of-truth direction and JavaScript rollback oracle |
| P0 | `docs/architecture.md` | 112-170, 208-231, 250-260 | Trust boundaries, hosted identity, preload parsing, backend ownership |
| P0 | `docs/security.md` | 5-38, 188-205 | Google verification, membership boundary, and secret-handling requirements |
| P0 | `docs/operations/rust-backend-cutover.md` | all | Same-service migration/rollback constraints; no production action in implementation |
| P0 | `services/api/migrations/001_hosted_sessions.sql` | all | User/session foreign keys and timestamps |
| P0 | `services/api/migrations/002_access_codes.sql` | all | Current capacity and one-code-per-user invariants |
| P0 | `services/api/migrations/007_free_usage_plan.sql` | 1-19 | Plan constraints and redemption backfill |
| P0 | `services/api/migrations/011_admin_access_controls.sql` | all | Audit-event privacy and user blocking |
| P0 | `services/api/migrations/013_access_code_lifecycle.sql` | all | Pause semantics and forward-only constraint pattern |
| P0 | `services/api/src/auth/access_codes.rs` | all | Rust claim/status transaction to extend |
| P0 | `services/api/src/auth/sessions.rs` | all | Rust verified-user/session transaction for auto-join |
| P0 | `services/api/src/http/core.rs` | 30-49, 82-223 | Rust auth/access routes and rate-limit pattern |
| P0 | `services/api/src/http/admin.rs` | 34-262, 452-678 | Rust admin authorization, code inventory, create/grant transactions |
| P0 | `services/api/src/access-code-repository.mjs` | all | Production Node redemption/status release behavior |
| P0 | `services/api/src/session-repository.mjs` | all | Production Node account/session issuance transaction |
| P0 | `services/api/src/server.mjs` | 272-324, 390-542, 1006-1058 | Production route/session/error/logging behavior |
| P0 | `services/api/src/admin-repository.mjs` | 50-161, 428-521, 523-832 | Node admin projection/grant/inventory/create patterns |
| P1 | `services/api/public/admin.html` | 270-483 | Code creation, inventory, grant, and user dialogs |
| P1 | `services/api/public/admin.js` | 146-160, 382-592, 756-1014, 1032-1076 | Strict-CSP request/render/error patterns |
| P1 | `scripts/access-codes.mjs` | all | JavaScript operator CLI validation and insert pattern |
| P1 | `services/api/src/main.rs` | all | Rust CLI argument surface |
| P1 | `services/api/src/cli/mod.rs` | 1-68, 97-181 | Rust CLI validation/insert/tests |
| P1 | `src/shared/contracts.ts` | 1807-1841, 2091-2140, 2195-2220 | Plan/Auth/Membership schema placement and exports |
| P1 | `src/shared/desktop-api.ts` | 77-159 | IPC channel and DesktopApi method pattern |
| P1 | `src/main/membership/membership-service.ts` | 21-32, 133-348 | Hosted status/error parsing and automatic membership refresh |
| P1 | `src/main/knowledge/knowledge-space-client.ts` | 63-118 | Fixed hosted client and Zod response pattern |
| P1 | `src/main/ipc/register-ipc.ts` | 70-144, 205-230, 323-352, 756-760 | Service injection, trusted sender, registration/removal |
| P1 | `src/preload.ts` | 292-312 | Double-parse bridge pattern |
| P1 | `src/renderer/App.tsx` | 910-958, 1293-1417, 2027-2043, 2125-2205, 2318-2397 | Membership refresh, gate, navigation, view rendering |
| P1 | `src/renderer/SettingsPage.tsx` | 143-223 | Plan card and accessible async feedback pattern |
| P1 | `src/renderer/app-navigation.ts` | all | Closed navigation union/title mapping |
| P1 | `src/index.css` | 2521-2662, 3851-3887, 4593-4620, 5930-6108 | Sidebar, cards, responsive, reduced-motion patterns |
| P2 | `services/api/test/access-code-repository.test.mjs` | all | Row-lock and no-write-on-conflict unit tests |
| P2 | `services/api/test/session-repository.test.mjs` | all | Blocked-user/session transaction tests |
| P2 | `services/api/test/admin-repository.test.mjs` | 240-320, 508-687 | Grant and capacity/inventory unit tests |
| P2 | `services/api/test/server.test.mjs` | 61-128, 302-327, 433-567 | In-memory API test seam and access flow |
| P2 | `services/api/tests/http_compat.rs` | 38-190, 440-683, 1441-1492 | Rust router/Postgres parity and admin/access lifecycle |
| P2 | `services/api/test/migrate.test.mjs` | all | Migration count/order assertions |
| P2 | `services/api/tests/contract_corpus.rs` | 99-160 | Route family and migration/table inventory |
| P2 | `src/main/membership/membership-service.test.ts` | 114-243 | Hosted response/error client tests |
| P2 | `src/main/ipc/register-ipc.test.ts` | 1-180, 822-849 | Mocked IPC authorization/validation test style |
| P2 | `src/renderer/SettingsPage.test.ts` | 1-66, 210-end | Server-rendered React accessibility/markup tests |

## External Documentation

No external research needed — the repository already pins and demonstrates PostgreSQL row locking, Axum, Node `pg`, opaque sessions, Zod, Electron IPC, and React. Do not add an ORM, invitation service, email SDK, state-management library, or new authentication provider.

---

## Patterns to Mirror

### NAMING_CONVENTION

Source: `src/shared/contracts.ts:2104-2118`

```ts
export const MembershipStatusSchema = z.object({
  state: z.enum(['bypassed', 'inactive', 'active', 'expired', 'error']),
  required: z.boolean(),
  referenceCode: z
    .string()
    .regex(/^TRC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    .nullable(),
  expiresAt: z.string().datetime().nullable(),
  plan: PlanIdSchema.nullable().default(null),
  summary: z.string().min(1).max(1_000),
});
```

Use PascalCase `...Schema` exports, camelCase JSON, and inferred exported TypeScript types. Rust response structs use `#[serde(rename_all = "camelCase")]` when not using `serde_json::json!`.

### ERROR_HANDLING

Source: `services/api/src/error.rs:27-58`

```rust
pub const fn coded(status: StatusCode, code: &'static str, message: &'static str) -> Self {
    Self {
        status,
        code: Some(code),
        message,
        retry_after_seconds: None,
        source: None,
    }
}

pub fn internal(error: impl Into<anyhow::Error>) -> Self {
    Self {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        code: None,
        message: "An internal error occurred.",
        retry_after_seconds: None,
        source: Some(error.into()),
    }
}
```

Return stable public codes/messages for expected organizer conflicts. Keep SQL/provider/private details only in the error source and never include raw email/code/token in response or logs.

### LOGGING_PATTERN

Source: `services/api/src/http/middleware.rs:38-43`

```rust
let duration = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
if response.status().is_server_error() {
    tracing::error!(durationMs=duration,event="request.failed",method=%method,path=%path,requestId=%request_id,status=response.status().as_u16());
}
tracing::info!(durationMs=duration,event="request.completed",method=%method,path=%path,requestId=%request_id,status=response.status().as_u16());
```

Do not add organization-specific logs containing email, name, code, request body, or plaintext audit detail.

### TRANSACTION_AND_LOCK_PATTERN

Source: `services/api/src/auth/access_codes.rs:99-120,144-160`

```rust
let mut tx = self.pool.begin().await?;
let user = sqlx::query("SELECT blocked_at FROM users WHERE id=$1 FOR UPDATE")
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::internal(anyhow::anyhow!("Authenticated user is missing")))?;

let code = sqlx::query(
    "SELECT id,max_users,paused_at,plan FROM access_codes WHERE code_digest=$1 FOR UPDATE",
)
.bind(digest.to_vec())
.fetch_optional(&mut *tx)
.await?;

let redemption_count: i64 = sqlx::query_scalar(
    "SELECT COUNT(*)::bigint FROM access_code_redemptions WHERE access_code_id=$1",
)
.bind(id)
.fetch_one(&mut *tx)
.await?;
```

Use one global order wherever a transaction mutates an existing account: `users` row → `access_codes` row → `organization_memberships` row(s). Organizer add does not touch `users`, so it locks code → membership; pending cancellation does the same. Auto-join may read a candidate membership to discover the code ID, but after locking user → code it must refetch and lock the membership before changing it. Repeat authorization/state checks after the authoritative locks.

### HOSTED_CLIENT_PATTERN

Source: `src/main/knowledge/knowledge-space-client.ts:105-118`

```ts
private async request<T>(path: string, init: RequestInit, schema: z.ZodType<T>, authenticated = true): Promise<T> {
  const baseUrl = this.apiBaseUrl.trim().replace(/\/+$/u, '');
  if (!baseUrl) throw new Error('Knowledge Spaces require the hosted TroCode service.');
  const token = authenticated ? await this.accessTokenProvider() : null;
  if (authenticated && !token) throw new Error('Sign in to use Knowledge Spaces.');
  const response = await this.fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Knowledge Spaces returned HTTP ${response.status}.`);
  return schema.parse(await response.json());
}
```

Mirror fixed URLs/token provider/timeouts/schema parsing, but parse `{code?, error}` on non-2xx so the organizer sees the safe server message.

### IPC_BOUNDARY_PATTERN

Source: `src/main/ipc/register-ipc.ts:323-352`

```ts
ipcMain.handle(IPC_CHANNELS.getMembershipStatus, async (event) => {
  const user = await assertAuthorizedSender(
    event,
    mainWindow,
    services.authService,
  );
  return services.membershipService.getStatus(user);
});

ipcMain.handle(
  IPC_CHANNELS.activateMembership,
  async (event, input: unknown) => {
    const user = await assertAuthorizedSender(
      event,
      mainWindow,
      services.authService,
    );
    const request = ActivateMembershipRequestSchema.parse(input);
    return services.membershipService.activate(user, request.code);
  },
);
```

Each organization operation gets an exact channel, trusted sender check, repeated Zod parsing, and one specific client method. Do not expose a generic REST bridge.

### TEST_STRUCTURE

Source: `services/api/test/access-code-repository.test.mjs:12-38,194-223`

```js
function sequencedPool(responses) {
  const queries = [];
  const client = {
    query: async (sql, parameters = []) => {
      queries.push({ parameters, sql });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response ?? { rows: [] };
    },
    release: () => {
      client.released = true;
    },
    released: false,
  };
  return { client, pool: { connect: async () => client }, queries };
}

assert.match(queries[1].sql, /users WHERE id = \$1 FOR UPDATE/u);
assert.match(queries[3].sql, /access_codes[\s\S]+FOR UPDATE/u);
assert.equal(queries.at(-1).sql, 'COMMIT');
```

Unit tests must assert transaction ordering, rollback, no capacity write on conflicts, and client release—not only returned objects.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `services/api/migrations/021_organization_managed_access.sql` | CREATE | Distribution mode, organizations, memberships, partial uniqueness, audit events |
| `services/api/src/access-code-repository.mjs` | UPDATE | Branch shared vs organization claim; organization-aware assigned-seat status |
| `services/api/src/session-repository.mjs` | UPDATE | Claim one pending verified email atomically before session issuance |
| `services/api/src/organization-repository.mjs` | CREATE | Current organization, organizer authorization, list/add/cancel operations |
| `services/api/src/organization-http-controller.mjs` | CREATE | Exact Node organization routes, parsing, rate limits, status/error mapping |
| `services/api/src/server.mjs` | UPDATE | Delegate organization routes after browser-origin denial and before generic 404 |
| `services/api/src/main.mjs` | UPDATE | Compose/inject organization repository/controller and provisioning dependency |
| `services/api/src/admin-repository.mjs` | UPDATE | Distribution-aware create/list/grant/member projections |
| `services/api/src/admin-http-controller.mjs` | UPDATE | Parse `distributionMode` and expose new admin metadata/errors |
| `services/api/public/admin.html` | UPDATE | Default organization mode selector and organization seat/claim labels |
| `services/api/public/admin.js` | UPDATE | Render distribution/claim/member state and submit creation mode |
| `services/api/public/admin.css` | UPDATE | Responsive mode/organizer/pending member presentation |
| `scripts/access-codes.mjs` | UPDATE | `--distribution-mode` default/validation/insert/output |
| `scripts/access-codes.test.mjs` | UPDATE | CLI defaults, explicit shared mode, SQL parameter tests |
| `services/api/src/auth/access_codes.rs` | UPDATE | Rust organization claim and distribution-aware capacity/status |
| `services/api/src/auth/sessions.rs` | UPDATE | Rust pending-email auto-claim in session transaction |
| `services/api/src/auth/organizations.rs` | CREATE | Rust organization repository/service and response structs |
| `services/api/src/auth/mod.rs` | UPDATE | Export organization types/repository |
| `services/api/src/http/organization.rs` | CREATE | Rust summary/list/add/cancel route handler |
| `services/api/src/http/mod.rs` | UPDATE | Route organization requests after origin guard |
| `services/api/src/http/admin.rs` | UPDATE | Rust admin creation/list/grant parity for distribution mode |
| `services/api/src/app.rs` | UPDATE | Compose organization repository in `AppState` |
| `services/api/src/main.rs` | UPDATE | Rust CLI `--distribution-mode` |
| `services/api/src/cli/mod.rs` | UPDATE | Validate/store/output distribution mode |
| `services/api/test/organization-repository.test.mjs` | CREATE | Node unit tests for authorization, capacity, idempotency, add/cancel |
| `services/api/test/organization-http-controller.test.mjs` | CREATE | Node route auth/body/error/rate-limit tests |
| `services/api/test/access-code-repository.test.mjs` | UPDATE | Organizer claim, claimed-code denial, shared regression |
| `services/api/test/session-repository.test.mjs` | UPDATE | Pending email auto-join and conflict/rollback cases |
| `services/api/test/admin-repository.test.mjs` | UPDATE | Distribution-aware inventory/create/grant tests |
| `services/api/test/admin-http-controller.test.mjs` | UPDATE | Admin payload/HTML/JS organization-mode contract tests |
| `services/api/test/server.test.mjs` | UPDATE | Node end-to-end organization routes and no-code auto-join seam |
| `services/api/test/migrate.test.mjs` | UPDATE | Migration 021 count/order/idempotency |
| `services/api/tests/http_compat.rs` | UPDATE | Rust disposable-Postgres organization flow and JavaScript contract parity |
| `services/api/tests/postgres_compat.rs` | UPDATE | Migration/table counts for empty and Node-initialized database |
| `services/api/tests/contract_corpus.rs` | UPDATE | Embed migration 021 and validate schema inventory |
| `services/api/tests/fixtures/route_inventory.json` | UPDATE | Add four organization routes/family entries |
| `services/api/tests/fixtures/schema_inventory.json` | UPDATE | Migration count and three organization tables |
| `src/shared/contracts.ts` | UPDATE | Organization summary/member/request/response schemas and types |
| `src/shared/contracts.test.ts` | UPDATE | Strict shape, limits, invalid email/UUID/capacity tests |
| `src/shared/desktop-api.ts` | UPDATE | Four exact organization IPC channels/methods |
| `src/main/organization/organization-client.ts` | CREATE | Hosted bearer client with schema/error parsing |
| `src/main/organization/organization-client.test.ts` | CREATE | URL/token/body/timeout/error/response parsing tests |
| `src/main/ipc/register-ipc.ts` | UPDATE | Inject client and register/remove authorized handlers |
| `src/main/ipc/register-ipc.test.ts` | UPDATE | Sender auth, input parsing, forwarding, unregister tests |
| `src/index.ts` | UPDATE | Compose `OrganizationClient` and inject into IPC registration |
| `src/preload.ts` | UPDATE | Parse both sides of organization IPC calls |
| `src/renderer/OrganizationPage.tsx` | CREATE | Organizer capacity, add form, members, pending cancellation, warnings |
| `src/renderer/OrganizationPage.test.tsx` | CREATE | Static markup/accessibility/full/pending/error states |
| `src/renderer/app-navigation.ts` | UPDATE | Add `organization` view/title |
| `src/renderer/App.tsx` | UPDATE | Load/clear summary, role-gated nav, render page, refresh after claim/add |
| `src/renderer/app-language.ts` | UPDATE | English/Vietnamese organization labels and feedback strings |
| `src/index.css` | UPDATE | Responsive Organization page and capacity/member states |
| `README.md` | UPDATE | New flow, capacity semantics, CLI mode, legacy compatibility, no email sending |
| `docs/security.md` | UPDATE | Verified-email claim and organizer authorization trust boundary |
| `docs/testing/organization-managed-access.tdd.md` | CREATE | RED/GREEN evidence, journeys, guarantees, commands, known gaps |

`services/api/BUILD.bazel` already globs `migrations/*.sql`, and `services/api/build.rs` watches the migration directory; update them only if verification proves the new Rust modules are not captured by existing Bazel source globs. Do not touch `package-lock.json` because no package is added.

---

## Step-by-Step Tasks

### Task 1: Add the Forward-Only Organization Schema and Compatibility Inventories

- **ACTION**: Create migration 021 and update migration/schema/route contract inventories before application code.
- **IMPLEMENT**:
  - Add `access_codes.distribution_mode` with existing rows defaulting to `shared`.
  - Add `organizations`, `organization_memberships`, and `organization_audit_events` with the checks and partial unique indexes above.
  - Keep `access_code_redemptions.user_id` as the single active entitlement link.
  - Update Node migration count/order assertions from 18 to 19.
  - Add migration 021 to the Rust embedded contract corpus and update SQLx/domain table counts from 18/39 (or 40 with SQLx) to 19/42 (or 43 with SQLx), based on three new domain tables.
  - Add four organization routes to `route_inventory.json` under a new `organization` family and include that family in the contract-corpus expected set.
- **MIRROR**: Idempotent named-constraint expansion in `013_access_code_lifecycle.sql`; inventory updates in `contract_corpus.rs:133-160`.
- **IMPORTS**: None.
- **GOTCHA**: `ADD COLUMN ... DEFAULT 'shared'` must never reclassify legacy codes as organizations. Do not backfill organizations from old redemptions or grant organizer authority by migration.
- **VALIDATE**:
  - `node --test services/api/test/migrate.test.mjs`
  - `cargo test --manifest-path services/api/Cargo.toml --all-features --locked contract_corpus`
  - Inspect migration SQL for plaintext-code/email audit storage and destructive statements.

### Task 2: Implement Transactional Organization Domain Operations in the JavaScript Release Backend

- **ACTION**: Add the Node organization repository and extend access/session repositories.
- **IMPLEMENT**:
  - Add normalized-email helper (`trim().toLowerCase()`, strict max 320, syntactically valid email); keep original trimmed email for display.
  - In `PostgresAccessCodeRepository.redeem`, select `distribution_mode` under the existing code lock.
  - Preserve the current shared branch byte-for-byte in behavior.
  - For an unclaimed organization code, prove capacity, create organization, organizer membership, redemption, user plan, and sanitized audit event in one transaction.
  - For a claimed code, return idempotent active only for the organizer/already assigned member; return `organization_managed_code` for an unassigned bearer.
  - In `PostgresSessionRepository.issue`, after verified user upsert and block check, read a matching pending membership only to discover its code, lock the code, refetch the membership `FOR UPDATE`, prove no conflicting redemption/user membership, bind the user, add redemption and plan, append IDs-only audit, then create the session and commit.
  - Implement `currentForUser`, `listMembersForOrganizer`, `addMember`, and `cancelPendingMember` in `PostgresOrganizationRepository`.
  - `addMember` authorizes the organizer, locks the organization code, rechecks organizer/code state and capacity, and atomically creates a pending reservation. It must not query `users` by email or reveal whether that address is registered or blocked.
  - All return values use camelCase bounded projections and stable `kind` discriminants for the controller.
- **MIRROR**: `access-code-repository.mjs:123-224` and `admin-repository.mjs:428-521` transaction/rollback/release style.
- **IMPORTS**: `planFor` where plan validation is needed; no new package.
- **GOTCHA**:
  - Always use user → code → membership when a user row is involved; use code → membership for add/cancel, which never lock a user row.
  - Do not count `access_code_redemptions` for organization capacity; pending memberships would be missed.
  - Unexpected auto-join/database failures roll back the device session too. An expected conflict because the verified user already has another redemption/membership must leave the reservation pending and still issue the normal session with the user's existing access; never brick authentication and never overwrite an entitlement.
  - Catch PostgreSQL `23505` and translate the exact constraint into idempotent same-org or safe conflict; do not surface constraint names.
- **VALIDATE**:
  - `node --test services/api/test/access-code-repository.test.mjs services/api/test/session-repository.test.mjs services/api/test/organization-repository.test.mjs`
  - Assert SQL includes `FOR UPDATE`, last-seat count happens after lock, conflict paths contain no redemption/membership insert, and all clients release.

### Task 3: Expose Organizer APIs in the JavaScript Release Backend

- **ACTION**: Add an authenticated organization controller and route it through production Node composition.
- **IMPLEMENT**:
  - Match only the four routes defined in API Contracts.
  - Authenticate through `sessionRepository`, then require active access through `accessCodeRepository` before organizer operations.
  - Allow `GET /v1/organizations/me` for active member/organizer summaries; require organizer role for list/add/cancel.
  - Strictly parse body keys, UUID, email, limit, and offset; add organizer/IP rate limits on mutation.
  - Map repository discriminants to the stable status/error table above.
  - Delegate after the browser-origin guard so a malicious webpage cannot call the desktop bearer API, following Knowledge Space/controller ordering.
  - Compose repository/controller in `main.mjs` and extend server test seams without weakening existing tests.
- **MIRROR**: `KnowledgeSpaceHttpController` composition in `main.mjs:103-136`; `server.mjs:331-388`; `admin-http-controller.mjs` coded `HttpError` pattern.
- **IMPORTS**: Existing `HttpError`, `readJson`, `sendJson`, session/access/rate-limit dependencies.
- **GOTCHA**: Do not make organization routes browser-origin exceptions like `/v1/admin/*`; they are desktop APIs and must remain behind origin denial.
- **VALIDATE**:
  - `node --test services/api/test/organization-http-controller.test.mjs services/api/test/server.test.mjs`
  - Test unauthenticated 401, inactive 403, member 403, invalid 400, cross-org 404/409, last-seat 201+full, next add 409, and pending cancellation.

### Task 4: Implement Rust Backend Parity

- **ACTION**: Port the same schema semantics, transactions, routes, and responses into the Rust source of truth.
- **IMPLEMENT**:
  - Add `auth/organizations.rs` with serializable summary/member/page responses and repository methods equivalent to Node.
  - Extend `AccessCodeRepository` with `distribution_mode` and organization claim logic.
  - Extend `SessionRepository::issue` to perform pending verified-email claim inside its existing transaction.
  - Add `http/organization.rs`, route it after origin rejection, and register `OrganizationRepository` in `AppState`.
  - Use `ApiError::coded` with exactly the Node error codes/messages.
  - Update Rust admin inventory/create/grant paths and CLI distribution mode.
  - Keep JSON field names and 200/201/400/401/403/404/409 semantics byte-compatible where practical.
- **MIRROR**: `auth/access_codes.rs`, `http/admin.rs`, `http/knowledge.rs:82-200`, and `app.rs:35-91`.
- **IMPORTS**: Existing `serde`, `serde_json`, `sqlx`, `uuid`, `time`, `http`; no crate additions.
- **GOTCHA**:
  - New behavior belongs in Rust, but JavaScript remains the production rollback oracle until explicit cutover approval. Both implementations are required in the same change.
  - Avoid dynamic string errors containing email. `ApiError.message` is `&'static str` by design.
  - Do not hold a SQL transaction across any network request; Google verification completes before session issuance.
- **VALIDATE**:
  - `cargo fmt --manifest-path services/api/Cargo.toml --all -- --check`
  - `cargo clippy --manifest-path services/api/Cargo.toml --all-targets --all-features -- -D warnings`
  - `cargo test --manifest-path services/api/Cargo.toml --all-features --locked`

### Task 5: Extend Platform Admin and Operator Code Creation

- **ACTION**: Make organization-managed codes the visible/default creation flow without breaking shared codes.
- **IMPLEMENT**:
  - Extend dashboard bulk create validation/body/SQL/results with `distributionMode`.
  - Add an accessible selector with `Organization managed` default and `Shared code (legacy)` option plus concise explanatory text.
  - Extend access-code inventory with distribution, claim state, organizer, active/pending/assigned seat counts.
  - Change "Who's using it" details for organization codes to list organizer/member role and active/pending state; keep shared redemptions presentation.
  - Permit platform grant of only unclaimed organization codes; that grant claims organizer authority. Exclude claimed organization codes from generic grant options.
  - Update Node and Rust CLIs with default `organization` plus explicit `--distribution-mode shared`; print the chosen mode without exposing additional secrets.
  - Update admin audit detail with mode/count/max/plan only.
- **MIRROR**: Admin strict-CSP dialog/render flow in `admin.html:360-483` and `admin.js:887-1076`; CLI validation in `scripts/access-codes.mjs:29-115`.
- **IMPORTS**: No new dependency.
- **GOTCHA**:
  - Preserve retrievable encrypted code behavior in dashboard-created rows.
  - The legacy Node CLI currently inserts digest-only codes; do not accidentally claim encryption parity unless deliberately changing and testing that behavior. Distribution mode is orthogonal.
  - Shared-code admin totals and filters must not silently change meanings; add organization fields instead of removing `redeemedUsers` immediately.
- **VALIDATE**:
  - `node --test scripts/access-codes.test.mjs services/api/test/admin-repository.test.mjs services/api/test/admin-http-controller.test.mjs`
  - Static dashboard test asserts no inline script/token/email payload is embedded.
  - Manual dashboard check at desktop and narrow widths after implementation.

### Task 6: Add Shared Contracts, Hosted Client, Preload, and IPC

- **ACTION**: Add narrow typed desktop capabilities for organization management.
- **IMPLEMENT**:
  - Add strict schemas/types for summary, member, list, add request/response, and cancel request/response.
  - Add exact channels: `organization:get`, `organization:members:list`, `organization:members:add`, `organization:members:cancel`.
  - Implement `OrganizationClient` with fixed `/v1/organizations/me...` routes, opaque token provider, 10-second timeout for reads/mutations, safe error parsing, and Zod response parsing.
  - Compose it in `src/index.ts` and inject into `registerIpcHandlers`.
  - Each IPC handler checks the trusted main frame, authenticated user, and active membership, then reparses input before calling the client.
  - Preload parses input before invoke and parses response before exposing it through `window.tro`.
  - Register every new channel in the cleanup array so sign-out/reload tests do not leak handlers.
- **MIRROR**: Membership and Knowledge Space client/IPC/preload patterns cited above.
- **IMPORTS**: `zod` and shared contract exports already installed.
- **GOTCHA**: `getOrganization` may return null for Free/shared/member users; null is not an error. Offline builds should return a concise hosted-service-unavailable error and must not synthesize organizer authority.
- **VALIDATE**:
  - `npm exec -- vitest run src/shared/contracts.test.ts src/main/organization/organization-client.test.ts src/main/ipc/register-ipc.test.ts`
  - Confirm malformed email/UUID never reaches the client mock and untrusted renderer never reaches any organization method.

### Task 7: Build the Organizer Experience and Automatic Gate Bypass

- **ACTION**: Add role-gated Organization navigation/page and wire refresh behavior.
- **IMPLEMENT**:
  - Add `organization` to `ActiveView` and `NavigationIcon` union/title mapping.
  - After membership becomes active/bypassed, load current organization with a request-generation guard like membership refresh.
  - Clear organization state and leave the organization view on sign-out or when a newer response shows no organizer role.
  - Show Organization navigation only for `role === 'organizer'`; members receive the plan automatically but not management UI.
  - Create `OrganizationPage` with capacity summary/progress, email form, active/pending member rows, paginated load-more, pending cancel, loading/empty/error states, and focus restoration.
  - After add/cancel, use the response summary immediately and refresh member list. When the last seat is added, render a persistent `role="alert"` full-capacity message and disable the form.
  - Add English/Vietnamese translation keys; do not hardcode only-English control labels.
  - Ensure `activateMembership` refreshes organization state so a new organizer sees navigation without restart.
  - Auto-invited users need no new renderer branch: because hosted session issuance created their redemption before membership refresh, the existing `membershipAllowsAccess` path skips the code screen.
- **MIRROR**: `App.tsx:1293-1351` stale-request protection, `SettingsPage.tsx:143-223` feedback semantics, existing sidebar/navigation CSS.
- **IMPORTS**: Shared organization types, `translate`, `planTitle`; React hooks only.
- **GOTCHA**:
  - Do not render a management page based only on code plan or `maxUsers`; use server role.
  - Accessible alert text must not be the only capacity indicator; also expose assigned/max/remaining text and progress attributes.
  - Do not poll continuously. Refresh on page entry, successful mutation, window focus, and explicit retry.
- **VALIDATE**:
  - `npm exec -- vitest run src/renderer/OrganizationPage.test.tsx src/renderer/SettingsPage.test.ts src/renderer/membership.test.ts`
  - Manual: 960×680 minimum window, 1280 desktop, keyboard-only add/cancel, Vietnamese labels, screen-reader alert/status semantics.

### Task 8: Complete Cross-Backend, Concurrency, Security, and Regression Coverage

- **ACTION**: Add the matrix that proves the plan's invariants instead of only happy-path UI tests.
- **IMPLEMENT**:
  - Node unit/integration and Rust/Postgres tests for all cases in Testing Strategy.
  - Add a concurrent last-seat test using a disposable PostgreSQL database: two organizers requests racing for one remaining seat produce one success and one `organization_capacity_reached`, never 11/10.
  - Test same-email case normalization, repeated add idempotency, cross-org email conflict, existing Free upgrade on next sign-in, blocked-user sign-in denial without organizer enumeration, linked-user sign-in preserving existing access, pending cancellation, pause semantics, and active-member non-removal.
  - Test verified-email auto-join commits membership/redemption/plan/session together, rolls the unit back on unexpected database failures, and prechecks expected existing-entitlement conflicts so login still succeeds without a partial claim.
  - Test shared legacy redemption remains unchanged and migration does not create organizations for old rows.
  - Assert audit details and structured logs do not contain plaintext codes or email addresses.
  - Update Rust route/schema/postgres compatibility counts and JSON body parity.
- **MIRROR**: Existing ignored disposable PostgreSQL guard in `postgres_compat.rs:5-36`; never point destructive reset at a non-local or non-`_test` database.
- **IMPORTS**: Existing test dependencies only.
- **GOTCHA**: Do not fake the concurrency guarantee solely with sequenced unit mocks; at least one real PostgreSQL test must prove row-lock behavior.
- **VALIDATE**:
  - Focused Node, Vitest, and Rust commands below.
  - Optional ignored Postgres tests only with a validated local `_test` URL.

### Task 9: Documentation, Release Compatibility, and Final Gates

- **ACTION**: Document the new flow and run every repository-required gate without deploying.
- **IMPLEMENT**:
  - Update README creation examples, explain organizer seat counting, pending email auto-join, full warning, explicit shared compatibility, and hosted-only scope.
  - Update security docs with verified-email provisioning and server-side organizer authorization.
  - Add TDD evidence with RED/GREEN commands/results and known gaps.
  - Review `git diff` to ensure migration is forward-only, no secret/PII logging is added, and pre-existing user changes remain untouched.
  - Run `npm run check`, `npm run package`, and `npm run bazel:check` because Rust/migration/Bazel-owned backend behavior changed.
- **MIRROR**: `docs/testing/admin-dashboard.tdd.md` journey/guarantee/evidence structure and `docs/operations/rust-backend-cutover.md` no-deploy boundary.
- **IMPORTS**: None.
- **GOTCHA**: A passing implementation does not authorize production migration, Railway deploy, Rust cutover, or external messages. Hand those off as explicit operator steps.
- **VALIDATE**:
  - All commands in Validation Commands.
  - Manual acceptance checklist completed against a local/dev hosted API.

---

## Testing Strategy

### Unit and Integration Matrix

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Legacy migration | Existing shared code + redemptions before migration 021 | Mode is `shared`; no organization/membership created; users retain plan | Yes |
| Organization creation default | Admin/CLI omits mode | New row explicitly stores `organization` | No |
| Explicit shared creation | `--distribution-mode shared` | Existing share/redeem behavior | Regression |
| Organizer claim | Unclaimed org code, capacity 10 | Org + organizer membership + redemption + plan; assigned 1, remaining 9 | No |
| Organizer last seat | Capacity 1 | Organizer claim succeeds, state immediately full | Yes |
| Claimed code forwarding | Unassigned user enters claimed code | 409 `organization_managed_code`; no write | Security |
| Organizer repeat | Organizer enters same code again | 200 idempotent active | Retry |
| Add unknown email | Valid unregistered email | Pending membership, assigned count +1 | No |
| Add registered Free user | Existing unlinked Free account | Pending reservation; no account lookup or plan change yet | No |
| Registered Free user signs in | Pending reservation and verified matching email | Active member + redemption + plan update in session transaction | Yes |
| Pending auto-join | Verified Google email matches pending reservation | Membership active + redemption + plan + session in one commit | No |
| Email normalization | ` Student@Example.COM ` then `student@example.com` | One membership, idempotent second response | Edge |
| Cross-org pending conflict | Same normalized email added by second org | 409 `email_already_assigned` | Security |
| Existing linked user signs in | Pending reservation but user already redeemed another code | Session succeeds with existing access; reservation stays pending for organizer cancellation | Edge |
| Blocked user signs in | Pending reservation for a blocked account | Session remains denied; reservation stays pending and add never disclosed block state | Security |
| Member authorization | Active non-organizer calls list/add/cancel | 403 organizer required | Security |
| Cross-org UUID | Organizer cancels another org's pending ID | 404, no state leak | Security |
| Full capacity | assigned == max before add | 409 `organization_capacity_reached`; no insert | Edge |
| Concurrent last seat | Two adds when remaining = 1 | Exactly one 201, one 409; final count == max | Concurrency |
| Pause before claim | Paused unclaimed org code redeemed/granted | 409 paused; no organization | Edge |
| Pause after pending | Existing pending user signs in | Activates reserved seat; new organizer add remains blocked | Edge |
| Cancel pending | Pending non-organizer membership | removed once; assigned/remaining recomputed | No |
| Cancel active/organizer | Active member or organizer ID | 409; no entitlement removal | Security |
| Audit privacy | Claim/add/join/cancel | IDs/counts only; no email/name/code/token | Security |
| IPC invalid input | Malformed email/UUID or untrusted sender | Rejected before hosted client | Security |
| Renderer full state | 10/10 summary | Alert rendered, exact capacity text, add disabled | UX |
| Invited user entry gate | Auto-provisioned active status | Existing app entry resolves to workspace, not code gate | Regression |

### Edge Cases Checklist

- [ ] Empty/whitespace/malformed/over-320-character email
- [ ] Email case and surrounding whitespace
- [ ] Maximum capacity and capacity 1 (organizer-only organization)
- [ ] Pending plus active seats in the same capacity count
- [ ] Duplicate same-org request and network retry
- [ ] Concurrent last-seat requests
- [ ] Existing Free user, shared-code user, organization member, and blocked user
- [ ] Claimed, unclaimed, paused, full, and legacy shared code
- [ ] Pending user signs in while organizer page is open
- [ ] Unexpected database constraint failure rolls back session and entitlement together; expected existing-entitlement conflict preserves login and the pending reservation
- [ ] Permission denied for member/unrelated user/untrusted renderer
- [ ] Hosted API unavailable/timeout/malformed JSON
- [ ] Sign-out clears organization state and handlers
- [ ] English and Vietnamese presentation
- [ ] No email/code/token in logs, audit JSON, analytics, or renderer error internals

---

## Validation Commands

### Focused Desktop Contracts, Client, IPC, and Renderer

```bash
npm exec -- vitest run \
  src/shared/contracts.test.ts \
  src/main/membership/membership-service.test.ts \
  src/main/organization/organization-client.test.ts \
  src/main/ipc/register-ipc.test.ts \
  src/renderer/OrganizationPage.test.tsx \
  src/renderer/SettingsPage.test.ts \
  src/renderer/membership.test.ts
```

EXPECT: All focused tests pass; malformed boundary input never reaches a lower layer.

### Focused JavaScript API and CLI

```bash
node --test \
  scripts/access-codes.test.mjs \
  services/api/test/migrate.test.mjs \
  services/api/test/access-code-repository.test.mjs \
  services/api/test/session-repository.test.mjs \
  services/api/test/organization-repository.test.mjs \
  services/api/test/organization-http-controller.test.mjs \
  services/api/test/admin-repository.test.mjs \
  services/api/test/admin-http-controller.test.mjs \
  services/api/test/server.test.mjs
```

EXPECT: Node release-oracle behavior passes for organization and shared flows.

### Rust Static and Test Gates

```bash
npm run api:fmt
npm run api:lint
npm run api:test
npm run api:audit
npm run api:build
```

EXPECT: Rust formatting, Clippy, all tests, dependency audit, and release build pass.

### Optional Disposable PostgreSQL Concurrency/Compatibility

Run only against a local PostgreSQL 17 database whose name ends in `_test`; the test code must retain the existing destructive safety assertion.

```bash
TEST_DATABASE_URL=postgresql://127.0.0.1:5432/trocode_test \
  cargo test --manifest-path services/api/Cargo.toml --all-features --locked -- --ignored
```

EXPECT: Migration idempotency, Node-initialized compatibility, atomic auto-join, and concurrent last-seat tests pass. Never run this against production or a non-`_test` database.

### Repository Required Gates

```bash
npm run check
npm run package
npm run bazel:check
```

EXPECT: Zero lint/type/test/audit/build errors; Electron packaging succeeds; Rust Bazel CI targets pass.

### Manual Validation

- [ ] Platform admin creates one 3-seat organization code; dashboard shows unclaimed, organization mode, 0/3 assigned.
- [ ] Teacher signs in and redeems it; teacher enters app, sees Organization nav, and dashboard shows claimed 1/3.
- [ ] Teacher adds an existing Free user's email; that user refreshes/focuses and gets the organization plan without code entry.
- [ ] Teacher adds an email that has never signed in; row displays Pending and count becomes 3/3 with a full warning.
- [ ] A fourth add is disabled in UI and returns 409 if called directly.
- [ ] Pending user signs in with the exact verified Google email and lands in Tro without the code gate; organizer list changes Pending → Active without changing 3/3.
- [ ] A user who merely receives the already-claimed plaintext code cannot join unless their email was assigned.
- [ ] Organizer cancels a different pending reservation and one seat becomes available; active/organizer cancel remains forbidden.
- [ ] Shared legacy code still admits multiple direct redeemers to its current max.
- [ ] Pausing preserves active member access, blocks new adds, and preserves a previously reserved pending member's auto-join.
- [ ] Keyboard focus, `role=status`, `role=alert`, capacity text/progress, and Vietnamese labels are usable at 960×680 and 1280-wide layouts.
- [ ] Admin/organization API responses, logs, and audit rows contain no plaintext access code, bearer token, Google token, or email in audit detail.

---

## Acceptance Criteria

- [ ] A new organization-managed access code can be created with a plan and fixed capacity.
- [ ] Its first approved account becomes the sole organizer and consumes one seat.
- [ ] Organizer can add an existing or not-yet-registered verified Google email from the desktop app.
- [ ] A pending account automatically receives the organization's plan at sign-in without entering a code.
- [ ] Organizer, active members, and pending members all count toward capacity.
- [ ] Adding the final seat returns/renders full state; further adds fail atomically with `organization_capacity_reached`.
- [ ] Organizer may cancel a pending reservation; active/organizer removal is not possible in this phase.
- [ ] Claimed organization code cannot be forwarded to grant an unassigned user access.
- [ ] Existing shared codes, Free onboarding, provider access enforcement, block/pause behavior, and offline membership fallback do not regress.
- [ ] Node production backend and Rust candidate backend expose the same organization contract.
- [ ] Renderer remains sandboxed; all new inputs/outputs are schema-parsed through narrow DesktopApi functions.
- [ ] Tests cover authorization, conflicts, idempotency, concurrency, migration compatibility, and PII/secret handling.
- [ ] `npm run check`, `npm run package`, and `npm run bazel:check` pass.

## Completion Checklist

- [ ] All nine tasks completed in order
- [ ] Code follows discovered naming, error, transaction, logging, IPC, and test patterns
- [ ] Migration 021 is forward-only/re-runnable and leaves old rows shared
- [ ] No new dependency or lockfile edit
- [ ] No renderer/token/raw-IPC authority expansion
- [ ] No plaintext code or email in logs/audit detail
- [ ] Node/Rust response and error semantics match
- [ ] Capacity is computed from database state under a code-row lock
- [ ] Shared-code regression and invited-user no-code flow both pass
- [ ] README/security/TDD evidence updated
- [ ] No production deploy or migration performed without explicit approval
- [ ] `git diff` contains no unrelated pre-existing user changes
- [ ] Self-contained — implementation requires no additional codebase search or product decision

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Pending/active counts oversubscribe under concurrent adds | Medium | High | Lock code row, count non-removed memberships in transaction, prove with real Postgres race test |
| Session issued without entitlement after partial auto-join | Low | High | Upsert user, claim membership, add redemption/plan, and insert session in one transaction |
| Legacy users accidentally receive organizer authority | Low | High | Existing rows default shared; no organization backfill; organization creation only on explicit organization-mode claim |
| Same email invited to multiple orgs makes sign-in ambiguous | Medium | High | Global partial unique normalized email index and stable cross-org conflict |
| Email PII leaks through logs/audit | Medium | High | Route-level logs only; audit stores IDs/counts; tests scan detail/log payloads |
| Organizer forwards claimed code | Medium | Medium | Claimed org code rejects unassigned redeemers; member authority is email assignment |
| Typos permanently consume seats | Medium | Medium | Allow organizer to cancel pending-only memberships |
| Active member removal creates unclear entitlement downgrade | Medium | High | Explicitly out of scope; API rejects active/organizer cancellation |
| Node/Rust drift during migration window | Medium | High | Same route/schema fixtures, end-to-end tests in both backends, no Rust-only required schema |
| Existing admin filters/totals change meaning | Medium | Medium | Preserve legacy `redeemedUsers`; add assigned/active/pending fields and mode-aware labels |
| Google email change prevents pending claim | Low | Medium | Match exact currently verified email; show pending address to organizer; cancellation/re-add available |
| Organization feature appears in offline build | Low | Medium | Hosted client fails closed; role-gated nav requires server summary |

## Notes

- The feature is deliberately called **organization-managed access** rather than "invite codes" because the organizer's email assignment—not possession of a second token—is the authority.
- `organization_memberships.email` is account-provisioning data and must follow the same database/privacy handling as `users.email`. It may be shown only to the organization organizer and platform admin.
- Platform admin blocking continues to revoke sessions and deny new ones but does not free a licensed seat. Capacity and disciplinary access state remain separate.
- Current plan quotas remain per account even inside one organization; pooling usage or billing belongs in a later product decision.
- If future requirements need active-member removal, define explicit entitlement downgrade, session revocation, audit, data retention, and organizer-last-seat rules in a separate PRP.
