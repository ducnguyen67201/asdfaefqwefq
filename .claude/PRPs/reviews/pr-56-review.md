# PR Review: #56 — feat(agent): run OpenAI Agents SDK locally

**Reviewed**: 2026-08-31
**Author**: Duc Minh Nguyen (`ducnguyen67201`)
**Branch**: `codex/codex-local-agent-runtime` → `main`
**Decision**: APPROVE

## Summary

The final PR implements a single-owner local Agents SDK runtime with strict process boundaries, encrypted durable host state, dynamic frozen CUA tools, no-replay handling, and an appropriately reduced Rust provider/accounting boundary. The initial author review found correctness and unnecessary-complexity issues; all were fixed with regression coverage before this approval.

GitHub cannot render the complete diff because it exceeds the 20,000-line diff endpoint limit. The review therefore used the fetched `origin/main...HEAD` Git diff and full local source files as the canonical packet. The PR is large primarily because it deletes generated schemas, fixtures, and the former hosted orchestration implementation: 6,120 additions and 28,088 deletions across 165 files.

## Findings

### CRITICAL

None.

### HIGH

None outstanding.

Resolved before approval:

- `services/agent-runtime/src/local-runtime-server.ts`: awaited turn execution inside the command error boundary so invalid graph/preflight input produces a typed fatal response instead of an unhandled rejected promise; added `local-runtime-server.test.ts`.
- `src/main/agent-runtime/encrypted-agent-state-store.ts`: moved thread ownership validation ahead of writes and made same-owner creation idempotent so a replay cannot reset session/checkpoint state or overwrite another owner's state; added regression coverage.
- `src/main/history/legacy-hosted-task-history-store.ts`: made legacy network/history parsing optional and bounded so an offline or malformed legacy endpoint cannot hide encrypted local history; added regression coverage.

### MEDIUM

None outstanding.

Resolved before approval:

- `src/main/agent-runtime/agent-runtime-adapter.ts`: release per-turn sequence bookkeeping on normal terminal completion instead of retaining it for the process lifetime.

### LOW

None.

## Security and correctness review

- Renderer remains sandboxed; no raw Electron IPC, CUA driver, or credential object crosses preload.
- Credential transfer occurs only after a compatible runtime handshake and is memory-only in the utility process.
- Local thread/session/checkpoint/invocation schemas are strict and bounded.
- Tool catalog and graph are frozen and digest-bound per turn.
- External effects are checkpointed and journaled before dispatch; executing-without-result becomes terminal unknown and is not replayed.
- Dynamic CUA tools retain a driver catalog digest and execute through the trusted main-process service.
- Provider calls remain authenticated, budgeted, user/task/turn-bound, and configured with zero SDK retries.
- The old private orchestration token, routes, leases, worker deployment, and live contract branches have no production consumer.
- Historical migrations and terminal legacy history remain read-only compatibility data.

## Ponytail Review

Resolved during author review:

- `services/agent-runtime/src/config.ts`: `yagni:` unused runtime configuration interface/factory. Removed; constructor defaults remain the single source.
- `services/agent-runtime/src/protocol.ts`: `delete:` unsupported capability labels and unused health/event variants. Removed; add a versioned capability only with an implementation and consumer.
- `src/main/agent-runtime/agent-runtime-adapter.ts`: `delete:` unused health accessor/state. Handshake readiness is the actual health gate.
- `src/main/agent-runtime/local-agent-state.ts`: `delete:` unreachable `requested` invocation status. Checkpointed is the first durable state.
- `src/main/agent/runtime-tool-registry.ts`: `delete:` unused default registry singleton. Composition root owns the registry instance.

Final pass: Lean already. Ship.

net: -0 lines possible.

## Validation Results

| Check | Result |
|---|---|
| Local runtime lint/typecheck/tests | Pass — 4 files, 9 tests |
| Root TypeScript lint/typecheck/tests | Pass — 124 files, 794 tests |
| Rust format/clippy/unit and available compatibility tests | Pass — 69 unit tests |
| Cargo audit | Pass under repository policy; 3 existing allowed warnings |
| `npm run check` | Pass |
| `npm run package` | Pass on macOS arm64 |
| Packaged runtime dependency inspection | Pass |
| `npm run bazel:check` | Pass — 13 test targets and both build targets |
| Credential-pattern scan | Pass |
| `git diff --check` | Pass |
| GitHub CI | Pending when this review artifact was written |

External-service PostgreSQL/S3 integration tests remain explicitly ignored without disposable test services. Signed Windows/Linux packaged smoke remains a release-pipeline check.

## Files Reviewed

| Change group | Files |
|---|---|
| Local SDK runtime | `services/agent-runtime/src/**`, `services/agent-runtime/test/**`, package and Bazel configuration |
| Electron trusted host | `src/main/agent-runtime/**`, task runtime/application service, CUA registry/dispatcher, permission and history stores |
| Shared/renderer contracts | `src/shared/**`, renderer task/history/insight views, preload API |
| Rust boundary | API app/config/core/router, route inventory and compatibility tests; deleted `services/api/src/agent/**` and hosted runtime controllers |
| Packaging/CI | Forge, Webpack, root/package Bazel targets, npm scripts, CI, environment example |
| Cleanup | Generated protocol schemas/fixtures/generators, hosted desktop worker/client, hosted Node worker/deployment files |
| Documentation | README, architecture/security/operations/testing docs, completed PRP, implementation report, dead-code audit |

The complete file packet is `git diff --name-status origin/main...HEAD`; no `.media` file is present in the PR.
