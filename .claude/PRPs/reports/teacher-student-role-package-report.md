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
- Hosted Space policy now combines the Admin-assigned account eligibility with
  the exact `owner | facilitator | participant` membership in one class.
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

Passed after installing the lockfile-pinned dependencies with `npm ci` (zero
reported vulnerabilities):

- `npm run check`
  - runtime-version compatibility guard passed;
  - ESLint passed;
  - TypeScript passed;
  - 108 Vitest files / 765 tests passed;
  - 12 root Node tests passed;
  - API suite: 141 passed, 1 skipped, 0 failed.
- `npm run package` — Electron Forge packaged the macOS arm64 application.
- `npm audit --audit-level=high` — zero vulnerabilities.
- `node --check services/api/public/admin.js` — standalone Admin browser script
  syntax passed.
- `git diff --check` — passed.

The skipped API test is the existing PostgreSQL integration fixture. It remains
environment-gated because `TEST_DATABASE_URL` was not configured. Migration
ordering, forward-only reruns, role policy, admin assignment, service behavior,
and repository bulk/idempotency behavior all passed in the normal suite.

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
Teacher; participant-only accounts are backfilled to Student.
