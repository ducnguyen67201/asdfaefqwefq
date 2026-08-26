# Plan: Organization Settings and Student Seat Onboarding

## Summary

Make organization access visible and understandable as an account setting instead of a hidden organizer-only Workspace item. Every user with an organization membership will be able to see which organization provides their Tro access; organization organizers will additionally be able to rename the organization, reserve seats by student email, inspect pending/active seats, and continue to the separate class-roster workflow.

The existing organization-managed access model remains authoritative: the first user who claims an organization code is the organizer, a reserved email automatically joins at the next verified Google sign-in, and no student code is required. This feature improves discovery and profile management without granting organization authority to every Teacher or merging organization seats with Class workspace membership.

## User Story

As a Teacher who claimed an organization access code, I want a clear Organization settings area where I can name my organization and reserve student seats by email, so that students receive access when they sign in and never need to enter my code.

As an invited organization member, I want to see which organization manages my Tro access, so that my plan status is understandable without exposing organizer controls or the member roster.

## Problem → Solution

The current app places **Organization** among Workspace tools and renders the navigation item only for `role: organizer`; ordinary members see no organization identity, Settings only says that a promo code is active, and the organization name is silently derived from the access-code label or organizer name with no edit path. → Treat Organization as account/settings information, expose a read-only summary to every organization member, retain organizer-only mutations, add an audited rename operation, clarify code-free student sign-in, and link organization seat assignment to the separate Class workspace roster step.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 32
- **Feature Input**: Standalone request to improve organization discoverability, organization naming, and Teacher-managed student onboarding

---

## Product Decisions and Permission Model

These decisions are requirements, not implementation suggestions:

1. **Organization visibility is membership-based, not Teacher-role-based.** `organization !== null` controls visibility. The classroom `teacher | student | unassigned` role remains a separate eligibility boundary and must not grant organization authority.
2. **Organization mutations remain organizer-only.** Only the user who claimed or was granted the organization-managed access code may rename the organization, list the roster, reserve seats, or cancel pending reservations. Renderer visibility is never authorization; the hosted API repeats the role check.
3. **Members receive a read-only organization view.** They may see organization name, plan, their `Member` role, and bounded seat capacity already present in `OrganizationSummary`; they may not list identities or see management forms.
4. **“Invite” means reserve access, not send email.** No email is dispatched. UI copy must state: the student signs in with the exact Google email, joins automatically, and does not enter the organizer's code.
5. **Organization access does not enroll a class.** Reserving a seat grants plan access. A registered account with an administrator-assigned Student role must still be added to a specific class from **Class workspaces → class → People**.
6. **The organization name is editable.** The initial code label/organizer-name fallback remains unchanged. The organizer may later save a trimmed name of 1–100 characters through a narrow `PATCH /v1/organizations/me` operation.
7. **Rename events are auditable without storing names.** Add `organization.profile_updated`; its audit detail is `{}` (or bounded non-content metadata only). Never place old/new names, emails, access codes, or tokens in audit details or request logs.
8. **The existing seat lifecycle is unchanged.** Pending and active memberships consume capacity; only pending reservations may be cancelled; active-member removal, organizer transfer, and capacity editing remain out of scope.

---

## UX Design

### Before

```text
┌─ Sidebar / Workspace ──────────┐     ┌─ Settings ───────────────┐
│ Agent                            │     │ Promo code                   │
│ History                          │     │ Tro Basic                    │
│ Insights                         │     │ "Your promo code is active"  │
│ Organization  [organizer only]   │     │                              │
└──────────────────────────────────┘     │ No organization identity     │
                                     │ or route from Settings        │
Member account: no Organization UI  └─────────────────────────────┘
```

### After

```text
┌─ Sidebar / Account ──────────────┐     ┌─ Settings / Plan access ────────┐
│ Organization settings [any member] │     │ Managed by Greenfield School       │
│ Settings                           │     │ Pro · Organizer · 8/30 seats    │
└────────────────────────────────────┘     │ [Open organization settings]       │
                                       └─────────────────────────────────────┘

┌─ Organization settings / Organizer ─────────────────────┐
│ Organization name                                                       │
│ [ Greenfield School________________ ] [Save name]                       │
│ Pro plan                         8 of 30 seats assigned                 │
│                                                                         │
│ Invite a student or staff member                                        │
│ [ student@example.com____________ ] [Reserve seat]                     │
│ They sign in with this Google email. No code or invitation email.       │
│                                                                         │
│ Pending and active organization seats                                   │
│ [Open Class workspaces] Add active students to a specific class there.  │
└───────────────────────────────────────────────────────────────────┘

┌─ Organization settings / Member ───────────────────────┐
│ Greenfield School · Pro · Member                                       │
│ Your access is managed by this organization.                               │
│ No name editor, seat form, member identities, or cancellation controls.    │
└──────────────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Sidebar placement | Organization is a Workspace item and organizers only | Organization settings sits with the bottom account/settings navigation for any organization member | Keep `activeView: 'organization'`; change placement and visibility only |
| Settings plan card | Active paid plan says only that the promo code is active | Organization members see organization name, plan, role, capacity, and an Open settings action | Shared-code users continue to see only plan access |
| Organization identity | Initial name derives from access-code label or organizer name and cannot change | Organizer can edit and save a 1–100-character organization name | Member sees the saved name read-only |
| Student onboarding | Form says “Add a person by email”; code-free behavior is easy to miss | Heading explains student/staff seat reservation, exact verified email, automatic join, no code, and no sent email | Continue accepting one address per request |
| Member experience | Members receive `OrganizationSummary` but are redirected away from the page | Members may open a read-only organization view | Never call organizer-only list endpoint for a member |
| Class enrollment | Organization and class membership relationship is undocumented in the flow | Organization page includes a Class workspaces action and explicit “seat is not class enrollment” copy | Do not automatically mutate a class |
| Code claim | Organization appears only after the background refresh and is easy to miss | Successful organization-code claim refreshes organization state and opens Organization settings when the response identifies an organization | A shared code continues to return `organization: null` and stays in Settings/current flow |
| Loading/error | Organization errors are only visible after reaching an organizer-only route | Settings card can show bounded load/error state and retry; full page retains its alert | Do not leak hosted error internals |

---

## Strategic Design

### Approach

Extend the existing organization vertical slice rather than creating a second settings store or classroom-specific organization model:

1. Add one hosted organizer-only profile mutation for the organization name.
2. Carry that mutation through the established strict Zod → `DesktopApi` → preload → trusted IPC → authenticated hosted-client path.
3. Reposition the existing `OrganizationPage` as a settings-level destination and make it role-aware.
4. Add a compact organization summary/route from `SettingsPage`.
5. Preserve the existing PostgreSQL-owned seat reservation and verified-email auto-join behavior.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Show Organization to every Teacher | Reject | Classroom role does not prove organization membership or organizer authority; it would expose a dead or misleading control |
| Merge Organization into Class workspaces | Reject | Organization is plan/licensing authority; a Class workspace is educational content and roster authority |
| Put the complete roster directly inside `SettingsPage` | Reject | It would duplicate `OrganizationPage` state, pagination, alerts, and controls; use a Settings summary plus the dedicated settings destination |
| Keep organizer-only navigation and only change copy | Reject | It does not solve member visibility or the discoverability problem shown in the screenshot |
| Let the renderer update the name locally | Reject | Organization profile is hosted shared state and must be server-authorized, persisted, and audited |
| Email students | Defer | There is no mail provider, consent/delivery policy, bounce path, or template system; reservation plus verified sign-in already fulfills no-code onboarding |
| Assign Student role while reserving an organization seat | Reject | Only the platform admin currently assigns classroom eligibility; coupling would cross an authorization boundary |
| Add active-member removal or organizer transfer | Defer | Entitlement revocation and ownership transfer require separate lifecycle/product decisions |

### Scope

- Settings-level discoverability for current organization members.
- Read-only organization summary for `role: member`.
- Existing roster/list/add/cancel controls for `role: organizer` only.
- Editable organization name with strict validation, server authorization, rate limiting, persistence, and content-free audit record.
- Explicit code-free verified-email onboarding copy.
- Explicit navigation to Class workspaces for the separate class-roster step.
- English and Vietnamese copy, responsive styling, contract/client/IPC/UI/API/migration tests, and documentation.

### NOT Building

- No email, SMS, magic link, QR code, or notification delivery.
- No automatic classroom-role assignment and no organization-to-class roster synchronization.
- No active-member removal, plan downgrade, seat transfer, organizer transfer, second organizer, or capacity editing.
- No multiple organizations per user, departments, school hierarchy, or organization switching.
- No exposure of member identities to `role: member`.
- No plaintext access code display or forwarding.
- No organization ID accepted from the renderer; all hosted routes resolve `/me` from the authenticated session.
- No new dependency or external service.
- No production migration execution, deployment, push, or third-party change as part of implementation.

---

## API and Data Contract

### New profile mutation

```http
PATCH /v1/organizations/me
Authorization: Bearer <opaque device session>
Content-Type: application/json

{"name":"Greenfield School"}
```

Success:

```json
{
  "organization": {
    "capacity": {
      "assignedSeats": 8,
      "maxSeats": 30,
      "remainingSeats": 22,
      "state": "available"
    },
    "id": "<uuid>",
    "name": "Greenfield School",
    "plan": "pro",
    "role": "organizer"
  }
}
```

Rules:

- Body must be an object with exactly one `name` field.
- Trim leading/trailing whitespace before validation and storage.
- Name must contain 1–100 characters after trimming; reject empty, overlong, non-string, or extra-field bodies with `400 invalid_request`.
- Resolve the organization from the authenticated current membership; do not accept `organizationId`.
- Require a non-removed `organizer` membership; otherwise return `403 organization_organizer_required`.
- Rate-limit profile mutations with separate `organization.profile.user` and `organization.profile.ip` scopes; do not place body values in rate-limit keys or logs.
- Update `organizations.name` and `organizations.updated_at` atomically.
- Insert `organization.profile_updated` in the same transaction with `{}` detail.
- Return the fresh `OrganizationSummary` from the committed state.
- Re-saving the same normalized name may return `200` and still be treated as idempotent; the UI disables unchanged saves to avoid unnecessary events.

Stable error surface:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `invalid_request` | Missing, empty, too-long, wrong-type, or extra-field body |
| 403 | `organization_organizer_required` | Current user is not the organizer |
| 429 | `rate_limited` | Profile mutation budget exhausted |
| 500 | omitted | Safe generic internal error; private source stays server-side |

### Shared TypeScript contracts

Add beside the current organization schemas:

```ts
export const UpdateOrganizationRequestSchema = z
  .object({ name: z.string().trim().min(1).max(100) })
  .strict();

export const UpdateOrganizationResponseSchema = z
  .object({ organization: OrganizationSummarySchema })
  .strict();
```

Export the inferred request/response types and add one exact desktop method:

```ts
updateOrganization(
  request: UpdateOrganizationRequest,
): Promise<UpdateOrganizationResponse>;
```

Add a fixed `organization:update` IPC channel. Parse the request in preload and IPC, and parse the response in preload and `OrganizationClient`; do not add a generic REST/IPC bridge.

### Migration 022

Create `services/api/migrations/022_organization_profile_settings.sql`. Do not edit migration 021. The migration changes only the audit action constraint so rename events are accepted:

```sql
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
```

The migration must be forward-only and re-runnable. Embed it as version 22 in `services/api/src/db.rs`, increment fixture migration counts, and include it in migration parity tests. Table counts do not change.

---

## Entry Points, Data Flow, State Changes, and Trust Boundaries

### Organization discovery

```text
App receives an active MembershipStatus
  → window.tro.getOrganization()
  → preload invokes fixed organization:get channel
  → IPC verifies trusted sender + active membership
  → OrganizationClient GET /v1/organizations/me with opaque token
  → hosted session identifies the current membership
  → strict OrganizationCurrentResponseSchema parse
  → App stores OrganizationSummary | null
      null                → no organization navigation/card
      role: member        → Settings summary + read-only Organization settings
      role: organizer     → Settings summary + full Organization settings
```

### Organization rename

```text
Organizer edits local name draft and presses Save name
  → UpdateOrganizationRequestSchema trims/rejects invalid input
  → fixed organization:update IPC
  → trusted sender + active membership check
  → OrganizationClient PATCH /v1/organizations/me
  → Rust route validates exact JSON and applies profile rate limit
  → OrganizationRepository transaction
      resolve current membership from session user ID
      require role = organizer
      update organizations.name + updated_at
      append organization.profile_updated with no name content
      commit
  → parse UpdateOrganizationResponseSchema
  → App replaces the shared OrganizationSummary
  → Organization page and Settings card show the saved name
```

### Student seat reservation (existing behavior, clarified UX)

```text
Organizer enters exact student Google email
  → existing addOrganizationMember({email}) path
  → server creates or returns one pending organization membership
  → pending seat consumes capacity

Student later signs in with that verified Google email
  → existing session transaction claims pending membership
  → creates redemption + updates plan + joins organization
  → no access code entry and no invitation email

Teacher later opens Class workspaces → class → People
  → adds the registered Student account to that class
  → separate classroom authorization remains intact
```

### State ownership

| State | Owner | Mutation path |
|---|---|---|
| Organization name | PostgreSQL `organizations.name` | New organizer-only PATCH transaction |
| Organization role | PostgreSQL `organization_memberships.role` | Existing claim/admin-grant lifecycle only |
| Seat capacity | PostgreSQL access code + non-removed memberships | Existing add/cancel/session transactions |
| Organization renderer summary | `App.tsx` React state | GET refresh and schema-parsed mutation responses |
| Name input/notice/loading | `OrganizationPage.tsx` local React state | Local edit plus one server request |
| Classroom role | PostgreSQL `users.classroom_role` | Existing admin-only workflow; unchanged |
| Class membership | PostgreSQL Knowledge Space membership | Existing Class People workflow; unchanged |

### Trust boundaries

- The renderer never receives bearer tokens, raw IPC, plaintext organization codes, platform-admin authority, or arbitrary organization IDs.
- The API, not UI visibility, enforces organizer-only list/add/cancel/rename operations.
- A read-only organization member never calls `GET /v1/organizations/me/members` and never receives other members' names/emails.
- Names and emails never enter request logs. Rename audit events contain no old/new name.
- The existing server-verified Google email remains the only authority that can claim a pending seat.

---

## Unified Discovery Table

| Category | File:Lines | Existing Pattern | Application |
|---|---|---|---|
| Similar implementation | `src/renderer/OrganizationPage.tsx:21-186` | Page owns member loading, mutation loading, notices, and safe errors | Extend this page with profile draft/save and member read-only branch; do not duplicate the roster in Settings |
| Settings composition | `src/renderer/SettingsPage.tsx:124-204` | Accessible cards use eyebrow, heading, badge, help, status/alert, and actions | Add a compact organization card immediately after Plan access |
| Navigation naming | `src/renderer/app-navigation.ts:5-23` | Closed `ActiveView` union with translated title metadata | Keep `organization`; change title to settings vocabulary and move its button to `sidebar-bottom` |
| Current visibility | `src/renderer/App.tsx:2161-2177` | Navigation checks `organization?.role === 'organizer'` | Replace with `organization !== null` and use a tested pure availability helper |
| Current member redirect | `src/renderer/App.tsx:1399-1403` | Non-organizers are redirected from Organization | Redirect only when current organization is null; permit `role: member` read-only view |
| Refresh/stale guard | `src/renderer/App.tsx:1336-1357` | Monotonic request ID prevents stale organization refresh commits | Preserve this for settings summary and claim follow-up refresh |
| Organization types | `src/shared/contracts.ts:2212-2294` | Strict Zod objects, bounded strings/numbers, inferred types | Add strict update request/response beside existing organization contracts |
| Narrow desktop API | `src/shared/desktop-api.ts:125-128,209-218` | Fixed channels and explicit methods for get/list/add/cancel | Add only `organization:update` and `updateOrganization` |
| Preload boundary | `src/preload.ts:403-435` | Parse input, invoke exact channel, parse response | Mirror for organization update |
| IPC authorization | `src/main/ipc/register-ipc.ts:384-416` | Every organization operation requires trusted sender and active membership | Parse rename input and call client only after the same authorization check |
| Hosted client | `src/main/organization/organization-client.ts:30-76` | Fixed `/me` routes, `json()` helper, typed response schemas | Add `update(input)` using PATCH and response parse |
| Hosted client errors | `src/main/organization/organization-client.ts:78-104` | Safe hosted error schema or bounded HTTP fallback | Reuse without special renderer parsing |
| Rust HTTP routing | `services/api/src/http/organization.rs:79-162` | Authenticate, require active access, exact method/path branches, bounded JSON | Add PATCH branch before members routes; exact one-key body validation |
| Rust authorization | `services/api/src/auth/organizations.rs:151-168,187-212` | Resolve current membership from session user ID and filter organizer role | Reuse for rename; never accept org ID from the client |
| Repository transaction | `services/api/src/auth/organizations.rs:199-289` | PostgreSQL transaction, safe coded conflicts, audit insert, commit, typed summary | Rename organization and append audit event in one transaction |
| Error handling | `services/api/src/error.rs:27-88` | `ApiError::coded` exposes static safe messages; internal source stays private | Use `invalid_request`, `organization_organizer_required`, and `rate_limited` |
| Logging | `services/api/src/http/middleware.rs:11-43` | Structured method/path/status/request-ID/timing only | Do not add request body, email, or organization name fields |
| Rate limiting | `services/api/src/http/organization.rs:58-76` | Per-user and per-IP 15-minute mutation scopes | Add separate profile scopes; retain existing member scopes |
| Initial name | `services/api/src/auth/access_codes.rs:180-193` | Code label, otherwise user name, bounded to 100 characters | Keep claim behavior; allow correction after claim via settings |
| Audit constraint | `services/api/migrations/021_organization_managed_access.sql:59-75` | Allowlisted organization actions and bounded JSON detail | Migration 022 adds only `organization.profile_updated` |
| Migration registry | `services/api/src/db.rs:11-120` | Explicit ordered embedded SQL migration list | Append version 22; never edit version 21 |
| Route fixture | `services/api/tests/fixtures/route_inventory.json` | Canonical method/path/family inventory | Add `PATCH /v1/organizations/me` |
| Schema fixture | `services/api/tests/fixtures/schema_inventory.json` | Migration/table count corpus | Increment migration count to 22; table count stays 48 |
| Rust HTTP test | `services/api/tests/http_compat.rs:641-745` | Real router exercises claim, reservation, full state, auto-join, and active protection | Add rename success, invalid body, member read, and member-forbidden rename |
| Rust repository test | `services/api/tests/organization_managed_access.rs:89-195` | Disposable DB test with strict local `_test` guard and cleanup | Verify rename persistence/audit and role denial in PostgreSQL-backed test |
| Renderer test | `src/renderer/OrganizationPage.test.tsx:48-102` | Static markup tests accessibility, capacity, localization, and empty states | Add organizer editor/copy and member read-only/no-controls cases |
| Settings test | `src/renderer/SettingsPage.test.ts:178-191` | Static markup asserts plan card behavior | Add org summary/action for organizer/member and absence for null |
| Localization | `src/renderer/app-language.ts:582-624` | English keys map to Vietnamese copy | Add every new organization/settings phrase and interpolation |
| Styling | `src/index.css:3971-4260,4262-4437` | Existing responsive organization panels and settings cards | Reuse classes; add profile form, read-only summary, Settings org card, mobile stacking |
| Classroom boundary | `docs/knowledge-spaces.md:7-30`; `src/renderer/SpaceDetailPage.tsx:488-604` | Admin assigns account role; Teacher adds registered accounts from People | Link to existing surface; do not combine APIs |
| Configuration | `README.md:286-302`; `src/renderer/App.tsx:1370-1397` | Organization management requires hosted active membership; no separate feature flag | No new environment variable or feature flag |
| Dependencies | `package.json` | React 19, Zod 4, Vitest 4, Axum/SQLx already support all work | Add no package or crate |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `AGENTS.md` | all | Renderer sandbox, strict contract boundary, test, package, and Bazel requirements |
| P0 | `src/renderer/App.tsx` | 932-957, 1336-1403, 1423-1437, 2060-2230, 2329-2385 | Organization state lifecycle, code activation, navigation, and page composition |
| P0 | `src/renderer/OrganizationPage.tsx` | all | Existing organizer UI, member requests, stale-response guard, notices, and role assumptions |
| P0 | `services/api/src/auth/organizations.rs` | all | Organization projection, server role checks, transactions, capacity, and audit patterns |
| P0 | `services/api/src/http/organization.rs` | all | Authenticated route dispatch, exact JSON parsing, rate limiting, and errors |
| P0 | `src/shared/contracts.ts` | 2212-2294, 2377-2398 | Strict organization schemas and exported inferred types |
| P0 | `src/shared/desktop-api.ts` | 125-128, 209-218 | Fixed channel and narrow bridge contract |
| P1 | `src/renderer/SettingsPage.tsx` | all | Settings card structure and prop pattern |
| P1 | `src/preload.ts` | 403-435 | Boundary request/response parsing |
| P1 | `src/main/ipc/register-ipc.ts` | 384-416 | Trusted sender and active membership checks |
| P1 | `src/main/organization/organization-client.ts` | all | Hosted request, timeout, safe error, and schema parsing |
| P1 | `services/api/migrations/021_organization_managed_access.sql` | 12-79 | Existing organization schema and audit constraint |
| P1 | `services/api/src/db.rs` | 11-120 | Migration embedding order |
| P1 | `services/api/src/auth/access_codes.rs` | 178-209 | Initial organization naming and claimed audit event |
| P1 | `src/renderer/SpaceDetailPage.tsx` | 488-604 | Separate Teacher-managed class roster destination |
| P1 | `docs/knowledge-spaces.md` | 7-33 | Classroom permission boundary and existing People semantics |
| P1 | `docs/security.md` | 41-61, 124-133 | Organization and classroom privacy guarantees |
| P2 | `src/renderer/OrganizationPage.test.tsx` | all | Renderer organization test style |
| P2 | `src/renderer/SettingsPage.test.ts` | all | Settings static-render test fixtures |
| P2 | `src/main/organization/organization-client.test.ts` | all | Hosted client request/response/error assertions |
| P2 | `src/main/ipc/register-ipc.test.ts` | 913-981 | IPC contract and authorization assertions |
| P2 | `src/shared/contracts.test.ts` | 41-93 | Strict organization contract tests |
| P2 | `services/api/tests/http_compat.rs` | 641-745 | End-to-end hosted organization flow |
| P2 | `services/api/tests/organization_managed_access.rs` | all | Policy and PostgreSQL concurrency/invariant test style |
| P2 | `services/api/tests/contract_corpus.rs` | 99-168 | Route and migration fixture expectations |
| P2 | `services/api/tests/postgres_compat.rs` | 43-132 | Migration adoption/count parity |
| P2 | `src/index.css` | 3971-4437, 5700-5760 | Organization/settings visual and responsive patterns |
| P2 | `.claude/PRPs/plans/completed/organization-managed-access-codes.plan.md` | 46-59, 136-187, 340-409, 440-487 | Original invariants and explicitly deferred rename behavior now brought into scope |

## External Documentation

No external research needed — this feature uses established internal React, Zod, Electron IPC, Axum, SQLx, PostgreSQL migration, Vitest, and Cargo patterns with no new dependency or unfamiliar API.

---

## Patterns to Mirror

### NAMING_CONVENTION

Source: `src/shared/contracts.ts:2272-2294`

```ts
export const AddOrganizationMemberRequestSchema = z
  .object({ email: z.string().trim().email().max(320) })
  .strict();

export const CancelOrganizationMemberResponseSchema = z
  .object({
    kind: z.literal('cancelled'),
    memberId: z.string().uuid(),
    organization: OrganizationSummarySchema,
  })
  .strict();
```

Use PascalCase schema/type exports, camelCase payload fields, verb-first desktop methods, and `.strict()` for organization boundary objects.

### ERROR_HANDLING

Source: `src/main/organization/organization-client.ts:94-103`

```ts
const body: unknown = await response.json().catch(() => null);
if (!response.ok) {
  const error = HostedErrorSchema.safeParse(body);
  throw new Error(
    error.success
      ? error.data.error
      : `Organization service returned HTTP ${response.status}.`,
  );
}
return schema.parse(body);
```

Source: `services/api/src/auth/organizations.rs:204-211`

```rust
return Err(ApiError::coded(
    StatusCode::FORBIDDEN,
    "organization_organizer_required",
    "Organization organizer access is required.",
));
```

Keep public messages static and safe. Surface known hosted messages through the client; do not return query errors or body contents.

### LOGGING_PATTERN

Source: `services/api/src/http/middleware.rs:38-43`

```rust
if response.status().is_server_error() {
    tracing::error!(durationMs=duration,event="request.failed",method=%method,path=%path,requestId=%request_id,status=response.status().as_u16());
}
tracing::info!(durationMs=duration,event="request.completed",method=%method,path=%path,requestId=%request_id,status=response.status().as_u16());
```

No feature-specific log statement is required. Audit the rename in PostgreSQL; retain request metadata-only operational logs.

### REPOSITORY_PATTERN

Source: `services/api/src/auth/organizations.rs:199-212,280-288`

```rust
let mut tx = self.pool.begin().await?;
let current = sqlx::query(CURRENT_MEMBERSHIP)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;
let Some(current) = current.filter(|row| row.get::<String, _>("role") == "organizer")
else {
    tx.rollback().await?;
    return Err(ApiError::coded(
        StatusCode::FORBIDDEN,
        "organization_organizer_required",
        "Organization organizer access is required.",
    ));
};
sqlx::query("INSERT INTO organization_audit_events(organization_id,actor_user_id,target_membership_id,action,detail)VALUES($1,$2,$3,'organization.member_added',$4)")
    .bind(organization_id).bind(user_id).bind(inserted.get::<Uuid,_>("id"))
    .bind(serde_json::json!({"assignedSeats":assigned+1,"maxSeats":max_users})).execute(&mut *tx).await?;
tx.commit().await?;
Ok(AddOrganizationMember {
    member: member(&inserted),
    newly_created: true,
    organization: summary(&current, Some(assigned + 1)),
})
```

Resolve authority from the session user, mutate and audit in one transaction, and return a fresh typed projection.

### SERVICE_PATTERN

Source: `src/main/organization/organization-client.ts:52-59,70-75`

```ts
addMember(
  input: AddOrganizationMemberRequest,
): Promise<AddOrganizationMemberResponse> {
  return this.request(
    '/v1/organizations/me/members',
    this.json('POST', input),
    AddOrganizationMemberResponseSchema,
  );
}
```

Add `updateOrganization`/`update` beside the existing exact organization operations; reuse `json()` and `request()`.

### PRELOAD_AND_IPC_PATTERN

Source: `src/preload.ts:419-425`; `src/main/ipc/register-ipc.ts:399-406`

```ts
const request = AddOrganizationMemberRequestSchema.parse(input);
const response: unknown = await ipcRenderer.invoke(
  IPC_CHANNELS.addOrganizationMember,
  request,
);
return AddOrganizationMemberResponseSchema.parse(response);
```

```ts
await assertMembershipAuthorizedSender(event, mainWindow, services);
return services.organizationClient.addMember(
  AddOrganizationMemberRequestSchema.parse(input),
);
```

Parse on both renderer-to-main boundaries and parse hosted responses before exposing them to React.

### RENDERER_ASYNC_PATTERN

Source: `src/renderer/OrganizationPage.tsx:71-112,128-158`

```ts
setIsAdding(true);
setMembersError(null);
setNotice(null);
try {
  const response = await window.tro.addOrganizationMember({ email });
  onOrganizationChange(response.organization);
  setEmail('');
  setNotice(
    response.newlyCreated
      ? t('Seat reserved for {email}.', { email: response.member.email })
      : t('{email} already has a reserved seat.', {
          email: response.member.email,
        }),
  );
  await loadMembers();
  emailInputRef.current?.focus();
} catch (addError) {
  setMembersError(
    addError instanceof Error
      ? addError.message
      : t('Tro could not reserve this seat.'),
  );
} finally {
  setIsAdding(false);
}
```

Use explicit busy state, clear prior messages, safe fallback, `role=status`/`role=alert`, and intentional focus restoration.

### TEST_STRUCTURE

Source: `src/renderer/OrganizationPage.test.tsx:48-80`

```ts
it('keeps a full-capacity alert visible and disables seat reservation', () => {
  const markup = renderPage({
    organization: organization({
      capacity: {
        assignedSeats: 10,
        maxSeats: 10,
        remainingSeats: 0,
        state: 'full',
      },
    }),
  });

  expect(markup).toContain('role="alert"');
  expect(markup).toContain('All seats are assigned');
  expect(markup).toMatch(
    /<input(?=[^>]*id="organization-member-email")(?=[^>]*disabled)[^>]*>/u,
  );
});
```

Source: `src/main/organization/organization-client.test.ts:23-49`

```ts
await expect(client.getCurrent()).resolves.toEqual({
  organization: ORGANIZATION,
});
expect(fetchImpl).toHaveBeenCalledWith(
  'https://api.trocode.example/v1/organizations/me',
  expect.objectContaining({ method: 'GET' }),
);
```

Use static markup for render/permission absence, mocked fetch for exact transport, IPC handler calls for boundary validation, and real router/PostgreSQL tests for server authority.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `services/api/migrations/022_organization_profile_settings.sql` | CREATE | Allow the content-free organization profile audit action |
| `services/api/src/db.rs` | UPDATE | Embed migration 022 in order |
| `services/api/src/auth/organizations.rs` | UPDATE | Validate and persist organizer-only name changes transactionally |
| `services/api/src/http/organization.rs` | UPDATE | Add exact PATCH route and profile rate-limit scopes |
| `services/api/tests/organization_managed_access.rs` | UPDATE | Cover migration invariant, persistence, audit privacy, and role denial |
| `services/api/tests/http_compat.rs` | UPDATE | Cover HTTP rename and member read/forbidden behavior |
| `services/api/tests/contract_corpus.rs` | UPDATE | Include migration 022 and updated counts |
| `services/api/tests/postgres_compat.rs` | UPDATE | Expect 22 embedded migrations and adoption parity |
| `services/api/tests/fixtures/route_inventory.json` | UPDATE | Add PATCH organization route |
| `services/api/tests/fixtures/schema_inventory.json` | UPDATE | Increment migration count without changing table count |
| `services/api/BUILD.bazel` | UPDATE | Include migration 022 in organization test compile data or use the existing migration glob consistently |
| `src/shared/contracts.ts` | UPDATE | Add strict organization update schemas and types |
| `src/shared/contracts.test.ts` | UPDATE | Test trimming, bounds, strictness, and response shape |
| `src/shared/desktop-api.ts` | UPDATE | Add fixed update channel and narrow API method |
| `src/preload.ts` | UPDATE | Parse request/response around exact IPC invocation |
| `src/main/ipc/register-ipc.ts` | UPDATE | Register trusted, membership-authorized update handler |
| `src/main/ipc/register-ipc.test.ts` | UPDATE | Assert normalization and rejection before hosted call |
| `src/main/organization/organization-client.ts` | UPDATE | Add authenticated PATCH operation |
| `src/main/organization/organization-client.test.ts` | UPDATE | Assert URL/method/body/schema/error behavior |
| `src/renderer/App.tsx` | UPDATE | Reposition/show organization settings, permit members, pass Settings summary/action, refresh after claim |
| `src/renderer/app-navigation.ts` | UPDATE | Settings-level title and pure organization availability helper |
| `src/renderer/app-navigation.test.ts` | CREATE | Test organization visibility and navigation metadata without rendering all of App |
| `src/renderer/SettingsPage.tsx` | UPDATE | Add compact organization summary and Open settings action |
| `src/renderer/SettingsPage.test.ts` | UPDATE | Test organizer/member/null/error summary states |
| `src/renderer/OrganizationPage.tsx` | UPDATE | Add editable name, role-aware read-only branch, clearer seat onboarding, class CTA |
| `src/renderer/OrganizationPage.test.tsx` | UPDATE | Test organizer controls, member privacy, translations, and profile state |
| `src/renderer/app-language.ts` | UPDATE | Add English/Vietnamese organization/settings copy |
| `src/renderer/app-language.test.ts` | UPDATE | Assert key new translations and interpolation |
| `src/index.css` | UPDATE | Style settings summary, name form, member summary, and responsive layout |
| `README.md` | UPDATE | Document where organization management appears and no-code student sign-in |
| `docs/security.md` | UPDATE | Document member summary visibility, organizer rename authority, and content-free audit |
| `docs/knowledge-spaces.md` | UPDATE | Clarify organization seat versus class enrollment sequence |

---

## Step-by-Step Tasks

### Task 1: Add the forward-only organization profile audit migration

- **ACTION**: Create migration 022 and register it with every migration inventory.
- **IMPLEMENT**:
  - Create `services/api/migrations/022_organization_profile_settings.sql` that drops only the known `organization_audit_events_action_check` constraint and recreates it with the four existing values plus `organization.profile_updated`.
  - Append migration version 22 and description `organization profile settings` to `services/api/src/db.rs`.
  - Update `schema_inventory.json` `migrationCount` from 21 to 22; keep 48 domain tables.
  - Include migration 022 in `contract_corpus.rs`; update migration count expectations in `postgres_compat.rs` from 21 to 22 while leaving table counts unchanged.
  - Update `services/api/BUILD.bazel` compile data for the organization test to include 022.
- **MIRROR**: Migration registry in `services/api/src/db.rs:108-118` and named constraint replacement in `services/api/migrations/021_organization_managed_access.sql:4-10`.
- **IMPORTS**: None.
- **GOTCHA**: Do not modify migration 021. Do not add a new table. The migration must rerun cleanly and preserve every existing action value.
- **VALIDATE**: `cargo test --manifest-path services/api/Cargo.toml --all-features --locked contract_corpus`; with `TEST_DATABASE_URL`, run ignored PostgreSQL compatibility tests.

### Task 2: Implement organizer-authorized name persistence

- **ACTION**: Add repository validation, transaction, and audited organization rename.
- **IMPLEMENT**:
  - Add a small `normalize_organization_name(&str) -> Option<String>` helper beside email normalization. Trim, require 1–100 characters, and reject control characters; store the trimmed display value without lowercasing or collapsing internal spaces.
  - Add `OrganizationRepository::update_name(&self, user_id: &str, name: &str) -> ApiResult<OrganizationSummary>`.
  - Begin a transaction, load `CURRENT_MEMBERSHIP`, require `role == "organizer"`, update only that resolved `organization_id`, set `updated_at=NOW()`, append `organization.profile_updated` with `{}` detail, commit, and return a fresh summary carrying the new name and current capacity.
  - Keep `current_for_user` readable by both organization roles and list/add/cancel organizer-only.
- **MIRROR**: Organizer guard and transaction in `services/api/src/auth/organizations.rs:187-289`; `summary()` projection at lines 94-103.
- **IMPORTS**: Existing `sqlx::{PgPool, Row}`, `StatusCode`, `serde_json` via fully-qualified macro if preferred.
- **GOTCHA**: Never audit old/new names. Do not authorize using classroom role. Do not accept organization ID. Ensure the response cannot reuse the old name from a pre-update row.
- **VALIDATE**: Repository tests prove trimmed persistence, `updated_at` mutation, audit action with empty detail, member denial, and no cross-organization target.

### Task 3: Expose the narrow hosted PATCH endpoint

- **ACTION**: Add and inventory `PATCH /v1/organizations/me`.
- **IMPLEMENT**:
  - Refactor the current member-only `mutation_limit` so member and profile mutations use distinct stable scope names while keeping the existing member limits unchanged.
  - In `services/api/src/http/organization.rs`, add PATCH handling after GET current and before `/members` branches.
  - Read at most 4,096 bytes as JSON, require exactly one `name` property, normalize/validate with the repository helper, and return `{ "organization": summary }` with 200.
  - Add the PATCH route to `route_inventory.json`.
  - Extend `http_compat.rs` to assert organizer success, immediate GET visibility, trimmed storage, empty/overlong/extra-field 400s, member GET success, member PATCH 403, and no member roster access.
- **MIRROR**: Exact body validation in `services/api/src/http/organization.rs:111-136`; coded error response in `services/api/src/error.rs:39-63`.
- **IMPORTS**: Existing `Method`, `StatusCode`, `Value`, `json`; import `normalize_organization_name` from `auth` if the helper is exported.
- **GOTCHA**: Route order must not let `/v1/organizations/me/members` match the profile PATCH. A member's GET is allowed, but PATCH/list/add/cancel remain forbidden.
- **VALIDATE**: Targeted Rust tests and route corpus pass; response JSON matches the TypeScript schema exactly.

### Task 4: Carry the update through strict desktop boundaries

- **ACTION**: Add the update request/response to contracts, desktop API, preload, IPC, and hosted client.
- **IMPLEMENT**:
  - Add `UpdateOrganizationRequestSchema`, `UpdateOrganizationResponseSchema`, and inferred types in `src/shared/contracts.ts`.
  - Add `updateOrganization: 'organization:update'` and `DesktopApi.updateOrganization()` in `src/shared/desktop-api.ts`.
  - In preload, parse the input, invoke the exact channel, and parse the response.
  - Register the channel in IPC cleanup/registration lists, require `assertMembershipAuthorizedSender`, parse again, then call `OrganizationClient.update()`.
  - Add `OrganizationClient.update(input)` using `PATCH /v1/organizations/me`, `this.json`, and `UpdateOrganizationResponseSchema`.
  - Extend contract, client, and IPC tests for trimming, extra fields, exact PATCH body, malformed success response, inactive membership, and invalid names rejected before client invocation.
- **MIRROR**: Existing add/cancel vertical slice in `src/shared/contracts.ts:2272-2294`, `src/preload.ts:419-435`, `src/main/ipc/register-ipc.ts:399-416`, and `organization-client.ts:52-68`.
- **IMPORTS**: New schemas and request/response types only; keep type imports separate according to repository lint rules.
- **GOTCHA**: The renderer must not provide `organizationId`; `.strict()` must reject it. Update the IPC unregister channel collection so tests and hot reload do not leak a handler.
- **VALIDATE**: `npx vitest run src/shared/contracts.test.ts src/main/organization/organization-client.test.ts src/main/ipc/register-ipc.test.ts`.

### Task 5: Make Organization discoverable as a settings destination

- **ACTION**: Reposition organization navigation and expose it to members safely.
- **IMPLEMENT**:
  - Add a pure helper in `app-navigation.ts`, e.g. `organizationSettingsAvailable(organization)`, returning true for any non-null `OrganizationSummary`; use it from `App.tsx` and test it.
  - Move the Organization button from the Workspace `<nav>` into `sidebar-bottom`, immediately above Settings, label it `Organization settings`, and retain the existing icon and active-view semantics.
  - Change the route guard so `activeView === 'organization'` redirects only when `organization === null`; do not redirect `role: member`.
  - Update `navigationTitle('organization')` to settings vocabulary such as kicker `Account settings`, title `Organization`.
  - Pass `organization`, organization loading/error state, `onRefreshOrganization`, and `onOpenOrganization` into `SettingsPage`.
  - After successful access-code activation, perform one read-only organization refresh; if it returns a current organization, navigate to Organization settings. Shared-code activation (`organization: null`) keeps the existing destination.
- **MIRROR**: Existing active-view/nav pattern in `App.tsx:2060-2230` and stale refresh generation in `App.tsx:1336-1357`.
- **IMPORTS**: `OrganizationSummary` in `app-navigation.ts`; helper import in `App.tsx`.
- **GOTCHA**: Do not key visibility from classroom Teacher role. Avoid duplicate refresh races by returning the accepted summary from `refreshOrganization` or by using its request ID; stale responses must not navigate after sign-out/account change.
- **VALIDATE**: Pure navigation tests plus manual organizer/member/shared/free sidebar checks.

### Task 6: Add the organization summary to Settings

- **ACTION**: Make the relationship between promo code, organization, and settings visible on the page shown in the screenshot.
- **IMPLEMENT**:
  - Extend `SettingsPageProps` with current organization, loading/error, refresh, and open callbacks.
  - Immediately after the Plan access card, render an Organization card when organization exists or when its load failed.
  - For an organization, show name, plan title, localized `Organizer`/`Member` role, assigned/max seats, code-free access helper, and `Open organization settings`.
  - For a bounded load failure, show an alert and Retry. Do not show an empty organization card to Free/shared-code users with a successful `null` response.
  - Keep the current promo code form unchanged for Free users.
  - Extend the Settings render fixture to accept organization overrides and test organizer, member, null, loading, and error states in English/Vietnamese.
- **MIRROR**: Plan-access card at `SettingsPage.tsx:135-204` and status/error semantics at lines 181-199.
- **IMPORTS**: `OrganizationSummary` and existing `planTitle`.
- **GOTCHA**: Settings is a summary/entry point, not a second roster implementation. Do not expose member emails or management buttons here.
- **VALIDATE**: `npx vitest run src/renderer/SettingsPage.test.ts` and static markup accessibility assertions.

### Task 7: Make OrganizationPage role-aware and add profile editing

- **ACTION**: Turn the existing organizer page into the full Organization settings page with a safe member mode.
- **IMPLEMENT**:
  - Derive `isOrganizer = organization?.role === 'organizer'` once and use it for all controls and effects.
  - Synchronize `organizationNameDraft` when organization ID/name changes. Organizer sees labeled name input, character count/bounds, Save name, busy state, success status, and safe error alert; member sees the name as text only.
  - Call `window.tro.updateOrganization({name})`, ignore stale/unmounted responses, update App through `onOrganizationChange`, reset the draft to the canonical returned name, and restore useful focus.
  - Call `listOrganizationMembers` only for organizers. For members, clear private member state and render a read-only “Your access is managed by this organization” panel.
  - Keep capacity visible to both roles because it already exists in their server summary.
  - Change organizer form copy to `Invite a student or staff member` / `Google account email` / `Reserve seat`; add persistent helper text that no email is sent and no code is required.
  - Preserve current full-capacity disabled behavior, idempotent notice, pagination, and pending-only cancellation.
  - Add `onOpenClasses` prop and a distinct next-step panel: organization seat access does not enroll a class; use Class workspaces → People after the account exists and has Student role.
  - Render the no-organization refresh state only as a defensive fallback; normal navigation hides the route when summary is null.
- **MIRROR**: Existing member request IDs, notices, errors, and focus patterns throughout `OrganizationPage.tsx`; class copy in `SpaceDetailPage.tsx:496-604`.
- **IMPORTS**: Existing React hooks and shared organization types; no new library.
- **GOTCHA**: A member page must never start the organizer-only list effect. “Invite” copy must not claim an email was sent. Name update and list requests need separate stale/busy state so one does not block or overwrite the other.
- **VALIDATE**: Static render tests prove member markup contains no email input, Save name, Reserve seat, member list, or cancel action; organizer tests prove all controls, status, and accessible labels.

### Task 8: Complete localization, responsive styling, and documentation

- **ACTION**: Make the new flow polished, bilingual, responsive, and operationally clear.
- **IMPLEMENT**:
  - Add English-key/Vietnamese values for Organization settings, member role, organization name/save states, Settings summary, exact-email/no-code/no-email helper, class next step, retry, and validation feedback.
  - Add translation tests for representative labels and interpolated seat counts.
  - Extend current organization/settings CSS for profile form, summary grid, role badge variants, read-only member card, next-step panel, button/focus/disabled states, and mobile stacking at 760px.
  - Update README production access-code flow to name **Settings → Organization settings** and describe automatic sign-in after email reservation.
  - Update `docs/security.md` to say members receive bounded summary only, organizers may rename/list/add/cancel, and profile audit details contain no name.
  - Update `docs/knowledge-spaces.md` with the two-step seat-then-class sequence and retain admin-assigned classroom role requirements.
- **MIRROR**: Translation map at `app-language.ts:582-624`, settings/organization CSS at `index.css:3971-4437`, mobile rules at `index.css:5700-5760`.
- **IMPORTS**: None.
- **GOTCHA**: Every new visible string must pass through `translate`; do not use color alone for role/state; maintain minimum input/button hit areas and visible focus.
- **VALIDATE**: English/Vietnamese manual screenshots at wide and narrow widths plus targeted translation/render tests.

### Task 9: Run the full verification and privacy review

- **ACTION**: Exercise all affected layers and inspect the final diff.
- **IMPLEMENT**:
  - Run targeted TypeScript and Rust tests during development.
  - Run formatter/lint/typecheck/full tests, package, and Bazel checks because Rust/migration/Bazel inputs changed.
  - Search the final diff for raw names/emails in audit/log code and for any generic IPC/REST bridge.
  - Manually verify organizer, member, free/shared-code, loading, network failure, full capacity, pending reservation, and successful no-code sign-in flows.
- **MIRROR**: Required gates in `AGENTS.md` and scripts in `package.json`.
- **IMPORTS**: None.
- **GOTCHA**: `npm run package` requires the repository's configured Doppler production environment. Report environmental credential failure separately from code/test failure; do not weaken the command or hardcode credentials.
- **VALIDATE**: All commands and the acceptance checklist below pass.

---

## Testing Strategy

### Unit and Contract Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Organization update schema trims | `{name: '  Greenfield School  '}` | `{name: 'Greenfield School'}` | No |
| Organization update schema rejects empty | `{name: '   '}` | Parse failure | Yes |
| Organization update schema rejects extra authority | `{name:'School', organizationId:'11111111-1111-4111-8111-111111111111'}` | Parse failure | Security |
| Organization update schema bounds length | 100 and 101 characters | 100 accepted; 101 rejected | Yes |
| Client PATCH shape | Valid name | Exact `/v1/organizations/me`, PATCH, JSON content type/body | No |
| Client rejects malformed response | Missing capacity/role or invalid name | Promise rejects | Security |
| IPC parses before client | Empty/extra field | Hosted client not called | Security |
| IPC requires active membership/trusted frame | Inactive membership/untrusted sender | Promise rejects before hosted call | Security |
| Settings organizer summary | Organizer summary | Name, role, seats, Open action | No |
| Settings member summary | Member summary | Name, Member role, Open action | No |
| Settings null summary | `organization: null` | No organization card/navigation promise | Yes |
| Settings refresh error | Safe error string | Alert and Retry | Yes |
| Organizer organization page | `role: organizer` | Name editor, reserve form, roster section, class CTA | No |
| Member organization page | `role: member` | Read-only identity/capacity only; no management controls | Security |
| Full organizer capacity | `state: full` | Persistent alert and disabled reserve form | Yes |
| Vietnamese organization settings | `appLanguage: vi` | No untranslated new core labels | Localization |
| Navigation availability | null/organizer/member | false/true/true | Security/UX |

### Rust API and PostgreSQL Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Normalize organization name | padded, empty, overlong, control characters | trimmed valid value or rejection | Yes |
| Organizer rename | valid PATCH | 200 fresh summary; later GET shows new name | No |
| Member summary | member GET `/me` | 200 own bounded organization summary | No |
| Member rename | member PATCH | 403 `organization_organizer_required`; name unchanged | Security |
| Member roster read | member GET `/members` | 403 and no identities | Security |
| Exact body | extra/missing/wrong-type property | 400 `invalid_request` | Security |
| Rename audit | successful rename | one `organization.profile_updated`, `{}` detail, no name | Privacy |
| Migration rerun | run migrations twice | success; constraint contains all five actions | Yes |
| Route corpus | PATCH route added once | unique recognized organization family route | Compatibility |
| Migration parity | new/legacy database paths | 22 migrations, same domain table count | Compatibility |
| Existing seat flow | add/full/auto-join/cancel cases | unchanged | Regression |

### Edge Cases Checklist

- [ ] No organization (`null`) for Free and legacy shared-code accounts
- [ ] Organization fetch loading and network failure
- [ ] Organizer and ordinary member roles
- [ ] Empty, whitespace-only, maximum, over-maximum, Unicode, and control-character names
- [ ] Unchanged organization name
- [ ] Rename response arrives after sign-out or organization state replacement
- [ ] Full seat capacity
- [ ] Duplicate reservation in the same organization
- [ ] Email already reserved by another organization
- [ ] Paused organization code
- [ ] Pending reservation cancellation and active-member cancellation rejection
- [ ] Student signs in with exact case-insensitive verified email and receives access without code
- [ ] Student signs in with a different email and does not claim the seat
- [ ] Student has no classroom role or is not yet in a class
- [ ] Member cannot list identities or reach mutation controls
- [ ] English and Vietnamese, desktop and narrow viewport
- [ ] Hosted API unavailable; no optimistic local rename remains visible
- [ ] Rate-limited rename and reserve operations surface safe feedback

---

## Validation Commands

### Targeted TypeScript Tests

```bash
npx vitest run \
  src/shared/contracts.test.ts \
  src/main/organization/organization-client.test.ts \
  src/main/ipc/register-ipc.test.ts \
  src/renderer/app-navigation.test.ts \
  src/renderer/SettingsPage.test.ts \
  src/renderer/OrganizationPage.test.tsx \
  src/renderer/app-language.test.ts
```

EXPECT: All targeted contract, boundary, navigation, render, and localization tests pass.

### Targeted Rust Tests

```bash
cargo test --manifest-path services/api/Cargo.toml --all-features --locked \
  --test organization_managed_access \
  --test contract_corpus
```

EXPECT: Organization policy, migration invariant, and contract corpus tests pass; the disposable-database case remains ignored unless explicitly enabled.

### Optional Disposable PostgreSQL Tests

```bash
TEST_DATABASE_URL=postgresql://127.0.0.1:5432/trocode_test cargo test \
  --manifest-path services/api/Cargo.toml \
  --all-features \
  --locked \
  -- --ignored
```

EXPECT: Run only against a local database whose name ends in `_test`; rename persistence/audit and migration compatibility pass. Never point this command at production or a non-disposable database.

### Static Analysis and Full Test Suite

```bash
npm run check
```

EXPECT: Admin build, runtime checks, ESLint, TypeScript, Rust format/Clippy/audit, Vitest, and Cargo tests all pass.

### Package Verification

```bash
npm run package
```

EXPECT: Electron package completes using the configured Doppler production environment.

### Bazel Verification

```bash
npm run bazel:check
```

EXPECT: Buildifier, all Rust Bazel tests, and Clippy target pass.

### Manual Validation

- [ ] Claim a new organization-managed code as a Teacher/organizer; Organization settings becomes visible at the bottom of the sidebar and opens after refresh.
- [ ] Settings shows the organization name, plan, role, seat count, and Open organization settings action.
- [ ] Rename the organization; success is announced, both Settings and Organization surfaces update, and the name persists after restart/sign-in.
- [ ] Reserve `student@example.com`; UI says no email is sent and no code is needed.
- [ ] Sign in as that exact Google account; access is active without code entry and the read-only organization view is visible.
- [ ] Confirm the member cannot see name editor, roster identities, reserve controls, or cancellation controls.
- [ ] As the Teacher, open Class workspaces and add the registered Student from People; confirm organization reservation alone did not enroll the class.
- [ ] Repeat with a Free account and a legacy shared code; no misleading Organization settings item appears.
- [ ] Verify full-capacity, paused-code, invalid-name, invalid-email, and hosted-offline feedback.
- [ ] Verify English and Vietnamese at wide and narrow viewport sizes with keyboard-only navigation and visible focus.

---

## Acceptance Criteria

- [ ] Organization settings appears in the account/settings navigation for any non-null organization summary, not for every Teacher and not for Free/shared-code users.
- [ ] Settings identifies the current organization and links to Organization settings.
- [ ] Ordinary organization members can see their own bounded organization summary but cannot see any other member identity or management control.
- [ ] Organizers can save a trimmed 1–100-character organization name that persists across refresh/restart.
- [ ] The hosted API independently rejects member rename/list/add/cancel attempts.
- [ ] Every successful rename writes a content-free `organization.profile_updated` audit event in the same transaction.
- [ ] The invite/reservation form clearly states that the student uses the exact Google email, receives no invitation email, and needs no code.
- [ ] Existing pending/active seat capacity and cancellation rules remain unchanged.
- [ ] The UI explicitly distinguishes organization plan access from Class workspace enrollment and links to the existing People flow.
- [ ] New copy is localized in English and Vietnamese.
- [ ] Loading, empty, error, full, member, organizer, and narrow viewport states are accessible and tested.
- [ ] No raw IPC, generic REST bridge, organization ID authority, token, code, name, or email leaks across forbidden boundaries/logs/audit details.
- [ ] `npm run check`, `npm run package`, and `npm run bazel:check` pass.

## Completion Checklist

- [ ] Code follows the discovered React/Zod/IPC/Rust repository patterns.
- [ ] Every renderer-to-main request and hosted response is schema parsed.
- [ ] Organization visibility and organization mutation authority are tested separately.
- [ ] Server error handling uses static safe messages and existing client parsing.
- [ ] Operational logging remains metadata-only.
- [ ] Migration 022 is forward-only, re-runnable, embedded, inventoried, and parity-tested.
- [ ] No new dependency or environment variable was added.
- [ ] English/Vietnamese and responsive styling are complete.
- [ ] README, security, and Knowledge Spaces documentation match the final flow.
- [ ] Final diff contains no unrelated changes and preserves the renderer sandbox.
- [ ] Plan is self-contained; implementation requires no additional codebase discovery.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Product language conflates organization membership with classroom enrollment | Medium | High | Persistent two-step copy and Class workspaces CTA; no shared mutation/API |
| Showing the page to members accidentally calls organizer-only roster API | Medium | High | Gate the effect with `isOrganizer`; render tests verify no controls; HTTP test keeps server 403 |
| Moving navigation makes organization controls look like personal preferences | Low | Medium | Separate `Organization settings` destination, role badge, and server-owned shared-state copy |
| Rename leaks school/name content into audit or logs | Low | High | Audit `{}` only; existing middleware logs method/path/status only; privacy diff search |
| Migration constraint replacement omits an existing action | Low | High | Migration invariant test enumerates all five values; rerun migration test |
| Organization refresh races sign-out or a second request | Medium | Medium | Preserve request-generation guard and navigate only from the accepted current response |
| “Invite” implies that Tro sends an email | Medium | Medium | Explicit “No invitation email is sent” helper; button remains `Reserve seat` |
| Existing organization created with a poor code label | High | Low | Organizer rename is the intended correction path; initial claim behavior stays backward compatible |
| Packaging/Bazel environment unavailable locally | Medium | Medium | Run all local gates; report credential/tooling failure without bypassing required checks |

## Notes

- The account classroom role is currently obtained from Knowledge Space APIs, not `AuthStatus`; this plan deliberately avoids adding it to organization visibility because it is not the correct authorization input.
- `GET /v1/organizations/me` already returns summaries for members and organizers. The principal privacy bug is renderer redirect/visibility plus an unconditional member-list effect if the page were opened; the API's organizer checks should remain unchanged.
- The existing organization name column and `updated_at` column require no schema change. Migration 022 exists only to preserve the audit allowlist when adding profile updates.
- Active members cannot currently be removed or transferred. Do not add UI that promises those actions.
- The plan uses “student” in explanatory UX because that is the target scenario, but the underlying seat remains a general organization member seat and may also be reserved for staff.
