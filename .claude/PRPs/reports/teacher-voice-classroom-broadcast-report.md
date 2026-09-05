# Implementation report: teacher voice classroom broadcast

Implemented locally on `codex/teacher-voice-classroom-broadcast`, based on
`a7ffc3a9b5838bc0515cbac22174fecdfc63cea1` (`main`), September 5, 2026.
The feature is ready for review and real-client acceptance. It has not been
merged, deployed, or exercised against a real classroom/provider.

## Delivered behavior

The regular Task microphone and typed assistant use a verified, frozen teacher
session. Exactly two SDK tools, `list_session_assignments` and
`prepare_classroom_broadcast`, list published assignments and prepare an encrypted
local preview. Only **Broadcast to class** commits its reviewed contents.

The API stores a session broadcast separately from legacy Run directives.
Students resolve the published target to their own existing Attempt. An explain
request starts a separate read-only Coach after a student gesture, or after
explicit local consent for a fresh live request while idle. Each Coach uses the
student's assignment, language, own screen and allowance; Next/questions obtain
fresh context. Screen failures fall back to text. No shared action sequence is
replayed across computers.

Starts and sends persist before dispatch. Unknown effects are never automatically
replayed. Explanation rounds persist unique model request IDs and enforce eight
model requests, sixteen observations, and ten minutes. Stop releases local
execution without waiting for backend status delivery. Explanation text is saved
in task history. Work Session provenance and teacher lifecycle counts remain
separate from Help, readiness, assignment completion, grades and private content.

## Assessment against the plan

| Metric | Planned | Actual |
|---|---|---|
| Complexity | XL | XL; teacher authority, durable effects, API transactions and per-device lifecycle |
| Files | 78 estimated | 71: 36 modified, 35 new, including plan/report/testing docs |
| Dependencies | Existing stack | No package or lockfile changes |
| Confidence | 8/10 | Automated boundaries pass; real EN/VI voice and multi-device acceptance remain open |

The pre-existing `agents-sdk-skill-architecture.plan.md` was preserved unchanged.

## Implementation tasks

| Task | Result |
|---|---|
| 1. Contracts and semantics | Strict additive schemas, bounded payloads and compatibility defaults |
| 2. Broadcast storage | Migration 034, explicit migration registration, schema inventory |
| 3. Teacher APIs | Ownership/role revalidation, serial session sequence, idempotency and receipts |
| 4. Student feed | Owned anchor participation, independent cursor and sibling Attempt resolution |
| 5. Typed client/capabilities | Nine endpoint methods, strict responses and separate capability versions |
| 6. Teacher context/resolver | Opaque selection, stale response guards, EN/VI exact title and ordinal resolution |
| 7. Durable preview | Encrypted prepare/send/unknown states; concurrent confirmation and GET reconciliation |
| 8. SDK tools | Exactly two host adapters; neither can commit or acquire student computer authority |
| 9. Existing voice routing | Frozen destination; class/task changes preserve transcript; verified teacher routes to SDK |
| 10. IPC/preview | Authorized main-window handlers, narrow preload, bilingual exact-content preview |
| 11. Student notices | Independent polling, bounded retained cache, manual links and own assignment opening |
| 12. Guidance policy | Default-off local consent, expiry, busy admission, no catch-up auto-start |
| 13. Start claims | Migration 035, unique broadcast/student claim, work provenance and monotonic reports |
| 14. Local coordination | Encrypted pre-claim journal and shared task admission; no duplicate Work Session |
| 15. Adaptive Coach | Actual assignment input, one grounded visual step, text fallback and explicit continuation |
| 16. Cancellation/accounting | Durable request identities/counters, authority checks, Stop/restart handling and private summaries |
| 17. Student/teacher controls | Start/text-only, consent, Next/question/Finish/Stop, teacher explanation activity |
| 18. Independent contexts | Mocked N=200 isolation; distinct own Attempts and two-device claim tests; live load not measured |
| 19. Recovery/multilingual tests | SDK, service, IPC, EN/VI React controls and disposable PostgreSQL tests |
| 20. Composition/docs | Startup/logout/shutdown integration, additive capabilities and behavior documentation |
| 21. Validation/acceptance | Automated checks complete; real-client acceptance pending |

## Validation evidence

The consolidated `npm run check` initially stopped at lint. After correcting its
failures, the remaining constituent checks were run directly; the whole wrapper
was not needlessly restarted. Final lifecycle fixes were checked in their affected
scope. These are observed results, not a claim that the initial wrapper exited 0.

| Check | Result |
|---|---|
| Agents SDK check | Passed lint/typecheck and 24 tests across 5 files |
| Admin build/runtime-version/Rust-engine checks | Passed |
| Root ESLint | Passed after fixing three formatting/import findings |
| TypeScript | Passed, including final added UI tests |
| Full TypeScript suite | 141 files / 883 tests passed before final lifecycle additions |
| Lifecycle regression scope | 8 files / 53 tests passed |
| Teacher routing/admission scope | 1 file / 14 tests passed |
| Final recovery/model-ID/screen fallback scope | 4 files / 33 tests passed |
| Bilingual student UI | 1 file / 2 tests passed; render makes no start/consent/continue call |
| Rust fmt / Clippy | Passed |
| Rust test suite | Passed, including 73 unit tests and all enabled integration/property tests |
| Cargo audit | Exit 0 with three pre-existing allowed warnings; no dependency changes |
| Bazel | 13 tests passed; Clippy and runtime-source build passed |
| PostgreSQL classroom HTTP suite | 2 ignored-by-default tests explicitly run and passed |
| PostgreSQL compatibility suite | 2 ignored-by-default tests explicitly run and passed |
| Electron package | Passed; `out/Tro-darwin-arm64/Tro.app` |
| Diff whitespace | Passed |

The audit warnings concern `ttf-parser` 0.25.1 (RUSTSEC-2026-0192), `lru` 0.16.4
(RUSTSEC-2026-0253), and yanked `chacha20` 0.10.1. They were not introduced here.
Unrelated integrations requiring S3/provider/test services remain skipped by the
repository's normal test configuration.

Database validation used a disposable PostgreSQL 17 container on port 55439,
with a database named `tro_classroom_broadcast_test`. The actual app database was
not reset or migrated. Both HTTP tests passed together, including the existing
live-classroom flow and the new broadcast/guidance flow. Both complete-chain
migration compatibility tests passed. Test credentials were local disposable
values, not application credentials.

Transient command evidence is in `/tmp/tro-broadcast-*.log`; the durable summary
is this report and `docs/testing/teacher-voice-classroom-broadcast.tdd.md`.

## Corrections and deviations

- The plan assumed migrations were automatically discovered. This repository
  explicitly registers each migration in `services/api/src/db.rs`. The disposable
  DB run exposed the omission; 034/035 are registered and a registry test protects
  the complete sequence. A stale Postgres compatibility count is now 35 migrations
  and 62 total tables (61 domain tables plus migration bookkeeping).
- Shared schemas, classroom IPC and preload live in focused modules and are
  exported through the existing boundaries, keeping the larger files manageable.
- Guidance uses its dedicated coordinator status reporter rather than the generic
  ActivityProgressReporter, preventing accidental Help/academic transitions.
- Claims return a strict record with `ownedByThisRequest` and lifecycle status
  rather than duplicating it with a claimed/already-claimed wrapper discriminator.
- Prepared drafts become stale on session selection changes, including switching
  away and back. Active/pending student notices survive bounded cache eviction.
- Explanation histories retain displayed text. Waiting continuation handlers are
  installed before publishing, and late starts/terminal reports stay bound to
  their original journal instead of replacing a newer task.
- macOS requires existing screen/accessibility grants. Windows/Linux use an
  already connected source; otherwise guidance starts in text-only mode.
- The plan's 200-client exercise uses mocked model calls. It provides isolation
  evidence, not production throughput, provider latency, or real language quality.

## Remaining release acceptance

Use an isolated test classroom with a teacher and three distinct student clients.
Follow the procedure in `docs/testing/teacher-voice-classroom-broadcast.tdd.md`:
real EN/VI voice → preview → explicit send; editor/browser/text-only explanations;
fresh context on Next; independent Stop; live opt-in versus busy/reconnected
clients; no Help/completion leakage. These real-device/provider checks were not
performed or represented as passing. No production migration, merge, publish,
classroom delivery, or paid model evaluation was performed.

Deploy the API/migrations before rolling out compatible teacher/student clients.
The generated local package uses the repository's production build configuration;
packaging is not deployment and does not enable the feature on the hosted API.

Implementation plan archived at `.claude/PRPs/plans/completed/teacher-voice-classroom-broadcast.plan.md`. Live acceptance remains a release gate, as listed above.

## PR preparation and Ponytail follow-up

The requested Ponytail review follows the repository's established convention:
a potential-issues pass, not a separate installed bot. Regressions reproduced
before fixes: empty feeds hid session consent; completion during the final start
journal write was overwritten by a later expiry cancellation. Both are corrected
with service/UI and deferred-lifecycle coverage. Retention now releases an old
pending notice before acquiring its replacement.

The API also rejects delayed active reports after guidance expiry or assignment
window closure, and serializes status reports with session closure. Classroom
PostgreSQL tests now run in hosted CI alongside the other serialized DB suites.
The PR verification results and exact head are recorded in the PR review artifact.

PR preparation reran `npm run check` successfully as a single command: 896 tests
across 142 TypeScript files, 24 SDK tests, and all enabled Rust checks/tests.
The isolated classroom database suite and Bazel passed after the API review fix.
`npm audit --omit=dev` reports zero runtime vulnerabilities; the full audit's
five existing development dependency advisories are unchanged by this PR.
