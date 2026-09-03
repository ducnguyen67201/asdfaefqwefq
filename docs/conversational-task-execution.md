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
for one structured, non-mutating decision. That decision contains one to eight
ordered steps whose targets must all be visible in the same observation. The
host validates the shared observation identity and maps every normalized center
point before presentation begins; the model never controls overlay dimensions.
`CursorBuddyController.presentSequence()` then glides only the virtual buddy and
its compact callout from target to target, reveals a fixed-size marker, and
speaks each bounded explanation through ElevenLabs (with system speech fallback).
The learner's real cursor is never moved by Coach.

There is no learner countdown, input-activity gate, intermediate observation, or
intermediate model call. Each narration completion releases the next short local
transition, and the buddy returns beside the learner's cursor only after the
sequence terminates. A site or application change requires a new learner request;
Tro does not reuse the old sequence or secretly poll the screen.

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
