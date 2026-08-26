# Plan: Canonical Agent Runtime Contract v3

## Summary

Introduce one versioned, executable contract for the Rust agent backend, Electron main process, preload boundary, and React renderer. A pure Zod source will generate deterministic JSON Schema, a complete hosted-tool catalog, protocol/tool digests, and Rust DTOs; compile-time types, shared fixtures, and CI freshness checks will make drift a build failure instead of a runtime surprise.

Use that contract to repair the failures visible in the current product: invalid OpenAI strict tool schemas, backend errors mislabeled as `blocked`, contradictory terminal/cancellation rules, a system-wide plain-Escape cancel shortcut, and a generic clarification path that cannot safely pause and resume for operating-system permissions. Protocol v2 remains readable during rollout, but the final state permits new tasks and desktop execution only when both sides exactly match protocol v3 and the v3 tool catalog.

## User Story

As a Tro user, I want the desktop and hosted agent to agree on one lifecycle and tool contract, so that harmless work such as opening YouTube runs normally, permission requests pause and resume without cancelling the task, and backend upgrades cannot silently break the frontend.

## Problem → Solution

The backend, Electron, renderer, database constraints, and model tool definitions each hand-maintain overlapping schemas and lifecycle lists → define the wire protocol and hosted tool catalog once, generate the language-specific artifacts, make the backend return authoritative state/action metadata, and reject incompatible new work before creating or executing it.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: N/A (standalone)
- **Estimated Files**: 45-55 paths across shared TypeScript, Electron, React, Rust, SQL, Cargo/Bazel, tests, generated artifacts, and docs
- **Recommended Delivery**: Five mergeable gates: generation foundation; typed Rust/HTTP boundaries; lifecycle/cancellation; tool/permission execution; renderer/rollout cleanup
- **Protocol Target**: v3 for new work; v2 read compatibility only after rollout enforcement
- **Confidence**: 8/10; raise to 9/10 after Task 1 proves Zod 4.4.3 → Draft 2020-12 → Typify 0.7.0 under Cargo and Bazel

---

## Scope Decision

### In scope

- One source for every agent-runtime request, response, SSE event, error, worker envelope, lifecycle/event enum, permission interaction, and user-visible available action.
- One hosted-tool catalog containing identity, model name, description, operations, exact strict parameters, operation/effect selectors, prerequisites, and default effect behavior.
- Deterministic checked-in schema/catalog/manifest artifacts and separate `protocolDigest` and `toolCatalogDigest`.
- Rust DTO generation from the schema and typed agent HTTP/model boundaries.
- Server-owned transition rules, cancellation eligibility, terminal/failure classification, and event projections.
- Durable `awaiting_permission` that resumes the same invocation only after permission is truly ready.
- Removal of system-wide Escape cancellation; focused cancellation is explicit and source-tagged.
- Correct classification of definitive provider/tool-schema failures as `failed`.
- Exact OpenAI strict schemas for v3 tools.
- Shared TS/Rust contract corpus, database inventory tests, CI freshness checks, and staged v2/v3 rollout.

### NOT Building

- A new model provider, CUA driver, browser extension, or permission bypass.
- Raw Electron IPC, CUA, backend transitions, or registry access in the renderer.
- Automatic approval for consequential actions or retries of unknown consequential effects.
- Protobuf, GraphQL, or a repo-wide OpenAPI migration.
- A permanent dual-execution architecture; v2 is a bounded rollout/read adapter.
- Silent v3 coercion. Legacy v2 may use a bounded compatibility parser; v3 objects are closed.

---

## UX Design

### Before

```text
User: Mở YouTube.
  -> backend builds strict:true with input.additionalProperties:true
  -> provider rejects before inference
  -> generic catch changes run to blocked
  -> main says blocked is terminal; renderer says it is live/cancellable
  -> system-wide Escape remains registered
  -> returning from System Settings can cancel the run
  -> UI reports only "safe recovery boundary"
```

Permission path today:

```text
Backend labels -> choice-1 / choice-2
Renderer checks connect_computer (unreachable)
Even if reached: open Settings -> immediately submit answer
No wait for CuaStatus.state=ready
```

### After

```text
User: Mở YouTube.
  -> exact v3 protocol/tool digests match before task creation
  -> backend sends exact strict open_url schema
  -> browser.navigate executes without CUA permission
  -> event carries authoritative lifecycle/actions
  -> task completes normally
```

Permission path after the change:

```text
Computer tool needs permission
  -> invocation remains non-executing
  -> backend state = awaiting_permission
  -> [Open System Settings] [Continue without computer] [Cancel task]
  -> leaving Tro never cancels
  -> focus/visibility refresh checks CuaStatus
  -> only ready resumes the same invocation exactly once
  -> Continue without commits not_executed and allows another path
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Start task | Numeric v2 assumption | Version plus two exact digests | Mismatch fails before insert |
| Open URL/app | Generic nested input | Exact generated schema | No CUA prerequisite |
| OS permission | Generic labels/synthetic IDs | Typed enum actions | Opening Settings does not answer |
| Return to Tro | Refresh unrelated to task | Ready resumes same invocation | Incomplete stays waiting |
| Escape | Registered globally | No global shortcut; scoped focused Escape | Disabled for modal/editable/permission UI |
| Stop | Frontend phase list | Server `availableActions` | Version-fenced request |
| Blocked | Terminal in main, live in renderer | Consistently terminal | Retry creates new run |
| Backend failure | Generic blocked | Stable failed code | Private details only in logs |
| Version skew | Runtime parse failure | Typed pre-work upgrade response | v2 history remains readable |

---

## Mandatory Reading

Line numbers refer to the 2026-08-26 checkout.

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `AGENTS.md` | all | Renderer sandbox, narrow `DesktopApi`, boundary parsing, pure policy/lifecycle, no unknown-effect retry, verification gates |
| P0 | `docs/architecture.md` | 5-24, 42-86 | Rust ownership, desktop authority split, execution and fail-closed boundaries |
| P0 | `docs/agent-runtime-operations.md` | 1-67 | Current v2/v8 assumptions and release gates |
| P0 | `src/shared/contracts.ts` | 833-849, 1005-1045, 1095-1135, 1624-1788 | Duplicated states, missing permission type, permissive record, generic event, v2 worker schema |
| P0 | `src/main/application/hosted-task-client.ts` | 11-91, 101-230 | Handwritten projection, boundary parsing, numeric status, DELETE cancel |
| P0 | `src/main/application/task-application-service.ts` | 104-188, 250-348 | Submission/restoration and event-name state inference |
| P0 | `src/main/hosted/desktop-worker-protocol.ts` | all | Independent tool inventory and incomplete digest |
| P0 | `src/main/hosted/desktop-tool-worker.ts` | 58-191 | Boundary/policy/grant ordering; permission must be before `requestExecuting` |
| P0 | `src/main/agent/runtime-tool-registry.ts` | 43-61, 495-813, 821-1535 | Exact schemas, recursive strict assertion, parsers, normalization, registry |
| P0 | `src/main/agent/cua-semantic-agent-tools.ts` | 548-690 | Conditional computer schemas absent from backend catalog |
| P0 | `src/main/agent/execution-coordinator.ts` | 256-283 | CUA session currently starts at dispatch and throws |
| P0 | `src/main/cua/cua-service.ts` | 330-407, 409-430, 919-965 | Canonical readiness/permission detection |
| P0 | `src/main/agent/global-task-cancel-shortcut.ts` | all | System-wide Escape to remove |
| P0 | `src/renderer/task-execution.ts` | all | Local cancellability and unconditional Escape |
| P0 | `src/renderer/App.tsx` | 109-125, 1211-1235, 1883-1981, 2547-2609 | Terminal sets, refresh, stop/Escape, unreachable permission branch |
| P0 | `services/api/src/agent/service.rs` | 23-63, 265-390, 394-915, 940-995, 1166-1734, 1908-1928, 2094-2125 | Handwritten tool/digest, raw DTOs, ad hoc transitions, failure handling, malformed strict schema |
| P0 | `services/api/src/http/agent_runtime.rs` | all | Untyped agent routing and v2 status/cancel compatibility |
| P0 | `services/api/src/providers/responses.rs` | 180-235 | Provider certainty/status behavior |
| P0 | `services/api/migrations/014_agent_runtime.sql` | 1-145, 178-188 | Run/tool state constraints and worker protocol columns |
| P0 | `services/api/tests/agent_runtime_compat.rs` | 195-280 and remaining cases | Real PostgreSQL/Wiremock lifecycle pattern |
| P1 | `services/api/src/error.rs` | 9-119 | Sanitized coded error pattern |
| P1 | `services/api/src/app.rs` | 96-124 | Structured tracing pattern |
| P1 | `src/main/agent/task-runtime.ts` | 53-75, 198-250 | Renderer-only projection and interaction pattern |
| P1 | `src/index.ts` | 259-273, 1259-1300, 1758-1769 | Registry composition, synthetic choices, global cancel wiring |
| P1 | `src/main/ipc/register-ipc.ts` | 685-791 | Trusted task/CUA IPC entry points |
| P1 | `src/preload.ts` | 529-584 | Narrow API parsing/invocation |
| P1 | `src/renderer/history.ts` | all | Another terminal-state inventory |
| P1 | `src/main/analytics/analytics-service.ts` | 60-70, 250-280 | Another terminal-state inventory and safe analytics |
| P1 | `services/api/tests/contract_corpus.rs` | 1-170 | Compatibility/migration fixture pattern |
| P1 | `services/api/tests/fixtures/schema_inventory.json` | all | Stale agent state inventory |
| P1 | `services/api/tests/http_compat.rs` | agent route cases | Black-box compatibility pattern |
| P1 | `src/main/application/hosted-task-client.test.ts` | all | Injected fetch/retry cases |
| P1 | `src/main/hosted/desktop-tool-worker.test.ts` | all | Injected registry/policy/dispatcher |
| P1 | `src/main/agent/runtime-tool-registry.test.ts` | relevant strict/catalog cases | Exact model catalog validation |
| P1 | `src/shared/contracts.test.ts` | 134-168 | Existing v2 envelope test |
| P2 | `package.json`, `tsconfig.json` | all | Generator/check scripts and Node 24 TS support |
| P2 | `services/api/Cargo.toml`, `Cargo.lock` | all | Typify and lock |
| P2 | `services/api/BUILD.bazel`, `BUILD.bazel`, `MODULE.bazel.lock` | relevant sections | Generated compile data and reproducible Bazel dependencies |
| P2 | `.github/workflows/ci.yml` | all | Node 24, PG, Bazel, root check, package gates |

`docs/CODEX-NAVIGATION-GUIDE.md` is referenced by the repository instructions but is absent. Do not invent assumptions from it.

---

## Current Architecture and Failure Trace

```text
React
  -> preload parses renderer request
  -> IPC parses again
  -> TaskApplicationService submits hosted payload
  -> Rust read_json -> serde_json::Value
  -> AgentService manually validates and emits json!
  -> HostedTaskClient parses a different Zod schema
  -> TaskApplicationService infers state from event.type
  -> React infers terminal/cancellable from another Set
```

The screenshot's immediate root cause is:

```text
service.rs:model_tools
  input = {type:object, additionalProperties:true}, strict=true
OpenAI rejects before inference
ResponsesService returns status=400 and releases budget
AgentService ignores status, parses it as model output, finds no final text
run_once turns processing error into generic blocked
renderer still considers blocked cancellable
cancel SQL allows blocked -> cancelled
```

The permission/cancel race is independent but compounds it: labels become `choice-*`, `connect_computer` is unreachable, and plain Escape remains active system-wide.

---

## Unified Discovery Table

| Category | File:Lines | Current pattern | v3 requirement |
|---|---|---|---|
| Similar protocol | `src/main/engine/rust-desktop-engine-client.ts:20-50` | Literal version plus Zod boundary | Generate version/digests and validators |
| Error | `services/api/src/error.rs:9-119` | Coded public error/private source | Generated error body; stable conflict codes |
| Logging | `services/api/src/app.rs:96-124` | Fixed `tracing` event fields | Add protocol/transition/permission/provider events without payloads |
| Types | `contracts.ts:1624-1788` | Zod; v2 record passthrough | Strict JSON-representable v3; isolated legacy v2 |
| Tool schemas | `runtime-tool-registry.ts:495-1425` | Exact schema plus separate parser | Extract one pure hosted contract |
| Backend DTOs | `service.rs:500-590,1564-1568` | `Value`/`json!` | Generated Rust request/response/event types |
| State writes | `service.rs:365-373,782-805,1456-1485` | Transactions, ad hoc string predicates | Keep transactions; central pure transition |
| Tests | `hosted-task-client.test.ts:32-75` | Injected fetch | Exact v3/mismatch/fencing cases |
| Tests | `agent_runtime_compat.rs:249+` | Ignored PG + Wiremock | Migration/provider/permission/cancel cases |
| Config | `config.rs`, CI | Typed config and env CI | `AGENT_RUNTIME_V3_MODE=observe|dual|enforce` |
| Event flow | `task-application-service.ts:319-348` | Event name → guessed state | Event contains authoritative run projection |
| Trust boundary | `task-runtime.ts:53-59` | Desktop cannot transition backend | Preserve; UI reports response only |

---

## External Documentation

Verified against official documentation on 2026-08-26.

| Topic | Source | Key takeaway | Gotcha |
|---|---|---|---|
| Zod JSON Schema | [Zod](https://zod.dev/json-schema) | Stable `z.toJSONSchema`, Draft 2020-12, strict objects emit `additionalProperties:false` | Transforms/dates/custom/undefined are unrepresentable; generator must throw |
| OpenAI strict tools | [OpenAI](https://developers.openai.com/api/docs/guides/function-calling#strict-mode) | Every object closed; every property required; nullable expresses optional model fields | Validate nested properties, arrays, and unions recursively |
| Rust generation | [Typify 0.7.0](https://docs.rs/typify/latest/typify/) | `import_types!` generates public Serialize/Deserialize Rust types | Spike exact schema under Cargo and Bazel first |
| Node TS runner | [Node](https://nodejs.org/api/typescript.html) | Node 24.12+ stable stripping; `.mts` is ESM | Node ignores tsconfig and does not transform enums/decorators |

Do not use experimental `z.fromJSONSchema`; do not set `unrepresentable:"any"`; do not disable OpenAI strict mode.

---

## Strategic Design

### Source and generated flow

```text
src/shared/agent-runtime-protocol.ts   human-edited strict Zod wire contract
src/shared/agent-tool-contracts.ts     human-edited pure hosted tool catalog
                |
                v
scripts/generate-agent-runtime-contract.mts
                |
                +-> protocol/agent-runtime.v3.schema.json
                +-> protocol/agent-tools.v3.json
                +-> protocol/agent-runtime.v3.manifest.json
                |
      +---------+----------+
      v                    v
TS imports Zod       Typify Rust DTOs
      +---------+----------+
                v
shared fixtures + protocol:check + Cargo/Bazel/CI
```

Backend ownership remains semantic: Rust owns transitions, policy, and persistence. Zod is the authoring syntax for the shared wire shape because the desktop already needs runtime validators.

### Mandatory future change workflow

1. Edit protocol/tool source first.
2. Bump protocol version for a breaking wire/semantic change.
3. Run `npm run agent:protocol:generate`; review all generated diffs.
4. Update Rust/Electron/renderer consumers until they compile.
5. Add a shared fixture plus transition/tool test.
6. Run `agent:protocol:check`, root check, Bazel, and package gates.
7. Roll out observe → dual → enforce.

No public v3 `json!` response, arbitrary `Value` request, free-form event/state string, version literal, or local terminal-state list is allowed outside generated/legacy adapter modules.

### Hashing

- Recursively sort object keys; preserve array order.
- UTF-8, two spaces, LF, exactly one trailing newline.
- `protocolDigest = SHA-256(exact schema bytes)`.
- `toolCatalogDigest = SHA-256(exact tool catalog bytes)`.
- Manifest records version, both digests, generator version, run/tool states, event types, actions, permission kinds, cancellation sources, failure codes, and tool IDs.
- `--check` generates in memory, compares exact bytes, reports stale paths, exits nonzero, and never writes.

### Required v3 DTO inventory

| Area | Definitions |
|---|---|
| Negotiation | `AgentRuntimeStatusV3`, `AgentRuntimeCompatibilityV3`, `AgentRuntimeErrorBody` |
| Task | `SubmitAgentTaskV3`, `AgentRunRecordV3`, `AgentRunListV3`, `CancelAgentRunV3`, steering/approval/permission decisions |
| Lifecycle | run state, lifecycle, projection, available action, waiting-on, failure, cancellation source |
| Event | closed event type, event with authoritative run projection, outcome/evidence summaries |
| Worker | capabilities/session/invocation/grant/result/permission wait/heartbeat/disconnect |
| Tool | hosted contract, operation/effect selectors, prerequisites |

All v3 objects are strict. Keep cross-field policy checks in pure functions after structural parse so JSON Schema remains representable.

### Authoritative projection

Every run record and event carries:

```ts
type AgentRunProjectionV3 = {
  state: AgentRunStateV3;
  runVersion: number;
  phase: TaskPhase;
  terminal: boolean;
  availableActions: AgentRunActionV3[];
  waitingOn: WaitingOnV3 | null;
  failure: AgentRunFailureV3 | null;
  cancellationSource: CancellationSourceV3 | null;
};
```

The renderer formats labels/layout only. It does not derive terminal, cancellable, waiting, or failure semantics.

### Lifecycle table

| State | Phase | Terminal | Actions | Next-state families |
|---|---|---:|---|---|
| queued | ready | no | cancel | compiling/planning/cancelled/failed/expired |
| compiling_outcomes | planning | no | cancel | planning/awaiting_input/failed/cancelled/expired |
| planning | planning | no | steer,cancel | wait/input/verify/complete/block/fail/cancel/expire |
| awaiting_worker | paused | no | steer,cancel | recover/permission/cancel/fail/expire |
| awaiting_permission | awaiting_permission | no | settings,continue_without,cancel | execute/verify/recover/cancel/fail/expire |
| awaiting_input | awaiting_input | no | respond,cancel | recover/plan/cancel/fail/expire |
| awaiting_approval | awaiting_approval | no | approve,deny,cancel | recover/plan/cancel/fail/expire |
| executing_tool | acting | no | cancel | verify/block/fail/cancel/expire |
| verifying | verifying | no | cancel | plan/complete/block/fail/cancel/expire |
| recovering | planning | no | steer,cancel | plan/worker/permission/verify/block/fail/cancel/expire |
| completed | completed | yes | none | none |
| blocked | blocked | yes | optional retry_as_new_task | none |
| failed | failed | yes | optional retry_as_new_task | none |
| cancelled | cancelled | yes | none | none |
| expired | failed | yes | retry_as_new_task | none |

`blocked` is reserved for unknown consequential outcomes or unverifiable required outcomes. Recoverable prerequisites use explicit waiting states. Retry creates a new run.

### Cancellation

- Delete Electron global plain Escape.
- Stop sends `stop_button`; focused Escape sends `focused_escape`; replacement/sign-out/shutdown use closed sources.
- Request includes `clientCommandId` and `expectedRunVersion`.
- Backend locks, checks lifecycle/version, records source, transitions atomically.
- Stale/non-cancellable returns coded 409; client refetches once and does not issue another cancel.
- Cancelling an already-executing consequential invocation yields blocked/`effect_outcome_unknown`, not false `cancelled`.
- Permission/modal/editable contexts suppress focused Escape. Blur/visibility never cancels.

### Permission

- Tool catalog declares prerequisites; direct navigation/launch/workspace/knowledge tools do not require CUA.
- Worker checks prerequisite after schema/policy validation and before `requestExecuting`.
- Missing permission uses typed endpoint; backend persists one interaction ID and `awaiting_permission`.
- Open Settings leaves it pending.
- Only `CuaStatus.state==="ready" && available` resolves granted and obtains the one-time execution grant.
- Continue without commits `not_executed`, never confirmed.
- Reconnect/restart reconstructs the same wait; never grants twice.

### Failure classification

| Condition | Classification | Public code | Retry |
|---|---|---|---|
| Provider 400/401/403/404/422 before inference | failed | provider_request_rejected | new run after fix |
| Protocol/tool mismatch | no new run/session | *_upgrade_required | upgrade then retry |
| Definitely pre-dispatch transport failure | failed | provider_unavailable | new run may be offered |
| Ambiguous provider dispatch | blocked | provider_outcome_unknown | never automatic |
| Unknown consequential desktop result | blocked | effect_outcome_unknown | never automatic |
| Required outcome unverifiable | blocked | required_outcome_unverified | new run may be offered |
| Internal invariant | failed | internal_runtime_error | no raw details |

Inspect `ProviderResponse.status` before output parsing. Log fixed status/request/error IDs only, not provider bodies, task text, tool input, screenshots, or credentials.

### Rollout

1. New desktop reads v2 history/status and v3, preferring `GET /v1/agent-runtime/v3/status`.
2. Backend `observe` keeps v2 behavior while logging would-be compatibility.
3. `dual` accepts explicitly tagged matching v3 and drains supported v2 work.
4. `enforce` rejects v2 new task/worker paths with `desktop_upgrade_required`; v2 GET/list/events remain readable.
5. Remove v2 read adapter only after telemetry/retention allow it.

Task submit and worker connect carry version plus both digests. Do not depend on simultaneous deploys.

---

## Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Handwritten Zod/Rust plus tests | Reject | Current drift proves remembered tests are insufficient |
| Rust/Schemars then JSON→Zod | Reject | Reverse Zod conversion is experimental and renderer needs validators |
| Handwritten JSON Schema generating both | Reject here | Adds another Zod generator and discards existing inference patterns |
| Whole-backend OpenAPI | Reject | Unrelated expansion; SSE/tool domain still special |
| One digest | Reject | Cannot distinguish wire from tool compatibility |
| Disable OpenAI strict | Reject | Hides malformed schema and weakens calls |
| Worker sends arbitrary schemas | Reject | Stale/compromised client must not define backend model schemas |
| Permissions as text choices | Reject | Cannot encode readiness/restart/exact resume |
| Keep global Escape | Reject | Unsafe outside Tro |
| Treat all errors as blocked | Reject | Technical pre-execution failure is not unknown effect |

---

## Patterns to Mirror

### Boundary validation

```ts
// src/main/application/hosted-task-client.ts:114-121
const data = block
  .replaceAll('\r\n', '\n')
  .split('\n')
  .filter((line) => line.startsWith('data:'))
  .map((line) => line.slice(5).trimStart())
  .join('\n');
return data ? HostedTaskEventSchema.parse(JSON.parse(data)) : null;
```

Parse immediately at HTTP, SSE, IPC, and model boundaries.

### Strict tool schema

```ts
// src/main/agent/runtime-tool-registry.ts:495-515
const functionSpec = (name, description, parameters) => ({
  type: 'function',
  name,
  description,
  strict: true,
  parameters,
});
const objectSchema = (properties, required) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
```

Move the typed builders/assertion to the shared tool module; do not duplicate Rust JSON builders.

### Sanitized error

```rust
// services/api/src/error.rs:39-47
pub const fn coded(status: StatusCode, code: &'static str, message: &'static str) -> Self {
    Self { status, code: Some(code), message, retry_after_seconds: None, source: None }
}
```

Stable public code/message; private source remains log-only.

### Transactional state change

```rust
// services/api/src/agent/service.rs:365-375
let mut tx = self.pool.begin().await?;
let row = sqlx::query("UPDATE agent_runs ... RETURNING *")
    .bind(run)
    .bind(user)
    .fetch_optional(&mut *tx)
    .await?;
// invocation, metadata, and event change in same transaction
tx.commit().await?;
```

Replace broad predicates with exact expected state/version plus pure lifecycle decision.

### Injected client test

```ts
// src/main/application/hosted-task-client.test.ts:33-48
const fetchImpl = vi.fn<typeof fetch>()
  .mockRejectedValueOnce(new TypeError('connection reset'))
  .mockResolvedValueOnce(Response.json(record));
const client = new HostedTaskClient({
  accessTokenProvider: async () => 'token',
  apiBaseUrl: 'https://api.example.com',
  fetchImpl,
});
```

Use deterministic injected fetch/CUA/dispatcher/time and assert call count/identity.

### Real PostgreSQL test

```rust
// services/api/tests/agent_runtime_compat.rs:249+
#[tokio::test]
#[ignore = "requires a disposable local PostgreSQL 17 TEST_DATABASE_URL"]
async fn durable_agent_completes_verified_work_and_blocks_unknown_effects() {
    let server = MockServer::start().await;
    // ...
}
```

Extend this CI path for durable transition/permission/provider behavior.

## Files to Change

Generated artifact paths are created by implementation and must not be hand-edited.

| File | Action | Justification |
|---|---|---|
| `src/shared/agent-runtime-protocol.ts` | CREATE | Canonical strict Zod v3 wire definitions/types |
| `src/shared/agent-tool-contracts.ts` | CREATE | Canonical hosted tool catalog and strict assertion |
| `src/shared/legacy-agent-runtime-v2.ts` | CREATE | Isolated read-only v2 compatibility |
| `src/shared/agent-runtime-protocol.test.ts` | CREATE | Schema/digest/fixture tests |
| `src/shared/agent-tool-contracts.test.ts` | CREATE | Catalog/selector/OpenAI strict tests |
| `scripts/generate-agent-runtime-contract.mts` | CREATE | Deterministic `--write`/`--check` generator |
| `protocol/agent-runtime.v3.schema.json` | CREATE generated | Rust-consumed language-neutral schema |
| `protocol/agent-tools.v3.json` | CREATE generated | Exact backend model/tool catalog |
| `protocol/agent-runtime.v3.manifest.json` | CREATE generated | Versions, digests, enum inventories |
| `protocol/BUILD.bazel` | CREATE | Export generated data to Rust target |
| `test/fixtures/agent-runtime-v3/*.json` | CREATE | Shared positive/negative contract corpus |
| `src/shared/contracts.ts` | UPDATE | Re-export v3; add permission/lifecycle fields; remove hosted v3 duplication |
| `src/shared/contracts.test.ts` | UPDATE | Keep v2 as explicit legacy coverage |
| `src/main/agent/agent-contracts.ts` | UPDATE | Import shared strict schema/spec types |
| `src/main/agent/runtime-tool-registry.ts` | UPDATE | Reference canonical metadata/parameters |
| `src/main/agent/cua-semantic-agent-tools.ts` | UPDATE | Reference canonical computer contracts/prerequisites |
| `src/main/agent/runtime-tool-registry.test.ts` | UPDATE | Assert catalog/registry/parser identity |
| `src/main/hosted/desktop-worker-protocol.ts` | UPDATE | Generated version/digests/catalog, no hardcoded list |
| `src/main/hosted/desktop-worker-client.ts` | UPDATE | Typed v3 connect/events/grant/result/permission |
| `src/main/hosted/desktop-tool-worker.ts` | UPDATE | Prerequisite wait before execution grant |
| `src/main/hosted/desktop-tool-worker.test.ts` | UPDATE | Direct/wait/resume/continue/restart/exact-once cases |
| `src/main/hosted/computer-permission-coordinator.ts` | CREATE | Main-process permission wait/resume broker |
| `src/main/hosted/computer-permission-coordinator.test.ts` | CREATE | Focus/incomplete/ready/restart tests |
| `src/main/application/hosted-task-client.ts` | UPDATE | Typed v3 negotiation/API/SSE/error |
| `src/main/application/hosted-task-client.test.ts` | UPDATE | Mismatch/fencing/legacy-read tests |
| `src/main/application/task-application-service.ts` | UPDATE | Authoritative projection, source-tagged cancel |
| `src/main/application/task-application-service.test.ts` | UPDATE | Terminal/stale/provider/permission cases |
| `src/main/agent/task-runtime.ts` | UPDATE | Project typed permission without backend authority |
| `src/main/agent/task-runtime.test.ts` | UPDATE | Permission/lifecycle projection |
| `src/main/agent/execution-coordinator.ts` | UPDATE | Direct tools bypass CUA; CUA only after readiness |
| `src/main/agent/execution-coordinator.test.ts` | UPDATE | Prerequisite behavior |
| `src/main/cua/cua-service.ts` | UPDATE | Stable readiness observations/events |
| `src/main/cua/cua-service.test.ts` | UPDATE | Permission readiness/reconnect |
| `src/main/agent/global-task-cancel-shortcut.ts` | DELETE | Remove system-wide task cancellation |
| `src/main/agent/global-task-cancel-shortcut.test.ts` | DELETE | Obsolete test |
| `src/index.ts` | UPDATE | Remove shortcut; construct coordinator; remove synthetic permission choices |
| `src/preload.ts` | UPDATE | Typed cancel and permission methods |
| `src/main/ipc/register-ipc.ts` | UPDATE | Parse new DTOs at IPC boundary |
| `src/renderer/task-execution.ts` | UPDATE | Server actions/terminal; context-safe focused Escape |
| `src/renderer/task-execution.test.ts` | UPDATE | Terminal/focus/editable/modal cases |
| `src/renderer/App.tsx` | UPDATE | No terminal sets/magic ID; typed permission/failure UI |
| `src/renderer/history.ts` | UPDATE | Authoritative terminal including blocked/expired |
| `src/renderer/history.test.ts` | UPDATE | v2 legacy and v3 terminal |
| `src/main/analytics/analytics-service.ts` | UPDATE | Authoritative lifecycle and fixed codes/sources |
| `src/main/analytics/analytics-service.test.ts` | UPDATE | Privacy and classification |
| `services/api/src/agent/protocol.rs` | CREATE | Typify DTOs, manifest/digest constants, conversions |
| `services/api/src/agent/lifecycle.rs` | CREATE | Pure exhaustive transitions/projections |
| `services/api/src/agent/tool_catalog.rs` | CREATE | Trusted catalog loader and selectors |
| `services/api/src/agent/mod.rs` | UPDATE | Export new modules; legacy digest no longer v3 authority |
| `services/api/src/agent/service.rs` | UPDATE | Typed boundaries, lifecycle, exact tools, permission/cancel/failure |
| `services/api/src/http/agent_runtime.rs` | UPDATE | v3 routes and bounded v2 adapter |
| `services/api/src/providers/responses.rs` | UPDATE if needed | Preserve certainty/status/request ID for classification |
| `services/api/src/error.rs` | UPDATE | Generated error response shape |
| `services/api/migrations/025_agent_runtime_contract_v3.sql` | CREATE | Digests/metadata/permission states/checks/indexes |
| `services/api/tests/agent_runtime_contract.rs` | CREATE | Rust corpus/catalog/lifecycle/digest tests |
| `services/api/tests/agent_runtime_compat.rs` | UPDATE | PG/provider/permission/cancel v3 |
| `services/api/tests/http_compat.rs` | UPDATE | Negotiation/errors/SSE/legacy enforcement |
| `services/api/tests/contract_corpus.rs` | UPDATE | Migration 025 and manifest/DB inventory |
| `services/api/tests/fixtures/schema_inventory.json` | UPDATE | Migration count and complete states |
| `services/api/Cargo.toml`, `Cargo.lock` | UPDATE | Typify 0.7.0 |
| `services/api/BUILD.bazel`, `BUILD.bazel`, `MODULE.bazel.lock` | UPDATE | Proc macro/compile data/lock |
| `package.json`, `tsconfig.json`, `package-lock.json` | UPDATE | Generation/check scripts and Node TS support |
| `.github/workflows/ci.yml` | UPDATE | Explicit freshness and v3 PG/Bazel gates |
| `docs/architecture.md` | UPDATE | Contract flow and ownership |
| `docs/agent-runtime-operations.md` | UPDATE | Negotiation, rollout, telemetry, recovery |
| `docs/computer-use-lifecycle.md` | UPDATE | Permission wait/resume and prerequisites |

---

## Step-by-Step Tasks

### Task 1: Prove and build deterministic generation

- **ACTION**: Create strict protocol/tool sources, generator, manifest, fixtures, Bazel exports, and the Rust generation spike before runtime changes.
- **IMPLEMENT**:
  - Use strict, JSON-representable Zod for wire DTOs. Cross-field checks are separate pure validators, not transforms/preprocess/default/superRefine inside generated schemas.
  - Define all actual hosted tools once. Remove phantom `browser.dom`; include conditional computer tools, `browser.prepare`, `task.guidance`, direct/workspace/knowledge/activity/interaction tools.
  - Each tool contract includes identity, model metadata, exact parameters, operations, operation/effect selectors, prerequisites, and default effect.
  - Move/export `objectSchema` and recursive strict assertion so generator and runtime share it.
  - `.mts` generator uses explicit `.ts` imports, `z.toJSONSchema` Draft 2020-12, stable named `$defs`, recursive canonicalization, exact SHA-256, `--write`, and non-mutating `--check`.
  - Generate one root schema without colliding anonymous nested `$defs`.
  - Add `protocol.rs` Typify 0.7.0 compile spike and make its JSON data visible under Cargo and Bazel.
  - Document/require Node 24.12+. Keep generator erasable; add no `tsx` unless a proven irreducible need appears.
- **MIRROR**: Zod schema-first exports in `contracts.ts`; strict builders in `runtime-tool-registry.ts:495-813`; root Bazel exports.
- **IMPORTS**: `zod`, `node:crypto`, Node fs in generator only, Typify, existing Serde/UUID/time conversions.
- **GOTCHA**: Typify may reject some schema constructs. Simplify canonical schema instead of weakening it or adding handwritten duplicate Rust DTOs.
- **VALIDATE**: Generate twice byte-identically; check is non-mutating; recursive strict test passes; Cargo and Bazel compile generated types.

### Task 2: Make v3 a typed Rust/HTTP boundary

- **ACTION**: Replace raw public agent JSON with generated DTOs; keep provider/checkpoint-native JSON behind bounded conversions.
- **IMPLEMENT**:
  - `protocol.rs` owns generated types, manifest constants, DTO/domain conversions, and structural/business validation entry points.
  - `http/agent_runtime.rs` deserializes every v3 body immediately and serializes generated responses only.
  - Add `GET /v1/agent-runtime/v3/status` with version, both digests, supported read/start versions, rollout mode, worker requirement, enabled.
  - Require exact version/digests on submit/connect before database insertion.
  - Keep v2 functions explicitly named/isolated; v2 `Value` never enters a v3 service method.
  - Every v3 event includes authoritative `AgentRunProjectionV3`, for both live SSE and replay.
  - Replace `public_run`, capability validation, pending invocation, grant/result, and error boundary shapes with typed conversions.
- **MIRROR**: Hosted client immediate parse; coded/sanitized `ApiError`.
- **IMPORTS**: `agent::protocol::*`, Serde conversion, Axum helpers, `ApiError`.
- **GOTCHA**: Public projection must not expose user ID, leases, ciphertext, or provider bodies.
- **VALIDATE**: TS/Rust agree on positive/negative fixtures; mismatch creates no run/session; v3 handler/service signatures cannot return arbitrary public `Value`.

### Task 3: Centralize lifecycle and migrate durable state

- **ACTION**: Add pure lifecycle module and forward-only migration 025; route every mutation through it.
- **IMPLEMENT**:
  - Exhaustive `transition(from, command/context)` and `project(state, metadata)` implement the table.
  - Replace ad hoc transitions/direct state SQL/string terminal predicates with a repository helper: lock row, verify expected state/version/lease, apply decision, increment version, update metadata, append typed event atomically.
  - Migration adds `protocol_digest`, failure stage/code/retryable, cancellation source, permission interaction/requirements, and `awaiting_permission` in run/tool checks.
  - Preserve legacy `schema_digest`; do not rename/drop it during rollback window.
  - Update pending/claim indexes and expiry maintenance.
  - Make schema inventory complete and assert equality with generated manifest.
  - Client connection failures remain local transport status, not fabricated durable backend events.
- **MIRROR**: Existing transactional SQL/event atomicity and project invariant requiring pure lifecycle.
- **IMPORTS**: Generated states/events/actions/failures, SQLx transaction.
- **GOTCHA**: Additive migration only; previous binary must be able to ignore new columns.
- **VALIDATE**: Full state×command matrix, DB CHECK accept/reject test, event/record projection identity.

### Task 4: Generate and consume exact hosted model tools

- **ACTION**: Replace backend `TOOLS`, old digest, name mangling, and generic `model_tools`.
- **IMPLEMENT**:
  - Registry/default/CUA definitions reference canonical metadata/parameters; retain parser/normalizer/availability locally.
  - Assert one-to-one catalog/registry identity and representative schema-valid parser inputs.
  - Rust loads trusted generated catalog and intersects only IDs/operations from worker capability.
  - Resolve model function name via catalog and operation/effect via declarative selectors, never string mangling/per-tool heuristics.
  - Send exact parameters with `strict:true`; remove `input.additionalProperties:true`.
  - Use separate digests throughout worker, invocation, checkpoint, logs, and errors.
  - Add browser.navigate fixture with exact required `url`/`reason` and no CUA prerequisite.
- **MIRROR**: `modelVisibleSpecs` strict check and DesktopToolWorker exact lookup/local parse/policy revalidation.
- **IMPORTS**: Generated catalog/manifest and existing effect/policy validation.
- **GOTCHA**: Some operations/effects derive from nested command fields. Test every selector.
- **VALIDATE**: Captured OpenAI tools pass recursive strict check; fake `open_url` yields parsable `browser.navigate/open_url` worker invocation.

### Task 5: Classify provider failures before parsing output

- **ACTION**: Branch on provider status/dispatch certainty and emit typed terminal failures.
- **IMPLEMENT**:
  - Inspect `ProviderResponse.status` before reading model output/final text.
  - Definitive 4xx pre-inference rejection becomes `failed` with stable code; retain existing budget release.
  - Ambiguous dispatch/result remains `blocked` with no retry.
  - Expected coded/domain failures transition explicitly. Internal invariants become sanitized `internal_runtime_error`.
  - Log fixed provider status/request/error/run/protocol fields, not raw body/payload.
  - Malformed legacy strict fixture becomes failed, while corrected v3 succeeds.
- **MIRROR**: Certainty split in `responses.rs:202-217` and sanitized errors.
- **IMPORTS**: Generated failure enums, provider status/body, tracing.
- **GOTCHA**: Never display arbitrary provider text or retry an ambiguous response.
- **VALIDATE**: Wiremock 400/401/422/429/5xx/pre-dispatch/post-dispatch/truncated/success matrix.

### Task 6: Implement durable permission wait and exact resume

- **ACTION**: Add typed worker permission state/endpoint and main coordinator; pause before execution.
- **IMPLEMENT**:
  - Catalog prerequisites distinguish true CUA tools from direct tools.
  - Worker permission-wait/decision endpoint verifies worker/invocation/source state, persists interaction, emits authoritative wait.
  - Desktop worker checks prerequisite after envelope/catalog/registry/policy but before `requestExecuting`.
  - `ComputerPermissionCoordinator` uses CUA status/connect, TaskRuntime projection, abortable exact-once waiter keyed by invocation ID.
  - Open Settings requests only missing panes and leaves pending.
  - Focus/visibility refresh feeds coordinator; only ready+available grants/resumes.
  - Continue without commits `not_executed`, clears interaction, and resumes model truthfully.
  - Reconnect reconstructs same wait; expiry includes waiting permission.
- **MIRROR**: CUA status/connect, TaskRuntime interaction projection, existing grant-before-dispatch ordering.
- **IMPORTS**: Generated permission DTOs, CuaService, TaskRuntime, AbortSignal, worker client.
- **GOTCHA**: macOS Screen Recording may require restart. Remain waiting until genuinely ready; never synthesize success or re-grant.
- **VALIDATE**: Ready/incomplete/denied/Settings blur/return/restart/continue/cancel/reconnect/expiry/exact-once tests.

### Task 7: Make cancellation explicit, scoped, and state-safe

- **ACTION**: Remove global Escape and add typed, version-fenced cancellation end to end.
- **IMPLEMENT**:
  - Delete global shortcut module/test/import/wiring.
  - Renderer→preload→IPC→application→HTTP→Rust sends command ID, expected run version, and source.
  - Stop uses `stop_button`; focused Escape requires document focus, no repeat, noneditable target, no modal/pending interaction, and server cancel action.
  - Backend locks and applies lifecycle. Stale/terminal returns 409; client refetches once without second cancel.
  - Record source in run/event/analytics.
  - Executing consequential interruption becomes unknown+blocked; effect-free/pre-execution waits may cancel.
  - Shutdown/sign-out/replacement use explicit sources and preserve unknown-effect safety.
- **MIRROR**: Narrow IPC parsing, HostedTaskClient no-retry behavior, transactional changes.
- **IMPORTS**: Generated cancel/source/action schemas, `randomUUID`.
- **GOTCHA**: A local abort cannot overwrite authoritative unknown-effect response.
- **VALIDATE**: Escape outside Tro cannot cancel; suppress editable/modal/permission; blocked cannot become cancelled; each source persists once.

### Task 8: Consume authoritative lifecycle in Electron/React

- **ACTION**: Remove event/state inference and render v3 projection directly.
- **IMPLEMENT**:
  - HostedTaskClient parses canonical status/record/event/error. v3 projection removes `phaseFor` and event-name special cases.
  - TaskApplicationService accepts only newer event sequence/run version; removes `stateByType`; terminal controls subscription cleanup.
  - TaskSnapshot carries lifecycle/actions; TaskRuntime copies server authority and never transitions it.
  - Replace terminal sets in App, task execution, history, analytics, restore/cancel paths with authoritative fields.
  - Permission card emits enum actions; remove label/choice inspection and immediate answer after Settings.
  - Render distinct technical failed, safe blocked/unknown, explicit cancelled, and upgrade-required states.
  - v2 history stays in one read-only legacy adapter.
- **MIRROR**: TaskRuntime projection-only invariant and PendingInteraction component branching.
- **IMPORTS**: Canonical v3 and isolated legacy selectors; no raw backend/CUA renderer handle.
- **GOTCHA**: GET and replayed SSE can be out of order; never let older version resurrect cancellability.
- **VALIDATE**: All state UI cases, typed permission, blocked terminal, mismatch, stale event, v2 history, and no magic IDs/terminal sets outside legacy/generated code.

### Task 9: Add rollout gates and telemetry

- **ACTION**: Implement observe/dual/enforce and compatibility diagnostics.
- **IMPLEMENT**:
  - Parse typed `AGENT_RUNTIME_V3_MODE`, safely default observe until explicit rollout.
  - New desktop tries v3 then documented v2 fallback. Enforce rejects v2 starts/workers but keeps history reads.
  - Fixed privacy-safe metrics: protocol/tool mismatch, v2/v3 active/new, permission wait/result/latency, cancel source, transition rejection, failure/blocked code.
  - Extend `agent-runtime-versions` CLI with current version/digests/mode/active counts/enforcement readiness.
  - Document deploy order, drain query, rollback, and mode flip.
- **MIRROR**: Existing typed config and `agent:runtime-versions` command.
- **IMPORTS**: Config enum, manifest, tracing/CLI.
- **GOTCHA**: Previous binary must not execute v3 rows on rollback.
- **VALIDATE**: Old/new desktop/backend and all modes/mismatch/drain/rollback matrix.

### Task 10: Lock workflow in CI, docs, and regressions

- **ACTION**: Make stale contracts, enum drift, malformed tools, and the original bug release-blocking.
- **IMPLEMENT**:
  - Add generate/check scripts and run check near start of root `npm run check`.
  - Add Rust contract Bazel target/compile data and lock updates.
  - Extend shared/unit/HTTP/provider/PG tests.
  - Deterministic Vietnamese `Mở YouTube.` scenario: fake provider selects direct open URL, no permission, confirmed dispatch, verified completion.
  - Add macOS permission and Windows/Linux no-global-Escape manual release scenarios.
  - Update architecture/operations/computer-use docs and remove generic permission-choice claims.
  - Review final diff for generated artifacts, public DTO closure, logs, and renderer authority.
- **MIRROR**: Root check/package, Bazel CI, contract corpus, ignored PG integration.
- **IMPORTS**: Existing Vitest/Cargo/Bazel/CI only.
- **GOTCHA**: Package needs configured Doppler environment; record a local credential blocker and rely on required CI, do not silently omit.
- **VALIDATE**: All commands below pass; protocol check leaves worktree unchanged; manual After flow passes.

## Testing Strategy

### Contract/generator tests

| Test | Input | Expected | Edge? |
|---|---|---|---:|
| Deterministic generation | Same source twice | Byte-identical artifacts/digests | yes |
| Stale check | Alter expected bytes | Nonzero, names path, no write | yes |
| Unrepresentable Zod | Transform/date/custom fixture | Generator throws with path | yes |
| Strict recursion | Object in property/array/anyOf | Closed and all keys required | yes |
| Tool inventory | Catalog vs registry | One-to-one identity | yes |
| Selector resolution | Fixture per operation | Exact tool/operation/effect | yes |
| Shared corpus | Positive/negative JSON | TS and Rust agree | yes |
| Digests | Exact generated bytes | TS/Rust/manifest match | no |

### Lifecycle tests

Use a generated state×command matrix, not isolated examples.

| Test | Input | Expected | Edge? |
|---|---|---|---:|
| Allowed transition | Each table edge | Exact state/event/actions/version | no |
| Disallowed transition | Remaining pairs | Typed rejection/no mutation | yes |
| Terminal projection | completed/blocked/failed/cancelled/expired | terminal true, no cancel | yes |
| Permission projection | requirements | waiting/actions, nonterminal | no |
| Stale version | expected N, stored N+1 | 409/no write | yes |
| Consequential cancel | executing consequential | unknown invocation + blocked | yes |
| Pre-execution cancel | waiting/delivered | cancelled | no |
| Replay | durable event | Same projection live/replayed | yes |

### Rust HTTP/PostgreSQL/provider tests

| Test | Input | Expected | Edge? |
|---|---|---|---:|
| Matching submit | Exact v3/digests | Created and persisted | no |
| Protocol mismatch | Wrong protocol digest | 409/no run | yes |
| Tool mismatch | Wrong tool digest | 409/no worker | yes |
| SQL inventory | Manifest enums | All accepted; unknown rejected | yes |
| Provider rejection | 400/401/422 | failed/code; budget released | yes |
| Provider ambiguous | bad/truncated/post-dispatch | blocked/no retry | yes |
| Permission wait | delivered computer invocation | wait state/stable interaction | no |
| Permission resume | same interaction granted | One execution grant | yes |
| Continue without | waiting invocation | not_executed/model resumes | yes |
| Worker reconnect | waiting permission | Same IDs | yes |
| v2 enforcement | legacy start in enforce | upgrade; history readable | yes |

### Electron/renderer tests

| Test | Input | Expected | Edge? |
|---|---|---|---:|
| Direct URL | browser.navigate | No CUA status/connect/session | no |
| Computer tool | missing permission | Wait before executing grant | no |
| Settings blur/Escape | pending permission | No cancel; remains pending | yes |
| Return incomplete | permission false | Remains waiting | yes |
| Return ready | ready+available | Same invocation once | yes |
| Continue without | enum action | not_executed/no dispatch | no |
| Focused Escape | valid focused context | One source-tagged cancel | no |
| Suppressed Escape | blur/input/modal/permission | No cancel | yes |
| Blocked UI | authoritative terminal | Terminal outcome/no Stop | yes |
| Stale SSE | lower run version | Ignored | yes |
| Legacy history | v2 record | Read-only display | yes |

### End-to-end regressions

1. `Mở YouTube.` with matching v3: exact `open_url`, no permission, browser dispatch, completion.
2. Same request with stale tool digest: upgrade error before run creation.
3. Computer-control without macOS permission: wait, open Settings, Escape there, return; no cancellation and resume only when ready.
4. Continue without computer: no control dispatch; model uses direct path or explains limitation.
5. Provider rejects malformed legacy schema: failed diagnostic, not blocked/cancelled.
6. Unknown consequential result: terminal blocked, no retry/cancel claim.
7. Stop while planning: cancelled with source; stop after consequential execution grant: blocked unknown.

### Edge Cases Checklist

- [ ] Empty/oversized/unknown-field v3 request
- [ ] Unknown state/event/permission/action/cancel source/failure code
- [ ] Version match but protocol digest differs
- [ ] Protocol match but tool digest differs
- [ ] v2 history during observe/dual/enforce
- [ ] SSE reconnect/replay/out-of-order GET/events
- [ ] Duplicate worker delivery and permission decision
- [ ] Disconnect before execute, during permission wait, after grant
- [ ] Permission revoked between ready check and CUA session start
- [ ] macOS Screen Recording restart required
- [ ] Windows/Linux/unsupported platform status
- [ ] Cancel at each run and invocation state
- [ ] Provider 4xx/429/5xx/pre-dispatch/post-dispatch/oversized/truncated
- [ ] Expiry while awaiting permission
- [ ] Direct tools never initialize CUA
- [ ] No private payload in logs/analytics

---

## Validation Commands

### Generator and focused TypeScript

```bash
npm run agent:protocol:generate
npm run agent:protocol:check
npm exec -- vitest run \
  src/shared/agent-runtime-protocol.test.ts \
  src/shared/agent-tool-contracts.test.ts \
  src/main/agent/runtime-tool-registry.test.ts \
  src/main/hosted/desktop-tool-worker.test.ts \
  src/main/hosted/computer-permission-coordinator.test.ts \
  src/main/application/hosted-task-client.test.ts \
  src/main/application/task-application-service.test.ts \
  src/renderer/task-execution.test.ts \
  src/renderer/history.test.ts
```

EXPECT: artifacts current; focused tests pass.

### Focused Rust

```bash
cargo test --manifest-path services/api/Cargo.toml --locked agent::lifecycle
cargo test --manifest-path services/api/Cargo.toml --locked --test agent_runtime_contract
cargo test --manifest-path services/api/Cargo.toml --locked --test contract_corpus
```

EXPECT: DTOs compile; corpus, lifecycle, inventory pass.

### PostgreSQL-backed integration

```bash
cargo test --manifest-path services/api/Cargo.toml --locked \
  --test agent_runtime_compat -- --ignored --test-threads=1
cargo test --manifest-path services/api/Cargo.toml --locked \
  --test http_compat -- agent_runtime --ignored --test-threads=1
```

EXPECT: migration 025 and v3 lifecycle/provider/permission/cancel pass with disposable PostgreSQL 17 and Wiremock.

### Static/dependency checks

```bash
npm run lint
npm run typecheck
npm run api:fmt
npm run api:lint
npm run api:audit
bazel mod tidy
git diff --exit-code -- MODULE.bazel MODULE.bazel.lock
```

EXPECT: zero failures and Bazel lock already reflects only reviewed changes.

### Required repository gates

```bash
npm run check
npm run bazel:check
npm run package
```

EXPECT: all root, Rust/Bazel, admin, and Electron package gates pass. Package requires configured Doppler production environment.

### Freshness

```bash
npm run agent:protocol:check
git status --short
```

EXPECT: contract check creates no diff; only intentional implementation changes remain.

### Manual validation

- [ ] With permission granted, run `Mở YouTube.`; no permission card/CUA initialization.
- [ ] Revoke macOS permissions, start real computer control, open Settings, press Escape there; task stays waiting.
- [ ] Grant and return; same invocation resumes exactly once only when ready.
- [ ] Continue without; no computer action executes.
- [ ] Stop during planning; source `stop_button`, state cancelled.
- [ ] Simulate executing consequential stop/disconnect; blocked unknown, never cancelled/completed.
- [ ] Force each digest mismatch; clear pre-work upgrade message.
- [ ] Open v2 history in enforce; readable but not resumable.
- [ ] Inspect logs/analytics; fixed IDs/codes only, no private content.

---

## Acceptance Criteria

- [ ] One edited Zod v3 contract generates committed JSON Schema and Rust DTOs.
- [ ] One hosted catalog drives Electron registry metadata, worker digest, and backend model tools.
- [ ] Protocol and tool catalog have separate deterministic digests checked before new work/execution.
- [ ] `agent:protocol:check` fails stale artifacts and runs in root check/CI.
- [ ] All v3 agent HTTP/SSE/worker boundaries use generated types; public arbitrary `Value`/event/state strings are removed.
- [ ] Every event carries authoritative state/phase/terminal/waiting/failure/actions.
- [ ] Main/renderer no longer infer hosted state from event names or terminal sets.
- [ ] `blocked` is terminal and cannot become cancelled.
- [ ] Definitive pre-inference/provider/schema errors become typed failed outcomes.
- [ ] Every v3 OpenAI schema is recursively strict; no object has `additionalProperties:true`.
- [ ] `Mở YouTube.` uses direct navigation and completes without CUA permission when dispatch succeeds.
- [ ] Computer permission is durable and resumes only when CUA is ready.
- [ ] Opening Settings or losing focus cannot cancel.
- [ ] System-wide Escape task cancellation is removed.
- [ ] Cancel carries source/command ID/expected version; consequential execution preserves unknown safety.
- [ ] v2 read compatibility and observe/dual/enforce are tested/documented.
- [ ] Cargo, Bazel, TS, unit, PG integration, root check, and package pass.

## Completion Checklist

- [ ] Artifacts byte-stable across macOS/Windows CI.
- [ ] Contract source has no unrepresentable Zod constructs.
- [ ] Typify Cargo/Bazel spike passes before broad refactor.
- [ ] Catalog tool IDs map one-to-one to worker registry.
- [ ] DB state inventories equal manifest.
- [ ] Every lifecycle write uses central helper and atomic event.
- [ ] Error/logging follows sanitized structured patterns.
- [ ] Permission/cancel exact-once tests cover reconnect/order races.
- [ ] Renderer stays sandboxed with narrow typed API.
- [ ] No unknown consequential action retried or falsely cancelled.
- [ ] Docs define future contract workflow and rollout runbook.
- [ ] No unrelated API/provider migration.
- [ ] Plan is self-contained for implementation.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Typify rejects emitted construct | Medium | High | Task 1 hard gate; simple named schemas; no handwritten fallback |
| XL diff is hard to review | High | High | Five mergeable gates; behavior flag last |
| Old/new version skew interrupts work | Medium | High | observe/dual/enforce, v2 read, drain, additive migration |
| Catalog extraction changes parsing | Medium | High | One-to-one and per-operation fixtures |
| Permission resumes twice | Medium | Critical | Persist IDs, one-time grant, keyed coordinator, duplicate tests |
| Cancel lies about effects | Medium | Critical | Inspect invocation/effect state; executing consequential → blocked unknown |
| Projection becomes UI-specific | Low | Medium | Server sends semantic phase/action/wait/failure only |
| Cross-platform line endings drift | Medium | Medium | Explicit UTF-8/LF/trailing newline and byte checks |
| New raw endpoint bypasses contract | Medium | High | Typed handler signatures, architecture check, review checklist |
| Migration breaks rollback | Low | High | Additive nullable columns, legacy digest preserved |
| Details leak | Low | High | Stable public enums/messages; allowlisted log fields only |

## Notes

- This supersedes only protocol/lifecycle/permission/cancellation portions of older plans. It preserves Rust-hosted authority-v8 and exact policy/approval.
- The screenshot is not evidence that opening YouTube needs more approval. It is a malformed strict schema plus lifecycle/cancellation drift.
- A contract does not require simultaneous deploys. It makes skew explicit, typed, observable, and rejected at the safe pre-work boundary.
- Keep v3 boring: closed JSON, explicit nullability, finite enums, stable codes, deterministic bytes, no UI-label inference.
- Never mark `awaiting_permission` blocked. Never mark provider schema rejection blocked. Never mark unknown consequential effect cancelled.
