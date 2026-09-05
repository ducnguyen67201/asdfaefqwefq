# Implementation and CI workflow

Implement the agreed change and its regression tests, review the source diff,
then run CI. Batch review findings and CI failures into a correction pass. Avoid
full local lint, typecheck, test, and packaging runs between edits. A focused
local reproduction remains appropriate when needed to diagnose a specific bug.

Before coding, inspect contract compatibility and the acceptance environment.
For classroom changes, identify the common API URL, deployed revision, separate
teacher/student accounts, and migration baseline. A passing fresh-database test
does not establish that an existing deployment can upgrade.

## Check selection

`scripts/ci-plan.mts` compares the whole PR against its base, including deleted
files and both sides of renames. It does not classify only the newest commit.
Unknown paths default to full verification.

| Change | Shared source checks | Rust integration | macOS/Windows packaging |
|---|---|---|---|
| Known documentation paths only | No | No | No |
| Renderer TS/TSX/CSS, root CSS, or TS unit tests only | Yes | No | No |
| Main/preload/shared contracts, backend, SDK, admin, native, dependencies, CI/build files, or unknown paths | Yes | Yes | Yes |
| Push to main, merge queue, or manual workflow run | Yes | Yes | Yes |

The preflight runs on every event, including docs-only PRs. It tests the routing
code and rejects changed, renamed, or deleted SQL migrations already in the base
revision. New migrations require unique increasing versions and a source
reference in `services/api/src/db.rs`. This is a static safeguard; it does not
query a live database or prove that the new SQL is valid. The existing PostgreSQL
upgrade/restart and HTTP integration tests run in the Rust job for full changes.

`source` runs SDK checks, root lint, root typecheck, and TS tests on Linux. The
Rust job runs formatting, audit, Bazel lint/tests/build, PostgreSQL integration,
runtime-version checks, and the Rust-only script-layout check. These two jobs
run concurrently after preflight.

Platform packaging waits for those checks, so migration or source failures stop
the expensive native builds. Native jobs retain OS-specific TS and Rust tests.
Each platform then calls `package:ci` once: the packaging hook builds the Rust
release binary and SDK, and the package command builds the admin assets. There
is no preceding standalone API release build or SDK build. The explicit CI
typecheck receipt disables repeated webpack typechecking and uses SDK emit-only
compilation; normal dev/release commands still typecheck as before.

## Required checks and retries

The existing `verify (macos-latest)` and `verify (windows-latest)` names remain.
Both explicitly fail if a required upstream job fails, is cancelled, or is
unexpectedly skipped. For docs/renderer-only changes, they acknowledge the
successful applicable checks without installing dependencies or packaging.
Keep both required in branch protection. The `rust-backend` name is unchanged;
it intentionally skips when no Rust verification is required. No workflow-level
path filter leaves required checks pending.

New commits cancel obsolete runs for the same PR. Main and merge-queue runs have
separate groups and are not cancelled by PR updates. The final PR revision must
pass before merge. No previous revision's success is reused for changed code.

## Measure the improvement

The baseline PR #64 CI run `33956067760` took 19m 14s on Windows, including
4m 33s of checks, 5m 18s of API release building, and 6m 17s of packaging.
These timings are a baseline, not a prediction of the revised workflow.

After activation, inspect the first renderer-only PR and first full PR with:

```bash
gh run view RUN_ID --json createdAt,startedAt,updatedAt,jobs
```

Compare queue time, source checks, Rust checks, platform builds, and the number
of revisions needed before merge. The preflight job summary records the selected
checks. Renderer PRs should have no native build steps; full PRs should have one
explicit typecheck per TypeScript project and one release/package build per OS.
Actual time savings remain unmeasured until hosted CI runs this workflow.

PR #65 run `33960581684` confirms the same pattern: the macOS root typecheck
took about 14 seconds, its standalone Rust release build took 2m 54s, and the
packaging pre-hook took another 3 minutes. The npm and Rust caches were restored.
The pre-hook runs Rust compilation and SDK staging concurrently, so its duration
alone cannot attribute all three minutes to Rust. New `[package]` timing lines
report each operation separately.

The Rust build script previously watched the nonexistent `services/api/public`
directory. It now watches the actual `admin-dist` directory. Cargo's
[rebuild troubleshooting guide](https://doc.rust-lang.org/cargo/faq.html#why-is-cargo-rebuilding-my-code)
identifies missing `rerun-if-changed` paths as a cause of repeated build-script
execution. Removing the separate release build also avoids rebuilding after
the package command regenerates embedded admin assets.

When waiting on a PR, use one checks watcher instead of repeatedly fetching
checks, job steps, and comments together. Inspect detailed logs on failure or
unexpected delay. Polling less reduces orchestration overhead and noise; it does
not make the hosted compiler run faster.
