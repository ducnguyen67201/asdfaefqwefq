# Implementation Report: Canonical Agent Runtime Contract v3

## Summary

Implemented a canonical protocol-v3 boundary and exact hosted-tool catalog shared by the Rust API, Electron main, preload, and React renderer. Zod now generates deterministic Draft 2020-12 JSON Schema, a strict tool catalog, separate protocol/tool digests, fixtures, and Typify-backed Rust DTOs. Contract freshness is enforced by the root check and CI.

The runtime now negotiates both digests before v3 work, emits exact OpenAI tool schemas, classifies definite provider/runtime failures as `failed`, treats `blocked` as terminal, persists durable computer-permission waits, and uses version-fenced source-tagged cancellation. Electron/React consume the authoritative lifecycle projection; the system-wide plain-Escape cancellation path and magic permission choice were removed. Direct `browser.navigate` has no CUA prerequisite, with a deterministic `Mở YouTube.` regression proving it dispatches without a permission request.

Generated contract identity:

- Protocol version: `3`
- Protocol digest: `73830587f95a4e6d50fcbfb303c932fb0fab4c2c1c2ce12933c85413fbe35c0f`
- Tool-catalog digest: `a98916e359199bfa2415d87bfcdc8ffc784c9d52e20d752c2628e361f68c3d8e`

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | XL | XL |
| Confidence | 8/10; 9/10 after Typify spike | 9/10 after Cargo, Bazel, package, and live PostgreSQL validation |
| Files Changed | 45-55 | 76 implementation paths: 20 created, 54 updated, 2 deleted; excludes pre-existing organization/knowledge work and this report/plan move |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Generate canonical protocol and tool contracts | [done] Complete | Deterministic Zod → JSON Schema/catalog/manifest/fixtures; Typify compiles under Cargo and Bazel. |
| 2 | Add typed Rust v3 HTTP and worker boundaries | [done] Complete | Typed status/task/event/cancel/permission DTOs with exact digest negotiation; v2 reads retained. |
| 3 | Centralize lifecycle and persistence | [done] Complete | Migration 025, pure lifecycle projection/transition rules, authoritative actions/failures/waits. |
| 4 | Replace generic provider tools with exact catalog tools | [done] Complete | Thirteen one-to-one tools; recursively closed parameters; direct URL/app paths need no CUA. |
| 5 | Classify provider failures safely | [done] Complete | Definite rejection/unavailability becomes failed; ambiguous dispatch/outcome becomes terminal blocked. |
| 6 | Make computer permission durable | [done] Complete | Stable interaction/invocation IDs, ready-only exactly-once resume, continue-without result, narrow IPC. |
| 7 | Scope cancellation and remove global Escape | [done] Complete | Source/command/version fencing; focused Escape suppression; consequential unknown remains blocked. |
| 8 | Consume authoritative lifecycle in Electron/React | [done] Complete | Server projection controls terminal/cancel/steer/wait UI; v2 inference isolated in one adapter. |
| 9 | Add rollout modes and diagnostics | [done] Complete | Typed observe/dual/enforce config and CLI version/digest/mode/active-count/readiness reporting. |
| 10 | Lock CI, docs, and regressions | [done] Complete | Freshness in root check/CI, Cargo/Bazel targets, operations/docs/manual scenarios, original bug regressions. |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | [done] Pass | Protocol freshness, ESLint, TypeScript, rustfmt, Clippy, Cargo audit, Bazel module stability, and diff checks pass. Cargo audit reports only the repository's two allowlisted warnings (`ttf-parser`, `lru`). |
| Unit Tests | [done] Pass | `npm run check`: 104 Vitest files / 618 tests and 63 Rust unit tests pass after merging current `origin/main`. Focused v3 contract, lifecycle, permission, and navigation coverage also passes. |
| Build | [done] Pass | `npm run bazel:check` passes 14 targets and Clippy; `npm run package` produces the arm64 macOS Electron package through the production Doppler environment. |
| Integration | [done] Pass | Disposable PostgreSQL 17: durable agent compatibility, Rust HTTP compatibility, empty migration idempotency, and legacy migration adoption all pass. Test container removed afterward. |
| Edge Cases | [done] Automated | Exact direct navigation/no permission, unknown consequential effects, blocked terminality, duplicate permission resolution, stale/terminal cancellation, strict nested schemas, unknown fields, v2 digest stability. Packaged manual macOS/Windows permission and cross-app Escape checks remain release-runbook steps. |

## Files Changed

| File or group | Action | Scope |
|---|---|---|
| `src/shared/agent-runtime-protocol.ts`, `src/shared/agent-tool-contracts.ts` | CREATED | Canonical Zod protocol and exact hosted catalog |
| `scripts/generate-agent-runtime-contract.mts` | CREATED | Deterministic write/check generator |
| `protocol/*`, `test/fixtures/agent-runtime-v3/*` | CREATED | Schema, catalog, manifest, Bazel data, shared fixtures |
| `services/api/src/agent/{protocol,lifecycle,tool_catalog}.rs` | CREATED | Typify DTOs, pure lifecycle, generated catalog consumer |
| `services/api/migrations/025_agent_runtime_contract_v3.sql` | CREATED | Additive v3 lifecycle/digest/permission persistence |
| `services/api/tests/agent_runtime_contract.rs` | CREATED | Cross-language corpus and direct-navigation contract tests |
| `src/main/hosted/computer-permission-coordinator.ts` and test | CREATED | Durable ready-only permission orchestration |
| `src/shared/legacy-agent-runtime-v2.ts` | CREATED | Single read-only v2 inference boundary |
| `services/api/src/agent/service.rs`, `services/api/src/http/agent_runtime.rs` | UPDATED | Exact provider tools, typed v3 routes, permission/cancel/provider semantics |
| `services/api/src/{config,db,error}.rs`, CLI, Cargo/Bazel/locks | UPDATED | Rollout config, migration embedding, errors, diagnostics, generated dependencies |
| Electron hosted worker/client, application service, IPC, preload | UPDATED | v3 negotiation, projection, permission, exact-once execution, scoped cancellation |
| Renderer App/history/insights/task-execution | UPDATED | Authoritative lifecycle/actions and typed permission UI |
| Shared contracts/DesktopApi and registry/tool adapters | UPDATED | Narrow v3 transport and catalog identity |
| Root scripts/config, CI, README, architecture/operations/computer-use docs | UPDATED | Generation workflow, rollout runbook, release scenarios |
| `src/main/agent/global-task-cancel-shortcut.ts` and test | DELETED | Removed system-wide plain-Escape task cancellation |

## Deviations from Plan

1. Zod's `reused: ref` output produced duplicate anonymous definitions in Typify 0.7.0. The generator uses named metadata plus `reused: inline`, preserving one canonical Zod source while generating valid, deterministic Rust DTOs. `chrono` and `regress` are direct Rust dependencies because generated DTOs enforce timestamp and pattern constraints.
2. The registry now rejects any optional runtime tool not present in the canonical catalog. Adding a provider therefore requires a contract change and regeneration first, matching the user's requirement that every backend change has a contract all consumers follow.
3. At 13:55 local time, an external workspace operation switched the checkout from `codex/organization-settings-and-student-onboarding` to an outdated local `main` and reapplied changes. The work was recovered onto `codex/canonical-agent-runtime-contract-v3`, current `origin/main` was merged, and the four exact overlaps were resolved while preserving both sides. The integration exposed a migration-number collision, so the v3 migration moved from 024 to 025 after `main`'s companion migration 024.

## Issues Encountered

1. Typify initially rejected Zod's anonymous reused definitions; fixed in the generator without handwritten DTOs.
2. Forge required `rewriteRelativeImportExtensions` for the native TypeScript generator imports; enabled and package rerun successfully.
3. Live PostgreSQL testing found the v3 migration missing from the embedded migrator; it is now included as migration 025 after integrating `main`'s migration 024.
4. Live durable-agent testing found the generic operation selector treated file content as an operation. Presence-based selectors now resolve their declared `presentValue`; a regression covers workspace writes.
5. The existing v2 fake provider used obsolete generic function names/arguments. It now exercises the exact catalog schemas while preserving v2 worker/read compatibility.

## Tests Written

| Test File | Tests | Coverage |
|---|---:|---|
| `src/shared/agent-runtime-protocol.test.ts` | 3 | Closed status, blocked terminal projection, permission-state invariants |
| `src/shared/agent-tool-contracts.test.ts` | 3 | Inventory uniqueness, recursive strictness, direct navigation prerequisites |
| `src/main/hosted/computer-permission-coordinator.test.ts` | 2 | Durable ready resume, missing-settings behavior, no synthetic decision |
| `services/api/tests/agent_runtime_contract.rs` | 3 | TS/Rust corpus agreement, digests, exact open URL, blocked lifecycle |
| `services/api/src/agent/lifecycle.rs` | 3 | Blocked terminality, durable permission wait, consequential cancel |
| `services/api/src/agent/tool_catalog.rs` | 1 | Strict catalog, direct URL, presence-based workspace operation |
| Existing worker/registry/task tests | 2+ updated | `Mở YouTube.` no-permission dispatch, server-owned steer/cancel, catalog-only extension |

## Next Steps

- [ ] Run packaged manual macOS permission-return/Escape scenario and Windows no-global-Escape scenario.
- [ ] Start production rollout at `AGENT_RUNTIME_V3_MODE=observe`; use `npm run agent:runtime-versions` before dual/enforce flips.
- [ ] Code review via `/code-review`.
- [ ] Move the uncommitted implementation off `main` or restore the intended feature branch before committing, because the checkout changed concurrently.
- [ ] Create PR via `/prp-pr` after review and branch cleanup.
