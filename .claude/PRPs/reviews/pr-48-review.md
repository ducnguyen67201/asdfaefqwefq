# PR Review: #48 — Agents SDK as the sole orchestrator

**Reviewed**: 2026-08-29

**Author**: ducnguyen67201

**Branch**: `codex/remove-action-approval-policy-gates` -> `main`

**Decision**: APPROVE after the recovery fix in this review and exact-head CI

## Summary

The PR establishes the OpenAI Agents SDK as the only planner/orchestrator while
Rust owns durable state, authority, leases, and tool dispatch. Electron advertises
and executes its actual capabilities. The review traced task submission, SDK
claim/checkpoint recovery, steering, desktop and connector dispatch, unknown
outcomes, retention, and public projection end to end.

One high-severity crash-recovery defect and its associated idempotency ordering
defect were found and fixed. No unresolved actionable finding remains in the local
head.

## Findings

### HIGH

- **Resolved — recovery could change the SDK tool graph.** A reclaimed run rebuilt
  its tools from whichever Electron worker and connector routes were online at
  recovery time. If an executor disconnected after the SDK checkpointed or queued
  a call, the reconstructed graph could differ from the graph represented by the
  serialized `RunState`. Migration 033 and `ToolSnapshotStore` now persist one
  encrypted, immutable tool surface on the first compatible claim and load that
  exact surface for every later claim.

- **Resolved — exact call replay depended on the current executor route.** The
  broker previously checked current desktop/connector availability before looking
  up the durable `(run_id, call_id)` invocation. A disconnected executor could
  therefore reject a call the SDK was replaying after recovery. The broker now
  validates the live lease and exact idempotency digest first. Only an existing
  call may use this path; every new call must appear in the frozen surface and
  still pass the current route and schema checks.

### MEDIUM

None.

### LOW

None.

## Ponytail Review

The fix adds one persistence concept—the per-run tool snapshot—because exact SDK
graph reconstruction requires historical data that cannot be derived safely from
current executor state. It reuses the existing encryption envelope, compatibility
identifiers, retention lifecycle, and call broker. No second planner, policy
engine, capability allowlist, or approval mechanism was introduced.

## Validation Results

| Check | Result |
|---|---|
| Rust all-target `cargo check` | Pass |
| Focused agent unit tests | Pass — 6 tests |
| PostgreSQL agent orchestrator integration suite | Pass — 4 tests |
| PostgreSQL compatibility suite | Pass — 2 tests |
| Contract corpus | Pass — 5 tests |
| `npm run check` | Pass — 120 Vitest files / 788 tests plus Rust and audit gates |
| `npm run package` | Pass — macOS arm64 |
| `npm run bazel:check` | Pass — 16 Bazel tests |
| `git diff --check` | Pass |

`cargo audit` reports only the repository's three explicitly allowed upstream
warnings (`ttf-parser`, `lru`, and yanked `chacha20`); it introduced no new failing
advisory.

## Operational Note

Migration 033 deliberately refuses to apply while an `openai_agents_sdk` run is
nonterminal. Deployments must drain those runs before migration so no live run is
silently assigned a tool surface assembled from later executor state.

## Recommendation

Approve after hosted checks and the requested Codex and CodeRabbit reviews pass on
the exact pushed head. Do not merge until the documented migration drain is part
of the deployment procedure.
