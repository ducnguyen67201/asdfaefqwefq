# Plan: Live Classroom Room Flow (Observation Deferred)

## Summary

Extend TroCode's existing Knowledge Spaces into a complete live-classroom flow: a teacher prepares and publishes material, opens a short-lived room, students join a lobby, the teacher starts class, broadcasts typed exercise/link directives, students receive sticky Activity context across cursor requests, request contextual Help, Check their work, explicitly submit or mark it ready, and the teacher reviews the resulting evidence and status.

Use the existing canonical `Space → Activity Version → Run → Attempt → Work Session` model. Add only the missing room admission, joined-session, directive, and review layers. Continuous cursor/typing/screen observation is deliberately deferred; this phase reports only explicit lifecycle facts such as joined, started, Help requested, Check started, ready, submitted, returned, and completed.

## User Story

As a teacher, I want to start one class room, send the current exercise and safe link to every joined student, and see who explicitly needs help or is ready for review, so that I do not have to walk around checking every device.

As a student, I want Tro to know which class and exercise I am in, open teacher-approved material, help only when I ask, and let me Check or submit my work, so that I can recover quickly without losing the class context.

## Problem → Solution

TroCode already has materials, Activities, Runs, Attempts, Help, submission, evidence, and a facilitator dashboard, but students must already be assigned before a Run is created; joining is Space-wide rather than class-session-specific; Activity context is attached only from the Activity launch page; live directives do not exist; Help only raises a flag; and there is no ready/review workflow. → Add a Run-scoped room code and lobby, sticky joined-session authority in Electron main, sequence-ordered typed directives, consent-aware safe URL opening, purpose-specific Help/Check Work Sessions, explicit readiness/submission, and teacher complete/return actions.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A — standalone plan based on the customer interview, follow-up product discussion, and approved flow diagram
- **PRD Phase**: N/A
- **Estimated Files**: 68 updated or created files
- **Estimated Tasks**: 9 mergeable implementation gates
- **Feature Flag**: Continue using `TROCODE_KNOWLEDGE_SPACES_ENABLED`; do not create a second classroom backend
- **External Research**: None needed — the plan mirrors pinned Electron, React, Zod, PostgreSQL, hosted-agent, and direct-browser patterns already in this repository
- **Confidence Score**: 8/10
- **Repository State**: `main` has a pre-existing modified `package-lock.json`; preserve it and do not include it in this feature unless a dependency is intentionally changed
- **Navigation Note**: The repository supplement requests `docs/CODEX-NAVIGATION-GUIDE.md`, but that file is absent. The Mandatory Reading and discovery sections below replace it for this implementation.

---

## Product and Architecture Decisions

### 1. A live class is still a Run

Do not introduce a parallel `ClassSession` aggregate. A `live` or `hybrid` `knowledge_activity_run` is the canonical class session:

- `draft` = room lobby exists; students may join but cannot start work.
- `open` = teacher started class; joined students may create Work Sessions.
- `closed` = no new Help/Check Work Sessions or directives; existing Attempts remain available according to the Activity's continuation policy.
- `archived` = retained historical record.

The room layer admits users into a specific Run and creates their private assignment and Attempt. It must not replace Space membership, Activity Version pinning, or Attempt ownership.

### 2. Roles remain authoritative per Space

Keep the existing database roles:

| Canonical role | Classroom label | Authority in this flow |
|---|---|---|
| `owner` | Teacher / Owner | Materials, Activities, room, directives, dashboard, review |
| `facilitator` | Teacher | Materials, Activities, room, directives, dashboard, review |
| `participant` | Student | Join room, own Attempt, Help, Check, readiness/submission |

The separate teacher/student UI branch may control global navigation and presentation, but the hosted API must still authorize every operation from `knowledge_space_members`. UI role labels never grant authority. A user may teach one Space and be a student in another.

### 3. Room join is Run-scoped and idempotent

The teacher creates or rotates a short-lived room code for one draft/open Run. Joining performs one transaction:

1. Hash and lock the code row.
2. Validate expiry, revocation, Run state, and capacity.
3. Add a missing Space membership as `participant` without downgrading an existing owner/facilitator.
4. Create or reuse the Run assignment.
5. Create or reuse the private Attempt.
6. Create or reactivate the Run participation row.
7. Emit a content-free `participant_joined` Run event.

Retries with the same `(runId, userId)` return the same Attempt. A network-unknown room-code creation is recovered by rotating the code; the server never stores or re-exposes the plaintext code.

### 4. Joined class context is sticky but not a lock

Electron main owns an in-memory `ClassroomSessionService` with one active joined context per signed-in desktop:

```text
inactive
  └─ join room / open teacher control
       └─ lobby
            └─ Run opens → live
                 ├─ ordinary cursor request → inherits current Activity Attempt
                 ├─ Help → Activity-scoped help Work Session
                 ├─ Check → Activity-scoped check Work Session
                 └─ leave / Run closes / sign-out → ended → inactive
```

The renderer receives only a bounded projection. It cannot set a Space role, change a Run, or inject Activity definitions. Students can leave the session and continue using normal Tro. A joined session does not block unrelated apps or continuously watch the screen.

### 5. A Session Directive is typed data

Support exactly two directive types in this phase:

```ts
type SessionDirective =
  | {
      kind: 'exercise';
      instruction: string;
      criterionIds: string[];
    }
  | {
      kind: 'open_url';
      instruction: string;
      criterionIds: string[];
      url: string;
      delivery: 'auto_eligible' | 'manual_only';
    };
```

All criteria must belong to the immutable Activity Version pinned by the Run. URL directives must be public HTTPS with no credentials. `auto_eligible` additionally requires an origin listed in the published Activity's `sessionPolicy.allowedOrigins`.

The teacher always sees the exact instruction, criteria, URL, and delivery mode before clicking **Broadcast to class**. The broadcast is a direct, explicit UI mutation. A model may prepare a draft, but it cannot broadcast it.

### 6. Open links directly; use computer use only when needed

For an eligible link, use the existing trusted direct browser path (`openExternal`) rather than computer-use clicks. At join, the student may opt into **Automatically open teacher links from the published allowed sites**.

- Consent on + `auto_eligible`: Electron main atomically claims the directive and opens it once.
- Consent off or `manual_only`: show an accessible banner with **Open link** and **Dismiss**.
- The URL is revalidated in the API, preload boundary, Electron main, and immediately before opening.
- A claim is recorded before automatic execution. A crash after claiming leaves the link manual-only; it is safer to miss one auto-open than to repeat navigation.

Computer use is reserved for the student's explicit Help/Check request when current work must be inspected or manipulated.

### 7. Help, Check, Ready, Submit, and Grade are different actions

- **Help**: creates/steers an Activity-scoped Work Session with purpose `help`, raises the explicit Help queue, performs one fresh observation only when the Activity requires current-surface context, retrieves pinned material as needed, and recommends a next step. It does not automatically solve the entire exercise.
- **Check**: creates an Activity-scoped Work Session with purpose `check` and asks Tro to compare current work with published criteria. Its response is advisory to the student; no AI result becomes a numeric grade.
- **Ready for review**: an explicit student action after Check. If file submission is required, readiness is blocked until the reviewed files are explicitly submitted.
- **Submit**: remains the current exact file-preview/upload/commit flow. Task completion never uploads work.
- **Teacher review**: teacher may `complete` or `return` a ready/submitted Attempt with an idempotent review action.
- **Grade**: numeric/letter grading and automatic mastery scoring are not part of this phase.

### 8. Dashboard status uses explicit events only

The teacher dashboard may derive:

- `not_joined`
- `in_lobby`
- `working` (a Work Session exists or is active)
- `needs_help` (explicit unresolved Help request)
- `ready_for_review`
- `submitted`
- `completed`
- `left_session`
- `launch_failed`

It must not infer `stuck`, typing ability, confusion, attention, or understanding from elapsed time. Continuous observation and behavior telemetry belong in a later PRP.

---

## UX Design

### Before

```text
Teacher                                       Student
┌─────────────────────────────┐              ┌─────────────────────────────┐
│ Upload material             │              │ Redeem a Space invite       │
│ Publish Activity            │              │ Wait for assignment         │
│ Create/open Run for IDs     │              │ Open Assigned Activities    │
│ Poll coarse dashboard       │              │ Start one Activity task     │
└─────────────────────────────┘              └─────────────────────────────┘

No Run room, lobby, live instruction broadcast, sticky cursor context,
Check/ready state, or teacher return/complete action.
```

### After

```text
BEFORE CLASS
Teacher-only Space → Upload material/URLs/rubric → Publish Activity Version

JOIN AND START
Teacher creates live Run + room code/QR
          ↓
Students join lobby + choose safe-link consent
          ↓
Teacher sees roster and starts class (Run draft → open)

LIVE CLASS
Teacher prepares typed exercise/link directive
          ↓ preview + explicit Broadcast
Every joined cursor receives current instruction + pinned Activity context
          ↓
Eligible links open once; otherwise student gets an Open button
          ↓
Student works ── Help ──▶ fresh bounded context + material retrieval
              └─ Check ─▶ criterion-based advisory response

ASSESSMENT
Student marks Ready or explicitly submits reviewed files
          ↓
Teacher dashboard shows explicit state/evidence/help only
          ↓
Teacher completes or returns the Attempt
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Space UI | Participants can reach generic Space tabs | Teacher sees material/activity controls; student sees join/classwork only | Server role checks remain mandatory |
| Run creation | Requires pre-existing group or participant IDs | Adds `room` target with zero initial assignments | Existing group/participant targeting remains supported |
| Room lifecycle | None | Create/rotate/revoke code, lobby, start, close | Run remains canonical |
| Student join | Space invite only | Run code creates/reuses membership, assignment, Attempt, participation | Code/QR share the same backend value |
| Cursor context | Activity only when launched from Assigned page | Joined student requests inherit the active Attempt until leave/end | Visible session bar prevents hidden context |
| Teacher direction | No broadcast | Preview and broadcast typed exercise/open-URL directive | Model may draft, never broadcast |
| Link opening | Per-student manual navigation | Consent-aware direct open or manual banner | No CUA click loop |
| Help | Adds Help flag only | Adds Help flag and starts/steers Activity-scoped support | One fresh observation only if required |
| Check/Done | No explicit check/readiness | Check task, then Ready or explicit Submit | No automatic grade |
| Dashboard | Attempt/session/evidence counts | Joined/lobby/help/ready/submitted/completed plus explicit last event | No cursor/typing/screen telemetry |
| Review | `requiresFacilitatorConfirmation` unused | Teacher Complete/Return action | Idempotent and role-checked |

---

## Mandatory Reading

Files that MUST be read before implementation:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `AGENTS.md` | all | Electron trust invariants and required verification |
| P0 | `docs/knowledge-spaces.md` | all | Canonical Space/Activity/Run/Attempt model and privacy boundaries |
| P0 | `docs/architecture.md` | 1-170 | Renderer/main/backend boundaries and hosted runtime ownership |
| P0 | `docs/security.md` | 1-135 | Model, renderer, CUA, source, submission, and analytics restrictions |
| P0 | `services/api/migrations/008_knowledge_spaces.sql` | all | Existing per-Space roles, groups, and invite code pattern |
| P0 | `services/api/migrations/010_knowledge_activities.sql` | all | Run, Attempt, Work Session, evidence, Help, submission, and event tables |
| P0 | `services/api/src/knowledge-space-contracts.mjs` | all | Hosted schemas, limits, defaults, and validation style |
| P0 | `services/api/src/knowledge-space-policy.mjs` | all | Per-Space operation allowlist and evidence rules |
| P0 | `services/api/src/activity-lifecycle.mjs` | all | Pure transition maps and Run-open checks |
| P0 | `services/api/src/activity-repository.mjs` | all | Transactions, idempotency, assignment/Attempt creation, dashboard projection |
| P0 | `services/api/src/activity-service.mjs` | all | Authorization-before-mutation service pattern |
| P0 | `services/api/src/knowledge-space-http-controller.mjs` | all | Route matching, auth, rate limiting, parsing, and safe responses |
| P0 | `src/shared/contracts.ts` | 392-438, 656-730, 1083-1316, 1431-1473 | Activity context, task authority, renderer API contracts, hosted record |
| P0 | `src/main/application/task-application-service.ts` | 53-150, 236-285 | Trusted Activity resolution and hosted/local task launch gap |
| P0 | `services/api/src/agent-run-service.mjs` | 60-175, 260-395 | Hosted v8 contract construction and public projection |
| P0 | `src/main/agent/runtime-tool-registry.ts` | 989-1020, 1146-1236, 1440-1540 | Direct URL and Activity tool definitions/visibility |
| P0 | `src/main/agent/policy.ts` | 61-178 | Existing public HTTPS validation and tool policy |
| P0 | `src/main/agent/execution-coordinator.ts` | 761-769 | Trusted `openExternal` execution adapter |
| P1 | `src/main/knowledge/knowledge-space-client.ts` | all | Hosted API client, response parsing, and timeout pattern |
| P1 | `src/main/knowledge/activity-context-service.ts` | all | Attempt → Work Session → Activity context compilation |
| P1 | `src/main/knowledge/activity-progress-reporter.ts` | all | Current task phase → Work Session synchronization |
| P1 | `src/shared/desktop-api.ts` | 116-190 | Narrow IPC channel/interface pattern |
| P1 | `src/preload.ts` | 86-230 | Request/response schema parsing at the renderer bridge |
| P1 | `src/main/ipc/register-ipc.ts` | 348-478 | Authorized Knowledge IPC handlers |
| P1 | `src/renderer/SpaceDetailPage.tsx` | all | Current role branching, Activity publish, Run create/open |
| P1 | `src/renderer/AttemptLaunchPage.tsx` | all | Current Help, policy, Workspace, submission, and launch flow |
| P1 | `src/renderer/FacilitatorRunPage.tsx` | all | Five-second delta dashboard pattern |
| P1 | `src/renderer/App.tsx` | 1-180, 520-605, 1930-2350 | Main navigation, current task rail, and submit path |
| P1 | `src/main/application/hosted-task-client.ts` | 94-260 | Reconnecting bounded event-stream/client pattern |
| P1 | `services/api/src/agent-event-stream.mjs` | all | Ordered event encoding, heartbeat, and cancellation pattern |
| P2 | `services/api/test/knowledge-space-domain.test.mjs` | all | Pure domain test style |
| P2 | `services/api/test/integration/knowledge-postgres.test.mjs` | all | Optional PostgreSQL integration gate |
| P2 | `src/main/application/task-application-service.test.ts` | all | Injected Vitest seam for task authority |
| P2 | `src/renderer/SettingsPage.test.ts` | 1-145 | React server-rendered accessibility/markup tests |
| P2 | `/Users/ducng/Documents/Codex/2026-08-24/if-i/outputs/New Recording 47 - Vietnamese Transcript.md` | 76-123, 665-691 | Customer evidence about guided AI, teacher walking/checking, and classroom reporting |

## External Documentation

No external research needed — this feature uses established internal patterns and pinned dependencies. Do not add a WebSocket, classroom SDK, event bus, state-management package, browser extension, or screen-recording dependency.

---

## Architecture and Data Flow

### Trust-boundary flow

```text
Sandboxed React renderer
  │ exact DesktopApi method / bounded event
  ▼
Validated preload
  │ authenticated narrow IPC
  ▼
Electron main
  ├─ ClassroomSessionService (active context + local consent)
  ├─ ClassroomDirectiveService (poll, dedupe, claim, safe open)
  └─ TaskApplicationService (inherit trusted Attempt for Help/Check)
  │ Bearer token + response schema
  ▼
Hosted Knowledge controller
  │ session + access plan + rate limit + Zod parse
  ▼
LiveClassroomService / ActivityService / SpaceService
  │ per-Space role + Run/Attempt ownership + lifecycle
  ▼
PostgreSQL repositories
  ├─ room code digest
  ├─ Run participation
  ├─ assignment + private Attempt
  ├─ sequence-ordered directives + claims
  ├─ Help/readiness/review events
  └─ dashboard projection
```

### Room sequence

```text
Teacher UI          Hosted API/PostgreSQL        Student Electron/UI
    │ create Run(room,draft) │                           │
    │───────────────────────▶│                           │
    │ create/rotate code     │                           │
    │───────────────────────▶│                           │
    │◀──────── code ─────────│                           │
    │                        │◀──── join(code) ──────────│
    │                        │ membership/assignment/    │
    │                        │ Attempt/participation TX  │
    │                        │──── joined context ──────▶│ lobby
    │ start class            │                           │
    │───────────────────────▶│ Run draft → open          │
    │                        │──── state/event ─────────▶│ live
```

### Directive sequence

```text
Teacher prepares draft
  → exact preview
  → explicit Broadcast
  → role + Run-open + criterion + URL/origin validation
  → idempotent directive row + sequence
  → each joined client polls with sinceSequence
  → Electron main parses and deduplicates
  → consent + auto eligibility?
       yes → atomic claim → openExternal once → visible banner/receipt
       no  → visible banner → student Open/Dismiss
```

### Student Help/Check sequence

```text
Joined session has trusted attemptId
  ├─ Help
  │    → explicit Help request event
  │    → start/steer activityIntent=help
  │    → one fresh current-surface observation when required
  │    → bounded search_activity_knowledge
  │    → next-step recommendation / approved computer use
  └─ Check
       → start activityIntent=check
       → compare current work to published criteria
       → show advisory result to student
       → student explicitly Ready or Submit
       → teacher Complete or Return
```

### API contract additions

| Method | Route | Caller | Purpose |
|---|---|---|---|
| `POST` | `/v1/spaces/:spaceId/runs/:runId/room-code` | owner/facilitator | Create or rotate room code |
| `DELETE` | `/v1/spaces/:spaceId/runs/:runId/room-code` | owner/facilitator | Revoke room admission |
| `POST` | `/v1/live-rooms/join` | signed-in user | Join/rejoin code and receive own Attempt context |
| `POST` | `/v1/attempts/:attemptId/live-session/leave` | Attempt owner | Mark participation left without deleting work |
| `GET` | `/v1/attempts/:attemptId/live-session` | Attempt owner | Refresh Run state/current directive after restart |
| `POST` | `/v1/spaces/:spaceId/runs/:runId/directives` | owner/facilitator | Commit one previewed typed directive |
| `GET` | `/v1/attempts/:attemptId/directives?sinceSequence=N` | Attempt owner | Read ordered directives for own Run |
| `POST` | `/v1/attempts/:attemptId/directives/:directiveId/claim` | Attempt owner | At-most-once automatic handling claim |
| `POST` | `/v1/attempts/:attemptId/ready` | Attempt owner | Explicit ready-for-review transition |
| `POST` | `/v1/spaces/:spaceId/runs/:runId/attempts/:attemptId/review` | owner/facilitator | Complete or return Attempt |
| `POST` | `/v1/spaces/:spaceId/runs/:runId/attempts/:attemptId/help/resolve` | owner/facilitator | Resolve explicit Help and resume blocked Attempt |

All mutation bodies include a client-generated UUID for idempotency. All student routes derive ownership from the authenticated user; all teacher routes resolve Space membership on the server.

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Finding |
|---|---|---|---|
| Existing foundation | `docs/knowledge-spaces.md:7-32` | Space → Activity Version → Run → Attempt → Work Session | Extend it; do not create a second classroom database |
| Naming | `src/shared/contracts.ts:1101-1316` | `Knowledge*Schema`, `Create*RequestSchema`, inferred types | New desktop contracts should follow the same prefix and schema-first exports |
| Backend schemas | `services/api/src/knowledge-space-contracts.mjs:3-193` | Zod limits, `.strict()`, cross-field refinement | Bound room code, instructions, criteria, cursors, and arrays at entry |
| Authorization | `services/api/src/knowledge-space-policy.mjs:1-29` | Operation allowlist by Space role | Add room/directive/review operations; never authorize from UI role |
| Lifecycle | `services/api/src/activity-lifecycle.mjs:1-57` | Pure transition map | Add `ready_for_review` and pure return/complete rules |
| Idempotency | `services/api/src/activity-repository.mjs:35-74` | Advisory lock + `client_id` + existing-row response | Mirror for room code rotation, join, directive, ready, review |
| Set-based assignment | `services/api/src/activity-repository.mjs:97-139` | Transaction creates assignment and Attempt together | Room join performs the same work for one authenticated participant |
| Error handling | `services/api/src/activity-service.mjs:19-33` | Safe message + `status` + stable `code` | Return actionable room/run/directive/review conflicts |
| Controller | `services/api/src/knowledge-space-http-controller.mjs:13-18,27-55` | Parse after auth/rate limit, delegate to service | New routes stay out of `server.mjs` |
| Run events | `services/api/migrations/010_knowledge_activities.sql:142-152` | Monotonic global sequence and bounded payload | Emit content-free changes for dashboard deltas |
| Dashboard | `services/api/src/activity-repository.mjs:463-513` | Snapshot + `sinceSequence` delta | Extend explicit projection; do not add observation telemetry |
| Electron boundary | `src/main/ipc/register-ipc.ts:348-478` | Authorized sender then schema parse then narrow service | No raw fetch, role, or generic directive executor in renderer |
| Preload boundary | `src/preload.ts:86-230` | Parse request and response on both sides | Add exact methods/events only |
| Hosted client | `src/main/knowledge/knowledge-space-client.ts:105-117` | Bearer token, timeout, response Zod parse | Preserve server safe message/code instead of generic HTTP only |
| Active task | `src/main/application/task-application-service.ts:66-149` | Resolve Attempt before task, create Work Session, bind progress | Inherit active joined Attempt when explicit ID is absent |
| Hosted gap | `src/main/application/task-application-service.ts:104-112`; `services/api/src/agent-run-service.mjs:75-93` | Hosted submit omits Activity Attempt/context | Server must resolve the authenticated Attempt and fill existing v8 `activity` authority |
| Activity tools | `src/main/agent/runtime-tool-registry.ts:1146-1236` | Tools visible only with trusted Activity context | Hosted worker/tool catalogs must include and enforce the same context |
| Direct URL | `src/main/agent/execution-coordinator.ts:761-769` | `openExternal` direct adapter returns confirmed acceptance | Reuse an injected safe-open adapter; no repeated CUA clicks |
| Public URL policy | `src/main/agent/policy.ts:61-114` | Public HTTPS, no credentials/private hosts | Mirror server/main validation and immutable allowed-origin check |
| Progress sync | `src/main/knowledge/activity-progress-reporter.ts:18-38` | Throttled, content-free Work Session state updates | Add purpose; do not convert temporary `blocked` task phase into failed session |
| Renderer role bug | `src/renderer/SpaceDetailPage.tsx:20-23`; `src/renderer/SpaceLibrary.tsx:24-29` | Activity UI branches, but Library controls are always rendered | Hide teacher material controls from participants and tighten server source reads |
| Student flow | `src/renderer/AttemptLaunchPage.tsx:63-98,182-205,276-334` | Policy, Help, submission, task launch | Convert to joined session bar plus Help/Check/Ready actions |
| Teacher flow | `src/renderer/FacilitatorRunPage.tsx:7-16` | Visibility-aware 5-second polling | Extend with lobby, directive preview, review queues; keep in-flight guard |
| Test style | `services/api/test/knowledge-space-domain.test.mjs:1-45` | `node:test` + `assert/strict` | Pure policy/lifecycle table tests |
| Desktop test style | `src/main/application/task-application-service.test.ts:11-136` | Vitest injected fakes and ordered assertions | Test sticky authority without Electron integration |
| UI test style | `src/renderer/SettingsPage.test.ts:1-145` | `renderToStaticMarkup` | Verify role visibility, labels, buttons, and disclosures |
| Logging | `services/api/src/main.mjs:253-279` | JSON event/code/name only | Never log room codes, URLs, student text, files, screenshots, or directives |
| Config | `.env.example:70-76`; `services/api/src/config.mjs:77-100` | One Knowledge Spaces flag and private storage config | No additional feature dependency needed |
| Verification | `AGENTS.md`; `package.json` | `npm run check`, `npm run package` | Add focused tests first, then full gates |

---

## Patterns to Mirror

All snippets below are existing repository code.

### NAMING_AND_BOUNDARY_SCHEMA

```ts
// SOURCE: src/shared/contracts.ts:1303-1316
export const RequestKnowledgeAttemptHelpSchema = z.object({
  attemptId: z.string().uuid(),
  clientId: z.string().uuid(),
});
export const SetKnowledgeRunStateRequestSchema = z.object({
  spaceId: z.string().uuid(),
  runId: z.string().uuid(),
  state: z.enum(['open', 'closed']),
});
export const GetKnowledgeDashboardRequestSchema = z.object({
  spaceId: z.string().uuid(),
  runId: z.string().uuid(),
  sinceSequence: z.number().int().nonnegative().optional(),
});
```

### ERROR_HANDLING

```js
// SOURCE: services/api/src/activity-service.mjs:19-33
if (await this.activityRepository.activeRunCount(spaceId) >= limits.activeRuns) {
  const error = new Error('This Space reached its active Run limit.');
  error.status = 409; error.code = 'active_run_quota'; throw error;
}
```

Use stable codes such as `room_code_invalid`, `room_code_expired`, `room_closed`, `run_not_open`, `directive_origin_not_allowed`, `directive_already_claimed`, `submission_required`, and `invalid_review_transition`. Do not reveal whether another user's Attempt exists.

### AUTHORIZATION_SERVICE

```js
// SOURCE: services/api/src/knowledge-space-service.mjs:21-25
async role(userId, spaceId, operation) {
  const role = await this.spaceRepository.membership(spaceId, userId);
  if (!role) { const error = new Error('Space not found.'); error.status = 404; error.code = 'space_not_found'; throw error; }
  assertSpaceRole(role, operation); return role;
}
```

### TRANSACTION_AND_IDEMPOTENCY

```js
// SOURCE: services/api/src/activity-repository.mjs:70-74
return inTransaction(this.pool, async (client) => {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`run:${spaceId}:${clientId}`]);
  const existing = await client.query(`SELECT id, state FROM knowledge_activity_runs WHERE space_id=$1 AND client_id=$2`, [spaceId, clientId]);
  if (existing.rows[0]) return { id: existing.rows[0].id, state: existing.rows[0].state, newlyCreated: false };
```

### HTTP_CONTROLLER

```js
// SOURCE: services/api/src/knowledge-space-http-controller.mjs:13-18,110-117
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const detail = publicValidationError(result.error);
  const error = new HttpError(400, detail.error, detail.code); error.detail = detail; throw error;
}

const run = await this.activityService.createRun(
  userId,
  route.groups.spaceId,
  parse(CreateRunSchema, await readJson(request)),
  limits,
);
```

### IPC_BOUNDARY

```ts
// SOURCE: src/main/ipc/register-ipc.ts:396-405
ipcMain.handle(IPC_CHANNELS.createKnowledgeRun, async (event, input: unknown) => {
  await assertMembershipAuthorizedSender(event, mainWindow, services);
  return services.knowledgeSpaceClient.createRun(CreateKnowledgeRunRequestSchema.parse(input));
});
```

### PRELOAD_RESPONSE_PARSE

```ts
// SOURCE: src/preload.ts:139-148
async createKnowledgeRun(input) {
  const request = CreateKnowledgeRunRequestSchema.parse(input);
  const response: unknown = await ipcRenderer.invoke(IPC_CHANNELS.createKnowledgeRun, request);
  return KnowledgeRunSchema.parse(response);
},
```

### DIRECT_BROWSER_EXECUTION

```ts
// SOURCE: src/main/agent/execution-coordinator.ts:761-769
{
  id: 'browser.navigate',
  execute: async (invocation) => {
    const input = invocation.input as OpenUrlToolInput;
    await openExternal(input.url);
    return {
      status: 'confirmed',
      summary: 'The browser accepted the HTTPS navigation request.',
    };
  },
},
```

### POLLING_WITH_VISIBILITY

```ts
// SOURCE: src/renderer/FacilitatorRunPage.tsx:9-15
useEffect(() => {
  let active = true; let timer: number | null = null;
  const poll = async () => {
    if (document.visibilityState !== 'visible') return;
    // bounded delta request
  };
  void poll(); timer = window.setInterval(() => void poll(), 5000);
  return () => { active = false; if (timer !== null) window.clearInterval(timer); };
}, [appLanguage, runId, spaceId]);
```

Add an in-flight guard and jitter for student directive polling so overlapping requests cannot reorder directives.

### TEST_STRUCTURE

```ts
// SOURCE: src/main/application/task-application-service.test.ts:11-33
describe('TaskApplicationService', () => {
  it('owns submit-before-start ordering and resumes interactions', async () => {
    const order: string[] = [];
    const runtime = { submit: vi.fn(() => { order.push('submit'); return { taskId: 'task-1' }; }) };
    // injected services, one action, ordered assertions
    expect(order).toEqual(['submit', 'start']);
  });
});
```

---

## Files to Change

### Hosted API and database

| File | Action | Justification |
|---|---|---|
| `services/api/migrations/018_live_classroom_room_flow.sql` | CREATE | Room codes, participation, Work Session purpose, directives, claims, review actions, `ready_for_review` constraint/indexes |
| `services/api/src/knowledge-space-contracts.mjs` | UPDATE | Room/join/directive/ready/review schemas, Activity session policy, Run `room` target |
| `services/api/src/activity-lifecycle.mjs` | UPDATE | Pure `ready_for_review`, return, completion, Help resolve transitions |
| `services/api/src/knowledge-space-policy.mjs` | UPDATE | Room/directive/review/help-resolve operations by canonical role |
| `services/api/src/knowledge-space-service.mjs` | UPDATE | Tighten source/group reads so participants cannot browse teacher controls/content |
| `services/api/src/activity-repository.mjs` | UPDATE | Dashboard explicit-state projection and current directive/Attempt context |
| `services/api/src/activity-service.mjs` | UPDATE | Work Session purpose, Ready/Return/Complete orchestration |
| `services/api/src/live-classroom-repository.mjs` | CREATE | Room code, join, participation, directive, claim, and idempotent review persistence |
| `services/api/src/live-classroom-service.mjs` | CREATE | Role/lifecycle/URL/criterion policy and transactional orchestration |
| `services/api/src/classroom-directive-policy.mjs` | CREATE | Pure public-HTTPS, allowed-origin, directive delivery decision |
| `services/api/src/insight-service.mjs` | UPDATE | Explicit lobby/help/review queue derivation only |
| `services/api/src/knowledge-space-http-controller.mjs` | UPDATE | Add narrow routes and route matching |
| `services/api/src/main.mjs` | UPDATE | Construct/inject new repository/service |
| `services/api/src/agent-runtime-contracts.mjs` | UPDATE | Accept optional `activityAttemptId` and Activity intent in hosted submit |
| `services/api/src/agent-run-service.mjs` | UPDATE | Resolve authenticated Activity/current directive into existing v8 contract |
| `services/api/src/backend-agent-runtime.mjs` | UPDATE | Include trusted Activity instructions/policies in hosted model context |
| `services/api/src/agent-tool-catalog.mjs` | UPDATE | Advertise bounded Activity knowledge/signal tools to hosted runtime |
| `services/api/test/knowledge-space-domain.test.mjs` | UPDATE | Role, lifecycle, room target, directive policy tests |
| `services/api/test/live-classroom-service.test.mjs` | CREATE | Service authorization, state, idempotency, expiry, criterion/origin cases |
| `services/api/test/agent-run-service.test.mjs` | UPDATE | Authenticated Activity context included; cross-user Attempt rejected |
| `services/api/test/integration/knowledge-postgres.test.mjs` | UPDATE | Concurrent join/directive/claim/review, isolation, indexes, 200-student fixture |
| `services/api/test/migrate.test.mjs` | UPDATE | Migration 018 applies idempotently and preserves existing rows |

### Shared, Electron main, and hosted worker

| File | Action | Justification |
|---|---|---|
| `src/shared/contracts.ts` | UPDATE | All renderer/main schemas and Activity context/current directive/session projections |
| `src/shared/contracts.test.ts` | UPDATE | Defaults, bounds, strictness, legacy compatibility |
| `src/shared/desktop-api.ts` | UPDATE | Exact room/session/directive/ready/review methods and bounded events |
| `src/preload.ts` | UPDATE | Parse every new request/response/event |
| `src/main/ipc/register-ipc.ts` | UPDATE | Authorized narrow handlers; no raw role/fetch/open authority |
| `src/main/ipc/register-ipc.test.ts` | UPDATE | Hostile sender/payload, sign-out/dispose, exact delegation tests |
| `src/main/knowledge/knowledge-space-client.ts` | UPDATE | New HTTP methods and safe server-error preservation |
| `src/main/knowledge/classroom-session-service.ts` | CREATE | Trusted active teacher/student session, local consent, leave/end lifecycle |
| `src/main/knowledge/classroom-session-service.test.ts` | CREATE | Join/rejoin, inherit, leave, close, sign-out, role isolation |
| `src/main/knowledge/classroom-directive-service.ts` | CREATE | Poll/dedupe/claim, delivery decision, safe direct open, banner events |
| `src/main/knowledge/classroom-directive-service.test.ts` | CREATE | Duplicate, stale, consent, manual, bad URL/origin, offline, close cases |
| `src/main/knowledge/activity-context-service.ts` | UPDATE | Work Session purpose and current trusted directive in ActivityContext |
| `src/main/knowledge/activity-progress-reporter.ts` | UPDATE | Purpose-aware explicit status; correct blocked/failed mapping |
| `src/main/knowledge/activity-progress-reporter.test.ts` | CREATE | Throttle, terminal flush, Help/Check, retry-safe failures |
| `src/main/application/task-application-service.ts` | UPDATE | Inherit active student Attempt and forward authenticated Activity to hosted runtime |
| `src/main/application/task-application-service.test.ts` | UPDATE | Explicit ID precedence, inherited context, no-session normal-task parity |
| `src/main/application/hosted-task-client.ts` | UPDATE | Submit Activity ID/intent and preserve bounded API errors |
| `src/main/hosted/desktop-worker-protocol.ts` | UPDATE | Add Activity tools to worker capability intersection |
| `src/main/hosted/desktop-tool-worker.test.ts` | UPDATE | Hosted Activity tool dispatch remains host-policy checked |
| `src/main/agent/runtime-tool-registry.ts` | UPDATE | Optional `join_live_room` and `draft_session_directive` tools; no broadcast tool |
| `src/main/agent/runtime-tool-registry.test.ts` | UPDATE | Tool visibility, normalization, effect, inactive-session denial |
| `src/main/agent/policy.ts` | UPDATE | Validate classroom join/draft effects and immutable URL policy inputs |
| `src/main/agent/policy.test.ts` | UPDATE | No model broadcast; public/private/credential URL cases |
| `src/main/agent/openai-agents-runtime.ts` | UPDATE | Include current Activity directive in local agent instructions |
| `src/index.ts` | UPDATE | Construct services, inject direct opener, bind lifecycle/sign-out/shutdown |

### Renderer and documentation

| File | Action | Justification |
|---|---|---|
| `src/renderer/SpacesPage.tsx` | UPDATE | Student room-code join entry; preserve Space creation for authorized teacher UI |
| `src/renderer/SpaceDetailPage.tsx` | UPDATE | Room-target Run creation, lobby, role-scoped tabs/actions |
| `src/renderer/SpaceLibrary.tsx` | UPDATE | Render upload controls only for owner/facilitator |
| `src/renderer/ActivityEditorPage.tsx` | UPDATE | Allowed origins, classroom completion defaults, policy preview |
| `src/renderer/FacilitatorRunPage.tsx` | UPDATE | Room code/roster/start, directive preview/broadcast, Help/review queues |
| `src/renderer/AssignedActivitiesPage.tsx` | UPDATE | Joined/live state and re-enter session action |
| `src/renderer/AttemptLaunchPage.tsx` | UPDATE | Join disclosure, safe-link consent, Help/Check/Ready/Submit separation |
| `src/renderer/KnowledgeHubPage.tsx` | UPDATE | Route room join, active session, and Attempt correctly |
| `src/renderer/ClassroomSessionBar.tsx` | CREATE | Persistent visible class context, Help, Check, leave, latest directive |
| `src/renderer/ClassroomSessionBar.test.tsx` | CREATE | Accessible lobby/live/ended/help/check/directive states |
| `src/renderer/classroom-session-view.ts` | CREATE | Pure role/state/action presentation model |
| `src/renderer/classroom-session-view.test.ts` | CREATE | Deterministic explicit status mapping; no inferred stuck state |
| `src/renderer/App.tsx` | UPDATE | Mount session bar/banner and attach Activity intent to cursor submissions |
| `src/renderer/app-navigation.ts` | UPDATE | Role-compatible Spaces/Classwork labels without authority logic |
| `src/renderer/app-language.ts` | UPDATE | English/Vietnamese strings for the complete flow |
| `src/renderer/app-language.test.ts` | UPDATE | Translation coverage for critical controls/disclosures |
| `src/index.css` | UPDATE | Responsive lobby/roster/banner/review UI, focus, reduced motion, non-color states |
| `README.md` | UPDATE | Explain live classroom room flow and safety boundary |
| `docs/architecture.md` | UPDATE | Room/session/directive/help/check data flow and hosted Activity parity |
| `docs/knowledge-spaces.md` | UPDATE | Run lobby, dynamic room admission, explicit readiness/review |
| `docs/security.md` | UPDATE | Room-code abuse, forged roles, directive replay, URL policy, consent, privacy |

## NOT Building

- Continuous cursor, mouse, keyboard, typing-speed, foreground-window, screenshot, OCR, or screen-stream observation.
- Teacher screen viewing, remote desktop, arbitrary typing/clicking, forced focus, app locking, microphone control, volume control, or OS-level attention actions.
- Automatic “stuck,” “confused,” “slow,” engagement, or understanding inference.
- Numeric/letter grades, AI mastery scores, parent reports, leaderboards, custom cursors, or minigames.
- Automatic file upload or submission when an agent task completes.
- Arbitrary auto-open URLs. Automatic opening is limited to public HTTPS origins published in the immutable Activity and accepted by the student at join.
- A shared model session or shared student screen. Each student keeps a private Attempt and bounded Work Sessions.
- LMS/LTI/SCORM, Google Classroom, Drive, Notion, or external curriculum integrations.
- A new global role model. Integrate the separate teacher/student branch for presentation, but authorize from per-Space membership.
- Model-authorized broadcast. The model may populate a local directive draft; the teacher must preview and click Broadcast.
- Full voice-first field editing. The plan exposes `join_live_room` and `draft_session_directive` tool seams; reuse of push-to-talk inside every classroom field can be a later UX refinement.

---

## Step-by-Step Tasks

### Task 1: Add the canonical room, participation, directive, and review domain

- **ACTION**: Create migration 018 and extend pure schemas/lifecycles without changing existing Run/Attempt ownership.
- **IMPLEMENT**:
  - Add `room` to the Run target constraint while preserving `group` and `participants`.
  - Create `knowledge_live_room_codes` with `run_id`, `code_digest BYTEA UNIQUE`, expiry, revoke time, use limit/count, creator, and timestamps. Store no plaintext.
  - Create `knowledge_run_participations` keyed by `(run_id,user_id)` with `attempt_id UNIQUE`, `joined_at`, `left_at`, and content-free updated time.
  - Add `purpose IN ('work','help','check') NOT NULL DEFAULT 'work'` to Work Sessions.
  - Add `ready_for_review` to Attempt state constraints and indexes for teacher review queue.
  - Create `knowledge_run_directives` with UUID id, Run, Activity Version, creator, `client_id`, monotonic sequence, type, bounded payload, timestamp, and `UNIQUE(run_id,client_id)`.
  - Create `knowledge_run_directive_claims` keyed by `(directive_id,user_id)` with claim time and optional handled result enum. This is a claim, not proof that the OS opened the URL.
  - Create `knowledge_attempt_review_actions` with `(attempt_id,client_id)` uniqueness, action `complete|return`, reviewer, and timestamp.
  - Extend Activity definition with `sessionPolicy.allowedOrigins` (max 20 normalized HTTPS origins) and `allowRoomJoin`; defaults must make old Activities manual-link only.
  - Extend pure lifecycle transitions: `in_progress|blocked → ready_for_review`, `ready_for_review|submitted → completed`, `ready_for_review|submitted → in_progress` for return.
- **MIRROR**: Migration 010 constraints/indexes; `ActivityDefinitionSchema`, `RunTargetSchema`, `assertTransition`.
- **IMPORTS**: Zod only in contracts; no new package.
- **GOTCHA**:
  - Migrations run repeatedly and must be idempotent.
  - Do not backfill Activity JSON with broad auto-open authority.
  - Do not make `ready_for_review` terminal.
  - Do not use Run presentation labels as policy.
- **VALIDATE**:
  - `node --test services/api/test/knowledge-space-domain.test.mjs services/api/test/migrate.test.mjs`
  - With `TEST_DATABASE_URL`, apply migration twice and inspect constraints/indexes.

### Task 2: Implement secure room creation, join, rejoin, leave, and start

- **ACTION**: Add the backend repository/service/routes that turn a room code into an owned private Attempt.
- **IMPLEMENT**:
  - Generate a human-readable random code with sufficient entropy and HMAC-SHA256 it using the existing invite-key approach.
  - Teacher creates/rotates/revokes a code only for a `live|hybrid` Run in `draft|open` state and only with `run.manage`/new `run.room_manage` authority.
  - Add `target.kind='room'`; creation returns zero assignments and remains draft.
  - Join locks the room row, validates code/expiry/revocation/capacity, preserves an existing stronger Space role, and idempotently creates membership/assignment/Attempt/participation.
  - Join response returns only the caller's Attempt context, Run lobby/open state, Space label, Activity summary, current directive, and consent disclosure.
  - Allow join while draft or open; deny after close/archive. Teacher can start only after a Run exists; an empty room may still start.
  - Leave marks participation `left_at` and emits an event but retains membership, Attempt, submission, and evidence.
  - Add a refresh endpoint so an app restart can restore the caller's joined Run without trusting local IDs alone.
  - Keep existing group/participant assignment snapshot behavior unchanged.
- **MIRROR**: `KnowledgeSpaceService.redeemInvite`, `PostgresKnowledgeSpaceRepository.redeemInvite`, `PostgresActivityRepository.createRun`.
- **IMPORTS**: `createHmac`, `randomBytes`, `inTransaction`, `iso`, existing plan limits.
- **GOTCHA**:
  - Joining must never downgrade owner/facilitator to participant.
  - A failed/unknown response after committed join must be safe to retry.
  - Do not return code digest, other students, emails, or group membership to the joiner.
  - Run open/close and room-code status must be checked in the same transaction where relevant.
- **VALIDATE**:
  - Unit tests for teacher/participant authorization, invalid/expired/revoked code, capacity, rejoin, stronger role, closed Run.
  - PostgreSQL test with 200 concurrent unique users plus duplicate retry per user: exactly one assignment, Attempt, and participation per user.

### Task 3: Add typed Session Directives and consent-aware at-most-once delivery

- **ACTION**: Implement previewed teacher broadcasts and student directive reads/claims.
- **IMPLEMENT**:
  - Add `exercise` and `open_url` strict discriminated unions with bounded instruction and criterion IDs.
  - Validate criteria against the immutable Activity Version pinned to the Run.
  - Validate every URL as public HTTPS without credentials. Normalize the origin. Set `auto_eligible` only if it appears in the pinned Activity's allowed origins; otherwise store `manual_only`.
  - Teacher directive creation requires role, open Run, matching Space/Run/Activity, and client-id idempotency.
  - Student list endpoint joins through the authenticated Attempt owner and returns only that Run's ordered directives, capped at 100, plus `maxSequence`.
  - Student claim atomically inserts one claim. Duplicate claims return `execute:false`; they do not error or execute a tool server-side.
  - Store exact directive content only in the access-controlled directive table. Run events contain directive id/type/sequence, not full instruction or URL.
  - Add a bounded per-Run directive rate (for example 30/minute) in addition to existing user rate limits.
- **MIRROR**: `knowledge_activity_run_events` sequence delta; `ActivityRepository.insertEvidence` advisory lock and cap.
- **IMPORTS**: `URL`, Zod, repository helpers; no model SDK.
- **GOTCHA**:
  - Do not infer auto eligibility in the renderer.
  - Never log URL query strings, room codes, instruction text, or student identifiers.
  - A claim is intentionally at-most-once, not exactly-once execution proof.
- **VALIDATE**:
  - Concurrent same-client directive creation returns one row.
  - Cross-Space teacher, closed Run, foreign Attempt, unknown criterion, private host, credential URL, and origin mismatch fail closed.
  - Two devices for the same user cannot both receive `execute:true` for one directive.

### Task 4: Make joined context and directive delivery trusted Electron-main services

- **ACTION**: Add local session lifecycle, polling, consent, and direct browser execution behind narrow IPC.
- **IMPLEMENT**:
  - `ClassroomSessionService` stores a trusted server-returned teacher control context or student Attempt context; expose a bounded projection and change event.
  - Activate student state after UI/tool join. Activate teacher state after opening a Run page through a role-verified control-context endpoint.
  - Clear on explicit leave, Run close/end, sign-out, membership loss, or shutdown. Do not persist room codes or consent in renderer/localStorage.
  - `ClassroomDirectiveService` polls ordered deltas every 3–5 seconds with jitter, one in-flight request, `sinceSequence`, abort, and exponential backoff.
  - For `auto_eligible`, require current local consent, revalidate URL/origin, claim on server, and call an injected `openExternal` adapter once. Otherwise publish a banner event.
  - Manual **Open link** also revalidates and opens through main; Dismiss is local and does not mutate Attempt state.
  - Attach latest directive to the active session projection so future Help/Check tasks include the current exercise.
  - Add exact IPC methods/events. Preload parses both request and response/event. Renderer never receives `openExternal` or generic URL execution.
  - Improve `KnowledgeSpaceClient` error parsing to retain bounded safe `error`/`code` from hosted API.
- **MIRROR**: `HostedTaskClient.subscribe` cancellation/reconnect structure; Knowledge IPC handlers; execution coordinator's injected `openExternal`.
- **IMPORTS**: `AbortController`, shared schemas, `KnowledgeSpaceClient`, injected function type; no Electron import outside composition.
- **GOTCHA**:
  - No overlapping polls.
  - Never auto-open after consent was toggled off, session switched, or Run closed.
  - Never retry an open whose result is unknown. A claim already consumed keeps the retry manual.
- **VALIDATE**:
  - `npx vitest run src/main/knowledge/classroom-session-service.test.ts src/main/knowledge/classroom-directive-service.test.ts src/main/ipc/register-ipc.test.ts`
  - Fake timers: reconnect, duplicate sequence, old response after session switch, sign-out, and shutdown.

### Task 5: Make every student cursor request inherit the active Activity safely

- **ACTION**: Connect sticky session context to local and hosted agent execution without trusting renderer-supplied Activity data.
- **IMPLEMENT**:
  - Add `activityIntent: 'work'|'help'|'check'` to `SubmitTaskRequest`, default `work`.
  - In `TaskApplicationService`, explicit `activityAttemptId` wins; otherwise ask `ClassroomSessionService` for the current student Attempt. If neither exists, behavior is identical to normal Tro.
  - Resolve the Attempt from hosted API before task allocation; include latest trusted Session Directive and Work Session purpose in `ActivityContext`.
  - Pass only `activityAttemptId`/intent through `HostedTaskClient.submit`. `AgentRunService` independently resolves the authenticated user's Attempt, Run state, immutable Activity Version, source catalog, policy acknowledgment, and current directive.
  - Populate the already-existing v8 `activity` field in the encrypted hosted contract; do not accept Activity JSON, role, criteria, source catalog, or policy from desktop input.
  - Include Activity context in hosted model instructions, matching `OpenAIAgentsRuntime.instructionsFor`.
  - Add `knowledge.search` and `activity.signal` to hosted tool catalog/worker protocol. Desktop main still enforces the exact Attempt and policy.
  - Fix restore/public projections so an active hosted Activity task does not become `activity:null` after reconnect.
  - Keep non-Activity tasks behaviorally identical and do not bump task contract version unless the final implementation proves v8 cannot represent the resolved context.
- **MIRROR**: `ActivityContextService.create`, `TaskApplicationService.submitAndStart`, local runtime Activity instructions and tool visibility.
- **IMPORTS**: Existing Activity schemas/types, no new dependency.
- **GOTCHA**:
  - The hosted model must not trust `activityAttemptId` as authority; resolve it under authenticated user ownership.
  - A teacher active session must not accidentally attach a participant Attempt.
  - Current-screen Activity gets one initial observation only for Help/Check/work requests that need visible context; no background observation loop.
- **VALIDATE**:
  - Local and hosted parity tests: same Activity title, instructions, policy, criteria, current directive, and tool visibility.
  - Cross-user Attempt ID rejected without enumeration.
  - Normal task snapshot/tool list unchanged when no joined session exists.

### Task 6: Implement Help, Check, Ready, Submit, and teacher review transitions

- **ACTION**: Separate support, advisory checking, student readiness, explicit upload, and teacher completion.
- **IMPLEMENT**:
  - Help button first sends idempotent explicit Help, then starts a new `help` Work Session or steers the current Activity task. Resolve Help through a teacher endpoint; resolving moves a blocked Attempt back to `in_progress` when valid.
  - Check starts `activityIntent='check'` with a host-owned prompt that compares current work to published criteria and forbids changing/submitting work unless the student separately asks.
  - Activity knowledge remains available to Help/Check. Current-surface/workspace authority remains exactly the published launch target.
  - Add student **Ready for review**. Require a committed submission first when `requiresSubmission=true`; otherwise transition from `in_progress|blocked` to `ready_for_review`.
  - Keep the current reviewed-file picker and explicit submission commit. Submission may transition directly to `submitted`; it never happens from task completion.
  - Add teacher `complete|return` review with role checks, idempotency, transitions, content-free Run event, and safe response.
  - Default newly created classroom Activities to `requiresFacilitatorConfirmation=true`; do not change existing Activity versions.
  - Update `ActivityProgressReporter`: `blocked` task phase is not a failed Work Session; only terminal `failed` maps to failed. Include Work Session purpose and flush terminal updates.
- **MIRROR**: `commitSubmission`, `requestHelp`, `createWorkSession`, `assertTransition`.
- **IMPORTS**: Existing Activity client/service/repository types and random UUID.
- **GOTCHA**:
  - An AI Check is advisory and cannot mark criteria passed for grading or complete an Attempt.
  - Do not send task conversation/check prose to the teacher dashboard.
  - Return must preserve submission artifacts/evidence and permit a later new submission/check.
- **VALIDATE**:
  - Transition table tests for every current/next pair.
  - Submission-required readiness conflict, idempotent ready, complete, return, resolve Help.
  - Progress reporter fake-clock and terminal retry tests.

### Task 7: Build the teacher room, directive, dashboard, and review UI

- **ACTION**: Replace the current create-and-immediately-open Run form with the approved teacher flow.
- **IMPLEMENT**:
  - Teacher-only material Library and Activity editor. Participants must not see upload, folder snapshot, publish, Run, people-management, or dashboard controls.
  - Activity editor adds reviewed allowed origins and explains auto-open versus manual links.
  - Run target supports Room. Creating it enters a lobby and shows a rotatable/revocable code plus a QR generated locally from the same code (no external QR service).
  - Lobby roster uses joined participation and explicit status. Teacher clicks **Start class** to transition draft → open.
  - Directive composer accepts instruction, optional URL, and Activity criteria. Show a deterministic exact preview and server-returned delivery mode before Broadcast.
  - An optional model/tool `draft_session_directive` may populate this local form, but the Broadcast button remains user-only.
  - Dashboard lanes: lobby/not joined, working, needs Help, ready/submitted, completed, left/failed. Show explicit last event time, not behavioral inference.
  - Help queue gets **Resolve**. Ready/submitted queue gets **Complete** and **Return** with confirmation of the exact student/Attempt.
  - Preserve the existing delta poll and add an in-flight guard. Never render raw email, prompt, conversation, URL query, local path, screenshot, or submission filename.
  - Integrate rather than overwrite the other branch's teacher/student presentation logic.
- **MIRROR**: Current `SpaceDetailPage`, `FacilitatorRunPage`, `translate`, role check `canFacilitate`.
- **IMPORTS**: Shared session/directive/dashboard types, `randomUUID`, existing React hooks. Use an existing/approved local QR implementation only if already available; otherwise render code first and leave QR as a follow-up without adding a dependency silently.
- **GOTCHA**:
  - Do not create/open the Run in one click anymore; lobby must be visible before start.
  - Do not authorize from `canFacilitate`; it is presentation only.
  - Do not let model output call Broadcast directly.
- **VALIDATE**:
  - SSR tests for participant absence of teacher controls and teacher presence of lobby/broadcast/review.
  - Keyboard/focus/aria-live test for code rotation, preview, broadcast result, queues, and confirmation.

### Task 8: Build the student join, sticky session, Help, Check, and directive UI

- **ACTION**: Make the active class visible and usable from join through completion.
- **IMPLEMENT**:
  - Add room-code join entry to the signed-in student experience. On success, route to lobby/Attempt and activate the trusted main-process session.
  - Join disclosure states exactly what the session collects in this phase: join/start/help/check/submission/review lifecycle only; no continuous cursor/typing/screen monitoring.
  - Add safe-link consent with allowed-origin explanation and default off for existing users/sessions.
  - `ClassroomSessionBar` remains visible in Agent/Classwork views and shows class, Activity, lobby/live/ended, current instruction, Help, Check, Ready/Submit, and Leave.
  - Directive banner never steals focus repeatedly; it exposes instruction, site origin, Open, Dismiss, and automatic-open status.
  - Help immediately acknowledges the teacher queue and starts contextual assistance. Check asks “Is this right?” against the published criteria. Both inherit the active Attempt without requiring the student to reopen Assigned Activities.
  - Ready and Submit remain explicit. Show teacher-returned status and allow another Work Session.
  - Add `join_live_room` and `draft_session_directive` runtime tools only as convenience seams: join is normalized and executed through `ClassroomSessionService`; directive draft is effect-free and local. No agent tool may broadcast or auto-consent.
  - Add complete English/Vietnamese translations and non-color-only status labels.
- **MIRROR**: `AttemptLaunchPage` policy/submission UI, `LiveTaskRail`, `SettingsPage` SSR tests.
- **IMPORTS**: Shared contracts, view helpers, React hooks, translation helper.
- **GOTCHA**:
  - Leaving a live session clears inheritance immediately but does not delete the Attempt.
  - Student UI must not expose all Space sources/groups; use only assigned Activity projection.
  - A link opened automatically still needs a visible, dismissible record so the student understands what happened.
- **VALIDATE**:
  - Join invalid/expired/offline states, lobby-to-live transition, auto/manual link, Help/Check, Ready/Submit, returned work, leave.
  - Verify ordinary Tro request after Leave has `activityAttemptId:null`.

### Task 9: Security, load, documentation, and release gates

- **ACTION**: Prove the flow works at classroom scale without adding observation or weakening trust boundaries.
- **IMPLEMENT**:
  - Add cross-Space/cross-Run/cross-Attempt authorization matrices for every route.
  - Add 200-student concurrent join plus dashboard/directive delta fixture; verify indexes with `EXPLAIN` in disposable PostgreSQL.
  - Test room-code brute-force rate limit, expiry, rotation, revoke, and no code logging.
  - Test directive replay, duplicate claim, private/local/credential URLs, disallowed origin, redirect-independent safety (Tro opens but does not fetch), consent revoke, Run close race, and app restart.
  - Test hosted Activity context isolation and that non-Activity tasks have no knowledge tools.
  - Update README, architecture, Knowledge Spaces, and security docs with the exact flow and deferred-observation boundary.
  - Roll out behind existing Knowledge Spaces capability: backend/migration first, desktop parsing second, teacher UI third, student auto-open last. Auto-open remains default off until a small pilot.
  - Do not modify Rust/Bazel targets; `npm run bazel:check` is not required unless implementation unexpectedly touches Rust/Cargo/Bazel.
- **MIRROR**: Current Knowledge Spaces rollout/rollback docs and package verification.
- **IMPORTS**: None beyond test fixtures.
- **GOTCHA**:
  - Migration rollback is feature-flag disable, not destructive table drop.
  - Do not include the user's pre-existing `package-lock.json` changes in this work.
  - Metrics/logs are counts, duration, fixed type/code, and IDs only.
- **VALIDATE**:
  - Focused suites, full `npm run check`, `npm run package`, and two-account packaged smoke.

---

## Testing Strategy

### Unit and Integration Matrix

| Test | Input | Expected Output | Edge/Security? |
|---|---|---|---|
| Room target | Live Run with `target.kind=room` | Draft Run, zero assignments | No |
| Unauthorized code create | Participant calls teacher route | 403 safe error | Security |
| Room code retry | Same authenticated user joins twice | Same Attempt, one participation | Concurrency |
| Expired/revoked room | Valid-format old code | Generic invalid/expired result, no membership | Security |
| Stronger role join | Facilitator joins student room | Role remains facilitator | Security |
| Concurrent room join | 200 users + duplicate retries | One assignment/Attempt/user | Load |
| Start gate | Student creates Work Session in draft lobby | `run_not_open` | Lifecycle |
| Late join | Student joins open Run | Own Attempt and live session | Recovery |
| Closed join | Student joins closed Run | Denied | Lifecycle |
| Directive idempotency | Same Run/clientId twice | One directive/same response | Concurrency |
| Criterion validation | Foreign criterion ID | Denied | Security |
| URL public policy | `http`, localhost, private IP, credentials | Denied/manual as defined | Security |
| Allowed origin | Public HTTPS matching pinned origin | `auto_eligible` | No |
| Unlisted origin | Public HTTPS not pinned | `manual_only` | Security |
| Directive isolation | Student reads another Attempt | 404/403 without enumeration | Security |
| Claim race | Two clients claim same directive/user | One `execute:true` | Concurrency |
| Consent off | Auto-eligible directive | Banner only; no open call | Privacy |
| Consent on | Auto-eligible directive | Claim then one open call | No |
| Unknown open result | Adapter throws after claim | No automatic retry | Recovery |
| Stale poll | Old response after session switch | Discarded | Concurrency |
| Sticky task | Joined student sends normal cursor request | Trusted Attempt inherited | No |
| Explicit override | Assigned page passes owned Attempt | Explicit owned Attempt used | No |
| Cross-user task | Foreign Attempt ID | Rejected before task start | Security |
| Hosted context | Activity task hosted | Immutable Activity/current directive available | No |
| Normal task parity | No active session | No Activity context/tools | Regression |
| Help | Student clicks Help twice | One open Help request; contextual task | Idempotency |
| Resolve Help | Teacher resolves | Help closed; valid state resumes | Lifecycle |
| Check | Student clicks Check | Check Work Session/advisory response | No grade |
| Ready requires files | Submission-required, no committed files | 409 `submission_required` | Yes |
| Explicit submit | Reviewed files committed | Attempt submitted, one event | No |
| Teacher complete | Ready/submitted Attempt | Completed | Authorization |
| Teacher return | Ready/submitted Attempt | In progress, prior evidence retained | Lifecycle |
| Role UI | Participant Space | No upload/publish/run/dashboard controls | Security UX |
| Disclosure | Join view | Explicit no-continuous-observation text | Privacy UX |

### Edge Cases Checklist

- [ ] Empty/whitespace room code, instruction, or URL
- [ ] Maximum instruction, criteria, origin, participant, and directive page sizes
- [ ] Duplicate client UUID with different payload
- [ ] Run closes between validation and insert/claim
- [ ] Room code rotates while a join is in flight
- [ ] User removed from Space after joining
- [ ] User joins on two devices, then leaves one device
- [ ] Teacher closes app while students remain joined
- [ ] Student app restarts in lobby/live/closed states
- [ ] Directive poll timeout and offline backoff
- [ ] Multiple directives arrive in one page and sequence order is preserved
- [ ] Automatic link consent revoked before claim completes
- [ ] Bad URL injected through renderer/preload event
- [ ] Activity edited after publish; Run remains pinned to old Version/policy
- [ ] Submission completes while teacher review is in flight
- [ ] Teacher returns an already completed Attempt
- [ ] Help requested before any Work Session
- [ ] Check on `none`, `workspace`, and `current_surface` Activity launch targets
- [ ] OS browser open unavailable or returns error
- [ ] Knowledge Spaces flag disabled
- [ ] Sign-out during poll/task/open

---

## Validation Commands

### Focused hosted domain tests

```bash
node --test \
  services/api/test/knowledge-space-domain.test.mjs \
  services/api/test/live-classroom-service.test.mjs \
  services/api/test/agent-run-service.test.mjs \
  services/api/test/migrate.test.mjs
```

EXPECT: All room, directive, lifecycle, role, hosted Activity, and migration tests pass.

### Focused desktop and renderer tests

```bash
npx vitest run \
  src/shared/contracts.test.ts \
  src/main/application/task-application-service.test.ts \
  src/main/knowledge/activity-progress-reporter.test.ts \
  src/main/knowledge/classroom-session-service.test.ts \
  src/main/knowledge/classroom-directive-service.test.ts \
  src/main/ipc/register-ipc.test.ts \
  src/main/agent/runtime-tool-registry.test.ts \
  src/main/agent/policy.test.ts \
  src/renderer/classroom-session-view.test.ts \
  src/renderer/ClassroomSessionBar.test.tsx \
  src/renderer/app-language.test.ts
```

EXPECT: Zero failures; no ordinary-task regression.

### PostgreSQL integration and load

```bash
TEST_DATABASE_URL='<disposable-postgres-url>' \
  node --test services/api/test/integration/knowledge-postgres.test.mjs
```

EXPECT: Migrations, 200-student join, sequence polling, claims, review, isolation, and index assertions pass.

### Static analysis and full tests

```bash
npm run check
```

EXPECT: Runtime-version check, ESLint, TypeScript, Vitest, Node tests, and API tests all pass.

### Dependency security

```bash
npm audit
npm --prefix services/api audit
```

EXPECT: No newly introduced high/critical vulnerability. This plan should add no dependency.

### Package validation

```bash
npm run package
```

EXPECT: Electron package completes with sandboxed renderer, narrow preload, and no missing module.

### Manual two-account validation

- [ ] Teacher creates a Space, uploads instructions/rubric/starter, publishes a classroom Activity with one allowed origin.
- [ ] Teacher creates a room Run; student cannot see teacher upload/publish controls.
- [ ] Student joins by code with auto-open off and waits in lobby.
- [ ] Teacher sees joined roster and starts class; student transitions to live without restart.
- [ ] Teacher previews/broadcasts exercise directive; student sees it.
- [ ] Teacher broadcasts allowed link; consent-off student gets Open button.
- [ ] Student rejoins with consent on; next allowed link opens once and shows visible record.
- [ ] Unlisted but public link remains manual; private/credential link is rejected.
- [ ] Student uses Help and teacher sees only explicit Help/status, not screen/conversation.
- [ ] Student uses Check, marks Ready or explicitly submits reviewed files.
- [ ] Teacher completes one Attempt and returns another.
- [ ] Student leaves; subsequent normal cursor request has no class Activity context.
- [ ] Teacher closes Run; new Work Sessions/directives fail safely.
- [ ] Sign out/in and app restart do not replay an automatically handled link.

---

## Acceptance Criteria

- [ ] Teacher material/upload/publish controls are visible only to owner/facilitator UI and enforced by hosted API.
- [ ] A live/hybrid Run can be created as a room lobby with zero initial assignments.
- [ ] Teacher can create, rotate, copy/show, and revoke a short-lived room code without plaintext persistence or logging.
- [ ] A signed-in student can join/rejoin by room code; exactly one assignment, Attempt, and active participation are created per Run/user.
- [ ] Joining never downgrades an existing owner/facilitator role.
- [ ] Teacher starts class explicitly; students cannot start Work Sessions while the Run is draft.
- [ ] Joined session context is visible, sticky across cursor requests, and cleared on leave/end/sign-out.
- [ ] Hosted and local Activity tasks receive the same immutable Activity definition, current directive, source catalog, and policy.
- [ ] Normal non-class tasks receive no Activity context or Activity tools.
- [ ] Teacher can preview and explicitly broadcast bounded `exercise` and `open_url` directives only while authorized and Run is open.
- [ ] The model may draft but cannot broadcast a directive.
- [ ] Students receive ordered directives only for their own Attempt/Run.
- [ ] Automatic URL opening requires public HTTPS, pinned allowed origin, current local consent, and a successful at-most-once claim.
- [ ] Non-eligible links are manual; invalid/private/credential links are rejected.
- [ ] Help creates an explicit queue item and contextual Help Work Session; it does not start continuous observation.
- [ ] Check is advisory, uses published criteria/context, and cannot grade or submit automatically.
- [ ] Ready, Submit, Complete, and Return are separate idempotent transitions with correct role/ownership checks.
- [ ] File submission always uses reviewed exact files and an explicit student action.
- [ ] Teacher dashboard shows only explicit lifecycle/evidence/help/review facts and no screen, cursor, typing, prompt, conversation, unrelated file, or inferred mental state.
- [ ] English and Vietnamese critical flow copy, keyboard/focus behavior, aria-live announcements, reduced motion, and non-color status cues are covered.
- [ ] Concurrent join/directive/claim/review and cross-tenant isolation tests pass.
- [ ] `npm run check` and `npm run package` pass.

## Completion Checklist

- [ ] Code follows schema-first naming and strict boundary parsing.
- [ ] Every hosted mutation authorizes by authenticated Space/Attempt ownership.
- [ ] Idempotency keys and transactions cover all retryable mutations.
- [ ] Public errors have stable codes and bounded safe text.
- [ ] No raw room code, instruction, URL query, student content, or local data enters logs/analytics.
- [ ] Existing group/participant Run targeting still works.
- [ ] Existing Activity versions and non-class tasks remain compatible.
- [ ] Separate role-branch changes are merged intentionally rather than overwritten.
- [ ] No new dependency or hidden generic IPC/tool surface was introduced.
- [ ] Documentation matches actual shipped behavior and deferred scope.
- [ ] The implementation can be completed from this plan without an architectural search.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Room join races create duplicate Attempts | Medium | High | Transaction, advisory/row locks, unique constraints, concurrency fixture |
| Room code brute force or leakage | Medium | High | Entropy, HMAC digest, short expiry, rotate/revoke, per-IP/user rate limit, no logging |
| Role branch conflicts with Space UI files | High | Medium | Merge/rebase role branch first; retain per-Space server authority; isolate pure view helpers |
| Hosted agent still loses Activity context | Medium | High | Server-resolve Attempt and fill v8 contract; local/hosted parity tests before Help UI |
| Teacher directive becomes remote-control feature | Medium | High | Two fixed types, explicit preview/broadcast, consent, public URL/origin rules, no arbitrary typing/CUA |
| Duplicate navigation after reconnect | Medium | Medium | Server claim before open, local sequence dedupe, no retry after unknown outcome |
| Polling load with 200 students | Medium | Medium | Indexed `(run_id,sequence)`, capped deltas, 3–5s jitter, one in-flight request, load fixture; consider SSE/NOTIFY only after measurement |
| Activity allowed-origin policy is too rigid during class | Medium | Medium | Unlisted public links still deliver manual-only; teacher can publish future Activity versions |
| AI Check is mistaken for a grade | High | Medium | Advisory labeling, explicit Ready/teacher review, no numeric score or automatic completion |
| Dashboard drifts into surveillance | High | High | Explicit event allowlist and no-observation acceptance tests; defer telemetry to separate PRP |
| Existing dirty lockfile is accidentally included | Medium | Low | Do not touch/revert `package-lock.json`; review `git diff --name-only` before commit |

## Rollout and Rollback

1. Apply additive migration 018 with `TROCODE_KNOWLEDGE_SPACES_ENABLED=false`.
2. Deploy backend routes/contracts; old clients ignore them and existing Runs remain unchanged.
3. Ship desktop parsing/session services with room UI hidden behind existing capability.
4. Enable teacher lobby/directive UI for internal two-account tests.
5. Enable student join with auto-open default off.
6. Pilot one small class; monitor only fixed counts/codes/latencies (join failures, directive delivery, claim duplicates, review conflicts).
7. Enable auto-open consent option after pilot validation.

Rollback by disabling `TROCODE_KNOWLEDGE_SPACES_ENABLED` and stopping the UI flow. Keep additive tables/data in place; do not destructively roll back published Runs, Attempts, submissions, or directives.

## Notes

- The primary customer pain addressed is teacher time lost walking between computers to give links, diagnose explicit Help requests, and confirm completion.
- This phase deliberately does not solve passive “who is stuck?” detection. It creates the room/session/event foundation that a later privacy-reviewed observer can feed without redesigning authorization or lifecycle.
- Direct browser navigation is the correct delivery primitive for a teacher link. Computer use should inspect/recover student work only after Help/Check or another explicit approved action.
- The current repository already contains most of the product foundation. Implementation should prefer extending it over introducing “classroom” duplicates of Space, Activity, Run, Attempt, source, evidence, or dashboard concepts.

---

## Next Step

Implement in task order. Tasks 1–3 establish hosted authority and durable room/directive state; Tasks 4–5 bind trusted desktop/session/agent behavior; Task 6 establishes Help/Check/review semantics; Tasks 7–8 add role-scoped UX; Task 9 is the release gate.

Run:

```text
/prp-implement .claude/PRPs/plans/live-classroom-room-flow.plan.md
```
