# Completed Plan: Fast Coach and Heavy Agent Routing

## Outcome

Tro will have one task entry point and two execution lanes:

- **Coach**: observes, explains, points with Cursor Buddy, highlights, and speaks through ElevenLabs. Coach never moves the learner's real cursor and has no mutating tools.
- **Agent**: uses the existing OpenAI Agents SDK loop when the learner explicitly asks Tro to perform actions such as clicking, typing, editing, running commands, sending, or submitting.

The route is selected locally in Electron main without an additional LLM call. Classroom context already owned by `ClassroomSessionService` and `ActivityContext` is passed to either lane. Coach progress is stored as a small field in existing encrypted task state; this plan does not introduce a second session database or a parallel lifecycle system.

## Why This Change

Today, interactive guidance runs inside the full Agents SDK loop:

```text
observe → model → show_guidance → wait → model → observe → model
```

That is correct for autonomous computer use but unnecessarily slow and expensive for teaching. A learner asking “How do I do this Scratch exercise?” needs one grounded next step, not a general-purpose agent loop around every animation and wait.

The target architecture is:

```text
voice or text
     ↓
TaskApplicationService
     ├── resolve trusted Activity/Classroom/Workspace context
     ├── RequestRouter.route()       // pure, local, no network
     │
     ├── coach ──► CoachRuntime ──► CursorBuddyController + ElevenLabs
     │                    ▲
     │                    └── fresh observation after meaningful learner activity
     │
     └── agent ──► existing LocalAgentRuntime / OpenAI Agents SDK
                            └── policy → tool → verify → repeat

Both lanes publish through the existing TaskRuntime and renderer API.
```

## Scope

### Included

- Voice and typed requests use the same routed task entry point.
- Coach can return a concise text answer or one visible coaching step.
- Screen-based coaching observes before the first step.
- Cursor Buddy moves independently from the operating-system cursor.
- Cursor Buddy callout, target highlight, and ElevenLabs narration are synchronized.
- Coach waits locally without repeated LLM calls while the learner is idle.
- After meaningful learner activity, Coach captures a fresh observation and asks for the next step, correction, or completion in one model call.
- Explicit autonomous requests use the existing Heavy Agent runtime.
- Joined classroom Attempt/Activity context is inherited in Electron main and passed into either lane.
- Small instructional continuity is reused for later requests in the same Attempt.

### Excluded

- A new general chat architecture.
- A new session database or a second encrypted storage subsystem.
- Replacing the existing Agents SDK checkpoint/session/invocation journal.
- Renaming the existing agent runtime classes solely for aesthetics.
- Persisting screenshots, cursor coordinates, keystrokes, voice audio, or attention telemetry.
- Letting Coach click, type, drag, open links, submit, or mutate files.
- An LLM call whose only purpose is choosing Coach versus Agent.

---

## Expected Behavior

### 1. Learner asks for visual guidance

Example: “How do I do this Scratch exercise?”

```text
T+0 ms      Final transcript is shown and remains visible.
T+0–100 ms  UI changes once to a stable “Tro is looking…” state.
             The Cursor Buddy and callout do not blink.

             Electron main routes the request to Coach locally.
             Coach captures one fresh current-screen observation.
             One model request returns either answer, coach_step, or complete.

             For coach_step:
             1. Callout appears beside Cursor Buddy.
             2. ElevenLabs narration starts.
             3. Cursor Buddy glides to the target.
             4. Tight target highlight appears when Buddy arrives.
             5. The callout and highlight remain stable while waiting.
```

The real operating-system cursor remains exactly where the learner placed it.

### 2. Learner performs the requested step

```text
learner mouse/key/scroll activity
     ↓
short local debounce
     ↓
one fresh observation
     ↓
one model decision:
  - next coach_step
  - correction coach_step
  - complete recap
```

There is no separate model call to “verify” and another model call to choose the next step. The same post-action decision compares the fresh screen with the prior expected outcome and returns the result.

### 3. Learner does nothing

- Coach keeps the current instruction visible.
- No repeated chat/card blinking.
- No model call.
- No normal-path screenshot polling every 600 ms.
- No repeated “Are you done?” prompt.
- Repeat and Pause operate locally using cached copy/audio.

An accessibility fallback may offer Continue, but the normal path advances from detected learner activity plus a fresh screen.

### 4. Screen or application changes unexpectedly

- The next fresh observation is treated as authoritative.
- Old observation IDs, coordinates, and targets are discarded.
- Coach returns a correction or a new step grounded in the new screen.
- Coach never points using stale coordinates.

### 5. Learner asks Tro to do the work

Example: “Do it for me—click the green arrow and type my answer.”

- Router selects Agent.
- Existing Agents SDK runtime observes, proposes an action, applies policy/approval, executes once, and verifies.
- Checkpoint, tool catalog digest, cancellation, cost limits, and unknown-outcome protections remain unchanged.
- Agent may control the computer; Coach may not.

### 6. Learner joins a classroom session

```text
join room
  → hosted API returns trusted Run + Attempt + Activity version
  → ClassroomSessionService owns the active projection
  → new task inherits the active attemptId in TaskApplicationService
  → ActivityContextService creates one Work Session
  → ActivityContext is placed in the task authority
  → selected Coach or Agent receives the same trusted Activity context
```

For later prompts in the same Attempt, Tro may reuse only:

- last completed Coach step number;
- last expected outcome;
- one short learner-visible recap;
- current trusted classroom directive already present in Activity context.

When the learner leaves, the Run closes, the Attempt becomes terminal, or the Activity version changes, active coaching is cancelled and that local recap is not injected into another Attempt.

---

## Routing Design

### Public route

Use only two routes:

```ts
export const TaskRouteSchema = z.enum(['coach', 'agent']);
export type TaskRoute = z.infer<typeof TaskRouteSchema>;

export const RequestedModeSchema = z.enum(['auto', 'coach', 'agent']);
export type RequestedMode = z.infer<typeof RequestedModeSchema>;
```

Coach internally returns `answer`, `coach_step`, or `complete`; those are output kinds, not additional application routes.

### Route decision

```ts
type RouteDecision = {
  route: 'coach' | 'agent';
  requiresObservation: boolean;
};
```

Do not persist a large reason-code taxonomy. Operational logs need only `route` and, when the safe fallback is used, `fallback: true`.

### Precedence

1. `requestedMode === 'agent'` → Agent.
2. `requestedMode === 'coach'` → Coach; require observation when screen context is required.
3. Trusted workspace execution or a workspace Activity asking for work → Agent.
4. Explicit mutation intent—click, type, edit, create, send, submit, run, install, delete, upload, download, or equivalent supported Vietnamese forms → Agent.
5. Classroom Help or visible “show/teach/guide/explain/check this” intent → Coach with observation.
6. Screen context `required` with no explicit mutation → Coach with observation.
7. Everything else → Coach without observation for a concise answer.

The router is a pure function. It does not inspect a screenshot, call a model, grant tools, or perform effects. Ambiguous requests default to Coach because Coach cannot mutate external state.

### Escalation

Coach cannot start Agent itself. If the learner changes intent, a new explicit request is submitted with `requestedMode: 'agent'`. The task facade cancels the Coach task and starts a new Agent task with newly resolved authority.

---

## Runtime Design

### CoachRuntime

One concrete class owns the non-mutating flow:

```ts
interface CoachRuntimeStart {
  taskId: string;
  request: string;
  activity: ActivityContext | null;
  requiresObservation: boolean;
  priorProgress: CoachProgress | null;
}

class CoachRuntime {
  start(input: CoachRuntimeStart): Promise<void>;
  cancel(taskId: string): void;
  shutdown(): Promise<void>;
}
```

No generic runtime framework is needed. `TaskApplicationService` stores the selected route and dispatches to this class or the existing `AgentRuntimeAdapter`.

### Coach model result

```ts
const CoachDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('answer'),
    text: z.string().trim().min(1).max(1_200),
    language: z.enum(['en', 'vi']),
  }),
  z.object({
    kind: z.literal('coach_step'),
    stepNumber: z.number().int().min(1).max(100),
    hook: z.string().trim().min(1).max(50),
    instruction: z.string().trim().min(1).max(90),
    reason: z.string().trim().min(1).max(90),
    expectedOutcome: z.string().trim().min(1).max(160),
    target: z.string().trim().min(1).max(80),
    observationId: z.string().uuid(),
    observationFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    point: NormalizedPointSchema,
    region: NormalizedRegionSchema.nullable(),
  }),
  z.object({
    kind: z.literal('complete'),
    recap: z.string().trim().min(1).max(240),
  }),
]);
```

Coach sends one current resized image at most. The host validates observation identity and coordinate mapping before Cursor Buddy presentation. A stale or invalid decision is rejected and never displayed.

### Model-call rules

| Event | Observation | Model calls |
|---|---:|---:|
| Plain non-screen question | 0 | 1 |
| First visible Coach step | 1 | 1 |
| Waiting/idle | 0 | 0 |
| Repeat/Pause | 0 | 0 |
| Meaningful learner action | 1 fresh observation | 1 |
| Stable unchanged screen after learner input | 1 | 0 additional; continue waiting |
| New application/surface after learner input | 1 | 1 |
| Completion | included in post-action decision | 0 extra |

Do not automatically retry a provider request after ambiguous dispatch. Keep the existing cost reservation and no-replay rules.

### Learner activity

Keep the existing `LearnerActionGate`; do not introduce a generic activity framework.

Extend it with one concrete subscription/callback supplied at composition time:

```ts
wait({
  baselineFingerprint,
  subscribeToActivity(onActivity),
  observe,
  signal,
});
```

The activity source emits only a coarse event (`pointer`, `keyboard`, `scroll`, or explicit `continue`). It does not expose key values, typed content, cursor coordinates, attention state, or application data. After activity, the gate debounces and captures. If OS activity monitoring is unavailable, use a bounded low-frequency fallback, not a permanent 600 ms loop.

### CursorBuddyController

`CursorBuddyController` remains the single presentation owner:

- movement;
- callout placement;
- target highlight;
- ElevenLabs narration;
- Repeat/Pause;
- stable waiting/checking states;
- return to the learner cursor after completion/cancellation.

It receives a validated Coach decision. It never chooses the next step, calls a model, or moves the operating-system cursor.

### Heavy Agent

Preserve the current `LocalAgentRuntime`, utility process, protocol validation, Agents SDK `Runner`, `HostBackedSession`, compaction, checkpoint, invocation journal, frozen tool catalog, policy, and CUA execution.

Remove only the coaching responsibilities:

- walkthrough prompt injection;
- `WalkthroughState` from new runs/checkpoints;
- `show_guidance` from the Agent tool catalog;
- model correction loops whose only purpose is forcing the next coaching step;
- waiting for learner teaching activity inside an Agent tool call.

Do not rename the existing runtime classes in this change. Old persisted active walkthrough tasks may fail with a clear restart message if their protocol/checkpoint is incompatible; completed history remains readable.

---

## Classroom Context and Continuity

### Reuse existing authority

`ActivityContext` already contains:

- `attemptId`;
- `workSessionId`;
- `activityVersionId`;
- `runId`;
- Space and Activity definition;
- current directive;
- guidance policy and criteria;
- prior progress.

Do not create a duplicate `LearningSessionBinding` with the same fields.

### Minimal CoachProgress

Add one optional bounded value to task-local state:

```ts
const CoachProgressSchema = z.object({
  attemptId: z.string().uuid().nullable(),
  activityVersionId: z.string().uuid().nullable(),
  stepNumber: z.number().int().min(0).max(100),
  expectedOutcome: z.string().trim().max(160).nullable(),
  recap: z.string().trim().max(240).nullable(),
});
```

Persist it using the existing `EncryptedAgentStateStore` with the task snapshot. Add one query that finds the latest completed/active Coach task for the same owner + Attempt + Activity version. Do not add another encrypted store.

On a new Coach request:

1. Resolve the current trusted Activity context.
2. Load the latest matching `CoachProgress` from existing encrypted task state.
3. Use it as bounded context for the first Coach decision.
4. If no exact owner/Attempt/version match exists, start with no prior Coach progress.

Heavy Agent keeps its task-scoped SDK history and checkpoint. It receives Activity context but does not import Coach screenshots, coordinates, or tool history.

### Invalidation

Before starting either lane, and before a consequential Agent dispatch:

- verify the active joined Attempt still matches `goal.activity.attemptId` when the task inherited classroom authority;
- verify the Run is open and the Attempt is not submitted/completed/withdrawn;
- treat a changed Activity version as a new context;
- cancel Cursor Buddy and narration when classroom authority ends.

No new revision service is required. Use the authoritative current projection and exact IDs already available in `ClassroomSessionService`.

---

## Files and Ownership

### Add

| File | Responsibility |
|---|---|
| `src/main/application/task-request-router.ts` | Pure Coach/Agent route decision |
| `src/main/application/task-request-router.test.ts` | Route precedence and language fixtures |
| `src/main/coach/coach-contracts.ts` | `CoachDecision` and `CoachProgress` schemas |
| `src/main/coach/coach-runtime.ts` | One-shot answer/step/completion orchestration |
| `src/main/coach/coach-runtime.test.ts` | Exact capture/model-call tests |

### Modify

| File | Change |
|---|---|
| `src/shared/contracts.ts` | Add two-route and requested-mode schemas; add route/progress to active task contract with legacy parsing |
| `src/shared/contracts.test.ts` | New and legacy contract cases |
| `src/main/application/task-application-service.ts` | Resolve context, route once, persist, start selected lane |
| `src/main/application/task-application-service.test.ts` | Prove exactly one selected runtime starts |
| `src/main/agent/task-runtime.ts` | Carry route/progress through existing lifecycle |
| `src/main/agent-runtime/encrypted-agent-state-store.ts` | Query latest matching Coach progress; no new store |
| `src/main/agent-runtime/encrypted-agent-state-store.test.ts` | Owner/Attempt/version isolation |
| `src/main/presentation/learner-action-gate.ts` | Activity-gated capture instead of normal idle polling |
| `src/main/presentation/learner-action-gate.test.ts` | No capture/model work while idle |
| `src/main/companion/cursor-buddy-controller.ts` | Consume Coach step directly and hold stable UI |
| `src/main/companion/cursor-buddy-controller.test.ts` | Movement/speech/highlight/wait ordering |
| `src/main/agent/runtime-tool-registry.ts` | Remove `show_guidance` from Agent catalog |
| `src/main/agent-runtime/agent-runtime-adapter.ts` | Remove walkthrough state from new Agent starts/checkpoints |
| `services/agent-runtime/src/local-runtime-server.ts` | Remove walkthrough-specific prompt/correction loop |
| `services/agent-runtime/src/protocol.ts` | Version protocol after walkthrough removal |
| `src/index.ts` | Compose Coach runtime and activity callback; route runtime events through existing TaskRuntime |
| `src/renderer/App.tsx` | Preserve transcript and stable thinking state; optional explicit Coach/Agent choice |
| `docs/architecture.md` | Document two lanes and authority boundary |
| `docs/inference-cost-lifecycle.md` | Document Coach call/capture policy |

Expected implementation footprint: approximately 20–24 touched files including focused tests and documentation, with only five new files and no new dependency. Most changes delete walkthrough coupling or extend existing owners rather than add new layers.

---

## Implementation Sequence

### Task 1 — Contracts and pure router

- **ACTION**: Add the two route schemas, requested mode, Coach decision/progress schemas, and pure router.
- **IMPLEMENT**: Keep legacy v10 task/history parsing; add the selected route to the new active contract; route according to the documented precedence.
- **MIRROR**: Zod-first contracts in `src/shared/contracts.ts:162–260`; pure policy in `src/main/agent/screen-context-policy.ts:21–49`.
- **GOTCHA**: Text classification is intent only, never tool authority. Ambiguity must choose Coach.
- **VALIDATE**: Router corpus covers English/Vietnamese, noisy Scratch transcripts, explicit “do it,” Help/Check, workspace tasks, and required screen context.

### Task 2 — Coach runtime

- **ACTION**: Add `coach-contracts.ts`, `coach-runtime.ts`, and one test file.
- **IMPLEMENT**: Capture only when required, make one structured model request, validate evidence, present through Cursor Buddy, and use the same post-action decision for verification plus next step.
- **MIRROR**: Existing authenticated OpenAI client and image evidence policy; do not introduce a second transport.
- **GOTCHA**: Coach must not import `RuntimeToolRegistry`, `TaskExecutionCoordinator.dispatchTool`, or any mutating CUA method.
- **VALIDATE**: Assert exact model/capture counts from the table above.

### Task 3 — Activity-gated Cursor Buddy flow

- **ACTION**: Extend `LearnerActionGate` and adapt `CursorBuddyController`.
- **IMPLEMENT**: Coarse input activity wakes a debounced observation; Repeat/Pause remain local; stable callout/highlight persists between phases.
- **MIRROR**: Existing injected timer/observe callbacks and Cursor Buddy geometry/narration ordering.
- **GOTCHA**: Do not capture key content or coordinates. Do not move the OS cursor. Respect reduced motion.
- **VALIDATE**: Fake timers prove idle causes no capture, activity causes one debounced capture, and presentation does not blink/remount.

### Task 4 — Route the task facade and reuse existing session state

- **ACTION**: Modify `TaskApplicationService`, `TaskRuntime`, `EncryptedAgentStateStore`, and composition in `src/index.ts`.
- **IMPLEMENT**: Resolve trusted context once, route once, persist before start, dispatch cancel/finish to the selected lane, and query matching Coach progress from existing encrypted task state.
- **MIRROR**: Current persist-before-start and cleanup behavior in `task-application-service.ts:90–166`.
- **GOTCHA**: Never reuse Coach progress across owner, Attempt, or Activity version. Do not create duplicate Work Sessions.
- **VALIDATE**: Tests prove only one runtime starts, classroom Activity context reaches both lanes, and invalidated sessions cancel active work.

### Task 5 — Remove walkthrough ownership from Heavy Agent

- **ACTION**: Remove walkthrough prompt/state/tool code from runtime protocol, graph, and tool catalog without renaming the runtime.
- **IMPLEMENT**: Preserve every execution safety mechanism unrelated to coaching.
- **MIRROR**: Existing durable start/resume/dispatch code; delete only walkthrough branches.
- **GOTCHA**: Protocol digest changes may invalidate active walkthrough checkpoints. Fail them closed and keep completed history parseable.
- **VALIDATE**: Agent runtime tests prove `show_guidance` is absent, actions still checkpoint before dispatch, and unknown actions are never replayed.

### Task 6 — UX, documentation, and end-to-end verification

- **ACTION**: Preserve transcript/thinking UI, add route visibility where useful, update docs, and add end-to-end fixtures.
- **IMPLEMENT**: Use one kill switch, `TROCODE_FAST_COACH_ENABLED`, for rollback; do not add shadow runtime execution or multi-state rollout configuration.
- **MIRROR**: Existing task/voice state mapping and content-free analytics.
- **GOTCHA**: Do not log prompts, transcripts, screenshots, target text, or classroom identity.
- **VALIDATE**: Scratch visual flow, Vietnamese narration, real cursor immobility, no blinking, and latency/call-count gates.

---

## Tests

### Required unit tests

- Router returns Coach for visible how-to, classroom Help, required-screen ambiguity, and ordinary answers.
- Router returns Agent for explicit actions and workspace work.
- Coach cannot access mutating dependencies by constructor/type.
- Coach rejects stale observation IDs/fingerprints and invalid coordinates.
- Coach first step uses one capture and one model call.
- Waiting, Repeat, Pause, and idle timeout use zero model calls.
- One learner action produces one debounced observation and at most one model decision.
- Coach progress query requires exact owner + Attempt + Activity version.
- Leaving/switching classroom context cancels active Coach presentation.
- Heavy Agent catalog no longer contains `show_guidance`.
- Heavy Agent checkpoint/journal/no-replay tests remain green.

### Required integration tests

```text
voice transcript
  → submitTask once
  → route locally
  → fresh observation
  → Coach decision
  → Buddy + callout + highlight + speech
  → learner action
  → fresh observation
  → next/correction/complete decision
```

```text
explicit “do it”
  → submitTask once
  → Agent
  → existing policy/checkpoint/tool/verify loop
```

```text
joined classroom Attempt
  → inherited ActivityContext
  → Coach progress reused only for exact same Attempt/version
  → leave or new Attempt prevents reuse
```

### Performance gates

- Local route p95: under 5 ms.
- Transcript-to-stable-thinking UI: under 100 ms.
- First Coach result: one model call; target p50 under 3 seconds and p95 under 5 seconds under supported network conditions.
- Sixty seconds idle after a step: zero additional model calls and zero normal-path captures.
- One meaningful learner action: at most two captures only when stabilization is required, and exactly one next model decision.

---

## Validation Commands

```bash
npm test -- src/main/application/task-request-router.test.ts
npm test -- src/main/coach/coach-runtime.test.ts
npm test -- src/main/presentation/learner-action-gate.test.ts
npm test -- src/main/companion/cursor-buddy-controller.test.ts
npm test -- src/main/application/task-application-service.test.ts
npm test -- src/main/agent-runtime/agent-runtime-adapter.test.ts
npm test -- src/main/agent-runtime/encrypted-agent-state-store.test.ts
npm test -- services/agent-runtime/test
npm run check
npm run package
git diff --check
```

Run `npm run bazel:check` only if CUA driver contracts, Rust, Cargo manifests, Bazel configuration, or Rust CI change.

---

## Acceptance Criteria

### Product behavior

- [ ] Voice transcript stays visible after release.
- [ ] One stable thinking state appears immediately; no blinking callout/chat.
- [ ] “Show me how” produces one grounded Coach step.
- [ ] Cursor Buddy and its small callout move to the target while narration plays.
- [ ] The real cursor never moves in Coach mode.
- [ ] Highlight targets the UI element, not the whole tutorial/card.
- [ ] Current instruction remains visible while waiting.
- [ ] Tro does not ask “I’m done?” after every step.
- [ ] Learner activity causes one fresh observation and one next decision.
- [ ] Changed sites/programs are handled from the fresh screen, not stale coordinates.
- [ ] Explicit “do it for me” uses Heavy Agent.

### Architecture

- [ ] One `submitTask` entry point and one `TaskRuntime` lifecycle remain.
- [ ] Router makes no LLM/network call.
- [ ] Only two routes exist: Coach and Agent.
- [ ] Coach has no mutating tool dependency.
- [ ] Heavy Agent retains checkpoint, session, approval, journal, cancellation, budgets, and no-replay protections.
- [ ] Walkthrough waiting and `show_guidance` are removed from the Heavy Agent loop.
- [ ] No duplicate Activity/session binding schema is introduced.
- [ ] No second encrypted session store is introduced.
- [ ] No new third-party dependency is introduced.

### Classroom continuity

- [ ] Active joined Attempt is resolved in Electron main.
- [ ] ActivityContext reaches the selected Coach or Agent lane.
- [ ] Minimal Coach progress is reused only for exact owner + Attempt + Activity version.
- [ ] Heavy Agent SDK history remains task-scoped.
- [ ] Leave, closed Run, terminal Attempt, or changed Activity version cancels/invalidates local coaching context.
- [ ] Screenshots, cursor/key data, audio, secrets, consent, and room codes are not persisted as Coach progress.

### Cost and latency

- [ ] First visible Coach step uses one observation and one model call.
- [ ] Idle, Repeat, Pause, and timer expiration use zero model calls.
- [ ] A normal completed learner step requires one subsequent model decision, not several continuation calls.
- [ ] Existing paid-call reservation/settlement/no-retry rules are preserved.

---

## Rollout and Rollback

Implement behind one main-process kill switch:

```text
TROCODE_FAST_COACH_ENABLED=true
```

- Enabled: Coach/Agent router is active.
- Disabled: all requests use the existing Agents SDK path.

Do not run both runtimes for the same request. Do not shadow-call a model. Roll back by disabling the switch or redeploying the previous whole desktop build after the Heavy Agent protocol cleanup lands.

## Senior Implementation Rule

Prefer extending existing services over introducing new layers:

- `TaskApplicationService` remains the facade.
- `TaskRuntime` remains the lifecycle owner.
- `ClassroomSessionService` and `ActivityContext` remain classroom authority.
- `EncryptedAgentStateStore` remains encrypted local persistence.
- `CursorBuddyController` remains presentation ownership.
- `LocalAgentRuntime` remains autonomous execution.
- Only `TaskRequestRouter` and `CoachRuntime` are new architectural components.

If an implementation requires another router, another session service, another presentation controller, or another renderer event stream, stop and simplify it before merging.
