# Teacher voice classroom broadcast verification

Implementation branch: `codex/teacher-voice-classroom-broadcast`.

## Automated coverage

- Strict additive TS contracts, Vietnamese assignment references, deterministic
  Rust/TS payload digest, exact two-tool SDK schema admission.
- Teacher context ownership and stale selection completion; durable encrypted
  draft creation, concurrent confirmation, unknown outcome without POST replay.
- Session polling cursors, A→B→A stale response rejection, reconnect provenance,
  manual-only link/assignment opening and terminal session cleanup.
- Student admission consent/expiry/busy rules, bounded pending notices, duplicate
  claim suppression and exact continuation revision matching.
- Coach supplies actual published assignment context and student language;
  refreshes observations, rejects multiple visual targets and stale pointers.
  The N=200 test uses mocked model calls with independent Attempts/screens.
- Disposable PostgreSQL HTTP test exercises sibling assignment resolution,
  concurrent broadcast saves, changed idempotency payload, separate student start
  ownership, work provenance without Help and retained receipts after close.

## Validation commands

Required validation: `npm run check`, `npm run package`, and `npm run bazel:check`.
The root check includes `agent-sdk:check`; avoid running the SDK suite twice.
Rerun failed checks and any checks invalidated by a correction.
The ignored database suite must use a disposable local PostgreSQL 17 database
ending in `_test`; its helper drops the public schema. Never use configured app
or production databases. Execute `cargo test --manifest-path
services/api/Cargo.toml --test classroom_e2e -- --ignored --test-threads=1` with
that isolated `TEST_DATABASE_URL`.

## Manual acceptance on updated clients

1. Use one teacher and three distinct student accounts on an isolated test class.
   Open a session containing two published assignments; join all three students.
2. In regular voice Task, say “Explain Assignment 1 to the class.” Verify the
   preview names that session/assignment and nothing is delivered until the click.
3. Confirm once. Students see the same assignment identity and their own Attempt.
   A learner on a sibling assignment remains joined to the original feed anchor.
4. Student A opens a starter editor; B has assignment instructions in a browser;
   C chooses text-only. Start explanation and verify each answer uses its own
   context. Change A's screen, press Next, and verify a new observation.
5. Stop one student. The others continue. Verify no Help request, ready-for-review
   signal, assignment completion or grade is emitted by explanation lifecycle.
6. Test live opt-in with an idle student, a busy student, a later joiner and a
   reconnecting client. Only the fresh idle opted-in client may start automatically.
7. Switch teacher classes while recording; the transcript must remain a draft.
   Close the class, remove a student's membership, sign out and restart during a
   send/start. No unknown effect may automatically replay.
8. Verify old-server capability absence leaves legacy directives working, and
   old clients are not counted as having received the new feed.

## Evidence status

Automated verification on September 5, 2026:

- All root-check constituents passed after lint/type fixes; the initial wrapper
  stopped at lint and was continued through its constituent scripts.
- Full TypeScript suite: 883 tests / 141 files passed. Final lifecycle changes:
  53 affected tests passed; routing/admission: 14 passed; durable model identity
  and screen fallback: 33 passed; bilingual student controls: 2 passed.
- SDK check: 24 tests passed. Rust fmt, Clippy, all enabled Cargo tests, and Bazel
  (13 tests) passed. Cargo audit returned success with three existing allowed
  warnings; see the implementation report for details.
- PostgreSQL 17: both classroom HTTP tests and both migration compatibility tests
  passed in a disposable local database. Migrations 034/035 are explicitly
  registered; there are 35 migrations and 61 domain tables.
- Final Electron package passed: `out/Tro-darwin-arm64/Tro.app`. No real EN/VI voice/provider or
  three-device acceptance, paid model load, deployment or classroom delivery was
  performed. The 200-student test uses mocks.

The complete evidence and deviations are recorded in
`.claude/PRPs/reports/teacher-voice-classroom-broadcast-report.md`.

Recovery note: status PATCHes use monotonic revisions; pending reports remain in
the encrypted owner journal. Sign-in/startup reconciles status without replaying
model calls. A start that reached dispatch is shown as interrupted/unknown after
restart. An explicit new ordinary question remains a separate student task.

## PR review verification

A fresh full `npm run check` passed after the Ponytail fixes: 142 TypeScript
files / 896 tests, 24 SDK tests, all enabled Rust checks/tests. The two classroom
PostgreSQL HTTP tests passed with the delayed active-report expiry regression.
Bazel passed; `npm audit --omit=dev` found zero runtime vulnerabilities. Full npm
audit reports five existing development dependency advisories; no dependency
versions were changed by this feature.

New regressions cover a verified empty feed and consent before the first notice,
completion during the final encrypted start write, and expired active reports
that must leave an Attempt assigned. The CI PostgreSQL step now includes the
classroom integration suite. Real three-device acceptance remains pending.

The automatic Codex review added regressions for text-answer history in stateless
Next requests and explicit continuation after API throttling. They failed before
the fixes. The follow-up full check passes 903 TypeScript tests and 24 SDK tests.
The HTTP compatibility suite also proves that a verified rate-limit rejection
creates no provider request or budget reservation, and a fresh request succeeds
after the limit clears. Client tests distinguish API rejections from uncertain
provider outcomes, preserve pending questions/history and the model turn, and
enforce the existing eight-request cap including rejected attempts.
