# Plan: Seamless Screen Context and Voice-to-Task Handoff

## Summary

Replace the two model-facing screen observation tools with one always-available `observe_context` tool. The tool remains an Agents SDK function call, but the trusted Electron host decides whether CUA should read the frontmost non-Tro application surface or fall back to a full desktop screenshot, and it returns the normalized observation and image to the model.

Fix the related voice presentation race: after a spoken Task is accepted, the Voice Island must yield immediately to the live task's existing `thinking -> processing` companion state. A successful voice submission must not be interpreted as task completion, reveal the main Tro window, or allow Tro's caption/overlay windows to contaminate the initial screen observation.

## User Story

As a Tro user working in another application,
I want to ask “how do I do this?” by voice or text and have Tro understand the visible application without foregrounding itself,
so that the interaction feels immediate, grounded, and unobtrusive.

## Problem -> Solution

The local Agents SDK currently sees separate `observe_desktop` and conditionally available `observe_surface` tools. The in-progress grounding fix forces `observe_desktop`, so it bypasses the better external-window semantic path. At the same time, a voice Task publishes `phase: 'complete'` for 800 ms after task submission; presentation policy treats that as the whole task being done and may call the main-window reveal fallback while the task is still planning. -> Publish one `observe_context` tool that the host routes through CUA, make screen-dependent first turns require that tool, suppress Tro-owned surfaces during desktop fallback, and hand successful voice Tasks directly from voice presentation to the task's existing thinking/loading presentation.

## Metadata

- **Complexity**: Large
- **Source PRD**: N/A
- **PRD Phase**: N/A — standalone plan
- **Estimated files**: 28 existing files plus one focused observation-presentation guard and its test (30 total)
- **Estimated tasks**: 8
- **Dependencies**: No new package, hosted API, database migration, environment variable, or feature flag
- **Current worktree**: Contains in-progress screen-grounding changes in the local runtime/protocol plus unrelated user-owned `.media/*` and `.tours/feature-explainer-goal-lifecycle.tour` changes. Preserve the unrelated files and evolve the in-scope grounding work instead of reverting it.
- **Navigation note**: `docs/CODEX-NAVIGATION-GUIDE.md`, required by repository guidance, is missing from this worktree. The mandatory reading and traces below provide the feature-specific replacement context.
- **Confidence score**: 9/10. Both regressions have deterministic code paths, existing internal patterns cover the desired behavior, and no external API research is needed.

---

## Product Decisions (Do Not Reopen During Implementation)

1. **One model-facing observation tool.** The Agents SDK sees `observe_context`; it does not choose between `observe_surface` and `observe_desktop` tool names.
2. **The host still owns execution.** The SDK emits a function call. Electron resolves it against the frozen catalog, checkpoints it, and CUA performs the actual observation. Do not expose raw CUA or Electron IPC to the model or renderer.
3. **Surface-first by default.** `scope: 'auto'` tries the frontmost non-Tro application/window semantics first and falls back to desktop vision only when that route is unavailable or insufficient.
4. **Desktop remains an explicit scope within the same tool.** `scope: 'desktop'` is reserved for coordinate-grounded actions and `show_guidance`, because those paths require desktop `coordinateSpace` metadata.
5. **No continuous or ambient recording.** Observation occurs only for an accepted task/tool call under the existing screen-context policy. Tro does not maintain a background screenshot stream.
6. **Voice listening and task thinking are different ownership states.** The Voice Island owns requesting permission, listening, transcription, and submission. Once a Task is accepted, the task lifecycle owns presentation.
7. **Reuse the existing loading treatment.** `PresentationState='thinking'` already maps to `CompanionState='processing'`, and the companion already renders a spinning ring plus three animated dots. Do not create a new modal, caption screen, or duplicate loader.
8. **No foregrounding on normal handoff.** A successful background voice Task must keep the current application focused. Existing intentional reveals for unrecoverable errors, explicit “open task” actions, and attention states remain in scope only as guarded fallback behavior.
9. **Tro-owned visual surfaces are not evidence.** Surface selection must continue excluding Tro's process/title. A full-desktop fallback must temporarily suppress Tro's main/voice/companion/guidance/control overlays before capture and restore only logically active non-focus-stealing surfaces afterward.
10. **Observation results remain grounded and fresh.** Preserve the in-progress adapter work that returns screenshot/text/route/observation ID to the model and stores the latest observation for the next control call.

---

## UX Design

### Before

```text
Scratch is frontmost
      |
User speaks “How do I do this Scratch exercise?”
      |
Voice Island shows transcript -> “Voice Task sent”
      |
Task begins planning, but voice `complete` wins presentation precedence
      |
Presenter treats the in-progress task as done
      |
No completed response exists -> fallback reveals Tro main window
      |
Forced `observe_desktop` may capture Tro/caption UI instead of Scratch
```

### After

```text
Scratch is frontmost
      |
User speaks “How do I do this Scratch exercise?”
      |
Voice Island shows listening/transcribing/sending without taking focus
      |
Task is accepted -> Voice Island clears
      |
Companion enters existing Thinking/processing animation
      |
Agents SDK is forced once to call observe_context(scope: auto)
      |
Host/CUA reads the frontmost non-Tro surface
      +-- semantic/window observation succeeds -> return it
      `-- unavailable -> suppress Tro overlays -> desktop capture -> cleanup
      |
Screenshot + visible text + route + observation ID reach the model
      |
Tro answers from Scratch's actual visible state; main window stays backgrounded
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Agents SDK tool surface | `observe_desktop` plus conditional `observe_surface` | One `observe_context` tool | Control tools remain route-specific because execution semantics differ |
| Screen-dependent first turn | Forced full desktop observation | Forced `observe_context(scope: auto)` | Named tool choice applies only to the first sample |
| Current application selection | Available only through conditional semantic tool | Always attempted first by the host | Existing window selection excludes Tro and fails closed on ambiguity |
| Full desktop fallback | Can include Tro-owned windows | Tro visual surfaces suppressed before capture | Cleanup must run in `finally` |
| Voice task completion | 800 ms voice `complete` dwell | Immediate handoff to task presentation | Keep Dictation success/error dwell unchanged |
| Companion state | Can briefly show “done” and reveal main app | `thinking`/`processing`, then `working` | Existing ring/dots/sprite are reused |
| Focus | Main app can pop over Scratch | Scratch remains focused | `showInactive` only for allowed auxiliary restoration |

---

## Root-Cause Trace

### Screen Context

1. `src/main/application/task-application-service.ts:113-129` starts the local turn. The in-progress change adds `requiredInitialTool: 'observe_desktop'` when `shouldCaptureInitialDesktopObservation()` or an Activity current-surface launch requires grounding.
2. `services/agent-runtime/src/protocol.ts:84-97` carries the nullable required tool only on `turn.start`.
3. `services/agent-runtime/src/agent-graph.ts:43-61` verifies the required tool exists and sets the Agents SDK named `toolChoice`; ordinary turns remain `auto`.
4. `src/main/agent/runtime-tool-registry.ts:578-604` publishes `observe_desktop` as `desktop.observe`.
5. `src/main/agent/cua-semantic-agent-tools.ts:294-350` separately publishes `observe_surface` as `computer.observe`, but only when `semanticAvailable()` is true.
6. `src/main/agent/execution-coordinator.ts:98-147` dispatches desktop observation directly to `cua.observe()`, while surface observation already tries `cua.observeCurrentSurface()` and falls back to `cua.observe()`.
7. `src/main/cua/cua-surface-router.ts:242-276` selects the frontmost external window using the current task binding.
8. `src/main/cua/cua-window-selection.ts:17-64` excludes the own process/Tro titles and refuses ambiguous candidates.
9. `src/main/cua/cua-service.ts:680-752` calls CUA `getDesktopState`, creates the screenshot/text/fingerprint/coordinate-space observation, and emits only content-free observation metadata.
10. `src/main/agent-runtime/agent-runtime-adapter.ts:748-797` now preserves the observation as `latestObservation` and returns metadata plus an image data URL to the Agents SDK. This in-progress fix is required and must remain.

### Voice Popup

1. `src/renderer/use-push-to-talk.ts:335-375` enters `committing`, awaits the app's transcript callback, then ends the voice turn.
2. `src/renderer/App.tsx:2011-2032` sends a Task through `sendInput()`, records `task_submitted`, and publishes a Task voice activity with `phase: 'complete'` for 800 ms.
3. `src/renderer/App.tsx:2335-2360` forwards the active/override voice activity to Electron main.
4. `src/index.ts:755-777` publishes the activity, updates presentation state, and shows the Voice Island using `showInactive()`.
5. `src/main/presentation/presentation-policy.ts:47-79` checks `voice.phase === 'complete'` before checking whether the task is still interpreting/planning/working, so a newly created task projects as `done`.
6. `src/main/presentation/electron-presentation-presenter.ts:129-159` handles `done` by attempting to present a completed response. The live task has no final answer, so `presentCompanionResponse()` returns false and `revealOnFailure()` foregrounds the main window.
7. `src/index.ts:2105-2111` implements the reveal with `show()`, `moveTop()`, and `focus()`.
8. The main window and Voice Island may now be present when the initial desktop observation executes, producing the reported caption/self-capture behavior.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `src/main/application/task-application-service.ts` | 80-140 | Entry point and initial observation policy handoff |
| P0 | `src/main/agent-runtime/agent-runtime-adapter.ts` | 164-203, 490-590, 748-797 | Frozen catalog, durable execution, latest observation, image delivery |
| P0 | `services/agent-runtime/src/protocol.ts` | 1-130 | Strict host/SDK protocol and required-first-tool contract |
| P0 | `services/agent-runtime/src/agent-graph.ts` | 35-70 | Named first-tool enforcement and availability failure |
| P0 | `services/agent-runtime/src/tool-adapter.ts` | 66-147 | SDK function tool construction, checkpoint requirement, image result shape |
| P0 | `src/main/agent/runtime-tool-registry.ts` | 39-77, 503-805, 1020-1145 | Tool definitions, grounding requirements, registration invariants |
| P0 | `src/main/agent/cua-semantic-agent-tools.ts` | 45-109, 184-203, 294-430 | Current surface observation/control contracts and route checks |
| P0 | `src/main/agent/execution-coordinator.ts` | 29-64, 75-210 | Trusted Electron-only CUA dispatch boundary |
| P0 | `src/main/cua/cua-service.ts` | 680-774 | Desktop capture and current-surface API behavior |
| P0 | `src/main/cua/cua-surface-router.ts` | 228-276, 580-655 | External surface selection and normalized observation construction |
| P0 | `src/main/presentation/presentation-policy.ts` | 1-90 | Pure state precedence that causes the voice completion race |
| P0 | `src/main/presentation/electron-presentation-presenter.ts` | 80-167 | Companion mapping and main-window reveal fallbacks |
| P0 | `src/renderer/App.tsx` | 1839-1851, 1893-2180, 2335-2369 | Voice route, terminal dwell, and IPC publication |
| P0 | `src/index.ts` | 604-777, 1871-1928, 2105-2150, 3018-3065 | Window ownership, background-task tracking, focus behavior, Voice Island |
| P1 | `src/main/agent/screen-context-policy.ts` | all | In-progress selective visible-context policy |
| P1 | `src/main/agent/walkthrough-policy.ts` | 108-188 | Existing observation-name dependency and desktop-coordinate requirement |
| P1 | `src/main/agent/execution-contracts.ts` | 50-105, 240-330 | Observation routes and coordinate-space mapping |
| P1 | `src/main/cua/cua-window-selection.ts` | all | Fail-closed exclusion of Tro and ambiguous windows |
| P1 | `src/renderer/VoiceIsland.tsx` | 7-160 | Noninteractive caption/status UI and terminal behavior |
| P1 | `src/renderer/companion-animation.ts` | 17-76 | Existing `processing`/thinking animation mapping |
| P1 | `src/index.css` | 2288-2427 | Existing loading ring and animated three-dot indicator |
| P2 | `git show 187c1fa:src/main/agent/openai-agents-runtime.ts` | 119-146 | Historical host-provided initial observation pattern |
| P2 | `git show a476b4c:src/index.ts` | 302-339 | Historical desktop preparation/hide/cleanup pattern |

---

## External Documentation

No external research needed — this feature uses established internal abstractions, the already-pinned local Agents SDK/CUA versions, and behavior verified by the repository's current source and tests. Implementation must not upgrade either dependency as part of this change.

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Application |
|---|---|---|---|
| Naming | `runtime-tool-registry.ts:51-64` | Stable dotted host `id`, snake_case `modelName`, pure `normalize` | Use host ID `computer.observe` and model name `observe_context` |
| Boundary validation | `protocol.ts:37-46, 84-97` | Strict Zod schemas on every process message | Keep required tool nullable/start-only and validate unified tool arguments |
| Tool admission | `runtime-tool-registry.ts:1058-1130` | Reject duplicate IDs/names, invalid schema, empty operations | Remove old observation definitions; do not retain ambiguous aliases |
| Error handling | `agent-graph.ts:43-53` | Fail closed when required tool is absent | `observe_context` must be always present for non-workspace turns |
| Unknown outcomes | `tool-adapter.ts:137-147` | Unknown throws terminal `ToolOutcomeUnknownError`; no replay | Preserve exactly-once durable checkpoint behavior |
| Observation fallback | `execution-coordinator.ts:108-146` | Surface first, then desktop | Move this behavior behind unified `observe_context` |
| Grounded state | `agent-runtime-adapter.ts:748-797` | Immutable context update plus bounded model envelope | Preserve `latestObservation` and image output |
| External-window safety | `cua-window-selection.ts:17-47` | Exclude own process/Tro and fail closed on ranking ambiguity | Reuse unchanged for `scope: auto` |
| Logging | `cua-service.ts:703-714` | Structured content-free route/screenshot metadata | Never log image data, visible text, or voice transcript |
| Voice diagnostics | `use-push-to-talk.ts:224-231` | Content-free `[voice:renderer] turn.*` events | Add disposition/state only if new diagnostic is needed |
| Presentation purity | `presentation-policy.ts:47-79` | Pure projection from task/voice/budget | Encode handoff precedence here and unit-test it |
| Presenter fallback | `electron-presentation-presenter.ts:121-166` | Reveal only when presentation/attention cannot be surfaced | Add nonterminal-task guard before any `done` fallback |
| Non-focus window | `index.ts:3018-3058` | Sandboxed, `focusable:false`, click-through, `showInactive()` | Preserve Voice Island security/focus properties |
| Existing loader | `index.css:2288-2427` | Processing ring and three animated dots | Reuse without new CSS/UI component |
| Tests | `presentation-policy.test.ts:32-98` | Pure table-like assertions plus coordinator idempotence | Add explicit voice-complete + live-task fixtures |
| Tests | `execution-coordinator.test.ts:57-142` | Inject narrow stubs and assert exact native calls | Add auto/surface/fallback/cleanup cases |
| Tests | `cua-semantic-agent-tools.test.ts:29-161` | Assert exact model-visible surface and normalization | Assert single observation name and strict schema |
| Configuration | `package.json` scripts | `npm run check`, `npm run package` are release gates | No new flags/dependencies |
| Data access | N/A | Feature is transient runtime/presentation state | No repository/database changes |

---

## Patterns to Mirror

### STRICT_TOOL_DEFINITION

```ts
// SOURCE: src/main/agent/runtime-tool-registry.ts:496-500
function defineTool<T>(
  definition: RuntimeToolDefinition<T>,
): RuntimeToolDefinition {
  assertStrictFunctionSchema(definition.parameters);
  return definition as RuntimeToolDefinition;
}
```

The unified observation schema must remain exact-provider-compatible and strict. Use nullable fields rather than provider-optional object properties where required by the existing tool schema convention.

### HOST_OWNS_CUA_ROUTING

```ts
// SOURCE: src/main/agent/execution-coordinator.ts:136-146
const observation =
  (await cua.observeCurrentSurface(
    context.taskId,
    { query: input.query },
    context.signal,
  )) ?? (await cua.observe(context.taskId, context.signal));
return {
  observation,
  status: 'confirmed' as const,
  summary: 'Captured a fresh application-surface observation.',
};
```

Retain this routing in the Electron host; the SDK must not receive raw CUA method names.

### OBSERVATION_DELIVERY

```ts
// SOURCE: src/main/agent-runtime/agent-runtime-adapter.ts:748-755, 791-796
return result.observation
  ? { ...context, latestObservation: result.observation }
  : context;

const observationImageDataUrl = result.observation?.screenshot
  ? `data:${result.observation.screenshot.mimeType};base64,${result.observation.screenshot.dataBase64}`
  : null;
```

Every successful unified observation must use the same path so later control calls resolve against exactly the evidence the model saw.

### FAIL_CLOSED_REQUIRED_TOOL

```ts
// SOURCE: services/agent-runtime/src/agent-graph.ts:47-53
if (
  input.requiredInitialTool &&
  !input.tools.some((tool) => tool.modelName === input.requiredInitialTool)
) {
  throw new Error('required_initial_tool_unavailable');
}
```

Do not silently run an ungrounded first sample if `observe_context` is missing from the frozen catalog.

### EXCLUDE_TRO_SURFACES

```ts
// SOURCE: src/main/cua/cua-window-selection.ts:21-30
return windows.filter(
  (window) =>
    window.pid !== ownProcessId &&
    !TROCODE_PATTERN.test(window.app_name) &&
    !TROCODE_PATTERN.test(window.title) &&
    window.is_on_screen &&
    window.on_current_space &&
    window.bounds.width > 0 &&
    window.bounds.height > 0,
);
```

Do not weaken this selection to make an ambiguous surface succeed.

### PURE_PRESENTATION_PRECEDENCE

```ts
// SOURCE: src/main/presentation/presentation-policy.ts:74-77
if (input.voice?.phase === 'complete') return 'done';
if (input.task?.phase === 'completed') return 'done';
if (input.task && THINKING_PHASES.has(input.task.phase)) return 'thinking';
if (input.task && WORKING_PHASES.has(input.task.phase)) return 'working';
```

Change the precedence so active task state wins over a terminal voice handoff. Preserve error and attention precedence.

### NON_FOCUSING_AUXILIARY_UI

```ts
// SOURCE: src/index.ts:3022-3045, 3054-3058
voiceIslandWindow = new BrowserWindow({
  alwaysOnTop: true,
  focusable: false,
  // ... sandboxed renderer options
});
voiceIslandWindow.setIgnoreMouseEvents(true, { forward: true });
// ...
voiceIslandWindow?.showInactive();
```

Restored capture overlays must use `showInactive`; never call the general `revealWindow()` path during a normal voice/task handoff.

### FINALLY_CLEANUP

```ts
// SOURCE: historical pattern, git show a476b4c:src/index.ts:302-339
const cleanup = await prepareDesktop();
try {
  return await capture();
} finally {
  await cleanup?.();
}
```

Desktop capture suppression must be exception-safe and safe under cancellation.

---

## Strategic Design

### Approach

1. Complete the current required-first-tool and observation-delivery work.
2. Rename/consolidate observation at the model boundary to `observe_context` while keeping CUA behind the Electron execution coordinator.
3. Give the unified tool a strict operation/scope contract:
   - `operation: 'observe'`, `scope: 'auto'`: current non-Tro surface first, desktop fallback.
   - `operation: 'observe'`, `scope: 'desktop'`: direct desktop capture for coordinate-space consumers.
   - `operation: 'inspect_surface_region'`: use the existing observation ID + bounded normalized region crop.
   - All fields remain present under the strict schema; irrelevant fields are `null` and cross-field validity is enforced during parse.
4. Suppress Tro-owned windows only around the full-desktop capture path, not around successful semantic/window observation.
5. Clear the successful Task terminal voice overlay and project a live task as thinking/working even if a stale voice-complete activity arrives.
6. Add a presenter-level defensive invariant so `done` can never reveal/present a nonterminal task.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Let the model keep choosing `observe_surface` vs `observe_desktop` | Rejected | Exposes implementation routing, allows the wrong first tool, and recreates the current failure |
| Pre-capture every request and attach an image before the SDK runs | Rejected for this phase | Adds image/privacy cost to self-contained requests and bypasses the durable function-tool lifecycle |
| Always take a full desktop screenshot | Rejected | Captures unrelated content/Tro overlays and loses structured semantic data |
| Only use semantic/window observation | Rejected | Permissions/capabilities and apps can make it unavailable; coordinate walkthroughs require desktop metadata |
| Add a new loading modal/caption page | Rejected | Existing companion `processing` animation already expresses the desired state without stealing focus |
| Fix only the renderer's 800 ms dwell | Rejected as incomplete | A stale/out-of-order activity could still reach main; presenter/policy must enforce the lifecycle invariant |
| Hide overlays with ad-hoc sleeps at the renderer | Rejected | Electron main owns windows and CUA capture; suppression belongs at the trusted host boundary |

### Scope

- Single model-facing observation tool and all in-repo references/tests migrated.
- Selective automatic first observation for visible-context requests and current-surface Activities.
- CUA current-surface-first routing with desktop fallback and route-aware result delivery.
- Tro-owned overlay suppression for desktop fallback.
- Voice-to-task presentation handoff, existing thinking indicator, and no-focus regression protection.
- Focused unit/integration tests and packaged manual validation.

### NOT Building

- Always-on screenshots, screen recording history, background OCR, or proactive monitoring.
- A second agent/runtime, direct SDK-to-CUA dependency, or raw CUA exposure through preload.
- A new permission model or bypass of macOS Screen Recording/Accessibility requirements.
- A new spinner component, captioning screen, animation asset, or CSS redesign.
- Changes to Dictation success/error dwell, delivery semantics, or no-retry guarantees.
- Changes to intentional foregrounding after a user chooses “Open task,” when a foreground-only blocking interaction truly requires attention, or when explicit error presentation is unavailable.
- Removal of route-specific `control_surface` and `control_desktop`; their grounding/execution contracts remain materially different.
- Database/API migrations, analytics content capture, new dependencies, or CUA upgrade.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/main/agent/screen-context-policy.ts` | UPDATE | Rename desktop-specific policy wording/exports to initial context observation |
| `src/main/agent/screen-context-policy.test.ts` | UPDATE | Preserve English/Vietnamese positive and selective-skip coverage |
| `src/main/application/task-application-service.ts` | UPDATE | Require `observe_context` for eligible non-workspace starts |
| `src/main/application/task-application-service.test.ts` | UPDATE | Assert the unified required tool and no requirement for self-contained/workspace requests |
| `services/agent-runtime/src/protocol.ts` | KEEP/COMPLETE | Preserve protocol v3 `requiredInitialTool` start-only field |
| `services/agent-runtime/src/config.ts` | KEEP/COMPLETE | Preserve typed named tool choice with ordinary default `auto` |
| `services/agent-runtime/src/agent-graph.ts` | KEEP/COMPLETE | Preserve catalog validation and first-tool enforcement |
| `services/agent-runtime/src/local-runtime-server.ts` | KEEP/COMPLETE | Pass required tool on start and `null` on resume |
| `services/agent-runtime/test/protocol-and-graph.test.ts` | UPDATE | Expect `observe_context`, unavailable failure, and ordinary auto behavior |
| `services/agent-runtime/test/local-runtime-server.test.ts` | UPDATE | Verify start/resume forwarding semantics |
| `src/main/agent-runtime/agent-runtime-adapter.ts` | KEEP/UPDATE | Preserve observation image/state delivery; carry unified tool name unchanged |
| `src/main/agent-runtime/agent-runtime-adapter.test.ts` | UPDATE | Assert image/metadata/latest observation plus required unified tool envelope |
| `src/main/agent/runtime-tool-registry.ts` | UPDATE | Remove model-facing `observe_desktop`; map screen observation actions to `computer.observe` |
| `src/main/agent/runtime-tool-registry.test.ts` | UPDATE | Assert exact single observation tool catalog and new action mapping |
| `src/main/agent/cua-semantic-agent-tools.ts` | UPDATE | Rename/expand `observe_surface` into always-available strict `observe_context` definition |
| `src/main/agent/cua-semantic-agent-tools.test.ts` | UPDATE | Cover auto/desktop/region normalization and availability without semantic fast path |
| `src/main/agent/execution-coordinator.ts` | UPDATE | Route unified scope through current surface or prepared desktop fallback |
| `src/main/agent/execution-coordinator.test.ts` | UPDATE | Cover route selection, fallback, cleanup, cancellation/error, and no duplicate capture |
| `src/main/agent/walkthrough-policy.ts` | UPDATE | Replace old observation name and instruct `scope: desktop` for guidance |
| `src/main/agent/walkthrough-policy.test.ts` | UPDATE | Preserve observe/guidance sequencing under unified name |
| `src/index.ts` | UPDATE | Inject exception-safe Tro-window suppression around desktop capture fallback |
| `src/main/presentation/desktop-observation-guard.ts` | CREATE | Narrow/ref-counted host guard for shared overlay suppression |
| `src/main/presentation/desktop-observation-guard.test.ts` | CREATE | Verify nested cleanup, destroyed windows, and non-focus restoration |
| `src/main/presentation/presentation-policy.ts` | UPDATE | Make live task thinking/working override terminal voice handoff |
| `src/main/presentation/presentation-policy.test.ts` | UPDATE | Reproduce and lock the voice-complete + planning-task regression |
| `src/main/presentation/electron-presentation-presenter.ts` | UPDATE | Refuse done presentation/reveal for nonterminal task snapshots |
| `src/main/presentation/electron-presentation-presenter.test.ts` | UPDATE | Assert no reveal for inconsistent nonterminal done; preserve intentional fallback tests |
| `src/renderer/App.tsx` | UPDATE | Clear successful Task voice activity instead of showing 800 ms complete dwell |
| `src/renderer/voice-route.ts` | UPDATE | Add a pure, testable terminal-presentation decision for Task vs Dictation |
| `src/renderer/voice-route.test.ts` | UPDATE | Task submission yields to task UI; Dictation retains terminal dwell |

`src/renderer/VoiceIsland.tsx`, `src/renderer/companion-animation.ts`, and the processing CSS are reference-only unless a test fixture needs an import adjustment. No visual redesign is expected.

---

## Step-by-Step Tasks

### Task 1: Stabilize the required-initial-tool and observation-result foundation

- **ACTION**: Finish and preserve the current in-progress grounding changes before renaming the tool.
- **IMPLEMENT**:
  - Keep protocol version 3 and the strict nullable `requiredInitialTool` field on `turn.start`; omit it from resume.
  - Keep `modelSettings(toolChoice)` typed with the Agents SDK type and default ordinary turns to `auto`.
  - Validate the named tool against the frozen catalog and fail with `required_initial_tool_unavailable` when absent.
  - Keep the adapter's cloned mutable grounded execution context, `latestObservation` update, bounded observation metadata, and screenshot image data URL.
  - Confirm the named choice constrains only the first model sample; later samples return to normal tool choice through the SDK's reset behavior.
- **MIRROR**: `protocol.ts:84-97`, `agent-graph.ts:43-61`, `tool-adapter.ts:66-147`, `agent-runtime-adapter.ts:748-797`.
- **IMPORTS**: Existing `ModelSettingsToolChoice`, `DesktopObservation`, `ToolResolutionContext`, and local protocol types.
- **GOTCHA**: Do not put screenshots or observation objects directly into the process protocol outside the bounded `LocalToolExecutionResult`; the current 40 MB image limit and 1,000-character summary limit are intentional.
- **VALIDATE**: Local runtime tests prove start vs resume behavior, missing required tool failure, ordinary auto choice, image delivery, and latest-observation grounding.

### Task 2: Publish one strict `observe_context` model tool

- **ACTION**: Consolidate `observe_desktop` and `observe_surface` at the model boundary.
- **IMPLEMENT**:
  - Keep host ID `computer.observe` to minimize internal churn; rename the model tool to `observe_context`.
  - Make the definition available even when `semanticAvailable()` is false, because desktop fallback remains possible.
  - Use one strict object contract with required fields for `operation`, `scope`, `reason`, `query`, `observationId`, and `region`; use `null` for irrelevant fields.
  - Parse/refine valid combinations:
    - `operation='observe'`, `scope in {'auto','desktop'}`, nonempty reason, null observation/region.
    - `operation='inspect_surface_region'`, current observation ID + bounded region; scope/query may be null.
  - Remove the `desktop.observe` definition and `observe_desktop` model name from default tools.
  - Keep `control_surface`/`prepare_browser_access` conditional on semantic capability; keep `control_desktop` always available.
  - Update tool descriptions so the model uses `scope='auto'` for understanding and `scope='desktop'` only when it needs coordinate-space metadata.
  - Map legacy high-level `observe_screen` actions to `computer.observe`/`observe`.
- **MIRROR**: Strict schema and normalization in `cua-semantic-agent-tools.ts:294-350`; registration admission in `runtime-tool-registry.ts:1058-1130`.
- **IMPORTS**: Existing `objectSchema`, `RuntimeToolDefinition`, `AgentToolCall`, and observation input schemas/types.
- **GOTCHA**: Do not leave compatibility aliases in the same catalog. A single exact model-facing name is the feature; persisted graph/catalog mismatches already fail closed.
- **VALIDATE**: Exact catalog assertions contain `observe_context` once and contain neither old observation name. Semantic-disabled registry still publishes `observe_context` but not `control_surface`.

### Task 3: Route context observation through CUA and suppress Tro on desktop fallback

- **ACTION**: Make Electron main own the auto/scope routing and safe capture preparation.
- **IMPLEMENT**:
  - For `scope='auto'`, call `cua.observeCurrentSurface(taskId, {query}, signal)` first.
  - If it returns an observation, return it immediately without hiding windows or taking a desktop screenshot.
  - If unavailable, or for `scope='desktop'`, enter a trusted desktop-observation guard, call `cua.observe()`, and release the guard in `finally`.
  - The guard hides visible Tro-owned surfaces that can contaminate the screenshot: main, Voice Island, companion, cursor buddy, guidance callout/target, and desktop-control indicator.
  - Wait one bounded compositor-settle interval, mirroring the historical 120 ms preparation.
  - Never call `focus()` or `moveTop()` during preparation/cleanup.
  - Do not reactivate the main window during a background task. Restore only auxiliary surfaces that are still logically active, using `showInactive()` and current state checks. Do not resurrect an already-cleared Voice Island.
  - If capture guards can overlap across tasks, serialize or reference-count them so one cleanup cannot reveal overlays during another capture.
  - Preserve `CuaService`'s content-free performance metrics and image evidence policy.
- **MIRROR**: Current surface fallback in `execution-coordinator.ts:108-147`; historical preparation in `git show a476b4c:src/index.ts:302-339`; `updateCompanionVoiceActivity()` state checks in `src/index.ts:755-777`.
- **IMPORTS**: Narrow BrowserWindow-like host interfaces if a testable guard is extracted; no renderer API changes.
- **GOTCHA**: Cleanup must be idempotent and run on permission denial, timeout, cancellation, and thrown CUA errors. Never restore a window solely because it was visible before capture if its logical activity ended during capture.
- **VALIDATE**: Unit tests assert surface success skips desktop/guard, fallback calls guard + desktop once, desktop scope skips surface, and cleanup runs exactly once on success and failure. Manual screenshot inspection contains Scratch but no Tro/Voice Island/companion overlay.

### Task 4: Migrate screen-context and walkthrough policy to the unified tool

- **ACTION**: Make all host policy and textual references use `observe_context`.
- **IMPLEMENT**:
  - Rename `shouldCaptureInitialDesktopObservation` to context-oriented wording such as `shouldObserveInitialScreenContext` while keeping the current selective English/Vietnamese patterns.
  - In `TaskApplicationService`, require `observe_context` for eligible everyday/current-surface starts; never require it for Workspace tasks.
  - Keep direct answers and navigation-first requests on ordinary `auto` tool choice.
  - Replace walkthrough references to `observe_desktop` with `observe_context` and explicitly require/instruct `scope='desktop'` before `show_guidance`.
  - Update tool descriptions/instructions so route selection is unambiguous: semantic/window routes use `control_surface`; `desktop_vision` routes use `control_desktop`; `show_guidance` needs coordinate-space evidence.
- **MIRROR**: Current `screen-context-policy.ts`; walkthrough sequencing in `walkthrough-policy.ts:108-188`.
- **IMPORTS**: Updated policy export only.
- **GOTCHA**: A surface observation normally lacks desktop `coordinateSpace`; do not let walkthrough guidance silently consume it. Normalization must continue rejecting ungrounded coordinate use.
- **VALIDATE**: Scratch/Vietnamese phrase requires `observe_context`; self-contained explanation and navigation-first request do not; walkthrough tests use unified name and retain alternating observation/guidance behavior.

### Task 5: Hand successful voice Tasks to live task presentation

- **ACTION**: Remove the false completion/caption dwell after Task submission and reuse the existing thinking indicator.
- **IMPLEMENT**:
  - Add a pure terminal voice-presentation decision in `voice-route.ts`: successful `task_submitted` does not retain a terminal Voice Island; Dictation terminal states remain unchanged.
  - In `handleVoiceTranscriptReady`, after `sendInput(transcript)` succeeds and analytics records `task_submitted`, clear any voice activity override/timer instead of publishing Task `phase='complete'` for 800 ms.
  - Let `usePushToTalk` finish/reset the turn normally; do not bypass audio/capture cleanup.
  - In `derivePresentationState`, preserve failed/blocked/budget/voice-error precedence, but if a nonterminal task is interpreting/planning/observing/acting/verifying, return its thinking/working projection rather than `done` for terminal Task voice activity.
  - Keep a completed Dictation with no live task mapping to `done` so the existing short success feedback remains.
  - When Task submission is still in its voice `committing` callback but a task snapshot already exists, task thinking/working should own companion state.
- **MIRROR**: `voiceTurnRoute()` in `voice-route.ts`; pure phase sets in `presentation-policy.ts`; existing processing mapping in `electron-presentation-presenter.ts:80-88`.
- **IMPORTS**: Existing `VoiceMode`, `CompanionVoiceActivity`, `TaskSnapshot` types only.
- **GOTCHA**: Do not clear voice error activity or Dictation recovery feedback. The handoff rule applies only after confirmed Task acceptance.
- **VALIDATE**: Tests cover local/global Task, Dictation, voice error, planning/working/completed tasks, and prove voice-complete + planning yields `thinking`, not `done`.

### Task 6: Add a defensive nonterminal guard to main-window presentation

- **ACTION**: Prevent inconsistent presentation inputs from foregrounding Tro even if future ordering changes reintroduce a stale terminal voice state.
- **IMPLEMENT**:
  - Before `ElectronPresentationPresenter` maps or handles `state='done'` for a non-null task, require `task.phase === 'completed'`.
  - For a nonterminal snapshot, return without mutating companion state, resetting guidance, presenting a response, narrating, or revealing the main window; the normal task update owns the next thinking/working projection.
  - Preserve existing `needs_attention`, explicit completion, foreground narration failure, task failure, and cancellation behavior.
  - Optionally assert/log a content-free warning for the impossible state in development, without request/message contents.
- **MIRROR**: Presenter tests at `electron-presentation-presenter.test.ts:121-273` and its injected spies.
- **IMPORTS**: No new dependencies.
- **GOTCHA**: Do not broadly remove main-window reveal fallbacks; this guard is specifically for `done + nonterminal task`.
- **VALIDATE**: A focused unit test passes a planning task with `done` and asserts no response presentation and no reveal. Existing completion/error tests remain unchanged and pass.

### Task 7: Close catalog, durability, presentation, and privacy regressions

- **ACTION**: Add focused cross-layer tests and inspect all old names/unsafe focus paths.
- **IMPLEMENT**:
  - Search for `observe_desktop` and `observe_surface`; only historical plan/report text may remain. No live runtime or policy reference may remain.
  - Assert the frozen catalog digest changes naturally and a missing unified required tool fails before sampling.
  - Assert normalized observation metadata includes `route`, `surface`, `elements`, text, coordinate space when present, and screenshot image URL when present.
  - Assert `latestObservation` remains the same object seen in the tool result and subsequent stale observation IDs are rejected.
  - Add capture-guard tests for destroyed windows, state changes during capture, nested/overlapping preparation, and idempotent cleanup.
  - Add presentation sequence test: `voice committing -> task planning -> voice cleared -> task observing`, with no `done` and no `reveal` call.
  - Confirm no new log contains transcript, request text, screenshot base64, structured state, URL, or element text.
- **MIRROR**: Exact spy assertions in `execution-coordinator.test.ts`; static rendering/privacy assertions in `VoiceIsland.test.tsx`; protocol validation fixtures in `services/agent-runtime/test/protocol-and-graph.test.ts`.
- **IMPORTS**: Vitest only; use current helpers/stubs.
- **GOTCHA**: Do not “fix” failing persisted checkpoints by replaying or silently mutating their catalog. Existing graph mismatch is the safe behavior.
- **VALIDATE**: Focused test commands below pass and `git diff --check` is clean.

### Task 8: Run full release gates and packaged manual validation

- **ACTION**: Verify the feature in source tests and the actual Electron package.
- **IMPLEMENT**:
  - Run focused Vitest files for tool catalog/coordinator/runtime/presentation/voice routing.
  - Run the local agent runtime check.
  - Run root lint/typecheck/tests/security audit through `npm run check`.
  - Run `npm run package` as required by repository guidance.
  - Perform the manual matrix below with macOS Screen Recording/Accessibility granted, then repeat the permission-denied case.
  - Review the final diff and preserve unrelated `.media` and `.tours` changes.
- **MIRROR**: Repository `AGENTS.md` required verification.
- **IMPORTS**: None.
- **GOTCHA**: Dev-mode window behavior is insufficient proof; verify the packaged app because global shortcuts, auxiliary windows, permissions, and CUA embedding differ.
- **VALIDATE**: All automated gates pass and packaged voice-to-Scratch flow meets every acceptance criterion.

---

## Testing Strategy

### Unit and Integration Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Screen policy positive | `Làm sao làm bài tập Scratch này?` | `requiredInitialTool='observe_context'` | Vietnamese deictic context |
| Screen policy skip | `What is Scratch?` | No forced tool | Self-contained answer |
| Workspace isolation | Visible-context text + Workspace profile | No screen tool forced | Capability boundary |
| Unified catalog | Semantic available/unavailable | Exactly one `observe_context` observation tool | Dynamic availability |
| Auto surface success | External Scratch surface returned | No desktop capture/guard call | Fast path |
| Auto surface miss | No semantic/window observation | Guard -> desktop capture -> cleanup | Fallback |
| Desktop scope | Coordinate walkthrough | Skip surface, return coordinate-space screenshot | Guidance requirement |
| Region inspection | Current observation + valid region | Existing original-resolution crop path | Bounded image evidence |
| Invalid region contract | Missing ID or region | Parse/normalize error before dispatch | Strict input |
| CUA permission denial | Desktop fallback cannot connect | Truthful failed/unknown result; no pretend answer | Permission |
| Observation delivery | Screenshot + metadata | SDK receives text item + image item | Multimodal boundary |
| Grounded control | Control with latest ID | Resolves | Fresh state |
| Stale control | Different observation ID | Rejects before execution | Safety |
| Voice Task handoff | Task accepted while planning | Voice Island clears; projection is `thinking` | Reported regression |
| Voice Task working | Task observing/acting | Projection is `working` | State transition |
| Dictation complete | No task + Dictation complete | Existing short `done` dwell remains | Non-task behavior |
| Voice error | Task/no task + voice error | Error feedback remains | Recovery |
| Defensive presenter | `done` + planning task | No response presentation or main reveal | Out-of-order event |
| True completion | `done` + completed task | Existing companion response path | Regression |
| Capture cleanup error | CUA throws/aborts | All hidden auxiliary state released once | Exception safety |
| Concurrent guard | Two overlapping fallback captures | Windows restore only after final cleanup | Shared Electron state |

### Edge Cases Checklist

- [ ] Empty/whitespace request remains rejected by existing request schema
- [ ] English and Vietnamese visible-context phrases
- [ ] Navigation-first task that should choose its own tools
- [ ] Current-surface Activity launch without deictic request text
- [ ] Workspace task mentioning “this”
- [ ] Semantic capability absent
- [ ] No unique frontmost external window
- [ ] Frontmost window belongs to Tro or has a Tro title
- [ ] Browser semantic result without screenshot
- [ ] Native window accessibility result with elements
- [ ] Window-vision result with screenshot
- [ ] Desktop screenshot with negative virtual-display origin
- [ ] Missing Screen Recording permission
- [ ] Observation cancellation/timeout
- [ ] Voice Task starts while main Tro window is hidden
- [ ] Voice Task starts while main Tro window is visible but unfocused
- [ ] Voice Task submission fails before acceptance
- [ ] Dictation success/failure/unverified delivery
- [ ] Task immediately asks for clarification
- [ ] Task fails before first observation
- [ ] Multiple/nested observation preparations
- [ ] Auxiliary window destroyed while hidden
- [ ] Reduced motion: processing state remains understandable without animation

---

## Validation Commands

### Focused Static and Unit Validation

```bash
npx vitest run \
  src/main/agent/screen-context-policy.test.ts \
  src/main/application/task-application-service.test.ts \
  src/main/agent/runtime-tool-registry.test.ts \
  src/main/agent/cua-semantic-agent-tools.test.ts \
  src/main/agent/execution-coordinator.test.ts \
  src/main/agent/walkthrough-policy.test.ts \
  src/main/agent-runtime/agent-runtime-adapter.test.ts \
  src/main/presentation/desktop-observation-guard.test.ts \
  src/main/presentation/presentation-policy.test.ts \
  src/main/presentation/electron-presentation-presenter.test.ts \
  src/renderer/voice-route.test.ts \
  src/renderer/VoiceIsland.test.tsx
```

EXPECT: All focused tests pass, including `src/main/presentation/desktop-observation-guard.test.ts`.

```bash
npm --prefix services/agent-runtime run check
```

EXPECT: Agent runtime lint, typecheck, and tests pass.

### Repository Release Gates

```bash
npm run check
```

EXPECT: Agent runtime, admin build, runtime version checks, Rust engine checks, lint, TypeScript, Cargo formatting/lint/audit, Vitest, and Cargo tests pass subject only to documented existing allowed advisories/environment-skipped integration tests.

```bash
npm run package
```

EXPECT: Electron package completes successfully for the current platform.

```bash
npm audit --audit-level=high
npm --prefix services/agent-runtime audit --audit-level=high
git diff --check
```

EXPECT: No high-severity npm vulnerabilities and no whitespace errors.

### Manual Packaged Validation

- [ ] Put Scratch in front, keep Tro hidden, and start a global voice Task: “How do I do this Scratch exercise?”
- [ ] Voice Island is visible only during permission/listening/transcribing/sending and never takes focus.
- [ ] Once the task is accepted, Voice Island disappears and the companion shows the existing thinking ring/dots.
- [ ] Tro's main window does not show, move top, or gain focus during planning/observation.
- [ ] Task history shows an initial `observe_context` tool call, not `observe_desktop`/`observe_surface`.
- [ ] The observation returned to the model identifies Scratch and contains Scratch screenshot/text, not Tro's caption/main/companion UI.
- [ ] Repeat with semantic capability unavailable to exercise full desktop fallback and visually inspect capture cleanliness.
- [ ] Ask for a coordinate walkthrough and verify `scope='desktop'` provides guidance coordinates.
- [ ] Ask a self-contained question and verify no unnecessary initial capture occurs.
- [ ] Deny Screen Recording and verify truthful permission/error handling without claiming the screen was read.
- [ ] Run Dictation success and uncertain-delivery paths and verify their existing terminal feedback remains unchanged.
- [ ] Trigger a genuine clarification/error and verify intentional attention presentation still works.

---

## Acceptance Criteria

- [ ] The model-visible catalog contains exactly one screen observation tool named `observe_context`.
- [ ] The Agents SDK remains the planner and requests the tool; Electron/CUA remain the executor.
- [ ] Screen-dependent requests require `observe_context` before the first answer, while self-contained and Workspace requests preserve their existing paths.
- [ ] `scope='auto'` chooses the current non-Tro surface first and falls back to a prepared desktop screenshot.
- [ ] `scope='desktop'` remains available through the same tool for coordinate-grounded control/guidance.
- [ ] Successful observations return bounded metadata and an image to the model and update the latest grounded observation.
- [ ] Tro's own main/voice/companion/guidance/control windows do not appear in desktop fallback evidence.
- [ ] A successful voice Task clears the Voice Island and shows the existing thinking/processing indicator.
- [ ] A voice Task in planning/working never projects as `done` and never foregrounds the main window.
- [ ] A defensive presenter guard prevents `done + nonterminal task` from revealing Tro.
- [ ] Dictation terminal behavior and intentional attention/error/completion fallbacks remain intact.
- [ ] All focused tests, `npm run check`, and `npm run package` pass.

## Completion Checklist

- [ ] Code follows dotted host IDs and snake_case model names
- [ ] Strict schemas parse/refine every model/process boundary
- [ ] No duplicate observation aliases remain
- [ ] Observation fallback and cleanup are exception-safe
- [ ] No unknown action is replayed
- [ ] No screenshot/transcript/request text is logged or added to analytics
- [ ] Renderer stays sandboxed and preload remains narrow
- [ ] Existing companion loader is reused; no duplicate UI added
- [ ] Unrelated user-owned worktree changes are untouched
- [ ] Documentation/comments mentioning live old tool names are updated
- [ ] Plan can be implemented without further codebase discovery

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Surface observation lacks desktop coordinates for guidance | High if misrouted | High | Same tool exposes explicit desktop scope; normalization continues requiring coordinate space |
| Overlay suppression races another observation/state update | Medium | High | Serialize/reference-count guard, current-state restoration, idempotent `finally` cleanup |
| Main window is restored and covers the action target | Medium | High | Never reactivate main during background task/capture cleanup; only presentation policy may reveal it |
| Removing old names invalidates a persisted frozen catalog | Expected on upgrade | Medium | Existing graph/catalog mismatch fails closed; do not alias or replay |
| Semantic fast path unavailable on a machine/app | Medium | Low | `observe_context` remains available and falls back to desktop vision |
| Voice event ordering varies across renderer/main | Medium | Medium | Encode precedence in pure policy and add presenter-level nonterminal guard |
| Clearing Task success dwell removes useful feedback | Low | Low | Existing companion thinking state becomes the immediate acknowledgment; Dictation dwell remains |
| Full desktop permission denied | Medium | Medium | Return truthful failure/permission state; never fabricate visibility |

## Notes

- Historical commit `187c1fa` proved that initial observations can ground the first model response; the current local runtime needs the equivalent through its durable tool loop rather than a separate pre-attached input path.
- Historical commit `a476b4c` contains the previous desktop preparation pattern. Reuse its hide/settle/finally concept, but include the newer Voice Island, cursor buddy, guidance target, and control indicator surfaces and make restoration concurrency-safe.
- The “loading icon” the user remembers is still present: `PresentationState='thinking'` maps to companion `processing`, and `src/index.css:2311-2329, 2406-2416` renders its animated dots/ring. The regression is presentation ownership/precedence, not missing artwork.
