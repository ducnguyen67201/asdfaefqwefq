# PR #19 Review: Live Classroom Flow on the Unified Rust Backend

## Pull request

- URL: https://github.com/ducnguyen67201/TroCode/pull/19
- Base: `main` at `16b401420054687a0d5333e7059eed7317256a1b`
- Head: `feat/live-classroom-room-flow`
- Reviewed source head: `cd1f415112e45e9f1321a00cc20c2812d2df44eb`
- Scope: 107 files, 16,379 additions, 761 deletions

## Verdict

Approve. No unresolved critical, high, medium, or low actionable finding
remains after the requested code-review and Ponytail passes.

The review covered the complete PR diff and its executable trust boundaries:
teacher/student role enforcement, room admission and capacity, Run/Attempt
lifecycle transitions, directive URL validation and one-time claims, Help and
review queues, submission authority, dashboard privacy, Electron IPC/preload
validation, local and hosted Activity context, Node/Rust response parity,
migrations, rollback compatibility, and the database-backed end-to-end path.

The intentionally retained Node classroom implementation is a migration oracle
and rollback path while the production entry point is the unified Axum/Rust API;
it is not a second production backend.

## Findings addressed

- Scoped idempotent teacher review replays to the exact Attempt, Run, and Space.
- Rejected unknown nested Rust directive fields and matched TypeScript UTF-16
  limits for Vietnamese text.
- Preserved 200-seat shared-network admission without weakening the per-user
  limiter and exercised that boundary through the real HTTP router.
- Removed the unused MySQL/RSA SQLx dependency graph and earlier redundant HMAC,
  conversion, wrapper, and renderer state paths.
- Bound hosted Activity runs to an owned open Attempt and active Work Session;
  Rust now carries the same Help/Check context and classroom tool catalog as the
  desktop/Node compatibility implementation.
- Allowed an explicit Ready action directly from `assigned`, so a student who
  completed teacher-directed work manually does not need to start an agent first.
  Ready still requires an open Run and is rejected in the lobby, outside the Run
  time window, after submission, or for terminal Attempts.
- Added `launchTarget` to the trusted session projection. Workspace/Python Help
  and Check now route through classwork workspace selection instead of attempting
  an untrusted workspace launch from the compact session bar.
- Added published guidance policy, observable criteria, and completion policy to
  both Node and Rust hosted-agent instructions, with an explicit untrusted-content
  boundary. This resolves the existing P1 hosted-guidance review comment.
- Made room auto-open consent part of the single renderer-to-main join request,
  stripped it before the server request, and initialized directive polling from
  the current sequence. Joining an open room can therefore process the current
  instruction without racing consent or consuming historical links. This
  resolves the existing P1 join-consent review comment.

## Requested review passes

- Code review: complete. All repository and GitHub review findings were
  reproduced or validated against the current Rust-integrated head and fixed.
- Ponytail review: complete. The remaining Node/Rust overlap is required for
  migration verification and rollback; no speculative abstraction, pass-through
  wrapper, unused schema field, unreachable branch, or removable dependency
  remains. **Lean already. Ship.**
- Security review of changed boundaries: complete; no unresolved finding.

## Validation

- `npm run check`: pass — 113 Vitest files / 792 tests, 12 script tests,
  146 Node API/compatibility tests, 29 Rust unit tests, contract corpus, parser
  properties, Google auth compatibility, lint, typecheck, rustfmt, and Clippy.
- Real PostgreSQL Rust classroom E2E: pass — room creation/idempotency, lobby,
  open, current/future directive delivery, one-time claim, manual Ready/Return,
  Help/resolve, Work Session, hosted Activity context, review completion, leave,
  terminal rejection, and exact 200-seat admission.
- Real PostgreSQL durable-agent compatibility E2E: pass.
- Earlier final-branch database compatibility passes retained: Rust HTTP parity,
  provider budget transitions, and Node-initialized/Rust migration compatibility.
- `npm run api:build`: pass — optimized unified Rust API.
- `npm run bazel:check`: pass — rustfmt, Rust unit, classroom E2E, and Clippy.
- `npm run package`: pass — arm64 macOS Electron package.
- Root and API `npm audit --audit-level=high`: pass — zero vulnerabilities.
- `cargo audit`: exits successfully with two inherited, repository-allowed
  warnings (`ttf-parser` RUSTSEC-2026-0192 and `lru` RUSTSEC-2026-0253).
- `git diff --check`: pass.

GitHub Actions must rerun against the pushed review commits. GitHub does not
allow an author to approve their own PR, so the technical approval is published
as a review comment if the approval API rejects self-approval.
