# Implementation Report: Live Classroom Room Flow

## Summary

Implemented the live-classroom flow on `feat/live-classroom-room-flow` in the isolated worktree `/Users/ducng/.codex/worktrees/live-classroom-room-flow/TroCode`.

The implementation preserves Tro's canonical `Space → Activity Version → Run → Attempt → Work Session` model and adds room-code admission, a lobby/live session, typed teacher directives, consent-aware safe URL delivery, sticky Activity context, explicit Help/Check/Ready/Submit actions, and teacher Help resolution and review. The desktop-facing live-classroom backend slice is now implemented in Rust as well as the Node compatibility API, sharing the same PostgreSQL schema, opaque sessions, and wire contracts.

Continuous cursor, typing, screen, foreground-window, and passive “stuck” observation remain explicitly deferred.

## Assessment vs Reality

| Metric | Predicted | Actual |
|---|---:|---:|
| Complexity | XL | XL |
| Confidence | 8/10 | 8/10 |
| Files changed or created | 68 | 100 across the full PR, including Rust migration and review artifacts |

## Tasks Completed

| # | Task | Status | Notes |
|---:|---|---|---|
| 1 | Canonical room/directive/review domain | Complete | Additive migration 018, strict schemas, explicit lifecycle states |
| 2 | Secure room create/join/rejoin/leave/start | Complete | HMAC-only stored room codes, transactional idempotent admission, stronger-role preservation |
| 3 | Typed Session Directives | Complete | Exercise/open-URL types, immutable criteria/origin checks, sequence polling, one-time claims |
| 4 | Trusted Electron session/delivery services | Complete | Main-process authority, current-session restore, consent, safe direct browser open |
| 5 | Sticky local/hosted Activity context | Complete | Authenticated Attempt resolution, Help/Check purpose, current directive, hosted parity |
| 6 | Help/Check/Ready/Submit/review | Complete | Explicit Help queue, advisory Check, explicit Ready/Submit, idempotent Complete/Return |
| 7 | Teacher classroom UI | Complete | Materials → Activity → lobby/live room → explicit Help/review queues |
| 8 | Student classroom UI | Complete | Join disclosure, optional link consent, persistent session bar, separate student actions |
| 9 | Security/load/docs/release gates | Complete | Real 200-student PostgreSQL fixture, audits, docs, production package |
| 10 | Rust classroom backend migration | Complete | Axum/SQLx room, directive, assessment, dashboard, auth, rate-limit, and policy slice with Bazel ownership |
| 11 | Node/Rust parity and route isolation | Complete | Shared migration/session/wire contracts; wrong-Run idempotent review replay rejected in both implementations |

## Product and Security Boundary

- Renderer input cannot restore or invent a classroom Attempt; Electron main restores the current authenticated participation from the hosted API.
- Participants cannot browse teacher Library/group controls or see upload/publish/room/dashboard UI.
- Teacher broadcast is an exact, explicit click after preview. No model/tool can broadcast.
- Automatic URL open requires public HTTPS, no credentials/private host, a pinned allowed origin, current student opt-in, active Run, and a successful one-time server claim.
- Help creates an explicit teacher queue item before contextual assistance. Check is advisory and cannot grade, submit, or complete work.
- Teacher dashboards use explicit lifecycle/evidence facts only; they do not infer attention, confusion, speed, or understanding.
- Room codes, directive text, URLs, student content, screenshots, and file details are excluded from logging/analytics.
- Rust startup is opt-in and fails closed unless `DATABASE_URL`, the shared session HMAC key, and migration 018 are present. Ingress cuts over complete classroom route families and can return them to Node without rewriting data.

## Validation Results

| Level | Status | Observed result |
|---|---|---|
| Static analysis | Pass | `npm run check`: runtime versions, ESLint, and TypeScript clean |
| Unit/regression tests | Pass | 113 Vitest files / 791 tests; 12 script tests; 143 API tests passed, 2 DB tests skipped in the non-DB pass |
| PostgreSQL integration/load | Pass | 2/2 tests, including migrations/search and 200 concurrent students with idempotent admission and stronger-role preservation |
| Dependency security | Pass | Root/API `npm audit` and RustSec `cargo audit`: 0 vulnerabilities; unused SQLx MySQL/RSA packages removed |
| Production package | Pass | `npm run package`; arm64 macOS app at `out/Tro-darwin-arm64/Tro.app` |
| Rust unit/static/build | Pass | 12 Rust unit/HTTP tests; `cargo build`; clippy with warnings denied |
| Rust PostgreSQL HTTP E2E | Pass | Full Axum teacher/student flow, wrong-Run replay isolation, one-time directive claim, and exact 200-seat capacity |
| Bazel Rust gate | Pass | Rustfmt, unit, E2E target, and clippy targets passed under `--config=ci` |
| Diff hygiene | Pass | `git diff --check`; no feature-branch `package-lock.json` change |

## Files Changed

| Area | Action | Representative files |
|---|---|---|
| Database/domain | Created/updated | `018_live_classroom_room_flow.sql`, `live-classroom-repository.mjs`, `live-classroom-service.mjs`, policy/contracts/lifecycle |
| Hosted agent authority | Updated | `agent-run-service.mjs`, runtime contracts, hosted instructions/tool catalogs |
| Electron trust boundary | Created/updated | classroom session/directive/URL services, IPC, preload, desktop API, task application service |
| Teacher/student renderer | Created/updated | `ClassroomSessionBar.tsx`, Space/Activity/Run/Attempt/Classwork pages, view helper, CSS, translations |
| Tests | Created/updated | service, PostgreSQL concurrency, session/directive, IPC, task authority, renderer role/state, translation tests |
| Documentation/artifacts | Created/updated | README, architecture/security/Knowledge Spaces docs, archived PRP, GAN spec/rubric/feedback/report |
| Rust hosted API | Created/updated | Axum routes, SQLx services, classroom policy/contracts, config/error boundary, Cargo/Bazel locks and targets |

## Deviations from Plan

- No QR dependency was added. The human-readable short room code is the complete admission path, matching the plan's instruction not to add a dependency silently.
- Optional `join_live_room` and `draft_session_directive` model-tool seams were not added. UI room-code join is complete, and excluding these optional seams keeps join/broadcast authority narrower.
- Teacher Run state is reconstructed from the authoritative dashboard rather than assumed locally. The short-lived plaintext room code is intentionally not recoverable from its stored HMAC digest; leaving the exact room page requires creating/rotating a code when returning through a future Run-history entry point.
- No live packaged two-account sign-in smoke was possible because two authenticated test accounts were not available. The same flow is covered through service, IPC, renderer-state, package, and real PostgreSQL tests.
- The Rust migration is intentionally a vertical route slice rather than a duplicate full API. Node continues to own migrations, identity issuance, materials/publishing, ingestion, submissions, agents, and unrelated `/v1` endpoints until those route families migrate.

## Issues Encountered

- The source repository was on dirty `main` with a pre-existing `package-lock.json` modification. Work moved to an isolated feature worktree, leaving the original changes untouched.
- Visual evaluation could not use an authenticated running classroom. GAN evaluation used code-only inspection and passed at 7.91/10; production packaging validated the compiled renderer.
- SQLx 0.9 did not resolve through the repository's pinned Bazel Crate Universe graph. The Rust service uses SQLx 0.8.6, which passes Cargo and Bazel with the required PostgreSQL/TLS features.
- Final review fixed a cross-Run idempotent review replay scope check in both Node and Rust, corrected Rust directive limits to count Vietnamese text like the TypeScript UTF-16 contract, and aligned the authenticated peer limiter with the 2,000-seat capacity plus retry headroom.

## Tests Written or Expanded

| Test area | Coverage |
|---|---|
| `services/api/test/live-classroom-service.test.mjs` | Role checks, deterministic room code, disabled/invalid rooms, directive criteria/origins, join/review delegation |
| `services/api/test/activity-service.test.mjs` | Help queue ordering and ordinary/Check behavior |
| `services/api/test/integration/knowledge-postgres.test.mjs` | Migration, 200-student concurrency, rejoin/capacity, role preservation, directive claims, review idempotency, isolation, indexes |
| `src/main/knowledge/classroom-session-service.test.ts` | Restore, consent reset, trusted active Attempt, leave/clear |
| `src/main/knowledge/classroom-directive-service.test.ts` | Poll/backoff, stale response, consent, claim/open/dismiss/failure, closed Run |
| `src/main/knowledge/classroom-url-policy.test.ts` | Public HTTPS, exact origin, private/credential rejection |
| `src/main/application/task-application-service.test.ts` | Sticky Attempt inheritance, explicit precedence, hosted authority, non-class parity |
| `src/main/application/hosted-task-client.test.ts` | Same-ID retry for uncertain hosted launch outcomes, definitive rejection handling |
| Renderer/shared tests | Role-safe Space markup, explicit session action mapping, Vietnamese copy, strict schemas |
| `services/api-rs/tests/classroom_e2e.rs` | Node-compatible session auth, complete classroom HTTP flow, review route isolation, one-time claims, and concurrent 200-seat capacity |

## Next Steps

- Run a packaged two-account pilot with real teacher/student sign-in.
- Add a Run-history/reopen entry point if teachers must leave and later return to the same control page during the pilot.
- Keep passive classroom observation in a separate privacy-reviewed PRP.
- Cut over the Rust classroom route families in a small canary only after migration 018 is applied; leave Node route ownership available for immediate rollback.
