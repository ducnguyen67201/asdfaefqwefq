# Plan: Classroom Codex Pet (Tro Companion Nudges)

## Summary

Extend Tro's existing always-on-top cursor companion with a quiet classroom pet mode: during an eligible live student session, the pet occasionally shows a short, curated encouragement such as “You've got this,” and celebrates explicit milestones such as Ready for review. The feature reuses the sandboxed companion and guidance windows, stays local and silent, yields to every operational card, and never watches YouTube, application usage, cursor movement, typing speed, or inferred attention.

This is intentionally a bounded first version. It creates a pleasant alternative to opening entertainment on the side without turning Tro into a blocker, surveillance product, or open-ended child-facing chatbot.

## User Story

As a student in a live class who has finished a task or is waiting for the next step, I want my Tro pet to offer brief, playful encouragement, so that staying with the class feels more rewarding than opening an unrelated video.

## Problem → Solution

Students who finish quickly have no lightweight, enjoyable in-class companion experience and may open a small YouTube window → Tro's existing cursor pet provides occasional local encouragement and explicit-milestone celebrations while the live class remains active, with a student-controlled quiet-mode setting and no activity monitoring.

## Metadata

- **Complexity**: Large
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 24 files (5 create, 19 update; includes product and TDD documentation)
- **Estimated Tasks**: 8
- **External Services**: None
- **Default**: Classroom pet messages enabled; the student can disable them at any time in Settings

---

## Product Decisions

These decisions remove implementation ambiguity and define the MVP:

1. **Tro remains the visible product name.** “Codex Pet” is the feature concept; UI copy calls it the **Classroom pet** or **Tro pet**.
2. **The existing companion is extended.** Do not create a second mascot window, image-generation path, or renderer bridge.
3. **Messages are curated and local.** Use checked-in English and Vietnamese strings. Do not call the model, TTS, hosted API, or an external content service.
4. **The pet does not detect distraction.** It must not inspect processes, browser tabs, URLs, window titles, screen contents, cursor movement, typing rate, audio, or idle time.
5. **“Finished early” is never inferred.** Celebration is keyed only to explicit classroom Attempt states already delivered by `ClassroomSessionService`: `ready_for_review`, `submitted`, or `completed` while the Run is still live.
6. **The experience is passive and silent.** A nudge is a mouse-through, non-focusable, `aria-live="polite"` speech bubble shown for seven seconds. It has no links, text field, keyboard shortcut, sound, or approval-like action.
7. **Operational work always wins.** Clarifications/approvals → walkthrough guidance → task response → pet nudge → companion activity. A pet nudge must disappear immediately when task, voice, guidance, response, or approval presentation begins.
8. **Nudges are deliberately sparse.** The first working nudge is eligible after two minutes, regular nudges are at least eight minutes apart, explicit Ready/Submit/Complete transitions may celebrate after 1.5 seconds, and a busy overlay retries after one minute rather than queuing a backlog.
9. **The setting is local.** `classroomPetEnabled` is stored in the existing mode-`0600` application preferences file and defaults to `true` for old and new installations.
10. **No teacher or parent reporting is added.** Showing, hiding, or disabling pet messages creates no classroom event, Attempt evidence, analytics event, or dashboard signal.

### Curated message categories

Keep every message positive, non-comparative, and at most 160 characters. Include at least three strings per category and language, and do not repeat the immediately previous message for the same Attempt.

| Mood | Eligible explicit state | Example English copy | Example Vietnamese copy |
|---|---|---|---|
| `encouraging` | `assigned`, `in_progress` in a live Run | “You've got this. One small step at a time.” | “Bạn làm được mà. Từng bước nhỏ thôi nhé.” |
| `waiting` | `blocked` in a live Run | “Asking for help was a smart move. Keep your notes nearby while you wait.” | “Nhờ giúp đỡ là một lựa chọn tốt. Giữ ghi chú bên cạnh trong lúc chờ nhé.” |
| `celebrating` | `ready_for_review`, `submitted`, `completed` in a live Run | “Nice work—your task is ready. Take a breath, then check one thing you're proud of.” | “Làm tốt lắm—bài của bạn đã sẵn sàng. Hít thở một chút rồi xem lại điều bạn tự hào nhé.” |

Prohibited copy includes ranking (“you're ahead of everyone”), shame (“stay focused”), behavior claims (“I saw YouTube”), grades, diagnoses, pressure to continue after completion, or claims that the teacher/parent is watching.

---

## UX Design

### Before

```text
┌────────────────────────────── Desktop ──────────────────────────────┐
│ Class activity / editor                                             │
│                                                                     │
│ Student finishes early.                          ┌───────────────┐   │
│ Tro's 44 px pet follows the cursor,              │ tiny YouTube  │   │
│ but says nothing unless a task is running.       │ window        │   │
│                                      (•ᴗ•)       └───────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### After

```text
┌────────────────────────────── Desktop ──────────────────────────────┐
│ Class activity / editor                                             │
│                                                                     │
│                                      ┌──────────────────────────┐   │
│                                      │ TRO PET · NICE WORK      │   │
│                                      │ Your task is ready. Take │   │
│                                      │ a breath—you earned it.  │   │
│                                      └─────────────┬────────────┘   │
│                                                   (•ᴗ•)              │
│ Bubble fades after 7 s; it takes no focus and has no controls.      │
└─────────────────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Live class, active work | Companion is idle between task/voice operations | First encouragement after 2 minutes; then no more than once per 8 minutes | Uses only explicit live-session state |
| Ready/Submit/Complete | Attempt UI changes state | One near-immediate celebratory bubble, then sparse celebration cadence while the Run is live | Never labels the student “fast” or compares them |
| Help requested / blocked | Student waits for teacher help | One supportive waiting message, then sparse waiting cadence | Does not claim the teacher has seen the request |
| Lobby, ended Run, Leave, Withdrawn | Companion remains operational only | No classroom pet messages; pending timers and visible pet bubbles are cleared | Fail closed on stale session state |
| Task/voice/approval/guidance starts | Operational presentation appears | Pet bubble is removed immediately and does not return until the cooldown permits | No stacking or focus stealing |
| Settings | Companion image can be customized | “Classroom pet messages” toggle plus explicit privacy explanation | Turning off clears the current bubble immediately |
| Reduced motion | Existing companion honors `prefers-reduced-motion` | Pet bubble uses the existing reduced-motion fade and no new perpetual animation | Color and text still convey mood |

---

## Strategic Design

### Approach

Add a main-process `ClassroomPetService` that subscribes to the existing validated `ClassroomSessionService` and `AppPreferencesService`. The service owns only scheduling and curated message selection. Electron main remains the presentation arbiter: it converts an eligible service nudge into a bounded `CompanionPetNudge`, positions the existing guidance window beside the companion, and clears the nudge whenever a higher-priority surface becomes active.

Add one outbound-only companion event (`companion:pet-nudge-changed`) to the narrow preload API. The guidance renderer receives the parsed projection and renders a dedicated, read-only `ClassroomPetNudge` component. No renderer request can manufacture, schedule, dismiss, or escalate a pet nudge.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Detect or block YouTube/browser usage | Rejected | Violates the classroom privacy model, creates false positives, and changes a fun companion into surveillance/control software |
| Infer completion from inactivity, typing speed, or screen analysis | Rejected | The repository explicitly excludes inferred “stuck”/attention state; explicit Attempt lifecycle is authoritative |
| Reuse `CompanionGuidance` with a new `pet_nudge` kind | Rejected | Pet content has lower priority and different semantics; a separate contract prevents it from masquerading as teaching guidance or hiding a task response |
| Use `CompanionResponseCard` | Rejected | Response cards require task/card IDs and task actions; pet nudges are not task output and must remain non-interactive |
| Generate messages with the model | Rejected for MVP | Adds cost, latency, moderation, uncertainty, and child-facing open-ended content where curated local copy is sufficient |
| Make the companion window clickable | Rejected for MVP | The 44 px window is intentionally mouse-through and non-focusable; changing that could steal desktop clicks |
| Add a minigame or rewards economy | Deferred | Requires product rules, persistence, accessibility, and anti-compulsion design beyond the requested encouragement feature |

### Scope

- Bounded bilingual pet-nudge contract and outbound companion event.
- Local preference with backwards-compatible default and live change events.
- Timer-driven classroom eligibility/message service with deterministic tests.
- Main-process overlay arbitration and existing guidance-window reuse.
- Passive, accessible, mood-styled renderer card.
- Settings toggle and privacy copy.
- Unit/component/contract tests and classroom privacy documentation.

## NOT Building

- YouTube, browser tab, application, process, or website detection/blocking.
- Screen, cursor, keyboard, microphone, attention, or idle-time monitoring.
- Teacher/parent controls, reports, notifications, dashboards, or analytics.
- Model-generated pet conversation, free-form chat, TTS, or narration.
- Points, streaks, coins, inventory, pet health, rewards, minigames, or push notifications.
- Backend routes, database migrations, Rust changes, or paid provider calls.
- New companion images or changes to the five-per-month customization quota.
- A second BrowserWindow or broader/raw Electron IPC.

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 (critical) | `AGENTS.md` | all | Renderer sandbox, narrow `DesktopApi`, schema-boundary, and verification invariants |
| P0 (critical) | `src/shared/contracts.ts` | 1362-1478, 1821-1833, 1878-1887, 2140-2229 | Assigned/Attempt/classroom projections, preferences, companion states, guidance/response/interaction contracts |
| P0 (critical) | `src/main/knowledge/classroom-session-service.ts` | 14-114 | Authoritative in-memory live-session projection and `onChange` lifecycle |
| P0 (critical) | `src/index.ts` | 496-569, 779-880, 931-1076, 1340-1386, 1491-1564, 2261-2330, 2445-2513, 2519-2558 | Companion state, overlay presentation, priority behavior, secure BrowserWindows, startup/shutdown |
| P0 (critical) | `src/main/companion/companion-response-controller.ts` | 16-43 | Pure overlay precedence selector to extend |
| P0 (critical) | `src/renderer/GuidanceCallout.tsx` | 100-162, 345-538 | Existing event subscriptions, presentation identity reset, and callout selection/rendering |
| P1 (important) | `src/main/knowledge/classroom-directive-service.ts` | 14-67, 98-186 | Dependency-injected timers, session subscription, idempotent start/stop, and stale-attempt reset pattern |
| P1 (important) | `src/main/preferences/app-preferences-service.ts` | all | Mode-`0600` local persistence and backwards-compatible Zod defaults |
| P1 (important) | `src/shared/desktop-api.ts` | 104-202, 320-351 | Fixed channel names and narrow outbound companion listener API |
| P1 (important) | `src/preload.ts` | 753-938 | Per-event schema parsing before auxiliary renderer callbacks |
| P1 (important) | `src/renderer/App.tsx` | 855-986, 1177-1198, 1608-1647, 1990-2017, 2498-2535 | Preference drafts, both save paths, change detection, and Settings wiring |
| P1 (important) | `src/renderer/SettingsPage.tsx` | 27-64, 96-164, 337-491 | Settings prop conventions, localized toggle pattern, and shared save form |
| P1 (important) | `src/renderer/app-language.ts` | 1-11, 583-669 | English-keyed Vietnamese translation table and companion copy conventions |
| P1 (important) | `src/index.css` | 755-775, 1607-1744, 2062-2500 | Transparent auxiliary modes, speech bubble visuals, companion state visuals, reduced motion |
| P1 (important) | `src/main/companion/companion-position.ts` | 88-142 | Existing bounded callout placement beside the cursor companion |
| P1 (important) | `src/main/companion/companion-response-controller.test.ts` | 186-221 | Table-driven precedence and hidden-content preservation tests |
| P1 (important) | `src/main/knowledge/classroom-directive-service.test.ts` | 35-67, 127-188 | Injected timer/session fixtures and end-of-Run behavior tests |
| P1 (important) | `src/main/preferences/app-preferences-service.test.ts` | 29-149 | Default, validation, mode-`0600` file, and legacy preference tests |
| P1 (important) | `src/renderer/companion-response-card-view.test.ts` | 42-65, 67-113 | SSR component/accessibility/plain-text assertions |
| P2 (reference) | `docs/knowledge-spaces.md` | 62-94 | Event-only classroom dashboard and prohibition on cursor/typing/screen/attention collection |
| P2 (reference) | `docs/security.md` | 151-178, 196-212 | Content-free analytics and private companion asset/IPC boundaries |
| P2 (reference) | `docs/architecture.md` | 10-21, 64-79, 81-102 | Renderer/main responsibility split and current companion pipeline |

> `docs/CODEX-NAVIGATION-GUIDE.md`, referenced by the workspace supplement, is not present in this checkout. The table above is the resolved implementation map for this feature.

## External Documentation

No external research needed — the feature uses established internal Electron, React, Zod, timer, classroom-session, preferences, and companion-overlay patterns. No dependency or platform API upgrade is required.

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Evidence |
|---|---|---|---|
| Similar implementation | `src/main/knowledge/classroom-directive-service.ts:14-50,157-186` | A service subscribes to classroom session state, injects timers/randomness, resets stale work, and publishes bounded local projections | `start()`, `reset()`, `schedule()`, `publish()` |
| Similar presentation | `src/index.ts:847-880,994-1033,1062-1098` | Electron main positions one guidance window beside the companion and decides focus/mouse behavior | `placeGuidanceCallout(...)`, `setGuidanceWindowInteractive(...)`, `showInactive()` |
| Naming | `src/main/companion/companion-response-controller.ts:16-35` | PascalCase types/classes; `Companion*` nouns; verb-first selectors and methods | `CompanionOverlayMode`, `selectCompanionOverlayMode` |
| Error handling | `src/main/preferences/app-preferences-service.ts:26-38` | Ignore only known `ENOENT`; propagate unexpected persistence errors | Guarded `error.code === 'ENOENT'` |
| Logging | `src/index.ts:1018-1026,1593-1597` | Namespaced message plus error/fixed metadata; do not log user content | `[companion] Could not present...`, `[voice:tts] ... { taskId }` |
| Type definitions | `src/shared/contracts.ts:2140-2181` | Define Zod schema at the boundary, infer TypeScript type at the bottom of the file | `CompanionGuidanceSchema`, `CompanionResponseCardSchema` |
| Test pattern | `src/main/knowledge/classroom-directive-service.test.ts:35-67` | Inject timer functions and mocked services; assert exact side effects | `setTimer: noTimer`, `vi.fn(...)`, explicit `service.stop()` |
| Component test | `src/renderer/companion-response-card-view.test.ts:29-113` | Render to static markup and assert ARIA, plain text, and fixed controls | `renderToStaticMarkup(createElement(...))` |
| Configuration | `src/shared/contracts.ts:1821-1833` | Preferences use Zod defaults so older JSON remains readable | `.default(...)` on newly introduced fields |
| Dependencies | `package.json` | Existing React 19, Electron 43, Zod 4, and Vitest 4 are sufficient | No new package required |
| Entry point | `src/index.ts:2519-2558` | Services start after Electron is ready and stop during the centralized shutdown path | `app.whenReady()`, `prepareApplicationShutdown()` |
| Data flow | `ClassroomSessionService.onChange` → `ClassroomPetService` → `src/index.ts` → `IPC_CHANNELS` → `preload.ts` → `GuidanceCallout` | Main owns scheduling/presentation; renderer receives a parsed projection only | Preserve one-way trust boundary |
| State changes | `src/main/knowledge/classroom-session-service.ts:70-91` | Attempt/Run changes create a new validated projection and emit once | `ClassroomSessionProjectionSchema.parse({...})` then `emit()` |
| Contracts | `src/shared/desktop-api.ts:320-351` | Auxiliary renderer gets named functions, never raw IPC/Electron | `onGuidanceChange`, `onResponseChange` |
| Architecture | `docs/knowledge-spaces.md:79-82` | Classroom insight is explicit-event only, never inferred attention | No cursor, typing, screen-history, or “stuck” collection |

---

## Patterns to Mirror

### SCHEMA_FIRST_BOUNDARY

SOURCE: `src/shared/contracts.ts:2140-2148`

```ts
export const CompanionGuidanceSchema = z.object({
  kind: z.enum(['action_preview', 'guidance', 'result']).default('guidance'),
  language: AppLanguageSchema.optional(),
  message: z.string().trim().min(1).max(240),
  playback: z.enum(['playing', 'paused']).default('playing'),
  shortcuts: CompanionGuidanceShortcutsSchema.optional(),
  side: z.enum(['left', 'right']),
  target: z.string().trim().min(1).max(80).optional(),
});
```

Create `CompanionPetNudgeSchema` beside the companion presentation contracts and export its inferred type with the other contract types. Keep it strict, bounded, action-free, and parsed in main and preload.

### BACKWARD_COMPATIBLE_PREFERENCE

SOURCE: `src/shared/contracts.ts:1821-1833`

```ts
export const AppPreferencesSchema = z.object({
  appLanguage: AppLanguageSchema.default('en'),
  autonomyMode: AutonomyModeSchema.default('balanced'),
  muteSystemAudioWhileSpeaking: z.boolean().default(false),
  primaryLanguage: PrimaryLanguageSchema.nullable(),
});

export const UpdateAppPreferencesRequestSchema = z.object({
  appLanguage: AppLanguageSchema.default('en'),
  autonomyMode: AutonomyModeSchema.default('balanced'),
  muteSystemAudioWhileSpeaking: z.boolean().default(false),
  primaryLanguage: PrimaryLanguageSchema,
});
```

Add `classroomPetEnabled: z.boolean().default(true)` to both schemas and the service's explicit empty preference. The default must load old files and protect older renderer save payloads during an update transition.

### SESSION_SUBSCRIBED_TIMER_SERVICE

SOURCE: `src/main/knowledge/classroom-directive-service.ts:14-50,157-181`

```ts
interface DirectiveDependencies {
  client: Pick<KnowledgeSpaceClient, 'claimDirective' | 'listDirectives'>;
  sessionService: ClassroomSessionService;
  openExternal(url: string): Promise<void>;
  random?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

start(): void {
  if (this.stopSessionListener) return;
  this.stopSessionListener = this.dependencies.sessionService.onChange((session) => {
    const nextAttemptId = session && !session.leftAt ? session.attemptId : null;
    if (nextAttemptId === this.attemptId) return;
    this.reset(nextAttemptId);
  });
  this.reset(this.dependencies.sessionService.get()?.attemptId ?? null);
}
```

Mirror idempotent start/stop, injected timers, explicit listener cleanup, generation/attempt checks for stale callbacks, and one authoritative session source. The pet service adds an `AppPreferencesService.onChange` subscription but no polling or network client.

### STRICT_OVERLAY_PRECEDENCE

SOURCE: `src/main/companion/companion-response-controller.ts:35-43`

```ts
export function selectCompanionOverlayMode(
  candidates: CompanionOverlayCandidates,
): CompanionOverlayMode {
  if (candidates.interaction) return 'interaction';
  if (candidates.guidance) return 'guidance';
  if (candidates.response) return 'response';
  if (candidates.activity) return 'activity';
  return 'hidden';
}
```

Insert `pet_nudge` only after `response` and before `activity`. Main must still interrupt/clear a visible pet nudge immediately when a higher-priority surface or non-idle companion state arrives; precedence alone must not leave a stale hidden nudge queued.

### SECURE_MOUSE_THROUGH_AUXILIARY_WINDOW

SOURCE: `src/index.ts:2270-2305`

```ts
companionWindow = new BrowserWindow({
  alwaysOnTop: true,
  focusable: false,
  frame: false,
  transparent: true,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    sandbox: true,
    webSecurity: true,
  },
});

companionWindow.setIgnoreMouseEvents(true, { forward: true });
companionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
companionWindow.webContents.on('will-navigate', (event) => {
  event.preventDefault();
});
```

Reuse `guidanceWindow`; do not add or relax a BrowserWindow. Pet nudges keep the guidance window non-focusable/mouse-through and show it with `showInactive()`.

### PARSED_OUTBOUND_EVENT

SOURCE: `src/preload.ts:792-805`

```ts
onGuidanceChange(listener) {
  const eventHandler = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    listener(CompanionGuidanceSchema.nullable().parse(value));
  };

  ipcRenderer.on(IPC_CHANNELS.companionGuidanceChanged, eventHandler);
  return () =>
    ipcRenderer.removeListener(
      IPC_CHANNELS.companionGuidanceChanged,
      eventHandler,
    );
},
```

Expose only `onPetNudgeChange(listener)` on `CompanionApi`; validate `CompanionPetNudgeSchema.nullable()` before invoking the listener and return exact cleanup.

### MODE_0600_LOCAL_PERSISTENCE

SOURCE: `src/main/preferences/app-preferences-service.ts:41-48`

```ts
async write(preferences: AppPreferences): Promise<void> {
  const validated = AppPreferencesSchema.parse(preferences);
  await mkdir(path.dirname(this.filePath), { recursive: true });
  await writeFile(
    this.filePath,
    `${JSON.stringify(validated, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}
```

Keep the existing file and permissions. `AppPreferencesService.onChange` emits the validated complete preferences only after a successful write; failed writes must not alter the pet's live setting.

### PLAIN_TEXT_ACCESSIBLE_CARD

SOURCE: `src/renderer/CompanionResponseCard.tsx:130-160`

```tsx
<aside
  aria-labelledby="companion-response-title"
  className={`guidance-callout companion-response-card guidance-callout--${response.side}`}
  role="region"
>
  ...
  <div className="companion-response-card__message">
    {response.message}
  </div>
</aside>
```

Render the nudge string as a React text node, use a stable labelled `role="status"`/`aria-live="polite"` region, and provide no HTML, URL conversion, button, or input.

### ERROR_HANDLING_AND_LOGGING

SOURCE: `src/index.ts:1018-1026`

```ts
try {
  activeCompanionInteraction = toCompanionInteraction(
    interaction,
    position.x < target.x ? 'left' : 'right',
  );
} catch (error) {
  console.error('[companion] Could not present pending interaction.', error);
  if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
  return;
}
```

Pet schema failures or window failures fail closed by dropping the nudge. If logging is necessary, use a fixed `[classroom-pet]` message and fixed state/reason only; never log message text, class/activity names, Attempt IDs, URLs, or visible applications. A pet failure must not reveal/focus the main window or disrupt class work.

### TEST_STRUCTURE

SOURCE: `src/main/knowledge/classroom-directive-service.test.ts:35-67`

```ts
const noTimer = (() => 1) as unknown as typeof setTimeout;
const noClear = (() => undefined) as unknown as typeof clearTimeout;

const service = new ClassroomDirectiveService({
  client: { ... },
  sessionService: classroom,
  openExternal,
  setTimer: noTimer,
  clearTimer: noClear,
});
service.start();
await service.pollNow();
expect(openExternal).toHaveBeenCalledWith(directive.url);
service.stop();
```

Use injected timers or Vitest fake timers, explicit service cleanup, exact publish/dismiss assertions, and stale-session cases. Tests must not require Electron, a backend, or wall-clock waits.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/main/companion/classroom-pet-service.ts` | CREATE | Pure/testable eligibility, cadence, bilingual message selection, and timer lifecycle |
| `src/main/companion/classroom-pet-service.test.ts` | CREATE | Eligibility, timing, priority retry, localization, stale callback, preference, and cleanup coverage |
| `src/renderer/ClassroomPetNudge.tsx` | CREATE | Dedicated passive/plain-text accessible pet speech bubble |
| `src/renderer/ClassroomPetNudge.test.tsx` | CREATE | Static markup, localization, mood, ARIA, and hostile-text escaping coverage |
| `src/shared/contracts.ts` | UPDATE | Add bounded pet nudge/mood schemas and backwards-compatible preference field/types |
| `src/shared/contracts.test.ts` | UPDATE | Validate strict bounds/moods and legacy/default preference parsing |
| `src/main/preferences/app-preferences-service.ts` | UPDATE | Add default and validated `onChange` notifications after successful writes |
| `src/main/preferences/app-preferences-service.test.ts` | UPDATE | Cover legacy default, persisted toggle, successful event, and no event on failure |
| `src/main/companion/companion-response-controller.ts` | UPDATE | Add `pet_nudge` below response and above activity in the pure overlay selector |
| `src/main/companion/companion-response-controller.test.ts` | UPDATE | Lock full operational/pet/activity precedence and preservation behavior |
| `src/index.ts` | UPDATE | Instantiate/start/stop service; own active nudge, positioning, sending, interruption, and cleanup |
| `src/shared/desktop-api.ts` | UPDATE | Add fixed outbound channel and `CompanionApi.onPetNudgeChange` only |
| `src/preload.ts` | UPDATE | Parse nullable pet projections and expose exact listener cleanup |
| `src/renderer/GuidanceCallout.tsx` | UPDATE | Subscribe to pet nudges, include them in presentation identity/selection, render new component |
| `src/renderer/guidance-callout-status.test.ts` | UPDATE | Keep guidance status behavior unchanged and add pet/operational separation assertion if helper signatures move |
| `src/renderer/CompanionResponseCard.tsx` | UPDATE | Extend callout availability/selection with optional `hasPetNudge` without changing response actions |
| `src/renderer/companion-response-card-view.test.ts` | UPDATE | Assert `interaction > guidance > response > pet` and no response regression |
| `src/renderer/App.tsx` | UPDATE | Load/draft/save/change-detect the preference through both save paths and pass Settings props |
| `src/renderer/SettingsPage.tsx` | UPDATE | Add localized Classroom pet toggle and explicit no-monitoring copy |
| `src/renderer/SettingsPage.test.ts` | UPDATE | Assert default toggle, privacy copy, controlled checked state, and Vietnamese UI |
| `src/renderer/app-language.ts` | UPDATE | Add English-keyed Vietnamese translations for setting/status labels; message catalogue stays in main service |
| `src/index.css` | UPDATE | Add compact mood variants and preserve mouse-through/reduced-motion behavior |
| `docs/knowledge-spaces.md` | UPDATE | Document local-only pet behavior and absence of classroom/teacher telemetry |
| `docs/testing/classroom-codex-pet.tdd.md` | CREATE | Record red/green focused commands, acceptance mapping, and final verification |

The estimate is 24 files including the product documentation and TDD record; some adjacent test changes may combine if helper signatures remain unchanged.

---

## Step-by-Step Tasks

### Task 1: Define the pet projection and backwards-compatible preference

- **ACTION**: Add the complete schema/type and local preference foundation before UI or scheduling code.
- **IMPLEMENT**:
  - In `src/shared/contracts.ts`, define `CompanionPetMoodSchema = z.enum(['encouraging', 'waiting', 'celebrating'])`, a strict `CompanionPetNudgeDraftSchema`, and a strict `CompanionPetNudgeSchema` that extends the draft with placement. The draft contains:
    - `id: z.string().uuid()`
    - `language: AppLanguageSchema`
    - `message: z.string().trim().min(1).max(160)`
    - `mood: CompanionPetMoodSchema`
  - The full renderer projection adds `side: z.enum(['left', 'right'])`.
  - Export inferred `CompanionPetMood`, `CompanionPetNudgeDraft`, and `CompanionPetNudge` types near the other companion types.
  - Add `classroomPetEnabled: z.boolean().default(true)` to `AppPreferencesSchema` and `UpdateAppPreferencesRequestSchema`.
  - Add `classroomPetEnabled: true` to `EMPTY_PREFERENCES`.
  - Add an `EventEmitter` (or equivalently narrow listener set) to `AppPreferencesService`, `onChange(listener): () => void`, and emit a schema-parsed full snapshot only after `store.write` resolves.
  - Return/emit defensive parsed objects; a listener must not mutate service state.
- **MIRROR**: `SCHEMA_FIRST_BOUNDARY`, `BACKWARD_COMPATIBLE_PREFERENCE`, and `MODE_0600_LOCAL_PERSISTENCE` above.
- **IMPORTS**:
  - `EventEmitter` from `node:events` in the preferences service.
  - Existing Zod/AppLanguage/AppPreferences imports only; no package changes.
- **GOTCHA**:
  - `UpdateAppPreferencesRequestSchema` is a complete save contract, not a patch. The new default is required so an older renderer cannot accidentally fail during app-update skew.
  - Do not emit when validation or persistence fails.
  - Do not place pet messages inside persisted preferences.
- **VALIDATE**:
  - Contract tests accept all three moods, reject extra keys/invalid UUID/>160 characters, and preserve plain strings.
  - Parsing an old `{ primaryLanguage: 'vi' }` preference returns `classroomPetEnabled: true` plus all existing defaults.
  - Service tests show a false setting round-trips, emits once after a successful write, and emits zero times on write failure.

### Task 2: Implement the classroom pet scheduling policy as a standalone service

- **ACTION**: Create a main-process service with no Electron, renderer, network, analytics, model, or filesystem dependency of its own.
- **IMPLEMENT**:
  - Create `ClassroomPetService` with dependency injection for:
    - `sessionService: Pick<ClassroomSessionService, 'get' | 'onChange'>`
    - `preferencesService: Pick<AppPreferencesService, 'get' | 'onChange'>`
    - `canPresent(): boolean`
    - `present(nudge: CompanionPetNudgeDraft): boolean` (main assigns side after positioning and parses the full renderer projection)
    - `dismiss(id: string): void`
    - optional `createId`, `setTimer`, and `clearTimer`
  - Export pure `classroomPetMood(session)` returning:
    - `null` if absent, left, Run not `open`/`live`, or Attempt `withdrawn`
    - `encouraging` for `assigned`/`in_progress`
    - `waiting` for `blocked`
    - `celebrating` for `ready_for_review`/`submitted`/`completed`
  - Keep checked-in `Readonly<Record<AppLanguage, Record<CompanionPetMood, readonly string[]>>>` catalogues. Parse the draft before passing it to main; main parses the final side-bearing payload before publishing.
  - On idempotent `start()`, subscribe to both services, load the current preferences, and synchronize current session state. On `stop()`, remove both listeners, clear timers/current nudge, increment a generation token, and become inert.
  - Scheduling constants:
    - working first delay: `120_000 ms`
    - explicit mood transition delay: `1_500 ms`
    - regular minimum interval: `480_000 ms`
    - visible duration: `7_000 ms`
    - busy retry: `60_000 ms`
  - Reset message index/cadence when `attemptId` changes. A callback must capture attempt ID + generation and drop itself if either changed.
  - When a due timer fires and `canPresent()` is false, do not create/publish a nudge; schedule one busy retry. Do not accumulate retries.
  - When presentation succeeds, schedule exact dismissal by nudge ID and the next interval. Ensure the same message is not selected twice consecutively.
  - When the setting becomes false or eligibility becomes null, cancel all timers and dismiss only the currently owned pet nudge.
  - Expose `interrupt()` for Electron main to dismiss a visible pet nudge without destroying session eligibility; resume only on the normal next interval/busy retry, never immediately under higher-priority UI.
- **MIRROR**: `SESSION_SUBSCRIBED_TIMER_SERVICE` and `TEST_STRUCTURE` above.
- **IMPORTS**:
  - `randomUUID` from `node:crypto`.
  - `ClassroomSessionProjectionSchema`/types, `AppPreferences`/`AppLanguage`, `CompanionPetMood` from shared contracts.
  - Type-only service imports to avoid runtime cycles.
- **GOTCHA**:
  - Time is used only as a sparse presentation cadence, never as evidence of inactivity or completion.
  - A `completed` Attempt can still have a live Run; this is the intended early-finisher state. Stop only when the Run ends/session leaves or the preference is off.
  - Avoid `setInterval`; one owned `setTimeout` makes resets and stale-callback rejection explicit.
  - Do not use `Math.random` to decide whether to show a nudge. Deterministic rotation is easier to test and avoids uneven frequency.
- **VALIDATE**:
  - RED tests first for each row in the unit-test table below.
  - Use fake/injected timers; no test waits in real time.
  - Grep the new service for `fetch`, provider clients, analytics, `screen`, `BrowserWindow`, and CUA imports; expect none.

### Task 3: Integrate pet presentation into Electron main without widening authority

- **ACTION**: Make `src/index.ts` the sole owner of the visible pet nudge and reuse the secure guidance BrowserWindow.
- **IMPLEMENT**:
  - Add `PET_NUDGE_CALLOUT_SIZE = { height: 126, width: 320 }` beside existing callout sizes.
  - Add `activeCompanionPetNudge: CompanionPetNudge | null`, `sendCompanionPetNudge()`, `showClassroomPetNudge(draft): boolean`, and `hideClassroomPetNudge(id?): void`.
  - `showClassroomPetNudge` must:
    1. return `false` unless auxiliary windows are enabled, companion state is `idle`, and overlay selection is otherwise `hidden`;
    2. create/reuse `guidanceWindow` without changing its security flags;
    3. use `getCurrentCompanionScreenPosition`, nearest display `workArea`, and `placeGuidanceCallout`;
    4. create a fully parsed nudge with side derived from the placement;
    5. deactivate numbered shortcuts, call `setGuidanceWindowInteractive(false)`, set the compact bounds, send the projection, and `showInactive()`.
  - Extend `currentCompanionOverlayMode()` with the active pet nudge. In the pure selector, preserve `interaction > guidance > response > pet_nudge > activity > hidden`.
  - Instantiate `ClassroomPetService` with `classroomSessionService`, `appPreferencesService`, and the main presentation callbacks.
  - Start once after `app.whenReady()` and stop in `prepareApplicationShutdown()`.
  - Interrupt/clear a visible pet nudge before:
    - any non-`idle` `updateCompanionState`;
    - companion interaction, operational guidance, walkthrough recap, or response presentation;
    - sign-out/auxiliary-window disable;
    - guidance window close and application shutdown.
  - Send current pet state in `guidanceWindow.webContents.on('did-finish-load')` and reset it to null on close.
  - When a pet nudge expires, hide the guidance window only if no higher-priority content is active. Never clear or dismiss an operational response/guidance/interaction from a stale pet timer.
- **MIRROR**: `STRICT_OVERLAY_PRECEDENCE`, `SECURE_MOUSE_THROUGH_AUXILIARY_WINDOW`, and existing `showCompanionResponseCard`/`showGuidanceCallout` placement.
- **IMPORTS**:
  - `ClassroomPetService` from `./main/companion/classroom-pet-service`.
  - `CompanionPetNudgeSchema` and type from `./shared/contracts`.
- **GOTCHA**:
  - `guidanceWindow` is shared. Every clear path must be identity/kind-aware so a seven-second pet timer cannot hide a newer approval or response.
  - Do not call `setGuidanceWindowInteractive(true)` for pet content.
  - Do not set the operational companion state to `completed` just to animate a pet celebration; the bubble mood is sufficient and avoids conflicting with `PresentationCoordinator`.
  - Do not reveal/focus the main window on pet failure.
- **VALIDATE**:
  - Overlay selector tests cover every priority and prove pet content does not mutate/persist over higher-priority content.
  - Manual tests confirm the pet and bubble remain beside the cursor across primary/secondary displays and never capture clicks.

### Task 4: Add the one-way, schema-parsed companion event

- **ACTION**: Extend only the outbound auxiliary renderer surface needed to display the main-owned nudge.
- **IMPLEMENT**:
  - Add `companionPetNudgeChanged: 'companion:pet-nudge-changed'` to `IPC_CHANNELS`.
  - Add `onPetNudgeChange(listener: (nudge: CompanionPetNudge | null) => void): () => void` to `CompanionApi`.
  - In `preload.ts`, listen on the fixed channel, parse `CompanionPetNudgeSchema.nullable()`, invoke the callback, and remove the exact listener in cleanup.
  - Do not add a `DesktopApi` method, invoke handler, generic event subscription, raw `send`, or renderer-authored nudge request.
- **MIRROR**: `PARSED_OUTBOUND_EVENT` above and adjacent appearance/guidance/response listeners.
- **IMPORTS**:
  - Schema in `preload.ts` and type in `src/shared/desktop-api.ts`.
- **GOTCHA**:
  - `contextBridge.exposeInMainWorld('troCompanion', companionApi)` is shared by auxiliary modes. Keep the surface narrow and typed.
  - Nullable is required to clear the card; never use missing/undefined as state.
- **VALIDATE**:
  - `npm run typecheck` proves global `Window.troCompanion` remains consistent through `src/shared/global.d.ts`'s existing `CompanionApi` reference.
  - Contract tests prove malformed/oversized events are rejected before renderer state changes.

### Task 5: Render the passive pet bubble and preserve accessibility/precedence

- **ACTION**: Create a dedicated presentation component and wire it into `GuidanceCallout` below every operational card.
- **IMPLEMENT**:
  - `ClassroomPetNudge.tsx` renders:
    - one labelled `<aside role="status" aria-live="polite">`;
    - Tro avatar/name;
    - localized mood label (`Keep going`, `While you wait`, `Nice work`; corresponding Vietnamese labels) based on `nudge.language` and `nudge.mood`;
    - `nudge.message` as a plain React text node;
    - no interactive element.
  - In `GuidanceCallout`, subscribe/unsubscribe via `onPetNudgeChange`, include `pet:${id}` in presentation identity, and pass `hasPetNudge` into the callout selector.
  - Extend `getCompanionCalloutKind` to return `'pet_nudge'` after response. Make `hasPetNudge` optional/default false if that avoids noisy existing callers, but tests must pass it explicitly for pet cases.
  - Preserve current interaction/guidance/response code byte-for-byte where possible.
  - Add `.classroom-pet-nudge` and mood modifier styles using the existing callout shell. Keep width/height within the 320×126 window, three-line clamp, pointer-events none, and high-contrast text.
  - Reuse current `@media (prefers-reduced-motion: reduce)` behavior; add no unbounded animation. An optional single-entry celebration transform must be disabled there.
- **MIRROR**: `PLAIN_TEXT_ACCESSIBLE_CARD`, existing `guidance-callout` CSS, and SSR test style.
- **IMPORTS**:
  - `CompanionPetNudge` type in the component.
  - New component in `GuidanceCallout.tsx`.
- **GOTCHA**:
  - `aria-live="polite"` can be distracting if content updates too often; the main cadence and stable `id` are part of accessibility correctness.
  - Do not reuse interactive response classes (`pointer-events: auto`) or global numbered shortcuts.
  - Hostile-looking message text in tests must escape as text and must never become `<a>`/HTML.
- **VALIDATE**:
  - Static markup tests assert label/role/live region, all mood labels, Vietnamese copy, no button/input/link, and HTML escaping.
  - Callout selector tests assert `interaction > guidance > response > pet_nudge`, including all candidates present.
  - Existing guidance status and response-card suites remain unchanged/passing.

### Task 6: Add the student-controlled Classroom pet setting

- **ACTION**: Thread the new preference through the two existing save paths and render an explicit privacy-preserving toggle.
- **IMPLEMENT**:
  - In `App.tsx`, add `classroomPetEnabledDraft` initialized to `true`.
  - Load it from `getAppPreferences`, include it in `saveSettings`, include it in the permission-onboarding preference save, include it in both dependency arrays, and include it in Settings `hasChanges`.
  - Pass value and `onClassroomPetEnabledChange` to `SettingsPage`; the change handler clears save/error feedback like adjacent draft handlers.
  - In the existing preferences form, add a `settings-toggle` section near the top (after App language or before Task safety):
    - title: “Classroom pet messages”
    - checked value: the controlled prop
    - description: “During a live class, Tro can show occasional local encouragement. It does not watch apps, websites, cursor activity, or share pet messages with teachers.”
  - Add Vietnamese translations for every new Settings/mood label string used in the renderer.
  - Keep one explicit Save preferences action; do not write localStorage or update the setting before the validated IPC save succeeds.
- **MIRROR**: Existing system-audio `settings-toggle` at `SettingsPage.tsx:446-465`, draft/save wiring at `App.tsx:1177-1198,1608-1647,2498-2535`.
- **IMPORTS**: None beyond existing preference/React types.
- **GOTCHA**:
  - `enablePermissions` is a second full-preference save path. Omitting the new field there would reset it to the schema default.
  - The renderer draft may change immediately, but `ClassroomPetService` reacts only after `AppPreferencesService.update` successfully emits.
  - Avoid copy that promises to stop a student opening YouTube; this feature is encouragement, not enforcement.
- **VALIDATE**:
  - Settings SSR tests cover checked/unchecked controlled states, English privacy text, Vietnamese title/description, and save button change detection at the App policy/helper level where feasible.
  - Preference service tests prove disabling immediately emits false and the service dismisses its owned visible nudge.

### Task 7: Document the privacy and lifecycle boundary

- **ACTION**: Make the non-surveillance design durable in repository documentation.
- **IMPLEMENT**:
  - Add a “Classroom pet” paragraph to `docs/knowledge-spaces.md` near **Live classroom rooms** or **Privacy and insights**:
    - eligibility uses only current local Run/Attempt projection;
    - celebration uses explicit Ready/Submit/Complete states;
    - messages are curated/local and not persisted as class evidence;
    - no apps/sites/screens/cursor/typing/attention are observed;
    - no pet event reaches the teacher dashboard or analytics.
  - Create `docs/testing/classroom-codex-pet.tdd.md` during implementation with the repository's existing TDD format: approved scope, red/green evidence, acceptance matrix, focused commands, full gates, and any environment caveats.
- **MIRROR**: `docs/knowledge-spaces.md:79-94` and `docs/testing/companion-response-card.tdd.md`.
- **IMPORTS**: N/A.
- **GOTCHA**: Do not describe a future chatbot/minigame as shipped. Document only this bounded MVP.
- **VALIDATE**: Documentation language matches code constants/states and explicitly says no YouTube/application detection.

### Task 8: Run focused and repository verification

- **ACTION**: Execute tests in risk order, repair regressions, inspect the final diff, then run the required project gates.
- **IMPLEMENT**:
  - Run focused service/contract/preference/overlay/component/settings suites first.
  - Run lint/typecheck.
  - Run `npm run check` and `npm run package` as required by `AGENTS.md`.
  - Review `git diff --check` and the full diff for accidental IPC widening, content logging, missing cleanup, and preference resets.
  - No Bazel check is required unless implementation unexpectedly changes Rust, Cargo, Bazel, or Rust CI; such changes are out of scope and should be removed.
- **MIRROR**: Repository verification guidance in `AGENTS.md`.
- **IMPORTS**: N/A.
- **GOTCHA**:
  - `npm run check` includes admin build, Rust engine/version checks, lint, typecheck, Cargo fmt/clippy/audit/tests, and Vitest. Record infrastructure-only failures separately but do not call the feature complete until the required gates pass or the environment limitation is explicit.
  - `npm run package` uses Doppler production configuration; never add secrets or bypass configuration to force a pass.
- **VALIDATE**: Every command and manual item below has a recorded result in the TDD document.

---

## Testing Strategy

### Unit Tests

| Test | Input / setup | Expected output | Edge Case? |
|---|---|---|---|
| Contract accepts bounded nudge | UUID, `encouraging`, English, 160-char message, side | Exact parsed object | Boundary |
| Contract rejects unsafe shape | invalid UUID/mood, blank/>160 message, extra property | Zod failure | Yes |
| Legacy preferences default pet on | old JSON without new field | `classroomPetEnabled: true` | Migration |
| Preference off persists/emits | complete update with false | mode-`0600` file and one false change event | State |
| Failed preference write is inert | store throws | update rejects and no change event | Failure |
| No session/lobby/ended/left/withdrawn | each ineligible projection | no timer/publish; visible pet dismissed | Yes |
| Active work first nudge | live `in_progress`, enabled, advance 119,999 then 1 ms | no publish before boundary; one `encouraging` publish at boundary | Timing |
| Sparse cadence | successful publish, advance 479,999 then 1 ms | no second publish before boundary; one at boundary | Timing |
| Explicit early-finish celebration | transition live Attempt to `ready_for_review` | `celebrating` after 1,500 ms, no activity inference | Core |
| Waiting support | transition to `blocked` | `waiting` nudge after 1,500 ms | Core |
| Busy surface yields | due timer with `canPresent=false` | no payload, one retry after 60,000 ms | Priority |
| Higher-priority interrupt | pet visible then `interrupt()` | exact ID dismissed, no immediate replacement | Concurrency |
| Attempt changes during timer | old timer due after new Attempt activates | stale timer publishes/dismisses nothing for new Attempt | Race |
| Disable immediately | pet visible then successful preference false event | timers cleared and exact visible nudge dismissed | Control |
| Localized catalogue | `appLanguage: vi` in current preferences | Vietnamese message and language field | i18n |
| No consecutive duplicate | two successful nudges in same mood | different catalogue entries | UX |
| Overlay precedence | all combinations | interaction → guidance → response → pet → activity → hidden | Regression |
| Pet card plain text | message contains `<img>` and URL | escaped text; no `img`, link, button, or input | Security |
| Pet card accessibility | each mood/language | labelled polite status and correct localized mood label | A11y |
| Settings toggle | true/false props, EN/VI | correct checked state and privacy copy | UI |

### Edge Cases Checklist

- [ ] No authenticated classroom session
- [ ] Classroom lobby is not live
- [ ] Run changes from live/open to closed/archived while a nudge is visible
- [ ] Student leaves while the show or hide timer is queued
- [ ] Attempt changes while a stale timer callback is queued
- [ ] Attempt state is withdrawn
- [ ] Ready/Submit/Complete occurs while approval, guidance, response, voice, or task activity is visible
- [ ] Busy retry remains busy for multiple cycles without creating a backlog
- [ ] Preference load rejects or contains legacy data
- [ ] Preference save fails while the draft toggle differs from persisted state
- [ ] Sign-out/window destruction/application shutdown occurs with active timers
- [ ] Guidance window reloads while pet is visible
- [ ] Multiple displays and negative virtual-desktop coordinates
- [ ] App language changes during the same live Attempt
- [ ] Custom and default companion appearances
- [ ] Reduced-motion preference
- [ ] Long/hostile-looking message text remains bounded/plain text
- [ ] No network, provider, analytics, classroom event, evidence, or task-history write

---

## Validation Commands

### Focused Unit and Component Tests

```bash
npm exec vitest run -- \
  src/main/companion/classroom-pet-service.test.ts \
  src/main/companion/companion-response-controller.test.ts \
  src/main/preferences/app-preferences-service.test.ts \
  src/shared/contracts.test.ts \
  src/renderer/ClassroomPetNudge.test.tsx \
  src/renderer/companion-response-card-view.test.ts \
  src/renderer/guidance-callout-status.test.ts \
  src/renderer/SettingsPage.test.ts
```

EXPECT: All focused tests pass with no real timer waits or network/native dependency.

### Static Analysis

```bash
npm run lint
npm run typecheck
```

EXPECT: Zero lint errors and zero TypeScript errors.

### Privacy/Boundary Audit

```bash
rg -n "fetch|BrowserWindow|screen\.|webContents|analytics|track|CUA|cursor|keyboard|youtube|YouTube" \
  src/main/companion/classroom-pet-service.ts
```

EXPECT: No runtime imports/calls for network, Electron, analytics, CUA, cursor, keyboard, or YouTube detection. Mentions are acceptable only in comments/tests that state the prohibition; prefer none in production service code.

```bash
rg -n "companionPetNudge|pet-nudge" \
  src/shared/desktop-api.ts src/preload.ts src/main/ipc/register-ipc.ts
```

EXPECT: One fixed outbound event/listener in desktop API + preload and no new renderer-to-main invoke handler in `register-ipc.ts`.

### Full Required Check

```bash
npm run check
```

EXPECT: Admin build, runtime compatibility, Rust-only check, lint, typecheck, Cargo fmt/clippy/audit/tests, and all Vitest suites pass.

### Package Verification

```bash
npm run package
```

EXPECT: Production Electron package succeeds with the sandboxed auxiliary windows and preload bundle.

### Diff Validation

```bash
git diff --check
git status --short
git diff -- \
  src/shared/contracts.ts \
  src/shared/desktop-api.ts \
  src/preload.ts \
  src/main/companion \
  src/main/preferences \
  src/index.ts \
  src/renderer \
  src/index.css \
  docs/knowledge-spaces.md \
  docs/testing/classroom-codex-pet.tdd.md
```

EXPECT: No whitespace errors, unrelated edits, raw IPC exposure, secret/config changes, provider calls, or content-bearing logs.

### Manual Validation

- [ ] Sign in with a student account and join a live/hybrid classroom lobby; verify no pet bubble appears in lobby.
- [ ] Open the Run and keep the Attempt `in_progress`; after the configured first delay, verify one short mouse-through bubble appears beside the existing pet for seven seconds.
- [ ] Mark the Attempt Ready for review; verify a celebratory bubble appears after ~1.5 seconds only if the overlay is otherwise idle.
- [ ] Repeat with Help/blocked; verify supportive waiting copy, not a claim that the teacher responded.
- [ ] While a pet bubble is visible, start voice input or a Tro task; verify the pet bubble disappears immediately and the operational UI is unaffected.
- [ ] While an approval, guidance, or completed response card is visible, reach a pet due time; verify no pet card overlays it and only one retry is scheduled.
- [ ] Disable Classroom pet messages in Settings and save; verify the visible pet bubble disappears and no more appear in the current class.
- [ ] Re-enable and save; verify normal cadence resumes without an immediate spam burst.
- [ ] Switch the app language to Vietnamese; verify setting labels, mood labels, and subsequent pet copy are Vietnamese.
- [ ] Test default and custom companion images; verify both remain intact.
- [ ] Test a secondary display/negative-coordinate layout; verify the bubble stays within work area beside the pet.
- [ ] Enable OS reduced motion; verify no new perpetual/pulsing pet animation.
- [ ] Click/type through the pet and bubble; verify the underlying application receives input and Tro does not take focus.
- [ ] End the Run, Leave, sign out, close the guidance window, and quit with pending timers; verify no stale bubble or error appears.
- [ ] Inspect the teacher dashboard/Attempt events and application analytics logs; verify no pet show/hide/setting/content event exists.
- [ ] Verify there is no behavioral difference when a student opens YouTube: the pet neither detects, mentions, closes, nor reports it.

---

## Acceptance Criteria

- [ ] During an eligible live class, the existing Tro cursor companion can show a curated English/Vietnamese encouragement after the defined delay and cadence.
- [ ] Explicit `ready_for_review`, `submitted`, and `completed` transitions can trigger a timely celebratory pet message while the Run remains live.
- [ ] `blocked` can trigger a supportive waiting message without implying teacher action.
- [ ] Lobby, ended/closed/archived, left, withdrawn, signed-out, and disabled states never show or retain a pet nudge.
- [ ] The implementation does not observe or infer browser/app/YouTube use, screen content, cursor/typing behavior, attention, or idle state.
- [ ] No pet data reaches the backend, analytics, classroom events, Attempt evidence, task history, teachers, or parents.
- [ ] Messages are fixed local strings, bounded to 160 characters, plain text, silent, non-interactive, and free of ranking/shame/surveillance language.
- [ ] Operational interaction, guidance, response, voice, and task activity always preempt pet content without losing their state.
- [ ] The guidance window remains sandboxed, navigation-denied, mouse-through, and non-focusable for pet content.
- [ ] The local setting defaults on for legacy/new preference files, saves mode `0600`, and turning it off clears the current nudge immediately.
- [ ] English/Vietnamese UI, reduced motion, multiple displays, default/custom companion assets, and shutdown cleanup are verified.
- [ ] Focused tests, `npm run lint`, `npm run typecheck`, `npm run check`, and `npm run package` pass.

## Completion Checklist

- [ ] All tasks completed in order with RED tests before production behavior where practical
- [ ] All new schemas are strict/bounded and inferred types are exported
- [ ] Every IPC/model boundary parses input before use
- [ ] No raw Electron/IPC/CUA surface reaches the renderer
- [ ] No new dependency, provider call, feature flag, database migration, or Rust change
- [ ] Service start/stop is idempotent and every timer/listener is cleaned up
- [ ] Stale Attempt/session/timer identities cannot hide newer UI
- [ ] Overlay precedence is locked by pure tests
- [ ] Preference migration and both renderer save paths are covered
- [ ] Error handling fails closed and logs no pet/class content
- [ ] Accessibility and reduced-motion tests/manual checks pass
- [ ] Privacy documentation and TDD evidence are updated
- [ ] Final diff contains no unrelated user changes
- [ ] Self-contained — implementation requires no additional codebase search or product decision

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Pet bubble hides or is hidden behind an operational card | Medium | High | Separate projection, strict precedence tests, main-owned identity-aware interruption, no shared dismissal by blind timer |
| Nudges feel distracting or nagging | Medium | Medium | Two-minute first delay, eight-minute minimum cadence, seven-second passive display, quiet-mode setting, no sound/focus |
| Product is perceived as monitoring students | Medium | High | No app/screen/cursor/typing imports, explicit Settings/docs copy, no analytics/classroom events, manual dashboard audit |
| False “finished early” claim | Low | High | Never use that phrase in UI; celebrate only explicit Attempt states and say the work is marked ready/submitted/completed |
| Preference update resets during onboarding | Medium | Medium | Add field to both complete save paths and default it in both Zod schemas; test legacy and onboarding saves |
| Stale timer clears a newer card/session | Medium | High | Attempt ID + generation + nudge ID checks; exact-ID dismiss; task/guidance interruptions; race tests |
| Guidance window size clips localized copy | Medium | Medium | 160-char contract, three-line clamp, Vietnamese SSR/manual test, 320×126 bounded size |
| Child-facing copy becomes comparative/shaming | Low | High | Checked-in reviewed catalogue, prohibited-copy rules, no model generation |
| Multiple-display placement regresses | Low | Medium | Reuse `placeGuidanceCallout` and current companion screen position; manual negative-coordinate test |
| Full package gates require unavailable Doppler/infrastructure | Medium | Medium | Run focused/static gates first; record exact environment failure without bypassing secrets/config; do not mark complete until resolved or explicitly handed off |

## Notes

- The parent complaint motivates a more engaging in-class experience, but the implementation deliberately does not promise enforcement. A pet can make staying in context more pleasant; it cannot guarantee that a student will not open YouTube.
- The existing custom companion workflow already lets a student choose a pet/character image. This plan adds behavior to that same companion and does not change generation quota, storage, moderation, or privacy.
- A future interactive “pet break” or activity-aware micro-challenge should start with a separate product/child-safety plan. It must define content policy, teacher intent, accessibility, persistence, compulsion limits, model moderation, and whether any activity context can be used. None of that authority is implied here.
