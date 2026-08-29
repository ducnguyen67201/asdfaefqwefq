# Tro agent architecture

Tro uses one backend-owned planner/executor loop and a narrow Electron device
adapter. The user supplies a goal. Rust owns the authority contract, model
continuation, lifecycle, budgets, durable tool requests, evidence, and outcome
verification. Electron owns local handles such as CUA, workspace files, shell
processes, application launch, and browser navigation.

## Execution path

```text
goal -> plan -> advertised typed tool call -> schema and target validation
     -> OS/OAuth prerequisite -> requested-to-executing CAS
     -> adapter call -> bounded result/evidence -> verify -> replan or finish
```

There is no action-policy or Tro approval branch in this path. A registered,
schema-valid tool call runs automatically when its technical prerequisites are
ready. Clarification is reserved for a material missing choice. macOS/Windows
permissions and provider OAuth remain external consent boundaries.

## Boundaries that remain

- Runtime v4 requires exact protocol and Tro base-tool catalog digests. CUA
  calls additionally require the exact live driver-catalog digest advertised by
  the worker that accepted the task.
- Authority contract v9 binds the task, execution profile, trusted workspace,
  Activity context, outcome criteria, and limits.
- The registry rejects unknown Tro tools, operations, and malformed inputs.
  CUA tools are discovered from the driver's canonical `listToolsJson` contract;
  the backend and desktop both reject names or schemas outside that snapshot.
- Browser navigation accepts credential-free public HTTPS targets only.
- Workspace filesystem operations remain root-confined. Workspace shell input
  is structurally bounded but intentionally has the host user's shell powers.
- Visual actions require a current observation and re-observation after change.
- A one-time compare-and-swap owns execution before an adapter is called.
- Tool invocations with an unknown outcome are blocked and never replayed
  automatically.
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

New work starts only on runtime v4 with authority v9. Terminal v2/v3 rows remain
readable through the legacy history endpoint. Their removed lifecycle and
authority projections are stripped before presentation, and an old
`awaiting_approval` state is shown as terminal blocked history with no controls.
