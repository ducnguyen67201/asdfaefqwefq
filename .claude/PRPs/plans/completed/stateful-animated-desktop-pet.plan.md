# Plan: Stateful Animated Desktop Pet

## Summary

Turn Tro's bundled desktop duck from one transformed PNG into a frame-animated, stateful companion that visibly reacts to the task lifecycle, voice/guidance activity, completion, errors, and pointer hover. Preserve the current sandboxed Electron architecture, click-through Windows overlay, draggable native companion window, custom-companion workflow, reduced-motion behavior, and low-priority callout arbitration.

Also extend the existing curated pet-nudge surface beyond live classrooms: while an ordinary task remains active long enough, Tro may occasionally show a short local status/encouragement bubble such as “I'm on it—one careful step at a time.” These messages come only from validated task phases and checked-in bilingual copy; they do not inspect task text, screen contents, applications, websites, typing, or attention.

## User Story

As a Tro user, I want the desktop pet to have expressive animations and occasional progress encouragement, so that I can understand what Tro is doing and feel accompanied without reopening the main window.

## Problem → Solution

One large PNG is moved, scaled, and decorated with rings/badges for every state, so the pet's pose never changes and hover cannot work reliably through Electron's draggable/click-through windows → one bundled sprite atlas supplies distinct poses for every existing companion state plus hover, a local main-process hover tracker publishes only a boolean, and the existing validated task/pet-nudge pipeline supplies sparse phase-based bubbles while work is running.

## Metadata

- **Complexity**: Large
- **Source PRD**: N/A
- **PRD Phase**: N/A — standalone feature
- **Estimated Files**: 29 file operations (8 create, 19 update, 2 rename)
- **Estimated Tasks**: 8
- **New Runtime Dependencies**: None
- **Backend/Database Work**: None

---

## Product Decisions

These decisions resolve the implementation ambiguities in the feature request.

1. **Animate the bundled default companion with real frames.** Add one checked-in transparent PNG sprite atlas. Do not add Lottie, GIF playback, video, canvas rendering, or a runtime animation dependency.
2. **Retain the current eight operational states.** `CompanionStateSchema` already defines `idle`, `guiding`, `listening`, `processing`, `sending`, `working`, `completed`, and `error`. The feature adds a renderer-only `hover` animation, not a new task or lifecycle state.
3. **Operational truth wins over delight.** Error, completion, guidance, voice, sending, processing, and working animations override hover. Hover can only replace the visual `idle` pose. It never changes task state, presentation state, policy, or approval behavior.
4. **Pet nudges may select a compatible expression.** Classroom `encouraging`, `waiting`, and `celebrating` bubbles reuse the hover, idle, and completed animation rows respectively. Task `thinking`, `working`, and `verifying` nudges reuse processing or working rows. No extra mood rows are needed in the atlas.
5. **Custom companions remain supported.** A custom companion is still one private 128 px PNG. It keeps the existing CSS transform/ring/badge animation and gets a small hover bob, but does not gain generated state-specific artwork. Producing several provider images per customization would change quota, cost, storage, moderation, and activation contracts and is out of scope.
6. **Hover must remain click-through and non-focusable.** The companion window must not become a desktop-sized interactive surface. Main process performs a 10 Hz local rectangle hit-test using Electron `screen.getCursorScreenPoint()` only while the pet is enabled, visible, and idle; it sends only `true`/`false` to the sandboxed renderer.
7. **Hover data is ephemeral.** Never persist, log, analyze, upload, or add the pointer point to IPC. Settings/privacy copy must accurately say the current pointer is checked locally only to detect whether it is over the pet. Stop polling when the pet is busy, hidden, disabled, destroyed, or the application shuts down.
8. **Wayland fails gracefully.** Electron documents `screen.getCursorScreenPoint()` as unsupported on Wayland. Detect a Wayland Linux session and keep hover false there; all lifecycle animations, nudges, reduced-motion behavior, and existing companion positioning behavior continue. Do not invent an unsafe global-input hook.
9. **Task nudges are sparse and curated.** A nonterminal task must remain in an eligible phase for 20 seconds before the first possible nudge. A successful nudge is visible for 5 seconds, repeats no sooner than 2 minutes, and retries a busy surface after 20 seconds. Short tasks therefore show no running nudge.
10. **Task phases are the only nudge signal.** Map `interpreting`/`clarifying`/`planning` to `thinking`, `observing`/`acting` to `working`, and `verifying` to `verifying`. Pending interaction, permission, paused, blocked, completed, failed, and cancelled states clear the task nudge immediately.
11. **Existing surface priority is preserved.** Clarification/approval → guidance → response → pet nudge → activity remains unchanged. Task and classroom nudges share one visible slot and never cover an interaction, walkthrough, streamed response, or result card.
12. **No model-generated encouragement.** Task and classroom messages remain checked-in English/Vietnamese strings. They are plain text, bounded to 160 characters, silent, non-interactive, and never claim progress beyond the explicit phase.
13. **The existing desktop-pet setting controls everything.** `classroomPetEnabled` already creates/destroys the whole desktop pet despite its legacy name. Do not add a second setting or migrate the persisted preference in this feature.

### Sprite atlas contract

Create `src/assets/tro-desktop-pet-atlas.png` with this exact layout:

| Property | Required value |
|---|---|
| Cell size | 128 × 128 transparent pixels |
| Columns | 6 frames per row |
| Rows | 9 rows |
| Atlas size | 768 × 1152 pixels |
| Row 0 | `idle`: breathing, blink, subtle tail/wing movement |
| Row 1 | `hover`: look toward pointer, cheerful wing wave/bounce |
| Row 2 | `guiding`: lean/point toward the target |
| Row 3 | `listening`: attentive head tilt and listening pulse |
| Row 4 | `processing`: thoughtful pacing/blink; no false completion cue |
| Row 5 | `sending`: quick forward/dispatch motion |
| Row 6 | `working`: purposeful work loop distinct from thinking |
| Row 7 | `completed`: one celebratory jump, then hold the final pose |
| Row 8 | `error`: one surprised/wobble sequence, then hold a calm error pose |

Every frame must preserve the current duck's pixel-art palette, silhouette, transparent background, and consistent foot baseline. Keep all visible pixels inside the cell with at least 4 px transparent padding. The first frame of every row must be a meaningful static pose because reduced-motion mode freezes animation. Optimize the checked-in PNG to no more than 2 MiB and retain `src/assets/tro-desktop-pet.png` for Settings previews, custom-generation source references, and safe fallback.

### Animation precedence

```text
error/completed/guiding/listening/sending
                │
                ▼
        exact operational row

processing/working + task nudge
                │
                ├── thinking  -> processing row
                ├── working   -> working row
                └── verifying -> processing row

idle + classroom nudge
                │
                ├── encouraging -> hover row
                ├── waiting     -> idle row
                └── celebrating -> completed row

idle + hovered -> hover row
idle           -> idle row
```

---

## UX Design

### Before

```text
┌──────────────────────── Desktop ────────────────────────┐
│                                                         │
│  Tro is planning / acting / verifying                   │
│                                           ◌             │
│                                      [same duck PNG]    │
│                                     tiny CSS breathe    │
│                                                         │
│  Hovering does not reliably emit events because the     │
│  native pet is a drag region and Windows is click-through.│
└─────────────────────────────────────────────────────────┘
```

### After

```text
┌──────────────────────── Desktop ────────────────────────┐
│                                                         │
│  Planning                Working               Verify   │
│  [duck thinks]   ───▶    [duck works]   ───▶   [checks] │
│                                                         │
│                  ┌──────────────────────────────┐       │
│                  │ TRO PET · ON IT              │       │
│                  │ One careful step at a time.  │       │
│                  └──────────────────────┬───────┘       │
│                                   [animated duck]       │
│                                                         │
│  Idle pointer hover: the duck looks up and waves while  │
│  all clicks still reach the app underneath.             │
└─────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Idle | One PNG waddles via CSS transform | Six-frame idle loop with blink/breathe | Existing wandering and drag behavior remain |
| Pointer over idle pet | No reliable hover response | Cheerful hover/wave row; wandering pauses | Local boolean only; no focus/click capture |
| Thinking | Same PNG breathes with ring/dots | Dedicated thoughtful frame loop plus existing dots | Derived from `planning`/related validated phases |
| Working | Same PNG uses same animation as processing | Distinct purposeful work loop | Makes thinking vs execution legible |
| Listening/guiding/sending | Same pose with different ring | Distinct frame row plus existing indicator | Existing status badge/ring remains redundant non-motion cue |
| Completed/error | PNG lifts/wobbles | One-shot frame sequence and held final pose | Replays only when the state/presentation identity changes |
| Long-running task | Usually only state/ring or response stream | Optional curated five-second task bubble after 20 s | Suppressed whenever a higher-priority surface is present |
| Classroom nudge | Bubble beside idle PNG | Bubble plus compatible cheerful/waiting/celebration expression | Existing cadence and privacy guarantees remain |
| Custom companion | One custom image gets transform/ring animation | Same behavior plus idle hover bob | No multi-image provider expansion |
| Reduced motion | CSS transforms/rings stop | Atlas freezes on first state frame; rings/transforms stop | State remains clear through pose, label, ring, badge, and bubble text |
| Wayland | Existing platform limits apply | Lifecycle animation works; hover remains disabled | Explicit documented fallback |

---

## Strategic Design

### Approach

Keep the existing authoritative path intact:

```text
validated TaskUpdate / voice / guidance
  -> derivePresentationState()
  -> ElectronPresentationPresenter
  -> CompanionState
  -> Electron main publishes fixed IPC event
  -> sandboxed CursorCompanion
  -> pure animation-row selector
  -> bundled sprite atlas + CSS steps()
```

Add two bounded, independent collaborators:

1. `CompanionHoverTracker` in Electron main samples a main-process pointer point at 100 ms only while eligible, compares it with the current 112 × 112 companion bounds, pauses/resumes autonomous wandering, and publishes a boolean over a new outbound-only companion event.
2. `TaskPetService` mirrors `ClassroomPetService`: it receives validated `TaskUpdate` projections, tracks the latest task identity/mood, owns deterministic timers/message rotation, and asks Electron main to present a low-priority `CompanionPetNudgeDraft` through the existing guidance window.

`CursorCompanion` also subscribes to the existing pet-nudge event. Electron main sends that event to both the guidance window and companion window, allowing a classroom/task bubble to select a compatible expression without widening the contract or duplicating mood state.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Animated GIF/WebP per state | Rejected | Animation cannot be reliably paused on a representative frame for `prefers-reduced-motion`; several files also make transition control and tests weaker |
| Lottie/Rive dependency | Rejected | Adds runtime/package surface, renderer parsing, authoring tooling, and CSP considerations when a fixed pixel-art atlas is sufficient |
| CSS transforms on the existing PNG only | Rejected | This is the current limitation; it cannot change face, pose, or action silhouette |
| One BrowserWindow per animation/message | Rejected | The existing companion and guidance windows already provide correct sandboxing, z-order, placement, and arbitration |
| CSS `:hover` only | Rejected | Electron draggable regions ignore pointer events, and the Windows virtual-desktop overlay intentionally ignores mouse input |
| Make the Windows overlay interactive | Rejected | A full-desktop always-on-top interactive window risks stealing every click and violates the companion's current safety model |
| Renderer-to-main raw pointer IPC | Rejected | The renderer should not gain raw Electron/IPC or send continuous pointer coordinates across the trust boundary |
| Generate state images for every custom companion | Deferred | Multiplies provider cost and calls, changes quota/storage/contracts, and introduces visual-consistency failures across separately generated frames |
| Model-generated task encouragement | Rejected | Adds cost, latency, prompt/content exposure, moderation, and potentially misleading status copy |
| Display `lastEvent.summary` in the pet bubble | Rejected | It is not curated UI copy and may contain model/tool/user-derived content; fixed phase-based strings are safer and more stable |
| Show a nudge on every phase transition | Rejected | Typical tasks transition frequently and would make the pet noisy; the request says “sometimes” |

### Scope

- One nine-row, six-frame bundled default-companion atlas.
- A pure exhaustive animation selector with operational/nudge/hover precedence.
- Atlas rendering in `CursorCompanion`, with the current custom-image path retained.
- Main-process local hover tracking, bounded hit-testing, lifecycle cleanup, and outbound boolean IPC.
- Expansion of pet-nudge moods to `thinking`, `working`, and `verifying`.
- A timer-driven `TaskPetService` using validated task phases and curated bilingual copy.
- Main-process reuse of the existing guidance window and overlay priority.
- Generic pet-nudge renderer naming/styles that support classroom and task messages.
- Settings privacy copy, architecture/security documentation, deterministic tests, manual packaged checks, and the required build gates.

## NOT Building

- Animation generation or upload for user-created custom companions.
- A change to the five-per-month custom-companion generation quota or provider request.
- Lottie, Rive, GIF, animated WebP, canvas, WebGL, audio, sound effects, TTS, or video.
- A pet chat interface, free-form conversation, buttons, rewards, streaks, minigames, hunger/health, or persistent mood.
- Screen, application, website, process, typing, attention, idle-time, or distraction monitoring.
- Cursor history, analytics, classroom evidence, logs, persistence, or network transport for hover/nudge events.
- Hover support through global OS hooks on Wayland.
- Backend routes, Rust changes, migrations, database state, provider calls, or new permissions.
- Changes to goal compilation, lifecycle authority, policy decisions, approvals, or CUA execution.
- A second pet/window or raw Electron/IPC exposure to the renderer.

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `AGENTS.md` | all | Sandboxed renderer, narrow `DesktopApi`, schema-boundary, purity, and verification invariants |
| P0 | `src/renderer/CursorCompanion.tsx` | 1-89 | Current subscriptions, appearance selection, state class, overlay position, ARIA, rings, badges, and custom image rendering |
| P0 | `src/index.css` | 2215-2604, 2634-2658 | Current companion hit behavior, transform animations, indicators, keyframes, and reduced-motion rules |
| P0 | `src/shared/contracts.ts` | 2294-2310, 2355-2364, 2675-2708, 3135-3171 | Preference, companion state, nudge mood/draft/projection, and inferred type contracts |
| P0 | `src/index.ts` | 467-628, 721-765, 906-982, 1493-1528, 1561-1591, 1661-1734, 2273-2439, 2534-2610, 2725-2797, 2803-2833 | State publication, nudge presentation, service interruption, shutdown, task updates, movement, secure windows, and startup |
| P0 | `src/main/presentation/presentation-policy.ts` | 1-80 | Authoritative pure task/voice → presentation-state derivation |
| P0 | `src/main/presentation/electron-presentation-presenter.ts` | 80-167 | Exhaustive presentation → companion-state mapping and response/attention behavior |
| P0 | `src/main/companion/classroom-pet-service.ts` | 16-334 | Exact dependency-injected scheduling, message rotation, stale-generation, busy retry, and dismissal pattern to mirror |
| P0 | `src/main/companion/companion-response-controller.ts` | 16-46 | Existing overlay precedence that must remain unchanged |
| P0 | `src/renderer/GuidanceCallout.tsx` | 102-180, 354-369, 537-547 | Parsed nudge subscription, identity reset, callout selection, and nudge component integration |
| P1 | `src/main/companion/companion-position.ts` | 1-52, 327-387 | DIP point/rectangle types, clamping, platform mode, virtual bounds, and overlay-local coordinates |
| P1 | `src/shared/desktop-api.ts` | 122-180, 428-462 | Fixed IPC channel naming and narrow `CompanionApi` listener shape |
| P1 | `src/preload.ts` | 942-990, 1029-1123 | Auxiliary API pattern: parse every main event and return exact listener cleanup |
| P1 | `src/renderer/ClassroomPetNudge.tsx` | all | Existing classroom-specific component to rename/generalize without changing plain-text or accessibility behavior |
| P1 | `src/renderer/ClassroomPetNudge.test.tsx` | all | Table-driven bilingual mood labels, polite live region, no controls, and hostile-text escaping assertions |
| P1 | `src/main/companion/classroom-pet-service.test.ts` | 91-307 | Fake-timer test harness and exact cadence/stale-callback assertions |
| P1 | `src/main/presentation/presentation-policy.test.ts` | 13-101 | Validated task fixture and table/assertion conventions for state projection |
| P1 | `src/main/companion/companion-position.test.ts` | 20-271 | Cross-display, negative-coordinate, Windows overlay, and pure geometry tests |
| P1 | `src/renderer/CursorCompanion.test.ts` | all | Static-markup and pure URL helper test style |
| P1 | `src/shared/contracts.test.ts` | 54-175, 588-627 | Strict contract tests and exact invalid-payload loops |
| P1 | `src/renderer/SettingsPage.tsx` | 785-835 | Current desktop-pet toggle and privacy copy |
| P1 | `src/renderer/SettingsPage.test.ts` | 254-288 | Current copy/preference assertions that must be updated |
| P1 | `src/renderer/app-language.ts` | 74-87, 662-690 | English-keyed Vietnamese translation convention and existing pet terms |
| P1 | `webpack.renderer.config.ts` | 6-19 | Existing PNG/JPEG/WebP `asset/resource` support; no loader change is required |
| P1 | `src/shared/assets.d.ts` | all | Existing `*.png` module typing; atlas imports require no new declaration |
| P1 | `vitest.config.mts` | all | Both `.test.ts` and `.test.tsx` under `src` are included; Node is the default environment |
| P2 | `docs/architecture.md` | 10-21, 110-131 | Renderer/main ownership and private companion asset path |
| P2 | `docs/security.md` | 160-187, 205-221 | Content-free analytics and companion privacy/security guarantees |
| P2 | `docs/knowledge-spaces.md` | 78-94 | Explicit-event-only classroom/pet privacy constraints |
| P2 | `.claude/PRPs/plans/completed/classroom-codex-pet.plan.md` | 1-163 | Prior product decisions for sparse, curated, low-priority pet nudges |

> `docs/CODEX-NAVIGATION-GUIDE.md`, referenced by the repository supplement, is absent from this checkout. The mandatory-reading table and discovery map below are the resolved navigation packet for this feature.

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Draggable/click-through Electron windows | [Electron custom window interactions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions) | `app-region: drag` ignores pointer events; click-through windows ignore mouse input, and forwarded mouse movement is platform-limited. Do not base cross-platform hover solely on CSS events. |
| Ignored mouse-event forwarding | [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window#winsetignoremouseeventsignore-options) | `setIgnoreMouseEvents(true, { forward: true })` keeps clicks going to the window below; forwarding exists only on macOS/Windows and must not be mistaken for a general interactive overlay. |
| Cursor coordinates | [Electron screen API](https://www.electronjs.org/docs/latest/api/screen#screengetcursorscreenpoint) | The main-process API returns a DIP point compatible with BrowserWindow bounds, but is unsupported on Wayland. Gate the tracker and keep a no-hover fallback. |
| Hidden-window work | [Electron BrowserWindow page visibility](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility) | Hidden/minimized windows have explicit visibility semantics; stop the hover timer when the companion is not eligible instead of doing perpetual background work. |

### Research Findings

```text
KEY_INSIGHT: Electron draggable regions suppress pointer events.
APPLIES_TO: Hover architecture for the native 112 × 112 companion window.
GOTCHA: A CSS :hover implementation may look correct in a browser but never fire in the packaged frameless draggable window.

KEY_INSIGHT: Click-through mouse forwarding is limited to macOS and Windows.
APPLIES_TO: The Windows virtual-desktop overlay.
GOTCHA: Do not turn off ignoreMouseEvents for hover; that would make the full overlay consume desktop clicks.

KEY_INSIGHT: screen.getCursorScreenPoint() uses DIP coordinates, matching BrowserWindow bounds.
APPLIES_TO: One pure hit-test for native and overlay modes without physical-pixel conversion.
GOTCHA: Wayland does not support this API, so hover must be explicitly disabled there rather than guessed.
```

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Evidence |
|---|---|---|---|
| Similar implementation | `src/renderer/CursorCompanion.tsx:21-88` | Renderer subscribes to narrow companion projections and derives markup/classes locally | Three `useEffect` listener subscriptions with cleanup |
| Lifecycle mapping | `src/main/presentation/presentation-policy.ts:47-80` | Pure explicit task/voice state maps to `PresentationState` | `THINKING_PHASES`, `WORKING_PHASES`, `derivePresentationState()` |
| State mapping | `src/main/presentation/electron-presentation-presenter.ts:80-88` | Exhaustive readonly record maps presentation state to companion state | `Readonly<Record<PresentationState, CompanionState>>` |
| State publication | `src/index.ts:606-628` | Main owns state, sends one named event, pauses wandering for non-idle work | `sendCompanionState()`, `updateCompanionState()` |
| Scheduling | `src/main/companion/classroom-pet-service.ts:138-179,241-305` | Service lifecycle, dependency-injected timers, generation IDs, busy retry, visible timeout | `start()`, `stop()`, `interrupt()`, `schedule()`, `presentDueNudge()` |
| Nudge boundary | `src/shared/contracts.ts:2691-2708` | Strict bounded mood/draft/projection schemas | 160-char message, UUID, language, side |
| Overlay priority | `src/main/companion/companion-response-controller.ts:37-46` | Pure fixed priority selector | Interaction > guidance > response > pet nudge > activity |
| Nudge placement | `src/index.ts:922-982` | Main verifies eligibility, places beside pet, parses, publishes, shows inactive | `placeGuidanceCallout`, `safeParse`, `showInactive` |
| Hover constraint | `src/index.css:2215-2232` | Root is pointer-through except native idle drag region | `pointer-events: none`, `-webkit-app-region: drag` |
| Windows behavior | `src/index.ts:2538-2571` | Windows companion is a virtual-desktop click-through overlay | `shouldUseCompanionOverlay`, `setIgnoreMouseEvents(true, { forward: true })` |
| Movement | `src/index.ts:2273-2439` | Main owns absolute position, overlay conversion, glide/wander timers | `getCurrentCompanionScreenPosition`, `applyCompanionScreenPosition` |
| Bundled assets | `webpack.renderer.config.ts:11-14` | PNG/JPEG/WebP imports become bundled resource URLs | `type: 'asset/resource'` |
| Custom assets | `src/renderer/CursorCompanion.tsx:14-19,57-67` | Private custom URL or bundled default URL selected by appearance | `companionImageUrl()` |
| Renderer boundary | `src/preload.ts:1093-1107` | Main event values are parsed before listener callbacks | `CompanionStateSchema.parse(value)` |
| Accessibility | `src/renderer/ClassroomPetNudge.tsx:35-54` | Passive pet copy is a polite labelled plain-text status with no controls | `aria-live="polite"`, `role="status"` |
| Reduced motion | `src/index.css:2634-2658` | Motion is disabled by media query while state visuals remain | `animation: none` |
| Error handling | `src/main/companion/classroom-pet-service.ts:261-286` | Presentation dependency failures become a busy retry, not an uncaught task failure | guarded `try/catch`, boolean result |
| Logging | `src/index.ts:1163-1170` | Main presentation failures use a namespaced fixed message; content is not logged | `console.error('[companion] ...', error)` |
| Test pattern | `src/main/companion/classroom-pet-service.test.ts:91-149` | Fake timers and injected dependencies assert exact boundary times | `vi.useFakeTimers()`, `advanceTimersByTimeAsync` |
| Component test | `src/renderer/ClassroomPetNudge.test.tsx:31-82` | SSR markup asserts labels, ARIA, no controls, and escaped hostile text | `renderToStaticMarkup(createElement(...))` |
| Configuration | `src/shared/contracts.ts:2296-2310` | Existing preference defaults preserve old files | `classroomPetEnabled: z.boolean().default(true)` |
| Dependencies | `package.json` | React 19, Electron 43, Zod 4, Vitest 4, and webpack assets are sufficient | No package addition needed |
| Data access | N/A | Feature uses bundled assets and in-memory state only | No repository/database pattern applies |

---

## Patterns to Mirror

All snippets below are current codebase examples, not proposed code.

### EXHAUSTIVE_STATE_MAPPING

SOURCE: `src/main/presentation/electron-presentation-presenter.ts:80-88`

```ts
const COMPANION_STATES: Readonly<Record<PresentationState, CompanionState>> = {
  done: 'completed',
  error: 'error',
  listening: 'listening',
  needs_attention: 'idle',
  ready: 'idle',
  thinking: 'processing',
  working: 'working',
};
```

Define sprite rows and animation metadata with the same exhaustive `Readonly<Record<...>>`/`satisfies Record<...>` pattern so adding a future `CompanionState` fails typecheck until artwork mapping is supplied.

### SCHEMA_FIRST_BOUNDARY

SOURCE: `src/shared/contracts.ts:2691-2708`

```ts
export const CompanionPetMoodSchema = z.enum([
  'encouraging',
  'waiting',
  'celebrating',
]);

export const CompanionPetNudgeDraftSchema = z
  .object({
    id: z.string().uuid(),
    language: AppLanguageSchema,
    message: z.string().trim().min(1).max(160),
    mood: CompanionPetMoodSchema,
  })
  .strict();
```

Extend the mood enum only; keep the strict bounded draft/projection shapes and inferred types.

### PARSED_OUTBOUND_LISTENER

SOURCE: `src/preload.ts:1093-1107`

```ts
onStateChange(listener) {
  const eventHandler = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    listener(CompanionStateSchema.parse(value));
  };

  ipcRenderer.on(IPC_CHANNELS.companionStateChanged, eventHandler);
  return () =>
    ipcRenderer.removeListener(
      IPC_CHANNELS.companionStateChanged,
      eventHandler,
    );
},
```

Add `onHoverChange` in this exact style using a named `CompanionHoverSchema` and a fixed `companionHoverChanged` channel. Do not expose `screen`, BrowserWindow, Electron, coordinates, or raw IPC.

### DEPENDENCY_INJECTED_TIMER_SERVICE

SOURCE: `src/main/companion/classroom-pet-service.ts:61-70,241-255`

```ts
interface ClassroomPetDependencies {
  sessionService: Pick<ClassroomSessionService, 'get' | 'onChange'>;
  preferencesService: Pick<AppPreferencesService, 'get' | 'onChange'>;
  canPresent(): boolean;
  present(nudge: CompanionPetNudgeDraft): boolean;
  dismiss(id: string): void;
  createId?: () => string;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

private schedule(delay: number): void {
  if (!this.isEligible() || this.timer) return;
  const expectedAttemptId = this.attemptId;
  const expectedGeneration = this.generation;
  this.timer = this.setTimer(() => {
    this.timer = null;
    if (
      !this.started ||
      expectedGeneration !== this.generation ||
      expectedAttemptId !== this.attemptId
    ) {
      return;
    }
    this.presentDueNudge();
  }, delay);
}
```

Mirror this for `TaskPetService`, replacing Attempt identity with task identity and receiving validated task updates explicitly.

### OVERLAY_PRECEDENCE

SOURCE: `src/main/companion/companion-response-controller.ts:37-46`

```ts
export function selectCompanionOverlayMode(
  candidates: CompanionOverlayCandidates,
): CompanionOverlayMode {
  if (candidates.interaction) return 'interaction';
  if (candidates.guidance) return 'guidance';
  if (candidates.response) return 'response';
  if (candidates.petNudge) return 'pet_nudge';
  if (candidates.activity) return 'activity';
  return 'hidden';
}
```

Do not reorder or add another overlay mode. Task nudges use the existing `petNudge` candidate.

### MAIN_OWNS_PRESENTATION

SOURCE: `src/index.ts:936-961`

```ts
function showClassroomPetNudge(draft: CompanionPetNudgeDraft): boolean {
  if (!canPresentClassroomPetNudge()) return false;
  if (!guidanceWindow || guidanceWindow.isDestroyed()) createGuidanceWindow();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return false;

  const target = getCurrentCompanionScreenPosition();
  const display = screen.getDisplayNearestPoint(target);
  const position = placeGuidanceCallout(
    target,
    display.workArea,
    PET_NUDGE_CALLOUT_SIZE,
    COMPANION_SIZE,
  );
  const parsed = CompanionPetNudgeSchema.safeParse({
    ...draft,
    side: position.x < target.x ? 'left' : 'right',
  });
  if (!parsed.success) return false;
```

Factor the common parse/place/publish/show behavior into a generic helper while keeping separate classroom/task eligibility wrappers.

### PASSIVE_PLAIN_TEXT_NUDGE

SOURCE: `src/renderer/ClassroomPetNudge.tsx:29-54`

```tsx
<aside
  aria-labelledby="classroom-pet-nudge-title classroom-pet-nudge-mood"
  aria-live="polite"
  className={`guidance-callout classroom-pet-nudge classroom-pet-nudge--${nudge.mood} guidance-callout--${nudge.side}`}
  role="status"
>
  <span className="classroom-pet-nudge__message">{nudge.message}</span>
</aside>
```

Rename/generalize the component and class prefix, but retain a polite status, text interpolation only, and zero controls/links.

### REDUCED_MOTION

SOURCE: `src/index.css:2634-2648`

```css
@media (prefers-reduced-motion: reduce) {
  .cursor-companion img {
    animation: none;
  }

  .cursor-companion__ring,
  .cursor-companion__listening i,
  .cursor-companion__processing i,
  .cursor-companion__completed {
    animation: none;
  }
}
```

Add the sprite element and custom-image hover class to this block. A state change may select a new static row, but frames, transforms, rings, and transitions must not run.

### FAKE_TIMER_TEST

SOURCE: `src/main/companion/classroom-pet-service.test.ts:91-149`

```ts
beforeEach(() => {
  vi.useFakeTimers();
});

it('waits two minutes before the first working encouragement', async () => {
  const { present, service } = setup();
  await flushPreferences();

  await vi.advanceTimersByTimeAsync(CLASSROOM_PET_FIRST_WORKING_DELAY_MS - 1);
  expect(present).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(present).toHaveBeenCalledOnce();
});
```

Use exact minus-one/plus-one assertions for every new task and hover timer boundary.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/assets/tro-desktop-pet-atlas.png` | CREATE | Nine-row, six-frame default companion artwork |
| `src/renderer/companion-animation.ts` | CREATE | Pure exhaustive mapping from state/nudge/hover to sprite row, loop mode, duration, and accessible label |
| `src/renderer/companion-animation.test.ts` | CREATE | Exhaustive precedence, representative-frame, and all-state coverage |
| `src/main/companion/companion-hover-tracker.ts` | CREATE | Injectable 10 Hz local hover hit-test/lifecycle with Wayland gating |
| `src/main/companion/companion-hover-tracker.test.ts` | CREATE | Geometry, transition dedupe, pause/resume, stop, and unsupported-platform tests |
| `src/main/companion/task-pet-service.ts` | CREATE | Validated task-phase eligibility, curated messages, cadence, stale identity, and busy retry |
| `src/main/companion/task-pet-service.test.ts` | CREATE | Exact fake-timer/state/identity/preference tests |
| `src/shared/contracts.ts` | UPDATE | Add parsed hover boolean and task nudge moods; retain strict bounded nudge projection |
| `src/shared/contracts.test.ts` | UPDATE | Accept all six moods; reject unsupported values and non-boolean hover payloads |
| `src/shared/desktop-api.ts` | UPDATE | Add fixed outbound hover channel and `CompanionApi.onHoverChange` |
| `src/preload.ts` | UPDATE | Parse hover events and expose cleanup-returning listener |
| `src/index.ts` | UPDATE | Instantiate/start/stop hover and task services, publish hover/nudge to pet window, factor nudge presentation, and preserve priority/cleanup |
| `src/renderer/CursorCompanion.tsx` | UPDATE | Subscribe to hover/nudge, select atlas row, render sprite for default and `<img>` for custom |
| `src/renderer/CursorCompanion.test.ts` | UPDATE | Default atlas/custom fallback markup, labels, and helper results |
| `src/index.css` | UPDATE | Sprite sheet frames, state durations, one-shot states, custom fallback hover, generic nudge styles, reduced motion |
| `src/main/companion/classroom-pet-service.ts` | UPDATE | Keep classroom mood typing/catalog compatible with expanded shared mood union |
| `src/main/companion/classroom-pet-service.test.ts` | UPDATE | Assert classroom service never emits task-only moods and retains cadence |
| `src/renderer/ClassroomPetNudge.tsx` | RENAME to `src/renderer/CompanionPetNudge.tsx` | Component now renders both classroom and task moods |
| `src/renderer/ClassroomPetNudge.test.tsx` | RENAME to `src/renderer/CompanionPetNudge.test.tsx` | Cover six bilingual labels plus existing accessibility/escaping invariants |
| `src/renderer/GuidanceCallout.tsx` | UPDATE | Import/use the generalized nudge card; presentation precedence stays unchanged |
| `src/renderer/SettingsPage.tsx` | UPDATE | Accurate animation/task-nudge/local-hover privacy copy |
| `src/renderer/SettingsPage.test.ts` | UPDATE | Assert new local-only hover and task-message explanation |
| `src/renderer/app-language.ts` | UPDATE | Vietnamese labels for task nudge moods and updated setting copy |
| `src/renderer/app-language.test.ts` | UPDATE | Ensure all new companion copy translates without English fallback |
| `docs/architecture.md` | UPDATE | Document atlas renderer, main-owned hover boolean, and task-nudge path |
| `docs/security.md` | UPDATE | Document ephemeral pointer hit-testing and prohibited logging/persistence/network use |
| `docs/knowledge-spaces.md` | UPDATE | Preserve classroom event-only rule while distinguishing local hover reaction |
| `README.md` | UPDATE | Describe expressive states, sparse task nudges, reduced motion, and Wayland hover fallback |
| `docs/testing/stateful-animated-desktop-pet.tdd.md` | CREATE | Record RED/GREEN evidence and manual packaged-platform matrix during implementation |

Files explicitly inspected but not expected to change:

- `src/main/presentation/presentation-policy.ts` and `electron-presentation-presenter.ts`: current mappings already supply the required authoritative states.
- `src/main/companion/companion-response-controller.ts`: priority is already correct.
- `src/renderer/CompanionCustomizationCard.tsx`: keep `tro-desktop-pet.png` as the default static Settings preview.
- `webpack.renderer.config.ts` and `src/shared/assets.d.ts`: PNG asset support already exists.
- `src/renderer/companion-state.ts`: this is a legacy pure helper used only by its test; it is not the current main-process presentation entry point and must not become a second source of truth.

---

## Step-by-Step Tasks

### Task 1: Produce and Validate the Default Companion Sprite Atlas

- **ACTION**: Create the exact 768 × 1152 transparent atlas described in the Sprite atlas contract.
- **IMPLEMENT**:
  - Use the current `src/assets/tro-desktop-pet.png` as the visual reference.
  - Author six aligned 128 × 128 frames for each of the nine rows.
  - Keep the feet/baseline stable for looping rows; intentional lift is allowed only in hover/completed frames.
  - Make frame 0 of each row a meaningful reduced-motion pose.
  - Optimize without palette shifts or alpha fringes; keep file ≤2 MiB.
  - Retain the original `tro-desktop-pet.png` untouched.
- **MIRROR**: Pixelated rendering and current default asset treatment in `src/renderer/CursorCompanion.tsx:3,60-66` and `src/index.css:2267-2286`.
- **IMPORTS**: None in the asset itself; `CursorCompanion.tsx` will import the resulting PNG URL.
- **GOTCHA**: Inconsistent frame bounds cause visible jitter even when CSS is correct. Transparent pixels count toward each fixed cell; no trimming per frame.
- **VALIDATE**:
  - `file src/assets/tro-desktop-pet-atlas.png` reports 768 × 1152 RGBA PNG.
  - `wc -c` is ≤2,097,152 bytes.
  - Inspect every row at 96 px display size and on both light/dark desktop backgrounds.
  - Confirm the original static asset hash is unchanged.

### Task 2: Add the Pure Animation Model and Render the Atlas

- **ACTION**: Make `CursorCompanion` select and render expressive default frames while preserving custom companions.
- **IMPLEMENT**:
  - In `companion-animation.ts`, define renderer animation names (`CompanionAnimation = CompanionState | 'hover'`) and an exhaustive record containing row, duration, and `iteration: 'loop' | 'once'`.
  - Export a pure selector accepting `{ appearance, hovered, nudge, state }`.
  - Apply the precedence defined above. Use the nudge ID as a React key component only for replaying one-shot classroom celebrations; do not treat it as task state.
  - Return the current `CompanionState` path for custom appearances and a `hovered` modifier only when state is idle.
  - In `CursorCompanion`, subscribe to existing state/appearance/position plus pet nudge and the new hover boolean. Return every cleanup function from `useEffect`.
  - Render a background-image sprite `<span aria-hidden="true">` for `appearance.kind === 'default'`; retain `<img src={appearance.assetUrl}>` for custom.
  - Keep ring/listening/processing/error/completed indicators. They remain non-motion and color-independent backups.
  - Keep `role="img"`, update the label/title through a pure animation label helper, and never make the pet a button.
  - In CSS, scale 128 px cells to 96 px, use a fixed six-frame horizontal `steps(5, end)` animation from 0 to -480 px, and set Y offset to `row * -96px` against a 576 × 864 px scaled background.
  - Loop idle/hover/guiding/listening/processing/sending/working. Run completed/error once and hold the last frame.
  - Custom images keep current transform animations; add `.cursor-companion--hovered` only for idle custom images.
- **MIRROR**: Exhaustive readonly mapping in `electron-presentation-presenter.ts:80-88`, current appearance helper in `CursorCompanion.tsx:14-19`, and state classes in `index.css:2284-2481`.
- **IMPORTS**: `tro-desktop-pet-atlas.png`, `CompanionPetNudge` type, new pure animation helpers.
- **GOTCHA**: A `steps(6)` animation ending at `-576px` can expose a blank seventh cell at the held endpoint. The six-frame atlas must animate with five transitions to `-480px` for one-shot states.
- **VALIDATE**:
  - Exhaustive test covers every `CompanionStateSchema.options` value.
  - Hover never overrides a non-idle state.
  - Classroom mood aliases and task mood aliases select the documented rows.
  - Default SSR markup contains sprite URL/style and no default `<img>`; custom markup keeps exact private URL and `<img>`.
  - Status indicator markup and ARIA remain present.

### Task 3: Implement Safe Cross-Platform Hover Tracking

- **ACTION**: Add an injectable main-process hover tracker and one outbound parsed boolean event.
- **IMPLEMENT**:
  - Add `CompanionHoverSchema = z.boolean()` and inferred type in shared contracts.
  - Add `IPC_CHANNELS.companionHoverChanged` and `CompanionApi.onHoverChange(listener)`.
  - Parse with `CompanionHoverSchema` in preload; never expose pointer coordinates.
  - In `companion-hover-tracker.ts`, export a pure inclusive-exclusive point-in-rectangle helper and an injectable tracker with `start()`, `synchronizeEligibility()`, and `stop()`.
  - Inject `getCursorPoint`, `getCompanionBounds`, `isEligible`, `publish`, `onEnter`, `onLeave`, timer functions, and 100 ms interval. Publish only boolean transitions, not every tick.
  - Treat an 8 px inset rectangle as the active hover zone to reduce triggers over transparent cell corners.
  - Gate Linux Wayland by a pure `supportsCompanionHover(platform, sessionType)` helper; normalize `XDG_SESSION_TYPE` only to decide supported/unsupported and never log it as user data.
  - In `src/index.ts`, use current screen position plus `COMPANION_SIZE` for both native and Windows overlay modes. Start after `app.whenReady()`/window load; synchronize on enable/disable, state changes, window show/close, movement completion, and shutdown.
  - On enter, pause autonomous wandering. On leave, reschedule only if state is still idle and no pinned/user move is active.
  - Send initial `false` on companion load and after stop so renderer state cannot remain stale.
- **MIRROR**: Main-owned movement lifecycle in `src/index.ts:595-628,2399-2439`, fixed outbound events in `src/index.ts:606-620`, parsed preload listeners in `src/preload.ts:1093-1107`, pure geometry tests in `companion-position.test.ts`.
- **IMPORTS**: `screen`, `CompanionHoverSchema` in preload/contracts, tracker class/helpers in main.
- **GOTCHA**: Do not call `setIgnoreMouseEvents(false)` on the Windows overlay. Do not rely on CSS `mouseenter` inside an Electron drag region. Do not poll on Wayland or after destruction/shutdown.
- **VALIDATE**:
  - Exact hit-test edges and negative display coordinates.
  - Timer publishes `true` once on enter and `false` once on leave; repeated samples are deduplicated.
  - Busy/hidden/disabled state clears hover and stops the timer.
  - macOS/Windows/Linux-X11 are supported; Linux Wayland returns false without scheduling.
  - Packaged Windows clicks still reach applications below the pet/overlay.

### Task 4: Generalize the Nudge Contract and Renderer

- **ACTION**: Allow the existing nudge surface to render task moods without weakening its passive plain-text contract.
- **IMPLEMENT**:
  - Extend `CompanionPetMoodSchema` with `thinking`, `working`, and `verifying`.
  - Keep UUID, language, 160-character message, strict object, and left/right projection unchanged.
  - Rename `ClassroomPetNudge`/test to `CompanionPetNudge` and update `GuidanceCallout` import/alias.
  - Rename CSS class prefix from `classroom-pet-nudge` to `companion-pet-nudge` consistently.
  - Add English/Vietnamese labels: `Thinking`/`Đang suy nghĩ`, `On it`/`Đang làm`, `Checking`/`Đang kiểm tra`.
  - Add visual accents for the three task moods while retaining text as the primary signal.
  - Preserve `aria-live="polite"`, `role="status"`, escaped text, no controls/links, and two-line clamping.
- **MIRROR**: Existing mood record and component in `ClassroomPetNudge.tsx:7-54`; strict contract test loop in `contracts.test.ts:588-627`.
- **IMPORTS**: Existing `AppLanguage`, `CompanionPetMood`, and nudge projection types only.
- **GOTCHA**: Renaming the renderer component must not rename the main `ClassroomPetService`; classroom eligibility remains a distinct domain service.
- **VALIDATE**:
  - Six moods parse and render in both languages.
  - Unsupported `watching` and all existing malformed/extra payloads still fail.
  - Hostile HTML-looking strings remain escaped and unlinked.
  - Component contains no button, input, anchor, image, or unsafe HTML path.

### Task 5: Add Sparse Task-Phase Encouragement

- **ACTION**: Implement `TaskPetService` using validated task updates and the established timer-service pattern.
- **IMPLEMENT**:
  - Export constants: first delay 20,000 ms, successful interval 120,000 ms, visible time 5,000 ms, busy retry 20,000 ms.
  - Export pure `taskPetMood(snapshot)` returning `thinking`, `working`, `verifying`, or null from the explicit phase table.
  - `handleTaskUpdate(value: unknown)` must parse `TaskUpdateSchema`, replace the active task on a new task ID, update mood without restarting the original first-delay timer, and invalidate on ineligible/terminal states.
  - Subscribe to `AppPreferencesService` using the existing `classroomPetEnabled` field. Implement idempotent `start()`/`stop()` and stale lifecycle/generation guards.
  - Provide at least three short strings per language/mood. Rotate deterministically and never repeat the immediately previous message for the same task.
  - Parse every draft with `CompanionPetNudgeDraftSchema` before presentation.
  - If the overlay is busy, schedule one bounded retry; do not build a queue or emit catch-up messages.
  - On successful presentation, dismiss exact ID after 5 seconds, then schedule the 2-minute interval only if the same task/mood remains eligible.
  - `interrupt()` dismisses only its own visible nudge and resumes at normal interval if the task remains eligible.
  - Never use request text, messages, event summary, tool name, paths, URLs, or model output in catalogue selection or copy.
- **MIRROR**: `ClassroomPetService` in full, especially `synchronizeSession`, `isEligible`, `schedule`, `nextMessage`, and `invalidatePresentation`.
- **IMPORTS**: `TaskUpdateSchema`, `CompanionPetNudgeDraftSchema`, `AppPreferencesSchema`, relevant inferred types, `randomUUID`, and `AppPreferencesService` type.
- **GOTCHA**: Phase changes are frequent. Do not reset the 20-second timer on thinking → working → verifying or the first nudge may never fire; capture task ID/generation and choose the current mood only when due.
- **VALIDATE**:
  - Exact phase-to-mood table including every `TaskPhase`.
  - Nothing before 19,999 ms; one presentation at 20,000 ms.
  - Short/terminal/blocked/approval/permission tasks present nothing and clear visible content.
  - Busy surface retries at 20 seconds without creating a stale draft.
  - New task ID invalidates callbacks from the previous task.
  - Preference disable dismisses immediately and prevents later timers.
  - English/Vietnamese rotation avoids an immediate repeat.

### Task 6: Wire Task Nudges and Mood Expressions into Electron Main

- **ACTION**: Reuse the current guidance window and companion nudge event for both classroom and task services.
- **IMPLEMENT**:
  - Instantiate `TaskPetService` beside `ClassroomPetService`.
  - Factor common placement/parse/publication into `showCompanionPetNudge(draft, owner)` and `hideCompanionPetNudge(id?)`; track only in-memory owner (`classroom` or `task`) for diagnostics/lifecycle, not in the renderer contract.
  - Keep `canPresentClassroomPetNudge()` restricted to idle.
  - Add `canPresentTaskPetNudge()` restricted to `processing`/`working`, enabled auxiliary pet, no active nudge, and no interaction/guidance/response. Existing activity state may be displaced because pet nudge already outranks activity.
  - Send nudge changes to both `guidanceWindow` and `companionWindow`, checking each for null/destroyed state independently.
  - Call `taskPetService.handleTaskUpdate(update)` from `coordinateTaskPresentation` after parsing once and before terminal response/presentation cleanup can leave a stale task nudge.
  - Create one `interruptPetNudges()` helper that interrupts both services; replace relevant classroom-only interrupts in task/voice/guidance/response/interaction paths.
  - Start the task service during ready startup, stop it during centralized shutdown, and interrupt it on pet disable/authenticated auxiliary shutdown.
  - Do not change `selectCompanionOverlayMode` order.
  - Ensure a visible task nudge does not mutate `companionState`; `CursorCompanion` derives only a compatible expression from the nudge mood.
- **MIRROR**: Existing classroom service instantiation `src/index.ts:311-317`, main presentation functions `922-982`, task coordination `1689-1734`, and startup/shutdown `1561-1591,2803-2833`.
- **IMPORTS**: `TaskPetService` and its draft types/constants only as needed.
- **GOTCHA**: `sendCompanionPetNudge()` currently returns early unless the guidance window exists. Refactor it to publish independently so the pet window receives mood changes even if the guidance window is being created or has just closed.
- **VALIDATE**:
  - Existing overlay precedence tests remain byte-for-byte equivalent in meaning.
  - Task nudge can appear over activity but never interaction/guidance/response.
  - Starting voice/guidance/response immediately dismisses visible task/classroom nudge.
  - Closing/destroying either auxiliary window never sends through stale `webContents`.
  - Disable/sign-out/shutdown clears timers, hover, visible nudge, and sprite expression.

### Task 7: Update Settings, Localization, Privacy, and Architecture Documentation

- **ACTION**: Make user-facing claims match the new behavior and record the trust boundary.
- **IMPLEMENT**:
  - Replace the Settings helper with concise copy explaining expressive task states, occasional local task/classroom messages, hover reaction, and that pointer hit-testing is local/ephemeral.
  - Do not continue claiming the pet “never watches cursor activity” without qualification after adding hover hit-testing.
  - Add all new English-key translation keys and Vietnamese values to `app-language.ts`.
  - Update `docs/architecture.md` with atlas rendering, state precedence, main hover boolean, and task nudge flow.
  - Update `docs/security.md` with explicit prohibitions: no coordinate IPC, logs, analytics, persistence, classroom evidence, or network transport; no global hooks for Wayland.
  - Update `docs/knowledge-spaces.md` to say hover reaction is local UI interaction and is never class evidence, while preserving the ban on continuous classroom attention monitoring.
  - Update README feature/limitations text, including the Wayland hover fallback and reduced-motion static poses.
  - During implementation, maintain `docs/testing/stateful-animated-desktop-pet.tdd.md` with RED commands/results, GREEN commands/results, atlas checks, and manual packaged matrix.
- **MIRROR**: Existing English-key localization in `app-language.ts`, desktop-pet Settings section `SettingsPage.tsx:791-824`, and privacy wording in `knowledge-spaces.md:78-94`.
- **IMPORTS**: None.
- **GOTCHA**: “No cursor monitoring” remains true for classroom/product analytics, but the UI now locally samples the current point for hover. Use precise wording instead of hiding this distinction.
- **VALIDATE**:
  - Settings SSR test contains local-only/never-recorded wording and task-status behavior.
  - Translation test proves every new key has a Vietnamese value.
  - `rg` confirms docs do not make contradictory absolute cursor claims about the pet.

### Task 8: Run Focused, Full, Package, and Manual Verification

- **ACTION**: Complete automated and packaged verification proportional to the cross-platform window/input risk.
- **IMPLEMENT**:
  - Run focused contract/service/renderer/presentation tests first.
  - Run lint, typecheck, full `npm run check`, and required `npm run package`.
  - Run `git diff --check` and inspect the full diff.
  - Manually test the matrix below on packaged macOS and Windows; test Linux X11/Wayland when hosts are available and document unavailable rows rather than claiming pass.
- **MIRROR**: Required repository gates in `AGENTS.md` and prior manual companion matrices in `.claude/PRPs/reports/classroom-codex-pet-report.md`.
- **IMPORTS**: None.
- **GOTCHA**: Browser/dev-server hover is not evidence for Electron drag/click-through behavior. At least macOS native-window and Windows overlay packaged checks are release gates.
- **VALIDATE**: All commands and manual acceptance items below.

---

## Testing Strategy

### Unit and Component Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Animation state coverage | Every `CompanionState` | A defined row/duration/iteration | Exhaustiveness |
| Hover precedence | idle + hover; busy + hover | hover only for idle | Race/priority |
| Nudge animation alias | Six moods | Compatible documented row | Mood reuse |
| Custom fallback | custom appearance + every state/hover | Exact private URL and CSS class; no atlas | Backward compatibility |
| Hit-test bounds | negative/positive points, inset, exact edges | Inclusive left/top, exclusive right/bottom | Geometry |
| Hover transition dedupe | repeated inside/outside samples | One publish per boolean transition | Timer noise |
| Hover lifecycle | eligible → busy/hidden/stop | false published, timer cleared | Cleanup |
| Wayland gate | linux + wayland | no polling, hover false | Unsupported API |
| Task mood mapping | every task phase | thinking/working/verifying/null | Exhaustive policy |
| First task nudge | 19,999 ms then 1 ms | none then one | Boundary |
| Task nudge cadence | visible 5 s then 119,999 ms + 1 ms | exact dismiss then next present | Boundary |
| Busy surface | first due while unavailable | retry after 20 s | No backlog |
| Stale task callback | task A timer then task B | no task A presentation | Concurrency |
| Preference off | visible/scheduled nudge | immediate dismiss/no future call | Live config |
| Nudge schema | all six moods, invalid values/extras | valid/invalid as specified | Contract |
| Nudge SSR | each language/mood | label, polite status, plain escaped text | Accessibility/security |
| Cursor SSR | default/custom | sprite vs image, correct ARIA/status markup | Rendering |
| Settings/localization | new copy in EN/VI | no English fallback, accurate privacy claim | Product truth |

### Edge Cases Checklist

- [ ] Companion window does not yet exist when state/hover/nudge changes.
- [ ] Companion or guidance window is destroyed between eligibility and send.
- [ ] Pet preference is disabled while hovered, wandering, or showing a nudge.
- [ ] Sign-out and shutdown occur with pending hover/task/classroom timers.
- [ ] New task begins before a stale task-nudge timer fires.
- [ ] Task transitions across thinking/working/verifying before the first delay.
- [ ] Task waits for clarification, approval, permission, or becomes blocked.
- [ ] Response begins streaming while a task nudge is visible.
- [ ] Voice/guidance begins while a classroom nudge is visible.
- [ ] Multiple displays include negative coordinates and different scale factors.
- [ ] Windows overlay bounds change after display add/remove/metrics change.
- [ ] Pointer sits exactly on each hover rectangle edge.
- [ ] Autonomous wander passes under a stationary pointer.
- [ ] User drags the native pet while the local hover boolean is true.
- [ ] Custom companion is active in all operational states.
- [ ] Atlas fails to load: retain static default fallback or visible status indicators.
- [ ] `prefers-reduced-motion: reduce` is enabled before load and toggled at runtime.
- [ ] High contrast/forced colors keeps rings/badges/bubble labels visible.
- [ ] Wayland session receives no hover timer and no exception.
- [ ] English/Vietnamese message catalogues are nonempty and ≤160 characters.
- [ ] Invalid/untrusted nudge content remains text, never HTML/link/image.

### Manual Packaged Matrix

| Platform/mode | Drag | Click-through | Hover | State rows | Nudges | Reduced motion |
|---|---:|---:|---:|---:|---:|---:|
| macOS native 112 px window | Required | N/A outside pet | Required | Required | Required | Required |
| Windows virtual-desktop overlay | N/A | Required across entire desktop | Required | Required | Required | Required |
| Linux X11 native window | Best effort/release-supported behavior | N/A outside pet | Required when host available | Required | Required | Required |
| Linux Wayland | Existing platform behavior | Existing platform behavior | Expected disabled fallback | Required | Required | Required |

---

## Validation Commands

### Asset Validation

```bash
file src/assets/tro-desktop-pet-atlas.png
wc -c src/assets/tro-desktop-pet-atlas.png
```

EXPECT: RGBA PNG, exactly 768 × 1152, at most 2,097,152 bytes.

### Focused Tests

```bash
npm exec -- vitest run \
  src/renderer/companion-animation.test.ts \
  src/renderer/CursorCompanion.test.ts \
  src/main/companion/companion-hover-tracker.test.ts \
  src/main/companion/task-pet-service.test.ts \
  src/main/companion/classroom-pet-service.test.ts \
  src/renderer/CompanionPetNudge.test.tsx \
  src/shared/contracts.test.ts \
  src/main/companion/companion-response-controller.test.ts \
  src/main/presentation/presentation-policy.test.ts \
  src/main/presentation/electron-presentation-presenter.test.ts \
  src/renderer/SettingsPage.test.ts \
  src/renderer/app-language.test.ts
```

EXPECT: All focused tests pass with no unhandled timers.

### Static Analysis

```bash
npm run lint
npm run typecheck
git diff --check
```

EXPECT: Zero lint/type/whitespace errors.

### Coverage

```bash
npm run test:coverage
```

EXPECT: Existing project coverage floor remains satisfied; new pure/service branches are exercised.

### Full Repository Verification

```bash
npm run check
```

EXPECT: Protocol generation check, admin build, runtime checks, lint, typecheck, Rust format/lint/audit, Vitest, and Rust tests all pass.

### Package Verification

```bash
npm run package
```

EXPECT: Production-configured Electron package succeeds and contains the atlas resource.

No `npm run bazel:check` is required because this plan changes no Rust, Cargo, Bazel, or Rust CI file.

### Manual Validation

- [ ] Start an ordinary task that remains in thinking for >20 s: thinking frames play and at most one curated bubble appears.
- [ ] Transition to observing/acting/verifying: distinct rows follow validated state without a stale earlier bubble.
- [ ] Start a short task: no encouragement bubble flashes before completion.
- [ ] Stream a response or show approval/guidance: any pet nudge disappears immediately and the higher-priority card remains visible.
- [ ] Complete/fail/cancel: one-shot state plays or appropriate existing attention behavior occurs; no running-task nudge survives.
- [ ] Hover idle bundled pet: wave starts, wander pauses, leaving resumes cadence.
- [ ] Hover while processing/listening/error/completed: operational animation remains authoritative.
- [ ] Drag native pet after hover: position behavior remains intact.
- [ ] On Windows, click every area around/through the full overlay: underlying app receives the click.
- [ ] Activate a custom companion: all current rings/badges/transforms remain and idle hover bob works.
- [ ] Show classroom encouraging/waiting/celebrating nudges: current cadence and bubble copy remain, with compatible expression.
- [ ] Toggle desktop pet off/on: window, timers, nudge, hover, and animation state cleanly reset.
- [ ] Enable reduced motion: static representative pose changes with state, but no frame/ring/transform animation runs.
- [ ] Inspect English/Vietnamese, screen reader, forced colors, 200% display scaling, and negative-coordinate secondary monitor.
- [ ] Verify PostHog/classroom dashboard/logs contain no pointer, hover, pet-message, or nudge-content data.

---

## Acceptance Criteria

- [ ] The bundled default pet uses real frame animation, not only transforms of one image.
- [ ] All eight current `CompanionState` values have visually distinct, exhaustive mappings.
- [ ] Idle hover produces a dedicated reaction on packaged macOS and Windows without stealing clicks or focus.
- [ ] Hover never overrides operational state and never changes task/lifecycle/policy state.
- [ ] Only a boolean crosses the hover IPC boundary; cursor coordinates are never logged, persisted, analyzed, or transmitted.
- [ ] Wayland disables hover without errors or unsafe input hooks.
- [ ] Custom companions retain exact private URL, current state cues, and a CSS hover fallback.
- [ ] Ordinary active tasks may show sparse, curated English/Vietnamese thinking/working/verifying nudges after the specified delay.
- [ ] Short, terminal, waiting, blocked, permission, approval, and cancelled tasks do not show running nudges.
- [ ] Classroom nudge cadence/content/privacy remains unchanged.
- [ ] Overlay priority remains interaction → guidance → response → pet nudge → activity.
- [ ] Pet nudges remain passive, silent, plain text, bounded, and accessible.
- [ ] `prefers-reduced-motion` freezes the first representative state frame and disables ancillary motion.
- [ ] No new dependency, backend route, database migration, provider call, credential, or permission is added.
- [ ] Focused tests, `npm run check`, `npm run package`, and applicable packaged manual gates pass.

## Completion Checklist

- [ ] Atlas dimensions, row order, alpha, alignment, size, and original fallback asset verified.
- [ ] Animation metadata exhaustively covers `CompanionState`.
- [ ] Hover/task services are injectable, deterministic, idempotent, and stop all timers.
- [ ] Every new boundary value is parsed by a shared schema.
- [ ] Renderer remains sandboxed with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- [ ] No raw IPC, Electron object, cursor point, or CUA surface is exposed.
- [ ] Existing movement, drag, multi-display, response, guidance, voice, and approval paths regressions are covered.
- [ ] Error handling follows service/main conventions and logs no content/coordinates.
- [ ] Localization, accessibility, reduced motion, forced colors, and privacy copy are complete.
- [ ] Documentation clearly distinguishes ephemeral local hover detection from prohibited monitoring.
- [ ] No unnecessary cleanup or unrelated preference rename is included.
- [ ] Implementation report records manual platform rows that could not be run instead of claiming success.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sprite frames jitter or lose the current duck identity | Medium | High | Fixed 128 px cells, stable baseline, palette/silhouette constraints, manual row review at display size |
| Windows overlay steals clicks | Low if design followed | Critical | Never disable `ignoreMouseEvents`; main-process hit-test publishes boolean only; packaged click-through gate |
| Hover polling adds idle wakeups | Medium | Medium | 10 Hz cap, transition dedupe, eligible-only timer, stop on busy/hidden/disable/destroy/shutdown |
| Wayland cursor API is unavailable | High on Wayland | Low | Pure platform gate and documented no-hover fallback; no global hook |
| Task nudges become noisy | Medium | Medium | 20 s first delay, 2 min interval, 5 s visibility, no phase-transition burst, higher-priority suppression |
| Task nudge misstates progress | Low | High | Curated phase-only copy; never use request/event/tool/model content or completion claims before terminal state |
| New task races stale timers | Medium | Medium | Task ID + generation capture, exact dismissal IDs, deterministic fake-timer tests |
| Nudge and response/guidance compete | Medium | High | Preserve pure overlay order and interrupt both nudge services on higher-priority presentation |
| Custom companions regress | Medium | Medium | Keep private `<img>` path and CSS state fallback; focused default/custom tests and manual activation matrix |
| Completed/error one-shot ends on blank atlas cell | Medium | Medium | Six frames, five-step endpoint at -480 px, held final frame, focused CSS/visual check |
| Privacy copy becomes contradictory | Medium | High | Update Settings/security/knowledge docs together; `rg` audit absolute cursor-monitoring claims |
| Atlas increases package size | Low | Low | ≤2 MiB asset budget; one atlas rather than per-state files/dependency |

## Confidence Score

**8/10** — The task, presentation, window, nudge, and testing patterns already exist and require bounded extensions. The principal implementation risk is packaged cross-platform hover/window behavior and the quality/alignment of the authored sprite atlas, both covered by explicit design constraints and manual release gates.

## Notes

- This plan deliberately treats “test is performing” in the request as “task is performing/running,” because Tro's codebase models work as tasks and already exposes validated task phases. No test-runner-specific integration is required.
- The existing CSS already calls the pet animated, but it only transforms the same PNG and overlays rings/badges. This plan upgrades the artwork itself to stateful frames.
- The existing classroom encouragement feature is not reimplemented. It is generalized only at the visual/contract surface and remains a separate explicit-session service.
- Because the default image also anchors custom-companion previews/generation, removing it in favor of only an atlas would create unrelated product changes. Keep both assets.
