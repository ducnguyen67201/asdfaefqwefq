# Implementation Report: Rust-Only Hosted Backend

## Status

**Repository migration complete; production deployment not performed.**

`services/api` now contains one backend implementation: the Rust
`trocode-api` crate. Electron main, preload, renderer, and frontend tooling
remain TypeScript/JavaScript clients. The browser Admin asset remains plain
JavaScript because it executes in the browser and is embedded by the Rust
server; it is not a backend runtime.

No Railway deployment, production database mutation, credential change, or
third-party resource change was performed.

## Runtime ownership

The single Rust binary owns:

- HTTP, binary, and SSE routes;
- Google auth, sessions, access codes, and Admin operations;
- usage budgets, rate limits, provider proxying, and transcription;
- Knowledge Spaces, classroom roles, membership, S3, extraction, and ingestion;
- durable agent runs, approvals, evidence, worker coordination, and recovery;
- database migrations and operator commands.

The binary exposes `serve`, `ingestion-worker`, `access-code`,
`knowledge-load-report`, and `knowledge-worker-smoke` commands.

## Cutover changes

- Deleted the service-local Node package lock, all backend `.mjs` modules,
  Node backend tests, and Node backend operator scripts.
- Removed the Node API suite from root and CI commands.
- Routed access-code creation through the Rust CLI.
- Embedded migration 018 in the Rust migrator and advanced the schema corpus to
  18 migrations and 40 domain tables.
- Configured Railway/Railpack to build the locked Rust release binary and start
  `./target/release/trocode-api serve`.
- Kept the worker as the same artifact with the separate
  `./target/release/trocode-api ingestion-worker` command.
- Updated current architecture, testing, classroom, and operating guidance to
  describe Rust as the hosted backend.

## Classroom parity completed in Rust

Knowledge contract v2 is now native to the Rust service. It includes:

- Admin filtering and assignment of `unassigned | teacher | student`;
- conflict-safe role changes with sanitized audit events;
- Teacher-only class creation;
- account-role plus per-class membership authorization;
- owner/facilitator roster visibility;
- idempotent, normalized, bounded 500-email roster batches;
- owner ability to add Teachers or Students and facilitator ability to add
  Students only;
- invite/account role matching and safe restoration of removed memberships.

## Verification evidence

Passed locally:

- Rust format and Clippy with warnings denied;
- Rust unit, contract, property, Google-auth, and parser suites;
- provider-budget durability and fail-closed outcomes;
- locked Rust release build;
- root `npm test`, including the Rust API suite;
- `npm run bazel:check`.

Attempted but blocked by network/tooling in this environment:

- `npm run check` reached `cargo audit --file Cargo.lock`, then failed while
  fetching the RustSec advisory database from GitHub.
- `npm run package` failed during Electron Forge packaging with a GitHub
  connection timeout while preparing native dependencies.

S3-backed ignored tests still require the project’s disposable S3-compatible
test environment. Production and staging rehearsal remain governed by
`docs/operations/rust-backend-cutover.md` and require explicit operator
approval.

## Architecture boundary

The migration does not move local device authority into the hosted service.
Electron remains sandboxed, exposes narrow parsed IPC, and owns local
computer-use execution. The Rust backend stores and coordinates hosted state;
classroom roles do not grant screen, file, conversation, or CUA access.
