# PR 48 Code Review

**PR:** `refactor(agent): remove action approval gates`

**Base:** `main`

**Review date:** 2026-08-29

**Verdict:** Ready; the findings below are resolved and the required local
release gates pass.

## Scope

Reviewed the full approval-removal cutover across the Electron host, renderer and
IPC contracts, Rust runtime, generated v4 protocol, connector execution,
migration 030, tests, and operational documentation. The review focused on
correctness at the execution boundary, exactly-once behavior, compatibility,
and accidental weakening of the harness that remains after policy removal.

## Findings

### P1 — Permission resume used a stale run version — resolved

The backend advances `runVersion` when an invocation enters and leaves
`awaiting_permission`. `ComputerPermissionCoordinator.requireReady` previously
returned only `granted`, so `DesktopToolWorker` attempted the
requested-to-executing compare-and-swap using the original envelope version.
The first action after an OS permission grant would therefore be rejected as
stale.

The coordinator now returns both the permission outcome and the authoritative
post-decision `runVersion`; the worker uses that version for the execution
claim. A regression test verifies the resumed version is used.

### P1 — Integration fixtures did not match the v4 cutover — resolved

The PostgreSQL compatibility test still expected 28 migrations and 54 domain
tables, and direct service integration fixtures omitted the mandatory v4
protocol/catalog digests. Those tests would fail in CI even though the runtime
contract intentionally rejects such old-shaped submissions.

The migration/table expectations now include migrations 029 and 030, and the
service fixtures carry the exact v4 protocol version and generated digests.

### P1 — Typed HTTP validation stripped a constant negotiation field — resolved

The v4 HTTP handler deserialized strict request JSON into Typify-generated Rust
types and then serialized those types before calling the service. JSON Schema
`const` fields are validation-only in the generated representation, so
`protocolVersion` disappeared and a valid v4 HTTP submission was rejected as an
old desktop.

The handler now validates a cloned value with the generated type and passes the
original strict JSON object to the service. The same preservation rule is used
for v4 cancellation, execution claims, and permission transitions. The exact
CI HTTP compatibility test passes against a disposable PostgreSQL 17 database.

### P2 — Generated v4 JSON had platform-dependent line endings — resolved

The repository normalized v3 fixtures but not the new v4 fixture directory.
Windows regenerated those files with different line endings, failing the
protocol clean-tree check. `.gitattributes` now pins v4 JSON fixtures to LF.

### P3 — Unrelated generated admin bundle drift — resolved

Packaging changed the committed minified admin asset even though no admin
source changed. The asset is restored to `main`, keeping unrelated build-tool
drift out of this PR.

## Review Result

No unresolved correctness, security, or maintainability finding remains from
this pass. The no-approval product decision is intentionally broad, but the
implementation still enforces registered tools and strict schemas, trusted
workspace bindings, public-HTTPS normalization, OS/OAuth prerequisites,
fresh-observation requirements, one-time execution ownership, evidence, and
unknown-consequential-outcome no-retry behavior.

Production migration remains operationally gated: all nonterminal v2/v3 runs
must be drained before migration 030 is applied.

## Verification

- `npm run check`: passed, including 116 Vitest files / 724 tests and all
  non-environment-gated Cargo suites.
- `npm run package`: passed for macOS arm64 using the production Doppler config.
- `npm run bazel:check`: passed all 15 Bazel test targets and Clippy.
- CI's exact PostgreSQL-backed Rust HTTP compatibility command: passed locally
  against a disposable PostgreSQL 17 container.
- Protocol generation check, Rust formatting, staged diff whitespace check, and
  staged secret-pattern scan: passed.
