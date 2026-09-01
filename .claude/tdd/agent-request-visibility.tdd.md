# TDD Evidence: Agent request validation and visibility

## Source plan

[Seamless screen context and voice handoff](../PRPs/plans/completed/seamless-screen-context-and-voice-handoff.plan.md)

The follow-up journeys were derived from the repeated `400 "Responses request is invalid."` failure observed after the original plan was implemented.

## User journeys

- As a student asking about the visible Scratch project, I want the required `observe_context` call to reach the model so the task can inspect the screen instead of failing before inference.
- As an operator, I want one safe request identity across the SDK, task trace, and Rust proxy so a rejected request is diagnosable without logging private content.
- As a voice user, I want a submitted Task turn to finish its handoff without being cancelled when the Task enters its submitting state.

## RED and GREEN task report

### Named tool choice validation

- RED checkpoint: `74e15a3 test: reproduce agent request visibility failures`
- RED command: `cargo test --manifest-path services/api/Cargo.toml --lib http::core::tests`
- RED evidence: the test target failed to compile because `validate_responses_payload` did not exist.
- GREEN command: the same Cargo test target.
- GREEN evidence: 2 tests passed, including acceptance of `function:observe_context` only when that exact function is present in the submitted tool catalog.

### Correlated, privacy-safe model diagnostics

- RED checkpoint: `74e15a3 test: reproduce agent request visibility failures`
- RED command: `npm --prefix services/agent-runtime test -- --run test/user-openai-client.test.ts test/protocol-and-graph.test.ts`
- RED evidence: the diagnostic sink remained empty and the process protocol rejected `model_request_rejected`.
- GREEN command: the same Vitest target.
- GREEN evidence: 2 files and 11 tests passed. The test verifies correlated start/rejection metadata and proves the serialized diagnostics exclude the private prompt, credential, and tool parameters.

### Voice Task finalization

- RED checkpoint: `74e15a3 test: reproduce agent request visibility failures`
- RED command: `npx vitest run src/main/agent/task-runtime.test.ts src/renderer/use-push-to-talk.test.ts`
- RED evidence: `shouldCancelVoiceTurnForAvailability` was missing and a rejected model request was projected as success.
- GREEN command: the same Vitest target.
- GREEN evidence: 2 files and 23 tests passed. A finalizing turn is retained while submission disables new capture, and rejected model requests appear as warning progress.

- GREEN checkpoint: `21ad72d fix: accept grounded model requests with correlated diagnostics`

### Restarted pending tool grounding

- RED checkpoint: `264ca19 test: reproduce stale pending tool resume`
- RED command: `npm --prefix services/agent-runtime test -- --run test/local-runtime-server.test.ts`
- RED evidence: the new regression test failed because `rejectPendingToolAfterRestart` did not exist.
- GREEN command: the same Vitest target.
- GREEN evidence: 1 file and 4 tests passed. A checkpointed tool that is known not to have run is rejected after process restart, so the model re-checks current state instead of dispatching it against missing observation bindings.

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | A named function tool choice is accepted only when the exact function exists in the submitted catalog | `services/api/src/http/core.rs::http::core::tests` | Unit/security boundary | PASS |
| 2 | A missing named function fails closed with `responses_invalid_tool_choice` | `services/api/src/http/core.rs::http::core::tests` | Unit/security boundary | PASS |
| 3 | SDK diagnostics contain only bounded structural metadata and correlated request/task/turn IDs | `services/agent-runtime/test/user-openai-client.test.ts` | Unit/integration boundary | PASS |
| 4 | Model request diagnostics cross the utility-process protocol | `services/agent-runtime/test/protocol-and-graph.test.ts` | Contract | PASS |
| 5 | A proxy rejection is visible as warning progress before terminal failure | `src/main/agent/task-runtime.test.ts` | Projection | PASS |
| 6 | `isSubmitting` does not cancel a voice turn already finalizing | `src/renderer/use-push-to-talk.test.ts` | Race regression | PASS |
| 7 | A pre-restart pending tool is not auto-approved against reconstructed host context | `services/agent-runtime/test/local-runtime-server.test.ts` | Restart/replay safety | PASS |

## Coverage and validation

- Root coverage: 126 files and 844 tests passed. The repository-wide `src/main/agent` baseline is 74.69% statements and 77.41% lines; this pre-existing aggregate remains below the skill's 80% target.
- Changed SDK client: 88% statements, 84.84% branches, 100% functions, and 93.33% lines.
- Changed voice hook: 80.16% statements and 85.75% lines.
- In the complete root coverage run, `task-runtime.ts` reached 90.54% statements, 100% functions, and 95.58% lines.
- `npm run check`: PASS, including lint, TypeScript, Clippy, Rust audit, 844 Vitest tests, and 71 Rust unit tests.
- `npm run package`: PASS for macOS arm64.
- `npm run bazel:check`: PASS; all 13 declared tests passed and both requested build targets completed.

Known non-blocking gap: there is no single-process fixture that runs the complete Agents Runner request through the Rust validator. The actual named-tool payload is covered at both the OpenAI client serialization boundary and the Rust validation boundary.

## Merge evidence

Preserve RED checkpoints `74e15a3` and `264ca19` plus their GREEN fix commits, or retain this report and its RED/GREEN summary if the PR is squash-merged.
