# Plan: Unified Cursor Buddy Coach

## Summary

Replace the current distributed guidance presentation—real CUA pointer movement,
desktop-pet motion, cursor-follower polling, target-marker state, callout state,
speech sequencing, and learner waiting coordinated from `src/index.ts`—with one
public `CursorBuddyController`. The controller will own a single explicit state
machine for follow, think, glide, visually demonstrate a click, highlight,
narrate, wait, pause, and return-to-user behavior while keeping the student's
operating-system cursor untouched.

“One system” means one domain owner and one public API. Electron still requires
separate internal surfaces for a click-through pointer/highlight and an
interactive callout, but those `BrowserWindow` details become private adapters;
no external caller coordinates them independently.

## User Story

As a primary-school student, I want Tro's Cursor Buddy to move to the correct
place, visually demonstrate where to click, highlight it, and explain the step
beside the pointer, so that I can follow the lesson without Tro taking control of
my real mouse cursor.

## Problem → Solution

Guidance currently mixes five presentation owners and uses screenshot pixels as
desktop points, causing real-pointer movement and misplaced highlights → create
one `CursorBuddyController`, map grounded targets into desktop coordinates at the
tool boundary, use only the virtual buddy for coaching motion, and expose one
cancellable `presentStep()` lifecycle to the execution coordinator.

## Metadata

- **Complexity**: Large
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 26 files (4 create, 18 update, 4 delete/move)
- **Working Tree Baseline**: Plan against the current working tree, including the
  uncommitted primary-school walkthrough implementation. Preserve the staged
  `.media/*` files, modified `.tours/feature-explainer-goal-lifecycle.tour`, and
  untracked `.tours/feature-explainer-narrated-teacher-loop.tour`.
- **Architecture Note**: `docs/CODEX-NAVIGATION-GUIDE.md`, referenced by the repo
  supplement, is absent in this checkout. This plan uses the root guidance,
  `docs/architecture.md`, and direct code traces instead.

---

## Product Semantics

### One public owner

Only `CursorBuddyController` may coordinate teaching-cursor position, coaching
callout placement, target highlight visibility, click demonstration, narration,
learner controls, and return to follow mode.

The rest of the application may only:

1. start/stop the controller with authenticated auxiliary-window lifecycle;
2. forward voice/task activity for immediate local feedback;
3. call `presentStep(step, context)` for one grounded coach step;
4. forward a validated learner action to `handleAction(request)`; and
5. ask the controller which surfaces should be restored after observation.

### Cursor ownership

- The student's OS pointer is read only while Cursor Buddy is in `following`
  mode. Coaching never invokes `driver.moveCursor`, `cua.executeCommand(point)`,
  or a physical click.
- Cursor Buddy is a transparent, click-through visual overlay. In a coach step it
  temporarily stops following the student, glides to the grounded target, and
  emits a short visual press/pulse to demonstrate “click here.”
- The demonstration does **not** mutate Scratch or another application. The
  learner performs the actual action. Future semantic activation without pointer
  movement is a separate explicitly authorized feature.
- When the step ends, is cancelled, or times out, Cursor Buddy samples the
  student's current pointer once, returns smoothly (or snaps for Reduce Motion),
  then resumes adaptive follow polling.

### Cursor Buddy state machine

```text
stopped
  ↓ start
following ←── return/cancel/timeout ──┐
  ↓ voice release / task work              │
thinking                                      │
  ↓ grounded presentStep                   │
gliding → demonstrating → explaining → waiting
                                      ↕ paused
                                      ↺ repeat speech
                                      → learner change/continue
```

Invariants:

- At most one active `presentStep()` per task and one active narration globally.
- A newer step or abort signal cancels the previous glide, click pulse, speech,
  timers, and gate before changing the visible state.
- `following` is the only state that samples `screen.getCursorScreenPoint()` on
  a schedule.
- `gliding`, `demonstrating`, `explaining`, `waiting`, and `paused` pin the virtual
  buddy independently of the real pointer.
- The callout follows the same virtual anchor during the glide and remains beside
  the buddy at the target; it never jumps to an unrelated screen edge.
- Highlight appears only after arrival, and all overlay coordinates are desktop
  DIP coordinates rather than screenshot pixels.

---

## UX Design

### Before

```text
Model target (0–1000)
       ↓
screenshot pixel x/y
       ├─→ CUA point ─→ moves student's real cursor
       ├─→ desktop pet glides independently
       ├─→ marker treats screenshot pixels as screen DIPs
       └─→ chat appears in another independently positioned window

Result: wrong bottom-right target on Retina, two Tro visuals, detached chat,
        and several seconds before meaningful feedback.
```

### After

```text
Voice released
  → Cursor Buddy loading ring + local “Mình đang nhìn bài…” immediately

Fresh screenshot + model target (0–1000)
  → normalized → screenshot pixels → desktop DIPs
  → CursorBuddyController.presentStep(...)
       ├─ hook appears beside buddy and speech begins
       ├─ virtual buddy + mini chat glide together
       ├─ precise highlight appears on arrival
       ├─ buddy performs a visual click pulse (no OS input)
       ├─ instruction + reason are spoken
       └─ controller waits for learner/replay/pause/continue

Student's real pointer remains exactly where the student leaves it.
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Voice release | Busy state exists but no nearby explanatory chat until model output | Existing Cursor Buddy immediately shows its ring and a short localized thinking callout | No LLM or TTS required for the acknowledgement |
| Coaching movement | CUA moves real pointer and desktop pet also glides | Only virtual Cursor Buddy glides | Desktop pet remains a pet and never acts as the teacher pointer |
| Target coordinates | Screenshot pixels reused as desktop coordinates | Explicit normalized → screenshot → desktop conversion | Covers Retina and non-zero/negative display origins |
| Click instruction | Real `point` side effect plus marker | Visual Cursor Buddy press/pulse only | Learner keeps control of the application |
| Callout | Positioned separately near the target before/while movement | Anchored to Cursor Buddy and repositioned with the same animation frames | Lock side for one glide to prevent edge flipping |
| Highlight | Independent window state managed by globals | Private controller adapter revealed on arrival | Tight region or bounded 76 DIP point marker |
| Speech | Standalone sequence function invoked from `index.ts` | Controller owns hook/glide/highlight/instruction ordering | `CompanionNarrationService` remains the sole audio transport |
| Learner controls | Main globals mutate callout phase and gate | Controller validates active task and owns phase changes | Existing narrow IPC remains |
| Cancellation | Multiple cleanup functions and globals | One idempotent controller cancellation path | Always restores follow mode and cancels narration |

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Evidence |
|---|---|---|---|
| Similar implementation | `src/main/companion/task-pet-service.ts:60-68,96-163` | Stateful service with injected callbacks/timers and explicit `start`/`stop` lifecycle | `TaskPetService` keeps policy testable without importing Electron |
| Existing follow logic | `src/main/companion/cursor-buddy-follow-policy.ts:1-35` | Pure adaptive polling policy | 16 ms while moving, 125 ms idle, 250 ms active tail |
| Existing movement | `src/main/companion/companion-position.ts:73-111` | Pure distance-aware duration and curved interpolation | `guidanceGlideDuration` and `interpolateGuidancePosition` |
| Existing layout | `src/main/companion/companion-position.ts:128-154,251-343` | Clamp pointer, callout, and marker to selected display | `placeCompanionNearCursor`, `placeGuidanceCallout`, `placeGuidanceTargetMarker` |
| Current cursor owner | `src/index.ts:2671-2763` | Main-process loop reads real cursor and moves buddy window | `positionCursorBuddy()` and `wakeCursorBuddyFollowing()` |
| Current guidance owner | `src/index.ts:1429-1727` | Globals independently coordinate callout, pet glide, target, narration, and gate | `presentCoachGuidance()` plus `presentCompanionAction()` |
| Real cursor defect | `src/main/agent/execution-coordinator.ts:248-256` | `task.guidance` dispatches a native CUA point before presentation | `cua.executeCommand(... { kind: 'point' })` |
| Coordinate defect | `src/main/agent/runtime-tool-registry.ts:748-796` | Guidance maps normalized coordinates only to screenshot pixels | `mapNormalizedPointToScreenshot` result is stored as `input.x/y` |
| Correct coordinate utility | `src/main/agent/execution-contracts.ts:230-330` | Dedicated screenshot-to-desktop mapping includes scale and display origin | `mapScreenshotPointToDesktop`, `mapScreenshotRegionToDesktop` |
| CUA semantics | `src/main/cua/cua-service.ts:841-869` | Physical desktop commands explicitly call driver `moveCursor` | Guidance must not enter this adapter |
| Speech service | `src/main/voice/companion-narration-service.ts:52-194` | Injected service returns cancellable handle and publishes bounded descriptor | `begin(text, signal, taskId)` |
| Learner wait | `src/main/presentation/learner-action-gate.ts:32-113` | Bounded, cancellable local wait with stable fingerprint and controls | Reuse unchanged behind controller |
| Renderer contract | `src/shared/contracts.ts:1768-1860` | Schema-first bounded companion state, guidance, and action types | Zod parse at both IPC boundaries |
| Narrow preload | `src/preload.ts:951-1070` | Named getters/events parse unknown IPC payloads before renderer use | No raw `ipcRenderer` or CUA exposure |
| Trusted IPC | `src/main/ipc/register-ipc.ts:1033-1046` | Verify exact auxiliary sender, sign-in, then parse action | Preserve for learner controls |
| Cursor renderer | `src/renderer/CursorBuddy.tsx:13-102` | Pure `CursorBuddyView` plus narrow subscriptions | Extend it with one cursor-specific snapshot |
| Callout renderer | `src/renderer/GuidanceCallout.tsx:73-140,310-327,439-488` | Localized status and accessible Replay/Pause/Done controls | Keep presentation-only responsibility |
| Highlight renderer | `src/renderer/GuidanceTargetMarker.tsx:1-18` | Non-interactive, `aria-hidden` target visual | Keep as private view surface |
| Reduced motion | `src/main/companion/companion-position.ts:73-81`; `src/index.css:1572-1577` | Snap host movement and disable ambient CSS animation | Apply to buddy glide and click pulse |
| Error handling | `src/main/presentation/desktop-observation-guard.ts:37-99` | Idempotent cleanup, best-effort window teardown, errors never mask primary outcome | Mirror in controller cancellation/disposal |
| Logging | `src/main/voice/companion-narration-service.ts:181-186`; `src/index.ts:1634-1642` | Namespaced event with bounded structured metadata | Add phase/duration/task ID, never pointer coordinates or screen content |
| Configuration | `src/index.ts:545-564,1846-1918` | Bounded constants and authenticated auxiliary lifecycle | Construct/start/stop controller here |
| Test structure | `src/main/companion/task-pet-service.test.ts:135-151`; `src/main/presentation/coach-presentation-sequence.test.ts:5-43` | Dependency fakes, fake timers, exact event ordering | Use deterministic controller harness |
| Dependencies | `package.json` | Electron 43, React 19, Zod 4, Vitest 4 are sufficient | No new runtime dependency |
| Documentation | `docs/architecture.md:46-84`; `docs/conversational-task-execution.md:22-30` | Current docs explicitly describe separate buddy/pet and pet-led guidance | Must be updated with Cursor Buddy ownership |

---

## Entry, Data, State, and Contract Traces

### Entry point

```text
Renderer voice release
  use-push-to-talk.ts setStatus('processing')
  → App.tsx setCompanionVoiceActivity(...)
  → preload parsed DesktopApi
  → register-ipc trusted main handler
  → updateCompanionVoiceActivity(...)
  → CursorBuddyController.handleVoiceActivity(...)

Transcribed task
  → Agents SDK observe_context
  → show_guidance(normalized target + bounded copy)
  → RuntimeToolRegistry resolves authoritative observation
  → TaskExecutionCoordinator task.guidance adapter
  → CursorBuddyController.presentStep(...)
  → learner activity result returns to Agents SDK
```

### Coordinate data flow

```text
Model: normalized 0–1000
  → mapNormalizedPoint/RegionToScreenshot
CUA evidence space: physical screenshot pixels
  → mapScreenshotPoint/RegionToDesktop
Electron presentation space: desktop DIPs + screenX/screenY origin
  → controller clamps to screen.getDisplayNearestPoint(...).bounds
```

Use explicit field names in trusted input:

```ts
export interface GuidanceToolInput {
  // existing copy/evidence fields omitted
  screenPoint: Point;
  screenRegion?: DesktopRegion;
}
```

Do not retain ambiguous `x`, `y`, and `region` fields after model normalization.
Model-visible `x/y/region` remain normalized 0–1000 exactly as today.

### Controller data flow

```ts
export interface CursorBuddyStep {
  baselineFingerprint: string;
  copy: CompanionCoachCopy;
  language: AppLanguage;
  screenPoint: Point;
  screenRegion?: Rectangle;
  target?: string;
  taskId: string;
}

export class CursorBuddyController {
  start(): void;
  stop(): void;
  handleActivity(input: CursorBuddyActivity): void;
  presentStep(
    step: CursorBuddyStep,
    context: CursorBuddyStepContext,
  ): Promise<GuidancePresentationResult>;
  handleAction(request: CompanionGuidanceActionRequest): boolean;
  dispose(): void;
}
```

`CursorBuddyStepContext` supplies the task `AbortSignal` and an `observe()`
callback. The controller owns presentation; CUA remains responsible only for
fresh screen observation inside the learner gate.

### State ownership

Move these guidance-related globals out of `src/index.ts` and into the controller:

- cursor follow timer/active tail/current buddy position;
- active coach task and generation token;
- active glide frame/timer and pinned buddy position;
- active guidance callout and phase;
- active target bounds and click-pulse timer;
- active narration handle;
- learner-action routing for the active task;
- whether coach overlays should be restored after an observation.

Keep these separate because they are different product domains:

- desktop pet rest/wander/drag/customization;
- companion responses and clarification precedence;
- CUA desktop-control indicator and external action execution;
- voice transcription and ElevenLabs transport implementations.

### IPC contract

Replace cursor buddy's split position + shared companion-state subscriptions with
one cursor-specific snapshot:

```ts
CursorBuddySnapshotSchema = z.object({
  phase: z.enum([
    'following', 'thinking', 'gliding', 'demonstrating',
    'explaining', 'waiting', 'paused',
  ]),
  position: CompanionPositionSchema,
  busy: z.boolean(),
}).strict();
```

Expose only `getCursorBuddySnapshot()` and `onCursorBuddySnapshotChange()` to the
sandboxed cursor renderer. Keep guidance actions as the existing parsed, trusted
IPC request. Do not expose raw window handles, timers, screen APIs, speech APIs,
or CUA.

---

## External Documentation

No external research needed—the change uses established internal Electron,
Zod, narration, observation, and Vitest patterns. No dependency or provider API
changes are required.

---

## Patterns to Mirror

### NAMING_CONVENTION

SOURCE: `src/main/companion/task-pet-service.ts:60-68,96-131`

```ts
interface TaskPetDependencies {
  canPresent(): boolean;
  present(nudge: CompanionPetNudgeDraft): boolean;
  dismiss(id: string): void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export class TaskPetService {
  constructor(private readonly dependencies: TaskPetDependencies) {}
}
```

Create `CursorBuddyControllerDependencies` and inject Electron-facing callbacks,
clock/frame functions, narration, and the learner gate. Use PascalCase for the
class/type and verb-based public methods.

### ERROR_HANDLING

SOURCE: `src/main/presentation/desktop-observation-guard.ts:37-72,75-99`

```ts
try {
  await this.options.settle();
} catch (error) {
  this.activeLeases = 0;
  this.restoreHiddenSurfaces();
  throw error;
}
```

Controller cleanup must be idempotent and run from `finally`. Window cleanup is
best effort, but narration/gate failures propagate as the primary result. Abort
must retain the standard `AbortError` name.

### LOGGING_PATTERN

SOURCE: `src/main/voice/companion-narration-service.ts:181-186`

```ts
this.logger.info('[voice:tts] stream.requested', {
  characterCount: text.length,
  mode: configured ? 'elevenlabs' : 'system',
  speechId: id,
  ...(taskId ? { taskId } : {}),
});
```

Use `[cursor-buddy] guidance.started|phase|completed|cancelled` with task ID,
phase, animation duration, and reduced-motion flag. Never log absolute pointer
coordinates, screenshot content, learner text, or narration text.

### LOCAL_STATEFUL_SERVICE_PATTERN

SOURCE: `src/main/companion/companion-response-controller.ts:48-75`

```ts
export class CompanionResponseController {
  private activeTaskId: string | null = null;
  private currentCard: CompanionResponseCard | null = null;

  get current(): CompanionResponseCard | null {
    return this.currentCard;
  }
}
```

Keep the active task/step and current snapshot private. Publish immutable parsed
snapshots through injected callbacks; do not let `index.ts` mutate controller
state.

### PURE_GEOMETRY_PATTERN

SOURCE: `src/main/companion/companion-position.ts:73-111,251-343`

```ts
export function guidanceGlideDuration(
  from: Point,
  to: Point,
  settings: GuidanceAnimationSettings,
): number { /* bounded distance-aware duration */ }
```

Move/rename Cursor Buddy-specific motion/layout helpers into
`cursor-buddy-geometry.ts`. Keep them pure and cover Retina-independent desktop
DIP inputs, edge clamping, negative-origin displays, stable callout side, and
Reduce Motion.

### SCHEMA_FIRST_BOUNDARY

SOURCE: `src/shared/contracts.ts:1827-1860`

```ts
export const CompanionGuidanceActionRequestSchema = z
  .object({
    action: CompanionGuidanceActionSchema,
    taskId: z.string().uuid(),
  })
  .strict();
```

Define the cursor snapshot in shared contracts, infer the type at the bottom,
and parse in main publication, preload reception, getter response, and renderer.

### NARROW_PRELOAD_EVENT

SOURCE: `src/preload.ts:993-1023`

```ts
onGuidanceChange(listener) {
  const eventHandler = (_event, value: unknown): void => {
    listener(CompanionGuidanceSchema.nullable().parse(value));
  };
  ipcRenderer.on(IPC_CHANNELS.companionGuidanceChanged, eventHandler);
  return () => ipcRenderer.removeListener(
    IPC_CHANNELS.companionGuidanceChanged,
    eventHandler,
  );
}
```

Use one getter/event pair for the Cursor Buddy snapshot and remove the old split
position/shared-state dependency from the Cursor Buddy renderer.

### TEST_STRUCTURE

SOURCE: `src/main/presentation/coach-presentation-sequence.test.ts:5-42`

```ts
const events: string[] = [];
const sequence = runCoachPresentationSequence({
  glide: () => new Promise<void>((resolve) => { /* capture completion */ }),
  highlight: () => events.push('highlight'),
  speak,
  // ...
});
expect(events).toEqual(['speak:Ready?', 'glide']);
```

Use fake timers and an ordered event trace to prove concurrency, arrival order,
click pulse, speech non-overlap, cancellation, and return-to-follow behavior.

### REPOSITORY_PATTERN

N/A—this feature has no persistence or data repository. Do not add storage,
database state, analytics payloads, or task-history fields for cursor positions.

---

## Strategic Design

### Approach

1. Introduce a cursor-specific state contract and pure desktop-DIP geometry.
2. Implement one injected `CursorBuddyController` as the sole presentation
   orchestrator.
3. Compose Electron windows, narration, observation, and learner gate as private
   adapters in `src/index.ts`; callers receive no surface handles.
4. Remove the CUA `point` side effect from `task.guidance` and pass explicit
   desktop coordinates to the controller.
5. Make the Cursor Buddy renderer consume one snapshot and render thinking,
   movement, click pulse, waiting, and pause states.
6. Prewarm hidden coach surfaces after authentication and show immediate local
   thinking feedback on voice processing, avoiding a blank five-second wait.
7. Delete the superseded standalone coach-sequence module and guidance-specific
   desktop-pet movement path.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Keep current functions and only fix coordinate scale | Rejected | Leaves real-cursor movement, split ownership, and detached chat intact |
| One giant full-screen interactive Electron window | Rejected | A click-through pointer/highlight and clickable learner controls need different input behavior; a full-screen interactive window would block the student's app |
| Let `CursorBuddyController` directly import and construct every `BrowserWindow` | Rejected | Makes unit tests depend on Electron and turns the class into an untestable god object |
| Move the desktop pet instead of Cursor Buddy | Rejected | Contradicts the product model: pet is ambient; Cursor Buddy is Tro's action pointer |
| Use CUA point then restore the real cursor | Rejected | Still hijacks the student's pointer, can race their movement, and is visually disruptive |
| Make Cursor Buddy perform an actual click | Deferred | Generic OS clicking without pointer movement is not guaranteed; coaching remains non-mutating and uses a visual click demonstration |

### Scope

- One public Cursor Buddy controller and explicit phase state machine.
- Virtual buddy follow/glide/click-pulse/wait/return behavior.
- Buddy-anchored callout, target highlight, narration, replay/pause/continue.
- Correct desktop coordinate mapping including Retina and multi-monitor origins.
- Removal of physical pointer movement from `task.guidance`.
- Immediate local thinking indicator/callout from voice processing.
- Narrow cursor-specific IPC snapshot and renderer visuals.
- Cleanup of obsolete guidance motion functions and documentation.

### NOT Building

- Actual automated clicks during learner walkthroughs.
- Accessibility/semantic activation of external application controls.
- A new LLM call, pre-generated instruction list, or alternate agent loop.
- Changes to CUA's generic `desktop.control` behavior for explicitly requested
  computer automation.
- New TTS provider or modifications to ElevenLabs transport.
- New persistence, analytics, or network transmission of cursor coordinates.
- A literal single Electron window that blocks the desktop.
- Redesign of the ambient desktop pet, companion customization, clarification,
  or completion response cards.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `src/index.ts` | 540-699, 830-1040, 1380-1728, 1846-1990, 2640-2805, 3028-3382 | Current globals, surface lifecycle, guidance orchestration, cursor following, and cleanup to extract |
| P0 | `src/main/agent/runtime-tool-registry.ts` | 23-37, 105-117, 258-307, 694-803 | Grounded tool input and the coordinate conversion defect |
| P0 | `src/main/agent/execution-coordinator.ts` | 31-75, 225-274 | Presentation injection and physical CUA point call to remove |
| P0 | `src/main/agent/execution-contracts.ts` | 225-330 | Authoritative screenshot-to-desktop mapping utilities |
| P0 | `src/main/cua/cua-service.ts` | 841-869 | Proof that native point/click routes move the real cursor |
| P0 | `src/renderer/CursorBuddy.tsx` | all | Cursor-specific renderer to make snapshot-driven |
| P0 | `src/main/voice/companion-narration-service.ts` | 52-194, 250-310 | Cancellable single-current narration lifecycle |
| P0 | `src/main/presentation/learner-action-gate.ts` | all | Existing bounded learner wait/control mechanism to reuse |
| P1 | `src/main/companion/cursor-buddy-follow-policy.ts` | all | Adaptive follow cadence to fold behind controller |
| P1 | `src/main/companion/companion-position.ts` | 1-180, 251-343 | Pure motion and layout helpers to move/rename |
| P1 | `src/main/presentation/coach-presentation-sequence.ts` | all | Ordering semantics to preserve before deleting module |
| P1 | `src/shared/contracts.ts` | 1500-1509, 1768-1860, 2279-2318 | Existing shared states, cursor positions, guidance copy, and actions |
| P1 | `src/shared/desktop-api.ts` | 124-152, 436-460 | Cursor/companion IPC channel and API surface |
| P1 | `src/preload.ts` | 951-1070 | Parsed auxiliary-renderer boundary |
| P1 | `src/main/ipc/register-ipc.ts` | 1015-1065, 1212-1225 | Trusted sender and voice-activity entry points |
| P1 | `src/renderer/GuidanceCallout.tsx` | 73-140, 310-327, 439-488 | Localized coach phase and controls |
| P1 | `src/renderer/GuidanceTargetMarker.tsx` | all | Non-interactive target visual |
| P1 | `src/index.css` | 838-923, 1455-1577, reduced-motion section | Cursor busy state, target visual, and animation accessibility |
| P1 | `src/renderer/use-push-to-talk.ts` | 63, 440-480, 748-775 | Immediate processing state and existing one-second confirmation delay |
| P1 | `src/renderer/App.tsx` | 2359-2384 | Voice activity forwarded immediately to main |
| P2 | `src/main/companion/task-pet-service.ts` | 60-68, 96-163 | Injected lifecycle service pattern |
| P2 | `src/main/presentation/desktop-observation-guard.ts` | all | Overlay hiding/restoration and idempotent cleanup |
| P2 | `src/main/companion/companion-response-controller.ts` | 37-75 | Overlay precedence and private-current-state pattern |
| P2 | `src/main/agent/execution-contracts.test.ts` | 16-90 | Retina and negative-origin mapping fixtures |
| P2 | `src/main/agent/runtime-tool-registry.test.ts` | 87-170, 232-280 | Strict tool schema and grounding tests |
| P2 | `src/main/agent/execution-coordinator.test.ts` | 192-270 | Guidance dispatch regression to invert |
| P2 | `src/renderer/CursorBuddy.test.ts` | all | Happy DOM subscription/accessibility/style pattern |
| P2 | `src/main/ipc/register-ipc.test.ts` | 928-945 | Trusted learner-action IPC test |
| P2 | `docs/architecture.md` | 46-84 | Outdated buddy/pet guidance ownership description |
| P2 | `docs/conversational-task-execution.md` | 22-30 | Outdated “Electron moves the companion” text |

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/main/companion/cursor-buddy-controller.ts` | CREATE | Sole public owner for follow, coach presentation, speech, gate, and cleanup |
| `src/main/companion/cursor-buddy-controller.test.ts` | CREATE | Deterministic state/order/cancellation/no-real-cursor coverage |
| `src/main/companion/cursor-buddy-geometry.ts` | CREATE | Pure follow/glide/callout/marker desktop-DIP geometry |
| `src/main/companion/cursor-buddy-geometry.test.ts` | CREATE | Edge, Retina-independent DIP, negative-display, and reduced-motion coverage |
| `src/main/companion/cursor-buddy-follow-policy.ts` | DELETE/MOVE | Fold pure cadence into cursor-buddy geometry/controller subsystem |
| `src/main/companion/cursor-buddy-follow-policy.test.ts` | DELETE/MOVE | Move assertions to new geometry/controller tests |
| `src/main/presentation/coach-presentation-sequence.ts` | DELETE | Sequence becomes private controller behavior |
| `src/main/presentation/coach-presentation-sequence.test.ts` | DELETE | Ordering coverage moves to controller tests |
| `src/main/companion/companion-position.ts` | UPDATE | Remove guidance-only Cursor Buddy geometry; retain desktop-pet rest/wander/drag functions |
| `src/main/companion/companion-position.test.ts` | UPDATE | Remove moved guidance assertions; retain pet tests |
| `src/main/agent/runtime-tool-registry.ts` | UPDATE | Produce unambiguous `screenPoint/screenRegion` using both coordinate transforms |
| `src/main/agent/runtime-tool-registry.test.ts` | UPDATE | Assert Retina and display-origin desktop guidance coordinates |
| `src/main/agent/execution-coordinator.ts` | UPDATE | Stop calling CUA point and delegate the full step to controller presenter |
| `src/main/agent/execution-coordinator.test.ts` | UPDATE | Assert zero native pointer commands and exact presentation result |
| `src/shared/contracts.ts` | UPDATE | Add strict cursor snapshot phase contract and inferred type |
| `src/shared/contracts.test.ts` | UPDATE | Bounds/strictness/phase parsing coverage |
| `src/shared/desktop-api.ts` | UPDATE | Replace split cursor position/shared-state API with one cursor snapshot API |
| `src/preload.ts` | UPDATE | Parse cursor snapshot getter/event at renderer boundary |
| `src/main/ipc/register-ipc.ts` | UPDATE | Serve controller snapshot through trusted cursor sender; keep learner actions narrow |
| `src/main/ipc/register-ipc.test.ts` | UPDATE | Validate snapshot and existing learner-action trust rules |
| `src/index.ts` | UPDATE | Compose controller adapters and remove distributed guidance/cursor globals/functions |
| `src/renderer/CursorBuddy.tsx` | UPDATE | Render one cursor snapshot, click pulse, and phase-specific accessibility labels |
| `src/renderer/CursorBuddy.test.ts` | UPDATE | Snapshot subscription, phase visuals, cleanup, and reduced-motion tests |
| `src/renderer/GuidanceCallout.tsx` | UPDATE | Support local thinking phase and compact buddy-anchored coach copy without owning lifecycle |
| `src/renderer/guidance-callout-status.test.ts` | UPDATE | Thinking/guiding/waiting/paused labels and controls |
| `src/index.css` | UPDATE | Glide-safe transform, click pulse, thinking, and reduced-motion styling |
| `docs/architecture.md` | UPDATE | Document Cursor Buddy as sole walkthrough pointer; pet remains ambient |
| `docs/conversational-task-execution.md` | UPDATE | Document non-mutating virtual click and no OS cursor movement |

The table lists source/test move endpoints separately so implementation can
preserve history and review clarity.

---

## Step-by-Step Tasks

### Task 1: Lock the controller contract and invariants with tests

- **ACTION**: Add failing tests for one Cursor Buddy state machine before moving production logic.
- **IMPLEMENT**:
  - Define dependency fakes for `getUserCursor`, `getDisplayBounds`,
    `getAnimationSettings`, `setCursorPosition`, `publishSnapshot`,
    `show/move/hideCallout`, `show/hideHighlight`, `speak`, `waitForLearner`,
    animation-frame/timer functions, and logger.
  - Specify phases: following, thinking, gliding, demonstrating, explaining,
    waiting, paused.
  - Test hook + glide concurrency, arrival → highlight → click pulse order,
    instruction/reason after hook, repeat without new model work, pause/resume,
    timeout, stable learner change, abort, replacement by a newer step, and
    idempotent stop/dispose.
  - Assert `getUserCursor` is not called while a step is pinned except once when
    returning to follow mode.
- **MIRROR**: `coach-presentation-sequence.test.ts` event trace and
  `task-pet-service.test.ts` dependency-injection/fake-timer harness.
- **IMPORTS**: Vitest `describe/expect/it/vi`; shared guidance/action types;
  geometry types; `LearnerActionOutcome` type only.
- **GOTCHA**: Attach rejection expectations before aborting to avoid unhandled
  promise warnings. Always restore real timers in `afterEach`.
- **VALIDATE**: Focused controller tests fail for missing implementation, then
  pass without Electron or network access.

### Task 2: Consolidate pure Cursor Buddy geometry

- **ACTION**: Move Cursor Buddy follow cadence, follow placement, coach glide,
  callout anchoring, and marker placement into `cursor-buddy-geometry.ts`.
- **IMPLEMENT**:
  - Preserve 16/125/250 ms adaptive cadence.
  - Rename generic guidance helpers to Cursor Buddy vocabulary.
  - Accept desktop DIP `Point/Rectangle/Size`; never accept screenshot pixels.
  - Add stable-side callout placement so the bubble does not switch sides during
    a glide near a display edge.
  - Place the buddy so its visual pointer tip, not the 44×44 window center,
    indicates `screenPoint`; document the asset's tip offset as one constant.
  - Clamp target marker and callout to the selected display, including negative
    origins and small displays.
  - Preserve Reduce Motion snap behavior.
- **MIRROR**: Existing pure functions in `companion-position.ts` and follow policy.
- **IMPORTS**: No Electron imports; local `Point`, `Rectangle`, `Size`, and
  `GuidanceAnimationSettings` types.
- **GOTCHA**: The window's top-left is not the target. Centralize the cursor asset
  tip offset to prevent repeated half-size/Retina mistakes.
- **VALIDATE**: Geometry tests cover four corners, both callout sides, 2× Retina
  source mapped before entry, negative `screenX/screenY`, and reduced motion.

### Task 3: Implement `CursorBuddyController`

- **ACTION**: Create the sole orchestration class using the tests from Task 1.
- **IMPLEMENT**:
  - `start()` prewarms hidden surfaces, publishes following state, and starts
    adaptive follow scheduling.
  - `handleActivity()` maps voice processing/task working to immediate local
    thinking state only when no higher-priority interaction/guidance is active.
  - `presentStep()` cancels prior generation, pins the buddy, selects one callout
    side, displays hook copy beside the buddy, starts hook narration, animates
    buddy and callout from the same frame progress, reveals highlight and visual
    click pulse on arrival, waits for hook completion, narrates instruction +
    reason, then enters learner waiting.
  - Reuse `LearnerActionGate` for stable observation, repeat, pause, resume, and
    explicit continue. Repeating replays bounded copy without calling the model.
  - `finally` clears highlight/callout/speech, samples current user cursor, returns
    virtual buddy, and resumes follow unless stopped.
  - Use a generation counter plus abort listener so stale frames/audio cannot
    overwrite a new step.
  - Expose immutable `currentSnapshot` for initial renderer fetch.
- **MIRROR**: `TaskPetService` lifecycle, `CompanionNarrationService` handle,
  `DesktopObservationGuard` idempotent cleanup.
- **IMPORTS**: Shared cursor/guidance schemas and types; learner gate; pure Cursor
  Buddy geometry. No React, IPC, CUA driver, or model imports.
- **GOTCHA**: `CompanionNarrationService.begin()` cancels the globally current
  narration. Do not begin instruction speech until hook is terminal; cancellation
  must not accidentally cancel a newer controller generation.
- **VALIDATE**: All controller unit tests pass and coverage includes every public
  phase transition and abort path.

### Task 4: Correct the grounded target coordinate boundary

- **ACTION**: Convert guidance targets through both coordinate spaces before they
  reach presentation.
- **IMPLEMENT**:
  - Keep model-visible `x/y/region` normalized 0–1000.
  - In `RuntimeToolRegistry.normalize`, create screenshot point/region first,
    then call `mapScreenshotPointToDesktop` and
    `mapScreenshotRegionToDesktop` with the authoritative observation metadata.
  - Return trusted `GuidanceToolInput.screenPoint/screenRegion`; remove ambiguous
    trusted `x/y/region` fields.
  - Keep observation ID/fingerprint and bounded copy unchanged.
  - Update action parameters to use explicit `screenX/screenY` names only if they
    remain necessary for local audit; do not log them.
- **MIRROR**: Existing mapping pipeline in `execution-contracts.test.ts:16-90`.
- **IMPORTS**: Both normalized-to-screenshot and screenshot-to-desktop helpers.
- **GOTCHA**: CUA physical commands still require screenshot pixels. Change only
  `show_guidance`; do not alter `control_desktop` mapping.
- **VALIDATE**: Registry test maps normalized `{500,200}` with 2000×1000
  screenshot and 1000×500 screen to desktop `{500,100}`, plus origin offsets.

### Task 5: Remove physical cursor movement from coaching execution

- **ACTION**: Make `task.guidance` a local presentation adapter, not a CUA point command.
- **IMPLEMENT**:
  - Delete `cua.executeCommand({kind:'point'})` from the guidance adapter.
  - Await `presentGuidance()` exactly once.
  - Return `confirmed` when presentation ran, `not_executed` when no presenter is
    available, and preserve learner activity/expected outcome evidence.
  - Keep CUA observation available inside the injected `observe()` callback used
    by the learner gate; no desktop-control indicator should appear for coaching.
- **MIRROR**: Other local adapters in `execution-coordinator.ts` that return their
  own typed outcome without invoking unrelated capabilities.
- **IMPORTS**: `GuidanceToolInput`, existing tool result types only.
- **GOTCHA**: Never fabricate a native result by spreading an absent CUA receipt.
  Timeout means the guidance was presented but learner activity timed out.
- **VALIDATE**: Coordinator test asserts `cua.executeCommand` was never called,
  presenter was called once with desktop coordinates, and outcome data is exact.

### Task 6: Compose private Electron adapters and remove distributed globals

- **ACTION**: Instantiate and wire the controller in `src/index.ts`.
- **IMPLEMENT**:
  - Inject cursor window positioning for native macOS/Linux and overlay-local
    Windows coordinates behind one `setCursorPosition` callback.
  - Inject callout create/update/move/interactive callbacks, marker callbacks,
    display selection, animation settings, narration, gate, and observation.
  - Forward `presentGuidance` directly to `cursorBuddyController.presentStep()`.
  - Forward validated guidance actions to `controller.handleAction()`.
  - Forward voice activity/task state for immediate thinking feedback.
  - Start/prewarm after authenticated auxiliary enable; stop/dispose on sign-out,
    app shutdown, and cursor window destruction.
  - Register cursor/callout/marker windows with `DesktopObservationGuard`; ask the
    controller whether each logical surface should be restored.
  - Delete guidance-specific `CompanionGlide`, `presentCompanionAction`,
    `companionTargetForCommand`, `showGuidancePresentation`,
    `presentCoachGuidance`, `updateCoachGuidancePhase`, and corresponding globals.
  - Leave desktop-pet wander/drag/rest behavior intact.
- **MIRROR**: Existing authenticated auxiliary lifecycle at
  `src/index.ts:1846-1918` and observation surfaces at `662-699`.
- **IMPORTS**: `CursorBuddyController`, cursor geometry types, existing Electron
  `screen/systemPreferences/BrowserWindow`, narration and gate instances.
- **GOTCHA**: Guidance callout shares a window with clarification/response/pet
  content. Respect `selectCompanionOverlayMode` priority and never replace an
  active clarification. Keep interaction controls clickable only while waiting.
- **VALIDATE**: Typecheck proves no removed global references; focused main/IPC
  tests prove lifecycle cleanup and overlay precedence.

### Task 7: Unify the cursor renderer boundary and visual states

- **ACTION**: Make `CursorBuddy` render one cursor-specific snapshot.
- **IMPLEMENT**:
  - Add `CursorBuddySnapshotSchema` and inferred type.
  - Replace `getCursorBuddyPosition` + `onCursorBuddyPositionChange` + shared
    `onStateChange` usage with `getCursorBuddySnapshot` +
    `onCursorBuddySnapshotChange`.
  - Render accessible phase labels and `aria-busy` only for thinking/work.
  - Add visual classes for gliding, demonstrating click, explaining, waiting,
    and paused. The click pulse must be transform/opacity only.
  - Retain the existing loading ring and ensure every animation has a static
    Reduce Motion state.
  - Keep the renderer sandboxed; it never computes screen coordinates or owns
    timers beyond CSS presentation.
- **MIRROR**: Existing `CursorBuddyView` pure component and parsed preload event.
- **IMPORTS**: New shared snapshot type/schema only.
- **GOTCHA**: Do not reuse `CompanionState` for cursor phases; that would make the
  ambient pet animate as if it were clicking/guiding.
- **VALIDATE**: Happy DOM tests verify initial getter-after-subscribe order,
  updates, unsubscribe, labels, click-pulse class, and CSS reduced motion.

### Task 8: Anchor the compact chat and preserve learner controls

- **ACTION**: Keep `GuidanceCallout` presentation-only while making its position
  controller-owned and Cursor Buddy-relative.
- **IMPLEMENT**:
  - Add a non-task local thinking callout state with localized fixed text:
    `I'm looking at your work…` / `Mình đang nhìn bài của em…`.
  - During glide show the short hook rather than the full combined description.
  - At arrival update to instruction + reason and activate controls only after
    narration presentation enters waiting.
  - Move the callout window from the same position callback used for each buddy
    animation frame; renderer owns no placement logic.
  - Preserve Replay, Pause/Resume, and Done through existing validated IPC.
- **MIRROR**: `guidanceStatusLabel` and `GuidanceCoachControls` localization and
  accessibility patterns.
- **IMPORTS**: Existing companion guidance/action types.
- **GOTCHA**: The local thinking callout has no task ID and no learner controls;
  it must yield immediately to clarification, active guidance, or a response.
- **VALIDATE**: Status tests verify thinking/guiding/waiting/paused text and that
  controls appear only for an active coach task.

### Task 9: Update IPC tests, architecture docs, and remove dead paths

- **ACTION**: Complete the boundary migration and document the new ownership.
- **IMPLEMENT**:
  - Parse cursor snapshots in main/preload and reject malformed payloads.
  - Keep trusted cursor/guidance sender checks and sign-in checks.
  - Remove obsolete cursor-position IPC names only after all callers migrate.
  - Update architecture docs to state Cursor Buddy—not the pet and not CUA—is
    the non-mutating teacher pointer.
  - Run `rg` for deleted guidance functions, old cursor channels, and wording
    such as “moves the companion” to eliminate stale ownership descriptions.
- **MIRROR**: `register-ipc.test.ts:928-945` parsed trusted action test.
- **IMPORTS**: New shared schema in register/preload files.
- **GOTCHA**: Do not weaken sender validation while renaming channels. Do not
  expose real pointer coordinates through logs, analytics, persistence, or task
  history.
- **VALIDATE**: Focused IPC/contract tests pass; `rg` finds no legacy API use.

### Task 10: Run consolidated validation and manual Scratch scenario

- **ACTION**: Verify behavior proportionally across unit, integration, package,
  and real desktop presentation.
- **IMPLEMENT**:
  - Run focused tests during TDD, then one consolidated repository verification.
  - Package macOS and manually reproduce the supplied Scratch tutorial target.
  - Capture diagnostics for phase durations only; never log screen coordinates.
- **MIRROR**: Root `AGENTS.md` required verification.
- **IMPORTS**: None.
- **GOTCHA**: Preserve unrelated staged media/tour work and do not commit or push
  without explicit user direction.
- **VALIDATE**: Commands and manual checklist below pass.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Follow cadence | moving then stationary pointer | 16 ms active, 250 ms tail, 125 ms idle | No |
| Voice thinking | processing activity, no active overlay | immediate thinking snapshot + local callout | No |
| Overlay priority | processing while clarification active | no thinking callout replacement | Yes |
| Coach ordering | delayed hook and glide promises | hook+glide concurrent; highlight/click on arrival; instruction after hook | No |
| Real-pointer isolation | full coach step | no injected pointer command/setter; user cursor read only on return | Critical |
| Visual click | target arrival | one bounded demonstrating phase, no application mutation callback | No |
| Repeat | active waiting step | speech replay only, no model/CUA call | No |
| Pause/resume | toggle action twice | phase and speech/gate pause state synchronized | No |
| Cancellation | abort during glide/speech/wait | all work cancelled once, overlays hidden, follow restored | Yes |
| Replacement | second step arrives before first ends | stale first generation cannot publish | Yes |
| Retina mapping | 2000×1000 screenshot to 1000×500 screen | correct half-scale desktop point/region | Critical |
| Secondary monitor | negative origin | origin applied exactly once | Critical |
| Edge layout | target at each display corner | buddy, chat, and marker remain visible | Yes |
| Reduced motion | OS preference true | snap, static highlight/click signal | Accessibility |
| Window destruction | surface closes mid-step | safe cleanup, no resurrection | Yes |
| Learner timeout | unchanged fingerprints | presented result with `timed_out`, no success claim | Yes |
| Snapshot boundary | malformed phase/position | rejected at schema/preload/main boundary | Security |

### Integration Tests

1. `show_guidance` resolves a fresh Retina observation to desktop DIP target.
2. `TaskExecutionCoordinator` calls only `presentGuidance` for `task.guidance`;
   `cua.executeCommand` remains untouched.
3. Cursor Buddy controller presents, waits through fresh local observations, and
   returns learner evidence to the Agents SDK adapter.
4. Guidance overlays disappear for observation and restore only when the same
   controller generation remains active.
5. Learner controls from the trusted callout renderer reach only the matching
   active task.

### Edge Cases Checklist

- [ ] Missing/destroyed cursor window
- [ ] Missing/destroyed callout or marker window
- [ ] Auxiliary windows disabled or signed out
- [ ] Active clarification/response takes precedence
- [ ] Model target has a point but no region
- [ ] Target region touches normalized 0/1000 boundary
- [ ] Retina/non-integer scale mapping
- [ ] Negative-origin secondary display
- [ ] Target display changes during glide
- [ ] User moves their real cursor during coaching
- [ ] User moves real cursor during return animation
- [ ] Reduced Motion enabled
- [ ] ElevenLabs unavailable and system fallback used
- [ ] Speech failure or timeout
- [ ] Repeat during speech
- [ ] Pause during waiting
- [ ] Task abort during every phase
- [ ] Concurrent/replaced guidance step
- [ ] Observation error and learner timeout
- [ ] App shutdown while presentation is active

---

## Validation Commands

### Focused TDD

```bash
npm exec -- vitest run \
  src/main/companion/cursor-buddy-controller.test.ts \
  src/main/companion/cursor-buddy-geometry.test.ts \
  src/main/agent/execution-contracts.test.ts \
  src/main/agent/runtime-tool-registry.test.ts \
  src/main/agent/execution-coordinator.test.ts \
  src/main/ipc/register-ipc.test.ts \
  src/renderer/CursorBuddy.test.ts \
  src/renderer/guidance-callout-status.test.ts
```

EXPECT: All focused tests pass with no unhandled rejections.

### Static Analysis and Full Suite

```bash
npm run check
```

EXPECT: Agent SDK check, admin build, runtime compatibility, Rust-only check,
lint, TypeScript, Rust fmt/clippy/audit, Vitest, and Rust tests all pass. Existing
documented audit warnings may remain; no new warning is introduced.

### Package

```bash
npm run package
```

EXPECT: Electron Forge packages successfully for the current platform.

### Diff Hygiene

```bash
git diff --check
git status --short
```

EXPECT: No whitespace errors; only intended Cursor Buddy/coach plan changes plus
the user's pre-existing media/tour files are present.

### Manual Validation

- [ ] Start Tro and open the same Scratch tutorial shown in the supplied screenshot.
- [ ] Put the real OS cursor in a visibly different corner before asking for help.
- [ ] Release the voice shortcut; loading ring and localized thinking chat appear immediately without foregrounding the main app.
- [ ] Confirm the real cursor never moves throughout the coach step.
- [ ] Confirm Cursor Buddy and its compact chat glide together to the blue right arrow.
- [ ] Confirm the highlight surrounds the blue arrow rather than the lower-right Tro controls.
- [ ] Confirm Cursor Buddy performs one visual click pulse without advancing Scratch.
- [ ] Confirm hook speech overlaps the glide and instruction/reason follow without overlap.
- [ ] Move the real cursor while Tro waits; Cursor Buddy remains pinned at the lesson target.
- [ ] Exercise Replay, Pause/Resume, and Done.
- [ ] Perform the Scratch action and confirm fresh observation advances the next grounded step.
- [ ] Cancel mid-glide and mid-speech; Cursor Buddy returns to the current real cursor and follows normally.
- [ ] Repeat on a Retina display and a secondary display if available.
- [ ] Enable Reduce Motion and verify snap/static behavior.

---

## Acceptance Criteria

- [ ] `CursorBuddyController` is the only public owner of coaching movement,
  callout, highlight, visual click, narration, learner phase, and return-to-follow.
- [ ] `task.guidance` never calls a CUA pointer or click command.
- [ ] The student's real OS cursor remains untouched during every walkthrough phase.
- [ ] Cursor Buddy, not the desktop pet, glides to the target and visually demonstrates a click.
- [ ] Cursor Buddy and the compact chat use one animated anchor and remain visibly connected.
- [ ] Target highlights use desktop DIP coordinates and are correct on Retina and non-zero/negative display origins.
- [ ] Highlight and visual click occur only after Cursor Buddy reaches the target.
- [ ] Hook speech overlaps movement; instruction and reason do not overlap the hook.
- [ ] Voice processing produces visible local feedback within one renderer update,
  without waiting for transcription, CUA observation, model output, or ElevenLabs.
- [ ] Replay, pause/resume, continue, timeout, screen change, cancellation, and replacement are deterministic.
- [ ] Observation hides Tro-owned surfaces and restores only the still-active controller generation.
- [ ] Cursor state crosses the sandbox boundary through one strict snapshot getter/event pair.
- [ ] No pointer coordinates enter logs, analytics, persistence, task history, or network requests.
- [ ] Desktop pet, clarification, response, and generic CUA automation behavior remain intact.
- [ ] All focused tests, `npm run check`, `npm run package`, and manual Scratch validation pass.

## Completion Checklist

- [ ] Code follows the injected-service/controller conventions.
- [ ] Controller state and geometry are unit tested without Electron.
- [ ] Every boundary payload is schema parsed.
- [ ] Error and abort cleanup are idempotent.
- [ ] Logs are namespaced, bounded, and content/coordinate free.
- [ ] Renderer remains sandboxed with no Node integration or raw IPC/CUA.
- [ ] No new dependency or configuration is added unnecessarily.
- [ ] Old guidance-specific globals/functions/channels are removed.
- [ ] Architecture documentation matches the final implementation.
- [ ] Existing user media/tour work is preserved.
- [ ] No commit or push occurs without explicit authorization.
- [ ] Plan is self-contained; implementation requires no additional codebase search.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Controller becomes a god class | Medium | High | One public orchestrator with injected ports; keep geometry and rendering pure, and keep TTS/gate implementations separate |
| Separate Electron surfaces still drift visually | Medium | High | Controller computes one anchor per frame and moves buddy + callout in the same synchronous callback |
| Retina/multi-monitor coordinates regress | Medium | High | Explicit field names, two-stage mapping tests, negative-origin fixtures, manual second-display check |
| User moves real pointer while buddy is pinned | High | Medium | Never sample during coach phase; sample only on return and resume normal follow afterward |
| Surface hidden for observation restores stale content | Medium | High | Controller generation token plus `shouldRestore` query tied to active task/phase |
| Audio completion blocks presentation | Medium | Medium | Visuals update immediately; retain bounded narration watchdog and system fallback |
| Immediate thinking callout conflicts with clarification/response | Medium | Medium | Preserve current overlay priority and suppress local feedback under higher-priority content |
| Removing old channels breaks native/overlay platform split | Low | High | One snapshot adapter with focused macOS/Linux native and Windows overlay tests |
| Visual “click” is mistaken for actual action | Medium | Medium | Copy and tool contract remain learner-action language; no mutation callback exists in controller |

## Notes

- The supplied screenshot is consistent with a Retina scale bug: screenshot
  pixels are being passed into Electron APIs that expect desktop DIPs.
- `docs/architecture.md:48-53` currently documents Cursor Buddy as following
  CUA pointer movement and the pet as moving to guidance targets. That statement
  becomes intentionally obsolete under this plan.
- The existing one-second Task voice confirmation window is not removed here.
  The latency requirement is solved by immediate local Cursor Buddy feedback;
  altering the Escape/confirmation product behavior is a separate decision.
- Generic `desktop.control` may still move the real cursor when the user asks Tro
  to operate the computer. This plan guarantees cursor isolation specifically for
  non-mutating `show_guidance` walkthroughs.
