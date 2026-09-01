# Plan: Codex-Local OpenAI Agents SDK Runtime

## Completion Status

**Implemented and validated on 2026-08-31.** The local runtime, encrypted host state, dynamic CUA registry, Rust boundary reduction, hosted-runtime cleanup, packaging, Bazel inventory, tests, documentation, and audit reports are complete in the implementation branch.

Evidence:

- `.claude/PRPs/reports/codex-local-agents-sdk-runtime-report.md`
- `.claude/PRPs/reports/codex-local-agent-dead-code-audit.md`
- `npm run check` passed.
- `npm run package` passed on macOS arm64 and the packaged runtime dependency closure was inspected.
- `npm run bazel:check` passed.

Deployment-only follow-up is intentionally not represented as implementation work: drain older hosted runs, revoke the old remote secret after zero-consumer proof, and execute the release matrix on the other supported operating systems.

## Summary

Move TroCode from a remote-worker-first agent architecture to a local-first desktop agent architecture modeled on Codex Local. A bundled Node utility process will contain one TroCode Agent Harness built directly around the OpenAI Agents SDK `Agent` and `Runner`, while Electron main supplies encrypted local thread state, trusted tool execution, recovery, and renderer projection as host services. The Rust backend will remain the authenticated model/provider proxy and the home for accounts, organizations, budgets, connectors, and optional future sync; it will no longer own the live agent loop for local tasks.

The first release deliberately runs one root agent. The runtime protocol, graph factory, state envelope, and activity events will carry stable agent identities so native Agents SDK handoffs or agents-as-tools can be added later without changing the renderer, desktop tool boundary, local persistence format, or provider proxy. The cutover includes an evidence-backed dead-code audit that removes hosted orchestration without deleting legacy history, immutable migrations, connector rollout, or unrelated backend workers.

## User Story

As a TroCode desktop user, I want each task to run as a responsive local agent with local tools and resumable local history, so that the experience is as immediate and coherent as Codex Local while remaining extensible to a future multi-agent system.

## Problem -> Solution

Today a local task is submitted to Rust, claimed by a separately deployed Node Agents SDK worker, and routed back to the desktop through leases and polling. Starting the backend therefore requires a private orchestration service token, local tools depend on a remote desktop-worker connection, and a missing or mismatched hosted endpoint can prevent an otherwise local task from starting.

Replace that topology with one bundled local Agents SDK process per running TroCode application. Electron main creates and resumes local turns, the utility process performs model/tool continuation, Electron main dispatches trusted local tools directly, and the authenticated public Rust Responses proxy performs inference and budget enforcement. New task state is locally authoritative; cloud execution is a separate future runtime adapter, not a fallback mode hidden inside the local runtime.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A — free-form architecture request
- **PRD Phase**: Standalone architecture migration
- **Estimated Files**: 50-75 files across Electron main, shared contracts, local runtime package, Rust provider API, cleanup/deployment, packaging, tests, and docs
- **Recommended Delivery**: Eleven ordered mergeable gates; no dual-orchestrator production period
- **Runtime Baseline**: `@openai/agents` 0.17.0, `openai` 7.8.0, Zod 4.4.3, and the Electron version pinned by this repository
- **Historical Predecessors**:
  - `.claude/PRPs/plans/completed/seamless-openai-agent-runtime.plan.md`
  - `.claude/PRPs/plans/completed/openai-agents-sdk-sole-orchestrator.plan.md`
  - commit `358b8b0` (`feat: port agent runtime to OpenAI Agents SDK`)
  - commit `5551984` (`feat(workspace): use hosted agent runtime`)
- **Terminology**: “Codex Local” means a trusted local agent runtime and local tools. This plan does not embed Codex CLI or replace the requested OpenAI Agents SDK with the Codex SDK.

---

## Product and Trust Boundaries

### “Seamless like Codex Local” means

- A task starts without waiting for a hosted worker lease, deployment, heartbeat, or private orchestration token.
- One local runtime process can serve many local threads; it is not one OS process per chat.
- Assistant deltas and tool lifecycle events stream immediately through normalized host events.
- Tool calls execute through the existing trusted Electron-main adapters on the user's machine.
- Closing and reopening the app can resume durable local thread state when the last boundary is safe.
- The user can read local history without network access. A new model turn still requires network access; this plan does not provide offline inference.
- The application must remain running while local work is active. Cloud/background execution is a different product mode.
- A local runtime failure produces a clear local-runtime error. It does not silently transfer the task to a hosted agent.

### It does not mean

- Running the SDK in the sandboxed renderer or enabling Node integration.
- Shipping an OpenAI/provider secret to the desktop. The desktop receives only its existing short-lived/user session credential and calls TroCode's authenticated model proxy.
- Giving the model raw IPC, Electron objects, credentials, arbitrary tool registration, or unrestricted filesystem access.
- Restoring the removed “Bounded/Balanced/Strict” autonomy settings or approval-policy UI.
- Treating SDK `needsApproval` interruptions as user permission. In this architecture they are technical checkpoint barriers before an external effect.
- Building multiple specialist agents, handoff UI, parallel delegation, agent marketplaces, or cloud agents in this phase.
- Keeping both hosted and local orchestrators live as an automatic fallback. That creates dual ownership and makes exactly-once behavior unverifiable.

### Safety that remains after approval-mode removal

The local design still enforces typed IPC/model boundaries, a frozen host-selected tool catalog, workspace roots, public-URL checks, OS permission checks, cost/deadline limits, cancellation/Escape, one-action dispatch where applicable, and no retry after an uncertain external outcome. When a missing user choice would materially change scope or consequence, the agent requests input; there is no general “approval style” selector.

---

## UX Design

### Before

~~~text
Tro desktop
    |
    | POST task
    v
Rust API / PostgreSQL
    |
    | lease + encrypted SDK state
    v
Hosted Node Agents SDK worker
    |
    | poll/queue tool call
    v
Rust control plane
    |
    | desktop-worker socket
    v
Tro desktop executes local tool

Failure modes visible to the user:
- “Desktop worker connection failed (413)”
- “Endpoint not found (404)”
- backend refuses to start without an orchestrator service token
- local tasks wait for hosted runtime readiness
~~~

### After

~~~text
Sandboxed renderer
    |
    | narrow DesktopApi + parsed IPC
    v
Electron main (trusted local host)
    |-- encrypted local threads/checkpoints/journal
    |-- local CUA/workspace/browser/connector adapters
    |
    | typed, versioned utility-process messages
    v
Bundled local Node utility process
    |-- @openai/agents Runner
    |-- one root Agent in v1
    |-- deterministic graph + session adapter
    |
    | authenticated Responses request
    v
Rust API: auth + budget + provider proxy
    |
    v
OpenAI inference
~~~

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Application startup | Connect hosted desktop worker when remote runtime is ready | Start and health-check bundled utility process after `app.ready` | Sign-in only gates model calls, not runtime installation |
| New task | Create remote run and await hosted ownership | Create local thread/turn and stream immediately | No worker lease or deployment dependency |
| Model call | Private worker uses service token | Local runtime uses user-authenticated public proxy | Provider keys remain server-side |
| Tool call | Remote worker queues and polls Rust | Utility process checkpoints, then Electron main dispatches directly | Same host-selected schemas and adapters |
| History | Remote backend is canonical | Encrypted local store is canonical for new local threads | Legacy terminal remote history remains read-only |
| Resume | Reclaim remote SDK state | Resume local RunState/checkpoint after graph/version validation | Unsafe/unknown tool outcomes never replay |
| Offline | Hosted task cannot start; history depends on backend | Local history opens; active inference pauses with network-unavailable state | No offline model |
| Multi-agent | No stable local seam | Protocol/state include agent lineage; graph has one root agent | Handoffs remain out of scope |
| Cloud tasks | Implicitly entangled with local flow | Separate future runtime adapter and explicit product selection | No silent fallback |

---

## Mandatory Reading

Read these files before implementation. Line numbers are discovery anchors and may shift after earlier gates land.

| File | Why it is mandatory |
|---|---|
| `AGENTS.md` | Repository invariants, verification commands, external-action boundaries |
| `docs/architecture.md:1-80` | Current remote-worker ownership model that this plan replaces |
| `docs/security.md` | Renderer sandbox, secret handling, boundary validation, unknown-outcome rules |
| `src/index.ts:1450-1550` | Current composition root, hosted task client, desktop worker startup |
| `src/main/application/task-application-service.ts:1-170` | User task entry point and current hard dependency on hosted runtime |
| `src/main/agent/task-runtime.ts:1-130` | Current renderer projection explicitly prevented from planning/sampling |
| `src/main/agent/execution-coordinator.ts` | Trusted local execution coordination that should be adapted, not duplicated |
| `src/main/agent/runtime-tool-registry.ts` | Host-selected tool schemas and normalization |
| `src/main/agent/runtime-tool-dispatcher.ts:8-55` | Existing adapter registry and cancellation boundary |
| `src/main/application/hosted-task-client.ts` | Hosted API surface to replace for new local tasks |
| `src/main/hosted/desktop-worker-client.ts` | Connection/retry machinery to remove after cutover |
| `src/main/hosted/desktop-tool-worker.ts` | Current remote-to-local tool bridge; map every adapter before deletion |
| `src/main/history/task-history-service.ts` | History query/service boundary to preserve while swapping storage |
| `src/main/history/task-history-store.ts` | Repository seam for local-vs-legacy history |
| `src/main/history/hosted-task-history-store.ts` | Legacy read-only adapter after cutover |
| `src/main/workspace/workspace-selection-store.ts:9-55` | Existing `safeStorage`, Zod, `userData`, and `0600` persistence convention |
| `src/main/engine/rust-desktop-engine-client.ts:109-223` | Existing start-once, health handshake, request timeout, child-exit pattern |
| `src/shared/contracts.ts` | Canonical schema-first IPC and persisted public types |
| `src/shared/desktop-api.ts` | Narrow renderer API invariant |
| `services/agent-runtime/package.json` | Pinned Agents SDK/runtime dependencies and package scripts |
| `services/agent-runtime/src/agent-graph.ts:18-97` | Current Agent/Runner construction, graph version checks, compaction, no-retry settings |
| `services/agent-runtime/src/tool-adapter.ts:18-116` | Current checkpoint-before-tool and unknown-outcome invariants |
| `services/agent-runtime/src/rust-session.ts` | Current SDK Session and RunState persistence behavior |
| `services/agent-runtime/src/run-worker.ts` | Current hosted lease loop to dismantle |
| `services/agent-runtime/test/crash-recovery.test.ts` | Crash/replay test style that must move to the local runtime |
| `services/api/src/http/core.rs:315-359` | Public authenticated Responses proxy and required request/turn headers |
| `services/api/src/providers/responses.rs:130-190` | Reserve-before-dispatch and provider no-retry behavior |
| `services/api/src/http/agent_orchestrator.rs` | Private orchestration API to decommission only after local cutover |
| `services/api/src/config.rs` | Backend-agent enable/rollout/service-token configuration to remove |
| `forge.config.ts` | Existing resource staging and packaging hooks |
| `webpack.main.config.ts` | Electron main build boundary; utility runtime must not be bundled into renderer |
| `.claude/PRPs/reports/seamless-openai-agent-runtime-report.md` | Evidence from the earlier local Agents SDK implementation |
| `.claude/PRPs/plans/completed/openai-agents-sdk-sole-orchestrator.plan.md` | Current hosted durability model and terminology |

The supplemental guidance references `docs/CODEX-NAVIGATION-GUIDE.md`, but that file is absent in the current checkout. Do not invent its contents; update this plan if it is restored before implementation.

---

## Codebase Discovery

### Unified Discovery Table

| Category | Source | Pattern to preserve | Key evidence |
|---|---|---|---|
| Similar implementation | commit `358b8b0:src/main/agent/openai-agents-runtime.ts` | Agents SDK previously ran locally and called host tools | Reuse the conceptual runtime interface, streaming, session, and tool callback shape; do not resurrect old approval policy |
| Similar implementation | `src/main/engine/rust-desktop-engine-client.ts:109-223` | Start-once child service with health check, timeouts, and exit failure | Mirror lifecycle semantics using `utilityProcess.fork` and typed messages |
| Naming | `src/main/agent/runtime-tool-dispatcher.ts:8-55` | PascalCase classes/interfaces; `*Client`, `*Store`, `*Dispatcher`, `*Adapter` suffixes | Name new types `LocalAgentRuntimeClient`, `LocalAgentStateStore`, `LocalToolExecutionJournal` |
| Errors | `services/agent-runtime/src/tool-adapter.ts:18-22` | Domain-specific error for unknown outcome | Keep `ToolOutcomeUnknownError`; never convert it into a retriable generic error |
| Errors | `src/main/engine/rust-desktop-engine-client.ts:204-223` | Child exit rejects outstanding work with bounded diagnostics | Local client must reject pending requests and mark active turns interrupted/unknown as appropriate |
| Logging | `src/index.ts` and `src/main/hosted/*` | Component-prefixed structured messages with bounded payloads | Add `[local-agent-runtime]` lifecycle events; never log tokens, prompts, tool arguments, RunState, screenshots, or raw model output |
| Types/contracts | `src/shared/contracts.ts` | Zod is authoritative at IPC/model boundaries; derive TypeScript types | Every utility-process message gets a discriminated Zod schema and protocol version |
| Types/contracts | `services/agent-runtime/src/protocol.ts` | Digests/version fields bind runtime artifacts | Preserve `sdkVersion`, `graphVersion`, `protocolDigest`, and tool catalog digests locally |
| Tests | `src/main/engine/rust-desktop-engine-client.test.ts` | Inject fake transport/process and assert crash/timeout behavior | Use fake utility transport; never require a real Electron child in unit tests |
| Tests | `services/agent-runtime/test/crash-recovery.test.ts` | Explicit crash points and no-replay assertions | Port cases to local checkpoint and invocation journal |
| Configuration | `services/agent-runtime/src/config.ts` | Parse configuration with Zod and fail closed | Local runtime gets a small immutable launch config; service token and backend-agent flags disappear |
| Dependencies | `services/agent-runtime/package.json` | Runtime package already pins Agents SDK/OpenAI/Zod | Repurpose this package for the bundled process rather than adding a second SDK implementation |
| Persistence | `src/main/workspace/workspace-selection-store.ts:25-55` | Electron main owns OS-backed encryption and validates decrypted data | Keep encryption outside the child; child requests checkpoint read/write through host protocol |
| Tool execution | `src/main/agent/runtime-tool-dispatcher.ts:21-54` | Frozen adapter map, duplicate rejection, abort-aware dispatch | Utility process can only call catalog entries registered by Electron main |
| Provider | `services/api/src/providers/responses.rs` | Budget reservation and no automatic provider retry | Retain server-side budget accounting and idempotency; local SDK retries remain disabled |
| Packaging | `forge.config.ts` | Stage non-renderer runtime dependencies as packaged resources | Add a deterministic local-runtime staging step and artifact verification |

### Current Entry, Data, State, Contract, and Pattern Traces

1. **Entry point**: renderer `DesktopApi` -> parsed main IPC -> `TaskApplicationService.submitAndStart()` -> `HostedTaskClient` -> Rust task/run endpoints.
2. **Model flow**: hosted Node worker claims a Rust lease -> `AgentGraphFactory` creates `Runner`/`Agent` -> `BrokeredOpenAIClientFactory` calls Rust private model proxy with the orchestration service token.
3. **Tool flow**: SDK interruption -> worker persists RunState/checkpoint -> queues tool call in Rust -> desktop worker receives it -> `RuntimeToolDispatcher` executes local adapter -> result returns through Rust -> worker polling continues.
4. **State ownership**: Rust/PostgreSQL own run lifecycle, session revisions, checkpoints, invocation outcomes, and terminal history. Electron's current `TaskRuntime` projects remote state only.
5. **Contracts**: shared renderer IPC is Zod-first; public runtime contracts also have generated Rust/TypeScript protocol artifacts and digests.
6. **Pattern**: service/repository/client separation is already strong. The migration should swap adapters and ownership without placing orchestration logic in the renderer or duplicating tools.

### Historical Local Pattern Worth Recovering

The earlier local runtime used a host-selected adapter rather than letting the model select its runtime:

~~~ts
// HISTORICAL_SOURCE: commit 358b8b0:src/main/agent/agent-runtime.ts
export interface AgentRuntime {
  run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
  resume(input: AgentResumeInput): AsyncIterable<AgentRuntimeEvent>;
  cancel(taskId: string): Promise<void>;
}
~~~

Recover the interface principle, but change the implementation location from Electron main to a utility process. Do not recover the historical risk classifier, “balanced” mode, or per-action approval product.

### Current Durability Pattern Worth Preserving

~~~ts
// SOURCE: services/agent-runtime/src/tool-adapter.ts:49-69
const revision = await client.putCheckpoint(lease, {
  expectedCheckpointRevision,
  sdkVersion,
  graphVersion,
  pendingCallId: pending.callId,
  state: serializedState,
});
await client.queueToolCall(lease, pending);
~~~

The local equivalent must durably commit the serialized SDK state and pending invocation before Electron main performs the external effect. The storage location changes; the ordering invariant does not.

### Current Agent Construction Pattern Worth Preserving

~~~ts
// SOURCE: services/agent-runtime/src/agent-graph.ts:57-77,83-96
const agent = new Agent({
  name: 'Tro',
  instructions: AGENT_INSTRUCTIONS,
  model,
  tools: toolSurface.tools,
});
const session = new OpenAIResponsesCompactionSession({
  client: brokered.openai,
  compactionMode: 'input',
  underlyingSession: atomic,
});

return {
  maxTokens: 4_000,
  parallelToolCalls: false,
  retry: { maxRetries: 0 },
  store: false,
  toolChoice: 'auto',
};
~~~

Keep no automatic retry, no provider-side conversation storage, explicit compaction, deterministic tools, and single-tool sequencing for the first local release.

---

## External Research

### Official OpenAI/Codex sources

1. [Codex App Server](https://learn.chatgpt.com/docs/app-server)
   - **KEY_INSIGHT**: Codex exposes a local app-server protocol that owns authentication, conversation history, approvals, and streamed agent events for rich clients.
   - **APPLIES_TO**: The local utility-process boundary, health/version handshake, normalized events, and local thread lifecycle.
   - **GOTCHA**: TroCode is not adopting the Codex app-server protocol itself. It should copy the process-boundary shape while keeping OpenAI Agents SDK semantics and TroCode-owned tool contracts.

2. [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)
   - **KEY_INSIGHT**: Local Codex integrations start, continue, and resume local threads by controlling a local agent runtime.
   - **APPLIES_TO**: Local thread authority, resume semantics, and separating a local runtime from cloud execution.
   - **GOTCHA**: Do not install the Codex SDK as the agent implementation; the user explicitly chose the Agents SDK. This source is an architecture comparison.

3. [Codex local environment](https://learn.chatgpt.com/docs/environments/local-environment)
   - **KEY_INSIGHT**: Local and cloud execution are distinct environments with different lifecycle and availability properties.
   - **APPLIES_TO**: No silent local-to-cloud fallback and explicit future `CloudAgentRuntimeAdapter` selection.
   - **GOTCHA**: A local runtime cannot continue after the desktop app exits unless a separate long-lived daemon is introduced, which is out of scope.

4. [OpenAI API quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request)
   - **KEY_INSIGHT**: Agents SDK orchestration belongs in a trusted privileged process, not an untrusted browser/renderer surface.
   - **APPLIES_TO**: Electron utility process plus Electron-main host boundary.
   - **GOTCHA**: “Server-side” does not require a remote server here; the signed desktop's utility process is the trusted local process, while provider credentials remain on Rust.

### Version-specific local evidence

- `services/agent-runtime/node_modules/@openai/agents` is version 0.17.0 and exposes `Agent`, `Runner`, `RunState`, `Session`, handoffs, and agents-as-tools in its installed declarations.
- Electron's installed `electron.d.ts` exposes `utilityProcess.fork(modulePath, args, options)` and `process.parentPort` message transport after app readiness.
- **GOTCHA**: Utility-process messaging is message-based, not stdio JSONL. Add explicit correlation IDs, sequence numbers, acknowledgements, backpressure, and runtime/protocol handshakes.
- **GOTCHA**: The child must not own `safeStorage`; persistence calls go through Electron main so OS encryption remains in the trusted host.

---

## Architecture

### Target Components

~~~text
Renderer (untrusted)
  `DesktopApi`
       |
Electron main (trusted host)
  Desktop host services
  - `TaskApplicationService` / `LocalTaskRuntime`
  - `LocalAgentRuntimeClient` process supervisor
  - `EncryptedLocalAgentStateStore`
  - `LocalToolExecutionJournal`
  - `RuntimeToolRegistry` -> `RuntimeToolDispatcher`
       |
       | UtilityProcessProtocol v1
       v
Local Agents SDK utility process
  TroCode Agent Harness (the only agent harness)
  - `LocalRuntimeServer` transport entry
  - OpenAI Agents SDK `Agent` + `Runner` (the only agent loop)
  - `AgentGraphFactory` instructions/tools/graph
  - `HostBackedSession` SDK Session adapter
  - host-tool callback adapter
  - normalized SDK-event adapter
  - `UserAuthenticatedOpenAIClientFactory`
       |
       | /v1/openai/responses (+ compact)
       v
Rust API
  user/device authentication
  organization access + quotas/budget reservation
  provider normalization + no-retry dispatch
  connectors/optional remote services
~~~

### One Agent Harness, Not Two

The **TroCode Agent Harness** is the application-specific configuration and integration built directly around the real OpenAI Agents SDK `Agent` and `Runner` inside the Node utility process. There is no second planner, runner, tool loop, state machine, or generic TroCode agent framework competing with the SDK.

~~~ts
// DESIGN SHAPE — use the public @openai/agents surface directly.
const tro = new Agent<TroRunContext, 'text'>({
  name: 'Tro',
  instructions: TRO_INSTRUCTIONS,
  model,
  tools: hostBackedTools,
  modelSettings,
});

const result = runner.run(tro, input, {
  context,
  session: hostBackedSession,
  stream: true,
});
~~~

The harness contains only the glue needed to make that SDK agent a TroCode agent:

- deterministic agent definitions, instructions, model settings, and tool registration;
- an SDK `Session` adapter that asks Electron main to persist encrypted state;
- normal SDK tool callbacks that ask Electron main to execute trusted OS tools;
- an OpenAI model/provider adapter that calls the authenticated Rust proxy;
- an SDK event adapter that emits bounded, normalized product events;
- future native SDK handoffs or agents-as-tools inside the same graph.

Electron main is **not** an agent harness. It is the trusted desktop host. It supervises the child process, owns encryption and application authentication, implements OS tools, and records external-effect outcomes. Rust is also not an agent harness; it authenticates the user, enforces budget/provider policy, and proxies model requests.

The normal tool path remains recognizable to the SDK:

~~~text
Agent chooses a registered SDK tool
  -> Agents SDK invokes its normal tool callback
  -> callback durably checkpoints RunState through the host adapter
  -> callback asks Electron main's host-tool service to execute
  -> Electron validates scope and dispatches the existing adapter
  -> durable result returns to the same SDK callback
  -> Runner continues the same SDK turn
~~~

The agent never needs to know about Electron IPC, Rust routes, encryption, or process supervision. It sees ordinary Agents SDK tools and sessions.

### Ownership Matrix

| Concern | Owner after migration | Explicit non-owner |
|---|---|---|
| Agent loop and SDK RunState | TroCode Agent Harness using SDK `Agent`/`Runner` in the local utility process, persisted through host | Electron main, renderer, and Rust orchestration worker |
| Utility-process lifecycle | Electron main `LocalAgentRuntimeClient` | Agent, model, and renderer |
| Thread/task lifecycle | Electron main local service/store | Renderer and model |
| Local durable data encryption | Electron main via OS `safeStorage` | Utility child and renderer |
| Model credentials/provider key | Rust API | Desktop app and utility child |
| User session credential | Electron main; ephemeral copy in child memory only | Local disk/logs |
| SDK tool definitions/callbacks | TroCode Agent Harness, derived from Electron's frozen catalog | Model-created configuration and renderer |
| Tool catalog authority | Electron main registry, frozen per turn/graph | Model and remote backend |
| Tool execution | Electron main adapters invoked by harness callbacks | Agent process and renderer |
| Invocation exactly-once journal | Electron main | SDK alone |
| Budget/quota/provider normalization | Rust API | Local agent runtime |
| Agent definitions | Signed application code via deterministic graph factory | Model-generated config |
| UI projection | Electron main -> narrow renderer IPC | Utility child raw events |
| Optional future cloud task | Separate runtime adapter | Local runtime fallback logic |

### Runtime Abstraction

~~~ts
interface AgentRuntimeAdapter {
  readonly kind: 'local'; // future union: 'local' | 'cloud'
  start(input: StartAgentTurn): AsyncIterable<NormalizedAgentEvent>;
  resume(input: ResumeAgentTurn): AsyncIterable<NormalizedAgentEvent>;
  steer(input: SteerAgentTurn): Promise<void>;
  cancel(input: CancelAgentTurn): Promise<void>;
  health(): Promise<RuntimeHealth>;
}
~~~

Do not add a `backendAgentEnabled` boolean to this interface. Runtime kind is an explicit host/product choice. A future cloud adapter implements the same normalized boundary without sharing state ownership or silently taking over a local thread.

`AgentRuntimeAdapter` is a product/runtime boundary, not an alternative to `Agent` or `Runner`. Code inside the utility process should use stable public `@openai/agents` types directly rather than wrapping every SDK method behind a lowest-common-denominator TroCode API.

### Utility Process Protocol v1

All messages are discriminated, Zod-parsed, versioned, correlated, and direction-specific.

Host -> child:

- `runtime.initialize`: protocol version/digest, SDK version, graph version, required capability set, immutable launch config, current ephemeral auth material.
- `runtime.replaceCredential` / `runtime.clearCredential`: rotate memory-only user credential.
- `turn.start`, `turn.resume`, `turn.steer`, `turn.cancel`.
- `session.read.result`, `session.append.result`, `session.replace.result`.
- `checkpoint.commit.result`.
- `tool.execute.result` with `completed | failed | unknown | cancelled`.
- `runtime.shutdown`.

Child -> host:

- `runtime.ready` with supported `runtime.capabilities`, plus `runtime.health` and `runtime.fatal`.
- `turn.event` with monotonic `sequence` and normalized event payload.
- `session.read`, `session.append`, `session.replace`.
- `checkpoint.commit` containing serialized RunState and pending call metadata.
- `tool.execute` only after checkpoint acknowledgement.
- `turn.terminal`.

Every request includes `requestId`; every turn-scoped message includes `threadId`, `turnId`, `agentId`, `graphVersion`, and monotonic `sequence`. The host rejects unknown keys/types, stale sequences, wrong graph versions, duplicate non-idempotent requests, and messages for inactive turns.

### Multi-Agent-Ready, Single-Agent-Now Graph

Create a deterministic `AgentGraphFactory` with:

- an immutable registry of `AgentDefinition` values;
- stable `agentId`, instructions digest, allowed tool IDs, optional handoff targets, and output schema;
- a `graphVersion` digest over SDK version, protocol digest, model settings, instructions, agent definitions, handoff edges, and sorted tool schemas;
- exactly one definition in v1: `tro.root`;
- no handoff edges and no agents-as-tools in v1;
- event/state fields `agentId`, optional `parentAgentId`, and optional `delegationId` reserved now;
- host validation that every agent and tool came from signed application code.

Future handoffs can use native Agents SDK `handoffs`; future manager/subagent orchestration can use `agent.asTool()`. Neither changes the provider proxy or grants a child agent new tools by implication.

### SDK/Core Capability Adoption Policy

`@openai/agents` 0.17.0 already re-exports the stable public `@openai/agents-core` surface plus the OpenAI provider and Realtime namespace. Depend on and import from `@openai/agents` by default. Do not import SDK internal paths, copy SDK source, or create TroCode replacements for `Agent`, `Runner`, `RunState`, sessions, handoffs, agents-as-tools, guardrails, MCP, tracing, tool search, shell/apply-patch/computer tools, or compaction.

Classify each new SDK/Core capability by the boundary it crosses:

| Capability class | Adoption path | Required boundary change |
|---|---|---|
| Pure agent orchestration, guardrail, handoff, lifecycle hook | Configure it directly in `AgentGraphFactory`/`Runner` | None unless a user-visible event is needed |
| New user-visible SDK event or control | Normalize it in the harness event adapter | Versioned utility protocol and renderer contract |
| New local OS tool/environment | Register the native SDK tool or function callback | New/updated trusted Electron-main execution adapter |
| New Responses request field, hosted tool, or stream event | Use it through the SDK's OpenAI provider | Rust proxy compatibility update and capability declaration |
| Realtime-specific transport | Add an explicit runtime capability/module | Do not distort the text-turn protocol; retain the same host services |

Add `runtime.capabilities` to the startup handshake. It advertises supported stable features such as `sessions`, `compaction`, `mcp`, `toolSearch`, `shell`, `applyPatch`, `computer`, `handoffs`, `agentsAsTools`, `guardrails`, `tracing`, and `realtime`; advertising a capability does not enable it for `tro.root`. The host rejects a graph that requires a capability unavailable in the packaged SDK or Rust model proxy.

SDK upgrade procedure:

1. Bump the pinned `@openai/agents` package; never float the packaged runtime version.
2. Compile against public exports and update capability-contract tests.
3. Add the new feature directly to the harness graph/provider/tool/event adapter as appropriate.
4. Change the utility protocol only when behavior crosses the process boundary.
5. Change Rust only when the Responses/provider transport changes.
6. Bump `graphVersion` when instructions, active tools, agents, handoffs, model settings, or resumable semantics change.
7. Run old-checkpoint compatibility, crash/no-replay, eval, and packaged-runtime tests before activation.

This policy preserves the full power of new SDK features without letting the renderer or Rust backend become a second orchestration layer.

### Local State Model

Electron main stores new local tasks beneath `app.getPath('userData')/agent-state/` using opaque IDs, never user prompt text in filenames.

1. `threads/index.enc`: bounded encrypted thread metadata and schema version.
2. `threads/<thread-id>/events.enc`: encrypted append-only event frames with sequence and checksum.
3. `threads/<thread-id>/snapshot.enc`: atomically replaced compact snapshot for fast startup.
4. `threads/<thread-id>/invocations.enc`: encrypted external-effect journal.

Each logical record is Zod-validated before encryption and after decryption. Writes use a same-directory temporary file, flush/fsync where supported, atomic rename, and directory permission checks. Append-only frames are length-delimited and checksummed so a torn final frame can be quarantined without accepting earlier corruption. Compaction writes and verifies the new snapshot before replacing/truncating the event log.

`safeStorage` keys never leave Electron main. The utility process requests logical session operations. Stored RunState is opaque to main but is bound to `sdkVersion`, `graphVersion`, `protocolDigest`, `threadId`, and checkpoint revision.

### External-Effect Journal

Each tool call has a stable `callId` and idempotency digest. Allowed transitions:

~~~text
requested -> checkpointed -> executing -> completed
                                  |          |
                                  +-> failed +-> result delivered
                                  |
                                  +-> unknown (terminal; never retry)
                                  +-> cancelled-before-dispatch
~~~

Rules:

1. Persist serialized RunState plus pending call and await durable acknowledgement.
2. CAS journal record from `checkpointed` to `executing`.
3. Execute exactly once through `RuntimeToolDispatcher`.
4. Persist normalized result before replying to the child.
5. If the process/app dies after `executing` and before a durable result, recover as `unknown` unless the adapter has a trustworthy external idempotency/status mechanism.
6. Never let SDK retry settings or process restart repeat an `unknown` call.
7. Read-only/idempotent adapters may define narrower recovery behavior explicitly; external-effect default remains no replay.

### Provider Transport

Replace the private `BrokeredOpenAIClientFactory` with a user-authenticated model transport that targets the public Rust endpoint. It must:

- use a short-lived credential passed from Electron main memory;
- send stable `requestId`, local `taskId`, and server-recognized `agentTurnId` headers;
- keep `maxRetries: 0`, `store: false`, bounded deadlines, and abort propagation;
- use Rust for access control, budget reservation, provider selection/normalization, and request accounting;
- expose Responses compaction through the same authenticated public boundary;
- never expose Rust's provider key or the old orchestration service token.

The current public endpoint requires an `x-trocode-agent-turn-id`. Before each model turn, Electron main must reserve lightweight server turn metadata through an authenticated client, then pass the returned ID to the child. This remote record is for accounting/idempotency, not ownership of local SDK state. If existing API semantics cannot express that distinction cleanly, add a dedicated authenticated “local model turn reservation” endpoint rather than reusing hosted-run ownership tables.

### Secret Model

- Remove `TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN` from the local developer startup path and from the final local-runtime deployment.
- Remove `TROCODE_BACKEND_AGENT_ENABLED`, rollout, and canary configuration after cutover; do not merely default them to `true`.
- Electron main may forward an access token to the child only after a successful protocol/graph handshake.
- The child holds it in memory, replaces it on refresh, clears it on sign-out, and never includes it in exceptions or telemetry.
- Connector credentials remain server-side. Local connector tool adapters call authenticated connector endpoints rather than receiving credentials.

---

## Strategic Design

### Chosen Approach

Repurpose `services/agent-runtime` from a deployed Railway worker into a bundled local Node utility-process package. Retain its current Agents SDK graph, compaction, RunState, version binding, checkpoint, and crash-test knowledge, but replace Rust leases/polling/private service-token clients with a typed host protocol and the authenticated public model proxy. Make Electron main the canonical local lifecycle/state/tool owner.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Keep hosted SDK worker and only default `backendAgentEnabled=true` | Reject | Preserves service-token, endpoint, lease, latency, deployment, and local-tool round-trip failures |
| Run Agents SDK directly in Electron main | Reject for final design | Historical implementation proves feasibility, but isolates crashes/dependency load less well and makes future agent graphs harder to package independently |
| Run Agents SDK in renderer | Reject | Violates renderer sandbox and would expose trusted capabilities/auth material |
| Adopt Codex SDK/app-server as runtime | Reject | User chose OpenAI Agents SDK; TroCode also needs desktop/CUA and connector tools beyond coding |
| One child process per thread | Reject initially | Wastes memory and complicates credential rotation; one supervised process can isolate per-turn state logically |
| Local SQLite with a native module | Defer | Adds native packaging/cross-platform risk. Start with encrypted append-only files behind a store interface; SQLite can replace the adapter later |
| Continue storing all thread state in Rust | Reject for local tasks | Leaves local UX dependent on hosted orchestration and prevents offline history/resume metadata |
| Automatic hosted fallback | Reject | Creates dual ownership and exactly-once ambiguity; cloud must be explicit and separate |
| Build multi-agent now | Reject | No validated specialist topology yet; define the stable seam and ship one root agent |

### In Scope

- Bundled local utility process running current OpenAI Agents SDK.
- Typed/versioned bidirectional host protocol and supervision.
- One deterministic root agent and future-compatible graph metadata.
- User-authenticated Rust model proxy and local turn accounting.
- Encrypted local thread, session, checkpoint, event, and invocation storage.
- Direct local tool execution through existing registries/adapters.
- Local start/resume/steer/cancel/history and renderer activity streaming.
- Packaging for supported macOS, Windows, and Linux targets.
- Drain/cutover/removal of remote live orchestration and its configuration.
- Read-only access to terminal legacy hosted history.
- Crash, no-replay, package, and end-to-end validation.

### Not Building

- Multiple active agents, native handoffs, agents-as-tools, parallel delegation, or multi-agent UI.
- Cloud/background agents or a persistent OS daemon.
- Offline inference or local model hosting.
- Cross-device sync, collaborative threads, or cloud backup of local RunState.
- Importing nonterminal hosted runs into local SDK state.
- New approval profiles, autonomy sliders, “bounded by default,” or “balanced” settings.
- Dynamic model-created tools/agents or user-installed arbitrary agent code.
- A Codex CLI/Codex SDK dependency.
- A renderer-accessible generic process or IPC bridge.

---

## Dead-Code Cleanup Audit

Cleanup is a required migration deliverable, not an optional follow-up. Gate 10 must create `.claude/PRPs/reports/codex-local-agent-dead-code-audit.md` and record every row below with its final disposition, dependency evidence, deletion/replacement commit, and validation result.

### Disposition Rules

| Disposition | Meaning |
|---|---|
| `REPLACE` | Existing responsibility remains but moves to the local harness or desktop host; delete the old implementation after replacement tests pass |
| `DELETE_AT_CUTOVER` | Hosted-only code/config is removed after packaged local execution passes and remote runs are drained |
| `PRESERVE_LEGACY_READ_ONLY` | Retain the minimum decoder/store needed to display terminal historical data; no new writes or live execution |
| `PRESERVE_CORE` | Still belongs to auth, provider, budget, connector, CUA, or application infrastructure; do not delete merely because its directory/name says agent/worker |
| `DEFER_FORWARD_MIGRATION` | Stop using the database object now; archive/drop later using a new migration after retention and query evidence |

Never classify code by filename alone. Prove production reachability through imports, router registration, scripts, build targets, environment readers, database queries, and packaged artifact contents.

### Electron/Main Audit

| Candidate | Current role | Disposition | Required evidence before removal |
|---|---|---|---|
| `src/index.ts` imports/wiring for `DesktopWorkerClient`, `desktopWorkerCapabilities`, `startHostedDesktopWorker()` and `[desktop-worker]` handlers | Connects local desktop to remote tool queue | `REPLACE` | Local runtime composition/startup, auth rotation, tools, restore, and shutdown tests pass with no hosted worker |
| `src/main/hosted/desktop-worker-client.ts` and test | Connect/heartbeat/events/result client | `DELETE_AT_CUTOVER` | No import; route inventory has no desktop-worker caller; packaged smoke succeeds |
| `src/main/hosted/desktop-worker-protocol.ts` and test | Builds v5 remote worker capabilities | `DELETE_AT_CUTOVER` | Local utility protocol owns negotiation and legacy history decoder does not import it |
| `src/main/hosted/desktop-tool-worker.ts` and test | Converts remote invocation to local adapter dispatch | `REPLACE` then delete | Every adapter is covered by `LocalToolBroker` contract/crash tests |
| `src/main/hosted/computer-permission-coordinator.ts` and test | OS screen/accessibility readiness plus remote permission-wait persistence | `REPLACE`, move/rename | Preserve OS permission checks/settings flow; remove remote `PermissionBackend`/runVersion coupling and use local lifecycle state |
| `src/main/application/hosted-task-client.ts` and test | Submit/status/list/get/cancel/steer/subscribe hosted runs | Split: `REPLACE` live methods; `PRESERVE_LEGACY_READ_ONLY` only if list/get are still required | Local application client tests pass; legacy history has a narrower explicitly read-only client |
| `src/main/history/hosted-task-history-store.ts` | Reads hosted terminal task records | `PRESERVE_LEGACY_READ_ONLY` | Store rejects/no-ops writes by explicit contract, filters terminal records, and has a documented retention/removal date |
| `src/main/agent/task-runtime.ts` | Projects remote lifecycle only | `REPLACE` | `LocalTaskRuntime` is canonical and pure transition tests pass |
| Hosted-runtime status/rollout types in renderer/preload/shared contracts | Displays remote availability and task state | `DELETE_AT_CUTOVER` or move minimal historical decoder | `rg` shows no live renderer/preload consumer; old terminal fixtures still decode where promised |
| `AutonomyModeSchema` and `autonomyMode` fields in `src/shared/contracts.ts` | Remain in runtime/persisted schemas despite removed UI | Split legacy decoder, then delete from live schemas | Settings/preferences migration tests prove old values are stripped; no active task contract depends on the field |

### Node Agents SDK Package Audit

| Candidate | Disposition | Replacement/preservation rule |
|---|---|---|
| `services/agent-runtime/src/run-worker.ts` | `REPLACE` then delete hosted loop | `local-runtime-server.ts` receives local turn commands; no lease claim/renew/release |
| `services/agent-runtime/src/control-plane-client.ts` | `DELETE_AT_CUTOVER` | Host protocol client replaces Rust lease/session/tool polling |
| `services/agent-runtime/src/brokered-openai-client.ts` | `REPLACE` | User-authenticated OpenAI provider adapter calls public Rust proxy |
| `services/agent-runtime/src/rust-session.ts` | `REPLACE` | Preserve SDK `Session` transaction/compaction semantics in `host-backed-session.ts`; delete lease coupling |
| `services/agent-runtime/src/tool-adapter.ts` | `REPLACE` in place or split | Preserve native SDK tool callbacks, frozen catalog, checkpoint-before-effect, and `ToolOutcomeUnknownError`; delete Rust queue/result polling |
| `services/agent-runtime/src/agent-graph.ts` | `PRESERVE_CORE`, refactor | This becomes the TroCode Agent Harness graph; retain direct SDK `Agent`/`Runner` use |
| `services/agent-runtime/src/config.ts` and test | `REPLACE` | Remove service token/worker/lease/poll config; add immutable local launch/capability config |
| `services/agent-runtime/src/protocol.ts` | `REPLACE` | Remove hosted claim/lease shapes; use versioned local host protocol without duplicating SDK types unnecessarily |
| `services/agent-runtime/src/index.ts` | `REPLACE` | Utility-process entry, not deployed health server/worker entry |
| Hosted compatibility fixture/tests | Convert useful graph/session/crash invariants; delete lease-only assertions | Audit report maps every removed test to replacement coverage |
| `services/agent-runtime/railpack.json` and `railway.json` | `DELETE_AT_CUTOVER` | Package is a Forge-staged desktop resource, not a Railway service |
| Worker-only npm dependencies and lock entries | `DELETE_AT_CUTOVER` | Run dependency inventory after refactor; retain `@openai/agents`, `openai`, and Zod |

### Rust/API Audit

| Candidate | Disposition | Replacement/preservation rule |
|---|---|---|
| `services/api/src/http/agent_orchestrator.rs` | `DELETE_AT_CUTOVER` | Remove private worker registration/claim/lease/session/checkpoint/tool/model-broker routes after no packaged caller remains |
| `services/api/src/agent/orchestrator_protocol.rs` | `DELETE_AT_CUTOVER` | Local utility protocol is TypeScript host/child-only; Rust does not parse SDK orchestration state |
| `services/api/src/agent/orchestrator.rs` | `DELETE_AT_CUTOVER` after split | Move any still-required accounting/connector behavior to narrow public services first |
| `services/api/src/agent/run_store.rs` | Hosted worker/run ownership becomes unused | Preserve only code still required for legacy terminal history; otherwise remove code and defer table cleanup |
| `services/api/src/agent/session_store.rs` | `DELETE_AT_CUTOVER` | New SDK session state is local; do not delete historical rows/migrations in the same change |
| `services/api/src/agent/tool_broker.rs` | Split | Remove desktop queue/poll broker; move connector routing to authenticated connector/local-tool APIs before deletion |
| `services/api/src/agent/tool_snapshot.rs` | `DELETE_AT_CUTOVER` for hosted runs | Local host persists frozen catalog digest; historical database records remain until retention migration |
| `services/api/src/agent/model_dispatch_store.rs` | `REPLACE` | Make dispatch reservation user/local-turn based instead of lease-owner based; retain reserve-before-provider/no-retry invariant |
| `services/api/src/agent/service.rs` | Split | Remove backend-agent rollout and hosted run lifecycle; retain/refactor local turn reservation, accounting, and legacy terminal reads only where necessary |
| `services/api/src/http/agent_runtime.rs` | Split | Delete `/v1/desktop-worker/*` and remote live-run routes; retain only explicitly required authenticated accounting/history APIs |
| `services/api/src/agent/lifecycle.rs`, `protocol.rs`, `tool_catalog.rs`, `cua_catalog.rs` | Audit/split, not blanket delete | Pure rules useful to local/shared contracts may move to Electron; keep Rust pieces only for public API validation or legacy reads |
| `services/api/src/http/mod.rs`, `src/agent/mod.rs`, `src/app.rs` | `REPLACE` wiring | Remove hosted modules, router calls, orchestrator maintenance jobs, and exports after dependencies disappear |
| `services/api/tests/agent_orchestrator_compat.rs` and orchestrator-specific contract cases | `DELETE_AT_CUTOVER` after replacement | New public model-turn/accounting tests and local protocol tests cover the retained boundary |
| Route/schema inventory fixtures | Update | Remove desktop-worker/private orchestrator routes; preserve unrelated agent/accounting/connector routes |

### Generated Contracts, Builds, Configuration, and Deployment Audit

| Candidate | Disposition | Notes |
|---|---|---|
| `protocol/agent-orchestrator.v1.schema.json` and manifest | `DELETE_AT_CUTOVER` | No Rust/Node caller after private orchestrator removal |
| `scripts/generate-agent-orchestrator-contract.mts` | `DELETE_AT_CUTOVER` | Remove root generate/check scripts and Bazel targets at the same time |
| `test/fixtures/agent-orchestrator-v1/` | `DELETE_AT_CUTOVER` | Replacement utility-protocol fixtures live with local runtime tests |
| `protocol/agent-runtime.v3/v4/v5*`, `agent-tools.v3/v4/v5*` | Split active vs legacy | Preserve only required terminal-history/migration decoders; do not keep a live remote worker protocol merely for history |
| Root `package.json` `agent:orchestrator:*` scripts and `check` chain | `REPLACE` | Add local utility-protocol/capability checks; keep `agent-sdk:check` for packaged harness |
| `services/api/BUILD.bazel` orchestrator contract/test targets | `DELETE_AT_CUTOVER` | Add targets for any new Rust public local-turn endpoints/tests |
| `TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN` | Remove code/config/docs/Doppler after drain | Revoke/rotate only after all consumers are removed; never log its old value |
| `TROCODE_BACKEND_AGENT_ENABLED`, `TROCODE_BACKEND_AGENT_ROLLOUT_PERCENT`, `TROCODE_BACKEND_AGENT_CANARY_USERS` | `DELETE_AT_CUTOVER` | Do not confuse with connector rollout variables, which remain |
| `services/agent-runtime/railway.json` and `railpack.json` | `DELETE_AT_CUTOVER` | Root/API Railpack configs are unrelated and remain |
| `services/api/railway.worker.json` | `PRESERVE_CORE` unless separate ingestion removal is requested | It starts `ingestion-worker`, not the Node agent worker |
| `README.md`, `docs/agent-runtime-operations.md`, `docs/operations/rust-backend-cutover.md`, `docs/security.md`, architecture/config/troubleshooting docs | Rewrite/archive hosted sections | Retain historical implementation reports; current operator docs must describe local ownership |

### Database Audit and Retention

- Never edit or delete migrations `031_agents_sdk_orchestrator.sql`, `032_orchestrator_public_protocol_digest.sql`, or any historical migration.
- Stop new writes to hosted lease, checkpoint, session, tool queue, tool snapshot, and worker tables at cutover.
- Inventory table readers and terminal-history dependencies using SQL query references before removing Rust stores.
- Preserve terminal task/history rows through the documented retention window.
- Use a new forward migration for archival markers, expired operational-row deletion, index removal, or eventual table drops.
- Do not drop provider dispatch/accounting records still required for usage, audit, budget, or unknown-outcome evidence.

### Audit Procedure and Evidence

1. **Baseline**: capture imports, route inventory, environment readers, scripts, build targets, SQL table references, deployment files, and packaged resources before Gate 1.
2. **Replacement map**: every `REPLACE` row names its new owner and replacement tests before old code changes.
3. **Pre-cutover reachability**: prove the packaged app starts, runs a task, executes every tool class, resumes, and reads history with the hosted Node service stopped.
4. **Drain evidence**: record the count and disposition of nonterminal remote runs; never migrate/replay their opaque SDK state.
5. **Delete**: remove hosted-only code, routes, contracts, scripts, deployments, tests, dependencies, and config in one auditable gate.
6. **Secret cleanup**: after deployment proves zero consumers, remove Doppler variables and revoke/rotate the old service token through the approved operator path.
7. **Database cleanup**: stop use immediately; archive/drop only by later forward migration and retention evidence.
8. **Post-cutover proof**: rerun searches, route/schema inventories, dependency inspection, package artifact inspection, full tests, and manual smoke.

Required post-cutover searches:

~~~bash
rg -n "TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN|TROCODE_BACKEND_AGENT_(ENABLED|ROLLOUT_PERCENT|CANARY_USERS)" . \
  --glob '!target/**' --glob '!node_modules/**' --glob '!services/agent-runtime/node_modules/**' --glob '!.git/**'

rg -n "DesktopWorker|desktop-worker|RunLease|claimRun|claim.*lease|agent_orchestrator|internal/agent-orchestrator" \
  src services protocol scripts test docs README.md package.json \
  --glob '!services/api/migrations/**' --glob '!docs/testing/**' --glob '!*.plan.md' --glob '!*.report.md'

rg -n "autonomyMode|Bounded by default|Approval gates enabled|Approval style" \
  src README.md docs --glob '!docs/testing/**'
~~~

Expected results are not blindly “zero”: every remaining match must be listed in the dead-code audit report as `PRESERVE_LEGACY_READ_ONLY`, `PRESERVE_CORE`, an immutable migration, or a defect to remove. Connector rollout/canary configuration, the Rust ingestion worker, provider accounting, and historical PRP reports are explicit false-positive classes that must not be deleted.

---

## Implementation Plan

### Gate 1 — Freeze the local runtime contracts and ownership

**ACTION**

- Add `src/main/agent-runtime/agent-runtime-adapter.ts` with host-facing `start`, `resume`, `steer`, `cancel`, and `health` methods.
- Add `src/main/agent-runtime/local-agent-runtime-protocol.ts` or a shared equivalent containing Zod schemas for every host/child message.
- Extend `src/shared/contracts.ts` only with renderer-visible normalized task/activity/history schemas; do not expose raw child messages.
- Add an architecture decision record or update `docs/architecture.md` with the ownership matrix above before runtime implementation.
- Define a versioned `runtime.capabilities` handshake so the harness can adopt new public SDK/Core features without adding a second orchestration abstraction.

**IMPLEMENT**

- Protocol constants: `LOCAL_AGENT_PROTOCOL_VERSION`, protocol digest, SDK version, graph version.
- Discriminated unions with correlation IDs, monotonic sequence, thread/turn/agent IDs, bounded strings/arrays, and explicit terminal/error codes.
- `AgentRuntimeAdapter` allows future runtime kind expansion but implements only `'local'` now.
- Define stable event kinds: lifecycle, assistant delta, tool requested/started/completed/failed/unknown, input requested, usage, recoverable error, terminal.
- Drop raw reasoning events and sensitive request/response bodies at this normalization boundary.
- Separate three contracts explicitly: product `AgentRuntimeAdapter`, host/child transport, and native SDK graph/types. Do not flatten them into one generic API.

**MIRROR**

- Zod/type derivation in `src/shared/contracts.ts`.
- Service/client suffixes and abort semantics in `src/main/agent/*`.
- Version/digest binding in `services/agent-runtime/src/protocol.ts`.

**IMPORTS**

- `zod`; existing shared ID and runtime tool schemas.

**GOTCHA**

- Utility-process protocol types must not become renderer IPC types.
- Protocol errors fail closed and stop the child; never coerce unknown messages.
- Include future `parentAgentId`/`delegationId` as optional persisted metadata, not active behavior.
- Do not expose raw SDK objects across IPC, but do not wrap stable public SDK APIs inside the utility process merely for symmetry.

**VALIDATE**

- Schema unit tests cover every message, unknown discriminator, oversized payload, wrong version, stale sequence, sensitive-field omission, required-capability mismatch, and forward-compatible optional capability advertisement.
- `npm run check`.

### Gate 2 — Build and supervise the bundled utility process

**ACTION**

- Add `src/main/agent-runtime/local-agent-runtime-client.ts`.
- Add injectable `LocalAgentRuntimeTransport` plus production Electron utility-process transport.
- Add `services/agent-runtime/src/process-entry.ts` and `local-runtime-server.ts`.
- Add health/version handshake, request correlation, backpressure, graceful shutdown, crash fan-out, and bounded restart policy.

**IMPLEMENT**

- Start only after Electron `app.ready`.
- Use `utilityProcess.fork` with explicit module path, cwd, minimal environment allowlist, piped/bounded diagnostics, and no shell.
- Wait for `runtime.ready` matching protocol/SDK/graph digests before sending credentials or turns.
- Maintain one process per app. Isolate concurrent turns by `turnId` and one AbortController each.
- On child exit, reject pending protocol calls; classify active invocation-bearing turns using the durable journal before restart.
- Restart only when no unresolved `executing` invocation exists; otherwise surface recovery/unknown state first.

**MIRROR**

- Start-once and health semantics from `src/main/engine/rust-desktop-engine-client.ts:109-170`.
- Pending request timeout/exit handling from `src/main/engine/rust-desktop-engine-client.ts:173-223`.

**IMPORTS**

- Electron `utilityProcess`; Node `events`; Gate 1 schemas.

**GOTCHA**

- Electron RunAsNode fuse is disabled; do not use `child_process.fork` against Electron as Node.
- Message floods can freeze main. Bound in-flight requests and coalesce assistant deltas before renderer projection.
- Never inherit all environment variables into the child.

**VALIDATE**

- Fake-transport unit tests for startup, digest mismatch, timeout, duplicate response, out-of-order event, child exit, credential redaction, shutdown, and restart.
- Development smoke: start app with hosted agent service absent and observe `runtime.ready`.

### Gate 3 — Build the single TroCode Agent Harness around the Agents SDK

**ACTION**

- Refactor `services/agent-runtime/src/agent-graph.ts` for host-backed sessions and user-authenticated model transport.
- Replace `run-worker.ts` lease loop with turn commands handled by `LocalRuntimeServer`.
- Replace `RustSession` with `HostBackedSession` while preserving SDK `Session` behavior.
- Introduce deterministic `AgentDefinitionRegistry` and single-agent graph.
- Keep the SDK `Agent`/`Runner` as the only agent loop; Electron main and Rust remain host/provider services rather than planners or runners.

**IMPLEMENT**

- Keep `Runner`, `Agent`, `OpenAIResponsesCompactionSession`, `parallelToolCalls:false`, `retry.maxRetries:0`, `store:false`, and tracing without sensitive data.
- Register only `tro.root`; hash complete graph inputs into `graphVersion`.
- Serialize/restore SDK RunState only when SDK/graph/protocol/tool digests match.
- Translate SDK streaming and interruption events into Gate 1 normalized events.
- Implement host-backed session read/append/replace/clear requests with optimistic revision checks.
- Ensure a turn owns a fixed graph/tool catalog from start through terminal state.
- Implement normal SDK tool callbacks backed by a `HostToolClient`; the agent sees standard SDK tools while execution crosses to Electron main only inside the callback.
- Advertise public SDK capabilities from the packaged dependency and fail graph construction when an enabled feature is unavailable.
- Import stable primitives from `@openai/agents`; do not fork SDK code, import internal paths, or create TroCode substitutes for `Agent`, `Runner`, `RunState`, sessions, handoffs, guardrails, MCP, tracing, or compaction.

**MIRROR**

- `services/agent-runtime/src/agent-graph.ts:24-97`.
- `services/agent-runtime/src/rust-session.ts` revision/compaction semantics.
- Historical local runtime at commit `358b8b0`, but without its approval policy.

**IMPORTS**

- Existing `@openai/agents`, `openai`, `zod`; no new agent framework.

**GOTCHA**

- Do not call host tools in an SDK callback before the checkpoint protocol acknowledges durable RunState.
- Do not activate handoffs or `agent.asTool()` yet. Test only graph determinism and reserved lineage fields.
- SDK upgrades require graph-version changes and resume compatibility tests.
- `LocalRuntimeServer` is a process/protocol entry, not a second orchestration loop.

**VALIDATE**

- Unit tests for graph determinism, graph mismatch, one root agent, fixed tool catalog, event normalization, capability advertisement/mismatch, native tool callback flow, compaction, resume, cancel, and no retry.
- `npm --prefix services/agent-runtime run check`.

### Gate 4 — Add authenticated local model-turn transport

**ACTION**

- Add an Electron-main `AgentTurnAccountingClient` or extend the authenticated task client with a narrowly named local-turn reservation method.
- Replace `services/agent-runtime/src/brokered-openai-client.ts` with a public user-authenticated client factory.
- Add/adjust Rust authenticated endpoints for local model-turn reservation and Responses compaction.

**IMPLEMENT**

- Main reserves a server accounting turn using the current user/device session.
- Pass only access token, public API base URL, request/task/turn IDs, model, and deadlines to child memory.
- Child sets required headers for `/v1/openai/responses`; aborts propagate end-to-end.
- Rust reserves budget before provider dispatch, records usage, preserves request idempotency, and never owns local SDK state.
- Expose compaction with the same authentication, budget, deadline, and no-retry rules.
- Add token replace/clear messages on refresh/sign-out.

**MIRROR**

- Authenticated request construction in existing hosted clients.
- Public model proxy contract in `services/api/src/http/core.rs:315-359`.
- Reserve-before-dispatch/no-retry in `services/api/src/providers/responses.rs`.

**IMPORTS**

- Existing auth session provider and Rust response/error types.

**GOTCHA**

- Do not reuse a private route that requires `TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN`.
- Do not let retry behavior differ between SDK, OpenAI client, HTTP client, and Rust provider.
- HTTP 401 refresh must be host-coordinated; the child must not persist refresh credentials.

**VALIDATE**

- Rust tests: unauthorized, invalid turn ID, duplicate request, budget exhausted, provider timeout, unknown dispatch outcome, compaction accounting.
- Node tests: exact headers, credential clearing, abort, 401 handoff, redacted errors, `maxRetries:0`.
- `npm run bazel:check` for Rust/Bazel changes.

### Gate 5 — Implement encrypted local thread and checkpoint persistence

**ACTION**

- Add `src/main/agent-runtime/local-agent-state-store.ts` and file-backed production adapter.
- Add schemas for thread metadata, events, opaque session items/RunState, checkpoints, usage summaries, and recovery state.
- Add atomic snapshot/append/compaction helpers with corruption quarantine.

**IMPLEMENT**

- Use `app.getPath('userData')/agent-state`, opaque UUID directory names, `0600` files, and restrictive directories.
- Encrypt logical payloads through `safeStorage` in Electron main.
- Store monotonic revision, schema version, SDK/graph/protocol/tool digests, checksum, created/updated timestamps.
- Use same-directory temp write -> flush -> atomic rename for indexes/snapshots.
- Parse length-delimited event frames; tolerate only a torn final frame. Quarantine any mid-log corruption and show a recoverable history error.
- Compact after bounded count/size thresholds. Verify the new snapshot before pruning old frames.
- Add migration versioning from day one; never silently parse a future schema.

**MIRROR**

- Encryption/Zod/userData convention in `src/main/workspace/workspace-selection-store.ts:25-55`.
- Session revision semantics in `services/agent-runtime/src/rust-session.ts`.

**IMPORTS**

- Electron `safeStorage`; Node `fs/promises`, `path`, `crypto`; Zod.

**GOTCHA**

- `writeFile` alone is not atomic and current workspace store is not sufficient for crash-safe RunState; implement the stronger sequence explicitly.
- Decrypted opaque SDK state is sensitive. Never log it or expose it to renderer/history search.
- On systems where OS encryption is unavailable, fail local runtime startup clearly rather than writing plaintext.

**VALIDATE**

- Tests for first write/read, wrong schema, tampering, torn final frame, mid-log corruption, concurrent revision conflict, atomic compaction, re-encryption request, unavailable encryption, and file permissions.
- Process-kill fault injection between every write/rename phase.

### Gate 6 — Move tool execution to a direct local checkpoint broker

**ACTION**

- Add `src/main/agent-runtime/local-tool-execution-journal.ts`.
- Add `src/main/agent-runtime/local-tool-broker.ts` that handles child checkpoint/tool requests.
- Adapt `RuntimeToolRegistry`, `RuntimeToolDispatcher`, `ExecutionCoordinator`, CUA/workspace/browser/connector adapters to the local broker.
- Remove remote queue/poll assumptions from `services/agent-runtime/src/tool-adapter.ts`.

**IMPLEMENT**

- Freeze sorted tool specs and their catalog digest per turn.
- Child creates SDK interruption/pending call and sends `checkpoint.commit`.
- Host atomically persists checkpoint + pending call before acknowledging.
- Child then sends `tool.execute`; host CASes journal and dispatches exactly once.
- Normalize completed/failed/cancelled/unknown result and persist before response.
- Connector calls stay authenticated server requests; local filesystem/CUA/browser tools stay direct adapters.
- Preserve AbortSignal behavior, task/workspace scoping, URL checks, and adapter-specific idempotency metadata.

**MIRROR**

- Dispatcher registry at `src/main/agent/runtime-tool-dispatcher.ts:21-54`.
- Checkpoint order and `ToolOutcomeUnknownError` at `services/agent-runtime/src/tool-adapter.ts:18-69`.
- Crash tests in `services/agent-runtime/test/crash-recovery.test.ts`.

**IMPORTS**

- Existing runtime tool contracts, execution adapters, and workspace identity types.

**GOTCHA**

- `needsApproval:true` is a checkpoint mechanism only. Do not surface a user approval card merely because the SDK interrupted.
- If main crashes after dispatch, default recovery is `unknown`, never “failed; retry.”
- The model cannot expand the tool catalog mid-turn or supply a different workspace root.

**VALIDATE**

- Crash matrix: before checkpoint, after checkpoint, before dispatch, during dispatch, after effect/before result persistence, after result/before child acknowledgement, after acknowledgement.
- Assert exactly one adapter call or terminal `unknown` for every case.
- Contract tests for every registered local/connector tool.

### Gate 7 — Make local task lifecycle and history canonical

**ACTION**

- Refactor `TaskApplicationService` to target `AgentRuntimeAdapter` and local repositories.
- Replace projection-only `TaskRuntime` with canonical `LocalTaskRuntime` lifecycle transitions.
- Add `LocalTaskHistoryStore`; compose with `HostedTaskHistoryStore` only for terminal legacy records.
- Implement local start/resume/steer/cancel/retry-new-turn semantics.

**IMPLEMENT**

- Persist task/thread record before model dispatch.
- Apply pure lifecycle transitions and sequence checks in main; renderer receives snapshots/events only.
- Resume only safe paused/interrupted states with matching graph/version/tool catalog.
- A user retry after `unknown` starts a new explicit turn and does not reuse the unknown invocation ID.
- Merge local and legacy terminal history deterministically by timestamp/source; mark legacy source internally without changing titles.
- Keep local new tasks authoritative even when backend is temporarily unavailable after history load.

**MIRROR**

- Existing application service boundary in `src/main/application/task-application-service.ts`.
- Existing history service/store repository pattern in `src/main/history/*`.
- Pure lifecycle transition conventions already used by current runtime contracts.

**IMPORTS**

- Gate 1 adapter/events; Gate 5 store; Gate 6 journal; current history schemas.

**GOTCHA**

- Do not import nonterminal remote SDK checkpoints into local state; graph and ownership are different.
- Do not report a child crash as task failure until the journal determines safe resume vs unknown outcome.
- Stop/cancel is best effort during an already executing external action; persist uncertainty honestly.

**VALIDATE**

- Application service tests for submit, stream, final, restart/resume, steer, cancel, sign-out, network loss, child crash, version mismatch, legacy history merge, and unknown outcome.

### Gate 8 — Rewire renderer IPC and remove hosted readiness UX

**ACTION**

- Update `src/index.ts`, IPC registration, preload, `DesktopApi`, and renderer task/history stores to consume the local runtime.
- Remove startup dependency on `DesktopWorkerClient` and hosted runtime status.
- Normalize status/error copy for local runtime, network, auth, budget, and tool uncertainty.

**IMPLEMENT**

- Start local runtime at app readiness; refresh/clear credential on auth transitions.
- Coalesce assistant deltas to 50-100 ms or animation-frame cadence.
- Show local runtime startup only if delayed; new task should not display hosted worker connection states.
- Preserve stop/Escape and accessibility announcements for phase/tool changes, not every token.
- Remove “Bounded by default,” “Approval gates enabled,” autonomy profile, and backend-agent readiness references if any remain.
- Show “Network required to continue” separately from “Local runtime unavailable.”

**MIRROR**

- Narrow preload functions and schema parsing in current IPC modules.
- Existing task/history observable store patterns in renderer.

**IMPORTS**

- Only normalized shared contracts. No Electron/Agents SDK imports in renderer.

**GOTCHA**

- Raw reasoning, child diagnostics, tokens, tool arguments, screenshots, and RunState never cross to renderer.
- Do not derive a fake percentage from tool-call or token budgets.

**VALIDATE**

- Renderer/unit tests for stream coalescing, task completion, runtime/network error distinction, stop, history after restart, and absence of hosted/approval-profile copy.
- Playwright smoke for submit -> streamed text -> local tool -> final -> relaunch -> history.

### Gate 9 — Package and verify the local runtime on every desktop target

**ACTION**

- Update `services/agent-runtime/package.json`, root scripts, lockfiles, Forge hooks/resources, and CI.
- Remove Railway/railpack service packaging only after desktop staging succeeds.
- Add an artifact verification script that locates the packaged entry and required production modules.

**IMPLEMENT**

- Compile utility-process TypeScript to deterministic `dist` output.
- Stage only runtime production files/dependencies as an Electron extra resource, following the CUA runtime pattern.
- Resolve development vs packaged entry paths without cwd assumptions.
- Verify ASAR/resource behavior, code signing/notarization compatibility, Windows path handling, and Linux executable/read permissions.
- Stamp protocol/SDK/graph versions into the packaged health response.

**MIRROR**

- `forge.config.ts` CUA resource staging.
- Existing packaged Rust engine path resolution and tests.

**IMPORTS**

- Existing build toolchain; avoid adding a second bundler unless `tsc` output cannot package transitive dependencies reliably.

**GOTCHA**

- A development-only `node_modules` path can make packaged builds pass locally and fail after install.
- Native/transitive SDK dependencies must be checked for all target architectures.
- Do not include `.env`, Doppler output, source maps with secrets, test fixtures, or service deployment files in the resource.

**VALIDATE**

- `npm run check`.
- `npm run package`.
- Inspect macOS/Windows/Linux package artifact manifests in CI.
- Launch packaged app with no global Node and no hosted agent worker.

### Gate 10 — Cut over and retire remote live orchestration

**ACTION**

- Introduce an operational drain step: stop accepting new hosted runs, wait/terminate according to explicit policy, and preserve terminal records.
- Remove Electron hosted desktop-worker startup and tool bridge.
- Remove deployed worker lease/control-plane/model-broker code and private orchestration routes after drain.
- Remove backend agent enable/rollout/canary/service-token configuration and deployment docs.
- Produce `.claude/PRPs/reports/codex-local-agent-dead-code-audit.md` from the audit matrix above before deleting candidates, then close every row with post-cutover evidence.

**IMPLEMENT**

- Release local runtime and schema migrations together.
- Before removal, query/measure nonterminal remote runs and document disposition. Never silently migrate or replay them.
- Keep existing database migrations immutable; add forward migrations only if tables need archival markers.
- Keep terminal legacy history readable through the hosted history adapter for a defined retention period.
- Record each candidate as `REPLACE`, `DELETE_AT_CUTOVER`, `PRESERVE_LEGACY_READ_ONLY`, `PRESERVE_CORE`, or `DEFER_FORWARD_MIGRATION`; no unclassified match may ship.
- Split mixed modules before deletion: preserve OS computer permissions, connector execution, provider accounting, and terminal history while removing remote worker ownership.
- Delete or archive:
  - `src/main/hosted/desktop-worker-client.ts`
  - `src/main/hosted/desktop-tool-worker.ts`
  - hosted-only task/run methods in `src/main/application/hosted-task-client.ts`
  - `services/agent-runtime/src/control-plane-client.ts`
  - hosted `run-worker.ts`, lease polling, and private `brokered-openai-client.ts`
  - Rust private agent-orchestrator live-run routes/config after no callers remain
  - Railway/railpack worker deployment configuration
- Retain provider proxy, auth, organizations, budgets, connector endpoints, and legacy terminal history reads.
- Remove orchestrator contract generator/scripts/Bazel targets/fixtures only after their Rust and Node callers are gone.
- Remove Doppler values and revoke/rotate the service token only after deployment proves zero consumers.

**MIRROR**

- Existing forward-only database migration conventions.
- Current deployment runbooks and config validation.

**IMPORTS**

- No new dependencies.

**GOTCHA**

- Do not delete historical migrations or terminal task data.
- Do not remove a private route until packaged desktop versions no longer call it and the worker is drained.
- Do not retain a hidden remote fallback flag “for safety”; rollback is an application release rollback, not runtime dual ownership.
- Do not delete connector rollout/canary settings, `services/api/railway.worker.json` ingestion-worker deployment, provider dispatch accounting, historical PRP reports, or migrations because a broad search matched “worker,” “agent,” or “canary.”

**VALIDATE**

- `rg` proves no production reference to service token, backend-agent flags, worker lease, desktop worker URL, or private orchestration endpoints.
- Fresh backend starts through Doppler without `TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN`.
- Local task works while hosted worker deployment is absent.
- Legacy terminal history remains visible.
- Audit report contains the baseline, replacement mapping, drain count/disposition, final search matches with classifications, dependency/package diff, route/schema inventory diff, database deferrals, secret cleanup confirmation, and packaged artifact inspection.

### Gate 11 — Reliability, evals, documentation, and release evidence

**ACTION**

- Add a local runtime **test harness** and scenario fixtures; name it explicitly as test infrastructure so it cannot be confused with the TroCode Agent Harness.
- Update README, architecture, security, configuration, development, deployment, troubleshooting, privacy/storage, and recovery docs.
- Write a PRP implementation report with command output and fault-injection evidence.

**IMPLEMENT**

- Scenarios: answer-only, multiple local tools, connector call, compaction, app restart, child restart, auth refresh, sign-out, network loss, budget error, cancellation, unknown external outcome, corrupt local state, SDK/graph mismatch.
- Add metrics limited to runtime readiness latency, turn latency, event counts, tool/result status, crash/recovery codes, and usage totals. Never include prompt/output/tool payloads or auth data.
- Document local data location, deletion/export behavior, legacy history distinction, and the fact that cloud/background execution is not included.
- Define future multi-agent activation gates: eval-backed use case, bounded agent registry, explicit graph version bump, lineage UI requirements, per-agent tool capability tests, and handoff loop/depth budgets.

**MIRROR**

- Existing Vitest, Rust, Playwright, package, and verification-loop conventions.
- Completed PRP report format under `.claude/PRPs/reports/`.

**IMPORTS**

- Existing test stacks only unless fault injection requires a small internal helper.

**GOTCHA**

- A successful answer-only test does not validate durability. Release requires the full crash matrix.
- Multi-agent-ready metadata is accepted only if it has zero active delegation behavior in v1.

**VALIDATE**

- `npm run check`.
- `npm run package`.
- `npm run bazel:check`.
- `npm --prefix services/agent-runtime run check`.
- Packaged manual smoke on each supported OS.
- Review `git diff` and artifact contents for secrets and obsolete hosted-worker references.

---

## Expected File Map

Exact names may adjust to existing module boundaries, but ownership must remain as follows.

### Create

- `src/main/agent-runtime/agent-runtime-adapter.ts`
- `src/main/agent-runtime/local-agent-runtime-protocol.ts`
- `src/main/agent-runtime/local-agent-runtime-client.ts`
- `src/main/agent-runtime/electron-utility-process-transport.ts`
- `src/main/agent-runtime/local-agent-state-store.ts`
- `src/main/agent-runtime/encrypted-file-agent-state-store.ts`
- `src/main/agent-runtime/local-tool-execution-journal.ts`
- `src/main/agent-runtime/local-tool-broker.ts`
- `src/main/agent-runtime/agent-turn-accounting-client.ts`
- colocated `.test.ts` files for each module
- `services/agent-runtime/src/process-entry.ts`
- `services/agent-runtime/src/local-runtime-server.ts`
- `services/agent-runtime/src/host-protocol-client.ts`
- `services/agent-runtime/src/host-backed-session.ts`
- `services/agent-runtime/src/user-authenticated-openai-client.ts`
- `services/agent-runtime/src/agent-definition-registry.ts`
- local-runtime protocol/graph/session/crash tests
- `.claude/PRPs/reports/codex-local-agent-dead-code-audit.md` during Gate 10

### Update

- `src/index.ts`
- `src/main/application/task-application-service.ts`
- `src/main/agent/task-runtime.ts` or replace it with a clearly named local lifecycle owner
- `src/main/agent/execution-coordinator.ts`
- `src/main/agent/runtime-tool-registry.ts`
- `src/main/agent/runtime-tool-dispatcher.ts`
- `src/main/history/task-history-service.ts`
- `src/main/history/task-history-store.ts`
- `src/main/history/hosted-task-history-store.ts`
- `src/shared/contracts.ts`
- `src/shared/desktop-api.ts`
- preload and IPC registration files discovered from current imports
- renderer task/history/activity modules discovered from current `DesktopApi` consumers
- `services/agent-runtime/src/agent-graph.ts`
- `services/agent-runtime/src/tool-adapter.ts`
- `services/agent-runtime/src/config.ts`
- `services/agent-runtime/package.json`
- `services/api/src/http/core.rs`
- `services/api/src/providers/responses.rs`
- Rust router/config/test files required by the new public turn/compaction contract
- `forge.config.ts`
- root `package.json` and lockfiles
- CI/Bazel artifacts when Rust or packaged runtime inputs change
- `README.md`, `docs/architecture.md`, `docs/security.md`, configuration/deployment/troubleshooting docs

### Delete only after Gate 10 cutover evidence

- `src/main/hosted/desktop-worker-client.ts` and its tests.
- `src/main/hosted/desktop-worker-protocol.ts` and its tests.
- `src/main/hosted/desktop-tool-worker.ts` after `LocalToolBroker` covers every adapter.
- Hosted-only portions of `src/main/application/hosted-task-client.ts`; retain only a narrower legacy terminal-history reader if required.
- `services/agent-runtime/src/control-plane-client.ts`, hosted `run-worker.ts`, and the private brokered model client after their replacements pass.
- Lease-bound portions of `rust-session.ts`, `tool-adapter.ts`, `config.ts`, `protocol.ts`, and `index.ts` after invariant-preserving replacements land.
- `services/agent-runtime/railpack.json` and `services/agent-runtime/railway.json`.
- `services/api/src/http/agent_orchestrator.rs`, `services/api/src/agent/orchestrator_protocol.rs`, and hosted-only orchestrator/store/broker code after mixed responsibilities are split.
- `/v1/desktop-worker/*`, `/internal/agent-orchestrator/*`, maintenance jobs, exports, route/schema inventory entries, and compatibility tests with no remaining caller.
- `protocol/agent-orchestrator.v1.*`, `scripts/generate-agent-orchestrator-contract.mts`, its root npm scripts/check-chain entry, Bazel targets, and `test/fixtures/agent-orchestrator-v1/`.
- `TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN`, `TROCODE_BACKEND_AGENT_ENABLED`, `TROCODE_BACKEND_AGENT_ROLLOUT_PERCENT`, and `TROCODE_BACKEND_AGENT_CANARY_USERS` readers/tests/docs/deployment values after drain and zero-consumer proof.
- Live `AutonomyModeSchema`/`autonomyMode` fields and product copy after minimal legacy preference/history migration decoders are separated.
- Worker-only dependencies and lockfile entries proven unused after the package becomes local.

### Preserve

- Historical database migrations.
- Terminal hosted task/history data and read-only adapter during retention.
- Rust public model provider proxy, auth, budgets, organizations, connector APIs.
- Sandboxed renderer and narrow `DesktopApi`.
- Current local tool registries/adapters and their boundary checks.
- The single TroCode Agent Harness's direct use of public `@openai/agents` primitives.
- OS computer permission checks, moved out of remote-backend permission-wait ownership.
- Connector rollout/canary configuration and authenticated connector execution.
- Root/API Railpack deployment and `services/api/railway.worker.json` ingestion-worker deployment.
- Provider dispatch/accounting evidence required for usage, budgets, and unknown-outcome audits.
- Historical PRP plans/reports and immutable migrations `031`/`032`.

---

## Testing Strategy

### Unit Tests

- Protocol schemas, version/digest/sequence enforcement, and sensitive-field filtering.
- Utility client request correlation, timeout, child exit, shutdown, and credential lifecycle.
- Deterministic graph/version hashing and one-agent topology.
- Host-backed SDK Session operations and optimistic revisions.
- Encrypted store validation, atomicity, corruption, re-encryption, and permissions.
- Invocation journal transitions/CAS/no-replay.
- Lifecycle state transitions and local/legacy history merge.
- Provider headers, no-retry, abort, auth refresh, and error redaction.

### Integration Tests

- Fake provider + real local runtime process + fake host tools.
- Real Electron-main protocol with fake utility transport.
- Rust public Responses/compaction endpoint with authenticated local turn reservation.
- Crash injection across every checkpoint/tool-result boundary.
- App restart with safe resumable turn, completed turn, and unknown invocation.

### End-to-End Tests

- Sign in -> submit -> streamed assistant text -> local tool -> final answer.
- Workspace task respects selected root and survives app relaunch.
- Connector task keeps credentials server-side.
- Network disconnect preserves local history and produces recoverable continuation state.
- Stop/Escape cancels turn without replay.
- Packaged app starts without a remote worker/service token.
- Legacy hosted terminal history remains readable.

### Non-Functional Tests

- Startup/first-delta latency against current hosted baseline.
- Delta flood/backpressure and memory bounds across multiple threads.
- Local state growth and compaction thresholds.
- Child crash loops and restart cap.
- macOS signing/notarization, Windows packaging/path, Linux permissions.
- Telemetry snapshot proves absence of prompt/output/tool/auth/RunState content.

---

## Validation Commands

Run at the end of each relevant gate, not only at final cutover:

~~~bash
npm run check
npm --prefix services/agent-runtime run check
npm run package
npm run bazel:check
~~~

Targeted discovery/retirement checks at Gate 10:

~~~bash
rg -n "TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN|TROCODE_BACKEND_AGENT_ENABLED|desktop-worker|claim.*lease|agent_orchestrator" src services docs README.md package.json forge.config.ts
rg -n "nodeIntegration:\s*true|contextIsolation:\s*false" src forge.config.ts
~~~

The first command should return only intentional legacy migration/history documentation or test fixtures after cutover. Every match must be reviewed, not blindly forced to zero.

---

## Acceptance Criteria

### Product

- [ ] A new desktop task starts and streams through the local utility process without a deployed Node worker.
- [ ] The backend starts in normal development without `TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN` or backend-agent enable/rollout/canary variables.
- [ ] Local tools execute directly through Electron main without Rust queue/poll round trips.
- [ ] New local task history and resumable state survive app restart under encrypted local storage.
- [ ] Network loss preserves local history and clearly pauses/fails inference without claiming offline model support.
- [ ] No “Bounded/Balanced/Strict” approval profile or approval-gate status is required by the local agent runtime.
- [ ] Cloud/background execution is absent or explicitly labeled future work; there is no hidden hosted fallback.

### Architecture

- [ ] Renderer remains sandboxed and receives only normalized shared events.
- [ ] Agents SDK runs in one supervised utility process, not renderer and not Electron main.
- [ ] The utility process contains one TroCode Agent Harness built directly around SDK `Agent`/`Runner`; there is no second TroCode planner/tool loop.
- [ ] Stable public SDK/Core features are adopted directly inside the harness, with boundary changes only when they cross into host, renderer, or provider transport.
- [ ] Startup advertises runtime capabilities and rejects graphs that require unsupported packaged SDK/provider features.
- [ ] Electron main owns encryption, lifecycle, invocation journal, and trusted tools.
- [ ] Rust owns user authentication, budget/provider dispatch, connectors, and optional legacy history—not local SDK RunState.
- [ ] Provider credentials and connector secrets never reach desktop storage or renderer.
- [ ] Protocol/SDK/graph/tool digests bind every resumable checkpoint.
- [ ] V1 graph contains exactly one root agent and zero handoffs/agents-as-tools.
- [ ] Agent lineage fields and deterministic graph registry allow a future graph expansion without changing the renderer/provider boundary.

### Reliability and Safety

- [ ] No automatic retry exists across SDK, OpenAI client, HTTP transport, or Rust provider for an uncertain dispatch.
- [ ] Every external-effect tool is durably checkpointed before dispatch.
- [ ] A crash after dispatch but before durable result becomes `unknown` and is never replayed automatically.
- [ ] Tool catalog, workspace, and graph stay frozen for a turn.
- [ ] Stop/Escape, deadlines, budgets, typed parsing, URL/workspace/OS boundaries remain enforced.
- [ ] Corrupt or future-version local state fails closed with recoverable diagnostics and no plaintext leakage.

### Migration and Operations

- [ ] Remote nonterminal runs are drained or explicitly terminated before hosted orchestration removal.
- [ ] Historical database migrations are untouched.
- [ ] Terminal hosted history remains read-only for the documented retention period.
- [ ] Packaged builds on supported targets include and launch the correct runtime artifact without global Node.
- [ ] `npm run check`, runtime checks, packaging, Rust/Bazel checks, crash matrix, and packaged smoke tests pass.
- [ ] Architecture/security/configuration/troubleshooting docs match the final topology.
- [ ] The dead-code audit report classifies every discovered hosted-runtime match and contains replacement/deletion/preservation evidence.
- [ ] No live import, route, script, build target, environment reader, deployment, or packaged resource depends on the removed hosted worker.
- [ ] OS permissions, connector rollout, provider accounting, ingestion worker deployment, legacy terminal history, and immutable migrations survive broad cleanup searches.
- [ ] Old orchestrator Doppler values are removed and the service token is revoked/rotated only after zero-consumer deployment proof.

---

## Risks and Mitigations

| Severity | Risk | Mitigation |
|---|---|---|
| Critical | App/process crash repeats a consequential tool whose result was not persisted | Checkpoint-before-effect, CAS invocation journal, `executing -> unknown`, no automatic replay, full crash matrix |
| High | Local encrypted file store corrupts or loses SDK state | Append-only checksummed frames, atomic verified snapshots, revision conflicts, quarantine, fault injection, future store adapter seam |
| High | Packaged utility process works in dev but is missing modules/paths after install | Deterministic staging, artifact verification, no cwd assumptions, packaged smoke on each OS |
| High | User token leaks through child env/log/error/state | Minimal message transfer after handshake, memory-only rotation/clear, redaction tests, no inherited environment, no token persistence |
| High | Local and hosted owners both act on the same run during migration | Drain gate, no automatic fallback, local-only IDs/ownership, release rollback rather than runtime dual-write |
| Medium | Agents SDK upgrade makes stored RunState incompatible | Bind SDK/graph/protocol digests, fail closed, explicit migration/new-turn path, compatibility fixtures |
| Medium | One utility process crash affects multiple threads | Per-turn isolation, supervised restart, durable host state, bounded concurrency, clear crash classification |
| Medium | Future multi-agent requirements force a new protocol | Stable agent IDs/lineage, deterministic registry, graph version, normalized events now; no premature handoff behavior |
| Medium | Remote connector flow still introduces latency/failure | Treat connectors as remote tools with authenticated direct APIs and explicit results, separate from agent-loop ownership |
| Medium | Local state grows indefinitely | Bounded event payloads, snapshots, compaction thresholds, retention/export/deletion documentation |

### Architecture Audit Findings Ordered by Severity

1. **Critical — remote worker owns a local product loop**: task submission, SDK RunState, and local tool continuation currently cross the network and require a separately deployed worker.
2. **High — private service token is required for normal local development**: the backend-agent enable path couples startup to an internal machine secret.
3. **High — local side effects are remote-brokered**: checkpoint durability is strong, but queue/poll/desktop-worker topology adds avoidable endpoint and unknown-outcome surfaces.
4. **High — local history is not locally authoritative**: offline history/resume and Codex-local semantics are impossible while Rust/PostgreSQL owns all new task state.
5. **Medium — current `TaskRuntime` is only a projection**: Electron main lacks a canonical local lifecycle owner despite already owning trusted tools.
6. **Positive invariant to retain**: current hosted work established graph/version binding, checkpoint-before-effect, frozen tools, no provider retry, and unknown-outcome no-replay. The migration must move these invariants, not discard them.

---

## Delivery and Rollback Strategy

1. Gates 1-6 may land behind a developer-only composition-root switch, but production tasks continue using exactly one owner at a time.
2. Gates 7-9 complete the local path and packaged evidence before cutover.
3. Gate 10 freezes new hosted runs, drains or explicitly terminates existing nonterminal runs, then releases local ownership and removes live hosted orchestration.
4. Operational rollback means reinstalling/rolling back the application and backend release as a coordinated version. It does not mean silently replaying a local thread in the cloud.
5. Never roll back local store schema destructively. Newer local state remains preserved even if an older app cannot open it.

---

## Future Multi-Agent Extension Contract

Multi-agent work may begin only after the single-agent local runtime is stable and an evaluated user need exists. The later phase should:

- add signed `AgentDefinition` entries and explicit allowed handoff edges;
- decide between native handoffs and manager agents-as-tools based on evals;
- cap handoff depth, parallelism, token/tool budgets, and total wall time;
- preserve one host invocation journal across all agents;
- show agent identity/lineage without exposing raw reasoning;
- never inherit tools automatically across a handoff;
- bump graph version and test old-thread behavior;
- keep cloud/runtime selection independent of agent topology.

This extension should not require changes to the renderer's basic normalized event envelope, Rust provider proxy, local encrypted store interface, or trusted tool adapters.

---

## Implementation Readiness Checklist

- [ ] Implementer understands that this uses OpenAI Agents SDK, not Codex SDK.
- [ ] Implementer understands that “local” means utility process + Electron-main tools/state, not renderer.
- [ ] Implementer has read both the historical local runtime and current hosted durability implementation.
- [ ] Protocol/graph/store ownership is agreed before code moves.
- [ ] Public model-turn accounting semantics are explicit and do not recreate remote SDK ownership.
- [ ] Every hosted tool adapter has a mapped local adapter before deletion.
- [ ] Crash matrix and packaged target matrix are part of each gate's definition of done.
- [ ] No user-facing approval-mode system is reintroduced.
- [ ] V1 ships one agent only; future multi-agent seams are metadata/abstractions, not behavior.
- [ ] The `.media` files already staged by the user remain untouched.

## Confidence

**8/10.** The repository contains both a historical local Agents SDK implementation and a newer, well-tested hosted durability implementation, so the component patterns are proven. The remaining uncertainty is concentrated in crash-safe encrypted local persistence, Electron utility-process packaging across all targets, and the exact public accounting contract needed for local model turns. The ordered gates make those risks independently testable before the hosted worker is removed.
