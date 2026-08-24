# Implementation Report: Migrate the Hosted Backend to Rust In Place

## Status

**Incomplete — the Rust candidate passes the implemented local gates, but is
not approved for cutover.** The same-service Railway configuration still starts
the JavaScript backend, the JavaScript implementation remains the executable
oracle and rollback path, and the plan remains active.

Local release evidence now includes the 80% coverage gate, PostgreSQL 17,
S3-compatible object storage, provider failure semantics, Google identity
verification, durable-agent execution, the full JavaScript oracle, the locked
Rust release build, repository checks, and Electron packaging. Cutover remains
blocked on exhaustive byte-level differential coverage, performance and soak
evidence, supported-platform CI, staging deployment, rollback/roll-forward
rehearsal, production backups, and explicit operator approval.

## Summary

Implemented a Rust backend candidate in the existing `services/api` service.
The pinned `trocode-api` binary provides `serve`, `ingestion-worker`,
`access-code`, `knowledge-load-report`, and `knowledge-worker-smoke` commands.
It includes typed configuration, embedded migrations, HTTP middleware and
route families, auth/admin/access flows, rate limits and budget accounting,
direct provider transports, Knowledge Spaces and object storage, and a durable
agent state machine with approvals, evidence, fencing, and unknown-outcome
handling.

No new hosted service was introduced. No deployment was performed. No
production data, credentials, or third-party resources were changed. The
Electron renderer and IPC boundary were not changed, and no JavaScript backend
runtime or tests were deleted.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | XL | XL; local implementation is substantial, but deployment proof remains |
| Cutover confidence | 9/10 required | Local candidate is credible; production confidence is withheld until staging/rollback/performance gates pass |
| Rust footprint | About 40 source/test/config files | 45 Rust files; 13,301 Rust lines including tests |
| JavaScript oracle | 130 passing baseline cases | 131/131 pass with disposable PostgreSQL enabled |
| Rust tests | Full replacement coverage required | 36 tests pass, including 8 real PostgreSQL/S3 integration cases |
| Required line coverage | At least 80% | **80.37% — pass** (6,747/8,395 lines covered) |

## Task Status

| # | Task | Status | Evidence / remaining work |
|---|---|---|---|
| 1 | Freeze reference behavior and compatibility corpus | Partial | Route, schema, crypto, parser, and PDF-class inventories exist; exhaustive raw HTTP/SSE replay and a production-shaped 44-table fixture remain. |
| 2 | Scaffold crate, commands, lints, CI, and seams | Complete locally | Pinned toolchain/crate/lockfile, five commands, CI gates, composition, provider/object-store seams, and release profile are present. |
| 3 | Port config, errors, observability, HTTP primitives, assets | Partial | Candidate behavior and major route tests pass; exhaustive status/header/body/static-asset byte comparison remains. |
| 4 | Preserve database startup and migrations | Complete locally | All 18 embedded migrations pass twice on empty PostgreSQL 17 and preserve a Node-initialized database. Protected CI/staging proof remains. |
| 5 | Port auth, sessions, access codes, admin, CLI | Partial | Positive, invalid, idempotent, revoke/block, cookie, access-code, admin, CLI, Google signature/claim/cache paths pass; exhaustive browser and bidirectional crypto corpus remains. |
| 6 | Port plans, catalog, rate limits, turns, budgets, usage | Substantially complete locally | Real PostgreSQL reserve/observe/duplicate/uncertain/settle/snapshot paths pass, including current-month task scoping. Additional high-contention and database-fault testing remains. |
| 7 | Port provider proxies | Partial | Buffered/SSE Responses (including terminal `[DONE]`) and transcription success, language validation, duration billing, 4xx/5xx, malformed, missing usage, wrong content type, dispatch failure, and unknown settlement pass. Cancellation/slow-stream/oversize differential breadth remains. |
| 8 | Port Knowledge Spaces, S3, PDF/text, worker | Partial | Real presigned PUT/HEAD/GET, upload completion, ingestion, checksum/UTF-8/missing-object failures, parser bounds, routes, and idempotency pass. Full real-PDF parity and load/concurrency gates remain. |
| 8a | Port live-classroom flow | Complete locally | Room admission, start/end, typed directives, safe URL claims, Help/Ready/Review transitions, and snapshot/delta dashboards run in the unified Rust binary. A real Axum/PostgreSQL E2E covers the teacher/student flow and exact 200-seat boundary. |
| 9 | Port durable run/effect/approval/evidence ownership | Substantially complete locally | Real PostgreSQL durable task/worker, reconnect, tool grant/result/evidence, approval, cancel, malformed provider, consequential unknown, stale-worker disconnect, deadline/tool expiry, and private-payload cleanup paths pass. Broader concurrency replay remains. |
| 10 | Implement direct Responses agent runner | Partial | Bounded direct loop and fail-closed outcomes pass; input compaction, complete circuit-breaker/pre-event retry parity, trace decision, and full scripted JS/Rust conversation replay remain. |
| 11 | Port routes and prove wire compatibility | Partial | Major route families pass Axum-level compatibility tests; every route/method/body/header/SSE sequence is not yet byte-differentially replayed. |
| 12 | Full verification/security/performance gate | Partial | Fmt, Clippy, tests, 80.37% coverage, audits, release build, repository checks, and package pass. Benchmarks, soak, signal/shutdown matrix, license/secret scan, and supported-platform CI remain. |
| 13 | Switch commands and retire JavaScript | Pending | Node remains the executable oracle and recovery path; Railway and operator commands are intentionally unchanged. |
| 14 | Same-service Railway cutover | Pending | Requires all prior gates and explicit operator approval. |
| 15 | Verify rollback and close migration | Pending | No staging JavaScript rollback/Rust roll-forward rehearsal or production monitoring window has occurred. |

## Validation Results

| Gate | Status | Evidence |
|---|---|---|
| Rust format | Pass | `cargo fmt --manifest-path services/api/Cargo.toml --check` |
| Rust static analysis | Pass | `cargo clippy --manifest-path services/api/Cargo.toml --locked --all-targets --all-features -- -D warnings` |
| JavaScript backend oracle with PostgreSQL | Pass | 131 discovered, 131 passed, 0 failed, 0 skipped |
| Rust unit/contract/property/integration suite | Pass | 36 passed with ignored real integrations explicitly enabled |
| Rust line coverage | Pass | 80.37% (`cargo llvm-cov --all-targets --fail-under-lines 80`) |
| Disposable PostgreSQL 17 | Pass | Empty and Node-populated migration compatibility, idempotent second run, HTTP, budgets, and durable-agent persistence |
| Disposable S3-compatible storage | Pass | Presigned PUT/HEAD/GET, completion integrity, ingestion success/failure/idempotency |
| Provider compatibility | Pass for implemented matrix | Buffered/SSE/transcription success and fail-closed error/ambiguity paths use deterministic upstream fixtures |
| Google identity verification | Pass | Test RSA/JWK signature, issuer/audience/time/email claims, key cache/refresh, unknown key, algorithm rejection |
| Desktop tests | Pass | 107 Vitest files / 761 cases plus 12 auxiliary Node cases |
| Rust dependency audit | Pass with warnings | No vulnerability exit; documented warnings for `ttf-parser` RUSTSEC-2026-0192 and `lru` RUSTSEC-2026-0253 |
| Node backend audit | Pass | 0 vulnerabilities at `high` threshold |
| Locked release build and CLI | Pass | Optimized binary builds; help exposes all five commands |
| Full repository check | Pass | `npm run check` |
| Electron package | Pass | `npm run package`; macOS arm64 package completed |
| Exhaustive byte-level differential | **Blocking** | Major behavior is covered, but zero-difference replay for every REST/binary/SSE contract is incomplete |
| Performance/soak/shutdown/platform matrix | **Blocking** | Not completed |
| Staging/rollback/production | **Blocking** | Not run; external actions and production cutover require explicit approval |

## Production Defects Found and Fixed During Verification

- Knowledge run timestamps were bound as strings to PostgreSQL `timestamptz`,
  causing valid run creation to return 500. They are now parsed, typed, and
  ordering-validated before binding.
- Work-session SQL used ambiguous unqualified timestamp columns. The update now
  qualifies the session values and succeeds under real PostgreSQL.
- Budget reservation aliases used PostgreSQL keywords (`month`, `day`, and
  `task`), making every valid provider reservation fail. The aliases are now
  unambiguous.
- Provider body-read failures and malformed successful transcriptions could
  escape without marking dispatched spend uncertain. These paths now fail
  closed and never retry an ambiguous request.
- Upload initiation/completion accepted insufficiently strict fields. Client
  IDs, source IDs, checksums, per-file/folder limits, and completion payloads
  are now bounded and validated.
- Invalid/empty text ingestion was classified as retryable. Corrupt content is
  now a permanent failure; genuinely missing objects remain retryable.
- Rust omitted the JavaScript maintenance loop for stale desktop workers,
  deadline/tool expiry, and encrypted private-payload cleanup. The same
  lifecycle transitions now run every 60 seconds and are covered against real
  PostgreSQL.
- Responses SSE parsing treated a valid terminal `[DONE]` marker as missing
  usage, leaving settled calls uncertain. The parser now skips terminal and
  malformed non-completion events while retaining the completed usage event.
- Transcription accepted unsupported languages, truncated fractional WAV
  duration before billing, rejected valid empty transcripts, and ignored
  malformed optional language metadata. Validation and accounting now match
  the JavaScript behavior.
- Budget task snapshots included reservations from prior months, and uncertain
  reservations used a Rust-only disposition. Both database contracts now match
  the JavaScript repository.

## Files Changed

| File / area | Action | Notes |
|---|---|---|
| Root `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`; `services/api/Cargo.toml`, `build.rs` | Created/updated | One Cargo workspace for the in-place Rust backend, lockfile, build tracking, dependencies, and release policy |
| `services/api/src/{app,config,db,error,lib,main,observability}.rs` | Created | Composition, startup, migrations, errors, logging, and binary entrypoint |
| `services/api/src/auth/**`, `http/**`, `usage/**`, `providers/**`, `knowledge/**`, `agent/**`, `cli/**` | Created | Backend implementation by bounded domain ownership |
| `services/api/src/classroom/**`, `services/api/src/http/classroom.rs` | Created | Live-room admission, directives, assessment transitions, and facilitator dashboard projections |
| `services/api/tests/**` | Created | Contract/property suites plus real PostgreSQL, S3, HTTP, provider, Google, ingestion, and agent integration tests |
| `docs/operations/rust-backend-cutover.md` | Created | Same-service drain, cutover, monitoring, and rollback runbook |
| `.github/workflows/ci.yml`, `package.json` | Updated | Rust quality gates added while retaining the Node oracle |
| `.env.example`, `README.md`, `.gitignore`, `.gitattributes` | Updated/created | Candidate configuration, operating guidance, LF SQL policy, and ignored build output |
| `services/api/railway.json` | **Unchanged** | Continues to run JavaScript until all release and rollback gates pass |

## Intentional Deviations

- Railway/start and operator-command cutover are withheld because Tasks 13–15
  are gated by parity, performance, staging, and rollback evidence.
- The JavaScript backend, tests, scripts, package, and runtime stay active as
  the differential oracle and immediate rollback implementation.
- Direct `sqlx-core` and `sqlx-postgres` dependencies avoid unused MySQL/RSA
  transitive code and RUSTSEC-2023-0071 while preserving PostgreSQL behavior.
- Compile-time `include_str!` migrations avoid SQLx macro/umbrella features and
  keep all 18 forward migrations in the candidate binary.
- AWS SDK features are limited to the modern HTTPS client and Tokio runtime to
  avoid unnecessary legacy vulnerable transport dependencies.

## Remaining Release Blockers

- [ ] Replay every frozen REST, binary, SSE, provider, and crypto contract
      against Node and Rust with zero unapproved byte-level differences.
- [ ] Add production-shaped database state, concurrency/fault injection, full
      real-PDF parity, downstream cancellation, and slow/oversize stream cases.
- [ ] Complete agent input compaction, circuit-breaker/retry parity, trace
      decision, and scripted recovery/approval/unknown-result conversations.
- [ ] Resolve or explicitly approve the two upstream RustSec warnings without a
      blanket ignore.
- [ ] Pass performance, memory, soak, graceful-shutdown, secret/license, and all
      supported-platform CI gates.
- [ ] Back up and restore-test PostgreSQL and object storage together.
- [ ] Rehearse the same Railway service in Rust, JavaScript rollback, and Rust
      roll-forward in staging.
- [ ] Obtain explicit approval before changing Railway or production state.
- [ ] After the monitoring window passes, retire Node-only backend runtime code,
      archive the plan, and close the migration.

## Artifacts

- Active plan: `.claude/PRPs/plans/migrate-hosted-backend-to-rust.plan.md`
- This report: `.claude/PRPs/reports/migrate-hosted-backend-to-rust-report.md`
- Runbook: `docs/operations/rust-backend-cutover.md`
