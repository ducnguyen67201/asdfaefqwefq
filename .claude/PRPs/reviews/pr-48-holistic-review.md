# PR #48 Holistic Agent Architecture Review

**Reviewed**: 2026-08-29

**Scope**: full PR diff from `main` through the local recovery-fix head

**Verdict**: PASS pending exact-head hosted CI and bot review

## End-to-End Architecture Audit

| Layer | Result | Evidence and conclusion |
|---|---|---|
| 1. User intent | Pass | The renderer submits intent and factual context; it does not submit a backend-authored plan. |
| 2. Planning and completion | Pass | The OpenAI Agents SDK owns the reasoning loop, tool choice, result consumption, and completion decision. Rust does not duplicate its planner. |
| 3. Tool discovery | Pass | Electron and connectors advertise typed capabilities. The first compatible claim freezes the exact resulting SDK tool surface for that run. |
| 4. Authority | Pass | The v10 contract binds user, workspace, Activity context, execution profile, and technical limits without action-approval policy gates. Authentication, schema validation, and OS permission prerequisites remain enforced. |
| 5. Orchestration and leases | Pass | SDK workers claim compatible runs with versioned leases and compare-and-swap transitions; stale workers cannot mutate a run. |
| 6. Session and checkpoints | Pass | SDK session history and `RunState` checkpoints are encrypted, version-bound, revisioned, and restored only by the matching SDK graph release. |
| 7. Tool execution | Pass | New calls must have been offered in the frozen surface and must resolve to a currently valid desktop or connector route. Calls are durably recorded before dispatch. |
| 8. Result truth | Pass | Durable invocation state is authoritative. An ambiguous consequential execution becomes unknown and is not silently retried. |
| 9. Recovery and idempotency | Pass after fix | Recovery now uses the immutable tool snapshot. Exact existing call IDs with the same request digest replay their stored invocation without requiring the vanished route or creating a duplicate. |
| 10. Security and privacy | Pass | Renderer isolation remains intact; IPC/model boundaries parse typed schemas; private contracts, checkpoints, sessions, calls, results, and tool snapshots are encrypted and retention-managed. |
| 11. Operations and rollout | Pass with deployment prerequisite | Protocol, catalog, SDK, and graph digests gate compatibility. Migration 033 requires a deliberate drain of nonterminal SDK runs before rollout. |
| 12. Tests and observability | Pass | Unit, contract, PostgreSQL recovery, full Node/Rust, Bazel, package, lint, type, and audit gates passed locally. Events and public summaries expose lifecycle state without leaking private payloads. |

## Failure-Path Trace

The critical sequence was reviewed explicitly:

1. The SDK receives a frozen set of tools and writes a checkpoint.
2. A tool call is durably inserted before delivery to Electron or a connector.
3. The executor or SDK worker disconnects.
4. A compatible SDK worker reclaims the leased run and receives the same frozen
   tool definitions.
5. Reissuing the same call ID and digest returns the existing invocation; it does
   not dispatch a second action.
6. A different or newly invented call still needs membership in the frozen
   surface and a valid current executor route.

The PostgreSQL recovery test exercises this sequence, verifies one invocation,
proves that a new unsnapshotted run waits for a live desktop, and verifies snapshot
retention deletion.

## Residual Risks

- A release that skips the migration drain will fail closed at migration 033. This
  is intentional and documented, but deployment automation must treat it as a
  prerequisite.
- Existing upstream Cargo audit warnings remain tracked. This PR does not add or
  suppress a vulnerability advisory.

## Final Assessment

No unresolved P0-P3 architecture, security, correctness, or simplification
finding remains. The system has one reasoning owner (the Agents SDK), one durable
control plane (Rust), and capability executors (Electron/CUA/connectors) whose
availability cannot mutate the historical graph of an in-progress run.
