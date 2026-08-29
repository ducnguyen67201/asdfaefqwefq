# Plan: Remove Action Approval and Authorization Gates

**Status:** Implemented and verified on 2026-08-29. See
`.claude/PRPs/reports/remove-action-approval-policy-gates-report.md`.

## Summary

Replace TroCode's action-level `allowed | needs_approval | denied` policy path with a direct, goal-driven execution loop. After the model proposes a registered tool call, the host validates the typed payload and current execution preconditions, acquires the existing one-time `executing` transition, executes once, records evidence, and replans or finishes. There is no Tro approval card, no Balanced/Strict approval mode, no intent-authorization compiler, and no action policy deciding whether an otherwise valid tool call is allowed.

This is not an `always allow` patch. The final design removes the authorization subsystem and keeps the execution harness that makes autonomous computer use reliable: exact protocol/catalog negotiation, registered-tool availability, schema parsing, public-HTTPS normalization, trusted workspace binding, OS Accessibility/Screen Recording readiness, OAuth consent, task limits, cancellation, observation freshness, exactly-once dispatch, outcome verification, and the rule that an unknown consequential outcome is never retried.

## User Story

As a TroCode user, I want to give Tro a goal and have it carry out valid available actions without pausing for Tro-specific approval or being blocked by request-derived action policy, so that ordinary computer-use tasks behave like an autonomous CUA loop.

## Problem → Solution

The same action is currently classified repeatedly by the Rust API, the local Rust engine, Electron, SQL constraints, and the renderer. That creates brittle one-off policy fixes and false pauses such as simple navigation entering approval logic → make the model choose only from the exact registered tool catalog, validate every tool payload at the executor boundary, then dispatch directly through one durable lifecycle path.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A; freeform user request
- **PRD Phase**: N/A
- **Delivered Files**: 129 files in one atomic-cutover PR
- **Delivery**: One production drain gate followed by an atomic v4/v9 cutover. The old deployment must stop new starts and reach zero nonterminal v2/v3 runs before this PR is deployed, because migration 030 removes their executable approval state.
- **Supersedes**: The approval-preserving portions of `.claude/PRPs/plans/general-purpose-gpt-led-agent.plan.md`, especially its Tasks 7-10. The runtime registry, fresh-observation, verification, and unknown-outcome patterns from that plan remain valid.

---

## Product Decision

### Remove

- Tro's `allowed | needs_approval | denied` action decision.
- Request-derived `intentAuthorization` grants and revisions.
- `approvalPolicy`, `approvalRequired`, `authorizationSource`, approval digests, grants, expiries, and approval decisions.
- `awaiting_approval` state/phase/waiting reason and `approve` / `deny` lifecycle actions.
- Balanced/Strict autonomy settings; both currently describe approval behavior rather than model reasoning depth.
- Desktop, connector, companion, and main-window approval cards and shortcuts.
- Workspace shell command classification into safe / approval / denied buckets.
- Approval and authorization analytics, insights, benchmark fields, and UI language.
- The local Rust desktop-engine `policy.evaluate_action` and `intent.compile` methods.

### Keep

- Goal, success criteria, execution profile, Activity context, trusted workspace identity, and budgets.
- Planner meta-tools for clarification, completion, and blocking when a required choice or capability is missing.
- Exact registered tool and operation checks. A missing tool is unavailable, not policy-denied.
- Input-schema parsing, bounded strings/arrays, URL normalization, path confinement, command timeout/output limits, and scrubbed environment.
- OS Accessibility and Screen Recording readiness. These are technical prerequisites controlled by macOS/Windows, not Tro approval.
- User OAuth consent and connector connection/reconnection. These are provider authentication boundaries, not per-action approval.
- The CUA driver's internal authorization host for privileged native `browser_prepare`, but rename the Tro-facing capability state so no UI or model instruction says the user must approve it. The broker automatically arms one exact, expiring resource capability only while executing the registered `browser.prepare` tool.
- Typed effect/consequence metadata only for reporting, verification strategy, cancellation semantics, and unknown-outcome no-retry behavior. Rename `HardConfirm` terminology to `HighConsequence` or `Consequential`; it must never feed an allow/deny branch.
- One-time compare-and-swap from `requested` to `executing`; this is exactly-once execution ownership, not permission.
- Fresh observation binding for visual actions and re-observation after state-changing UI actions.
- Activity-specific data integrity rules, such as valid criterion IDs/tags and classroom scope. These validate domain records and do not authorize general actions.

### Explicit Risk Acceptance

After this change, a model-selected registered tool can send, delete, publish, install, trade, or run a shell command without a Tro confirmation card if such a tool exists in the catalog. The current Gmail connector still exposes read, draft, and label operations but no send/delete tool. The current Workspace shell is not sandboxed: removing its command policy allows network access, absolute-path references interpreted by the shell, package installation, git push, deploy commands, and other host-user capabilities available to the spawned process. Root-confinement protects filesystem adapter paths, not arbitrary shell syntax. This must be named in release notes and covered by kill switch, cancellation, audit, and unknown-outcome tests.

---

## Target Architecture

~~~text
User goal
   |
   v
Rust supervisor/model  -- asks for clarification only when information is missing
   |
   | exact registered tool call + bounded input + obligations
   v
Protocol/catalog/schema checks
   |
   +--> technical prerequisite wait: OS permission / OAuth reconnect
   |
   v
One-time requested -> executing CAS
   |
   v
Registered desktop, workspace, browser, CUA, or connector adapter
   |
   v
Bounded result + evidence
   |
   +--> confirmed: verify, then replan or complete
   +--> definite failure: fail/recover if retry is safe
   +--> unknown effect: block and never retry
~~~

There is deliberately no policy/approval branch between tool normalization and the one-time execution transition.

---

## OpenCUA / OSWorld Research

- [OpenCUA paper](https://arxiv.org/abs/2508.09123): OpenCUA is an open foundation-model/data/evaluation project. Its central contribution is end-to-end CUA models trained from state-action trajectories and reflective reasoning, not a production authorization architecture.
- [Official OpenCUA repository](https://github.com/xlang-ai/OpenCUA): the released models produce executable computer actions and the framework includes datasets, annotation infrastructure, and offline evaluation.
- [Official OSWorld repository](https://github.com/xlang-ai/OSWorld): OSWorld supplies the environment runner, agent interface, setup/reset, trajectory logging, and execution-based evaluation around a model.

**Implementation insight**: OpenCUA supports goal → observe → action → observe autonomy, but it still runs inside a harness. For TroCode, the correct simplification is to remove action authorization and approval, not to remove the harness. Protocol validation, executor ownership, environment setup, action bounds, evidence, and evaluation remain application responsibilities.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `services/api/src/agent/service.rs` | 35, 128-325, 382-403, 609-840, 920-1020, 1160-1235, 1440-1525, 2030-2500, 2609 | Creates v8 authority, projects/decides approvals, builds invocations, executes connectors, and serializes approval columns |
| P0 | `services/api/src/agent/policy.rs` | 150-489, 1151-1305 | Entire action decision and intent-authorization implementation being removed; public URL/effect validation must be relocated rather than lost |
| P0 | `src/main/hosted/desktop-tool-worker.ts` | 29-53, 63-205 | The duplicate Electron policy/approval path and the execution checks that must remain |
| P0 | `src/shared/agent-runtime-protocol.ts` | 13-61, 211-309, 408-450, 498-527, 545-605 | Canonical v3 approval state/actions/envelope; source for breaking v4 |
| P0 | `src/shared/contracts.ts` | 209-275, 749-823, 858-949, 1035-1135, 1920-1951, 1984-2060, 2130-2210, 2280-2320, 2740-2810 | Authority v8, local task/IPC/companion approval types, and autonomy preference |
| P0 | `services/api/migrations/015_intent_authorization.sql` | all | Invocation authorization columns/constraints/index to remove forward-only |
| P0 | `services/api/migrations/025_agent_runtime_contract_v3.sql` | 13-20, 62-71, 77-112 | State and permission constraints; permission path must survive approval removal |
| P0 | `services/api/migrations/027_mcp_connectors.sql` | 100-148 | Durable connector approval columns/constraints/index to remove |
| P1 | `src/main/agent/runtime-tool-registry.ts` | 915-975, 1260-1365 | Browser and workspace normalization; structural validation replaces authorization classification |
| P1 | `src/main/agent/workspace-command-policy.ts` | all | Non-sandboxed shell allow/deny classifier being deleted |
| P1 | `src/main/agent/workspace-device-adapters.ts` | 11-37, 58-79, 123-175 | Bounds, environment, cancellation, and root-aware adapters to preserve |
| P1 | `src/main/cua/cua-surface-router.ts` | 423-463, 574-585 | Exact automatic native browser-prepare capability and misleading approval-facing state |
| P1 | `src/main/cua/cua-authorization-broker.ts` | all | Driver-required, one-use internal capability token; retain but rename/document as non-user approval |
| P1 | `src/main/agent/action-effect.ts` | 1-27, 70-118, 147-293 | Approval-named effect classification; retain only consequence/no-retry semantics |
| P1 | `src/main/application/hosted-task-client.ts` | 45-130, 200-405 | v3 projection/authority mapping and approval endpoint client |
| P1 | `src/main/agent/task-runtime.ts` | 210-375 | Local clarification is mixed with exact approval grant lifecycle |
| P1 | `src/index.ts` | 443-457, 1137-1175, 1409-1448 | Worker wiring, companion sizing, and local approval provider |
| P1 | `src/renderer/App.tsx` | 793-900, 975, 1326, 1810, 2024-2062, 2547, 2963-2968, 3263-3265, 3331-3458 | Main approval card, autonomy state/settings, and “Bounded by default” copy |
| P1 | `src/renderer/SettingsPage.tsx` | 331-352, 551-557, 642-685 | Balanced/Strict autonomy UI and approval claims |
| P1 | `src/main/analytics/analytics-service.ts` | 52, 211-292 | Approval/autonomy events and reliability metrics |
| P1 | `services/api/src/cli/reports.rs` | 35-120, 160-290, 630-710 | Approval churn and hard-confirm benchmark schema/gates |
| P2 | `docs/architecture.md` | 42-96 | Current v8/v3 task authority and tool-policy description |
| P2 | `docs/computer-use-lifecycle.md` | all | Current observe → policy → approval → execute narrative |
| P2 | `docs/conversational-task-execution.md` | all | User-facing approval flow and technical permission distinction |
| P2 | `docs/security.md` | 1-260 | Current trust claims that would become inaccurate |
| P2 | `docs/agent-runtime-operations.md` | 1-57, 69-80 | Existing version drain and unknown-outcome operations pattern |

The repository references `docs/CODEX-NAVIGATION-GUIDE.md`, but that file is absent in this checkout. Do not block on it; use the source paths above and update the navigation guide separately if it is restored.

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Evidence |
|---|---|---|---|
| Protocol boundary | `src/shared/agent-runtime-protocol.ts:408-450` | Strict Zod envelope + generated digest | Desktop and backend already reject mismatched protocol/catalogs |
| Rust wire types | `services/api/src/agent/protocol.rs:5-39` | Typify imports committed JSON Schema | v4 must be generated before Rust compilation |
| Exactly-once execution | `src/main/hosted/desktop-tool-worker.ts:204-205` | Server-owned one-time executing transition | Preserve after deleting approval metadata |
| Technical permission | `src/main/hosted/desktop-tool-worker.ts:183-203` | Permission coordinator pauses before native dispatch | Separate from action approval and must remain |
| Executor bounds | `src/main/agent/workspace-device-adapters.ts:123-175` | Count/length/time/output validation and cancellation | Structural execution safety does not require allow/deny policy |
| CUA privilege token | `src/main/cua/cua-surface-router.ts:423-463` | Arm exact task/window grant only around `browser_prepare` | Can be automatic without user approval UI |
| Pure lifecycle | `services/api/src/agent/lifecycle.rs:85-124` | State projects phase/actions centrally | Remove approval variants here, not ad hoc in UI |
| Forward migration | `services/api/src/db.rs:133-153` | Explicit ordered embedded migration list | New migration must use the next unused number and update corpus fixtures |
| Connector contract | `services/api/src/connectors/catalog.rs:69-218` | Reviewed tool list, strict schemas, no send/delete tools | Catalog availability remains; per-call policy/approval disappears |
| Legacy read strategy | `src/shared/legacy-agent-runtime-v2.ts` | Isolated old protocol projection | Mirror for v3 history after v4 becomes canonical |
| UI boundary | `src/shared/desktop-api.ts` + `src/preload.ts` + `src/main/ipc/register-ipc.ts` | Narrow parsed IPC | Delete approval mutation end-to-end; never expose raw dispatch |
| Cutover | `docs/agent-runtime-operations.md:9-35` | Active-run drain and exact version checks | Require a zero-active-v2/v3 drain before the atomic v4 cutover; do not reinterpret active v3 approval waits |

---

## Patterns to Mirror

### STRICT_PROTOCOL_AND_TOOL_NEGOTIATION

SOURCE: `src/main/hosted/desktop-tool-worker.ts:63-95`

~~~ts
const envelope = DesktopInvocationV3Schema.parse(input);
if (
  envelope.protocolDigest !== HOSTED_AGENT_PROTOCOL_DIGEST ||
  envelope.toolCatalogDigest !== HOSTED_AGENT_TOOL_CATALOG_DIGEST
) {
  return this.result(envelope, 'not_executed', 'The backend and desktop tool schemas do not match.');
}
~~~

Create equivalent v4 types/digests. Approval removal must never become acceptance of unknown envelopes.

### ONE_TIME_EXECUTION_CAS

SOURCE: `src/main/hosted/desktop-tool-worker.ts:204-205`

~~~ts
if (!await this.options.requestExecuting(envelope.invocationId)) {
  return this.result(envelope, 'not_executed', 'The backend did not grant the one-time executing transition.');
}
~~~

The request contains only invocation identity and expected run version. Effect/consequence are server-owned data already stored with the invocation; the desktop must not submit authority metadata.

### TECHNICAL_PREREQUISITE_WAIT

SOURCE: `src/main/hosted/desktop-tool-worker.ts:183-203`

Keep `permissionCoordinator.requireReady` before `requestExecuting`. Its outcomes are `ready`, `continue_without_computer`, or unavailable; none is an action approval decision.

### BOUNDED_EXECUTOR_INPUT

SOURCE: `src/main/agent/workspace-device-adapters.ts:123-150`

~~~ts
if (
  action.commands.length < 1 ||
  action.commands.length > MAX_COMMANDS ||
  action.commands.some((command) =>
    !command.trim() || command.length > MAX_COMMAND_LENGTH || command.includes('\0'))
) {
  throw new Error('Workspace shell commands must be nonempty and bounded.');
}
~~~

Keep structural invalid-input rejection. Delete semantic classification of commands into allowed/approval/denied.

### VERSIONED_AUTHORITY_CONTRACT

SOURCE: `src/shared/contracts.ts:749-823`

Add `AgentTaskContractV9Schema`; do not mutate V8. V2-V8 remain parseable for history but cannot authorize new execution after v4 enforcement.

### FORWARD_ONLY_DRAIN_GUARD

SOURCE: `docs/agent-runtime-operations.md:24-31`

Before dropping approval columns or state values, require zero nonterminal v2/v3 runs. The migration itself must raise an exception if a nonterminal legacy run exists; never auto-approve or auto-dispatch an old `awaiting_approval` invocation.

---

## New Contracts

### Authority Contract v9

~~~ts
type AgentTaskContractV9 = {
  schemaVersion: 9;
  id: string;
  originalRequest: string;
  runtimeKind: 'rust_hosted';
  executionProfile: 'everyday' | 'workspace';
  workspace: WorkspaceIdentity | null;
  activity: ActivityContext | null;
  outcomeContract: OutcomeContract;
  limits: {
    maxImages: number;
    maxMicroUsd: number;
    maxMinutes: number;
    maxModelSamples: number;
    maxToolCalls: number;
  };
};
~~~

There is no `autonomyMode`, `intentAuthorization`, or `approvalPolicy`. `originalRequest` is task context, not a compiled permission grant.

### Desktop Invocation v4

~~~ts
type DesktopInvocationV4 = {
  protocolVersion: 4;
  protocolDigest: string;
  toolCatalogDigest: string;
  invocationId: string;
  runId: string;
  runVersion: number;
  callId: string;
  toolId: string;
  operation: string;
  effect: ActionEffect;       // outcome/no-retry metadata only
  consequential: boolean;     // server-derived from effect
  permissionInteractionId: string | null;
  permissionRequirements: ComputerPermission[];
  input: Record<string, unknown>;
  obligations: VerificationObligation[];
  expiresAt: string;
};
~~~

Remove `intentRevision`, `approvalRequired`, and `authorizationSource`. `requestExecuting` accepts `{ invocationId, expectedRunVersion }` and performs the existing CAS.

### Runtime v4 Lifecycle

- States: queued, compiling_outcomes, planning, awaiting_worker, awaiting_permission, executing_tool, awaiting_input, verifying, recovering, completed, blocked, failed, cancelled, expired.
- Phases: ready, planning, paused, awaiting_permission, awaiting_input, acting, verifying, completed, blocked, failed, cancelled.
- Actions: steer, cancel, respond, open_system_settings, continue_without_computer, retry_as_new_task.
- Waiting reasons: worker, permission, input.
- `denied` may remain a tool-result status only when an external provider/OS refuses an operation; it is not emitted by Tro action policy.

---

## Rollout and Compatibility

### Atomic cutover — Introduce no-approval v4/v9 and remove legacy execution

1. Add v4 schema/catalog/artifacts and v9 authority alongside legacy v3/v8 terminal-history parsing.
2. Add `/v1/agent-runtime/v4/...` status/task/worker routes.
3. Stop new starts on the old deployment and drain all nonterminal v2/v3 runs before migration 030.
4. Deploy v4-capable desktops and the v4-only backend together; exact protocol and tool-catalog digests are mandatory.
5. Keep terminal v2/v3 history readable, but never admit an old start or worker after cutover. The v4 status reports `enforce` as a fixed compatibility fact, not as a mutable rollout control.
6. Remove v3 start/control/worker execution paths, the approval endpoint, and approval/intent-authorization persistence in the same release.

### Drain Gate

~~~sql
SELECT protocol_version, state, COUNT(*)
FROM agent_runs
WHERE state NOT IN ('completed','blocked','failed','cancelled','expired')
GROUP BY protocol_version, state;
~~~

Require zero active v2/v3 rows. Operators should cancel stale `awaiting_approval` runs through the old deployment before the cleanup migration. Never migrate them into `executing_tool` and never synthesize an approval.

### Migration Number

Migration 029 is present on the base branch, so this cutover uses `030_remove_agent_approval_policy.sql`. Never create a different migration 029 or edit an already-applied migration, because SQLx will reproduce the “previously applied but missing” failure.

---

## Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Make `evaluate_action` always return allowed | Reject | Leaves duplicate policy types, states, SQL, UI, and misleading safety claims; future code will accidentally branch on them again |
| Remove only the approval card | Reject | Backend still pauses in `awaiting_approval`, connector work remains stuck, and policy false negatives continue |
| Change v3/v8 in place and rely only on a new digest | Reject | A breaking semantic change cannot roll out safely across independently updated backend/desktops; mixed versions would strand active work |
| Automatically approve old pending invocations | Reject | Reinterprets a historical user boundary and can dispatch stale consequential work |
| Remove all checks with the policy | Reject | OpenCUA is a model/evaluation foundation, not a replacement for protocol, executor, OS, persistence, or verification infrastructure |
| Remove the CUA driver authorization host | Reject | `browser_prepare` is a privileged native API requiring exact resource scoping; keep it automatic and internal, without user approval semantics |
| Keep workspace command denylist but call it validation | Reject for requested scope | It still decides whether a valid registered action may run. Retain only structural bounds and document the unsandboxed-shell risk |

---

## Files to Change

### Canonical Contracts and Generated Artifacts

| File | Action | Purpose |
|---|---|---|
| `src/shared/agent-runtime-protocol.ts` | UPDATE to canonical v4 | Remove approval state/actions/wait/request and invocation authorization fields |
| `src/shared/legacy-agent-runtime-v3.ts` | CREATE | Read-only parser/projection for terminal v3 history during/after rollout |
| `src/shared/legacy-agent-runtime-v2.ts` | UPDATE | Share legacy helpers without admitting old versions for new work |
| `src/shared/agent-runtime-protocol.test.ts` | UPDATE | v4 lifecycle/projection and legacy read tests |
| `src/shared/agent-tool-contracts.ts` | UPDATE | Rename browser-prepare wording and consequence terminology; keep strict tools |
| `src/shared/agent-tool-contracts.test.ts` | UPDATE | Assert exact v4 tool catalog and no approval wording |
| `scripts/generate-agent-runtime-contract.mts` | UPDATE | Emit v4 schema, catalog, manifest, and fixtures |
| `protocol/agent-runtime.v4.schema.json` | CREATE generated | Canonical v4 JSON Schema |
| `protocol/agent-runtime.v4.manifest.json` | CREATE generated | v4 protocol/catalog digests and inventories |
| `protocol/agent-tools.v4.json` | CREATE generated | Exact v4 tool catalog |
| `protocol/agent-runtime.v3.*`, `protocol/agent-tools.v3.json` | KEEP read-only | Do not regenerate after v4 becomes canonical |
| `protocol/BUILD.bazel`, `BUILD.bazel` | UPDATE | Add v4 artifact/fixture targets; retain legacy v3 fixture group if read tests use it |
| `test/fixtures/agent-runtime-v4/*.json` | CREATE generated | Shared valid/invalid/Open URL corpus |

### Shared Application Contracts

| File | Action | Purpose |
|---|---|---|
| `src/shared/contracts.ts` | UPDATE | Add v9; remove approval/current autonomy fields while isolating legacy V2-V8 parsing |
| `src/shared/contracts.test.ts` | UPDATE | v9 authority, legacy-history, current-snapshot, IPC, and preference compatibility |
| `src/shared/desktop-api.ts` | UPDATE | Remove `decideApproval` channel and API methods |
| `src/preload.ts` | UPDATE | Remove main/companion approval calls; parse v4/v9 |
| `src/main/agent/action-approval.ts` | DELETE | Approval digest has no consumer |
| `src/main/agent/action-approval.test.ts` | DELETE | Obsolete digest behavior |
| `src/main/agent/action-effect.ts` | UPDATE | Rename confirmation concepts to consequence metadata; remove authorization-only helpers |
| `src/main/agent/action-effect.test.ts` | UPDATE | Test effect derivation and unknown-outcome classification, never approval |
| `src/main/agent/execution-contracts.ts` | UPDATE | Rename `available_requires_approval` to `available`/`ready_to_prepare` |

### Rust Runtime and Persistence

| File | Action | Purpose |
|---|---|---|
| `services/api/src/agent/action.rs` | CREATE | Move ActionEffect/ProposedAction parsing and pure consequence validation out of policy |
| `services/api/src/agent/policy.rs` | DELETE after drain | Remove evaluator, regex grant compiler, approval rules, and tests |
| `services/api/src/agent/mod.rs` | UPDATE | Export action types; stop exporting policy APIs |
| `services/api/src/agent/protocol.rs` | UPDATE | Typify v4 schema and v4 digests; isolate legacy v3 read DTOs if needed |
| `services/api/src/agent/lifecycle.rs` | UPDATE | Remove approval state/action/projection transitions; retain permission/input waits |
| `services/api/src/agent/service.rs` | UPDATE | Create v9, emit v4, auto-queue valid connector/desktop invocations, delete approval control/maintenance/query fields |
| `services/api/src/agent/tool_catalog.rs` | UPDATE | Consume v4 tool catalog; preserve strict schema/operation checks |
| `services/api/src/http/agent_runtime.rs` | UPDATE | Add v4 routes/status, then remove v3 approval/start/control routes after drain |
| `services/api/src/desktop_engine.rs` | UPDATE | Remove policy/intent methods and health features; preserve OAuth/voice |
| `services/api/src/config.rs` | UPDATE | Make v4 the only start protocol; delete obsolete rollout-mode and intent-authorization canary config |
| `services/api/src/cli/checks.rs` | UPDATE | Report v4 readiness and v2/v3 drain |
| `services/api/src/cli/reports.rs` | UPDATE | Replace approval/hard-confirm metrics with execution/evidence/no-retry metrics |
| `services/api/migrations/030_remove_agent_approval_policy.sql` | CREATE expected | Drain guard, state constraint cleanup, approval/auth column/index/constraint removal |
| `services/api/src/db.rs` | UPDATE | Register the actual next migration after 029 is synchronized |
| `services/api/tests/agent_runtime_contract.rs` | UPDATE | v4 shared schema/tool/lifecycle corpus |
| `services/api/tests/agent_runtime_compat.rs` | UPDATE | v3 terminal read plus v4 start/worker behavior |
| `services/api/tests/contract_corpus.rs` | UPDATE | Migration count/source and route/schema inventories |
| `services/api/tests/postgres_compat.rs` | UPDATE | Empty/adopted DB migration and drain-guard tests |
| `services/api/tests/http_compat.rs`, `services/api/tests/fixtures/*.json` | UPDATE | Remove approval route; add v4 status/task/worker routes |

### Desktop Execution and Connectors

| File | Action | Purpose |
|---|---|---|
| `src/main/hosted/desktop-tool-worker.ts` | UPDATE | Remove policy/approval providers and intent checks; direct validated dispatch |
| `src/main/hosted/desktop-tool-worker.test.ts` | UPDATE | Direct execution, technical permissions, CAS, stale observation, unknown outcome |
| `src/main/hosted/desktop-worker-client.ts` | UPDATE | v4 connect/events and minimal `requestExecuting` payload |
| `src/main/hosted/desktop-worker-protocol.ts` | UPDATE | v4 digest/catalog bindings |
| `src/main/engine/rust-desktop-engine-client.ts` | UPDATE | Remove policy/intent types/methods/features |
| `src/main/engine/rust-desktop-engine-client.test.ts` | UPDATE | OAuth/voice health only |
| `src/main/agent/workspace-command-policy.ts` | DELETE | Remove shell allow/approval/deny classifier |
| `src/main/agent/workspace-command-policy.test.ts` | DELETE | Obsolete classifier cases |
| `src/main/agent/runtime-tool-registry.ts` | UPDATE | Structural normalization only; public HTTPS validation at browser adapter boundary |
| `src/main/agent/runtime-tool-registry.test.ts` | UPDATE | Registered/unknown tool, URL, workspace bounds, and direct consequence tests |
| `src/main/agent/workspace-device-adapters.ts` | UPDATE only if naming changes | Preserve bounds/root/environment/cancellation; do not add a semantic denylist |
| `src/main/agent/cua-semantic-agent-tools.ts` | UPDATE | Browser prepare is automatic technical preparation, not permission request |
| `src/main/agent/cua-semantic-agent-tools.test.ts` | UPDATE | New deep-access state/copy |
| `src/main/cua/cua-surface-router.ts` | UPDATE | Publish non-approval prepare capability; keep exact automatic arm scope |
| `src/main/cua/cua-authorization-broker.ts` | RENAME to `cua-capability-broker.ts` | Clarify driver-native scope is not user approval |
| CUA broker/router/service tests | UPDATE | Exact task/window/TTL/one-use behavior still fails closed |
| `services/api/src/connectors/catalog.rs` | RENAME types only | `ToolPolicy` → `ReviewedToolContract`; keep catalog/schema availability |
| `services/api/src/connectors/mod.rs` | UPDATE | Remove per-call ProposedAction/digest/policy/approval presentation; execute validated route directly |
| `services/api/src/connectors/mcp.rs`, `schema.rs` | UPDATE naming | `policy_digest` → `catalog_contract_digest` without weakening schema snapshot checks |

### Main Process, IPC, Preferences, and Local State

| File | Action | Purpose |
|---|---|---|
| `src/index.ts` | UPDATE | Remove approvalProvider/requestHostedApproval and approval companion sizing; wire v4 |
| `src/main/application/hosted-task-client.ts` | UPDATE | v4 status/projection/submit; no approval decision method |
| `src/main/application/hosted-task-client.test.ts` | UPDATE | v4/v9 and read-only legacy v3 |
| `src/main/application/task-application-service.ts` | UPDATE | Stop reading autonomy and deciding approval |
| `src/main/application/task-application-service.test.ts` | UPDATE | Goal start/clarification/cancel paths only |
| `src/main/agent/task-runtime.ts` | UPDATE | Clarification-only pending interactions; remove grants/digests |
| `src/main/agent/task-runtime.test.ts` | UPDATE | Clarification/lifecycle tests; no local approval |
| `src/main/agent/task-interaction-broker.ts` and test | DELETE if `rg` still shows no production consumer | Currently self-test-only dead abstraction |
| `src/main/ipc/register-ipc.ts` and test | UPDATE | Remove parsed approval channel; preserve sender/auth/membership checks |
| `src/main/preferences/app-preferences-service.ts` and test | UPDATE | Remove autonomy field; prove old JSON with unknown field loads and rewrites canonically |
| `src/main/companion/companion-interaction.ts` and test | UPDATE | Clarification only |

### Renderer, History, Analytics, and Documentation

| File | Action | Purpose |
|---|---|---|
| `src/renderer/App.tsx` | UPDATE | Remove approval card/handlers/autonomy state/“Bounded by default” claims |
| `src/renderer/SettingsPage.tsx` and tests | UPDATE | Remove Autonomy section and approval footer |
| `src/renderer/GuidanceCallout.tsx` | UPDATE | Clarification/guidance only |
| `src/renderer/approval-details.ts` and test | DELETE | Approval-only UI helper |
| `src/renderer/companion-interaction.ts` and test | DELETE | Approval shortcut/expiry helper; no remaining responsibility |
| `src/renderer/InsightsPage.tsx`, `insights.ts`, tests | UPDATE | Remove approval decisions; show completed/failed/tool/evidence metrics |
| `src/renderer/history.ts` and test | UPDATE | Parse v9 and display legacy v3/V8 terminal history without active controls |
| `src/renderer/task-execution.ts` and test | UPDATE | Remove approval cancellability; preserve permission language and phases |
| `src/renderer/app-language.ts`, `src/index.css` | UPDATE | Remove dead approval/autonomy strings/selectors |
| `src/main/analytics/analytics-service.ts` and test | UPDATE | Remove approval/autonomy/auth-source properties; retain fixed IDs and outcomes |
| `README.md`, `PRIVACY.md` | UPDATE | Disclose direct autonomous execution and connector private-read behavior |
| `docs/architecture.md`, `docs/computer-use-lifecycle.md`, `docs/conversational-task-execution.md`, `docs/connectors.md`, `docs/security.md`, `docs/agent-runtime-operations.md` | UPDATE | Document no-approval architecture, v4 rollout, and retained harness |
| `.env.example` | UPDATE | Document the v4-only cutover; remove inert mode and intent-authorization rollout variables |

Historical `docs/testing/*.tdd.md` files are evidence for past releases. Do not rewrite them to pretend approval never existed; add a new no-approval v4 TDD evidence document when implementation is complete.

---

## Step-by-Step Tasks

### Task 1: Freeze the semantic boundary in tests and documentation

- **ACTION**: Add failing characterization tests for the no-approval loop before changing production behavior.
- **IMPLEMENT**:
  - Define cases for public YouTube navigation, ordinary desktop click/type, Gmail private read/draft/label, workspace write, arbitrary bounded workspace shell command, browser prepare, OS permission wait, clarification, and an unknown consequential outcome.
  - Assert every registered, schema-valid action reaches `requestExecuting` without `evaluatePolicy` or an approval provider.
  - Assert unknown/unregistered tools, invalid schemas, stale observations, expired envelopes, missing workspace bindings, invalid public URLs, missing OS permissions, and exhausted budgets still stop before dispatch.
  - Assert `send/delete/publish/install/trade/run_command` do not create approval interactions.
  - Add `docs/testing/no-approval-runtime-v4.tdd.md` as new evidence rather than editing historical approval TDD files.
- **MIRROR**: Table-driven worker tests in `src/main/hosted/desktop-tool-worker.test.ts` and shared protocol fixtures generated by `scripts/generate-agent-runtime-contract.mts`.
- **IMPORTS**: Vitest `describe/it/expect/vi`, v4 schemas, fake dispatcher/permission coordinator, Rust JSON fixtures.
- **GOTCHA**: “No approval” must not be asserted as “always succeeds.” Invalid or unavailable work returns `not_executed`; an unknown effect blocks and is never retried.
- **VALIDATE**: New tests fail specifically on current policy/approval calls and v3/v8 contract fields.

### Task 2: Add authority contract v9 and remove autonomy from current application state

- **ACTION**: Version the server-owned task authority without authorization fields.
- **IMPLEMENT**:
  - Add `AgentTaskContractV9Schema` with request, execution profile, workspace/activity, outcomes, and limits only.
  - Add v9 to `TaskContractSchema`; keep V2-V8 schemas for historical parse only.
  - New hosted submissions require v9. Never normalize an active V8 contract into executable V9 authority.
  - Remove current `AuthorizationSource`, `IntentAuthorization`, approval policy/grant/interaction/request, and approval message kinds from current schemas/types.
  - Add a legacy snapshot parser that accepts old approval messages/interactions for read-only History, strips interactive controls, and marks nonterminal legacy snapshots non-resumable.
  - Remove `autonomyMode` from AppPreferences, SubmitAgentTask v4, application service, UI props/state, analytics, and API projection.
  - Add a preference compatibility test: a saved JSON object containing `autonomyMode: "strict"` loads successfully, unknown field is ignored, and the next save omits it.
- **MIRROR**: V8 schema isolation in `src/shared/contracts.ts:749-853` and `legacy-agent-runtime-v2.ts` read adapter.
- **IMPORTS**: Zod, existing WorkspaceIdentity/ActivityContext/OutcomeContract/limits schemas.
- **GOTCHA**: Removing the approval union directly from `TaskSnapshotSchema` will break stored history. Parse legacy snapshots before mapping them to a non-interactive view model.
- **VALIDATE**: `src/shared/contracts.test.ts`, preferences tests, history tests, and application-service tests pass with v9; legacy V8 terminal fixture still renders.

### Task 3: Introduce canonical runtime protocol v4

- **ACTION**: Create a breaking protocol version without approval states or invocation authority metadata.
- **IMPLEMENT**:
  - Change the canonical source to v4 types and names.
  - Remove `awaiting_approval`, `approve`, `deny`, approval waiting metadata, and ApprovalDecisionRequest.
  - Remove `intentRevision`, `approvalRequired`, and `authorizationSource` from DesktopInvocation.
  - Keep effect/consequential, permission interaction/requirements, obligations, expiry, runVersion, and digests.
  - Extend `requestExecuting` with `expectedRunVersion` only; server checks invocation/run ownership and atomically changes requested/delivered → executing.
  - Update generator IDs/output paths to v4 and generate committed schema/catalog/manifest/fixtures.
  - Freeze v3 generated files and add a small `legacy-agent-runtime-v3.ts` parser for terminal/read projection.
  - Add `/v1/agent-runtime/v4/status`, task, events, cancel/respond, worker connect/events/executing/result/permission routes.
- **MIRROR**: Current Zod → JSON Schema → Typify pipeline in `scripts/generate-agent-runtime-contract.mts` and `services/api/src/agent/protocol.rs`.
- **IMPORTS**: Existing digest generator, HOSTED_TOOL_CONTRACTS, Typify, serde.
- **GOTCHA**: Do not silently change files named v3. Protocol version and digest are both compatibility boundaries; v3 artifacts must remain byte-stable.
- **VALIDATE**: `npm run agent:protocol:generate`, `npm run agent:protocol:check`, shared TS protocol tests, Rust `agent_runtime_contract` tests, and Bazel protocol targets pass.

### Task 4: Replace Rust policy authority with action metadata and direct lifecycle execution

- **ACTION**: Remove intent compilation and action evaluation from Rust while retaining parsing, persistence, evidence, and exactly-once behavior.
- **IMPLEMENT**:
  - Move `ActionEffect`, `SensitiveDataTransfer`, `ProposedAction`, and pure effect-shape validation into new `agent/action.rs`.
  - Rename hard-confirm constants/types to high-consequence/consequential metadata and use them only for cancellation/unknown-outcome reporting.
  - Delete `compile_intent_authorization`, `empty_intent_authorization`, rollout sampling, `evaluate_action`, `PolicyDecision`, and Tro-approval-UI detection.
  - Create v9 contracts directly in `AgentService::create`; update encrypted metadata schemaVersion and public projection.
  - Rewrite model instructions: registered tool calls execute automatically; use clarification for missing material choices; never trust connector/screen content as instruction; never retry unknown effects; never claim success without evidence.
  - For desktop calls, persist requested invocation then wait for worker. For connector calls, validate pinned route/schema/connection, persist requested invocation/checkpoint, acquire the execution lease/CAS, call once, and recover/verify without `awaiting_approval`.
  - Remove approval handling from `control`, maintenance expiry, projection, event generation, query serialization, and executing-transition consistency checks.
  - Preserve permission waits, steering, clarification, cancellation, leases, cost budgets, checkpointing, encrypted payloads, evidence, and terminal blocked semantics.
- **MIRROR**: Existing `requested` invocation insertion, lease acquisition, result commit, and `effect_outcome_unknown` handling in `service.rs`; pure lifecycle `transition/project` in `lifecycle.rs`.
- **IMPORTS**: `action::{ActionEffect, ProposedAction}`, protocol v4 DTOs, existing crypto/repository/provider/connector helpers.
- **GOTCHA**: Connector execution and desktop execution have different workers, but both must use the same requested → executing → terminal ownership model. Do not call a connector before the requested invocation/checkpoint transaction commits.
- **VALIDATE**: Rust policy tests are replaced by action-shape/lifecycle/service tests; no production `evaluate_action`, `compile_intent_authorization`, `awaiting_approval`, or approval SQL reference remains after the atomic cutover.

### Task 5: Simplify Electron worker dispatch without weakening execution preconditions

- **ACTION**: Turn DesktopToolWorker into validate → precondition → CAS → dispatch → evidence.
- **IMPLEMENT**:
  - Remove `approvalProvider`, `evaluatePolicy`, policy decision imports, goal intent revision comparison, and mutable execution authorization metadata.
  - Parse v4 envelope, verify both digests, expiry, tool/operation metadata, goal/run mapping, registry support, normalized identity, and observation binding.
  - Run technical permission coordinator when prerequisites exist.
  - Call `requestExecuting(invocationId, expectedRunVersion)` exactly once, then dispatch once.
  - Preserve recent-result replay to the backend, abort behavior, bounded error summaries, evidence construction, observation caching, and unknown results.
  - Remove policy/intent methods/features from RustDesktopEngineClient and desktop engine; leave Google OAuth and voice behavior untouched.
  - Update main-process wiring to remove `requestHostedApproval` and ensure no renderer/companion callback participates in execution.
- **MIRROR**: `desktop-tool-worker.ts:63-140` before policy evaluation and `183-235` after it.
- **IMPORTS**: DesktopInvocationV4/ResultV4, RuntimeToolRegistry, RuntimeToolDispatcher, ComputerPermissionCoordinator.
- **GOTCHA**: `requestExecuting` is not an approval method and must remain. Calling the adapter before this CAS can duplicate side effects after reconnect.
- **VALIDATE**: Worker tests prove direct dispatch, duplicate envelope result replay, CAS refusal, expired/digest mismatch, permission wait, stale observation, cancel, confirmed evidence, and unknown no-retry.

### Task 6: Move target and executor validation to the owning adapters

- **ACTION**: Delete semantic authorization classifiers and retain only deterministic input/precondition validation.
- **IMPLEMENT**:
  - Extract public HTTPS parsing from Rust policy into a shared/browser-owned validator used when normalizing `browser.navigate`: HTTPS only, no credentials, public hostname/IP, no localhost/local/internal/lan/link-local/private/unspecified target.
  - Keep backend tool schema strict and revalidate the normalized URL on Electron immediately before `shell.openExternal` to address time/mutation boundaries.
  - Delete Workspace command safe/approval/denied classification and its `commandClassification` parameter. Treat registered bounded commands as `workspace_command`/consequential metadata.
  - Keep Workspace filesystem canonical path/root/symlink checks; keep shell command count/length/NUL/timeout/output/environment/cancellation bounds.
  - Rename browser deep access from `available_requires_approval` to `available` or `ready_to_prepare`. The model may call `browser.prepare` directly when needed.
  - Rename `CuaAuthorizationBroker` to `CuaCapabilityBroker`, retaining exact task/session/window match, 60-second TTL, one-use grant, bounded resource JSON, and deny-by-default for unexpected native requests.
  - Rename connector `ToolPolicy` and `policy_digest` concepts to reviewed tool contract/catalog contract digest. Retain pinned endpoint, exact tool schema, catalog snapshot, OAuth scopes, bounded untrusted result, and the fact that Gmail has no send/delete tool.
- **MIRROR**: `target_is_admissible` in Rust policy, `validateClassroomUrl` style in shared code, WorkspaceShell validation, and current CUA broker arm/consume logic.
- **IMPORTS**: URL/IP helpers, ActionEffect metadata, CUA driver authorization interface required by the SDK.
- **GOTCHA**: URL syntax validation cannot prevent DNS rebinding by itself. `shell.openExternal` delegates resolution to the browser; document this residual risk or resolve/verify host addresses in a future dedicated network guard without reintroducing user approval.
- **VALIDATE**: Browser tests cover unsafe schemes/credentials/localhost/private IPv4/IPv6; workspace tests prove arbitrary bounded syntax reaches spawn; CUA tests prove unexpected native authorization still fails closed automatically.

### Task 7: Remove approval from local runtime, IPC, companion, and preferences

- **ACTION**: Delete the complete user-decision surface instead of leaving dead stubs.
- **IMPLEMENT**:
  - Remove RequestApproval, DecideApproval, ConsumeApprovalGrant, ApprovalInteraction, ActionApprovalGrant, approval message kinds, and current snapshot grant fields.
  - Keep clarification request/response as the only pending user interaction.
  - Delete `decideApproval` IPC channel from desktop API, preload (main and companion), registration, application service, and hosted client.
  - Simplify companion interaction projection/size/shortcut logic to clarification and response content only.
  - Delete `action-approval`, `approval-details`, renderer approval shortcut helper, and `task-interaction-broker` if a final `rg` confirms it has no clarification production consumer.
  - Remove autonomy from AppPreferences/service and settings properties.
- **MIRROR**: Existing narrow, schema-parsed `respondToInteraction` path; do not create a generic raw “continue” IPC.
- **IMPORTS**: ClarificationInteraction, RespondToInteractionRequest, TaskSnapshot v9.
- **GOTCHA**: Main and companion expose separate DesktopApi shapes; remove the method from both or TypeScript can leave a hidden stale channel.
- **VALIDATE**: IPC tests retain sender/frame/auth/membership rejection; plain renderer/companion bundles contain no `decide-approval`, action digest, approve, or deny task control.

### Task 8: Redesign renderer copy and legacy history presentation

- **ACTION**: Remove approval/autonomy UX and describe the retained execution model honestly.
- **IMPLEMENT**:
  - Delete approval branch from PendingInteractionCard and approval callbacks/state from App.
  - Delete the Settings Autonomy section and footer “Bounded by default / Approval gates enabled.”
  - Do not replace it with a vague safety claim. Use neutral copy such as “Goal-driven execution” and “Registered tools run automatically,” plus a concise note that OS permissions may still pause computer use.
  - Preserve the current uncommitted system-permission copy that distinguishes Accessibility/Screen Recording from high-impact approval, then remove the obsolete “not approval” comparison once no approval concept exists: e.g. “Tro paused because macOS Accessibility/Screen Recording access is not ready.”
  - Remove `awaiting_approval` from task-cancellable phase helpers and live-task CSS variants.
  - Show legacy approval events only as historical text; never show active buttons. Nonterminal v3 history displays update-required/stopped status.
  - Remove approval decisions from Insights and replace that slot with a useful existing metric such as failed/attention events or verified completions.
  - Remove unused English/Vietnamese approval/autonomy strings and dead CSS selectors after an `rg` reference audit.
- **MIRROR**: Current permission coordinator UI and History read-model helpers; keep user-facing rendering separate from runtime state transitions.
- **IMPORTS**: Current TaskSnapshot/TaskEvent/InsightsSummary types only.
- **GOTCHA**: `src/renderer/App.tsx` and its settings/task-execution tests already contain uncommitted user edits. Rebase the implementation around them; never overwrite or revert those changes.
- **VALIDATE**: Renderer tests show no approval card or Autonomy setting, permission wait still works, legacy history is readable/noninteractive, and Settings snapshots/copy are updated.

### Task 9: Migrate PostgreSQL only after the active-run drain

- **ACTION**: Add a forward-only cleanup migration at the next unused sequence (expected 030 after migration 029 lands).
- **IMPLEMENT**:
  - Start with a `DO` guard that raises if any protocol < 4 run is nonterminal.
  - Assert no row remains in `awaiting_approval`; never update it to executing.
  - Drop approval wait index/constraint and approval columns from `agent_runs`.
  - Drop approval index/columns plus authorization source, intent revision, approval required, and related constraints/index from `agent_tool_invocations`.
  - Retain `effect_kind`, `resource_kind`, `consequential`, execution lease, permission columns, and result state. Rename comments/constraints away from policy terminology.
  - Alter run state constraint to remove `awaiting_approval`; preserve `awaiting_permission`.
  - If connector `policy_digest` is renamed, migrate it to `catalog_contract_digest` without recomputing existing values.
  - Register the migration in `db.rs`; update schema inventory/migration count and empty/adopted PostgreSQL tests.
- **MIRROR**: Forward `DROP CONSTRAINT IF EXISTS` / re-add patterns in migrations 025 and 027 plus the disposable `_test` database guard in `postgres_compat.rs`.
- **IMPORTS**: N/A.
- **GOTCHA**: Do not add a new 029 in this checkout. SQLx records migration numbers/checksums; sync the existing 029 first and allocate the next number once.
- **VALIDATE**: Fresh DB migration twice is idempotent; 028/029-shaped DB upgrades successfully when drained; seeded active v3 row makes migration fail before dropping anything; seeded terminal v3 history survives.

### Task 10: Replace approval metrics with autonomous execution reliability metrics

- **ACTION**: Make analytics/evals measure the risks that still exist.
- **IMPLEMENT**:
  - Remove `approval_count`, approvals per success, unnecessary approval count/rate, hard-confirm bypass, authorization source, approval required, and autonomy mode from emitted analytics and reliability fixtures.
  - Preserve privacy: fixed tool ID, operation, effect kind, outcome status, duration, retry/recovery counters, and no request/target/arguments/content.
  - Add/retain gates for verified completion, false completion, duplicate consequential actions, unknown-effect retries (must be zero), recovery rate, user clarification/intervention, cancellation responsiveness, stale observation rejection, and cost/latency per verified success.
  - Distinguish planned clarification from unplanned intervention; OS permission setup may be reported as a technical prerequisite, not approval.
  - Update Insights and CLI Markdown/JSON output together so fixtures do not drift.
- **MIRROR**: Current aggregate-only terminal capture in analytics service and baseline/candidate gate calculation in `reports.rs`.
- **IMPORTS**: TaskEvent effect/consequence/outcome metadata; no ProposedAction parameters.
- **GOTCHA**: Removing approval denominators can produce incomparable historical baselines. Version the reliability scenario/report schema and reject mixed old/new fixture versions with a clear error.
- **VALIDATE**: Analytics privacy tests and Rust reliability report tests pass; a candidate that retries an unknown consequential action fails the gate.

### Task 11: Cut over to v4, delete the executable compatibility path, and align documentation

- **ACTION**: Drain → atomic v4 cutover → cleanup, then update every active product/security claim.
- **IMPLEMENT**:
  - Add generic v4 readiness output to `npm run agent:runtime-versions` / CLI checks.
  - Stop new starts on the old release, query the drain by protocol/state, and cancel stale old approval waits using that release.
  - Wait for executing consequential operations to reach known terminal states. Never force-replay.
  - Deploy the v4 desktop, v4-only backend, and cleanup migration only at zero active v2/v3.
  - Update architecture, lifecycle, conversation, connector, security, privacy, README, env example, and runtime operations docs.
  - State plainly that registered tools run automatically and that OS/provider consent still applies.
  - Preserve historical testing documents; add the v4 evidence document with command output/commit references.
- **MIRROR**: Existing active-version query in `docs/agent-runtime-operations.md` and Rust backend cutover drain rules.
- **IMPORTS**: N/A.
- **GOTCHA**: An older desktop must never connect as v4, and a v4 desktop must never claim a v3 invocation. Exact version plus both digests remain mandatory across the cutover boundary.
- **VALIDATE**: Runtime version report shows only v4 nonterminal work before cleanup; full release commands pass; packaged macOS smoke test completes goal-driven navigation and a workspace action without an approval card.

---

## Testing Strategy

### Core Behavior Matrix

| Scenario | Expected Result | Approval UI? | Important Assertion |
|---|---|---:|---|
| “Open YouTube” | `browser.navigate.open_url` dispatches once | No | Public HTTPS validation; no CUA detour |
| Open `file://`, localhost, private IP | `not_executed` before shell | No | Invalid target, not policy denial |
| Ordinary desktop click/type | CUA dispatches after fresh observation | No | Re-observe after state change |
| Visible Send/Delete/Purchase | Registered desktop action dispatches once | No | Consequential metadata; unknown result blocks/no retry |
| Gmail read message | Connector executes after OAuth/schema validation | No | Remote content remains untrusted and bounded |
| Gmail create draft/labels | Connector executes once | No | No send/delete route exists |
| Missing/revoked Gmail connection | Reconnect/blocked technical state | No | OAuth consent remains external |
| Browser prepare | Exact internal task/window capability auto-arms | No | Unexpected native authorization denied |
| Missing Accessibility | `awaiting_permission` with Settings/continue options | No | No action approval language |
| Workspace file write | Root-confined adapter executes once | No | Symlink/traversal rejection remains |
| `git push`, `curl`, install, pipe shell syntax | Bounded shell executes once | No | No semantic command classifier; documented risk |
| Unknown tool/operation | `not_executed` | No | Catalog/registry mismatch |
| Invalid/oversized tool args | `not_executed` | No | Strict schema/bounds |
| Expired or digest-mismatched envelope | `not_executed` | No | No adapter call/CAS |
| Unknown consequential result | Run becomes blocked | No | Zero automatic retries |
| Material missing choice | `awaiting_input` clarification | No | User answer resumes same run |
| Legacy v3 approval history | Read-only historical entry | No active controls | Cannot resume/approve as v4 |

### Edge Cases Checklist

- [ ] Backend v4 with old desktop and new desktop with old backend
- [ ] Protocol matches but tool catalog digest differs
- [ ] Duplicate/replayed invocation before and after terminal result
- [ ] Worker disconnect before CAS, during execution, and after confirmed result
- [ ] Cancel before dispatch and during consequential execution
- [ ] OS permission revoked between readiness check and native call
- [ ] Browser URL with credentials, Unicode hostname, IPv4/IPv6 private/link-local/unspecified address
- [ ] Workspace symlink escape and `..` traversal through filesystem adapter
- [ ] Workspace shell maximum command count/length/timeout/output and NUL input
- [ ] CUA browser capability TTL, task mismatch, window mismatch, replay, malformed/oversize resource JSON
- [ ] Connector schema snapshot drift, token refresh, reconnect, timeout, unknown provider outcome
- [ ] Activity run cannot gain personal connectors or invalid criterion/tag writes
- [ ] Old preferences containing autonomyMode
- [ ] Old terminal snapshots containing approval messages/grants
- [ ] Active legacy row blocks cleanup migration
- [ ] Migration 029 already present/applied before expected 030
- [ ] Analytics contains no request, URL, recipient, filename, shell command, connector content, or screenshot

---

## Validation Commands

### Contract Generation and Static Checks

~~~bash
npm run agent:protocol:generate
npm run agent:protocol:check
npm run lint
npm run typecheck
~~~

EXPECT: v4 artifacts are current; v3 artifacts remain unchanged; zero lint/type errors.

### Focused TypeScript Tests

~~~bash
npm test -- --run \
  src/shared/agent-runtime-protocol.test.ts \
  src/shared/agent-tool-contracts.test.ts \
  src/shared/contracts.test.ts \
  src/main/hosted/desktop-tool-worker.test.ts \
  src/main/hosted/computer-permission-coordinator.test.ts \
  src/main/agent/runtime-tool-registry.test.ts \
  src/main/agent/action-effect.test.ts \
  src/main/cua/cua-surface-router.test.ts \
  src/main/cua/cua-capability-broker.test.ts \
  src/main/application/hosted-task-client.test.ts \
  src/main/application/task-application-service.test.ts \
  src/main/agent/task-runtime.test.ts \
  src/main/ipc/register-ipc.test.ts \
  src/main/preferences/app-preferences-service.test.ts \
  src/main/analytics/analytics-service.test.ts \
  src/renderer/App.settings-dialog.test.tsx \
  src/renderer/SettingsPage.interaction.test.tsx \
  src/renderer/SettingsPage.test.ts \
  src/renderer/history.test.ts \
  src/renderer/insights.test.ts \
  src/renderer/task-execution.test.ts
~~~

EXPECT: All focused v4/v9, direct execution, permission, history, UI, and privacy tests pass.

### Rust Tests

~~~bash
cargo test --manifest-path services/api/Cargo.toml --locked
~~~

EXPECT: v4 protocol/lifecycle/service/connector/report tests pass; no policy module remains after the atomic cutover.

### PostgreSQL Compatibility

~~~bash
TEST_DATABASE_URL='postgres://localhost/trocode_agent_test' \
  cargo test --manifest-path services/api/Cargo.toml --locked \
  --test postgres_compat -- --ignored --test-threads=1
~~~

EXPECT: disposable local `_test` database passes empty, adopted, idempotent, drain-guard, and terminal-history cases. Never run this against dev or production.

### Repository Release Gates

~~~bash
npm run check
npm run bazel:check
npm run package
git diff --check
git status --short
~~~

EXPECT: All repository-required gates pass, packaged runtime handshakes on v4, no whitespace errors, and pre-existing user changes remain preserved.

### Removal Audit

~~~bash
rg -n "awaiting_approval|approvalRequired|authorizationSource|intentAuthorization|approvalPolicy|decideApproval|requestApproval|consumeApprovalGrant|HOST_ALWAYS_CONFIRM|available_requires_approval|TROCODE_INTENT_AUTHORIZATION" \
  src services/api/src protocol/agent-runtime.v4.schema.json protocol/agent-tools.v4.json .env.example README.md PRIVACY.md docs
~~~

EXPECT after the atomic cutover: no active-runtime/product references. Matches are allowed only in explicitly named legacy v2/v3/V8 parsers, frozen v3 artifacts, historical migrations, and historical `docs/testing` evidence.

---

## Manual Acceptance

- [ ] Start “Open YouTube”; browser opens directly without approval or computer-use permission.
- [ ] Start a multi-step visible desktop goal; it observes, acts, re-observes, and completes without approval cards.
- [ ] Trigger macOS Accessibility/Screen Recording absence; Settings/continue-without-computer still works with technical-permission wording.
- [ ] Trigger browser semantic preparation; it attaches only to the current observed task/window without user approval.
- [ ] Run a bounded Workspace command that the old classifier required approval for; it executes once.
- [ ] Cause an unknown consequential result by disconnecting the worker during execution; task blocks and never retries.
- [ ] Read/create draft/label through connected Gmail; no per-call approval appears and no send tool is offered.
- [ ] Open old terminal task history containing approval events; it renders read-only.
- [ ] Open Settings; no Balanced/Strict Autonomy section and no “Bounded by default” claim appears.
- [ ] Inspect Insights and reliability report; approval metrics are absent and unknown-retry/verified-outcome metrics are present.

---

## Acceptance Criteria

- [x] Every new task uses authority contract v9 and protocol v4.
- [x] No current authority/wire/persistence/UI type contains intent grants, approval policy, approval required, authorization source, or approval decision.
- [x] No production function returns an action-level allowed/needs-approval/denied policy decision.
- [x] A registered schema-valid action proceeds automatically after technical preconditions and the one-time execution CAS.
- [x] Unknown/unregistered operations and malformed inputs are rejected as contract/precondition failures, not policy decisions.
- [x] OS permission, OAuth consent, clarification, cancellation, budgets, workspace binding, URL validation, and verification still work.
- [x] The CUA internal native authorization broker is automatic, task/window scoped, expiring, one-use, and not exposed as user approval.
- [x] Unknown consequential outcomes are blocked and never automatically retried.
- [x] No old pending approval is auto-approved, converted to executing, or resumed under v4 semantics.
- [x] The atomic cutover refuses to run with active legacy work and never mixes v3 and v4 execution.
- [x] Legacy terminal v2/v3/V8 history remains readable but noninteractive.
- [x] The Workspace shell risk is documented accurately; no hidden semantic command denylist remains.
- [x] Renderer remains sandboxed and receives no raw CUA, Electron IPC, connector token, or direct tool dispatch handle.
- [x] Analytics/reporting contain fixed identifiers and outcome aggregates only, with no private action content.
- [x] Required TypeScript, Rust, Bazel, package, protocol, and database checks pass.

## Completion Checklist

- [x] The atomic-cutover PR has explicit drain, rollout, and rollback notes.
- [x] v3 generated artifacts are frozen and v4 artifacts are generator-owned.
- [x] V9 is the only new executable authority contract.
- [x] Migration number is allocated after migration 029 is synchronized.
- [x] No old migration file is modified.
- [x] Existing uncommitted edits in `service.rs`, `App.tsx`, and renderer tests are preserved/reconciled.
- [x] Historical approval TDD documents remain historical; new v4 evidence is added.
- [x] Documentation no longer implies OpenCUA itself supplies a production harness.
- [x] Diff review confirms the policy was deleted rather than bypassed with `allowed: true` stubs.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Model performs an unintended consequential action | Medium | Critical | Limit tools to explicit registered schemas, keep cancellation/audit/evidence, preserve one-action/reobserve loop, document accepted product risk |
| Unrestricted Workspace shell escapes intended project scope | High | Critical | Explicit release warning, retain scrubbed env/time/output bounds, default Workspace opt-in, kill switch; future sandbox is a separate feature, not an approval disguise |
| Mixed v3/v4 deployment strands work | Medium | High | Prohibit mixed executable versions, require an active-run drain, use exact digests, and retain only a read-only legacy adapter |
| Old approval wait is accidentally executed | Low | Critical | Never normalize active V8/v3 to v9/v4; drain guard; migration assertion; cancel with old release |
| Removing approval types breaks history parsing | Medium | Medium | Dedicated V8/v3 legacy parser and representative persisted fixtures |
| Connector private data enters the model without per-read approval | High | High | OAuth consent remains explicit, scopes/catalog stay narrow, content bounded/untrusted, privacy docs updated, connectors omitted from classroom runs |
| Browser prepare becomes an ambient native grant | Low | High | Keep exact task/window matching, TTL, one-use token, deny unexpected requests; automatic only around registered tool dispatch |
| URL validation regresses when Rust policy is deleted | Medium | High | Relocate to browser adapter and test unsafe schemes/private targets on both normalization and dispatch boundary |
| Approval metrics disappear without replacement | Medium | Medium | Version eval schema; gate duplicate actions, unknown retries, false completion, verification, recovery, latency/cost |
| Current uncommitted work is overwritten | Medium | High | Rebase carefully, inspect `git diff` before each touched file, never reset or checkout user changes |

## Final Architectural Note

The clean end state is not “no harness.” It is “no Tro authorization ceremony inside the harness.” The model owns planning and tool selection; registered adapters own typed execution; the runtime owns lifecycle, exactly-once dispatch, technical prerequisites, evidence, and recovery. That is the closest fit to an OpenCUA-style autonomous loop without turning a research model into an unbounded Electron/OS capability.
