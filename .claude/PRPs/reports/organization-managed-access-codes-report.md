# Implementation Report: Organization-Managed Access Codes

## Summary

Implemented organization-managed access as Rust-owned hosted-backend behavior.
A capacity-bearing code is claimed once by an organizer, who reserves the
remaining seats by verified Google email. Matching sign-in atomically activates
membership, redemption, plan, audit event, and session. Pending seats count
toward capacity and the organizer receives a persistent full-state warning.

The hosted backend on `origin/main` is already fully Rust-owned. This change
creates or modifies no `.mjs` backend files. A PostgreSQL trigger also makes the
membership requirement a database invariant instead of relying on one HTTP
entry point.

## Architecture Correction

The archived plan originally required both Node and Rust implementations. That
conflicted with the completed Rust cutover on `origin/main`. Before review, the
branch was rebased onto current main and all Node feature implementation and
tests were removed. The backend ownership is:

- Rust: organization domain, access/session transactions, HTTP routes, admin
  projections, CLI, and tests.
- PostgreSQL: forward-only schema plus the membership safety invariant.
- Electron/React: typed client boundary and organizer experience.

## Tasks Completed

| Area | Status | Notes |
|---|---|---|
| Forward-only schema | Complete | Distribution mode, organizations, memberships, audit events, indexes, fail-closed redemption trigger |
| Rust domain | Complete | Claim, reserved-email auto-join, organizer add/list/cancel, capacity locking |
| Rust HTTP/admin/CLI | Complete | Four organizer routes, admin projections/grants, organization default with explicit shared mode |
| Desktop boundary | Complete | Strict schemas, fixed hosted paths, narrow IPC/preload methods |
| Organizer UI | Complete | Role-gated navigation, capacity state, member list/add/cancel, EN/VI copy |
| Rust/Bazel tests | Complete | Dedicated isolated Bazel target plus disposable-PostgreSQL concurrency test |
| Documentation | Complete | Access flow, security boundaries, architecture correction and cutover note |

## Validation Results

| Gate | Result |
|---|---|
| npm run check | Pass: lint, TypeScript, Rustfmt, Clippy, audit, 815 Vitest, 7 root Node, and 44 runnable Rust tests |
| npm run package | Pass: Darwin arm64 Electron package |
| npm run bazel:check | Pass: buildifier, all 12 API/Bazel test targets, isolated organization target, and Clippy |
| bazel test --config=ci //services/api:organization_managed_access_test | Pass |
| git diff --check | Pass |

Cargo audit retained the repository's two allowed warnings for ttf-parser and
lru; this feature added no dependency.

## Tests and Evidence

| Test surface | Coverage |
|---|---|
| services/api/tests/organization_managed_access.rs | Email policy, capacity policy, migration/rollback invariants, ignored real concurrent last-seat assignment |
| services/api/tests/http_compat.rs | Rust claim, forwarded-code rejection, add/full behavior, paused code, auto-join, active-member protection |
| services/api/tests/contract_corpus.rs | Route uniqueness and migration/table inventory |
| Desktop contract/client/IPC tests | Strict parsing, fixed URLs, sender/access/input validation |
| src/renderer/OrganizationPage.test.tsx | Capacity alert, disabled full form, localization, loading and empty states |

## Deviations and Risks

- Node feature code was removed despite the original plan. Current main has no
  Node hosted backend; the feature is Rust-only and Bazel-isolated.
- The disposable PostgreSQL organization concurrency/HTTP tests are compiled
  but were not executed locally because TEST_DATABASE_URL is unset. They refuse
  non-local databases and database names without a _test suffix.
- The Rust admin API exposes organization seat projections; the Rust CLI is the
  explicit operator surface for choosing organization versus shared
  distribution.
- No deployment, production migration execution, or Railway change was
  performed.
