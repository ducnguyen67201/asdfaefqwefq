# PR 48 Holistic Review

**Review date:** 2026-08-29

**Question:** Does the complete system support autonomous goal execution without
Tro action approvals while retaining a coherent, verifiable execution harness?

**Verdict:** Yes, subject to the documented atomic-cutover drain gate.

## Whole-System Flow

~~~text
User goal
   |
   v
Rust supervisor + authority v9
   |  choose only an advertised runtime-v4 tool
   v
Protocol, digest, registry, schema, identity, and observation checks
   |
   +--> missing information --------> clarification / awaiting_input
   +--> OS or OAuth unavailable ----> technical prerequisite wait
   |
   v
Durable requested invocation + one-time executing CAS
   |
   v
Desktop / workspace / browser / CUA / connector adapter
   |
   v
Bounded result + evidence + verification
   |
   +--> confirmed ----------> replan or complete
   +--> definite failure ---> recover only when retry is safe
   +--> unknown effect -----> block; never retry consequential work
~~~

The planner decides what registered action advances the goal. The executor owns
typed validation, technical prerequisites, the exactly-once claim, and adapter
dispatch. The retained guardrails constrain capability and execution mechanics;
they do not reintroduce an allow/deny or ask-for-approval policy decision.

## Cross-Layer Assessment

| Layer | Assessment |
| --- | --- |
| Goal and planning | Authority v9 preserves goal, success criteria, workspace/activity context, budgets, clarification, and completion semantics without compiling request-derived action grants. |
| Tool selection | Runtime v4 exposes an exact generated catalog. Unknown tools, operations, inputs, protocol versions, and digests fail closed; typed HTTP validation preserves the original validated negotiation fields at the service boundary. |
| Desktop execution | The worker validates normalized effects and identity, waits for technical permissions, refreshes the run version after a wait, claims execution once, dispatches once, and commits bounded evidence. |
| CUA | CUA remains an execution capability. The native browser capability is exact-task/window, expiring, and one-use; it is armed automatically only for the registered operation and is not user authorization. |
| Workspace | Filesystem adapters retain trusted-root bindings and bounds. Shell execution is intentionally not semantically allowlisted and can exercise host-user capabilities; this is explicit product risk, not an accidental omission. |
| Connectors | Routes, connection IDs, schemas, snapshots, leases, and result commits remain server-owned. Current Gmail tools do not expose send/delete. OAuth and provider refusal remain external prerequisites. |
| Lifecycle | Approval states/actions are absent from v4. Permission/input waits, cancellation, recovery, verification, terminal blocking, leases, and stale CAS rejection remain coherent. |
| Persistence | Migration 030 is forward-only and refuses to remove old executable state while nonterminal v2/v3 or approval-waiting rows exist. Terminal history remains readable through legacy adapters. |
| Renderer and IPC | Approval/autonomy mutations and cards are removed end-to-end. The sandboxed renderer still receives only narrow parsed `DesktopApi` methods. |
| Operations | The backend is honestly v4-only. The former observe/dual configuration was inert after destructive cleanup and has been removed; status reports fixed `enforce`. |

## Holistic Finding — Configurable rollout did not exist — resolved

The initial diff advertised `observe | dual | enforce`, but all new starts were
already v4 and migration 030 removes columns required by legacy execution. That
configuration suggested a fallback that could not work and made the deployment
plan unsafe to interpret.

The mode switch is removed from config, CLI, schema, generated artifacts, and
documentation. Deployment is now described consistently as: stop old starts,
drain nonterminal v2/v3 runs to zero, deploy the v4-capable desktop/backend, and
apply migration 030 as one coordinated cutover.

## Accepted Risks and Boundaries

- A registered consequential tool runs without a Tro confirmation card. This is
  the requested product behavior.
- Workspace shell commands can use host-user network and process capabilities;
  trusted workspace path handling is not a shell sandbox.
- Public-HTTPS syntax and private-address rejection reduce SSRF risk, but a URL
  handed to the system browser retains a documented DNS-rebinding residual risk.
- External systems can still deny access through OS permissions, OAuth, provider
  policy, or unavailable capabilities. Those are technical outcomes, not Tro
  action policy.
- An unknown consequential result blocks rather than retries, trading automatic
  completion for duplicate-effect prevention.
- Production readiness depends on the database drain query returning zero old
  nonterminal runs. The migration must not be forced past that guard.

## Go / No-Go

The code is suitable to merge after remote CI passes; all required local
repository gates pass. Deployment is
**no-go** until the target database reports zero nonterminal protocol-v2/v3 runs;
after that condition, the system has one consistent v4 execution model and no
hidden approval decision path.
