# PR Review: #57 — Ground screen-aware tasks without stealing focus

**Reviewed**: 2026-09-01
**Author**: Duc Minh Nguyen (`ducnguyen67201`)
**Branch**: `duc/seamless-screen-context-voice-handoff` → `main`
**Decision**: APPROVE

## Summary

The implementation preserves the intended ownership boundaries: the Agents SDK plans and emits one `observe_context` function call, Electron resolves and checkpoints it, and CUA performs surface-first observation or a guarded desktop fallback. The follow-up request-boundary failure is fixed: Rust accepts the exact named function choice, correlated safe diagnostics cross the SDK/Electron/API boundaries, and Voice-to-Task finalization no longer reports a successful handoff as cancelled. Independent review found no open findings.

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

Resolved:

1. `TaskExecutionCoordinator` allowed desktop observation preparation to default to a no-op. An alternate construction could therefore capture Tro-owned windows. The default now fails closed before calling `cua.observe()`.
2. Workspace isolation was implemented but lacked a task-application regression test. A Workspace request that explicitly references visible context now proves that `requiredInitialTool` is absent.
3. The provider-level named tool choice constrained only `observe_context`, so the model could still supply `scope: desktop` or select the inspection operation on its first call. The host now supplies an exact `observe + auto` contract, the SDK adapter normalizes the first interruption to it before checkpointing, Electron verifies the exact arguments before dispatch, and the requirement survives checkpoint resume.
4. The Rust proxy rejected the Agents SDK's valid named function `tool_choice` before inference. Validation now accepts only `auto` or an exact named function present in the submitted catalog and returns stable coded errors for invalid choices.
5. Model-proxy failures had no shared identity across the task trace and server logs. The SDK now emits bounded structural diagnostics with request/task/turn IDs while excluding prompts, credentials, schemas, screenshots, and results.
6. `isSubmitting` disabled push-to-talk while the transcript callback was still finalizing, producing a misleading `cancelled` event after task submission. Finalizing turns now complete and report `task_submitted`.
7. Codex re-review found that a pending control call could be auto-approved after its observation binding was lost. A follow-up review correctly identified that `pendingCallId` may also refer to an already dispatched or completed journal entry. Electron now owns the distinction: undispatched calls re-check context, while executing or terminal calls replay through the durable idempotency journal so completed/unknown side effects are never duplicated.

### LOW

None open.

## Validation Results

| Check | Result |
|---|---|
| Focused feature tests | Pass — 12 files / 148 tests |
| Agents SDK lint/typecheck/tests | Pass — 5 files / 21 tests |
| Root lint and TypeScript | Pass |
| Root Vitest | Pass — 126 files / 844 tests |
| Cargo fmt/clippy/audit/tests | Pass — 71 unit tests; three repository-allowed audit warnings |
| Electron package | Pass — arm64/darwin |
| Bazel Rust/runtime gate | Pass — 13 tests and 2 build targets |
| npm audit | Pass — 0 vulnerabilities |
| Diff hygiene | Pass |

## Files Reviewed

- Runtime protocol and graph: 6 files
- Electron runtime adapter: 2 files
- Tool catalog, policies, and execution coordinator: 12 files
- Task application boundary: 2 files
- Presentation and voice flow: 9 files
- PRP plan/report artifacts: 2 files
- Shared fixture: 1 file

The pre-existing `.media/*` and `.tours/*` working-tree changes are not part of PR #57.

## Recommendation

Ready for peer review. Interactive packaged verification with Scratch and macOS permission toggles remains the only manual product check.
