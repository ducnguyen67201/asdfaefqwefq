# Tro agent architecture

Tro has one reasoning loop: the pinned OpenAI Agents SDK worker. The user sends
an intent directly to that worker; there is no separate Tro planner, outcome
compiler, approval policy, or Rust Responses loop. Rust is the trusted control
plane. It authenticates callers, owns leases and encrypted state, proxies OpenAI
with server-side credentials and budgets, and brokers every remote tool call.
Electron is a narrow device executor for CUA, workspace, terminal, application,
and browser capabilities.

## Execution path

```text
renderer -> public runtime v5 -> Rust control plane -> Agents SDK worker
                                      ^                    |
                                      | model/tool broker  |
                                      +--------------------+
                                      |
                           Electron CUA/local adapters
                           or Rust connector adapters
```

For each task, Rust freezes the exact currently available tool catalog on the
first compatible claim, stores it encrypted, and supplies that same catalog on
every recovery claim. The SDK decides how to fulfill the intent, chooses tools,
consumes their results, and decides when the task is finished. SDK Session
history and serialized `RunState` checkpoints are encrypted in PostgreSQL.
Context compaction uses the SDK's input-mode Responses compaction session through
the Rust model proxy.
The proxy records only a request digest and dispatch state before contacting
OpenAI. If the worker loses a response before its next durable SDK checkpoint,
the same model request is blocked as ambiguous instead of being sent again.

There is no action-policy or Tro approval branch. SDK approval interruptions are
used only to serialize state before dispatch and are resumed automatically.
A registered, schema-valid tool call runs when its executor is available.
macOS/Windows permissions and provider OAuth remain external technical consent
boundaries.

## Private companion assets

The renderer owns only the unsubmitted `File`, object URL, and prompt. Source
bytes and prompts never enter global renderer state, local storage, PostgreSQL,
analytics, or content-bearing logs. Electron main owns candidate expiry,
account-bound encryption, and exact private-protocol authorization. Settings
presents the bundled default and the encrypted saved library as one pet picker;
selecting an existing entry is local and does not dispatch another provider
request or consume generation quota.

## Desktop companion presentation

Electron main remains authoritative for the companion's lifecycle state,
absolute desktop position, and window behavior. The sandboxed companion
renderer receives only parsed state, appearance, nudge, position, and hover
projections through the narrow preload API. The bundled default duck renders a
fixed nine-row sprite atlas: the eight existing operational states select
distinct rows, while hover may replace only the idle row. Operational state
always wins over hover, and custom private companions continue to use their
single encrypted image plus CSS state cues.

Hover detection is an ephemeral main-process hit test. While the companion is
visible and idle, Electron samples the current DIP cursor point at 10 Hz,
compares it with the companion rectangle, and publishes only a boolean. The
point never crosses IPC and is not logged, persisted, analyzed, or sent over
the network. Wayland disables hover because Electron does not expose the
required cursor API there; lifecycle animation remains available.

Long-running task encouragement is a separate deterministic timer service. It
parses `TaskUpdate`, maps only explicit thinking/working/verifying phases to
curated bilingual copy, and uses the existing low-priority pet-nudge slot. It
does not inspect request text, model output, tools, screen contents, or desktop
activity. Clarifications, guidance, and responses keep their existing priority
over all pet nudges.

## Boundaries that remain

- Runtime v5 requires exact public protocol and Tro base-tool catalog digests;
  the private worker also requires its exact SDK and agent-graph versions. CUA
  calls additionally require the exact live driver-catalog digest advertised by
  the worker that accepted the task.
- A run's encrypted tool snapshot is immutable. Recovery reconstructs the same
  SDK graph even if Electron or a connector disconnects; a new call still needs
  a currently valid executor route, while the same durably queued call can be
  resumed by call ID without dispatching it twice.
- Authority contract v10 binds the intent, execution profile, trusted workspace,
  Activity context, and technical limits without prescribing a plan.
- The registry rejects unknown Tro tools, operations, and malformed inputs.
  CUA tools are discovered from the driver's canonical `listToolsJson` contract;
  the backend and desktop both reject names or schemas outside that snapshot.
- Browser navigation accepts credential-free public HTTPS targets only.
- Workspace filesystem operations remain root-confined. Workspace shell input
  is structurally bounded but intentionally has the host user's shell powers.
- A one-time compare-and-swap owns execution before an adapter is called.
- Tool invocations with an unknown outcome are blocked and never replayed
  automatically.
- Model and compaction request digests are also one-shot per run; provider
  responses are not cached or persisted.
- Stop/Escape, deadline, cost, model-sample, tool-call, and payload limits remain.

## CUA

CUA is an execution capability, not the planner and not an authority source.
Tro reads CUA's canonical tool inventory, removes only driver session start/end
because the host owns task cleanup, injects the current task session into tools
that declare a `session` property, and forwards every other compatible tool
through the driver's generic `callTool` adapter. New tools using tool-list schema
version 1 therefore need no Tro allowlist or backend contract edit.

Tro selects CUA's unrestricted host mode, so there is no Tro action-approval
decision in the CUA path. The driver still validates its own schemas and may
refuse capabilities its contract marks as unavailable in every mode. Operating-
system Accessibility and Screen Recording grants remain real prerequisites.

## Compatibility

New work starts only on runtime v5 with authority v10 and
`orchestrator_kind = 'openai_agents_sdk'`. Runtime v4 endpoints are read-only.
Terminal v2-v4/v6-v9 rows remain readable as legacy history but cannot be
started or resumed.
