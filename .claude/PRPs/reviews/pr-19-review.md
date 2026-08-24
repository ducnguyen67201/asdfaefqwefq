# PR #19 Review: Live Classroom Room Flow and Rust Migration

## Pull request

- URL: https://github.com/ducnguyen67201/TroCode/pull/19
- Base: `main`
- Head: `feat/live-classroom-room-flow`
- Reviewed implementation head: `49e8d7fee2d5d3b87b452620a63e236de4c2e2af`
- Scope at review: 100 files, 20,280 additions, 1,050 deletions

## Verdict

Approve. The reviewed implementation has no unresolved critical, high, or
medium-severity correctness, security, performance, or maintainability finding.

The review covered the complete original classroom PR plus the Rust migration:
role and tenant authorization, opaque session compatibility, room-code HMAC and
capacity behavior, transactional join/rejoin, Run and Attempt transitions,
directive validation and one-time claims, Help/Ready/review idempotency,
dashboard privacy, Axum boundary parsing, SQLx query scoping, Node/Rust wire
parity, Vietnamese input limits, Electron IPC/preload authority, accessibility,
rollout/rollback, and dependency ownership.

## Findings addressed

- Scoped idempotent review replays to the exact Attempt, Run, and Space in both
  Node and Rust; a wrong-Run replay now returns not found.
- Rejected unknown nested directive fields at the Rust boundary.
- Counted Rust directive limits as UTF-16 code units so Vietnamese text matches
  the TypeScript/Node contract instead of being constrained by UTF-8 byte size.
- Raised the authenticated peer join ceiling from 120 to 2,400 while retaining
  the 12/minute per-user limit, so one shared school network can admit a
  2,000-seat Max room plus bounded retry headroom.
- Made the Rust E2E attach one shared peer address to all requests, ensuring the
  capacity test exercises the network limiter as well as database admission.
- Removed the SQLx facade's unused MySQL/RSA dependency graph. Direct
  `sqlx-core` and `sqlx-postgres` ownership reduced the lock graph from 253 to
  227 crates and cleared the RustSec advisory without a waiver.
- Removed duplicate HMAC code, generic one-use config branches, redundant
  sequence conversions, an unreachable integer-conversion error, and an
  unnecessary room-response `Result` wrapper.

## Requested review passes

- Code review: complete; every actionable finding above was fixed and covered
  before this artifact was written.
- Ponytail review: complete; no remaining speculative abstraction, duplicate
  helper, unreachable branch, or unused dependency was found. **Lean already.
  Ship.**
- Security review within changed surfaces: complete; no unresolved finding.

## Validation at reviewed implementation head

- `npm run check`: pass — 113 Vitest files / 791 tests, 12 script tests, 143 API
  tests; two expected database skips in the non-DB pass.
- Node PostgreSQL integration: pass — 2/2, including migrations/search,
  wrong-Run review isolation, and 200 concurrent students.
- `cargo test --workspace --all-targets`: pass — 12 Rust unit/HTTP tests plus
  the environment-gated E2E target.
- Real Rust PostgreSQL HTTP E2E: pass — teacher/student room flow, shared-peer
  capacity, wrong-Run review isolation, Help/resolve, Ready/review, directive
  one-time claim, authentication rejection, and exact 200-seat admission.
- `cargo build --workspace --all-targets`: pass.
- `cargo clippy --workspace --all-targets -- -D warnings`: pass.
- `npm run bazel:check`: pass — rustfmt, unit, E2E, and clippy targets.
- Root/API `npm audit --audit-level=high`: pass — zero vulnerabilities.
- `cargo audit`: pass — zero RustSec vulnerabilities across 227 locked crates.
- `npm run package`: pass — arm64 macOS application package.
- `git diff --check`: pass.

GitHub Actions are monitored after the review-artifact commit is pushed.
