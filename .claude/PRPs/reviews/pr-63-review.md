# Ponytail potential-issues review: PR #63

- PR: https://github.com/ducnguyen67201/asdfaefqwefq/pull/63
- Title: feat: teacher voice broadcasts and independent student explanations
- Reviewed code: `7471d095e25087e5e7188642cf922372f34ec423`
- Base: `main` at `a7ffc3a9b5838bc0515cbac22174fecdfc63cea1`
- Date: September 5, 2026
- Decision: COMMENT — addressed findings; hosted CI and real-client acceptance pending

This is the repository's established “Ponytail” potential-issues pass, performed
locally during PR preparation. There is no separate installed Ponytail tool.
It is not presented as an independent bot approval. GitHub's automatically
triggered Codex review is separate.

## Findings addressed in the PR

### P2 — Students could not opt in before the first broadcast

A successful empty feed left `ClassroomBroadcastService.notice` null, so the
coordinator had no session identity and the renderer returned before displaying
consent. Students could only opt in after receiving a prior notice.

The service now publishes a verified empty session projection, and the panel
shows session consent even without pending content. A regression failed on the
old behavior; it now passes. EN/VI UI tests exercise explicit opt-in before the
first notice and verify that rendering starts no guidance.

Files: `src/main/knowledge/classroom-broadcast-service.ts:161`,
`src/renderer/ClassroomExplanationPanel.tsx:73`.

### P2 — Completion during startup could later become cancellation

The coordinator checked the journal before its final encrypted write. If Coach
finished while that write was in flight, startup still armed an expiry timer.
Ten minutes later the timer called Stop on the already finished explanation.

After the write, startup now verifies the journal phase, generation and active
task before scheduling or reporting. A deterministic deferred-write/fake-timer
regression changed from failing (`cancelled`) to passing (`finished`).

File: `src/main/knowledge/classroom-guidance-coordinator.ts:343`.

### P2 — Delayed active reports could outlive guidance authority

The status endpoint checked the student's anchor and Attempt but omitted the
broadcast's ten-minute deadline and the target Run's availability window. It also
did not serialize its active report with the session-close operation.

Reports now acquire the session lock before the guidance row; active transitions
recheck the target's version/state, open/close window and broadcast expiry. The
PostgreSQL regression proves an expired active report is rejected and the Attempt
remains `assigned`. Terminal reporting remains available without claiming academic
completion.

File: `services/api/src/classroom/guidance.rs:169`.

### P2 — Classroom database tests were skipped in hosted CI

The new classroom test is deliberately ignored without a disposable PostgreSQL
database. The CI PostgreSQL command previously opted into only compatibility and
provider-budget tests, leaving this feature's main HTTP regression unexecuted.

Added `//services/api:classroom_e2e_test` to the existing serial PostgreSQL step.
Both its existing classroom flow and new broadcast/guidance flow pass locally.

File: `.github/workflows/ci.yml:49`.

The pending-notice retention update also releases an outgoing pin before
retaining its replacement, so the bounded pin set has capacity for the new entry.

## Other boundaries examined

- Teacher selection and task/voice binding, exact two-tool catalogue, strict IPC,
  Zod/HTTP input/output parsing, published assignment identity and EN/VI ambiguity.
- Durable preview states, owner-scoped encryption, explicit commit, idempotency,
  stale selection, lost receipts and unknown outcomes without automatic replay.
- Own anchor/target resolution, session feed cursors and replay provenance,
  no automatic link opening, bounded notices and shared local task admission.
- Independent assignment/language/screen context, bounded Coach rounds, no model
  tools for mutations, fresh grounding, cancellation, durable model identities,
  status privacy and separation from Help/completion/grades.
- Additive migrations and explicit registration, schema/route inventories,
  legacy directive compatibility, composition, shutdown and documentation.

The separate automatic Codex review subsequently identified two additional issues
on the reviewed commit. The follow-up below records their fixes. This review is
not a claim of production acceptance or exhaustive formal verification.

## Automatic Codex review follow-up

### P1 — Text-only Next omitted the preceding answer

Comment: https://github.com/ducnguyen67201/asdfaefqwefq/pull/63#discussion_r3939891016

Text answers now enter the same bounded history as visual explanations, and every
model request receives a snapshot. The eight-request limit bounds history, and
visual progress keeps its own counter. The regression checks the actual second
request body, the immutable first-request history, text-only operation and the
eight-round bound. It failed before the fix.

### P2 — A transient API rate limit consumed the guidance claim

Comment: https://github.com/ducnguyen67201/asdfaefqwefq/pull/63#discussion_r3939891018

The API rate limiter now returns the stable `rate_limited` code. The Coach client
requires HTTP 429, that code, `retryable: true` and the API's `Retry-After` header
before treating the rejection as pre-dispatch. Provider error bodies can be
forwarded, but their headers are not; an unverified 429 remains an unknown outcome.

An individual explanation pauses on that verified rejection and retains its
claim, model turn, prior teaching history and unanswered student question. Next
rechecks classroom authority and screen context, then records a fresh request UUID
before dispatch. There is no automatic retry or journal reset. Rejected attempts
still count toward the existing eight-request allowance; exhaustion is reported
as a limit failure. Finish, Stop and the existing expiry bounds remain available.

Regressions cover explicit continuation after 429, reuse of the model turn,
distinct durable request IDs, preserved question/history, uncertain outcomes and
the request cap. The retry regression failed before the fix. The HTTP integration
test proves the API rejection creates no provider request or budget reservation,
returns the expected envelope, and accepts a new request after the limit clears.

## Validation

| Check | Result |
|---|---|
| `npm run check` | Pass: 896 TypeScript tests / 142 files, 24 SDK tests, enabled Rust checks/tests |
| `npm run package` | Pass: macOS arm64 package |
| `npm run bazel:check` | Pass: 13 tests and Clippy/source targets |
| Disposable PostgreSQL classroom suite | Pass: 2 tests, including expired active-report regression |
| `npm audit --omit=dev` | Pass: zero runtime vulnerabilities |
| Full npm audit | Five existing development dependency advisories; lockfiles unchanged |
| `git diff --cached --check` | Pass before commit |
| Hosted checks | Running at review publication |
| Real EN/VI voice / three-device acceptance | Pending before release |

An initial local Bazel attempt collided with regeneration of `admin-dist`; no
source defect was involved. It passed after the admin build finished. The
pre-existing allowed Cargo audit warnings remain documented in the implementation
report. No dependency upgrade or unrelated SDK architecture change is included.

Follow-up verification after the two automatic Codex findings: `npm run check`
passed (903 desktop tests, 24 SDK tests and enabled Rust checks/tests), as did
`npm run package`, `npm run bazel:check` and the isolated PostgreSQL HTTP
compatibility suite. Runtime npm audit remains clean; the five existing development
dependency advisories are unchanged. GitHub checks must pass on the pushed fix
commit before the user-authorized merge. Real classroom acceptance remains pending.
