# Conversational task execution

The composer creates a goal-driven local task. Tro starts it automatically
when the backend, workspace selection, and device worker are ready. The live
view exposes progress, activity, evidence-oriented outcomes, steering, and
Stop/Escape cancellation.

Registered tools run automatically. Tro asks the user only when a material
choice or required value is missing. A clarification answer continues the same
task and is applied at a safe model boundary.

Computer work may pause when Accessibility or Screen Recording is unavailable.
That card explains the operating-system access required and offers system
settings, refresh, continue-without-computer, or stop. Connector setup can
similarly require the provider's OAuth consent or reconnection.

Every adapter result is reported as confirmed, definite failure, not executed,
cancelled, denied by an external system, or unknown. Tro never claims success
without evidence and never automatically replays a tool invocation whose
completion is unknown.

`TaskApplicationService` resolves trusted Activity and workspace context once,
then a pure local router selects exactly one lane. Visible how-to and classroom
Help/Check requests use `CoachRuntime`; explicit mutations and trusted workspace
work use the Agents SDK runtime. The two lanes never run in parallel for one
request.

Coach captures the desktop once when the request needs visible context and asks
for one structured, non-mutating decision. The host validates the observation
identity and normalized center point, then constructs the fixed-size marker;
the model never controls overlay width or height. `CursorBuddyController` glides
only the virtual Cursor Buddy and its compact callout, reveals the marker, and
speaks bounded copy through ElevenLabs (with system speech fallback). The
learner's real cursor is never moved by Coach. The instruction stays mounted
while the learner works. Point grounding adds no repair or retry model call.
Coarse local input activity triggers one debounced fresh observation and one
next decision; idle, Repeat, Pause, and timer expiry make no model call and do
not poll screenshots. The new observation is authoritative, so a changed site
or application cannot reuse stale coordinates.

Heavy Agent has no teacher walkthrough prompt or `show_guidance` tool. It keeps
the existing SDK session, policy, approval, checkpoint, journal, budget,
cancellation, and uncertain-outcome protections for requests that ask Tro to
perform work.

Every transcript submitted from Voice Task mode carries an explicit
`screenContext: required` request policy. The router therefore starts Coach with
one required initial observation even when speech recognition produced an
imperfect transcript. Typed tasks retain the narrower `auto` policy, and an
explicit `disabled` policy prevents observation. Workspace execution remains in
Heavy Agent and does not inherit this desktop-observation grant.

Terminal v2/v3 task history remains visible as historical text. Removed legacy
approval interactions never expose active controls and cannot resume as v4.
