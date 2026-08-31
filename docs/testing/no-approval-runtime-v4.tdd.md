# Historical autonomous runtime v4 — archived evidence

This document records the retired hosted runtime. Current local-runtime evidence
is maintained in the Codex-local PRP implementation report.

## Intended behavior

- Runtime v4 and authority v9 contain no action decision, approval lifecycle,
  approval mutation, or autonomy preference.
- Registered schema-valid tools proceed through technical prerequisites and
  the one-time execution transition without a user-decision callback.
- Unknown tools, invalid inputs/targets, stale observations, missing workspace
  bindings, unavailable OS permissions, exhausted limits, and digest mismatch
  still stop before dispatch.
- An unknown tool result blocks and is never replayed.
- Terminal v2/v3 task history remains readable without active controls.

## Evidence map

| Boundary | Primary coverage |
|---|---|
| Local protocol/catalog negotiation and lifecycle | `services/agent-runtime/test/protocol-and-graph.test.ts`, `src/main/agent/task-runtime.test.ts` |
| Direct desktop dispatch and CAS refusal | `src/main/agent-runtime/encrypted-agent-state-store.test.ts` |
| Public HTTPS and workspace structural bounds | `src/main/agent/runtime-tool-registry.test.ts` |
| Native browser capability TTL/match/one-use | `src/main/cua/cua-capability-broker.test.ts` |
| OS permission technical wait | `src/main/cua/computer-permission-coordinator.test.ts` |
| Clarification-only user interaction | `src/main/agent/task-runtime.test.ts` |
| Terminal hosted history compatibility | `src/main/history/legacy-hosted-task-history-store.test.ts` |
| Migration drain guard | `services/api/migrations/030_remove_agent_approval_policy.sql` |
| Reliability/privacy metrics | `services/api/src/cli/reports.rs`, `src/main/analytics/analytics-service.test.ts` |

Final command results are recorded in the implementation report under
`.claude/PRPs/reports/`.
