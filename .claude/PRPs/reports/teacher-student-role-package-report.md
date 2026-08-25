# Implementation Report: Teacher, Student, and Class Workspace Package

## Outcome

Implemented the classroom package from account creation through class
membership while preserving the existing Activity, Run, Work Session, task,
submission, insight, and computer-control lifecycles.

The resulting flow is:

1. A person creates/signs into a normal Tro account.
2. An administrator assigns **Teacher** or **Student** in `/source/admin`.
3. A Teacher creates a **Class workspace**.
4. The class owner bulk-adds registered Teachers or Students by email. A
   non-owner Teacher may bulk-add Students only.
5. Students see class resources and assigned work without roster, group,
   upload, authoring, Run-management, or facilitator controls.

Teachers may add up to 500 emails in one idempotent request and repeat batches
without a product-level class-size limit. Missing, blocked, ambiguous, duplicate,
already-added, and incorrectly assigned accounts are handled explicitly.

## Main implementation surfaces

- Migration 018 adds `users.classroom_role`, safely backfills existing Space
  members, adds an idempotent membership-batch record, and extends the admin
  audit action constraint.
- The existing admin dashboard now displays, filters, and updates classroom
  roles. Incompatible demotions/unassignment fail closed while active class
  memberships exist.
- The Rust hosted Space policy now combines the Admin-assigned account
  eligibility with the exact `owner | facilitator | participant` membership in
  one class.
- New bounded `POST /v1/spaces/:spaceId/members/bulk` and the existing member
  list are exposed through parsed hosted, Electron-main, preload, and renderer
  contracts. No raw IPC or generic database capability was added.
- Invite redemption now requires the invite role to match the Admin-assigned
  account role.
- The renderer introduces Class workspaces, a Teaching/Learning class switcher,
  contextual Teacher/Student badges, class filtering for assigned Activities,
  a Teacher-only People/roster flow, repeatable email batches, and Vietnamese
  copy. Student views do not request teacher-only roster or group data and hide
  upload controls.
- Knowledge Space and security documentation now records the two-layer role
  boundary and explicitly states that Teacher never grants student-device,
  screen, conversation, local-file, or CUA access.

## Security and reliability properties

- Server authorization remains authoritative; renderer affordances are only a
  usability layer.
- Only Admin-assigned Teachers can create Class workspaces.
- Students can only use `participant` memberships. Teachers can preserve a
  participant membership in another class, but receive only that membership's
  participant permissions there.
- Owners can add Teachers or Students; facilitators can add Students; Students
  cannot list the roster or add anyone.
- Bulk membership normalizes and deduplicates emails, row-locks candidate
  accounts, rejects blocked/ambiguous/wrong-role candidates, and records a
  bounded result under `(space_id, client_id)` for safe retries.
- Member responses are capped at 2,000 rows; bulk requests/results are capped at
  500 emails. Contracts are parsed at HTTP, hosted client, IPC, and preload
  boundaries.
- Existing pinned-source filtering still limits what a participant can read.
  No task/session/control authority was added or inferred from classroom roles.

## Plan deviations approved by the user

The original plan deliberately avoided a global account role, a migration, a
new membership route, and roster email. Before implementation, the user refined
the required product flow to make the Admin assign Teacher/Student after account
creation and let Teachers add any number of registered people to a class.

That newer instruction superseded those plan constraints. The implementation
therefore adds an Admin-owned account eligibility role, a repeatable bounded bulk
route, and teacher-visible account emails needed to select existing people. The
existing per-Space role remains the actual class authorization; the global role
does not grant access to every class. The requested exclusion of session-active,
data-delivery, task lifecycle, and computer-control changes was preserved.

## Verification

The classroom backend is covered by Rust policy tests, migration/route/schema
corpora, and ignored real Axum/PostgreSQL compatibility tests. The
PostgreSQL-backed compatibility test encodes Admin assignment, Teacher-only
class creation, teacher/student roster batches, idempotent replay, incompatible
role changes, and invite redemption; running it still requires a disposable
local PostgreSQL 17 `TEST_DATABASE_URL`.

Passed locally in this cutover verification:

- Rust formatting, Clippy with warnings denied, unit tests, contract tests, and
  release build;
- root `npm test`, including the Rust API suite;
- `npm run bazel:check`.

`services/api` no longer contains a Node package, `.mjs` runtime, or Node
backend tests. Full `npm run check` and `npm run package` were attempted after
the Rust-only cleanup but were blocked by GitHub/network timeouts while fetching
the RustSec advisory database and Electron packaging dependencies.

## Design validation

The requested `gan-design` loop passed after two iterations, improving from
7.47 to **8.00/10** against a 7.50 threshold. The final class-folio direction
includes a compact class switcher, responsive Teacher People flow, bounded
searchable 500-person roster, grouped Assigned Activities, accessible keyboard
tabs, and explicit Admin Saving/Saved/Not saved states. The complete brief,
rubric, feedback, interactive proof, and screenshots are archived under
`gan-harness/class-workspaces/`.

The evaluator's highest-impact functional finding was also closed before final
verification: changing classes remounts the detail surface, preventing draft
roster/group/run state or late responses from crossing class boundaries.

## Rollout note

Deploy migration 018 before a desktop/API pair that expects Knowledge contract
version 2. Administrators should assign all newly created accounts before a
Teacher attempts to add them. Existing owners/facilitators are backfilled to
Teacher; participant-only accounts are backfilled to Student. Production
deployment should also include migration 019 so invite creation retries return
the original encrypted invite code. Deployment remains an operator-controlled
action and was not performed by this implementation change.
