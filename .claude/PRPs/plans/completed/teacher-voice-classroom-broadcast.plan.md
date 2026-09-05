# Plan: Teacher Voice Classroom Broadcast

> Implementation archived September 5, 2026 on
> `codex/teacher-voice-classroom-broadcast`. Code and automated verification are
> complete; real EN/VI voice and teacher/three-student acceptance remain pending
> before release. See `../../reports/teacher-voice-classroom-broadcast-report.md`
> for task-by-task results and deviations. The original unchecked manual/release
> checklist below is retained; this archive is not a release sign-off.

## Summary

Extend Tro's existing voice Task input and ordinary assistant with exactly two model-visible tools: `list_session_assignments` and `prepare_classroom_broadcast`. The host binds those tools to a verified teacher session, presents an exact draft in the existing UI, and sends only when the teacher clicks **Broadcast to class**. The Rust API stores session-wide broadcasts; a student can open their own assignment or start an independent explanation using the published assignment, their own Attempt, and fresh local screen context.

An `explain` broadcast starts no shared model conversation. Each participating student runs a bounded, non-mutating Coach session, with their own model accounting, cancellation, and step-by-step observations. Default start is explicit; a student may opt into automatic explanation starts for the current live session on their device.

This plan was prepared before implementation. Implementation and test results are recorded in the report linked above; no real classroom delivery, deployment, or paid model evaluation was performed.

## User Story

As a teacher running a live class, I want to say “Send Assignment 1” or “Explain Assignment 1 to the class” using Tro's regular voice control, so that each student receives the correct published assignment and can get an explanation suited to their own screen and work.

## Problem → Solution

Voice currently submits ordinary tasks, while teacher broadcasts are manually composed and scoped to one Run. Connect regular voice to verified teacher context and two host-backed SDK tools, then deliver a reviewed session broadcast and independently grounded explanations to joined students working on different Activities or screens.

## Metadata

- **Complexity**: XL — context routing, durable local draft state, IPC, API, migration, student delivery, and UI.
- **Source PRD**: N/A — the accepted design in this conversation.
- **PRD Phase**: Standalone.
- **Baseline**: `main`, commit `a7ffc3a9b5838bc0515cbac22174fecdfc63cea1`, inspected 2026-09-05.
- **Estimated Files**: 78 authored files including tests and documentation; grouped inventory below.
- **Implementation Tasks**: 21, ordered into five milestones, including individual student explanation execution.
- **Dependencies**: Existing Electron, React, Zod, Agents SDK bridge, Rust/Axum, PostgreSQL. No new package, model, MCP server, or voice provider.
- **Confidence**: 8/10. The principal integration risk is session scope versus Run/Attempt scope, followed by asynchronous voice routing and recovery.
- **Instruction context**: Root `AGENTS.md` applies. The supplied supplement references `docs/CODEX-NAVIGATION-GUIDE.md`, which is absent in this checkout. No deeper AGENTS.md was found in the relevant source trees.
- **Existing work**: `.claude/PRPs/plans/agents-sdk-skill-architecture.plan.md` was already untracked. Do not edit or implement it as part of this feature. Its future changes to the tool catalog may require coordination, but are not a prerequisite.

## Agreed Product Decisions

1. Keep the existing microphone, shortcut, and `dictation | task` choices. Do not introduce “Talk to class” or a classroom voice mode.
2. Spoken commands use the existing **Task** gesture. Dictation continues to insert text without sending. Typed Task requests receive the same classroom tools.
3. Use the currently selected live teacher session. A selected class alone is insufficient when no live session has been selected; ask the teacher to open one. Never silently pick the newest session.
4. “Everyone” means students who have joined this session and still have access. The broadcast remains available to students joining later while the session is live. It does not enroll absent class members or assign work to unrelated classes.
5. Share published session Activities only. “Send Assignment 1” normally refers to position 1, but a conflicting exact title requires clarification.
6. Preserve the existing final teacher click. The two agent tools read and prepare; neither transmits to students.
7. Opening an assignment displays its existing Attempt page. Starting work, asking Help/Check, accepting disclosures, and choosing a Workspace remain explicit existing student actions.
8. New session broadcasts of links are **manual-open** in this first release. Existing Run-level approved-origin auto-open behavior remains available and unchanged. Do not invent a session-wide origin-consent rule.
9. Assignment broadcasts carry `studentAction: 'open' | 'explain'`. “Send Assignment 1” defaults to `open`; “Explain Assignment 1 to the class” selects `explain`. Neither action authorizes edits, clicks in student applications, submissions, or grading.
10. An explanation notice shows **Start explanation** and **Dismiss**. A student may enable **Automatically start teacher explanations in this session** on their own device; it defaults off, resets on leave/logout/restart, and never covers computer mutations or unrequested screen permissions.
11. Each explanation uses that student's own authenticated account, target Attempt, language, observed screen, and locally scoped prior progress. Teacher messages cannot supply screen coordinates, student task IDs, provider credentials, or a runnable tool sequence.
12. One foreground guidance/computer task owns a student's device at a time. New broadcasts do not cancel existing work, steal audio/cursor presentation, or auto-start a backlog. Busy/expired/replayed requests remain manual notices.
13. Teacher-triggered explanations are recorded as teacher-guided work with explicit provenance. They must not call the Help endpoint, populate the Help queue, mark work ready, complete an Attempt, or imply a student is stuck.

## UX Design

### Before

```text
Regular voice Task → generic task/Coach → teacher's computer

Live class → type instruction/link → Preview → Broadcast
                                         ↓
                              students in the selected Run
```

### After

```text
Teacher has opened Python / Session 3
Regular voice Task: “Gửi bài tập 1 cho cả lớp”
  → existing transcription → existing SDK agent
  → list_session_assignments → prepare_classroom_broadcast

┌────────────────────────────────────────────────────────┐
│ Python · Session 3                                      │
│ Assignment 1 — Hello Python                             │
│ Open Assignment 1 — Hello Python.                       │
│ Audience: students joined to this session               │
│ Available to later joiners while this session is live   │
│                           Cancel  | Broadcast to class  │
└────────────────────────────────────────────────────────┘
  → teacher click → API commit → “Broadcast saved”
  → student notice → Open assignment → own Attempt page
```

For **Explain Assignment 1**, the final step becomes:

```text
Same immutable assignment + studentAction=explain
        │
        ├─ Student A: own Attempt + VS Code starter file → explain visible code
        ├─ Student B: own Attempt + browser instructions → explain objective
        └─ Student C: own Attempt + blank desktop → explain + suggest opening work

Each device: Start / session opt-in → own Coach → one grounded step
                      → Next / Ask a question → new local observation → next step
                      → Finish / Stop → release local task and presentation
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Existing voice Task control | Sends transcript as ordinary task | Uses the same control with a captured teacher-session binding | Dictation is unchanged |
| Active teacher session | Local state in `ClassSessionsPanel` | Parent/host track the explicitly selected live session | Selection survives navigating to Agent; clears on class switch, logout, or leaving the session |
| Agent request | No teacher authority/context | Two extra tools under verified teacher context | Ordinary computer commands still use normal tools |
| Assignment reference | No spoken assignment resolver | Stable session order and exact title resolution | Clarify missing/ambiguous references |
| Preview | Only manual instructor form | Shared draft card in Agent and the active session view | Main process owns content and state |
| Commit | Run-level manual directive endpoint | Explicit click commits a session broadcast | Existing manual form continues to work |
| Student notice | Exercise/link for joined Run | Additional session broadcast notice with Open assignment/Open link | Does not replace Run notices or execute work |
| Feedback | Manual “sent” receipt | Prepared / saving / saved / failed / outcome unknown | No claimed delivery count without acknowledgements |
| Student explanation | Student starts ordinary Help/Check independently | Start explanation or locally opted-in live start | Separate local Coach task for each student |
| Changing student screen | Coach prepares one sequence from one observation | Explanation mode plans one step, then reobserves on explicit continuation | No continuous screen recording |
| Student busy | Renderer can replace an existing task | Teacher explanations wait as notices until local admission allows | Automatic starts never preempt |
| Teacher progress | Existing Work Session/Help events | Separately labeled explanation starts and lifecycle counts | Does not expose screen/text or label students as needing help |

Show the same draft in both the existing conversation and teacher session page, since the user may talk while Classwork is visible. Reuse one component and one host projection. Use React text rendering, accessible button labels, focus management, and `aria-live="polite"`; do not render model HTML. The existing global voice feedback can say a class draft is ready and reveal the main window through its existing presentation behavior; no new floating control is required.

## Mandatory Reading

Line references describe the inspected baseline. Symbol names are the stable anchors if concurrent work changes line numbers.

| Priority | File | Lines / symbol | Why |
|---|---|---|---|
| P0 | `AGENTS.md` | all | Architecture invariants and required checks |
| P0 | `src/renderer/App.tsx` | 1696–1790, 1911–2054; `sendInput`, `handleVoiceAttemptStart`, `handleVoiceTranscriptReady` | Voice submission, steering, clarification, and early cancellation |
| P0 | `src/renderer/voice-route.ts` | all | Every voice Task currently asks for required screen context |
| P0 | `src/renderer/use-push-to-talk.ts` | 37–80 | Turn IDs, start/ready/end callbacks; preserve capture engine |
| P0 | `src/renderer/ClassSessionsPanel.tsx` | 124–159, 235–273 | Selection stored locally; primary Run passed to facilitator view |
| P0 | `src/main/application/task-application-service.ts` | 61–210, 259–332 | Host authority construction, routing, persistence, restore |
| P0 | `src/main/application/task-request-router.ts` | all | Existing auto/Coach routing can swallow teacher commands |
| P0 | `src/main/agent/runtime-tool-registry.ts` | 36–64, 625–653, 853–end | Context availability, strict schemas, normalization, catalog freeze |
| P0 | `src/main/agent-runtime/agent-runtime-adapter.ts` | `start`, `prefetchInitialObservation`, `resume` | Frozen catalog and required initial observation |
| P0 | `services/agent-runtime/src/tool-adapter.ts` | 70–146 | Generic SDK tool bridge, checkpoint before host effect |
| P0 | `services/api/src/classroom/directives.rs` | 15–194 | Existing idempotency, rate limit, Run-scoped polling |
| P0 | `services/api/src/classroom/rooms.rs` | 149–453 | Join creates sibling Attempts but one active participation |
| P0 | `services/api/src/classroom/service.rs` | 35–139, 261–286 | Session close propagation and lock order; facilitator check |
| P0 | `services/api/src/http/knowledge.rs` | 23–155, 954–1157 | Auth/access wrapper, capabilities, session playlist SQL |
| P0 | `src/main/coach/coach-runtime.ts` | 47–202, 284–401 | Current Coach makes one observation/decision; request currently omits Activity objective/instructions |
| P0 | `src/main/coach/coach-contracts.ts` | all | Strict Coach start/result schemas and coordinate bounds |
| P0 | `src/main/knowledge/activity-context-service.ts` | 10–42 | Currently creates each Work Session with a new random client ID |
| P0 | `services/api/src/http/knowledge.rs` | 1521–1608 | Generic Work Session creation enforces launch target; `purpose=help` calls `request_help` |
| P0 | `src/main/companion/cursor-buddy-controller.ts` | 195–320 | One shared presentation owner; a sequence advances after narration |
| P1 | `src/main/knowledge/activity-progress-reporter.ts` | all | Work Session lifecycle reports; never convert them to academic completion |
| P1 | `src/main/agent/task-runtime.ts` | 78–99, 195–222 | Coach phase/progress updates and existing input state |
| P1 | `services/api/src/classroom/dashboard.rs` | 85–145, 217–230 | Help queue is based on explicit help facts |
| P1 | `services/api/src/usage/budget.rs` | `reserve`, `mark_dispatched`, `settle` | Existing authenticated per-student model budget admission |
| P1 | `src/shared/contracts.ts` | 139–164, 273–310, 619–645, 871–910, 1187–1285 | Existing compatibility boundaries |
| P1 | `src/main/agent-runtime/local-agent-state.ts` | all | Strict encrypted thread state; additive defaults required |
| P1 | `src/main/agent-runtime/encrypted-agent-state-store.ts` | 99–174, 220–307, `serial`, `writeEncrypted` | Durable state, serial writes, owner isolation |
| P1 | `src/main/knowledge/knowledge-space-client.ts` | 189–196, 392–450, 584–623 | Authenticated typed transport and coded errors |
| P1 | `src/main/knowledge/classroom-directive-service.ts` | all | Polling, notice publication, trusted-link checks, cancellation |
| P1 | `src/main/knowledge/classroom-session-service.ts` | all | Student session is not a teacher session |
| P1 | `src/main/ipc/register-ipc.ts` | 880–911, 1215–1245 | Authorized senders, schema parsing, renderer subscriptions |
| P1 | `src/shared/desktop-api.ts` and `src/preload.ts` | classroom methods/channels and subscriptions | Narrow IPC surface |
| P1 | `src/index.ts` | 290–320, 436–458, 566–583, 1720–1735, service registration | Composition and logout cleanup |
| P1 | `src/renderer/ClassroomSessionBar.tsx` | 17–60, 245–296 | Student notices and existing navigation callback |
| P1 | `src/renderer/AttemptLaunchPage.tsx` | 123–158 | Explicit launch carries target `activityAttemptId` |
| P1 | `services/api/tests/classroom_e2e.rs` | 27–434, 650–678 | HTTP fixture and destructive disposable-test DB guard |
| P1 | `services/api/tests/contract_corpus.rs` | 129–180 | Explicit migration inventory currently counts 33 migrations |
| P2 | `services/api/migrations/020_live_classroom_room_flow.sql` | all | Legacy directives, claims, participations |
| P2 | `services/api/migrations/028_class_sessions.sql` | all | Ordered Activity/Run membership, max 50 in TS contract |
| P2 | `src/main/knowledge/activity-tool-adapters.ts` | all | Host-backed knowledge tool dispatch |
| P2 | `src/renderer/App.settings-dialog.test.tsx` | 1–269 | React DOM interaction tests with fake DesktopApi |
| P2 | `src/main/analytics/analytics-service.ts` | 198–226 | Count/type-only task/tool telemetry |

## Unified Discovery Table

| Category | File / anchor | Pattern | Key fact |
|---|---|---|---|
| Similar implementation | `runtime-tool-registry.ts:625–653` | `search_activity_knowledge` uses task-bound context | Model does not supply trusted Attempt authority |
| Naming | `classroom-session-service.ts:15` | PascalCase service in kebab-case file | Companion test uses `.test.ts` |
| Errors | `knowledge-space-client.ts:604–621` | `KnowledgeSpaceRequestError(message,status,code)` | Do not classify HTTP errors by string matching |
| Logging | `analytics-service.ts:198–226` | Enumerated tool IDs/operations | Keep transcripts, assignment text, room codes, student lists out of analytics |
| Types | `contracts.ts`, `desktop-api.ts` | Zod schemas + inferred TS + typed IPC | Input and output parsed at every boundary |
| Tests | `classroom-directive-service.test.ts:1–68` | Inject timers, clients, and clocks | No real browser required for polling tests |
| Configuration | `package.json`, `services/agent-runtime/package.json` | Node >=24.12, SDK 0.17.0, Zod 4.4.3 | Do not upgrade dependencies for this feature |
| Dependencies | `tool-adapter.ts:82–114` | Existing SDK → host bridge | No new orchestrator or direct SDK business logic |
| API authority | `http/knowledge.rs:23–136` | Auth + account feature + access + rate limiting before classroom route | New routes remain under existing path families |
| Session model | `rooms.rs:283–317` | Creates sibling assignments/Attempts on join | Delivering an assignment should not recreate Attempts |
| State change | `service.rs:35–139` | Closing one mapped Run closes whole session | Broadcast transaction must coordinate with this operation |
| Schema inventory | `contract_corpus.rs:129–180` | Fixed count + explicit include list | New migration needs inventory fixture and count updates |
| Explanation context | `coach-runtime.ts::coachResponseRequest` | Sends title/purpose/directive/prior progress | Must add bounded published objective/instructions and student language |
| Explanation cadence | `CoachRuntime.run` | One observation then one decision | A new explicit explanation mode must loop only on student continuation |
| Help side effect | `http/knowledge.rs:1580–1582` | `purpose == "help"` calls `request_help` | Teacher explanations use `purpose=work` plus broadcast provenance |
| Workspace check | `task-application-service.ts:79–88` | Published Workspace Activities force a trusted folder before routing | Read-only explanation needs a narrowly separate trusted path |

## External Documentation

The implementation uses existing internal extension points. Official SDK documentation was checked to confirm function-tool and interruption semantics; the pinned local adapter remains the version-specific authority.

| Topic | Source | Key takeaway |
|---|---|---|
| Function tools | [OpenAI Agents SDK tools](https://openai.github.io/openai-agents-js/guides/tools/) | Schema-defined functions can be exposed to the existing agent |
| Interruptions | [OpenAI Agents SDK human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/) | `needsApproval` pauses execution and can be resumed from stored state |

KEY_INSIGHT: Add host catalog definitions and execution adapters; Tro already constructs SDK function tools generically.
APPLIES_TO: Tool registration and SDK validation tests.
GOTCHA: The current SDK bridge uses `needsApproval: true` as an internal durability checkpoint for every tool. It is not the teacher's Broadcast confirmation. Preserve it and keep commit outside the model catalog.

KEY_INSIGHT: The installed adapter validates that the SDK does not rewrite tool schemas and requires a checkpointed call ID before effects.
APPLIES_TO: Both new tool parameter schemas and preparation idempotency.
GOTCHA: All model-schema properties must be required; represent optional choices with explicit null. Do not copy newer documentation-only features into SDK 0.17.0.

## Patterns to Mirror

### NAMING_CONVENTION

SOURCE: `src/main/knowledge/classroom-session-service.ts`, `ClassroomSessionService` declaration.

```ts
export class ClassroomSessionService {
  private readonly events = new EventEmitter();
  private current: ClassroomSessionProjection | null = null;
```

New host services use the same naming and injected dependencies. UI components use PascalCase filenames and named exports.

### ERROR_HANDLING

SOURCE: `src/main/knowledge/knowledge-space-client.ts:609–623`.

```ts
const code =
  typeof detail?.code === 'string' && detail.code.length <= 80
    ? detail.code
    : 'knowledge_request_failed';
const message =
  typeof detail?.error === 'string' && detail.error.length <= 500
    ? detail.error
    : `Class workspaces returned HTTP ${response.status}.`;
throw new KnowledgeSpaceRequestError(message, response.status, code);
```

SOURCE: `services/api/src/classroom/directives.rs:28–34`.

```rust
if context.state != "open" {
    return Err(ApiError::conflict(
        "run_not_open",
        "Start the class before broadcasting.",
    ));
}
```

### LOGGING_PATTERN

SOURCE: `src/main/analytics/analytics-service.ts:221–226`.

```ts
if (snapshot.phase === 'verifying' && update.event.tool) {
  this.capture('tool call completed', {
    operation: update.event.tool.operation,
    tool_id: update.event.tool.toolId,
  });
```

Use existing lifecycle summaries and static error codes. Content belongs in the authorized broadcast payload or encrypted local draft, not console diagnostics or telemetry.

### REPOSITORY_PATTERN

SOURCE: `services/api/src/classroom/directives.rs:46–61`.

```rust
let mut transaction = self.begin().await?;
query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
    .bind(format!("directive:{run_id}:{}", input.client_id))
    .execute(&mut *transaction)
    .await?;
if let Some(existing) = query(
    r#"SELECT id,sequence,kind,delivery,payload,created_at
       FROM knowledge_run_directives WHERE run_id=$1 AND client_id=$2"#,
)
.bind(run_id)
.bind(input.client_id)
.fetch_optional(&mut *transaction)
.await?
```

Mirror bound queries, transaction scope, and stable idempotency keys. Strengthen new broadcasts with a payload digest mismatch check; do not inherit the legacy method's silent acceptance of changed content under the same key.

### SERVICE_PATTERN

SOURCE: `src/main/knowledge/activity-tool-adapters.ts`, first adapter.

```ts
export function createActivityToolAdapters(
  client: Pick<KnowledgeSpaceClient, 'recordEvidence' | 'searchKnowledge'>,
): RuntimeToolExecutionAdapter[] {
```

New classroom adapters similarly accept a service, normalize trusted input in the registry, return `ToolExecutionResult`, and respect `context.signal`.

### TOOL_DEFINITION_PATTERN

SOURCE: `src/main/agent/runtime-tool-registry.ts:625–653`.

```ts
id: 'knowledge.search',
modelName: 'search_activity_knowledge',
```

```ts
available: (context) =>
  Boolean(context?.activity),
```

```ts
const activity = context.activity;
if (!activity) throw new Error('Knowledge search is unavailable outside an Activity.');
return {
  callId: call.callId,
  input: { ...input, attemptId: activity.attemptId },
  kind: 'direct',
  modelName: call.name,
  operation: 'search',
  toolId: 'knowledge.search',
};
```

Use `objectSchema` from `src/shared/agent-tool-contracts.ts`, strict Zod parsing, `available(context)`, and `normalize` to inject session authority. The tools must not accept actor IDs, arbitrary recipient lists, or replacement session IDs from the model.

### TEST_STRUCTURE

SOURCE: `src/main/knowledge/classroom-directive-service.test.ts:34–44`.

```ts
const noTimer = (() => 1) as unknown as typeof setTimeout;
const noClear = (() => undefined) as unknown as typeof clearTimeout;

function sessionService(autoOpenConsent: boolean) {
  const service = new ClassroomSessionService({
    getCurrentClassroomSession: vi.fn(), joinRoom: vi.fn(), leaveClassroom: vi.fn(),
  });
  service.activate(session, autoOpenConsent);
  return service;
}
```

Use fake timers/deferred promises for races, injected cipher/temp directory for durable state, and real React DOM interactions for confirmation. Static markup alone cannot prove that a click sends exactly once.

## Architecture and Data Flow

### 1. Teacher selection is separate from student participation

Create `TeacherClassroomContextService` in Electron main. The existing `ClassroomSessionService` projects a **student** Attempt and must not be repurposed.

Proposed `TeacherClassroomBinding`:

```ts
{
  ownerId: string;
  spaceId: string;
  sessionId: string;
  spaceName: string;
  sessionTitle: string;
  verifiedAt: string;
}
```

The UI selects `{spaceId, sessionId}` through a narrow IPC method. Main reads a new authenticated teacher-session context endpoint and verifies Teacher account role, facilitator/owner membership, feature availability, and session `open` state. It returns an opaque `selectionId` plus the display binding. Main serializes selection changes or uses a generation number to discard stale API completions.

Lift active-session selection through `ClassSessionsPanel → SpaceDetailPage → KnowledgeHubPage → App`. Maintain it in App while navigating to the Agent page. Clear it on explicit session exit, class/account change, or logout. Avoid clearing simply because the classroom component unmounts during Agent navigation.

At `handleVoiceAttemptStart`, store the selected token and the current interaction/steering destination under `VoiceTurnContext.turnId`. Use that snapshot when the final transcript arrives. If the selection changed, preserve the transcript as a draft and ask the teacher to repeat/choose; never retarget it to the new session. If context verification is still pending, reject that Task gesture with a clear message rather than submitting it without the intended class.

Add optional `teacherClassroomSelectionId` to `SubmitTaskRequestSchema`; main resolves the token and injects trusted context. It is not authority by itself. Schema-validated student requests cannot become teacher requests merely by supplying a UUID.

### 2. Keep one SDK loop and retain ordinary voice behavior

Before the existing auto Coach heuristics, route an `auto` request with a verified teacher binding to the SDK agent. The SDK then chooses between normal tools and the two classroom tools. Do not add a second LLM classifier or English/Vietnamese phrase regex to decide classroom intent.

Explicit Coach requests and explicit student Activity launches retain their existing semantics and receive no teacher tools. Reject an input that combines a teacher selection token with a student `activityAttemptId`; these are distinct authority paths.

For the teacher-bound SDK path, skip the unconditional voice-only initial screenshot. The two classroom tools work from API state without Screen Recording/CUA. Keep the existing required observation behavior for ordinary unbound voice. Retain host-enforced fresh observations for visual actions and require the model to observe when resolving visible/deictic requests such as “send this link.” No observation references can be fabricated by a classroom tool.

Preserve the existing clarification and steering precedence only when the captured destination/task belongs to the same teacher binding. If the active task belongs to a different class or an unbound task, start a new request after validating the new destination; do not steer the classroom command into that old task. Do not cancel a running task merely because the teacher started recording; validation and accepted submission must succeed first.

Add `teacherClassroom?: TeacherClassroomBinding | null` to `TrustedToolExecutionContext` and persist it in encrypted `LocalThreadStateSchema` using an additive optional field defaulting to null. Do not change strict TaskContract V11 or add a new public SDK protocol field just for this host-owned context. On restore, revalidate the saved binding before rebuilding the frozen catalog; never drop teacher tools silently and resume with a different digest. Expired/revoked/closed teacher context ends with actionable feedback. Existing non-teacher checkpoints and Coach behavior remain compatible.

### 3. Exactly two model-visible tools

| Model name | Internal ID / operation | Inputs | Result |
|---|---|---|---|
| `list_session_assignments` | `classroom.assignments` / `list` | Strict empty object `{}` | Verified class/session identity and <=50 published session Activities ordered by position |
| `prepare_classroom_broadcast` | `classroom.broadcast` / `prepare` | Flat strict object described below | Prepared local draft or bounded ambiguity/not-found result; no delivery |

List result entries contain `number=position+1`, `runId`, `activityVersionId`, `title`, and `objectivePreview` capped at 300 characters. Do not return the roster, private Attempts, tokens, or entire 24,000-character Activity instructions. Return at most 50 entries and enforce a bounded total serialized output (40,000 characters); the catalogue is already limited to 50 Activities. Titles/objectives are source data, not instructions for the model.

Preparation parameters are all required at the JSON-schema level:

```ts
{
  kind: 'assignment' | 'exercise' | 'open_url';
  studentAction: 'open' | 'explain' | null; // required field; null for non-assignment
  assignmentNumber: number | null;    // 1..50
  assignmentTitle: string | null;    // trimmed, <=240
  assignmentRunId: string | null;    // UUID returned by list
  instruction: string | null;        // <=4,000
  url: string | null;                // <=2,000; validated public HTTPS URL
}
```

Rules enforced by a pure resolver and strict parser:

- Assignment: at least one assignment reference; all supplied references must agree. A Run UUID must belong to the bound session and match its immutable version. If an ordinal and exact normalized title imply different items, return candidates and ask for clarification. Duplicate normalized titles without a disambiguating number/ID also require clarification.
- Assignment action: `open` shares the assignment page; `explain` requests independent student guidance. The resolver defaults natural-language sharing to `open`, but the model schema requires an explicit non-null action for assignments. An explanation is available only for a real published target, never arbitrary teacher code or a computer-use script. Instruction and link broadcasts require `studentAction:null`.
- Normalize title comparison with NFKC, whitespace normalization, and case folding, preserving Vietnamese diacritics. Do not use fuzzy matching to silently choose a target.
- A null assignment instruction becomes the deterministic display text `Open Assignment {number} — {title}.` / its localized equivalent. Full published instructions remain attached to the immutable Activity, not copied or truncated into a directive.
- Exercise: assignment reference fields and URL must be null; a nonempty instruction is required. This is a session-wide instruction notice, not a change to a specific Activity's rubric.
- Link: assignment reference fields must be null; nonempty instruction and a validated public HTTPS URL are required. “This link” must come from an explicitly supplied URL or a fresh observation; missing/ambiguous URLs prompt a clarification.
- Tool availability requires trusted teacher context; normalization injects that binding. Adapters revalidate it through the service/API before preparing a draft. No authorizing IDs are accepted from the model.
- Ambiguity is an ordinary structured tool result `{status:'needs_clarification', candidates:[...]}`. Use the existing `task.interaction` tool to ask. Invalid input/authority is a coded failure.
- Tool descriptions explicitly say preparation does not send, and describe the supported audience. Unsupported subset requests must be clarified, never widened to the whole class.

Register definitions through `src/index.ts` and `RuntimeToolRegistry`; register implementations through `additionalToolAdapters`. The existing SDK wrapper and local bridge stay responsible for function calls, checkpoints, and effect journaling. Add SDK schema smoke coverage instead of hand-creating SDK tools in renderer code.

`TaskExecutionCoordinator.dispatchTool` (`src/main/agent/execution-coordinator.ts:240–282`) starts CUA only for computer/browser/driver tool IDs. The proposed `classroom.*` adapters therefore need no native session and should not alter this dispatch rule.

### 4. Durable local preview and explicit commit

Create `ClassroomBroadcastDraftService`, backed by the existing encrypted thread state store. Add optional/defaulted `broadcastDrafts` to `LocalThreadStateSchema` and owner-checked serial methods for listing and transitioning drafts. Keep <=20 draft records per task; prune resolved historical records first, never an unresolved send. This avoids another plaintext store or a new global approval subsystem.

Draft fields: `draftId`, `taskId`, `sourceCallId`, owner/binding, `revision`, `payloadDigest`, audience literal `session_participants`, canonical payload, `createdAt`, `expiresAt`, state, and optional server receipt. Use a ten-minute preview lifetime; sent/unknown receipts remain readable after expiry. A draft's creation is idempotent by `(taskId, sourceCallId)` and is persisted before the prepare tool returns.

```text
prepared → sending → sent
    ├──→ cancelled
    ├──→ expired/stale
    └──→ failed (proven rejection before save)
sending → unknown → sent (read-only reconciliation finds receipt)
```

Commit DesktopApi input is `{taskId,draftId,revision}`. Renderer never provides recipient IDs, replacement instructions, payload hash, session ID, or authorization. Main loads the exact draft, checks owner, currently selected session, expiry/revision, and state, and persists `sending` before the POST. Double clicks use a single in-flight operation. The API recomputes its own canonical payload hash; it never trusts a supplied hash as proof of content.

API request key is the stable `draftId`. A changed preview creates a new draft and invalidates the old unsent one. Model preparation cannot mutate a sending/sent/unknown draft. The agent may finish after “Draft ready”; the card remains actionable without holding a model call open.

On timeout, connection loss, response-schema failure after POST, or crash during send, persist `unknown`. Only GET reconciliation may follow automatically. A missing GET result does not prove an in-flight POST failed, so do not resend or generate a replacement automatically. Repeated checks may discover the saved receipt; otherwise the UI remains honest about uncertainty. Retain unknown receipts on logout/draft expiry and reload them only for the same owner.

Selecting another class invalidates unsent previews; it does not erase a saved/unknown receipt. A completed task can still have a prepared draft; explicit cancellation/Stop cancels unsent drafts for that task. Startup never auto-commits a prepared draft.

### Desktop API contract inventory

Use these method names consistently in `DesktopApi`, preload, IPC registration, and renderer mocks. All methods use the currently authenticated owner from main, never a caller-supplied owner ID. New channel keys follow the existing `classroom:*` naming convention.

| Method | Input | Output / behavior |
|---|---|---|
| `selectTeacherClassroom` | `{spaceId,sessionId}` | `{selectionId,binding}` after verification |
| `clearTeacherClassroom` | `{selectionId}` | Clear only if this token is still current; prevents stale unmount cleanup clearing a newer selection |
| `getTeacherClassroom` | none | Current selection or null |
| `getClassroomBroadcastDrafts` | `{taskId}` | Owner-authorized draft projections and monotonic projection revision |
| `onClassroomBroadcastDraftsChanged` | listener | `{taskId,revision,drafts}`; returns unsubscribe; excludes raw SDK call internals |
| `confirmClassroomBroadcast` | `{taskId,draftId,revision}` | Updated draft projection; only main-window renderer may invoke |
| `cancelClassroomBroadcast` | `{taskId,draftId,revision}` | Updated draft; cannot cancel a possibly committed send |
| `reconcileClassroomBroadcast` | `{taskId,draftId}` | Updated projection from read-only receipt lookup |
| `getClassroomBroadcastNotice` | none | Current owner/anchor-bound notice projection or null |
| `onClassroomBroadcastChanged` | listener | Notice/offline-state changes with generation/revision; returns unsubscribe |
| `openClassroomBroadcastAssignment` | `{broadcastId}` | `{attemptId}` for the current student's own authorized target |
| `openClassroomBroadcastLink` | `{broadcastId}` | Validate current trusted notice then open; no caller-supplied URL |
| `dismissClassroomBroadcast` | `{broadcastId}` | Dismiss only a known notice locally |
| `setClassroomGuidanceConsent` | `{sessionId,enabled,contextMode:'screen_if_permitted'|'text_only'}` | Local owner/session/device consent; never granted by teacher/model |
| `startClassroomExplanation` | `{broadcastId,contextMode:'screen_if_permitted'|'text_only'}` | Own admitted guidance state or busy/unavailable result; no renderer-supplied Attempt/prompt |
| `continueClassroomExplanation` | `{guidanceId,stepRevision,action:'next'|'question'|'finish'|'text_only',text:string|null}` | Continue only the matching waiting round; question text <=2,000 |
| `stopClassroomExplanation` | `{guidanceId}` | Cancel local Coach, narration/overlays, and pending continuation |
| `getClassroomGuidanceState` | none | Current owner-bound pending/active guidance projection |
| `onClassroomGuidanceChanged` | listener | Revised state with current step and available controls; returns unsubscribe |
| `getClassroomGuidanceSummary` | `{spaceId,sessionId,broadcastId}` | Authenticated teacher-only aggregate lifecycle counts; no student content |

Subscribe before reading initial projections, and apply only increasing revisions for the same task/anchor. Teacher context invalidation updates the current selection projection; an async UI cleanup must present the token it intended to clear. The draft service must not expose another owner's task even if a renderer supplies its task UUID.

### 5. Add a session broadcast stream without breaking legacy directives

Use a new `ClassroomBroadcastSchema`/session endpoint family rather than adding a new discriminant into the old `ClassroomDirectiveSchema` returned to older installed clients. Legacy Zod consumers would reject an unknown `assignment` kind and lose their whole polling response. Existing Run directives and their auto-open claims remain untouched.

New wire payload is a strict union:

```text
assignment: {kind,instruction,targetRunId,activityVersionId,title,number,studentAction}
exercise:   {kind,instruction}
open_url:   {kind,instruction,url,origin}
```

Every broadcast also has `id`, `sessionId`, safe-integer `sequence`, `createdAt`, and `delivery:'manual_only'`. Titles/version numbers/origin are canonicalized by the server from published state or validated URL; model strings are not trusted identity fields.

Use these response envelopes:

- Teacher context: `{binding,sessionState,assignments}`. The host adds `ownerId` from authenticated identity to its stored binding. A renderer/model-supplied `verifiedAt` is never accepted as evidence.
- Commit request: `{clientId,payload}`. A successful receipt contains `{clientId,broadcast,payloadDigest,newlyCreated}`. The payload digest is computed over a deterministic canonical representation, with field order explicitly defined by the Rust serializer; verify a fixed shared fixture in TS/Rust rather than hashing arbitrary object key order. The host uses the receipt's digest when reconciling; draft integrity checks use the same canonical fields.
- Receipt lookup: `{receipt: null | receipt}`. Null is absence of a visible receipt, not proof of failed dispatch. Permission/ownership failures remain 403/404 and are not converted to absence.
- Student feed: `{sessionId,sessionState,items,maxSequence}`. Closed/archived state produces no new actionable items and stops the poller. Initial no-cursor query returns at most the latest item; subsequent pages contain at most 100. Session identity and cursor are independent of the legacy directive cursor.
- Assignment resolution: `{attemptId}`. Actual Attempt details and read-only restrictions come from the existing `getHostedAttempt` flow.

Serialize content digests from canonical fields rather than the entire response: exclude `createdAt`, IDs allocated during commit, `newlyCreated`, and delivery status. Do not embed a mutable roster count in the digest; the audience is the explicit `session_participants` policy shown in the preview.

Migration `034_teacher_classroom_broadcasts.sql` at the inspected baseline:

- Add `broadcast_sequence BIGINT NOT NULL DEFAULT 0 CHECK (broadcast_sequence >= 0)` to `knowledge_class_sessions`.
- Create `knowledge_class_session_broadcasts`: UUID `id`, `session_id` FK, UUID `client_id`, BIGINT `sequence`, `kind` check, JSONB payload, canonical `payload_digest`, `created_by` user FK, timestamp.
- Unique `(session_id,client_id)` and `(session_id,sequence)`; indexed `(session_id,sequence)` feed traversal. Validate JSON shape in Rust before insertion; use constraints for kind and safe sequence bounds.
- For assignment records, store `target_run_id` and `activity_version_id` columns and constrain their pair/session with a unique referenced triple on `knowledge_class_session_activities(session_id,run_id,activity_version_id)`; require both only for assignment kind. This prevents cross-session/version mismatch even if application validation regresses.
- No backfill of old directives, no mass creation of Attempts, and no separate student session lifecycle.

Sequence allocation happens while holding the session row lock, in the same transaction as insertion. Using a bare global sequence could let a later committed row advance a student's cursor past an earlier uncommitted row; the per-session locked counter avoids that race.

Proposed routes, all under existing authenticated knowledge route families:

| Method | Path | Behavior |
|---|---|---|
| GET | `/v1/spaces/:spaceId/sessions/:sessionId/teacher-context` | Verify Teacher + owner/facilitator, return session identity, playlist and capability |
| POST | `/v1/spaces/:spaceId/sessions/:sessionId/broadcasts` | Commit canonical payload using stable `clientId`; 201 new / 200 exact existing |
| GET | `/v1/spaces/:spaceId/sessions/:sessionId/broadcasts/by-client/:clientId` | Owner-authorized lookup of a save outcome, including after session close |
| GET | `/v1/attempts/:anchorAttemptId/session-broadcasts?afterSequence=N` | Resolve session from the caller's active participation; return bounded feed/state |
| GET | `/v1/attempts/:anchorAttemptId/session-broadcasts/:broadcastId/assignment` | Verify access and return caller's own target Attempt ID; read-only |

Teacher context read supports only open live/hybrid sessions whose room launch is valid. Commit transaction checks feature/account access via the wrapper, verifies Teacher role and active owner/facilitator membership, locks the session before any Activity Runs, verifies state and target membership, and enforces a 30-broadcast/minute/session rate limit. Read-only receipt lookup is allowed after close but still checks teacher access and creator ownership; reusing another teacher's `clientId` is a conflict.

For an existing key, compare canonical payload digest and creator first: identical request returns original receipt, different content returns `409 broadcast_idempotency_conflict`. New writes fail `409 session_not_open` if closed. Resolve retries of already committed operations without treating them as new writes.

**Lock-order change required:** `set_run_state` currently locks a Run before its parent session. Change the mapped-session path to discover the mapping, lock session first, then Runs in deterministic ID order; use the same ordering for broadcasts. The unmapped legacy Run path remains Run-scoped. Test close-versus-broadcast and simultaneous closes for different sibling Runs. Recheck account/role state inside the write transaction with appropriate row locks so a completed revocation cannot race a new commit.

New student reads recheck account availability, active participant membership, ownership of the anchor Attempt, `left_at IS NULL`, and parent session/Run state. Do not rely only on the legacy directive authority query, which does not itself join current Space membership. Cap page size at 100 and cursor at JS `Number.MAX_SAFE_INTEGER`; return `maxSequence` as the last delivered row, not an unconstrained maximum beyond the page.

### 6. Student feed, late joining, and assignment opening

Create `ClassroomBroadcastService` alongside `ClassroomDirectiveService`, using the same dependency-injected polling/event style and a separate cursor. It follows the existing active student participation as its anchor, not the Activity page currently visible. This matters because joining the session already creates Attempts for sibling Runs without creating sibling participations.

Initial request without a cursor returns the **latest** broadcast and its sequence, plus session identity/state; later requests use `afterSequence`. Late joiners therefore see the current direction rather than an obsolete backlog. While continuously joined, consume subsequent pages in order and advance only to acknowledged-in-memory response cursors. Only the newest notice needs a visible card; keep a bounded trusted cache of notices needed for in-flight opens. No automatic browser opening or assignment execution occurs.

Use a generation token in addition to AbortController: reset on leave/account/session change, and discard completions from older generations, including A→B→A. Do not copy the existing service's `polling` reset race. A terminal/unauthorized response clears the notice and stops polling. Back off transient failures; keep errors non-spammy and preserve the last current notice with an offline state. Successful polling interval stays approximately 3–5 seconds with jitter; cap backoff at 30 seconds. Requests use existing HTTP timeout behavior and cancellation.

Resolve assignment opening in main by broadcast ID plus the current anchor Attempt; do not accept a teacher-specified student Attempt. The API joins session membership to `knowledge_activity_attempts` for the authenticated user and the broadcast target Run/version. Return 404/409 for missing or withdrawn targets. A completed/submitted Attempt can be opened read-only using existing UI restrictions. Opening does not create work sessions, alter participation, mark ready, or restart tasks.

`ClassroomSessionBar` passes the returned target Attempt ID to existing `onOpenClasswork`. `AttemptLaunchPage` already launches with an explicit `activityAttemptId`, so work on a sibling Activity uses the correct published context. Preserve the joined anchor used for polling. Do not silently change what the bar's existing Help/Check buttons target; they continue to name the joined Activity. On a sibling assignment page students use that page's Start/Help/Check actions. Global voice retargeting based on whichever student page is visible is outside this feature.

Session exercise notices are display directions. Do not inject a criterion or rubric from one Activity into all student task contexts. Assignment content continues to come from the published Attempt definition. For a link, the main service opens only the canonical current trusted notice URL after `validateClassroomUrl(url,origin)` succeeds.

### 7. Compatibility, observability, and rollout

- Add optional `classroomBroadcasts:{contractVersion:1}` capability to `/v1/capabilities`; absent means unsupported. Keep `knowledgeSpaces.contractVersion:2` unchanged.
- New teacher tools and the new student poller are enabled only when that capability is present and Knowledge Spaces is enabled for the account. Old-server/new-client shows the existing manual feature, with a concise unsupported message for classroom voice.
- Old clients keep reading old directives and will not receive the new session broadcast feed. Require both teacher and test student clients on the new build; preview/help copy must not claim delivery to old versions. Do not automatically dual-write legacy directives, which would cause duplicates and incorrect assignment handling.
- Backend migration/API can deploy first; updated desktop clients follow. Rollback disables access to the new capability/feature as part of the deployment and retains new data. Do not roll back by dropping the broadcast table.
- No acknowledgement counters or claims of “all students received.” `sent` means persisted by the API; student display is verified in the manual/E2E test.
- Optional explanation lifecycle counts come only from accepted guidance start records and subsequent reports. They are labeled as explanation activity, never delivery acknowledgements, attention, or assignment completion.
- Use existing task/tool events for preparation and content-free summaries. UI draft state comes from an authenticated IPC projection/getter, not model narration. Log stable failure codes; never log spoken text, assignment body, roster, room code, or bearer token.

### 8. Independent student explanation execution

#### 8.1 Shared teaching intent, private local execution

The teacher's two tools remain unchanged in number. `prepare_classroom_broadcast` gains the assignment `studentAction` field; its preview says **Request an individual explanation** and explains that students start it themselves unless they enabled automatic starts locally. The teacher cannot select the student's context mode or override permissions.

For N students, the backend stores one broadcast and up to N distinct accepted guidance starts. Each start owns a distinct student `taskId`, Work Session, local cancellation controller, model accounting context, and observation history. No teacher SDK conversation, screenshot, tool call, observation ID, or cursor coordinate is forwarded for execution. The teacher's configured model turn/allowance does not fund or impersonate student requests; use the student's existing account access and allowance.

The student's model input is the union of:

1. The canonical assignment definition for that student's target Attempt and exact published version.
2. The teacher's bounded instruction as quoted teaching context, subject to the published guidance policy.
3. The student's preferred language, explicit question, and prior progress for the exact user/Attempt/version.
4. That device's fresh observation, when permitted and requested, with its own task ID, observation ID, fingerprint, and coordinate space.

Treat the teacher instruction and visible screen text as source material. Neither can change the non-mutating Coach execution profile, invent success, bypass the assignment's scaffolding policy, or modify account/desktop authority.

#### 8.2 Student admission and consent

Create a pure `classroom-guidance-policy.ts` and a host `ClassroomGuidanceCoordinator`. The poller hands the coordinator a validated broadcast plus its delivery provenance (`initial_snapshot` or `live_delta`) and does not call `submitTask` itself.

Admission states are `available`, `waiting_for_device`, `checking`, `claiming`, `ready_to_start`, `observing`, `planning`, `presenting`, `waiting_for_student`, `finished`, `cancelled`, `failed`, `expired`, and `outcome_unknown`. Persist start/effect facts separately from transient UI phases. Only a host-owned `StudentGuidanceBinding` authorizes execution; arbitrary renderer `broadcastId` still requires lookup and validation.

Defaults and limits:

- Manual **Start explanation** is the default. Starting acknowledges use of the student's own Tro allowance. **Explain without screen** is always available when assignment access is valid.
- Session opt-in is local and explicit, defaults off, and expires on leave/logout/restart. It applies only to new live `explain` deltas after the consent revision, while the device is idle and prerequisites are already satisfied. Consent is never inferred from room admission or legacy link auto-open consent.
- Initial snapshots, restart/reconnect catch-up, events received while offline, and pending requests discovered after enabling consent never auto-start. Track consent enable time plus a feed cursor/generation high-water mark and a caught-up/live state. On reconnect, disable automatic admission until reconciliation finishes and establish a new watermark.
- If another nonterminal task, narration/presentation owner, or explicit launch reservation exists, retain the notice with **Start when ready**. Do not cancel or later automatically drain it when the device becomes idle. The student explicitly starts after finishing or stopping the other task.
- Retain at most five pending explanation notices per session, latest per target assignment; discarded/superseded notices may remain available through the session feed but cannot be auto-started. A broadcast arriving during an explanation never changes that explanation's assignment or instruction.
- Execution eligibility expires ten minutes after the broadcast's server `createdAt`, or when its session closes, whichever comes first. Receipt remains visible afterward; students can still open the assignment and ask ordinary questions. Recheck expiry immediately before dispatch and each continuation.
- Automatic starts never pop up an OS screen permission dialog or materialize/select a Workspace. Use existing permissions if granted; otherwise use the text-only explanation with a visible notice. Students can separately choose to connect their screen.
- Attempts in `submitted`, `completed`, or `withdrawn` state do not launch teacher-guided work. The assignment can still open using its existing read-only rules. Ordinary read-only questions remain a separate explicit student action.

#### 8.3 Local execution ownership

Add an admission reservation in the shared `TaskApplicationService` entry points. All ordinary submissions, explicit Activity starts, restored tasks, and classroom explanation starts participate in the same host admission rule, so a check-then-start race cannot begin two presenters. This can be implemented inside TaskApplicationService without adding a new global scheduling framework.

`ClassroomGuidanceCoordinator` acquires an idle-only reservation before a student claim and rechecks authority before dispatch. It releases it on every failed preflight/claim/start path; once running, the reservation follows the task through Stop or terminal completion. Waiting for a student continuation keeps that guidance task nonterminal. An unrelated explicit task request may replace it through the existing accepted-task replacement behavior; an automatic teacher request never may.

The renderer does not supply a task request string that bypasses these checks. Add a dedicated internal `submitClassroomExplanation(binding)` path which constructs a Coach-only task with no teacher tools, Workspace shell, patches, CUA mutations, or submit/grade tools. It works even if `TROCODE_FAST_COACH_ENABLED=false`: the explicit `explain` action must stay non-mutating rather than falling back to the general SDK agent. If Coach is unavailable, return unavailable or a text explanation through the same constrained Coach path; never substitute an unrestricted runtime.

#### 8.4 Server start claim and Work Session provenance

Add migration `035_student_classroom_guidance.sql` after the broadcast migration. It creates `knowledge_classroom_guidance_starts` with:

- UUID `id`, broadcast FK, student `user_id`, target `attempt_id`, stable `client_start_id`, student `task_id`, owning client instance reference, Work Session FK, creation/start/update/end timestamps.
- `status` constrained to `accepted | active | finished | cancelled | failed | interrupted | unknown`; bounded enumerated reason code, never arbitrary text.
- Unique `(broadcast_id,user_id)` and `(user_id,client_start_id)` and unique Work Session linkage. Broadcast/user uniqueness prevents the same student's two devices from both launching the same broadcast. A client-instance reference is a deduplication label, not authentication.
- Work Session source is derivable through the guidance-start FK. Generic Work Sessions without that relation retain their current provenance and schema. No new `purpose='help'` or unbounded metadata is required.

The student first persists a local start intent `{ownerId,anchorAttemptId,broadcastId,taskId,clientStartId,clientInstanceId,contextMode,phase:'claiming'}` in an owner-scoped encrypted guidance journal. This journal lives alongside thread state in the existing EncryptedAgentStateStore because there may not yet be a task snapshot. Add strict `LocalGuidanceStartJournalSchema`, serial read/write methods, and the same cipher/atomic-write guarantees. Store no screenshot/audio in this journal.

Proposed additional routes, through the existing authenticated classroom wrapper:

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/attempts/:anchorAttemptId/session-broadcasts/:broadcastId/guidance-starts` | Atomically authorize and claim one student explanation and create/reuse its Work Session |
| GET | `/v1/attempts/:anchorAttemptId/session-broadcasts/:broadcastId/guidance-start` | Reconcile this student's existing start and owning request without dispatching anything |
| PATCH | `/v1/work-sessions/:workSessionId/classroom-guidance` | Monotonic, authorized operational status for the bound guidance start |
| GET | `/v1/spaces/:spaceId/sessions/:sessionId/broadcasts/:broadcastId/guidance-summary` | Teacher-only aggregate accepted/active/finished/cancelled/failed/interrupted/unknown counts |

Claim input is `{clientStartId,taskId,clientInstanceId,contextMode}` with no student ID, target Attempt ID, prompt, or teacher token. Transaction rechecks active participant membership, owned anchor participation, `studentAction=explain`, exact target mapping, live session, action expiry, target state, and any required insight-policy acknowledgement. Lock the session before target state/claim rows, following the previously defined ordering. The request must not enroll the user or create a missing assignment/Attempt.

Create exactly one Work Session in this transaction with `purpose='work'` and `launchKind='current_surface'` for permitted screen explanation or `none` for text-only. This is an explicit read-only teaching launch exception: the Activity can have `launchTarget='workspace'` without granting a filesystem root to Coach. Keep the generic Work Session endpoint's exact-launch-target check intact. Extract/reuse its necessary Attempt/window/disclosure checks as a shared helper rather than silently weakening them for every caller.

Record `work_session_created` with `purpose:'work'`, `trigger:'teacher_broadcast'`, and the broadcast/start IDs. It is valid to move an `assigned` Attempt to `in_progress` when a student-admitted explanation starts work; do not make that transition on mere broadcast receipt, consent toggling, or teacher preparation. If the claim creates the Work Session before local execution, retain its `created` state; move the Attempt/Work Session to active on the first confirmed local start report instead of claiming it is already running.

Return `{status:'claimed'|'already_claimed',ownedByThisRequest,guidanceId,workSessionId,taskId,attemptId,activityVersionId,sessionId}`. An identical claim returns the existing record; a changed payload under the same client key is 409. Another device receives `already_claimed` and cannot launch. `ownedByThisRequest:true` is not permission to replay a local start: main still checks its durable journal's dispatch phase.

Claim creation does not call `request_help`, set `help_requested_at`, or set the Attempt to `blocked`. The same is true of all explanation continuations. The existing student Help button remains a separate explicit action that can enter the teacher Help queue.

#### 8.5 Starting the correct local task

After a confirmed own claim, inspect the exact target Attempt and construct ActivityContext using the returned Work Session. Add an `ActivityContextService.createForClassroomGuidance`/shared context-builder path that accepts a verified claim and never calls generic `createWorkSession` a second time. Retain the original immutable definition, insight policy, source catalogue, and published guidance policy; set `purpose:'work'` and separate trusted broadcast provenance.

Create the local task with `route:'coach'`, `runtimeKind:'coach'`, `executionProfile:'everyday'`, `workspace:null`. Keep student guidance authority in an additive `studentGuidance` encrypted thread-state field and the coordinator's binding map, not in teacher context or a renderer-authored goal. Bind `ActivityProgressReporter` to the claim's Work Session once. Persist `dispatching` before `CoachRuntime.start`; after confirmed local acceptance persist `active`. Add binding data for invalidation: owner, session, anchor participation, target Attempt/version, broadcast/start IDs, task ID, and expiry.

The current inheritance cancellation only tracks a task when the joined Attempt matches its target. This feature must also cancel a sibling-Activity explanation when its anchor leaves, its session closes, its owner logs out, or its target is submitted/completed/withdrawn. Add explicit student-guidance invalidation tracking instead of relying on `inheritedClassroomTasks` alone. Recheck with the backend before each model round; normal session polling supplies prompt close/leave updates between rounds.

On disconnect, pause future model/observation rounds until authority can be revalidated. Network loss is not permission to keep observing indefinitely. Stop cancels the request, hides overlays, stops narration, clears pending continuation, and releases the device reservation locally even if a terminal status PATCH is temporarily unavailable.

#### 8.6 Supply the actual assignment to Coach

The inspected `coachResponseRequest` currently sends `purpose`, Activity title, current legacy directive, and prior progress. Extend it for explanation mode to include:

- `objective` (<=4,000 characters) and immutable `instructions` (<=24,000), plus the published guidance policy.
- Bounded criteria with IDs/descriptions and an explicit truncation flag if needed; do not claim omitted rubric criteria were checked. Cap the entire assignment context block at 40,000 characters. Preserve objective/instructions first, then include as many complete criteria as fit; never silently cut a JSON field.
- Exact assignment/version/Attempt identity for internal grounding; omit irrelevant student names and roster data.
- Teacher instruction <=4,000 characters, separately labeled source content, and `studentAction:'explain'`.
- Student app language and local question <=2,000 characters; use the student's language rather than assuming all students share the teacher's language.
- Prior **presented** steps and recap for this guidance start. Existing `CoachProgress.stepNumber` records presentation, not proof that a student completed work. Do not infer success from it.
- Fresh per-student observation or `observation:null` with an explicit unavailable/text-only reason. No teacher observation, coordinates, or another student's progress can enter this request.

Do not add whole files, arbitrary local directories, or uploaded book contents to the prompt. Source catalogue entries are pointers only; Coach must not claim it read referenced material that was not actually supplied. A later retrieval feature can expand this separately; the published assignment is sufficient for this release's explanation contract.

#### 8.7 Adaptive explanation rounds with fresh grounding

Extend `CoachRuntimeStartSchema` with optional explanation options defaulting off for ordinary Coach tasks. The explanation profile supplies `maxModelRequests:8`, `maxObservations:16` including pre-display verification, and `maxDurationMs:600000`. Persist consumed request/observation counts and elapsed-start timestamp in student guidance state; restarting must not reset limits or authorize replay.

The current Coach performs one observation and one sequence, then completes. Keep that behavior for normal Coach. For explanation mode:

```text
validate binding + local slot + limits
  → observe own surface if permitted; otherwise text-only
  → one bounded model decision, tools=[]
  → text explanation OR one grounded visual step
  → wait for student's Next / question / text-only / Finish
  → revalidate authority + capture a NEW observation on Next/question
  → next bounded decision
```

Use a dedicated `awaitContinuation(guidanceId,stepRevision,signal)` callback injected into Coach. The coordinator publishes the waiting projection; typed IPC resolves it exactly once. Extend `TaskRuntime.applyCoachStatus` with a waiting status mapped to existing `awaiting_input`, without fabricating a generic model clarification or marking the task terminal. Do not hold a provider request open while waiting. Do not use the existing `requestLocalInteraction` helper unchanged: it can find a previous user answer when another transition clears the pending interaction. Guidance continuations require exact revision/ID matching and cancellation cleanup.

An explanation's visual decision contains exactly one actionable target on the current screen. Tighten both explanation-mode response JSON schema and runtime validation to one step; do not accept a multi-step sequence and silently play targets that depend on future screens. Text-only decisions may explain multiple concepts without coordinates.

Bind each point to that student's task ID, observation ID/fingerprint, and coordinate space. Before displaying a delayed visual target, verify the surface/fingerprint/geometry still match with a bounded current observation. If focus/layout changed, discard the highlight and offer **Refresh guidance**; do not reuse the stale point or initiate an unbounded replan. A refreshed observation may become the next round's input. All verification observations count against the limit.

Wire the explanation observer in `src/index.ts` to prefer the existing semantic `cuaService.observeCurrentSurface` where supported, with the existing screenshot observation as fallback. Both observations remain local to the student's admitted task. Keep the normal Coach observer behavior unchanged unless a separately tested common helper can preserve it. Permission checks precede `startObservationSession`; a denied/unavailable capability uses text-only rather than triggering CUA during automatic admission.

Call `presentSequence` with one grounded step; the cursor buddy is an overlay/presentation only. Do not move/click the student's OS pointer or allow keyboard/shell tools. `next` means the student requests another explanation; it is not evidence they correctly completed a step. Update the local presented-step recap, reobserve, and let the model explain the observed state. Model `complete` means explanation finished, never assignment passed.

Student differences are handled within this same profile:

| Actual local state | Required behavior |
|---|---|
| VS Code with starter code | Explain visible code using published instructions; target only current visible elements |
| Browser with assignment page | Explain task objective and point out the next relevant local action |
| Blank desktop or unrelated app | Explain in text and suggest opening the project; no guessed editor coordinates |
| Midway through exercise | Explain remaining relevant concepts from fresh evidence; do not infer completion from task history alone |
| Screen permission denied/unavailable | Continue in text-only mode; no invented screen details |
| Workspace Activity without chosen folder | Text/current-screen explanation works under read-only Coach; opening/editing files still requires the ordinary Workspace path |
| Different screen resolution or platform | Use each observation's own geometry; no teacher-to-student coordinate mapping |

#### 8.8 Duplication, restarts, and new broadcasts

- Deduplicate live notifications locally by broadcast ID; deduplicate starts server-side by broadcast/student and locally by stable start intent/task ID.
- A timeout during claim is reconciled with GET. If a claim is found for this intent and the durable journal proves local dispatch never began, the student can explicitly continue that initial start. Missing receipt remains uncertain; do not issue a fresh key.
- A crash after `dispatching` or an uncertain model response never auto-restarts the Coach. Recover its journal/claim as interrupted/unknown and show the last verified text. The student can ask Tro a new explicit question through the normal task flow; do not silently replay this broadcast. Full in-place Coach resumption is outside this release.
- A duplicate claim or another device's existing claim never starts a second local runtime. Do not use expiring claims/automatic lease stealing for possibly executed work.
- A second broadcast creates a separate pending notice. It does not overwrite an active explanation, reset its model history, or steal the presenter. Supersede only unsent/pending automatic candidates, with no claim that they were executed.
- Revoke session consent immediately for future starts. Provide **Stop explanation** separately for an active admitted session so the UI clearly distinguishes stopping current work from changing future behavior.

#### 8.9 N-student resource behavior and operational reporting

One teacher preparation/commit is followed by zero to N student model sessions, depending on student admission. For each student, reuse `/v1/agent-turns` and `/v1/openai/responses` with that student's credentials, task ID, and independent budget reservations. Do not share agent-turn IDs, model conversation/session objects, observation caches, or receipts between students.

Bound automatic admission jitter to 0–2 seconds after the next live feed delta, with at most one model request in flight per student guidance task. Reuse existing provider/account admission and rate limits. Do not promise simultaneous starts or class-sized capacity from this design alone. On a proven pre-dispatch 429, show a retryable busy state and honor Retry-After; on unknown provider acceptance, stop rather than replay. Exhausted student allowance yields a student-local explanation-unavailable result and does not block the other students or charge the teacher instead.

Extend the Coach decision client with stable request IDs for each round, typed HTTP error classification, and explicit timeouts. The existing client generates request IDs per call and has no typed outcome distinction; tests must prove that automatic recovery cannot accidentally issue a new provider request after unknown acceptance. The hard eight-request/ten-minute limits are enforced in Coach as well as existing backend monetary budgets, not merely written into the prompt.

Record only operational guidance facts. `active`, `finished`, `cancelled`, and `failed` updates use the dedicated authorized status endpoint with monotonic revisions/idempotency. Server confirms each update belongs to the student's claimed Work Session; a student cannot report another student's state. Share no screenshot, transcription, prompt, answer, file buffer, step target, or unverified mastery label with the teacher.

Teacher summary labels say **Explanations started / active / finished / interrupted**, not “students understood” or “assignment completed.” Missing/delayed reports remain unknown. `finished` means the guidance flow ended normally. Never convert it into Ready, Submit, Complete, or Help. The first implementation may display these aggregate counts in the existing broadcast receipt/preview component; no per-student surveillance dashboard is needed.

### 9. Guidance capability and deployment sequencing

Advertise explanation support separately as optional `classroomGuidance:{contractVersion:1}`. A server/client with only broadcast support can still deliver `studentAction:'open'`; `explain` creation is disabled unless guidance support is available. A new client parsing an explain notice without local support shows the assignment and an explanation-unavailable notice, never silently launches an unrestricted task.

Deploy migrations 034/035 and compatible API methods before enabling explain preparation in updated desktop clients. Retain the existing broadcast capability for sharing. Local automatic consent defaults off even for upgraded clients. API rollback retains both tables and receipts; do not reinterpret existing teacher-guidance Work Sessions as explicit student Help.

## Strategic Design and Alternatives

**Approach:** Two ordinary host catalog tools, a small trusted teacher-context service, encrypted draft state, explicit UI commit, and an additive session feed in the existing classroom service.

| Alternative | Decision and reason |
|---|---|
| Dedicated classroom microphone/mode | Rejected by the user; use regular voice Task input |
| Separate intent-classifier model | Adds latency and another route to maintain; existing SDK can choose tools |
| Automatically broadcast from the prepare tool | Does not preserve the agreed preview-and-click behavior |
| Use SDK `needsApproval` as the broadcast UI | Existing flag is a durability mechanism; mixing purposes would affect all tools |
| Click the teacher UI with CUA | Existing typed APIs give exact identifiers and verifiable receipts |
| Add `assignment` to the old directives union | Older clients reject unknown variants; use an additive feed |
| Fan out N legacy directives across Runs | Duplicate identities, partial commits, and awkward cross-Activity ordering |
| New WebSocket/SSE classroom infrastructure | Existing poll cadence is sufficient for this release |
| Put teacher state in `ClassroomSessionService` | That service represents a student's active Attempt |
| Expand TaskContract V11 just for selection | Host-only encrypted binding avoids changing unrelated strict goal schemas |
| Replay the teacher's explanation/actions on every screen | Different screens and Attempts require independent observations and model context |
| Route `explain` through the unrestricted student SDK agent | A teaching request grants read-only explanation, not edits or submissions |
| Use `purpose=help` for teacher-triggered work | Existing endpoint would incorrectly add students to the Help queue |
| Automatically continue an entire visual sequence | Screen changes invalidate later targets; require an explicit next round and fresh grounding |
| Always-on student screenshots | Unnecessary; observe only at admitted explanation rounds and bounded target verification |

## Files to Change

CREATE rows name proposed files. UPDATE rows are existing baseline files. Tests alongside new implementation modules are owned by the same task. Grouped cells name each intended path; no generated output should be edited by hand.

| File(s) | Action | Justification |
|---|---|---|
| `src/shared/contracts.ts`; `src/shared/contracts.test.ts` | UPDATE | Teacher selection, broadcast unions/drafts, capability and request schemas |
| `src/shared/desktop-api.ts`; `src/preload.ts`; `src/main/ipc/register-ipc.ts`; `src/main/ipc/register-ipc.test.ts` | UPDATE | Narrow selection/draft/commit/student-notice IPC and sender checks |
| `src/main/knowledge/teacher-classroom-context-service.ts`; adjacent `.test.ts` | CREATE | Verified selection tokens and session binding |
| `src/main/knowledge/classroom-assignment-resolver.ts`; adjacent `.test.ts` | CREATE | Pure ordinal/title/ID resolution |
| `src/main/knowledge/classroom-broadcast-draft-service.ts`; adjacent `.test.ts` | CREATE | Prepare, persist, confirm, cancel, reconcile |
| `src/main/knowledge/classroom-broadcast-service.ts`; adjacent `.test.ts` | CREATE | Student session feed and trusted open operations |
| `src/main/knowledge/knowledge-space-client.ts`; adjacent `.test.ts` | UPDATE | Five broadcast/context endpoints, four guidance endpoints, and separate capability parsing |
| `src/main/agent/classroom-agent-tools.ts`; adjacent `.test.ts` | CREATE | Two strict context-bound catalog definitions |
| `src/main/knowledge/classroom-tool-adapters.ts`; adjacent `.test.ts` | CREATE | List and prepare host executors |
| `src/main/agent/runtime-tool-registry.ts`; adjacent `.test.ts` | UPDATE | Trusted teacher context and freeze/availability coverage |
| `src/main/application/task-request-router.ts`; adjacent `.test.ts` | UPDATE | Verified teacher auto requests reach SDK before Coach heuristics |
| `src/main/application/task-application-service.ts`; adjacent `.test.ts` | UPDATE | Selection resolution, authority persistence, restore and observation policy |
| `src/main/agent-runtime/local-agent-state.ts`; `src/main/agent-runtime/encrypted-agent-state-store.ts`; store `.test.ts` | UPDATE | Backward-compatible context/drafts and owner-checked atomic transitions |
| `src/main/agent-runtime/agent-runtime-adapter.test.ts` | UPDATE | Context-specific catalog and ordinary observation regression tests |
| `services/agent-runtime/test/tool-adapter.test.ts` | UPDATE | New strict schemas survive generic SDK wrapper unchanged |
| `src/index.ts` | UPDATE | Service/tool wiring and account/shutdown cleanup |
| `src/renderer/App.tsx`; `src/renderer/App.classroom-voice.test.tsx` | UPDATE / CREATE test | Capture immutable voice destination; surface draft and use existing control |
| `src/renderer/voice-route.ts`; adjacent `.test.ts` | UPDATE | Explicit teacher task observation exception; preserve dictation routing |
| `src/renderer/KnowledgeHubPage.tsx`; `src/renderer/SpaceDetailPage.tsx`; `src/renderer/ClassSessionsPanel.tsx`; panel `.test.tsx` | UPDATE | Lift selected session; maintain navigation and show shared preview |
| `src/renderer/ClassroomBroadcastPreview.tsx`; adjacent `.test.tsx` | CREATE | Accessible exact preview and state-aware commit buttons |
| `src/renderer/ClassroomSessionBar.tsx`; `src/renderer/ClassroomSessionBar.broadcast.test.tsx` | UPDATE / CREATE test | Session notices and own-Attempt opening |
| `src/renderer/app-language.ts`; adjacent `.test.ts` | UPDATE | English/Vietnamese voice-preview and delivery messages |
| `src/index.css` | UPDATE | Reuse existing classroom/card styles with minimal additions |
| `services/api/migrations/034_teacher_classroom_broadcasts.sql` | CREATE | Session counter, broadcast table, referential constraints |
| `services/api/src/classroom/broadcasts.rs` | CREATE | Teacher context, commit, feed, lookup, own-Attempt resolver; unit tests |
| `services/api/src/classroom/contracts.rs`; `services/api/src/classroom/mod.rs`; `services/api/src/classroom/service.rs` | UPDATE | Strict Rust types, module export, shared lock ordering |
| `services/api/src/http/classroom.rs`; `services/api/src/http/knowledge.rs` | UPDATE | Additive routes and capability advertisement |
| `services/api/tests/classroom_e2e.rs` | UPDATE | Session broadcast scenarios in guarded existing HTTP suite |
| `services/api/tests/contract_corpus.rs`; `services/api/tests/fixtures/schema_inventory.json`; `services/api/tests/fixtures/route_inventory.json` | UPDATE | Migration/table/route inventories |
| `docs/knowledge-spaces.md`; `docs/testing/teacher-voice-classroom-broadcast.tdd.md` | UPDATE / CREATE | Actual semantics, compatibility, test evidence and manual steps |
| `src/main/knowledge/classroom-guidance-policy.ts`; adjacent `.test.ts` | CREATE | Pure student start/expiry/consent/busy admission policy |
| `src/main/knowledge/classroom-guidance-coordinator.ts`; adjacent `.test.ts` | CREATE | Local intent/claim/start/continuation, device slot, lifecycle, and invalidation |
| `src/main/coach/coach-contracts.ts`; `src/main/coach/coach-runtime.ts`; runtime `.test.ts` | UPDATE | Assignment-aware one-step explanation mode, continuation, budgets, screen fallback |
| `src/main/knowledge/activity-context-service.ts`; adjacent `.test.ts` | UPDATE / CREATE test | Reuse claimed Work Session and immutable target context without creating another |
| `src/main/knowledge/activity-progress-reporter.ts`; adjacent `.test.ts` | UPDATE / CREATE test | Guidance provenance and dedicated lifecycle status path |
| `src/main/agent/task-runtime.ts`; adjacent `.test.ts` | UPDATE | Waiting-for-student state and single terminal completion |
| `src/renderer/ClassroomExplanationPanel.tsx`; adjacent `.test.tsx` | CREATE | Start, scoped consent, Next/question, text-only and Stop controls |
| `services/api/migrations/035_student_classroom_guidance.sql` | CREATE | Unique per-student guidance start and Work Session linkage |
| `services/api/src/classroom/guidance.rs` | CREATE | Claim, reconciliation, lifecycle report, and teacher aggregate summary |
| `services/api/src/classroom/dashboard.rs` | UPDATE | Keep teacher-guided work distinct from Help and academic completion |

`services/api/BUILD.bazel` already globs Rust source and migration files, and already declares `classroom_e2e_test`. No Bazel edit is needed if tests stay in the listed files. If implementation introduces another Rust integration test binary, add its Bazel target and lint/check inventory in the same change. Recount source/test files before reporting final implementation scope.

## NOT Building

- A new microphone, voice mode, speech provider, model classifier, or separate agent.
- Hands-free voice confirmation of Broadcast.
- Automatic computer mutations on students' devices, input replay, or screen streaming. Locally opted-in read-only explanation starts are explicitly in scope.
- New enrollment, arbitrary class selection, subgroup recipients, assignment authoring, grading, or submission.
- Auto-opening session links or global student voice retargeting. Guidance authority is established only through the student-admitted, validated start-claim path; a notice alone grants none.
- Receipt acknowledgements, attention tracking, email/Slack messages, or a WebSocket delivery system.
- Implementation of the neighboring SDK skill architecture plan.
- Full crash resumption of in-flight Coach model calls, cross-student shared model histories, automatic claim takeover, or class-level payment sponsorship.

## Step-by-Step Tasks

### Task 1: Define contracts and lock product semantics

- **ACTION**: Add typed schemas for teacher selection/binding, list results, canonical session broadcast payloads, drafts, feed responses, and all IPC/HTTP requests.
- **IMPLEMENT**: Use the definitions above, explicit length bounds, UUID validation, JS-safe cursors, manual-only delivery, and null/default compatibility fields. Add `teacherClassroomSelectionId` to submit requests; reject simultaneous student Attempt and teacher selection. Capability absent means unsupported. Draft states and transitions must be a pure checked state machine.
- **MIRROR**: `contracts.ts` Zod unions and `ClassroomDirectiveDraftSchema`; strict-function schema helper for model parameters.
- **IMPORTS**: `z` from `zod`; existing URL/origin validators from `src/shared/classroom-url-policy.ts`; `TeacherClassroomBinding`/broadcast inferred types exported from contracts.
- **GOTCHA**: Do not add the new assignment kind to legacy `ClassroomDirectiveSchema` or bump knowledge contract version 2. Default new local-state fields on old records.
- **VALIDATE**: Schema tests for both old/new payloads, missing capability, invalid combinations, max sizes and unsafe sequence values.

### Task 2: Add storage and inventory migration

- **ACTION**: Create the additive migration and update schema inventories.
- **IMPLEMENT**: Session counter, broadcast table, unique request/order constraints, assignment reference constraints. Use the next migration number if 034 has been taken by concurrent work; never edit an applied migration. At baseline migration count becomes 34 and table count becomes 60.
- **MIRROR**: Migration 028 session mapping and migration 020 directive uniqueness; `contract_corpus.rs` include list.
- **IMPORTS**: No new dependency; explicitly register the migration in `services/api/src/db.rs` (corrected during implementation).
- **GOTCHA**: A commit-order-safe cursor requires allocating the sequence under the session lock, not a stand-alone serial value.
- **VALIDATE**: Apply complete migration chain to disposable PostgreSQL; duplicate key and invalid cross-session reference inserts fail; inventory test passes.

### Task 3: Implement teacher context and transaction-safe broadcast APIs

- **ACTION**: Add `classroom/broadcasts.rs`, Rust request/response structs, and three teacher routes.
- **IMPLEMENT**: Bounded typed playlist query; strict Teacher + owner/facilitator checks; commit canonicalization/digest; session-first locks; 30/minute limit; same-key/same-payload 200, new 201, mismatch 409; creator-scoped receipt lookup. Refactor mapped-session `set_run_state` to use matching lock order.
- **MIRROR**: `directives.rs` transaction/error pattern; `http/knowledge.rs::class_session_value`; classroom typed HTTP `read_body`/`response`.
- **IMPORTS**: Existing crate `query`, `query_scalar`, `Row`, `Transaction`; `uuid::Uuid`, `serde::{Deserialize,Serialize}`, `serde_json`, `sha2::{Digest,Sha256}`, `ApiError`; reuse URL policy.
- **GOTCHA**: Role/access checks must be current at commit. Do not let a changed payload under the same key return another teacher's receipt; lookup after close must still recover a completed write.
- **VALIDATE**: HTTP authority/status tests; concurrent duplicate requests; changed-content rejection; close/write races and sibling-close deadlock tests under bounded timeouts.

### Task 4: Implement student session feed and own-Attempt resolution

- **ACTION**: Add the two student GET routes to the same Rust module.
- **IMPLEMENT**: Resolve session from owned live participation; check current roster/account access; initial latest snapshot versus cursor pages; stable ordering; no cursor skips; safe bounds. Resolve target Attempt by authenticated user and exact session/Run/version. No insertion or Work Session mutation.
- **MIRROR**: `rooms.rs` participation/Attempt joins; `directives.rs::list_directives`; existing student Attempt access patterns.
- **IMPORTS**: Shared new Rust broadcast structs and existing `ApiError`, query utilities, UUID/time serialization.
- **GOTCHA**: Sibling Attempts created on join have no participation row. Authorize feed with the anchor, and resolve the sibling Attempt separately. A completed anchor need not end the live session feed; an explicit leave does.
- **VALIDATE**: Two students with different current work pages receive the same broadcast; their target Attempt IDs differ; removed/left/unrelated students denied; initial latest and >100-row page tests.

### Task 5: Extend the typed client and verify capability negotiation

- **ACTION**: Add client methods for teacher context, commit, receipt lookup, student feed, and assignment resolution.
- **IMPLEMENT**: Parse every response with its schema; expose `AbortSignal` on read methods; preserve existing timeout and coded-error behavior. Read capability before advertising tools/polling. Use explicit cursor omission for initial snapshot rather than an ambiguous zero convention.
- **MIRROR**: `KnowledgeSpaceClient.createDirective`, `listDirectives`, `request`.
- **IMPORTS**: New schema/types from `../../shared/contracts`; existing `KnowledgeSpaceRequestError`.
- **GOTCHA**: Response decode failure after POST is an unknown outcome. The client must not automatically retry it. Legacy client/new API payloads stay unchanged.
- **VALIDATE**: Fetch mocks assert paths/bodies/auth/schema failures and absence of mutation retries; old capability response parses and disables new functionality.

### Task 6: Build teacher-context selection and pure assignment resolver

- **ACTION**: Create the host selection service and resolver with injected client/account/clock.
- **IMPLEMENT**: Mint opaque selection tokens after verification; generation-safe selection changes; clear on account/class/session exit. Resolver accepts current playlist and parameter references, checks agreement, returns resolved/not_found/ambiguous with <=50 candidates. Use exact normalized title semantics and position+1.
- **MIRROR**: `WorkspaceSelectionService.resolve` for opaque tokens; `ClassroomSessionService` events; pure `task-request-router` design.
- **IMPORTS**: `randomUUID` from `node:crypto`, `EventEmitter`, new contracts, `KnowledgeSpaceClient` type.
- **GOTCHA**: UI class selection is a hint; teacher authority is verified server-side. Missing/closed session never falls back to the first session. Do not put this state into the student service.
- **VALIDATE**: Role/feature/closed-session tests; stale async responses; account switch; ordinal/title conflicts; Vietnamese title normalization; fake Run ID rejected.

### Task 7: Persist draft preparation, commit, and reconciliation

- **ACTION**: Extend encrypted local thread state and create `ClassroomBroadcastDraftService`.
- **IMPLEMENT**: Atomically store teacher binding at thread creation; add owner-checked serial draft methods; deterministic prepare reuse by call ID; immutable payload and revision; expiration/stale/cancel transitions; write sending before POST; store sent receipt or unknown. Reconciliation is read-only. Publish projections only after durable state changes.
- **MIRROR**: `EncryptedAgentStateStore.create/save/serial/writeEncrypted`, invocation journal patterns, injected cipher fixtures.
- **IMPORTS**: `createHash`/`randomUUID`, `EventEmitter`, `EncryptedAgentStateStore`, new strict schemas, typed context/client services.
- **GOTCHA**: Generic store methods such as `readThread` don't enforce an owner argument; enforce ownership in new public methods. Snapshot saves must preserve new fields. Crash recovery must not send again. Never prune unresolved sends.
- **VALIDATE**: Cipher-backed restart tests; cross-owner denial; duplicate tool call; double-click; expired/stale revision; close during preview; crash before/after POST; unknown followed by found/missing lookup.

### Task 8: Register exactly two tools through the existing host bridge

- **ACTION**: Add catalog definitions and adapters; wire through `src/index.ts`.
- **IMPLEMENT**: IDs/model names/strict schemas above; context-only availability; normalization injects binding; list adapter returns bounded catalogue; prepare adapter uses resolver and durable service. Return a draft ID/preview and “prepared, awaiting teacher confirmation,” never a sent claim. Use existing clarification tool for ambiguous results.
- **MIRROR**: `runtime-tool-registry.ts:625–653`, `activity-tool-adapters.ts`, `tool-adapter.ts`.
- **IMPORTS**: `RuntimeToolDefinition`, `RuntimeToolExecutionAdapter`, `ToolExecutionResult`, `objectSchema`, Zod, new service interfaces.
- **GOTCHA**: Keep commit absent from the SDK catalogue. Do not edit SDK `needsApproval` or inject teacher names/session IDs into static catalog descriptions, which would destabilize graph digests. Context arrives in list results and host invocation state.
- **VALIDATE**: Registry lists exactly the two additional tools for teacher tasks and neither for student/unbound tasks; strict schema/digest smoke tests through installed SDK; model-supplied authority fields rejected.

### Task 9: Bind ordinary voice and task routing to the selected session

- **ACTION**: Lift teacher session selection and connect it to voice/typed task submission.
- **IMPLEMENT**: Propagate selection callbacks through the three classroom components; retain selection when navigating to Agent; capture token and interaction/task destination by turn ID; clear turn maps on every end reason. Add trusted binding resolution before route/authority creation; auto+teacher goes to SDK; teacher SDK metadata does not require initial CUA. Preserve explicit Coach/student launches and normal unbound voice observation. Persist/revalidate teacher binding on restore.
- **MIRROR**: `App.tsx` existing voice maps and `sendInput`; task application creation/restore; `voice-route` unit tests.
- **IMPORTS**: New selection/request types from shared contracts; context-service option in TaskApplicationService; React refs/callbacks; `TaskRouteInput` teacher-context flag.
- **GOTCHA**: Current sendInput can cancel a task before a new submission fails, and steering can target the wrong task. Validate captured destination first. A class switch during speech must preserve text, not submit against the replacement class. Don't force an unrelated Workspace folder requirement for an explicitly Everyday teacher task; retain the user's valid execution profile otherwise.
- **VALIDATE**: Voice start/late transcript/class-switch tests, same/different-context steering, dictation, no-session behavior, normal open-app task, Teacher with Screen Recording denied, and student Help/Check regression tests.

### Task 10: Add narrow IPC and shared teacher preview UI

- **ACTION**: Expose selection, get/subscribe drafts, confirm/cancel/reconcile, and student notices through DesktopApi; add preview component.
- **IMPLEMENT**: Host-authorized input and output parsing in preload/main; main-window-only confirmation; subscription cleanup; atomic getter+subscription handling without stale projections. Display exact class/session/payload/audience and local expiry. State-gated buttons; Cancel and Broadcast; Check status for unknown; no repeat-send button. Render shared component in Agent and active teacher session view. Add translations and minimal existing-style CSS.
- **MIRROR**: Existing classroom IPC subscriptions and `FacilitatorRunPage` preview content; React happy-dom tests.
- **IMPORTS**: New schemas/types in `desktop-api.ts`/preload/register-ipc; `ClassroomBroadcastPreview` and `translate` in UI.
- **GOTCHA**: A model tool result string is not a trusted draft projection. Renderer sends only identifiers/revision; never an editable payload at confirmation. Background companion windows must not gain a generic broadcast commit IPC capability.
- **VALIDATE**: Unauthorized sender/subframe/account tests; actual button interaction sends exact draft once; no send on render/tool result; shared views update consistently; keyboard/focus and EN/VI text tests.

### Task 11: Add the student poller and assignment/link notices

- **ACTION**: Create the additive session broadcast service and extend the student bar.
- **IMPLEMENT**: Capability-aware poller anchored to existing student session; separate cursor and reset generation; initial latest snapshot; bounded subsequent pages; backoff/stop behavior; trusted ID-based open/dismiss operations. Assignment GET returns own Attempt and existing UI navigation opens it. Link opens only a validated notice URL after explicit click.
- **MIRROR**: `ClassroomDirectiveService` injection/events and `ClassroomSessionBar.onOpenClasswork`; keep legacy poller independent.
- **IMPORTS**: `ClassroomSessionService`, typed client, `validateClassroomUrl`, new broadcast contracts; Electron `shell` injected from composition root.
- **GOTCHA**: A stale A→B→A response can pass a naive same-ID check; use generations. Do not stop session notices solely because the anchor Attempt completed. Do not launch work or change participation on receipt/open.
- **VALIDATE**: Fake-timer tests for startup, catch-up, reset, membership rejection, loss/recovery; UI tests for own target Attempt and no auto-execution; legacy directive behavior still passes.

### Task 12: Define student explanation contracts and admission policy

- **ACTION**: Add `studentAction`, separate guidance capability, student consent/start/continuation/state schemas, and pure policy tests.
- **IMPLEMENT**: Use Architecture 8–9 definitions. Add `StudentGuidanceBinding`, `GuidanceStartIntent`, `GuidanceStartReceipt`, revisioned `ClassroomGuidanceState`, and strict continuation actions. Enforce assignment-only explain, target state, ten-minute eligibility, manual default, live-delta watermark, capability, owner/session consent and busy outcomes. Return machine-readable reasons such as `device_busy`, `consent_required`, `snapshot_only`, `expired`, `attempt_not_active`, `unsupported`, and `authority_unavailable`.
- **MIRROR**: `classroom-assignment-resolver.ts` pure-result pattern from Task 6; existing `task-request-router.ts` and shared Zod contracts.
- **IMPORTS**: `z` and existing Activity/Attempt/session types; new broadcast types from `../../shared/contracts`; inject time instead of calling wall clock inside pure policy functions.
- **GOTCHA**: Legacy link consent and room admission do not imply explanation consent. Explicit auto consent covers only new live events while idle; initial snapshots/reconnection never launch a backlog. A teacher can request explain but cannot select student permissions or execution mode.
- **VALIDATE**: Table-driven policy tests across manual/live/snapshot/catch-up, consent revisions, owner changes, terminal Attempts, max age, busy host and absent capabilities; EN/VI tool-schema fixtures require explicit action.

### Task 13: Implement atomic student start claims and Work Session provenance

- **ACTION**: Add migration 035, `classroom/guidance.rs`, four guidance routes, and strict Rust schemas.
- **IMPLEMENT**: Unique broadcast/student and user/client-start claim; canonical target resolved on server; teacher/session/account/roster/window/disclosure rechecks; session-first lock order; create a single read-only Work Session with `purpose=work`; attach teacher-broadcast provenance. Identical own request returns its receipt, conflicting content gets 409, another client gets already-claimed. Add monotonic bounded status PATCH and teacher-only aggregate summary. Extract reusable validation from generic `create_work_session` without relaxing that endpoint.
- **MIRROR**: Existing `rooms.rs` user-bound admission, `directives.rs` idempotency, new broadcast transaction from Task 3, `http/knowledge.rs:1521–1608` Work Session validation.
- **IMPORTS**: `query`, `query_scalar`, `Transaction`, `Row`, `ApiError`, `Uuid`, `serde`, existing Work Session/run status types; add module export in `classroom/mod.rs`.
- **GOTCHA**: Generic `purpose=help` calls `request_help`; never use it here. The Work Session is initially created, not running. Defer Attempt assigned→in_progress and active timestamps until first validated start report. Do not let an old lifecycle retry regress terminal state or clear a student's existing explicit Help fact.
- **VALIDATE**: Simultaneous same-student/two-client claim yields one Work Session; no new Attempts; wrong/left/expired/terminal target denied; workspace assignment can receive read-only explanation without generic endpoint accepting launch mismatch; Help queue and Ready/Submit/Complete remain unchanged. Update migration inventory to 35 and table inventory to 61 at this baseline.

### Task 14: Implement durable local student coordination and shared task admission

- **ACTION**: Create `ClassroomGuidanceCoordinator`, encrypted start-intent journal methods, and a dedicated trusted explanation submission path.
- **IMPLEMENT**: Reserve idle device/task ownership before claim; persist owner/broadcast/task/client-start intent; reconcile unknown claim with GET; build ActivityContext from the claimed Work Session; persist thread guidance binding and dispatch phase before Coach.start. Integrate all normal starts/restores with the same TaskApplicationService reservation so a concurrent user request cannot slip past an idle check. Automatic admission never invokes renderer `sendInput` or its task replacement behavior.
- **MIRROR**: Tasks 7/9 durable draft and authority patterns, `EncryptedAgentStateStore.serial/writeEncrypted`, `TaskApplicationService.submitAndStart`, `ActivityContextService.create`.
- **IMPORTS**: Coordinator types, context/policy/client, TaskApplicationService/TaskRuntime, encrypted state store, `ActivityProgressReporter`, `AbortController` and injected clocks/timers.
- **GOTCHA**: Persist a guidance intent before remote claim because a task snapshot may not exist yet. Do not call `createWorkSession` again after claim. `TROCODE_FAST_COACH_ENABLED=false` must not convert explain into a general Agent route. A workspace Activity explanation must not obtain shell authority or fail solely for missing Workspace selection.
- **VALIDATE**: Concurrent ordinary/automatic launch; fake two-device claims; claim-response loss; process restart before/after dispatching; no model/native call before valid local admission; no second Work Session. Verify every terminal/error/preflight path releases the slot.

### Task 15: Make Coach explanations assignment-aware and adaptive

- **ACTION**: Extend Coach start/decision options and request construction; add bounded one-step continuation mode while retaining ordinary Coach behavior.
- **IMPLEMENT**: Supply full bounded objective/instructions, guidance policy, teacher focus, local question/language, and presented-step history. Explanation requests have `tools:[]`, max eight model calls, sixteen observations, ten minutes, and exactly one visual step per decision. Reobserve on every Next/question; verify target freshness before overlay; text-only fallback when context unavailable. Await exact coordinator continuation revision with no provider request held open. Extend TaskRuntime's Coach status mapping to existing `awaiting_input` and publish text answers into task history so text-only users can read them.
- **MIRROR**: `CoachRuntime.run`, `coachResponseRequest`, `CoachDecisionSchema`, `requireGroundedSequence`, `CursorBuddyController.presentSequence([step])`.
- **IMPORTS**: Existing Coach contracts/presenter and new explanation options; common `TaskLimits` subset; guidance continuation callback interface; immutable assignment context types.
- **GOTCHA**: Current prompt lacks the objective/instructions and current sequence advances on narration alone. Neither behavior is sufficient for this feature. Existing stepNumber is presented progress, not verified success. A failed screen observation may degrade to text, but a failed/unknown model call must not be blindly retried with a new request ID.
- **VALIDATE**: Tests inspect actual serialized model input, not just mocked decision results. Verify EN/VI preference, different student Attempts/screens, changed focus geometry, no-screen answers, single-step schemas, stop while waiting, request/observation/time caps, and unchanged ordinary Coach sequence tests.

### Task 16: Enforce guidance cancellation, accounting, and honest reporting

- **ACTION**: Wire target/anchor/session invalidation, stable per-round request identity, and dedicated operational progress reporting.
- **IMPLEMENT**: Revalidate before dispatch and each continuation, stop on local leave/logout/target terminal/session closed, pause on unavailable authority. Guidance-aware ActivityProgressReporter sends only allowed lifecycle states to the new status endpoint, with durable revisioned updates so retries cannot rewind a state. Persist per-round request IDs/counters; reuse student-authenticated turn/budget boundary; classify pre-dispatch 429 separately from unknown response loss. Expose aggregate teacher summary in the existing receipt UI.
- **MIRROR**: `cancelInvalidClassroomTasks`, `ActivityProgressReporter.report`, `createAuthenticatedCoachDecisionClient`, existing backend budget reservations, Task 7 unknown-outcome rules.
- **IMPORTS**: New binding/status schemas and typed client errors; existing session listeners, usage client/HTTP helpers, AbortSignal, task update types.
- **GOTCHA**: Existing inherited-task tracking misses sibling Attempt tasks. Screens/prompts/answers must never appear in summary/status payloads. A finished Work Session is not a finished assignment. Local Stop must succeed even when backend reporting is offline; unknown reports are never shown as confirmed results.
- **VALIDATE**: Sibling task cancelled on anchor leave/close; no further observations while authority unavailable; independent user budget failures; request IDs stable per round; status revision races; no Help/Ready/Submit/Complete side effects; no content leakage in API/status/analytics captures.

### Task 17: Add student start, consent, continuation, and teacher status UI

- **ACTION**: Add `ClassroomExplanationPanel` and narrow IPC methods to the existing student notice surface.
- **IMPLEMENT**: Start explanation / text-only / Dismiss; per-live-session auto-start checkbox with allowance/context disclosure; busy/expired/already-started/unknown states; Next, question, Finish and Stop bound to current guidance ID/revision. Surface waiting state in class view and current task conversation using one main-owned projection. Display teacher aggregate explanation counts with explicit labels. Keep ordinary voice controls and teacher tool count unchanged.
- **MIRROR**: Shared preview projection and happy-dom interaction tests from Task 10; existing ClassroomSessionBar navigation/buttons; `app-language.ts` translations.
- **IMPORTS**: New DesktopApi schemas/methods; `ClassroomExplanationPanel`; existing translate/React subscription helpers; no raw Electron or CUA exposure.
- **GOTCHA**: A click on an old rendered Next button must not advance a newer round. Consent off affects future starts; Stop controls current execution. Do not announce a start while only the claim exists. No OS permission prompt on auto-start, and no implicit interruption of an unrelated task.
- **VALIDATE**: Actual click/input/subscription tests, default-off/restart reset, stale double Next, busy task, concurrent notice arrival, permitted versus denied screen context, keyboard access, and bilingual UI. Verify no send/start/continue happens on render alone.

### Task 18: Validate independent student contexts and N-student load behavior

- **ACTION**: Add integrated guidance tests and documented multi-computer acceptance cases.
- **IMPLEMENT**: Exercise one teacher explain broadcast with at least three different student observations (editor, browser, blank/unavailable); assert one shared definition and distinct Attempts/task/agent-turn/observation IDs. Run mocked fan-out for 200 independent accounts, one request in flight per student, bounded jitter/queues, and isolated failure injection. PostgreSQL tests cover N claims, two clients for one user, expiry/close races, stable status counts, and legacy Help behavior.
- **MIRROR**: Existing classroom E2E fixture and Coach decision/presenter fakes; Task 12 policy table; no paid-provider load generation.
- **IMPORTS**: Existing Vitest deferred promises/fake timers, Rust tokio/tower fixtures, shared sample Activity definitions and DesktopObservation fixtures.
- **GOTCHA**: A mock 200-student run proves isolation and bounded control flow, not production model throughput. Record measured real-client latency separately; never label observed presentation as learning success. Real provider/model tests require the user's authorization for actual usage and must not be faked.
- **VALIDATE**: No shared screen/history data; one blocked/budget-exhausted student does not stall others; no duplicate runtime on same-user two-device test; explicit manual acceptance with three real devices before release.

### Task 19: Add integrated contract, recovery, and multilingual coverage

- **ACTION**: Extend existing HTTP E2E and add the feature TDD/evidence document.
- **IMPLEMENT**: Two Activities, two students joined through different valid anchors, instruction/link/assignment broadcasts, correct target IDs, late joining, stale authority, 31st broadcast limit, duplicate/content-conflict cases, close races, pages and cursor ordering. SDK mock-model tests prove tool list→prepare sequence and no commit tool. Add English/Vietnamese command evaluation cases with expected targets/clarifications.
- **MIRROR**: Guarded `classroom_e2e.rs` fixture and runtime tool-adapter test fakes.
- **IMPORTS**: Existing Axum/tower HTTP test helpers, UUID/serde_json; existing Vitest facilities.
- **GOTCHA**: Stubbed tool decisions prove wiring, not actual language understanding. Record live voice/model checks separately and do not claim they passed without execution. The PostgreSQL test resets its database; serialize tests sharing that fixture.
- **VALIDATE**: Targeted tests plus disposable DB test command below; captured evidence for at least one EN and one VI real voice run before release.

### Task 20: Complete integration, compatibility, and documentation

- **ACTION**: Wire lifecycle cleanup, capability UX, restore behavior, and docs.
- **IMPLEMENT**: Initialize services after auth/client/store availability; stop subscriptions/polling on shutdown; clear transient teacher tokens, student notices and session-local guidance consent on logout; preserve owner-scoped durable receipts/start journals. Document manual-only new links, old-client limitation, joined-session audience, late joiners, student explanation admission/limits, and operational status semantics. Update route/schema inventories for both migrations and all nine new endpoint methods.
- **MIRROR**: Existing `src/index.ts` composition/logout path and `docs/knowledge-spaces.md` language.
- **IMPORTS**: Services added above, no new dependency.
- **GOTCHA**: No feature flag should silently imply older students received a message. Do not change existing Run directives or redact/delete receipts needed to reconcile uncertainty.
- **VALIDATE**: Old/new capability fixtures, logout/login with different owner, restart with prepared/sending/sent drafts; review docs against final behavior.

### Task 21: Run required checks and multi-computer acceptance

- **ACTION**: Run the validation ladder and report actual evidence.
- **IMPLEMENT**: Targeted tests first, then repository-required full checks, package, and Bazel because Rust changes. Perform the broadcast acceptance and teacher/three-student screen-diversity test against a test backend with new clients. Review generated changes and final diff; do not deploy or send into a real class without the user's authorization for that action.
- **MIRROR**: Root AGENTS.md and existing package scripts.
- **IMPORTS**: None.
- **GOTCHA**: `npm start` stops existing development instances and starts configured DB services; don't use it as a multi-instance launcher. `npm run package` uses production Doppler build configuration; it packages locally but must not be substituted for a deployment. Document environment failures honestly.
- **VALIDATE**: All acceptance criteria below, no unauthorized broadcast, and no unresolved duplicate-send failure.

### Milestones

1. **Contracts and API:** Tasks 1–5; testable without voice or a model.
2. **Host tools and durable preparation:** Tasks 6–8; validate with direct tool invocations in tests.
3. **Existing voice/UI and student delivery:** Tasks 9–11; assignment-sharing flow.
4. **Independent student explanation:** Tasks 12–18; student admission, claims, own-screen Coach, lifecycle and UI.
5. **Evidence and release readiness:** Tasks 19–21. Partial milestones are not the completed feature.

## Testing Strategy

### Unit and Integration Cases

| Test | Input | Expected output | Edge? |
|---|---|---|---|
| Normal selection | Teacher opens one live session | Verified token for exact owner/session | No |
| Role rejection | Student or participant-role Teacher supplies selection ID | No tools/commit; coded denial | Yes |
| Scope capture | Record in A; switch to B before transcript | Preserve transcript, no submission to B | Yes |
| Reverse completion | Slow A context read returns after B | B remains selected | Yes |
| EN assignment | “Send Assignment 1 to everyone” | List + prepare position 1; no POST until click | No |
| VI assignment | “Gửi bài tập 1 cho cả lớp” | Same resolved published item | No |
| Title conflict | Title “Assignment 1” is position 2 | Clarification, no draft guessed | Yes |
| Conflicting supplied IDs | Number 1 + Run of number 2 | Reject/clarify | Yes |
| Unpublished/outside target | Foreign Run/version | Reject at host and server | Yes |
| Model authority injection | Extra actor/session/recipient arguments | Strict parser rejects | Yes |
| Ordinary request | “Open VS Code” while teacher-bound | Existing app tool, no broadcast | No |
| Dictation | Same sentence in dictation mode | Text insertion only | Yes |
| Teacher metadata/no CUA | Screen Recording denied | List and prepare still work | Yes |
| Student launch | Explicit sibling Activity Start/Help | Correct explicit Attempt authority | Yes |
| Prepare replay | Same SDK call ID after restore | One persisted draft | Yes |
| Double click | Two commits same draft/revision | One POST in flight, one server record | Yes |
| HTTP duplicate | Concurrent same key/payload | Same receipt; one sequence increment | Yes |
| HTTP mismatch | Same key/different payload or creator | 409, original preserved | Yes |
| Unknown save | Server commits then response lost | Unknown → GET receipt → sent; no POST replay | Yes |
| Unknown absent | Lookup returns not found during delayed POST | Remains unknown, no inferred failure | Yes |
| Close race | Close different sibling Run during commit | Serialized save-before-close or conflict; no deadlock | Yes |
| Role revocation | Teacher removed after preview | New send rejected | Yes |
| Student revocation | Student removed after joining | Feed/open denied and notice cleared | Yes |
| Multi-Activity delivery | Students work in distinct Runs | Same session notice; own target Attempt IDs | No |
| Late join | Join after broadcasts 1..10 | Latest notice 10 only on initial snapshot | Yes |
| Feed pagination | >100 subsequent events | No skipping unseen sequence | Yes |
| Cursor concurrency | Two writers, staggered commit | Cursor follows committed session order | Yes |
| Poll reset race | Leave/change/rejoin A while request outstanding | Old generation ignored | Yes |
| Assignment open | Click on assignment notice | Opens own Attempt; no work/submission mutation | No |
| Completed target | Open submitted/completed Attempt | Existing read-only UI behavior | Yes |
| Withdrawn target | Open withdrawn Attempt | Explicit unavailable result | Yes |
| Link policy | Local/private/credentialed URL | Rejected; valid HTTPS opens only on click | Yes |
| Compatibility | Old capability response; old Run directives | New flow disabled, old flow still parses | Yes |
| UI lifecycle | Preview created on Classwork page | Visible without new microphone or navigation requirement | No |
| Explain intent | “Explain Assignment 1 to the class” | Same two tools; assignment action is explain | No |
| Different student context | Editor/browser/blank desktop | Same assignment, three separately grounded responses | No |
| Actual assignment context | Definition contains objective and instructions absent from title | Serialized Coach request includes both and guidance policy | No |
| Student language | Teacher speaks VI, student app EN | Student explanation uses EN | Yes |
| Default admission | Explain received with no consent | Notice only; no observation/model/Work Session | Yes |
| Opted-in live delta | New explain while idle with session consent | One admitted local explanation | No |
| Historical delta | Initial snapshot/reconnect after consent | No automatic start | Yes |
| Existing local task | Explain arrives during editing/narration | Pending notice; no cancellation or later automatic drain | Yes |
| Same user, two devices | Both claim same broadcast | One Work Session and one eligible owning start | Yes |
| No trusted folder | Explain Workspace assignment | Read-only Coach; no shell authority or mandatory folder selection | Yes |
| Coach feature switch off | Explain with fast Coach disabled | Still constrained Coach or unavailable; never general SDK | Yes |
| False Help | Teacher explain accepted | purpose=work/provenance; no Help queue/blocked state change | Yes |
| Multi-round screen change | Next after student changes app/layout | New observation and one new grounded step | Yes |
| Stale highlight | Focus changes while model responds | No stale overlay; refresh/text offered | Yes |
| No screen permission | Manual/auto explain cannot observe | Text-only answer, no auto permission dialog | Yes |
| Student continuation duplicate | Two Next clicks for same revision | At most one new model request | Yes |
| Teacher rebroadcast | New instruction while guidance active | Separate pending notice; running context unchanged | Yes |
| Sibling target invalidation | Anchor leaves while target is another Activity | Stop guidance/model/narration; release local slot | Yes |
| Limits | Ninth request, seventeenth observation, ten-minute expiry | No new request/observation; bounded end state | Yes |
| Allowance failure | One student's provider admission rejects | Only that student unavailable; other students proceed | Yes |
| Restart during dispatch | Persisted dispatching or unknown model call | No auto replay; interrupted/unknown UI | Yes |
| Teacher status | Guidance finishes | Explanation finished count; no academic completion or screen/text upload | Yes |
| Mock 200-student run | Distinct authenticated contexts | Bounded independent calls/claims, no shared IDs or context | Yes |

### Edge Cases Checklist

- [ ] Empty transcript, no speech, cancelled recording, and partial transcription failure.
- [ ] Maximum instructions/title lengths and Unicode bounds consistent between Rust and Zod.
- [ ] Invalid UUIDs, extra model fields, missing nullable fields, and unsafe cursor values.
- [ ] Concurrent sends, close, role changes, selection changes, and application restarts.
- [ ] Network failure before request, after persistence, and after receipt but before local state write.
- [ ] Wrong renderer/subframe, wrong account, absent membership/feature, expired session.
- [ ] Same class with two live sessions; no automatic “latest session” inference.
- [ ] Unsupported subset request is not widened to “everyone.”
- [ ] New user/old client and old API/new client behavior is explicit.
- [ ] Explanation consent resets on session exit/account change/restart; historical feed cannot trigger it.
- [ ] Guidance start claim, local dispatch, and model request uncertainty are tracked separately.
- [ ] No teacher or sibling-student prompt/history/screen leakage; per-student IDs are unique.
- [ ] A slow model result cannot place a highlight on changed screen geometry.
- [ ] Only new live, idle, locally consented requests can automatically start; busy notices remain explicit.
- [ ] Student guidance finish does not enter the Help queue or complete an assignment.

## Validation Commands

Run from repository root. These are implementation validation commands, not claims that the new feature has already been tested.

### Static Analysis

```bash
npm run typecheck
npm run lint
npm run api:fmt
npm run api:lint
```

EXPECT: No type, lint, formatting, or Rust warnings.

### Targeted TypeScript / SDK Tests

```bash
npx --no-install vitest run src/shared/contracts.test.ts src/main/knowledge/teacher-classroom-context-service.test.ts src/main/knowledge/classroom-assignment-resolver.test.ts src/main/knowledge/classroom-broadcast-draft-service.test.ts src/main/knowledge/classroom-broadcast-service.test.ts src/main/knowledge/classroom-tool-adapters.test.ts src/main/knowledge/knowledge-space-client.test.ts src/main/agent/classroom-agent-tools.test.ts src/main/agent/runtime-tool-registry.test.ts src/main/application/task-request-router.test.ts src/main/application/task-application-service.test.ts src/main/agent-runtime/encrypted-agent-state-store.test.ts src/main/agent-runtime/agent-runtime-adapter.test.ts src/main/ipc/register-ipc.test.ts src/renderer/voice-route.test.ts src/renderer/App.classroom-voice.test.tsx src/renderer/ClassroomBroadcastPreview.test.tsx src/renderer/ClassroomSessionBar.broadcast.test.tsx src/main/knowledge/classroom-directive-service.test.ts
npm --prefix services/agent-runtime run test -- test/tool-adapter.test.ts
npx --no-install vitest run src/main/knowledge/classroom-guidance-policy.test.ts src/main/knowledge/classroom-guidance-coordinator.test.ts src/main/knowledge/activity-context-service.test.ts src/main/knowledge/activity-progress-reporter.test.ts src/main/coach/coach-runtime.test.ts src/main/agent/task-runtime.test.ts src/renderer/ClassroomExplanationPanel.test.tsx
```

EXPECT: New behavior and existing directive/voice/SDK boundaries pass without real provider calls.

### Rust Unit and Contract Tests

```bash
cargo test --manifest-path services/api/Cargo.toml --all-features --locked classroom
cargo test --manifest-path services/api/Cargo.toml --all-features --locked --test contract_corpus
```

EXPECT: Pure policy and route/schema inventories pass. An ignored PostgreSQL test is not evidence of HTTP E2E success.

### Disposable Database Validation

Use PostgreSQL 17 in a dedicated temporary container. The existing E2E test executes `DROP SCHEMA public CASCADE`; never point it at the application development database or production. Example isolated setup with task-specific names and a test-only password:

```bash
docker run --name tro-classroom-broadcast-test --rm -d -p 127.0.0.1:55439:5432 -e POSTGRES_PASSWORD=tro_local_test_only -e POSTGRES_DB=tro_classroom_broadcast_test postgres:17
docker exec tro-classroom-broadcast-test pg_isready -U postgres -d tro_classroom_broadcast_test
TEST_DATABASE_URL=postgresql://postgres:tro_local_test_only@127.0.0.1:55439/tro_classroom_broadcast_test cargo test --manifest-path services/api/Cargo.toml --all-features --locked --test classroom_e2e -- --ignored --test-threads=1
docker stop tro-classroom-broadcast-test
```

Wait until `pg_isready` succeeds before the test. If the explicit container name/port is already occupied, choose a fresh task-specific name/port; never stop an unrelated container. Ensure cleanup also runs after failure.

EXPECT: Migration chain, real HTTP authorization, durable save/idempotency, multi-Activity delivery, and concurrency scenarios pass against isolated PostgreSQL.

### Full Required Verification

```bash
npm run check
npm run package
npm run bazel:check
```

EXPECT: All required repository checks and local package build succeed. Do not mark the feature complete if skipped checks are hidden; record environment blockers explicitly. Before any eventual commit, also follow the supplied supplement's `npm audit` requirement and review the diff. No commit or push is part of creating this plan.

### Desktop / Manual Validation

This is an Electron flow, not an admin-browser feature. Use new-build teacher and student clients pointed at the same isolated test backend. Prefer separate computers for the acceptance run; repeated `npm start` on one checkout stops existing development instances.

- [ ] Test teacher and two Student accounts are already registered, correctly role-assigned, and rostered in one class.
- [ ] Create/publish two Activities, create one session containing both, and open it live.
- [ ] Both students join; one opens Activity 1 and the other opens Activity 2 through existing Assigned work.
- [ ] Use the existing voice Task shortcut and say “Send Assignment 1 to everyone.” No new microphone/mode appears.
- [ ] Verify exact class/session, title/version mapping, instruction, and session-participant audience in the preview.
- [ ] Verify students receive nothing before Broadcast is clicked.
- [ ] Click once; verify a saved receipt and a notice on both students, normally after the next 3–5-second polling cycle.
- [ ] Open assignment on each student and verify distinct own Attempt IDs, correct published instructions, and no automatic execution.
- [ ] Repeat with “Gửi bài tập 2 cho cả lớp.” Verify Activity 2, not the primary Run, is selected.
- [ ] Broadcast an instruction and a public HTTPS link. Link requires an explicit student click.
- [ ] Switch classes while a voice transcript is pending; verify no broadcast is prepared for the new class.
- [ ] Say “Open VS Code”; verify an ordinary local task. Use Dictation; verify text insertion only.
- [ ] Exercise late join, leave/rejoin, closed-session rejection, and lost-response recovery using the test backend.
- [ ] Verify old client compatibility expectations and label successful save separately from delivery.
- [ ] Record screenshots and test command outcomes in `docs/testing/teacher-voice-classroom-broadcast.tdd.md` without exposing tokens or student personal data.

### Independent Student Explanation Acceptance

- [ ] Use three student clients against the same test backend: Student A has the editor open with starter code; B has assignment instructions in a browser; C has a blank/unrelated screen or denies screen access.
- [ ] Teacher uses the existing voice control: “Explain Assignment 1 to the class.” Preview identifies the target and explanation action; click Broadcast.
- [ ] With default settings, all students receive Start explanation and no device starts observing, using a model, or creating a Work Session before student admission.
- [ ] Start on A/B/C. Inspect test evidence that each uses their own Attempt, task ID, accounting turn and observation; verify explanations actually reference the published objective/instructions and differ appropriately with context.
- [ ] A changes screens and clicks Next. Confirm a fresh observation, one new grounded step, and no coordinates copied from the teacher or B.
- [ ] C chooses text-only; confirm a useful assignment explanation without fabricated screen details. Verify reading a Workspace assignment requires no shell/root authorization.
- [ ] Enable auto-start for this session on B only. Send a new explain request while B is idle; it starts once. A/C still require Start.
- [ ] Start a separate task on B before another broadcast. Verify the task/presenter is not interrupted and the pending explanation does not auto-drain later.
- [ ] Reconnect or restart B. Old notices never auto-start, and restart clears consent. Simulate a crash during dispatch and verify interrupted/unknown recovery with no model replay.
- [ ] Sign the same test student into a second device and start the same broadcast from both; verify only the owning claim can run.
- [ ] Stop a student explanation while a model request or narration is active. Confirm local observation/audio/presenter release even if status reporting is offline.
- [ ] Close the teacher session while A works on its second Activity; the anchored explanation cancels despite target/anchor Attempt mismatch.
- [ ] Confirm teacher status shows explanation activity only. No new explicit Help queue row, Ready/Submit/Complete transition, student transcript, or screenshot is delivered to the teacher.
- [ ] Record mock 200-student isolation/load results separately from measured real-provider latency. Do not infer production throughput from mocks.

## Acceptance Criteria

- [ ] Exactly two new model-visible tools exist: list session assignments and prepare classroom broadcast.
- [ ] The existing voice Task control and ordinary typed assistant can use them; no new voice mode or microphone is introduced.
- [ ] Teacher account/membership/session context is verified, captured at voice start, and cannot be retargeted by model arguments or late UI state.
- [ ] Auto teacher requests reach SDK tools even when fast Coach is enabled; explicit student/Coach routes retain their behavior.
- [ ] Assignment resolution uses published versions in the selected session and clarifies ambiguity.
- [ ] Preview is visible from both the class and Agent views, showing the exact destination and payload.
- [ ] Only a teacher's explicit Broadcast click commits; preparation, narration, or SDK checkpoint approval cannot send.
- [ ] Duplicate clicks, network uncertainty, and restart cannot replay an unknown send.
- [ ] Both test students receive the session notice while working on different Activities; each opens their own Attempt.
- [ ] Student assignment opening starts no computer action, work session, enrollment, submission, or grading operation.
- [ ] Old Run instruction/link contracts and current auto-open behavior remain compatible.
- [ ] New links are manual-open; new capability is negotiated; old clients are not claimed as recipients with confirmed delivery.
- [ ] Tests cover context routing, lifecycle/permission decisions, IPC contracts, durable effects, and DB concurrency.
- [ ] Required checks, package, Bazel, and explicit PostgreSQL E2E pass; real EN/VI voice evidence is recorded before release.
- [ ] `explain` uses the same two teacher tools and creates independently admitted student Coach sessions, with separate Attempts, histories, observations and model allowance.
- [ ] Student auto-start is optional, local, session-scoped, default-off, idle-only and unavailable for historical/catch-up notices.
- [ ] Different screens and languages produce independently grounded explanations using the actual published assignment objective/instructions/policy.
- [ ] Each explicit continuation revalidates authority and obtains fresh context; no stale visual sequence, continuous screen monitoring, or student application mutation.
- [ ] Normal tasks and two-device same-user starts cannot race into duplicate guidance execution or shared presentation ownership.
- [ ] Start/claim/provider unknown outcomes are not replayed after timeout or restart; each explanation enforces eight model requests, sixteen observations and ten-minute limits.
- [ ] Guidance provenance is distinct from explicit student Help and academic completion; teacher aggregate status contains no private content.
- [ ] Real three-student screen-diversity acceptance and mocked N-student isolation tests are documented before release.

## Completion Checklist

- [ ] Code follows the discovered host registry/service patterns.
- [ ] Every request/response and stored state is parsed at its boundary.
- [ ] Error codes are stable and UI messages are localized.
- [ ] Logs and analytics contain no transcript/assignment/roster/token content.
- [ ] New state has owner checks, backward-compatible defaults, and cancellation/recovery coverage.
- [ ] No hardcoded user/session IDs or secrets; numeric policy limits are named constants.
- [ ] Migration and route inventory tests updated; generated output not hand-edited.
- [ ] Documentation reflects session audience, explicit confirmation, manual link opening, and client compatibility.
- [ ] No CUA action broadcast, delivery acknowledgements, or unrelated SDK refactor added; only the specified read-only explanation execution and lifecycle counts.
- [ ] Remaining environmental/live-test limitations are explicitly reported.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Session and Run scope confused | High | Students miss notices or open wrong work | Dedicated session feed; own-Attempt resolver; multi-Activity E2E |
| Late voice result targets another class | Medium | Wrong audience | Capture immutable selection/destination; generation checks; preview binding |
| Coach route absorbs teacher command | High | Tools never run | Verified teacher auto-routing before Coach heuristics |
| Screen permission blocks metadata task | High | Voice broadcast unusable | Teacher SDK path avoids unconditional initial screenshot |
| Model guesses assignment/URL | Medium | Wrong content | Pure resolver, strict membership, clarification, exact preview |
| Lost POST response causes duplicate | Medium | Repeated classroom broadcast | Durable sending state, stable key, read-only reconciliation |
| Sequence cursor skips concurrent write | Medium | Silent missed broadcast | Counter allocated under session row lock, paginated last-row cursor |
| Close/send lock inversion | Medium | Deadlock or late commit | Shared session-first lock order with close path |
| Revoked member retains cached access | Medium | Unauthorized read/send | Backend rechecks account/roster and write transaction authority |
| Old clients reject new union | High if legacy union extended | Whole directive polling fails | Additive protocol/capability; legacy unchanged |
| SDK catalog changes on restore | Medium | Unresumable task | Persist/revalidate binding, freeze stable tool schemas, no silent graph change |
| Existing SDK skill plan lands concurrently | Medium | Conflicting catalog edits | Preserve unrelated work; use same host registration interface |
| Coach explains only the title | High with current prompt | Incomplete/wrong assignment guidance | Include bounded published objective/instructions/policy and test serialized input |
| One screen's points reused across students/steps | High without explicit isolation | Misleading guidance | Per-task observation IDs/geometry, one step, refresh before next round |
| Teacher-triggered Help pollution | High if existing Help launch reused | Teacher sees false help/stuck events | Purpose work + broadcast provenance; dedicated start path and E2E assertions |
| Duplicate starts on two student devices | Medium | Double model usage and narration | Unique server broadcast/user claim + local start journal |
| Opt-in replay of backlog | Medium | Unexpected work/cost | Live-delta watermark, default-off reset, no auto catch-up or busy drain |
| Workspace/Coach routing grants wrong authority | Medium | Unnecessary folder blocks or mutation capability | Dedicated trusted read-only explanation launch; no general-Agent fallback |
| Broadcast fan-out overload | Medium | Uneven latency/admission failures | Independent budgets, bounded jitter/calls/queues, mock load + measured staging checks |
| Target task survives leaving a different anchor | High under existing inheritance map | Unscoped continued guidance | Explicit guidance binding invalidation across session/anchor/target |
| Stale or missing lifecycle reports misread as success | Medium | Incorrect teacher conclusions | Monotonic status, unknown labels, finished explanation ≠ assignment mastery |

## Notes

- This plan intentionally replaces the earlier shorthand “extend the directive kind” with an additive session broadcast protocol. Inspection showed legacy clients strictly parse directive unions, so the additive path protects existing classrooms.
- Student polling is the delivery mechanism; the backend does not directly control student desktops. Saving a broadcast and observing its receipt are separate facts.
- The installed SDK is 0.17.0; no new SDK feature or dependency upgrade is required.
- The neighboring plan file is not a dependency, and no sub-agent or remote agent execution is required by this plan.
- Next implementation invocation: `/prp-implement .claude/PRPs/plans/teacher-voice-classroom-broadcast.plan.md`.
- Scope was expanded at the user's request to include complete per-student explanation implementation, including optional session-local automatic admission. Broadcast-only delivery no longer satisfies this plan's completion criteria.
