# Organization-managed access TDD evidence

## Journeys and invariants

1. A newly created Rust access code defaults to organization mode; its first
   verified redeemer becomes the organizer and consumes one seat.
2. The organizer reserves seats by normalized email without account
   enumeration. Pending and active memberships both count toward max_users.
3. Matching verified Google sign-in atomically binds membership, redemption,
   plan, audit event, and device session; the member never enters a code.
4. The access-code row serializes last-seat assignment. One concurrent add
   succeeds and the other returns organization_capacity_reached.
5. Only organizers can list, add, or cancel; only pending reservations can be
   cancelled. Pausing blocks claims and new reservations but preserves active
   access and previously reserved auto-join.
6. Existing codes remain shared. A database trigger rejects any
   organization-mode redemption that lacks an active matching membership.

## RED / GREEN evidence

| Guarantee | Evidence | Type |
|---|---|---|
| Forward-only migration, shared legacy default, membership trigger | services/api/tests/organization_managed_access.rs, services/api/tests/contract_corpus.rs, services/api/tests/postgres_compat.rs | Isolated Rust/Bazel plus migration inventory |
| Organizer claim and forwarded-code rejection | services/api/tests/http_compat.rs | Rust/PostgreSQL HTTP |
| Normalization and assigned-seat capacity | services/api/tests/organization_managed_access.rs | Pure Rust |
| Concurrent last-seat serialization | ignored test in services/api/tests/organization_managed_access.rs | Disposable PostgreSQL |
| Atomic pending claim and entitlement | services/api/src/auth/sessions.rs flow exercised by services/api/tests/http_compat.rs | Rust/PostgreSQL HTTP |
| Admin and CLI distribution behavior | Rust CLI unit tests and services/api/tests/http_compat.rs | Rust unit/HTTP |
| Strict desktop boundary | src/shared/contracts.test.ts, src/main/organization/organization-client.test.ts, src/main/ipc/register-ipc.test.ts | Vitest |
| Full-capacity and localized organizer UI | src/renderer/OrganizationPage.test.tsx | React markup |

## Rust-only ownership check

No Node repository, controller, server route, session, access-code, admin, CLI,
or test implementation exists in this change. No `.mjs` file is created or
modified. The hosted behavior, migration registration, and isolated tests are
all Rust/Bazel-owned.

The isolated Bazel target is:

    bazel test --config=ci //services/api:organization_managed_access_test

It compiles the pure policy and migration tests together with the ignored
disposable-PostgreSQL concurrency test. The target is also part of
npm run bazel:check and the Rust Clippy graph.

## Validation record

Recorded on 2026-08-25:

- npm run check passed lint, TypeScript, Rustfmt, Clippy, Cargo audit, 119
  Vitest files / 815 tests, 7 root Node script tests, and 44 runnable Rust
  unit/contract/property tests.
- npm run package produced the Darwin arm64 Electron package.
- npm run bazel:check passed buildifier, all 12 API/Bazel test targets,
  the isolated organization target, and Clippy.
- bazel test --config=ci //services/api:organization_managed_access_test passed.
- git diff --check passed.

The repository's allowed ttf-parser and lru audit warnings remain unchanged.
No dependency was added.

## Environment-gated evidence

TEST_DATABASE_URL is unset locally. Therefore the Rust organization HTTP flow,
the real concurrent last-seat test, and the existing PostgreSQL compatibility
suites were compiled but not executed. Their guards require a local PostgreSQL
17 URL whose database name ends in _test. No production migration, deploy, or
Railway command change was performed.
