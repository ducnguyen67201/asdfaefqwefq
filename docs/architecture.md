# Tro agent architecture

Tro has one task entry point and two deliberately different runtimes. A pure
`TaskRequestRouter` selects `coach` for teaching/answers and `agent` for explicit
execution. `CoachRuntime` is non-mutating and presents one grounded step through
Cursor Buddy. Heavy Agent is the pinned OpenAI Agents SDK `Agent` and `Runner` in
a bundled Electron utility process. Electron main remains the trusted host for
both lanes; Rust authenticates, reserves budget, and proxies Responses.

## Execution path

```text
renderer -> parsed DesktopApi -> TaskApplicationService -> pure route
                                                   |-> CoachRuntime -> Cursor Buddy
                                                   `-> Agents SDK -> local adapters
Both model lanes ----------------------------------------------> Rust provider proxy
```

For each Heavy Agent turn, Electron freezes the exact currently available tool catalog and
binds it to SDK, graph, protocol, and CUA-driver digests. The SDK decides how to
fulfill the intent, chooses tools, consumes results, and detects completion.
SDK Session history and serialized `RunState` checkpoints are encrypted beneath
the app's local `agent-state` directory using operating-system encryption.
Context compaction uses the SDK's input-mode Responses compaction session through
the authenticated Rust proxy.

There is no action-policy or Tro approval branch. SDK approval interruptions are
used only to serialize state before dispatch and are resumed automatically.
A registered, schema-valid tool call runs when its executor is available.
Operating-system permissions and provider OAuth remain external technical consent
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

The cursor buddy and desktop pet are separate auxiliary windows. The desktop
pet rests, wanders, and can be dragged. It never acts as the teacher pointer.
The click-through Cursor Buddy follows the student's operating-system pointer
during normal use, then pins and glides independently during a teacher step.
The desktop-pet preference and customization flow affect only the pet;
disabling the pet does not disable Cursor Buddy.

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

`CursorBuddyController` is the single public owner of follow, immediate thinking
feedback, teaching glide, visual click, target highlight, compact callout,
narration, learner controls, and return-to-follow. It uses full-rate updates
only while the student's pointer is moving and low-frequency polling while
stationary. During guidance it stops sampling the student's pointer, so the
virtual buddy can move without moving or chasing the real cursor. macOS and
Linux move the small native buddy window directly. Windows uses a click-through
full-desktop overlay. One strict cursor snapshot carries phase and renderer-local
position across IPC. Pointer coordinates never enter logs, persistence,
analytics, task history, or network calls.

One Coach task is also one Cursor Buddy session. The controller owns the
session task id across step boundaries, keeps the buddy and compact callout at
the last grounded target while Coach evaluates learner evidence, and
glides directly from that anchor to the next target. A terminal, cancelled, or
failed task ends the session and returns the buddy beside the student's real
cursor. Observation-window restoration is tied to the same session identity so
an overlapping capture cannot resurrect stale coaching UI.

Teacher walkthrough motion belongs to Cursor Buddy presentation, not the model
or CUA. Coach returns one validated structured decision containing the semantic
target label, its normalized center point, and short copy; model output never
controls overlay dimensions. The host maps normalized image coordinates to
screenshot pixels and then desktop DIPs, then constructs a fixed-size,
display-clamped marker. Cursor Buddy and
its callout glide from one shared anchor, reveal the marker on arrival, perform
a visual-only click pulse, explain the reason aloud, and wait for the learner.
No native pointer or click command is dispatched. Operating-system Reduce
Motion snaps the virtual buddy and CSS provides static presentation cues.
`LearnerActionGate` waits for content-free pointer activity and captures only
after a debounce; idle, Replay, Pause, and the visible timer make no screen or
model request. The resulting fresh observation drives exactly one next Coach
decision. Coach screenshots, coordinates, and input activity are never persisted.
This point-only geometry requires no repair model request. Semantic element
bounds remain a future grounding source only after their platform-specific
screen units can be converted explicitly into Electron desktop DIPs.

Coach and Heavy Agent share `TaskRuntime`, `ActivityContext`, classroom authority,
encrypted task history, and the authenticated Responses accounting boundary.
Coach persists only bounded step number, expected outcome, and recap for the
exact owner + Attempt + Activity version. Heavy Agent keeps task-scoped SDK
sessions/checkpoints and has no `show_guidance` tool or walkthrough prompt loop.

Long-running task encouragement is a separate deterministic timer service. It
parses `TaskUpdate`, maps only explicit thinking/working/verifying phases to
curated bilingual copy, and uses the existing low-priority pet-nudge slot. It
does not inspect request text, model output, tools, screen contents, or desktop
activity. Clarifications, guidance, and responses keep their existing priority
over all pet nudges.

## Boundaries that remain

- The local host/utility protocol requires exact protocol, SDK, graph, and frozen
  tool-catalog digests. CUA calls additionally require the exact live driver
  catalog digest discovered when the turn was frozen.
- A turn's tool catalog is immutable. Recovery reconstructs the same SDK graph;
  the same durably checkpointed call can return a recorded result but is never
  dispatched twice.
- Authority contract v11 records the selected route and bounded Coach progress;
  legacy v10 history remains readable.
- The registry rejects unknown tools, operations, and malformed inputs. CUA
  tools are discovered from the driver's canonical `listToolsJson` contract and
  admitted independently through a versioned schema-dialect validator. Optional
  incompatibilities are quarantined; required incompatibilities make CUA
  unavailable before a task. A compatible new driver ability requires no Rust
  or static Tro tool-contract edit.
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
Tro reads CUA's canonical tool inventory and uses schema-2 `audience` metadata
to separate model tools from host tools. Session lifecycle and `set_config`
remain host-owned. Schema-2 model schemas carry an explicit dialect/version and
are never rewritten; supported tools flow through the generic `callTool`
adapter without a Tro allowlist, utility-protocol, or backend edit. Schema 1 is
a reported legacy compatibility adapter, not the forward contract.

Tro selects CUA's unrestricted host mode, so there is no Tro action-approval
decision in the CUA path. The driver still validates its own schemas and may
refuse capabilities its contract marks as unavailable in every mode. Operating-
system Accessibility and Screen Recording grants remain real prerequisites.

## Compatibility

New work starts only as a locally authoritative authority-v11 task. Terminal
hosted rows remain readable through `/v1/legacy-agent-history`, but no hosted
run can be started or resumed. A future cloud agent must implement a separate
runtime adapter and explicit product mode; it is never a hidden fallback.
