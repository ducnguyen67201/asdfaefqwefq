# Tro agent architecture

Tro has one reasoning loop: a pinned OpenAI Agents SDK `Agent` and `Runner` in a
bundled Electron utility process. The TroCode harness around that SDK contains
instructions, deterministic agent definitions, SDK sessions, normal SDK tool
callbacks, and event normalization. Electron main is the trusted local host; it
supervises the utility process, encrypts local thread state, journals external
effects, and executes local tools. Rust authenticates the user, reserves budget,
and proxies Responses with server-side provider credentials. It does not own the
local agent loop or SDK state.

## Execution path

```text
renderer -> parsed DesktopApi -> Electron main -> bundled Agents SDK process
                                  |       ^                  |
                                  | tools |                  | Responses
                                  v       |                  v
                           local adapters +----------> Rust provider proxy
```

For each turn, Electron freezes the exact currently available tool catalog and
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

The cursor buddy and desktop pet are separate auxiliary windows. The fixed,
click-through cursor buddy follows the real operating-system pointer and
therefore follows CUA-performed pointer movement. The desktop pet rests,
wanders, can be dragged, and may move near task-guidance targets. The desktop-
pet preference and customization flow affect only the pet; disabling the pet
does not disable the cursor buddy.

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

The cursor buddy uses a bounded main-process tracker with full-rate updates
only while the pointer is moving and low-frequency polling while stationary.
macOS and Linux move the small native buddy window directly. Windows uses a
click-through full-desktop overlay and sends only the parsed overlay-local buddy
position to its sandboxed renderer. Neither pointer coordinates nor buddy
positions enter logs, persistence, analytics, task history, or network calls.

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
- Authority contract v10 binds the intent, execution profile, trusted workspace,
  Activity context, and technical limits without prescribing a plan.
- The registry rejects unknown tools, operations, and malformed inputs. CUA
  tools are discovered from the driver's canonical `listToolsJson` contract and
  projected dynamically into the frozen local catalog, so a compatible new
  driver ability requires no Rust or static Tro tool-contract edit.
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
version 1 therefore need no Tro allowlist, utility-protocol, or backend edit.

Tro selects CUA's unrestricted host mode, so there is no Tro action-approval
decision in the CUA path. The driver still validates its own schemas and may
refuse capabilities its contract marks as unavailable in every mode. Operating-
system Accessibility and Screen Recording grants remain real prerequisites.

## Compatibility

New work starts only as a locally authoritative authority-v10 task. Terminal
hosted rows remain readable through `/v1/legacy-agent-history`, but no hosted
run can be started or resumed. A future cloud agent must implement a separate
runtime adapter and explicit product mode; it is never a hidden fallback.
