# TroCode contributor guidance

## Architecture invariants

- Keep the Electron renderer sandboxed. Never enable Node integration.
- Expose narrow functions through `DesktopApi`; never expose raw Electron IPC or CUA.
- Parse data at IPC and model boundaries with the schemas in `src/shared/contracts.ts`.
- Keep goal compilation, lifecycle transitions, and policy decisions pure and testable.
- Treat CUA as an execution capability. It does not define goals or grant approvals.
- Prefer direct APIs, filesystem, and terminal tools over visual clicking when they are safer and more verifiable.
- Never replay a tool invocation when completion is unknown.

## Implementation and verification

Default to implementing the complete agreed change, then validating it in CI.
This replaces the previous requirement to run full local verification before
every commit.

- Finish implementation, regression test changes, and a source-level diff review
  before starting the first CI cycle. Batch known corrections together.
- Before implementation, inspect the affected integration boundaries: API and
  client contracts, migration history, and the environment needed for acceptance
  testing. For multi-client changes, establish one shared backend and separate
  account profiles early. Do not defer discovering these prerequisites until
  after merge.
- Keep published SQL migrations immutable. Append new versions and register them
  in `services/api/src/db.rs`; include upgrade-path coverage when changing the
  schema or migration logic. CI checks history before expensive builds.
- Do not routinely run local typecheck, lint, full test suites, `npm run check`,
  `npm run package`, or `npm run bazel:check` during implementation or before
  committing. CI owns these verification gates.
- Add or update tests whenever goal routing, lifecycle transitions, policy
  decisions, or IPC contracts change; execute them through CI by default.
- After an authorized push, inspect the CI results, fix the reported failures
  together, and submit the corrected revision for CI. Do not surround each fix
  with another full local validation cycle.
- Use a focused local check only when needed to reproduce or diagnose a specific
  failure, or when the user explicitly requests local validation. Do not expand
  it into the full suite without a concrete reason.
- Require the applicable CI checks to pass on the final PR revision before
  merging. A successful run on an older revision does not validate newer edits.
- If CI cannot run, report verification as pending rather than silently running
  the full suite locally or claiming that the change passed.
- While waiting for CI, use one checks watcher instead of repeatedly querying
  checks, job steps, and review comments together. Inspect detailed logs when a
  check fails or exceeds its expected duration. Keep required progress updates
  brief; report meaningful transitions without repeatedly listing unchanged jobs.

CI runs shared lint and typecheck once per revision. Renderer-only PRs run shared
tests without native packaging; documentation-only PRs run the preflight checks.
Native, backend, dependency, build, and unknown changes run full verification,
including PostgreSQL integration tests before platform packaging. Main and merge
queue runs retain full coverage. Native jobs retain platform regression tests,
but do not repeat lint or typecheck after the source gate passes.

Read `docs/testing/ci-workflow.md` for routing, required check names, and timing
measurement. This workflow does not grant permission to push, create a PR, or
merge.
