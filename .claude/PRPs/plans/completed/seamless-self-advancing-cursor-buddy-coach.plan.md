# Seamless Self-Advancing Cursor Buddy Coach

## Summary

Turn the existing safe walkthrough into a continuous, low-latency teaching
session. One spoken or typed visible-task request starts one OpenAI Agents SDK
turn. Tro observes the current screen, asks the model for exactly one grounded
teaching step, and lets `CursorBuddyController` glide, highlight, and narrate
that step. The learner performs the real action. The local learner gate then
captures a stable fresh observation and returns that same observation to the
SDK as the evidence for the next decision. The model either corrects the
learner, presents the next single step, or completes with a short recap.

Do not generate or persist an up-front array of 11 steps. Do not require a new
voice request, message, or screenshot after every step. Do not move or click
the learner's operating-system cursor.

This plan builds on the uncommitted walkthrough and unified Cursor Buddy work
already present in the current worktree. Preserve that work and all unrelated
staged `.media/` and `.tours/` changes.

## Product Outcome

### Before

1. A visible how-to request enters walkthrough mode and captures the first
   screen correctly.
2. The model chooses one `show_guidance` step.
3. Cursor Buddy teaches and waits while `LearnerActionGate` polls for a stable
   screen change.
4. The gate returns only a fingerprint. The model then requests a second fresh
   `observe_context` capture before it can choose the next step.
5. Cursor Buddy cleans up and returns to the real cursor between steps, so the
   transition can feel like separate answers rather than one continuous coach.
6. The normal successful path therefore pays for an avoidable observation and
   an avoidable model decision boundary on every step.

### After

1. Releasing the voice shortcut immediately shows local “looking at your
   work” feedback; no LLM or TTS request is needed for this loading state.
2. The first model-selected step is grounded in the forced initial desktop
   observation.
3. Cursor Buddy stays a visual overlay, glides independently, speaks a short
   hook plus one action and one reason, and leaves the real cursor free for the
   learner.
4. After the learner acts, the stable observation already captured by
   `LearnerActionGate` becomes the trusted next observation in the tool result.
5. The next model sample sees the previous expected outcome and the new image.
   It chooses one of three outcomes: correction/recovery, one next grounded
   step, or `WALKTHROUGH_COMPLETE` with a short recap.
6. Cursor Buddy shows a small local “checking” state at its current teaching
   position while that decision is being made, then glides directly to the
   next target. It returns to follow mode only when the session completes,
   fails, is cancelled, or loses the ability to continue safely.
7. Older screenshots are removed from model input while the latest grounded
   image and bounded text history remain, preventing vision context from
   growing with every step.

## Architecture Decision

Use one durable SDK turn and one host-owned companion session:

```text
voice shortcut / typed request
        |
        v
TaskApplicationService selects walkthrough mode
        |
        v
one Agents SDK Runner + encrypted Session/RunState
        |
        v
forced observe_context -> latest DesktopObservation
        |
        v
model decision -> one show_guidance call
        |
        v
CursorBuddyController: glide -> highlight -> ElevenLabs -> wait
        |
        v
LearnerActionGate: stable fresh DesktopObservation
        |
        +---- changed + evidence ----> same show_guidance tool result
        |                               (text metadata + latest image)
        |                                      |
        |                                      v
        |                              next model decision
        |                         / correction | next step | complete
        |
        +---- explicit confirm / timeout / capture failure
                                               |
                                               v
                                  normal observe_context recovery path
```

The model is called only at reasoning boundaries. Cursor motion, loading,
highlighting, voice playback, replay, pause/resume, screen-change polling, and
the checking transition remain local deterministic code.

For `S` successful teaching steps, the steady-state target is approximately one
model decision per step transition rather than an observation-request model
call plus a step-selection model call. Complexity remains `O(S)`, not `O(S²)`.
The model-input filter must keep only the newest screenshot so accumulated
vision input also remains bounded; the existing SDK compaction session continues
to handle long text history.

## Existing Behavior to Preserve

- One OpenAI Agents SDK `Agent` and `Runner` are the sole reasoning loop.
- The required first tool is a desktop `observe_context` for walkthrough mode.
- Every `show_guidance` target references the latest trusted observation ID.
- Normalized coordinates are converted once at the trusted host boundary:
  normalized image space -> screenshot pixels -> desktop DIPs.
- `show_guidance` is non-mutating and never dispatches CUA `point`, click, or
  typing.
- `CursorBuddyController` is the only public owner of companion motion,
  highlight, callout, narration, learner controls, and follow behavior.
- The renderer stays sandboxed and receives only strict parsed projections via
  `DesktopApi` / `troCompanion`.
- Tool effects are checkpointed before dispatch and an unknown outcome is never
  replayed.
- A screen fingerprint only detects that something changed. The model must
  compare the fresh image with `expectedOutcome`; local code must not claim
  semantic success.
- Explicit requests for a written answer or complete list remain normal text
  tasks. Guided mode remains for requests tied to a visible concrete task.

## Mandatory Reading Before Implementation

| Area | File and anchor | Why |
|---|---|---|
| Repository invariants | `AGENTS.md` | Renderer sandboxing, strict boundaries, pure policy, no unknown replay, required verification. |
| Runtime architecture | `docs/architecture.md:1-34`, `docs/architecture.md:71-91` | One SDK loop, host/tool split, Cursor Buddy ownership, coordinate and no-click guarantees. |
| Walkthrough product contract | `docs/conversational-task-execution.md:22-34` | Current observe/show alternation and encrypted checkpoint behavior. |
| Voice entry | `src/renderer/voice-route.ts:10-16`, `src/renderer/App.tsx:1906-1923`, `src/renderer/App.tsx:2030-2055` | Global/local Task voice goes through the same `submitTask` path and must not require a second message. |
| Task bootstrap | `src/main/application/task-application-service.ts:101-144` | Walkthrough intent, persistence-before-start, and forced first observation. |
| Pure walkthrough policy | `services/agent-runtime/src/walkthrough-runtime.ts:95-202` | Current state schema, tool sequencing, prompt injection, output guard, and completion sentinel. |
| SDK turn loop | `services/agent-runtime/src/local-runtime-server.ts:190-380` | Model-run loop, result callback, durable checkpoint, interruption approval, and completion correction. |
| Model input/session | `services/agent-runtime/src/agent-graph.ts:40-98`, `services/agent-runtime/src/host-backed-session.ts:42-147` | Existing SDK Session, compaction, and safe place to filter stale images without creating another agent. |
| Tool result encoding | `services/agent-runtime/src/tool-adapter.ts:77-173` | Tool results already support bounded text plus one high-detail image. |
| Guidance tool boundary | `src/main/agent/runtime-tool-registry.ts:695-808` | Strict one-step schema, stale observation rejection, and coordinate conversion. |
| Trusted execution | `src/main/agent/execution-coordinator.ts:112-170`, `src/main/agent/execution-coordinator.ts:248-271` | Observation execution and current guidance evidence result. |
| Host result normalization | `src/main/agent-runtime/agent-runtime-adapter.ts:786-846` | An observation on any tool result already updates `latestObservation` and becomes model text plus image. |
| Learner detection | `src/main/presentation/learner-action-gate.ts:32-113` | Current 1.5-second cadence, two stable samples, and fingerprint-only outcome. |
| Companion state machine | `src/main/companion/cursor-buddy-controller.ts:127-183`, `src/main/companion/cursor-buddy-controller.ts:185-378` | Local thinking, full teaching sequence, cleanup, and current return-to-cursor behavior. |
| Main composition root | `src/index.ts:406-498`, `src/index.ts:677-719`, `src/index.ts:1832-1878` | Dependency injection, observation overlay guard, task terminal presentation, and session cleanup point. |
| Renderer contracts | `src/shared/contracts.ts:1744-1794`, `src/shared/contracts.ts:1850-1870`, `src/renderer/CursorBuddy.tsx:21-60`, `src/renderer/GuidanceCallout.tsx:73-143` | Add checking state without exposing screen contents or native APIs. |
| Existing regressions | `services/agent-runtime/test/walkthrough-runtime.test.ts:65-151`, `src/main/presentation/learner-action-gate.test.ts:7-78`, `src/main/companion/cursor-buddy-controller.test.ts:92-161` | Extend the current test language and timing conventions. |
| Previous implementation reports | `.claude/PRPs/reports/primary-school-coach-walkthrough-report.md`, `.claude/PRPs/reports/unified-cursor-buddy-coach-report.md` | Do not rebuild completed functionality or reintroduce removed native cursor movement. |

`docs/CODEX-NAVIGATION-GUIDE.md` is referenced by the repository supplement but
is not present in this worktree. Continue using the concrete ownership evidence
above; do not invent its contents.

## Discovery Summary

| Question | Current answer | Planning consequence |
|---|---|---|
| Does voice start a different agent? | No. `handleVoiceTranscriptReady` calls the same `sendInput` / `submitTask` route. | Keep one task entry path; do not add a voice-specific agent. |
| Is there already a loading cursor? | Yes. `CursorBuddyController.handleActivity` and `handleWorkState` publish local `thinking`. | Preserve and test release-to-thinking latency; do not call ElevenLabs or the model for loading copy. |
| Does the model generate all lesson steps? | No. The host enforces observe -> one `show_guidance` -> observe. | Keep incremental planning and never introduce a lesson array. |
| What makes the next step slow? | The learner gate captures stable changes but discards the actual observation, so the SDK performs another observation cycle. | Return the stable observation through the existing guidance tool result. |
| Can a guidance result carry an image? | Yes. `ToolExecutionResult.observation` is normalized into model metadata plus `imageDataUrl`. | Reuse existing result plumbing; no new model tool or raw IPC is needed. |
| Why does Cursor Buddy feel discontinuous? | `presentStep` always hides the callout and returns to the user's cursor in `finally`. | Add a task-scoped checking/transition state and return only at terminal session boundaries. |
| Is screen equality enough to claim success? | No. Fingerprints only detect stable change; the model has the semantic expected outcome. | The model remains the verifier after receiving the fresh image. |
| What prevents history cost growth? | SDK compaction starts at 80 items, but earlier images can remain in input before compaction. | Add a pure walkthrough-only input filter retaining only the latest image. |
| Is restart state durable? | Yes. `walkthroughState` and serialized SDK `RunState` are encrypted in the checkpoint. | Preserve the existing wire shape where possible; do not add a second session store. |
| Does guidance move the real pointer? | No. It maps coordinates for the overlay and never calls CUA control. | Add a regression test across the optimized evidence path. |

No external research is required. The change uses existing internal SDK, CUA,
Electron, TTS, and persistence patterns; no new or unstable third-party API is
introduced.

## Concrete Patterns to Mirror

The implementation should extend these exact patterns rather than add parallel
systems.

### Force the first observation through the existing SDK tool surface

From `src/main/application/task-application-service.ts:127-140`:

```ts
requiredInitialTool: {
  modelName: 'observe_context',
  arguments: {
    operation: 'observe',
    scope: walkthroughState.enabled ? 'desktop' : 'auto',
    reason: walkthroughState.enabled
      ? 'Ground the first teacher walkthrough step in the desktop.'
      : 'Ground the response in the current visible context.',
    query: null,
    observationId: null,
    region: null,
  },
},
```

Keep this bootstrap. The optimization begins after a learner has acted; it must
not create an unjournaled host-side shortcut around the SDK.

### Advance pure walkthrough state from trusted tool results

From `services/agent-runtime/src/local-runtime-server.ts:224-245`:

```ts
onToolResult: (modelName, result) => {
  const learnerActivity =
    result.data &&
    typeof result.data.learnerActivity === 'string' &&
    ['changed', 'confirmed', 'timed_out'].includes(result.data.learnerActivity)
      ? result.data.learnerActivity
      : undefined;
  walkthroughState = advanceWalkthrough(
    walkthroughState,
    modelName,
    result.status,
    learnerActivity,
  );
},
```

Replace the loose inline extraction with one parser and one transition event;
also derive `hasFreshObservation` from parsed result data/image presence.

### Reuse the generic observation-bearing result path

From `src/main/agent-runtime/agent-runtime-adapter.ts:786-846`:

```ts
export function executionContextAfterToolResult(
  context: GroundedToolExecutionContext,
  result: ToolExecutionResult,
): GroundedToolExecutionContext {
  return result.observation
    ? { ...context, latestObservation: result.observation }
    : context;
}

const observationImageDataUrl = result.observation?.screenshot
  ? `data:${result.observation.screenshot.mimeType};base64,${result.observation.screenshot.dataBase64}`
  : null;
```

The guidance adapter should return `observation`; it should not invent a second
transport for the screenshot or expose it to renderer IPC.

### Keep thinking and checking local to Cursor Buddy

From `src/main/companion/cursor-buddy-controller.ts:147-170`:

```ts
private showThinking(language: AppLanguage): void {
  this.clearFollowTimer();
  this.publish('thinking', true);
  if (!this.dependencies.canShowThinking()) return;
  // Build and show bounded local copy near the current virtual cursor.
}
```

Implement checking through the same controller/dependency seam. It must not be
a model tool, another BrowserWindow type, or another narration service.

### Preserve one SDK Session with existing compaction

From `services/agent-runtime/src/agent-graph.ts:88-96`:

```ts
const session = new OpenAIResponsesCompactionSession({
  client: clients.openai,
  compactionMode: 'input',
  model: input.model as never,
  shouldTriggerCompaction: ({ sessionItems }) =>
    sessionItems.length >= this.compactionItemThreshold,
  underlyingSession: new AtomicCompactionDelegate(underlying),
});
```

Filter stale walkthrough images in the per-request input view. Do not replace
this durable SDK session or mutate its canonical history outside its existing
atomic transaction contract.

## Target State and Transition Rules

Retain the current serialized `WalkthroughState` shape unless implementation
proves it impossible. Interpret it with these deterministic rules:

| Current state / result | Next state | Model may do next |
|---|---|---|
| Initial `needs_observation` + successful `observe_context` | `needs_guidance` | Exactly one first `show_guidance`; completion is not allowed because no teaching step has been presented. |
| `needs_guidance` + `show_guidance` returns `changed` with a fresh observation | `needs_guidance`, increment presented count | Use the attached latest image to issue one correction/next `show_guidance`, optionally re-observe if ambiguous, or return the bounded completion sentinel. |
| `needs_guidance` + explicit learner confirmation without observation | `needs_observation`, increment presented count | Observe before asserting success or choosing the next target. |
| `needs_guidance` + timeout or observation failure | `needs_observation`, do not count verified progress | Re-observe and recover; never continue from stale coordinates. |
| Any required tool failure/unknown | State unchanged | Fail/recover through existing tool semantics; never replay an unknown invocation. |
| Completion sentinel after at least one presented step and fresh evidence | terminal | Show one short recap, end companion session, return to follow. |

`completedSteps` currently behaves as a bounded presentation counter, not proof
that the learner achieved the goal. Do not use it as semantic verification and
do not show an invented “step X of Y” total to the learner.

## Implementation Tasks

### Task 1: Freeze the end-to-end contract with failing tests

- **ACTION:** Add tests that describe the optimized continuous loop before
  changing production behavior.
- **IMPLEMENT:** Cover:
  - a changed guidance result that includes fresh observation evidence advances
    directly to the next decision-ready state;
  - explicit continue and timeout still require `observe_context`;
  - completion is rejected before the first guided step and accepted only after
    a guided step plus fresh post-action evidence;
  - the latest screenshot is retained while older walkthrough screenshots are
    removed from the next model request;
  - Cursor Buddy remains at the teaching anchor in `checking` and returns to the
    user cursor only on task completion/cancel/failure;
  - the real OS cursor/CUA control path remains unused;
  - one voice task submission is sufficient for at least two simulated steps.
- **MIRROR:** `services/agent-runtime/test/walkthrough-runtime.test.ts:65-151`,
  `src/main/presentation/learner-action-gate.test.ts:7-78`, and
  `src/main/companion/cursor-buddy-controller.test.ts:92-161`.
- **IMPORTS:** Vitest fake timers, current `DesktopObservation` fixture builders,
  existing `LocalToolExecutionResult` and Cursor Buddy test stubs.
- **GOTCHA:** Do not assert that a changed fingerprint means success. Assert
  only that it supplies evidence for the next semantic model decision.
- **VALIDATE:** Run the focused agent-runtime and desktop Vitest files after
  each red/green unit, then the consolidated commands at the end.

### Task 2: Make walkthrough transitions consume typed tool evidence

- **ACTION:** Replace the growing positional `advanceWalkthrough` call contract
  with one pure, parsed transition event while keeping the serialized state
  backward compatible.
- **IMPLEMENT:** Add a strict internal event shape containing `modelName`, tool
  status, learner activity, and `hasFreshObservation`. Transition
  `show_guidance + changed + hasFreshObservation` directly to decision-ready
  guidance state; use `needs_observation` for confirmation, timeout, missing
  evidence, failure, or uncertainty. Branch the trusted model instruction so a
  post-step fresh image permits exactly one next guidance call or the bounded
  completion sentinel. Permit an additional `observe_context` only as a safe
  re-grounding action when the attached evidence is degraded or ambiguous.
- **MIRROR:** The pure Zod state and output guard in
  `services/agent-runtime/src/walkthrough-runtime.ts:1-202`.
- **IMPORTS:** Zod only; keep this module free of Electron, CUA, and SDK runtime
  objects.
- **GOTCHA:** Initial `needs_guidance` and post-step `needs_guidance` differ by
  whether a guided step has been presented. Never allow a zero-step completion.
- **VALIDATE:** Unit-test every transition table row, invalid evidence shape,
  correction limit reset, and recap bound.

### Task 3: Return the stable observation instead of only its fingerprint

- **ACTION:** Preserve the actual final stable observation captured by the
  learner gate and carry it back through `CursorBuddyController`.
- **IMPLEMENT:** Make `LearnerActionGate` generic over an observation that has a
  fingerprint, or introduce an equivalently typed generic result. The changed
  outcome must contain the second stable observation object, not a copied loose
  `unknown` payload. Propagate that object through
  `CursorBuddyPresentationResult` and `GuidancePresentationResult` without
  importing Electron or CUA into renderer code.
- **MIRROR:** The current structural `LearnerObservation` boundary in
  `src/main/presentation/learner-action-gate.ts:6-29` and dependency injection
  in `src/main/companion/cursor-buddy-controller.ts:46-78`.
- **IMPORTS:** `DesktopObservation` only at the trusted composition/execution
  boundary (`src/index.ts` / `execution-coordinator.ts`), not in the sandboxed
  renderer or generic learner gate.
- **GOTCHA:** Keep the full screenshot out of logs, task snapshots, analytics,
  Cursor Buddy snapshots, and renderer IPC. It may flow only through the
  encrypted tool-result/session path that already carries observations.
- **VALIDATE:** Test reference identity/data preservation, two stable samples,
  unchanged reset, pause/repeat/continue, timeout, and cancellation.

### Task 4: Reuse guidance evidence through the existing trusted tool result

- **ACTION:** Attach the stable `DesktopObservation` to a confirmed guidance
  result when learner activity is `changed`.
- **IMPLEMENT:** Extend `GuidancePresentationResult` to return an optional typed
  observation. In the `task.guidance` adapter, set `result.observation` only
  when it is fresh and corresponds to the detected stable change. Continue to
  include `expectedOutcome` and learner activity in bounded data.
  `executionContextAfterToolResult` will then make it `latestObservation`, and
  `normalizeLocalToolResult` will supply metadata plus the screenshot to the
  same SDK run.
- **MIRROR:** Observation adapters at
  `src/main/agent/execution-coordinator.ts:112-170`, result normalization at
  `src/main/agent-runtime/agent-runtime-adapter.ts:786-846`, and current
  guidance evidence at `src/main/agent/execution-coordinator.ts:248-271`.
- **IMPORTS:** `DesktopObservation` from `src/main/agent/execution-contracts.ts`.
- **GOTCHA:** Do not create another `observe_after_guidance` tool. Do not bypass
  the invocation journal. The observation is a result of the already
  checkpointed `show_guidance` invocation.
- **VALIDATE:** Integration-test that the result updates
  `executionContext.latestObservation`, contains one model image, retains the
  expected outcome, and still never calls `cua.executeCommand`.

### Task 5: Reduce learner-detection latency without weakening semantic checks

- **ACTION:** Make the local change detector responsive enough that the learner
  sees checking feedback quickly.
- **IMPLEMENT:** Start the first observation immediately after the explanation
  finishes rather than sleeping 1.5 seconds first. Keep a second stable sample,
  but use an adaptive follow-up cadence (target 400-750 ms, measured around the
  actual CUA capture duration) and reset the candidate on unchanged or different
  fingerprints. Preserve the 75-second outer bound and cancellation.
- **MIRROR:** The existing wake/action loop in
  `src/main/presentation/learner-action-gate.ts:48-113`; do not replace it with
  a renderer timer or busy loop.
- **IMPORTS:** Injected clock/timer hooks if needed for deterministic tests; no
  new dependency.
- **GOTCHA:** Observation overlays must be hidden for every sample. Never lower
  stable samples to one merely to hit a latency target.
- **VALIDATE:** Fake-clock tests for immediate first probe, stable second probe,
  candidate reset, paused no-poll behavior, and no overlapping observations.

### Task 6: Make Cursor Buddy own the whole teaching session transition

- **ACTION:** Add a task-scoped session lifecycle around the existing per-step
  presentation.
- **IMPLEMENT:** Add controller methods/state equivalent to
  `beginSession`, `presentStep`, `showChecking`, and
  `finishSession/cancelSession`. A successful learner change ends the active
  gate, removes or softens the target highlight, changes the compact callout to
  localized “checking” copy, and keeps the virtual buddy at the current anchor.
  The next `presentStep` glides from that anchor. Only a terminal or cancelled
  session calls `returnToUserCursor` and resumes following. Replay/pause/done
  remain accepted only while a learner gate is active.
- **MIRROR:** Current controller cancellation/generation guards at
  `src/main/companion/cursor-buddy-controller.ts:83-125` and presentation order
  at `src/main/companion/cursor-buddy-controller.ts:185-378`.
- **IMPORTS:** Existing pure geometry, narration handle, and learner gate. Keep
  Electron window functions injected.
- **GOTCHA:** A new task, Stop/Escape, sign-out, window teardown, or failed model
  turn must cancel speech, close the gate, hide stale UI, and return exactly
  once. Do not sample/chase the real cursor while the session is pinned.
- **VALIDATE:** Deterministic controller tests for step 1 -> checking -> step 2,
  terminal return, cancellation during each phase, reduced motion, and stale
  task actions.

### Task 7: Add the small checking projection across strict UI boundaries

- **ACTION:** Represent checking as a bounded presentation state, not a new
  window or a second coach system.
- **IMPLEMENT:** Extend `CursorBuddySnapshotSchema` and
  `CompanionGuidanceSchema` with a checking phase, add localized accessibility
  labels/status copy, disable learner controls during checking, and use the
  existing compact callout plus loading ring. Keep `CursorBuddyController` as
  the only state publisher and preserve the one strict snapshot getter/event.
- **MIRROR:** `src/shared/contracts.ts:1780-1794`,
  `src/renderer/CursorBuddy.tsx:21-60`,
  `src/renderer/GuidanceCallout.tsx:73-143`, and current phase CSS in
  `src/index.css`.
- **IMPORTS:** Existing shared contract types and translation conventions.
- **GOTCHA:** Checking is local feedback, not proof of success and not another
  TTS/model request. The callout must remain click-through/noninteractive while
  no learner action is pending.
- **VALIDATE:** Contract parsing, renderer markup/accessibility, controls hidden
  or disabled, loading animation, and Reduce Motion tests.

### Task 8: Remove stale screenshots from walkthrough model input

- **ACTION:** Bound vision context before every walkthrough model request.
- **IMPLEMENT:** Add a pure input transformer used by
  `injectRuntimeInstructions` (or a nearby dedicated module) that traverses SDK
  input from newest to oldest, keeps the newest walkthrough image, and removes
  older image content while retaining its bounded text/tool result. Apply it
  only when walkthrough mode is enabled. Leave direct tasks untouched. The
  original request, current expected outcome, latest observation metadata, tool
  call/result pairing, and completion guard must remain intact.
- **MIRROR:** The existing `callModelInputFilter` in
  `services/agent-runtime/src/local-runtime-server.ts:292-304` and SDK input
  composition in `services/agent-runtime/src/tool-adapter.ts:163-173`.
- **IMPORTS:** `AgentInputItem` types from `@openai/agents`; no custom session or
  second compaction service.
- **GOTCHA:** Do not orphan function-call outputs, alter call IDs, mutate the
  encrypted canonical session, or remove the newest image. Return a copied
  request input. If an unknown item shape is encountered, preserve it.
- **VALIDATE:** Pure tests with zero, one, and many images; mixed text/image tool
  outputs; direct-mode pass-through; and input immutability.

### Task 9: Wire session start/terminal cleanup and overlay-safe observations

- **ACTION:** Compose the optimized loop in `src/index.ts` without adding global
  mutable presentation flags.
- **IMPLEMENT:** Pass full observations from the existing CUA callback through
  the generic gate. Have task presentation start/finish the Cursor Buddy session
  for guided task IDs. Replace `restoreCoachOverlaysAfterObservation` with a
  task/session-aware observation lease or equivalent controller query so
  checking/guidance surfaces are restored only when the same session is still
  active. Preserve `showInactive`; never focus or reveal the main Tro window for
  background voice coaching.
- **MIRROR:** Composition at `src/index.ts:406-498`, serialized observation guard
  at `src/index.ts:677-719`, and terminal coordination at
  `src/index.ts:1832-1878`.
- **IMPORTS:** Existing `DesktopObservationGuard`, `TaskUpdateSchema`, and
  `requestsGuidedWalkthrough`.
- **GOTCHA:** Avoid a boolean shared across overlapping observations. Capture
  restoration intent per lease and verify task identity before restoring any
  overlay. Do not resurrect a window after cancellation or teardown.
- **VALIDATE:** Main-process tests for overlapping leases, task replacement,
  terminal cleanup, background global voice, and no main-window focus.

### Task 10: Tighten primary-school copy and complete documentation

- **ACTION:** Keep every spoken unit short, warm, concrete, and verifiable.
- **IMPLEMENT:** Update the `show_guidance` description and walkthrough trusted
  instruction to target a 6-10 second spoken step: a tiny hook, one action, and
  one reason. Add a combined bounded-copy refinement if the current independent
  limits can still produce an overly long paragraph. Never speak the whole
  remaining plan, an invented total, or unverified praise. Document that the
  same SDK task continues automatically and that only the newest image is sent
  at each decision boundary.
- **MIRROR:** Current strict schema at
  `src/main/agent/runtime-tool-registry.ts:695-748`, trusted instruction at
  `services/agent-runtime/src/walkthrough-runtime.ts:154-163`, and narration
  cancellation at `src/main/voice/companion-narration-service.ts:130-195`.
- **IMPORTS:** Existing Zod and documentation conventions only.
- **GOTCHA:** Character/word limits must work for both Vietnamese and English.
  Do not make copy so short that the reason disappears.
- **VALIDATE:** Schema boundary fixtures in both languages, prompt assertions,
  and docs review.

## Files to Change

### Required

- `services/agent-runtime/src/walkthrough-runtime.ts`
- `services/agent-runtime/test/walkthrough-runtime.test.ts`
- `services/agent-runtime/src/local-runtime-server.ts`
- `services/agent-runtime/test/local-runtime-server.test.ts`
- `services/agent-runtime/src/tool-adapter.ts` only if the latest-image helper
  needs a shared typed content predicate
- `services/agent-runtime/test/tool-adapter.test.ts` if that predicate lives
  beside result encoding
- `src/main/presentation/learner-action-gate.ts`
- `src/main/presentation/learner-action-gate.test.ts`
- `src/main/companion/cursor-buddy-controller.ts`
- `src/main/companion/cursor-buddy-controller.test.ts`
- `src/main/agent/execution-coordinator.ts`
- `src/main/agent/execution-coordinator.test.ts`
- `src/main/agent-runtime/agent-runtime-adapter.ts`
- `src/main/agent-runtime/agent-runtime-adapter.test.ts`
- `src/shared/contracts.ts`
- `src/shared/contracts.test.ts`
- `src/renderer/CursorBuddy.tsx`
- `src/renderer/CursorBuddy.test.ts`
- `src/renderer/GuidanceCallout.tsx`
- `src/renderer/guidance-callout-status.test.ts`
- `src/index.css`
- `src/index.ts`
- `src/main/presentation/desktop-observation-guard.ts`
- `src/main/presentation/desktop-observation-guard.test.ts`
- `docs/architecture.md`
- `docs/conversational-task-execution.md`

### Change only if required by implementation

- `services/agent-runtime/src/protocol.ts`: avoid a protocol shape/version change
  if the existing serialized walkthrough state can express the transition.
- `src/main/agent-runtime/local-agent-state.ts`: only if a checkpoint migration
  is truly necessary; prefer backward-compatible semantics.
- `src/preload.ts`, `src/shared/desktop-api.ts`,
  `src/main/ipc/register-ipc.ts`: the checking state should fit the existing
  strict snapshot/guidance channels and should not require a new IPC method.

## Non-Goals

- Generating an up-front lesson plan or array of all steps.
- One new LLM request per animation, sentence, replay, pause, or cursor move.
- A second agent, planner service, conversation store, or walkthrough database.
- Letting Cursor Buddy click, type, drag, or move the real OS cursor.
- Automatically solving the Scratch exercise on the learner's behalf.
- Treating a changed screenshot hash as semantic success.
- Replacing ElevenLabs or the existing system-speech fallback.
- Bypassing the Agents SDK required-initial-tool checkpoint to save the first
  model request.
- Redesigning all CUA permission onboarding in this change. If observation is
  unavailable, fail closed through the existing permission/task interaction
  path and request a manual image only as the final fallback.
- Introducing continuous video streaming or recording the learner's desktop.

## Test Strategy

### Unit

- Walkthrough transition table, completion guard, correction limit, and direct
  task pass-through.
- Latest-image-only model input transformation and immutability.
- Generic learner gate observation preservation, immediate first sample,
  adaptive second sample, pause/replay/continue, timeout, and abort.
- Cursor Buddy session lifecycle, checking state, next-step glide, terminal
  return, and stale task isolation.
- Strict copy/phase schemas in English and Vietnamese.

### Integration

- `show_guidance` with a stable changed observation -> coordinator result ->
  execution context latest observation -> normalized model text/image ->
  walkthrough next decision without an extra required observation.
- Explicit “I did it” -> mandatory fresh `observe_context` -> next decision.
- Wrong action/application switch -> fresh image -> corrective one-step guidance
  rather than unverified success or stale target reuse.
- Two-step fake Scratch walkthrough from one request with exactly one physical
  task submission, no OS cursor command, and terminal recap.
- Active task restart at a checkpoint before and after guidance; no duplicated
  mutation and safe re-observation where evidence is unavailable.

### Renderer and accessibility

- Thinking, gliding, checking, waiting, paused, and following labels.
- Loading ring and checking callout respect Reduce Motion.
- Replay/pause/done controls exist only during the learner gate.
- Callout remains inside negative-origin and multi-display bounds.

### Manual product pass

Use the supplied Scratch “When Clicked Increase Score” tutorial on a signed-in
packaged macOS build:

1. Hide/minimize the main Tro window.
2. Hold the global Task shortcut and say `Cách làm bài tập Scratch này.`
3. Verify local thinking feedback appears without foregrounding Tro.
4. Verify Cursor Buddy points to the correct visible target and the real cursor
   remains movable.
5. Perform the requested step and verify checking feedback appears promptly.
6. Verify the next pointer glides from the previous teaching position without a
   second voice message or manual screenshot.
7. Deliberately click the wrong control and switch applications; verify Tro
   re-grounds and corrects safely.
8. Use Replay, Pause/Resume, and “Em làm xong”.
9. Complete the task and verify one short recap, then return to follow mode.
10. Repeat on a Retina secondary display and with Reduce Motion enabled.

## Validation Commands

Run focused tests while implementing, then run once after all edits:

```bash
npm run agent-sdk:check
npm run check
npm run package
```

`npm run check` already includes the full SDK check, admin build, runtime version
check, Rust validation, lint, typecheck, audit, and tests. The explicit first
command is useful for a fast failure boundary before the full repository check.

Run `npm run bazel:check` only if Rust, Cargo manifests, Bazel configuration, or
Rust CI files change. This plan should not require those files.

## Acceptance Criteria

- One voice or typed visible-task request starts and completes a multi-step
  walkthrough without additional user messages or uploaded screenshots under
  normal CUA availability.
- The app never dumps all remaining steps in walkthrough mode.
- Each spoken step contains one short hook, one concrete action, one reason, and
  one expected visible outcome.
- Cursor Buddy, callout, highlight, and narration stay synchronized while the
  real operating-system cursor is never moved or clicked by guidance.
- A stable changed observation captured by the learner gate is reused as the
  next model evidence; the normal changed path does not issue a redundant
  `observe_context` call.
- Explicit confirmation, timeout, failed capture, degraded evidence, and
  ambiguity still force safe re-observation.
- The model, not the fingerprint detector, decides whether the expected outcome
  occurred.
- Between successful steps, Cursor Buddy shows a compact checking state and
  glides from the prior teaching anchor; it does not bounce back to the user's
  cursor.
- Only the newest walkthrough screenshot is present in each model request.
  Older text evidence remains available until normal SDK compaction.
- Premature prose/list output remains private and is corrected by the host
  completion guard.
- Restart/cancellation does not duplicate tool effects or resurrect stale
  companion UI.
- The main Tro window is not focused or revealed by a background global voice
  walkthrough.
- Focused tests, `npm run check`, and `npm run package` pass.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Reused observation is stale or belongs to the wrong task | Wrong highlight or unsafe guidance | Carry the full typed observation from the active task/generation only; registry still requires exact latest observation ID. |
| Faster polling creates false positives | Model evaluates an intermediate screen | Keep two matching stable samples and semantic model verification; only move the first probe earlier. |
| Image filtering corrupts SDK tool history | Provider rejects the next request | Remove only older image content, preserve text, item order, call IDs, and unknown item shapes; add provider-shape fixtures. |
| Checking UI survives cancellation | Confusing overlay or leaked state | Task-scoped generation token, terminal cleanup in one composition path, observation lease identity checks. |
| Long walkthrough hits tool/model limits | Session fails before completion | Keep one decision per successful step, one newest image, existing compaction, and current bounded limits; expose a clear bounded failure instead of silently restarting. |
| Existing uncommitted feature work is overwritten | Lost user work | Patch only named files, inspect `git diff` before/after, and never reset/rebase/checkout unrelated changes. |
| Copy limits cause tool validation retries | Added latency | Put the exact combined limits in both tool JSON schema and trusted instruction; cover EN/VI fixtures. |

## Rollout and Observability

- Add content-free timings keyed by task ID: voice task accepted -> thinking,
  model request duration, guidance shown, narration started, learner change
  detected, fresh evidence returned, and next guidance shown.
- Log only phase names, durations, tool names, step/presentation count, and
  booleans such as `freshObservationReused`; never log transcripts, screenshots,
  coordinates, copy, observation text, or image data.
- Compare before/after medians for:
  - learner change -> checking feedback;
  - learner change -> next guidance;
  - model requests per successful guided step;
  - CUA observations per successful guided step;
  - walkthrough completion, timeout, correction, and cancellation rates.
- Keep the optimized transition behind the presence of a typed fresh
  observation. Missing evidence automatically follows the existing safe
  re-observation path, providing a natural rollback behavior without a second
  architecture.

## Confidence

- **Complexity:** High. The change crosses SDK input shaping, trusted tool
  evidence, a local presentation state machine, and Electron multi-window
  cleanup.
- **Confidence:** High for the architecture because all required transport and
  persistence primitives already exist. Medium-high for final motion/latency
  feel until the signed-in manual Scratch pass is completed.
- **Primary implementation risk:** preserving valid SDK function-call history
  while bounding old image content.
- **Primary UX risk:** overlay hide/restore flicker during the two stable CUA
  samples; validate on real macOS/Retina hardware before shipping.
