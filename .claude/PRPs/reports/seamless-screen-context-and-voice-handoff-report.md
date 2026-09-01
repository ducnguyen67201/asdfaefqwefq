# Implementation Report: Seamless Screen Context and Voice-to-Task Handoff

## Summary

Implemented one model-facing `observe_context` tool backed by trusted Electron/CUA routing. `scope: auto` now attempts the current non-Tro application surface first and falls back to a guarded desktop capture. Desktop fallback temporarily hides Tro-owned windows with a serialized, reference-counted lease and restores only auxiliary surfaces that remain logically active.

Completed the required-first-tool protocol and observation delivery path so screen-dependent first turns are grounded before answering, screenshots and bounded observation metadata reach the Agents SDK, and the latest observation remains available for subsequent controls.

Fixed Voice-to-Task presentation ownership. An accepted Task no longer retains a terminal Voice Island, live task planning/work takes precedence over stale voice completion, and the Electron presenter refuses to reveal Tro for `done` paired with a nonterminal task.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---:|---:|
| Complexity | Large | Large |
| Confidence | 9/10 | 9/10 |
| Product/code files changed | 30 | 32 (28 updated, 4 created) |

The two additional files were existing analytics/contract test fixtures updated to remove stale observation tool identities.

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Stabilize required-first-tool and observation results | Complete | Protocol v3, named first tool, image/metadata delivery, and latest observation are in place. |
| 2 | Publish one strict `observe_context` tool | Complete | Removed both old model-facing observation names and made the unified tool always available. |
| 3 | Route through CUA and suppress Tro on fallback | Complete | Surface-first routing plus exception-safe, overlapping capture leases. |
| 4 | Migrate screen and walkthrough policy | Complete | Visible-context starts use `observe_context`; walkthroughs require desktop scope. |
| 5 | Hand successful voice Tasks to task presentation | Complete | Task acceptance clears terminal voice feedback and reuses the existing processing state. |
| 6 | Add defensive presenter guard | Complete | `done + nonterminal task` has no UI side effects or reveal fallback. |
| 7 | Close catalog, durability, presentation, and privacy regressions | Complete | Added cross-layer contract, routing, cleanup, state, and stale-name coverage. |
| 8 | Run release gates and package | Complete | Automated gates and macOS arm64 packaging passed; interactive Scratch/permission matrix remains a manual product check. |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Focused feature tests | Pass | 12 files, 147 tests |
| Agents SDK runtime | Pass | Lint, typecheck, 5 files / 16 tests |
| Repository static analysis | Pass | ESLint, TypeScript, Cargo fmt, Cargo clippy |
| Repository unit tests | Pass | 126 Vitest files / 842 tests; 69 Rust unit tests plus available integration contracts |
| Security audit | Pass | Root and runtime npm audits: 0 vulnerabilities; Cargo audit reported only 3 repository-allowed warnings |
| Package | Pass | Electron Forge packaged arm64/darwin successfully |
| Diff hygiene | Pass | `git diff --check` clean; unrelated `.media/*` and `.tours/*` changes preserved |
| Interactive packaged matrix | Pending manual | Requires a foreground Scratch exercise and toggling macOS Screen Recording/Accessibility permissions |

## Files Changed

### Created

| File | Lines | Purpose |
|---|---:|---|
| `src/main/agent/screen-context-policy.ts` | 47 | Selective visible-context grounding policy |
| `src/main/agent/screen-context-policy.test.ts` | 36 | English/Vietnamese policy coverage |
| `src/main/presentation/desktop-observation-guard.ts` | 101 | Serialized Tro-window suppression leases |
| `src/main/presentation/desktop-observation-guard.test.ts` | 81 | Overlap, state-change, destruction, and idempotence coverage |

### Updated

| Area | Files | Purpose |
|---|---:|---|
| Bundled Agents SDK runtime | 6 | Protocol v3, named initial tool choice, start/resume behavior |
| Electron runtime adapter | 2 | Grounded context retention and multimodal observation delivery |
| Tool catalog and execution | 8 | Unified schema, catalog identity, CUA routing, walkthrough policy, tests |
| Task application boundary | 2 | Selective `observe_context` requirement and tests |
| Electron window/presentation | 7 | Capture-guard wiring, lifecycle precedence, presenter invariant, tests |
| Renderer voice flow | 5 | Task handoff disposition, Voice Island clearing, and fixture updates |
| Shared test fixture | 1 | Unified observation tool identity |

## Deviations from Plan

- The plan estimated 30 product/code files. Actual scope was 32 because `src/renderer/insights.test.ts` and `src/shared/contracts.test.ts` also contained live old tool identities and were updated to satisfy the no-alias invariant.
- The successful Task handoff is implemented through the shared terminal-activity helper with an explicit `task_submitted` disposition. This keeps all timer cleanup in one renderer boundary while producing the planned immediate clear behavior.
- The interactive packaged validation matrix was not automated because it requires a real Scratch window and user-controlled macOS permission changes. Packaging itself completed successfully.

## Issues Encountered

- Root lint found one import-order error; the import was reordered and the gate rerun successfully.
- Root typecheck found an argument-less Vitest mock whose calls were inspected; the mock boundary was typed with its input and the gate rerun successfully.
- Cargo audit emitted the repository's three allowed dependency warnings (`ttf-parser`, `lru`, and a yanked `chacha20`); no new high-severity npm vulnerability was found.
- Post-PR review found that desktop preparation defaulted to a no-op and that Workspace isolation lacked a task-boundary regression test. Desktop capture now fails closed without the trusted guard, and both cases are covered.

## Tests Written

| Test File | New coverage |
|---|---|
| `services/agent-runtime/test/protocol-and-graph.test.ts` | Named initial tool and unavailable-tool fail-closed behavior |
| `src/main/agent/screen-context-policy.test.ts` | Visible-context and selective skip policy |
| `src/main/application/task-application-service.test.ts` | Required unified tool and ordinary request behavior |
| `src/main/agent/cua-semantic-agent-tools.test.ts` | Always-available unified schema, auto/desktop normalization, invalid combinations |
| `src/main/agent/execution-coordinator.test.ts` | Surface success, desktop fallback, cleanup on success/failure |
| `src/main/agent-runtime/agent-runtime-adapter.test.ts` | Screenshot/metadata delivery and latest observation identity |
| `src/main/presentation/desktop-observation-guard.test.ts` | Nested leases, logical deactivation, destroyed windows |
| `src/main/presentation/presentation-policy.test.ts` | Voice committing/complete to task thinking/working handoff |
| `src/main/presentation/electron-presentation-presenter.test.ts` | No reveal or mutation for stale nonterminal done |
| `src/renderer/voice-route.test.ts` | Task submission yields while Dictation feedback remains |

## Next Steps

- Run the packaged manual matrix with Scratch frontmost, including semantic-disabled fallback and Screen Recording denial.
- Review the implementation diff before creating a PR.
