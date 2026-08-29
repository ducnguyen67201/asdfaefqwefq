# Implementation Report: Remove Action Approval and Authorization Gates

## Outcome

Implemented the no-approval runtime described by the PRP. New tasks use authority
contract v9 and runtime protocol v4. Registered, schema-valid tools proceed from
normalization through technical prerequisites and the one-time requested-to-
executing compare-and-swap without a Tro action decision, approval card, or
Balanced/Strict preference.

The exactly-once execution harness remains: exact protocol/catalog negotiation,
tool and operation registration, typed input/effect checks, trusted Workspace
binding, public-HTTPS validation, OS permission waits, cancellation, evidence,
and unknown-consequential-outcome no-retry behavior.

## Major Changes

- Added canonical protocol v4 artifacts and authority contract v9; retained v2/v3
  terminal history through an explicitly legacy, non-interactive adapter.
- Deleted the Rust action policy, intent authorization compiler, Electron policy
  duplicate, approval IPC/UI, approval broker, autonomy settings, and Workspace
  command semantic classifier.
- Simplified desktop execution to validate, satisfy technical prerequisites,
  acquire execution ownership, dispatch once, and record evidence.
- Renamed the native CUA authorization wrapper to an internal capability broker;
  its exact-match, expiring, one-use native capability remains automatic and is
  not a user approval.
- Replaced approval analytics/benchmarks with verified completion, false
  completion, duplicate consequential action, unknown-effect retry, recovery,
  stale-observation, cancellation, intervention, cost, and latency metrics.
- Updated renderer copy and active architecture/security/operations documents to
  describe automatic registered-tool execution and retained prerequisites.
- Rebased onto the main-line migration 029 fix and registered the guarded
  cleanup as migration 030.
- Made the rollout contract honest: this is an atomic v4 cutover after the
  legacy drain, not a configurable observe/dual rollout that the runtime cannot
  execute after the old approval columns are removed.

## Migration Behavior

`029_class_session_materials.sql` now comes from `main`, so databases that
already recorded migration 29 resolve the same migration source.

`030_remove_agent_approval_policy.sql` refuses to run while a nonterminal
protocol-v2/v3 run or any `awaiting_approval` row remains. After the drain, it
removes approval/intent columns and constraints, removes the approval state, and
renames the connector snapshot digest column without recomputing existing digest
values. The backend reports v4-only enforcement as a fixed status; there is no
inert rollout-mode environment switch. No production drain or production
migration was executed by this task.

## Verification

- Protocol generation/check: passed; canonical protocol v4 and catalog digests
  were regenerated and verified.
- `npm run check`: its initial Rust compile exposed a moved URL-normalization
  mutability error. After correction, every remaining component passed:
  rust-only check, ESLint, TypeScript, rustfmt, Clippy with warnings denied,
  Cargo audit, Vitest, and Cargo tests.
- Vitest: 116 files, 724 tests passed, including the permission-resume run-version
  regression.
- Cargo: 80 library tests plus contract/corpus suites passed. Tests requiring a
  disposable PostgreSQL/S3 environment remained ignored by their existing guard.
- `npm run package`: passed for macOS arm64 with the production Doppler config.
- `npm run bazel:check`: passed all 15 Bazel test targets and the Clippy build.
- `git diff --check`: passed.

The PR code and holistic reviews also resolved the stale permission-resume CAS,
v4 integration fixtures, Windows fixture line endings, inert rollout-mode
configuration, Typify constant-field preservation at the HTTP boundary, and
unrelated generated admin bundle drift. Review records are
in `.claude/PRPs/reviews/pr-48-review.md` and
`.claude/PRPs/reviews/pr-48-holistic-review.md`.

Cargo audit exited successfully with the repository's three configured warnings:
unmaintained `ttf-parser`, unsound `lru`, and yanked `chacha20`.

## Follow-up Before Production Migration

Run the active-version query from `docs/agent-runtime-operations.md` against the
target database and require zero active v2/v3 runs. Then deploy the v4-capable
desktop/backend and apply migration 030. Do not bypass the migration guard or
rewrite legacy approval rows into executing work.
