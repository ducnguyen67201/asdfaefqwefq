# Implementation Report: OpenAI Agents SDK as the Sole Orchestrator

## Summary

Tro now has one cognitive runtime: the backend OpenAI Agents SDK worker. The SDK's
`Agent` and `Runner` receive the user's intent, use the current run's tool catalog,
carry session context, compact history, continue after tool results, and decide
when to return a final answer. The previous handwritten Rust Responses
planner/executor, keyword outcome compiler, completion verifier, effect classifier,
and action-approval policy are no longer in the active v5 execution path.

Rust remains the durable control plane. It authenticates users and the private SDK
worker, owns task lifecycle and spend, encrypts session and checkpoint state,
proxies model and compaction calls without giving the worker an OpenAI credential,
validates the live tool catalog and schemas, and commits every tool execution and
result exactly once. Electron remains a sandboxed device adapter for CUA and other
host tools. It does not plan, grant authority, or expose raw IPC/CUA to the
renderer.

This delivers the intended topology:

```text
Electron app <-> Rust durable control plane <-> OpenAI Agents SDK <-> model
      |                    |
      +---- CUA/tools <----+---- exact catalog, queue, and result boundary
```

## Tasks Completed

| Area | Status | Result |
|---|---|---|
| Sole reasoning loop | Complete | One Agents SDK `Runner` owns reasoning, implicit planning, tool selection, continuation, and final-output detection. |
| SDK service | Complete | A separately deployable Node 24 service uses exact `@openai/agents` 0.17.0, `openai` 7.8.0, and `zod` 4.4.3 pins. |
| Durable SDK state | Complete | Rust-backed SDK sessions, idempotent history transactions, input-mode compaction, serialized `RunState`, and graph/SDK version binding support pause and resume. |
| Rust control plane | Complete | `AgentOrchestrator`, `RunStore`, `SessionStore`, `ToolBroker`, and `ModelDispatchStore` separate orchestration transport, persistence, tool dispatch, and model no-replay responsibilities. |
| Model boundary | Complete | The SDK calls an OpenAI-compatible private Rust broker with zero client retries; Rust retains credentials, budget reservation, settlement, and ambiguous-dispatch handling. |
| Dynamic tool discovery | Complete | The live CUA `listToolsJson()` catalog becomes deferred SDK namespaces/tools; compatible future CUA operations require no central static allowlist edit. |
| Contextual static tools | Complete | Tro-owned application, browser, workspace, activity, and knowledge adapters remain typed; only tools valid for the trusted run context are advertised and accepted. |
| Tool durability | Complete | SDK interruptions are automatic internal checkpoints, not user approvals. Rust validates and queues the exact call ID, Electron/connector execution uses CAS, and unknown results stop replay. |
| Public/private protocols | Complete | Public runtime v5, authority v10, and private orchestrator v1 are generated, digested, cross-language tested, and fail on unknown fields. |
| Desktop cutover | Complete | New starts use v5; v4 starts are disabled; terminal v2-v4 history remains readable but cannot execute. |
| User interaction | Complete | User approval/effect/consequence gates are absent from the active path. User pauses are limited to explicit missing input plus OS/provider-controlled permissions or authentication. |
| Operations | Complete | Health, worker registration/heartbeat, version checks, environment examples, deployment documentation, and migration inventory include the SDK service. |
| Legacy cleanup | Complete | Active Rust planning/outcome code and obsolete configuration were removed instead of retained as a fallback runtime. |

## Delivered Architecture and Ownership

| Concern | Owner after this change |
|---|---|
| Understand the request, plan, choose tools, replan, finish | OpenAI Agents SDK |
| Conversation history and context compaction | Agents SDK over encrypted Rust session storage |
| User/device auth, membership, budgets, deadlines, cancellation | Rust API |
| Provider credential and model dispatch accounting | Rust API |
| Tool inventory truth | Current Electron/CUA/connector executor |
| Catalog/schema/context validation and exactly-once queue | Rust API |
| CUA, application, browser, terminal, filesystem execution | Electron main process |
| Renderer projection | Sandboxed Electron renderer through narrow `DesktopApi` |

The tool catalog is a capability description, not a policy engine. Tro asks the
current executor what it can do, filters only by factual run prerequisites such as
whether a workspace or Activity context exists, and supplies that catalog to the
SDK. The SDK decides which available capability helps fulfill the intent.

## Correctness and Review Fixes

The implementation review found and fixed the following issues before delivery:

- Static desktop capability advertisement originally depended too heavily on the
  active registry context. The registry now exposes installed tools separately,
  and the backend applies authority-v10 context rules consistently.
- The Rust broker originally trusted the static base catalog too broadly. It now
  revalidates every static call against compatible live desktop capabilities and
  validates dynamic CUA calls against the exact live digest and schema.
- Steering idempotency was incomplete. Migration 031 now binds steering events to
  `agent_turn_id` with a unique partial index; an identical retry returns the same
  event, while conflicting content or reuse of the task-start turn ID fails.
- A partial handwritten JSON-schema validator could miss constraints. Tool
  arguments now use the full `jsonschema` validator generated from the canonical
  contracts, including bounds and nested rules.
- A validated result-processing error after desktop dispatch could have been
  reported as a recoverable failure. The entire post-CAS execution/result boundary
  now becomes `unknown` on exception, preserving no-replay semantics.
- The v10 tool-call limit was present in durable authority but not independently
  enforced at the queue. `ToolBroker` now counts committed call IDs under the run
  lock, preserves idempotent replays, and rejects calls beyond the server-owned
  limit.
- A stale cancellation response could leave an active v5 run uncancelled. The
  desktop now refreshes and retries with one command identity, while the legacy
  unversioned cancellation path cannot mutate v5 runs.
- Dynamic CUA calls were absent from the static catalog used to validate an OS
  permission wait. The backend now recognizes their explicit Accessibility and
  Screen Recording prerequisites and durably records the same permission flow.
- A connector request committed immediately before process exit could remain
  `requested` indefinitely. Orchestrator maintenance now revalidates its stored
  route, claims it durably before dispatch, and preserves unknown-on-crash
  no-replay behavior.
- Steering accepted while the model was producing a final answer could previously
  race run completion. Completion now locks the run, verifies the SDK checkpoint's
  applied steering cursor, and refuses to commit while newer steering exists. The
  worker then starts a fresh SDK turn from the same durable session; terminal
  checkpoints are also recoverable after a worker restart without attempting an
  SDK-forbidden terminal-state resume. A reclaimed worker first rebinds that
  terminal checkpoint to its new lease version, so the Rust completion CAS can
  verify the recovered result without accepting an older worker's authority.
- Successful computer observations were cached by Electron but reduced to a
  fixed summary at the SDK boundary. Observation IDs, semantic state, coordinate
  space, and text now travel in the encrypted tool result, while screenshots are
  emitted as the Agents SDK's structured image output. The authenticated result
  endpoint and router share a total serialized-result ceiling; Electron compacts
  oversized extensible data while preserving grounding identifiers and semantic
  controls, so valid detailed screenshots are not rejected after execution begins.
- Identical session mutations at later revisions could collide with an earlier
  idempotency key and regress the SDK session cursor. Mutation identities now
  include their starting revision while remaining stable for transport retries.
- Cancelling an unanswered `task.interaction` was treated like an ambiguous
  external side effect. Clarification waits now cancel deterministically; only
  genuinely dispatched desktop actions retain unknown-on-interruption behavior.
- The SDK compatibility proof was test scaffolding accidentally compiled into the
  service. It now lives under the test tree, production build output is ignored,
  and CI installs, audits, tests, and builds the independently pinned SDK package.
- Active CUA semantic types, version reporting, model allowlist checks, compaction
  defaults, and obsolete environment/config fields were aligned with the v5 path.

## Data and Compatibility

`031_agents_sdk_orchestrator.sql` adds SDK worker registration, session mutation
idempotency, versioned checkpoints, model-dispatch no-replay state, orchestration
metadata, and steering-turn uniqueness. It is additive and does not edit migration
29 or 30. Existing terminal history and its legacy schemas remain read-only for UI
projection; no new v5 run writes legacy outcome/effect/approval data.

CUA task-session lifecycle operations remain host-owned and injected because the
host must bind a tool call to the exact durable task session. All other compatible
driver tools discovered from the live CUA catalog flow through generically.

## Validation Results

| Check | Result |
|---|---|
| `npm run check` | Pass — protocol generation/drift, SDK check, admin build, ESLint, TypeScript, 120 Vitest files / 788 tests, Rust fmt/clippy/tests |
| Agents SDK service | Pass — lint, typecheck, 4 test files / 12 tests |
| Disposable PostgreSQL integrations | Pass — v5 HTTP/start/cancel compatibility, clarification cancellation, claim/checkpoint/tool/result/complete flow, durable observation visuals, limits, dynamic CUA permission waits, connector restart recovery, contextual-tool rejection, steering retry/conflict behavior, late-steering/completion serialization, and terminal-checkpoint rebind after lease rollover |
| `npm run bazel:check` | Pass — 16 Bazel tests plus Rust clippy target |
| `npm run package` | Pass — Electron Forge macOS arm64 package |
| `git diff --check` | Pass |
| `cargo audit` inside `npm run check` | No unallowed vulnerability failure; three documented upstream warnings remain |

The upstream audit warnings are `ttf-parser` 0.25.1 (unmaintained), `lru` 0.16.4
(unsound advisory through the compatible dependency graph), and `chacha20` 0.10.1
(yanked). They are pre-existing dependency-chain release considerations, not hidden
or blanket-ignored by this change.

## Deviations and Deliberate Constraints

- The implementation uses one manager agent and no specialist handoffs. This keeps
  ownership unambiguous; SDK handoffs can be added later only if evaluations show a
  real benefit.
- Model transport is deliberately brokered through Rust rather than giving the SDK
  worker a provider key. This preserves durable spend and no-replay semantics.
- Every remote tool uses the SDK approval interruption primitive only as a durable
  serialization checkpoint. Tro automatically resumes it after Rust accepts the
  exact call; there is no approval UI or consequence decision.
- Technical capability and integrity checks remain: authenticated identity, exact
  schema/catalog/version, current workspace/activity context, OS permissions,
  budgets/deadlines, one-time execution ownership, and unknown-result blocking.
  These do not reinterpret the user's goal or restrict the SDK to a Tro-authored
  plan.

## Principal Files

| File/group | Purpose |
|---|---|
| `services/agent-runtime/` | Agents SDK worker, agent graph, dynamic tool adapter, Rust session, compaction, and private control-plane client. |
| `services/api/src/agent/orchestrator.rs` | Private orchestrator service coordinating durable SDK turns. |
| `services/api/src/agent/{run_store,session_store,tool_broker,model_dispatch_store}.rs` | Focused persistence and execution-boundary classes. |
| `services/api/src/http/agent_orchestrator.rs` | Authenticated private orchestrator and OpenAI-compatible broker routes. |
| `services/api/migrations/031_agents_sdk_orchestrator.sql` | Additive SDK orchestration, no-replay, checkpoint, and idempotency state. |
| `src/main/hosted/desktop-tool-worker.ts` | v5 desktop worker with live catalogs, CAS execution, and unknown-result handling. |
| `src/main/cua/cua-service.ts` | Live CUA discovery and generic dispatch. |
| `src/shared/agent-runtime-protocol.ts` | Public v5, authority v10, and legacy history parsing. |
| `protocol/agent-orchestrator.v1.*` | Generated private SDK-worker contract and digest. |
| `protocol/agent-runtime.v5.*` | Generated public v5 contract, base tool catalog, and digest. |

## Follow-up

- Deploy the API migration and SDK worker through the documented drain sequence;
  startup version checks intentionally fail closed if the worker/API graph or SDK
  versions differ.
- Run a staged live CUA intent against the production-equivalent OpenAI broker and
  observe lease recovery, tool-result continuation, compaction, and final output
  before widening rollout.
- Track the three upstream Rust dependency warnings as release maintenance items.
