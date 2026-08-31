# Codex-Local OpenAI Agents SDK Runtime — Implementation Report

## Outcome

TroCode now uses one bundled local Node utility process as the sole live OpenAI Agents SDK reasoning loop for desktop tasks. Electron main owns trusted tools, encrypted local task state, recovery, and renderer projection. Rust remains the authenticated provider, budget, account, connector, and usage-accounting service; it no longer owns or leases the local agent loop.

The implementation deliberately exposes one root agent (`tro.root`). Stable agent identity, graph version, lineage fields, and normalized events preserve a future multi-agent extension seam, but handoffs and parallel agents are neither advertised nor activated in this release.

## Final topology

```text
sandboxed renderer
        |
        | narrow DesktopApi
        v
Electron main trusted host
  | encrypted local state + invocation journal
  | frozen dynamic tool catalog
  | trusted CUA/filesystem/terminal adapters
  v
bundled utility process
  OpenAI Agents SDK Agent + Runner
        |
        | authenticated Responses requests
        v
Rust public provider proxy
  auth + budgets + usage accounting
```

There is no hidden local-to-cloud agent fallback and no private orchestration service token in the normal desktop/backend startup path.

## Implemented architecture

### Local SDK process and protocol

- Added a typed, strict Zod JSON-lines protocol for handshake, credential rotation, turns, streamed events, tool interruptions, session checkpoints, cancellation, and steering.
- The protocol digest is derived from the complete JSON Schemas rather than a manually maintained version string.
- Credentials are sent only after a compatible handshake, are held in memory, and are cleared on sign-out.
- The runtime verifies protocol, SDK, graph, and tool-catalog compatibility before accepting a turn.
- The utility process reports only capabilities it implements: sessions, compaction, dynamic tools, durable checkpoints, steering, and cancellation.

Primary files:

- `services/agent-runtime/src/protocol.ts`
- `services/agent-runtime/src/local-runtime-server.ts`
- `services/agent-runtime/src/process-entry.ts`
- `services/agent-runtime/src/agent-graph.ts`
- `src/main/agent-runtime/agent-runtime-adapter.ts`

### Host-backed durability

- Added OS-encrypted, checksummed, length-prefixed local state frames with atomic snapshot replacement, file/directory durability, restrictive permissions, corruption quarantine, and bounded compaction.
- Session and checkpoint updates use revisions/CAS semantics.
- External tool execution writes a durable checkpoint and invocation record before dispatch.
- An invocation found in `executing` without a durable result becomes a terminal unknown outcome and is not replayed.
- Pre-dispatch cancellation is recorded separately and does not masquerade as an unknown effect.

Primary files:

- `src/main/agent-runtime/local-agent-state.ts`
- `src/main/agent-runtime/encrypted-agent-state-store.ts`
- `services/agent-runtime/src/host-backed-session.ts`

### Dynamic CUA discovery

- Replaced the hosted static tool catalog with a host-owned dynamic registry.
- CUA drivers self-describe their abilities; registration projects each driver ability into a strict model tool without editing a central contract.
- A catalog snapshot and digest are frozen for each turn so newly installed abilities affect later turns without mutating an active one.
- Tool requests still cross a strict host boundary and execute through `CuaService`; the model never receives raw Electron IPC or driver objects.

Primary files:

- `src/main/agent/runtime-tool-registry.ts`
- `src/main/agent/cua-driver-agent-tools.ts`
- `src/main/agent/execution-coordinator.ts`
- `src/main/cua/cua-service.ts`

### Lifecycle, history, and renderer

- Electron main now owns the local task lifecycle and streams normalized task events to the renderer.
- Stop, focused Escape, replacement, sign-out, shutdown, steering, input, restore, and runtime failure are explicit local paths.
- New history is locally authoritative and encrypted. Terminal hosted history is available only through a small read-only compatibility adapter.
- Removed the live Bounded/Balanced/Strict approval profile and old outcome/checklist/runtime-version branches.

Primary files:

- `src/main/agent/task-runtime.ts`
- `src/main/application/task-application-service.ts`
- `src/shared/task-lifecycle.ts`
- `src/main/history/composite-task-history-store.ts`
- `src/main/history/legacy-hosted-task-history-store.ts`

### Rust responsibility reduction

- Removed the live Rust agent/orchestrator modules, worker leasing, tool broker, private orchestration routes, backend-agent flags, rollout configuration, and service-token requirement.
- Kept authenticated public agent-turn reservation, Responses proxy, compact proxy, usage/budget accounting, accounts, organizations, connectors, voice, knowledge ingestion, and terminal legacy history.
- The normal Responses validator permits the bounded dynamic catalog; the compact validator accepts the SDK compact request shape without pretending it has normal tool/stream fields.

### Packaging and Bazel

- Forge compiles and stages the utility entry plus the production dependency closure.
- Packaging fails if the runtime entry or required `@openai/agents`, `openai`, or `zod` packages are absent.
- Webpack resolves the runtime package's ESM `.js` specifiers to TypeScript during the main-process build.
- Bazel inventories all runtime source/config files and builds that target alongside Rust clippy.

## Verification evidence

| Check | Result |
|---|---|
| `npm run check` | Passed |
| Runtime package lint/typecheck/tests | Passed: 4 files, 9 tests |
| Desktop/shared Vitest suite | Passed: 124 files, 794 tests |
| Rust unit tests | Passed: 69 tests |
| Rust compatibility/property suites without external services | Passed |
| Rust formatting and clippy (`-D warnings`) | Passed |
| `cargo audit` | Passed under repository policy with 3 allowed warnings |
| `npm run package` | Passed on macOS arm64 |
| Packaged runtime entry/dependency inspection | Passed |
| `npm run bazel:check` | Passed: 13 tests and both build targets |
| `git diff --check` | Passed before report generation |

The packaged application contains:

- `Resources/agent-runtime/dist/process-entry.js`
- `Resources/agent-runtime/node_modules/@openai/agents/package.json`
- `Resources/agent-runtime/node_modules/openai/package.json`
- `Resources/agent-runtime/node_modules/zod/package.json`

The review pass additionally verified that invalid turn preflight failures stay inside the runtime error boundary, duplicate thread creation cannot reset durable state or cross owners, legacy-history network failures cannot hide local history, and completed turns release sequence bookkeeping. The ponytail review removed unused health/event/status/capability surfaces and an unused runtime configuration abstraction.

The three allowed Rust audit warnings are the pre-existing `ttf-parser 0.25.1` unmaintained warning, `lru 0.16.4` soundness warning, and yanked `chacha20 0.10.1` warning.

Database/S3 integration tests were discovered but correctly ignored because this run did not provide disposable PostgreSQL 17 or S3-compatible test services. A real provider-backed CUA turn and packaged Windows/Linux smoke were not run on this macOS host; deterministic protocol, supervisor, dynamic registration, checkpoint, store, lifecycle, package-content, and route tests cover the implemented boundaries.

## Operational follow-up outside this code change

- Drain or explicitly terminate any nonterminal runs owned by the previously deployed hosted worker before deploying the cutover.
- Remove/revoke the old orchestration secret in Doppler only after the deployed environment proves zero consumers. No credential was read, printed, or changed during implementation.
- Run signed/package smoke tests on every supported release OS in the normal release pipeline.

## Scope preserved

- The renderer remains sandboxed and receives only narrow APIs.
- Local model inference still requires the networked Rust provider proxy; this is a local agent loop, not offline inference.
- Immutable migrations and schema inventory are retained so existing databases remain valid.
- Connector execution, voice, accounts, memberships, budgets, and the unrelated ingestion worker remain backend services.
- The user's staged `.media` files were not modified.
