# Autonomous runtime v4 — implementation evidence

## Intended behavior

- Runtime v4 and authority v9 contain no action decision, approval lifecycle,
  approval mutation, or autonomy preference.
- Registered schema-valid tools proceed through technical prerequisites and
  the one-time execution transition without a user-decision callback.
- Unknown tools, invalid inputs/targets, stale observations, missing workspace
  bindings, unavailable OS permissions, exhausted limits, and digest mismatch
  still stop before dispatch.
- An unknown consequential result blocks and is never retried.
- Terminal v2/v3 task history remains readable without active controls.

## Evidence map

| Boundary | Primary coverage |
|---|---|
| Protocol/catalog negotiation and lifecycle | `src/shared/agent-runtime-protocol.test.ts`, `services/api/tests/agent_runtime_contract.rs` |
| Direct desktop dispatch and CAS refusal | `src/main/hosted/desktop-tool-worker.test.ts` |
| Public HTTPS and workspace structural bounds | `src/main/agent/runtime-tool-registry.test.ts` |
| Native browser capability TTL/match/one-use | `src/main/cua/cua-capability-broker.test.ts` |
| OS permission technical wait | `src/main/hosted/computer-permission-coordinator.test.ts` |
| Clarification-only user interaction | `src/main/agent/task-runtime.test.ts` |
| v4/v9 backend execution and history compatibility | `services/api/tests/agent_runtime_compat.rs`, `src/main/application/hosted-task-client.test.ts` |
| Migration drain guard | `services/api/migrations/030_remove_agent_approval_policy.sql` |
| Reliability/privacy metrics | `services/api/src/cli/reports.rs`, `src/main/analytics/analytics-service.test.ts` |

Final command results are recorded in the implementation report under
`.claude/PRPs/reports/`.
