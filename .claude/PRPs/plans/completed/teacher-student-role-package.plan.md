# Plan: Teacher, Student, and Class Workspace Package

> Status: Implemented with the user-approved Admin-assigned role and bulk-membership scope refinement. See `../../reports/teacher-student-role-package-report.md`.

## Summary

Present TroCode's existing per-Space membership roles as a focused classroom package: `owner` becomes **Teacher · Owner**, `facilitator` becomes **Teacher**, and `participant` becomes **Student**. Add a lightweight **Class workspace** that detects the user's existing classes, groups them by Teaching or Learning, makes the current class/role obvious, and lets the user switch classes quickly. Make the current server permission matrix precise, close permission leaks, and ensure the renderer only shows and requests features allowed for the signed-in user's role.

This plan does not redesign computer control, task execution, Activity lifecycle, Run activation, Work Sessions, student progress, dashboards, evidence, or submission. Those systems already exist on this branch and remain unchanged.

## User Story

As a teacher, I want TroCode to recognize that I can prepare and operate a class, manage the appropriate people, and switch between my classes easily, so that I see the correct teacher workspace without gaining arbitrary access to student computers.

As a student, I want TroCode to show which class workspace I am in, let me switch classes, and show only my assigned classwork and own actions, so that class administration and other students' information remain unavailable.

## Problem → Solution

TroCode already stores `owner | facilitator | participant` on each Knowledge Space and has a fail-closed server operation map, but the UI still exposes neutral role names, loads teacher-only data for participants, treats owner and facilitator permissions too loosely, and lacks a clear way to tell which class is active or switch between classes. → Keep the database and existing roles, project existing Spaces into a renderer-only Class workspace, add a classroom presentation/affordance mapping, tighten server read/invite operations, expose a bounded teacher-only roster, and render separate Teacher and Student experiences.

## Metadata

- **Complexity**: Medium
- **Source PRD**: N/A — narrowed from the 2026-08-24 discovery notes and the user's scope correction on 2026-08-25
- **PRD Phase**: N/A
- **Estimated Files**: 30 files
- **Tasks**: 6
- **Confidence**: 9/10
- **Database Migration**: None
- **New Dependencies**: None
- **External Research**: None needed; this uses the branch's existing Space roles, Zod contracts, HTTP policy, narrow IPC, React, and test patterns

---

## Scope Decisions

### Roles are contextual, not global account types

A person may teach in one Space and be a student in another. Do not add a global `user.role`, duplicate identity provider claims, or a new classroom-role table.

| Stored Space role | Classroom label | Meaning |
|---|---|---|
| `owner` | Teacher · Owner | Created/owns the class; may invite other teachers and students |
| `facilitator` | Teacher | Teaches and operates the class; may invite students but not create other teachers |
| `participant` | Student | Uses assigned classwork and only their own Attempt actions |

### Teacher access is classroom access

“Teacher has more capability” means more Knowledge Space product permissions. It does not mean remote desktop access, student-screen access, arbitrary CUA commands, transcript access, or permission to bypass existing confirmations.

### The server remains authoritative

Renderer affordances improve clarity and avoid unnecessary denied requests, but they are not security controls. Every protected endpoint must still resolve the authenticated user's Space membership and call the canonical server policy before repository access.

### Existing session behavior stays as-is

The current Activity/Run code may continue to create/open Runs exactly as it does today. This plan does not add a session-start trigger, change Run states, synchronize active-session state, or alter how task/session data reaches a facilitator.

### Class workspace is navigation, not a new backend object

The Class workspace is a renderer projection over the existing `listKnowledgeSpaces()` response:

- **Teaching**: Spaces where the current user is `owner` or `facilitator`.
- **Learning**: Spaces where the current user is `participant`.
- **Current class**: the Space selected in the Class workspace shell for the current renderer navigation state.

Do not add a database table, API resource, membership layer, or persisted active-session state. Do not reuse the existing `WorkspaceSelection`, `executionProfile: 'workspace'`, or trusted-folder APIs. In UI copy, use **Class workspace**; reserve capitalized **Workspace** for TroCode's existing trusted local-folder execution concept.

---

## Exact Permission Matrix

The operation identifiers below remain canonical in `services/api/src/knowledge-space-policy.mjs`.

| Capability | Teacher · Owner (`owner`) | Teacher (`facilitator`) | Student (`participant`) |
|---|---:|---:|---:|
| Open class summary (`space.read`) | Yes | Yes | Yes |
| Update/delete class (`space.update`, `space.delete`) | Reserved owner authority; no new UI in this plan | No | No |
| View class roster (`member.read`) | Yes | Yes | No |
| Invite a student (`invite.participant`) | Yes | Yes | No |
| Invite another teacher (`member.manage`) | Yes | No | No |
| Create/list groups (`group.manage`) | Yes | Yes | No |
| View full teacher library (`source.read`) | Yes | Yes | No |
| Upload library sources (`source.upload`) | Yes | Yes | No |
| Delete library sources (`source.delete`) | Reserved owner authority; no new UI in this plan | No | No |
| Read/write/publish Activities | Yes | Yes | Assigned read only |
| Manage existing Run controls (`run.manage`) | Yes | Yes | No |
| Read all Attempts/dashboard (`attempt.read_all`, `insight.read`) | Yes | Yes | No |
| Resolve help (`help.resolve`) | Yes | Yes | No |
| Read pinned assigned sources (`source.read_pinned`) | Through teacher library | Through teacher library | Yes, only through assigned Activity context |
| Read assigned Activity (`activity.read_assigned`) | Through authoring view | Through authoring view | Yes |
| Start/read/help/submit own Attempt | May also be a participant in another Space | May also be a participant in another Space | Yes |

Implementation-specific additions are limited to `member.read` and `invite.participant`. They separate safe teacher operations from owner-only `member.manage`.

### Invite rules

- `owner` may create `facilitator` or `participant` invites.
- `facilitator` may create only `participant` invites.
- `participant` may not create any invite.
- Invite redemption keeps its current behavior and assigns the role pinned into the invite.
- This plan does not add role mutation, promotion, removal, or invite revocation UI.

---

## UX Design

### Before

```text
Space card: owner / facilitator / participant

No persistent class context or quick switcher; the user returns to the full
Spaces page to work out which class they are opening.

Every role opens the same three tabs:
Library | Activities | People

Participant render can request source/group lists and then rely on API errors.
Facilitator sees “create join code,” but the current server requires owner-only
member.manage, so the UI and policy disagree.
```

### After

```text
Class workspace
┌────────────────────────────────────────────────────┐
│ Current: Python Foundations · Teacher              │
│ Switch class: [ Teaching ▾ ]                       │
│                                                    │
│ Teaching                  Learning                  │
│ • Python Foundations     • Design Workshop         │
│ • Robotics Lab                                      │
└────────────────────────────────────────────────────┘

Teacher · Owner                         Teacher
┌──────────────────────────┐           ┌──────────────────────────┐
│ Library                  │           │ Library                  │
│ Activities               │           │ Activities               │
│ People & groups          │           │ People & groups          │
│ Invite teacher/student   │           │ Invite student only      │
└──────────────────────────┘           └──────────────────────────┘

Student
┌──────────────────────────┐
│ Class summary            │
│ Go to my classwork       │
│ No library/admin/roster  │
└──────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After |
|---|---|---|
| Class detection | Flat Space list | Existing memberships grouped into Teaching and Learning |
| Current class | Implied by the open page | Persistent Class workspace header with class name and role badge while navigating classroom views |
| Class switching | Back to Spaces, inspect cards, reopen | Accessible switcher available from the Class workspace shell |
| Space card/header | Canonical role string | Teacher · Owner, Teacher, or Student badge |
| Participant Space open | Teacher tabs render; denied calls may occur | Student summary with **Open my classwork** only |
| Teacher Space open | One broad `canFacilitate` boolean | Explicit affordances from exact stored role |
| People tab | Groups and participant invite button; no roster | Bounded roster with Teacher/Student labels and role-appropriate invite choice |
| Library | Upload controls rendered by shared page | Rendered only inside Teacher experience |
| Assigned view | “Assigned Activities” and facilitator wording | “My classwork” and teacher wording |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `services/api/src/knowledge-space-policy.mjs` | 1-29 | Canonical fail-closed role-operation map |
| P0 | `services/api/src/knowledge-space-service.mjs` | 21-55 | Current authorization-before-repository behavior and overly broad read checks |
| P0 | `services/api/src/knowledge-space-repository.mjs` | 103-150 | Current group/member queries and invite idempotency |
| P0 | `services/api/src/knowledge-space-http-controller.mjs` | 58-95 | Existing Space/source/group/member/invite routes; no new route is required |
| P0 | `src/shared/contracts.ts` | 1107-1166 | Existing Space roles, invite roles, and missing member response schema |
| P0 | `src/renderer/SpaceDetailPage.tsx` | all | Current broad `canFacilitate`, unconditional loads, and mixed role UI |
| P0 | `src/renderer/SpaceLibrary.tsx` | all | Upload surface that must remain teacher-only |
| P0 | `src/renderer/KnowledgeHubPage.tsx` | all | Current local Space selection and correct owner for the new Class workspace shell |
| P1 | `src/shared/desktop-api.ts` | 122-189 | Narrow Knowledge IPC/API surface |
| P1 | `src/main/knowledge/knowledge-space-client.ts` | 63-78, 105-118 | Hosted response parsing pattern |
| P1 | `src/preload.ts` | 191-225 | Knowledge bridge request/response parsing |
| P1 | `src/main/ipc/register-ipc.ts` | 348-405 | Membership-authorized Knowledge handlers |
| P1 | `src/renderer/SpacesPage.tsx` | all | Space role badge and open flow |
| P1 | `src/renderer/AssignedActivitiesPage.tsx` | all | Student classwork presentation |
| P1 | `src/renderer/app-navigation.ts` | all | Existing view discrimination; do not create a parallel global router |
| P2 | `services/api/test/knowledge-space-domain.test.mjs` | 1-25 | Pure Node policy test style |
| P2 | `src/renderer/SettingsPage.test.ts` | 1-20, 90-115 | Existing renderer SSR test style |
| P2 | `src/renderer/app-language.test.ts` | all | Translation coverage pattern |

## External Documentation

No external research needed — no new library, protocol, identity provider, or authorization framework is introduced.

---

## Patterns to Mirror

### FAIL_CLOSED_ROLE_POLICY

// SOURCE: `services/api/src/knowledge-space-policy.mjs:18-28`

```js
export function canSpaceRole(role, operation) {
  return Boolean(OPERATIONS[role]?.has(operation));
}

export function assertSpaceRole(role, operation) {
  if (!canSpaceRole(role, operation)) {
    const error = new Error('This Space operation is not available.');
    error.status = 403;
    error.code = 'space_forbidden';
    throw error;
  }
}
```

Unknown roles and unknown operations remain denied. Classroom labels never enter this function.

### SERVICE_AUTHORIZATION_BEFORE_REPOSITORY

// SOURCE: `services/api/src/knowledge-space-service.mjs:21-28`

```js
async role(userId, spaceId, operation) {
  const role = await this.spaceRepository.membership(spaceId, userId);
  if (!role) {
    const error = new Error('Space not found.');
    error.status = 404;
    error.code = 'space_not_found';
    throw error;
  }
  assertSpaceRole(role, operation);
  return role;
}

async initiateUpload(userId, spaceId, input, limits = null) {
  await this.role(userId, spaceId, 'source.upload');
  // repository work follows
}
```

### BOUNDED_SHARED_SCHEMA

// SOURCE: `src/shared/contracts.ts:1107-1115`

```ts
export const KnowledgeSpaceSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
  description: z.string().max(4_000),
  purposeLabel: z.string().max(120).nullable(),
  role: z.enum(['owner', 'facilitator', 'participant']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

Add a bounded `KnowledgeSpaceMemberSchema` and list schema beside other Knowledge contracts. Return `userId`, nullable bounded `name`, stored role, and `joinedAt`; do not return email.

### NARROW_DESKTOP_BRIDGE

// SOURCE: `src/main/ipc/register-ipc.ts:353-372`

```ts
ipcMain.handle(IPC_CHANNELS.listKnowledgeSpaces, async (event) => {
  await assertMembershipAuthorizedSender(event, mainWindow, services);
  return services.knowledgeSpaceClient.listSpaces();
});

ipcMain.handle(IPC_CHANNELS.listKnowledgeSources, async (event, input: unknown) => {
  await assertMembershipAuthorizedSender(event, mainWindow, services);
  const request = KnowledgeSpaceIdRequestSchema.parse(input);
  return services.knowledgeSpaceClient.listSources(request.spaceId);
});
```

Add only `listKnowledgeMembers(spaceId)`. Do not expose a generic membership API.

### PURE_RENDERER_PRESENTATION

// SOURCE: `src/renderer/SpaceDetailPage.tsx:20-23`

```ts
const canFacilitate = space.role === 'owner' || space.role === 'facilitator';
```

Replace this broad boolean with a pure, exhaustively tested presentation object derived only from the canonical stored role. The object controls visible affordances but is never sent back as authorization evidence.

### TEST_PATTERNS

// SOURCE: `services/api/test/knowledge-space-domain.test.mjs:18-24`

```js
test('role operations and lifecycle transitions fail closed', () => {
  assert.equal(canSpaceRole('owner', 'member.manage'), true);
  assert.equal(canSpaceRole('facilitator', 'space.delete'), false);
  assert.equal(canSpaceRole('participant', 'activity.publish'), false);
});
```

Use `node:test`/`assert/strict` for server policy and Vitest plus `react-dom/server` for renderer role states.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `services/api/src/knowledge-space-policy.mjs` | UPDATE | Add `member.read` and `invite.participant` to the exact roles |
| `services/api/src/knowledge-space-service.mjs` | UPDATE | Tighten source/group/member reads and distinguish student-vs-teacher invite authority |
| `services/api/src/knowledge-space-repository.mjs` | UPDATE | Join bounded user display names for the teacher roster; never return email |
| `services/api/test/knowledge-space-domain.test.mjs` | UPDATE | Exhaustive permission-matrix tests |
| `services/api/test/server.test.mjs` | UPDATE | Route-level owner/teacher/student allow/deny tests |
| `services/api/test/integration/knowledge-postgres.test.mjs` | UPDATE | Cross-Space roster/library/group isolation and invite-role tests |
| `src/shared/contracts.ts` | UPDATE | Add bounded member/list response schemas and types |
| `src/shared/contracts.test.ts` | UPDATE | Member bounds and role validation tests |
| `src/shared/desktop-api.ts` | UPDATE | Add one narrow `listKnowledgeMembers` channel/method |
| `src/main/knowledge/knowledge-space-client.ts` | UPDATE | Parse the existing members endpoint into the new list schema |
| `src/preload.ts` | UPDATE | Validate list-members request and response |
| `src/main/ipc/register-ipc.ts` | UPDATE | Add membership-authorized list-members handler |
| `src/renderer/classroom-role.ts` | CREATE | Pure canonical-role-to-classroom-presentation/affordance mapping |
| `src/renderer/classroom-role.test.ts` | CREATE | Exhaustive role labels and affordance tests |
| `src/renderer/class-workspace.ts` | CREATE | Pure Teaching/Learning grouping, deterministic ordering, and active-class selection helpers |
| `src/renderer/class-workspace.test.ts` | CREATE | Mixed-role, empty, ordering, and active-selection tests |
| `src/renderer/ClassWorkspaceSwitcher.tsx` | CREATE | Accessible current-class indicator and fast class switcher |
| `src/renderer/ClassWorkspaceSwitcher.test.tsx` | CREATE | SSR markup tests for single, multiple, mixed-role, and empty states |
| `src/renderer/SpacesPage.tsx` | UPDATE | Render classroom role badges and classroom copy |
| `src/renderer/SpaceDetailPage.tsx` | UPDATE | Split Teacher and Student experiences and avoid unauthorized data loads |
| `src/renderer/SpaceDetailPage.test.tsx` | CREATE | SSR assertions for each stored role and hidden teacher controls |
| `src/renderer/SpaceLibrary.tsx` | UPDATE | Keep upload UI inside the Teacher surface and accept explicit presentation props if needed |
| `src/renderer/AssignedActivitiesPage.tsx` | UPDATE | Use My classwork/teacher wording |
| `src/renderer/KnowledgeHubPage.tsx` | UPDATE | Own the Class workspace shell/current Space, switch classes, and route Student CTA to existing Assigned behavior |
| `src/renderer/app-language.ts` | UPDATE | English/Vietnamese Teacher, Student, Class workspace, switcher, roster, invite, and classwork strings |
| `src/renderer/app-language.test.ts` | UPDATE | Translation key coverage |
| `src/index.css` | UPDATE | Accessible role badges, Class workspace switcher, roster, and responsive Teacher/Student layouts |
| `README.md` | UPDATE | Document the role/Class workspace package and its boundary |
| `docs/knowledge-spaces.md` | UPDATE | Document Class workspace projection, canonical-to-classroom role mapping, and exact permissions |
| `docs/security.md` | UPDATE | Document per-Space authority and no remote-control implication |

## NOT Building

- No database migration or new role table.
- No backend Class workspace resource, workspace membership, active-class API, or persisted current-class state.
- No reuse or modification of the trusted local-folder `WorkspaceSelection`/Workspace execution feature.
- No global Teacher/Student account role.
- No computer-control, CUA, tool-registry, agent-policy, hosted-runtime, or task-contract change.
- No Run/session start trigger or Run lifecycle change.
- No Work Session, Attempt state, completion, grading, or submission change.
- No new teacher dashboard, progress telemetry, stuck detection, student insights, or data-delivery pipeline.
- No screen, conversation, browser history, local file, or live activity stream sent to a teacher.
- No role promotion/removal, ownership transfer, invite revocation, or account administration UI.
- No parent role, parent portal, leaderboard, cursor customization, or minigames.
- No changes to the existing behavior that limits student task/control capabilities; this role package only supplies membership identity and product permissions.

---

## Step-by-Step Tasks

### Task 1: Make the server permission matrix explicit

- **ACTION**: Refine existing per-Space operations without changing stored roles.
- **IMPLEMENT**:
  - Add `member.read` to `owner` and `facilitator` only.
  - Add `invite.participant` to `owner` and `facilitator` only.
  - Keep `member.manage` owner-only; use it for `facilitator` invites.
  - Keep every participant operation unchanged.
  - Change `listSources` from `space.read` to `source.read` so Students cannot list the teacher library.
  - Change `listGroups` from `space.read` to `group.manage` so Students cannot enumerate class groups.
  - Change `listMembers` from `member.manage` to `member.read` so both Teacher roles can see the roster.
  - In `createInvite`, require `invite.participant` when `input.role === 'participant'`; otherwise require owner-only `member.manage`.
- **MIRROR**: `FAIL_CLOSED_ROLE_POLICY` and `SERVICE_AUTHORIZATION_BEFORE_REPOSITORY`.
- **IMPORTS**: Existing `assertSpaceRole`; no new dependencies.
- **GOTCHA**: Never infer permission from classroom labels or a renderer-provided role. Resolve membership for the authenticated user on every operation.
- **VALIDATE**: `node --test services/api/test/knowledge-space-domain.test.mjs services/api/test/server.test.mjs`

### Task 2: Expose a bounded teacher-only roster

- **ACTION**: Use the existing members endpoint through the narrow desktop bridge.
- **IMPLEMENT**:
  - Update `listMembers` repository query to join `users` and return `userId`, nullable bounded `name`, stored role, and `joinedAt`; omit email and all activity/progress fields.
  - Add `KnowledgeSpaceMemberSchema` and `KnowledgeSpaceMemberListSchema` in shared contracts.
  - Add `listKnowledgeMembers` to `IPC_CHANNELS`, `DesktopApi`, `KnowledgeSpaceClient`, preload, and IPC registration.
  - Parse the response at the hosted client and preload boundaries.
  - Reuse the existing `GET /v1/spaces/:spaceId/members`; do not add a controller route or new endpoint.
- **MIRROR**: `BOUNDED_SHARED_SCHEMA` and `NARROW_DESKTOP_BRIDGE`.
- **IMPORTS**: New member schemas/types from `src/shared/contracts.ts`; existing `KnowledgeSpaceIdRequestSchema`.
- **GOTCHA**: Roster membership is the only new teacher-visible data. Do not join Attempt, task, session, dashboard, email, screen, conversation, or file data.
- **VALIDATE**: `npx vitest run src/shared/contracts.test.ts` and the configured PostgreSQL integration suite.

### Task 3: Add a pure classroom role presentation model

- **ACTION**: Centralize labels and visible affordances without duplicating server authorization.
- **IMPLEMENT**:
  - Create `src/renderer/classroom-role.ts` with an exhaustive switch over `owner | facilitator | participant`.
  - Return label key and UI booleans: `isTeacher`, `canViewTeacherWorkspace`, `canViewRoster`, `canInviteStudents`, `canInviteTeachers`, and `canOpenOwnClasswork`.
  - Map `owner → Teacher · Owner`, `facilitator → Teacher`, `participant → Student`.
  - Do not return server operation names, manufacture tokens, or send this object through IPC.
  - Exhaustively test all three roles and a compile-time `never` guard.
- **MIRROR**: `PURE_RENDERER_PRESENTATION` and existing pure renderer helper tests.
- **IMPORTS**: `KnowledgeSpaceSummary` type only.
- **GOTCHA**: UI booleans prevent confusing affordances; they never replace backend checks.
- **VALIDATE**: `npx vitest run src/renderer/classroom-role.test.ts`

### Task 4: Add the Class workspace shell and switcher

- **ACTION**: Make existing class memberships easy to detect, distinguish, and switch without creating a new backend domain object.
- **IMPLEMENT**:
  - Create `src/renderer/class-workspace.ts` with pure helpers that split `KnowledgeSpaceSummary[]` into `teaching` (`owner|facilitator`) and `learning` (`participant`) groups.
  - Sort each group deterministically by most recently updated, then class name and ID so refreshes do not shuffle equal items.
  - Represent current selection as an existing Space ID in `KnowledgeHubPage` renderer state. When that Space is removed from a refreshed list, clear selection and return to the Class workspace overview.
  - Lift the existing Space list load to `KnowledgeHubPage` so the overview, switcher, and details use one canonical renderer snapshot; make `SpacesPage` presentational or pass it the loaded list/reload callback.
  - Create `ClassWorkspaceSwitcher` showing current class name, classroom role badge, and grouped Teaching/Learning choices. With one class, show a clear current-class indicator without a redundant menu; with zero, show the existing create/join empty state.
  - Keep the switcher mounted across Space detail and class-scoped Assigned views. Switching class changes only renderer navigation and selected Space; it does not start/stop a Run, task, Attempt, Work Session, or computer-control session.
  - When a Student selects a Learning class, route **My classwork** to the existing Assigned list filtered client-side by `item.space.id`. When a Teacher selects a Teaching class, route **Manage class** to the existing Teacher Space detail.
  - Do not persist the selected Space to localStorage, app preferences, database, or API in this phase. Reopening the app starts at the Class workspace overview.
- **MIRROR**: Existing KnowledgeHubPage local selection, app-navigation discriminated views, SpacesPage loading/empty states, and SSR component test pattern.
- **IMPORTS**: `KnowledgeSpaceSummary`, existing React hooks, `classroomRoleFor`, and pure class-workspace helpers.
- **GOTCHA**: Use **Class workspace** in UI/code. Never import or alter `WorkspaceSelection`, trusted folder services, or `executionProfile: 'workspace'`. A class switch is navigation only.
- **VALIDATE**: `npx vitest run src/renderer/class-workspace.test.ts src/renderer/ClassWorkspaceSwitcher.test.tsx`

### Task 5: Split Teacher and Student Space experiences

- **ACTION**: Render and fetch only the surfaces appropriate to the current Space role.
- **IMPLEMENT**:
  - Update Space cards and headers to use classroom role labels.
  - Refactor `SpaceDetailPage` into small Teacher and Student subcomponents so hooks remain unconditional within each component.
  - Teacher component retains existing Library, Activities, Run controls, and People/groups behavior. Do not change Run creation/open/close code.
  - Student component renders class summary and an **Open my classwork** CTA. It must not call `listKnowledgeSources`, `listKnowledgeGroups`, `listKnowledgeMembers`, dashboard, or teacher mutation methods.
  - Teacher People tab loads the bounded roster and labels each member as Teacher · Owner, Teacher, or Student.
  - Teacher · Owner can choose an invite type of Student or Teacher. Teacher can create Student invites only; do not render a Teacher invite option for facilitators.
  - Keep SpaceLibrary/ActivityEditor/FacilitatorRunPage mounted only inside the Teacher component.
  - Update AssignedActivitiesPage to My classwork/teacher wording and accept an optional selected Space ID for client-side display filtering; do not change launch, Attempt, Work Session, help, or submission behavior.
  - Route the Student CTA through the Class workspace shell to the already existing Assigned view.
  - Add English/Vietnamese copy and accessible role badges, table headers, focus states, and responsive styling.
- **MIRROR**: Current SpacesPage/SpaceDetailPage component style, `SettingsPage.test.ts` SSR pattern, and `app-language.ts` key-based translation.
- **IMPORTS**: `classroomRoleFor`, Class workspace selection helpers, `KnowledgeSpaceMember` types, existing React hooks and `window.tro` methods.
- **GOTCHA**: Avoid conditional hook execution. Split components or put permission checks inside effects; never call teacher endpoints first and merely hide their result later.
- **VALIDATE**: `npx vitest run src/renderer/classroom-role.test.ts src/renderer/class-workspace.test.ts src/renderer/ClassWorkspaceSwitcher.test.tsx src/renderer/SpaceDetailPage.test.tsx src/renderer/app-language.test.ts`

### Task 6: Document and verify the permission and navigation boundary

- **ACTION**: Prove the matrix at server, bridge, and renderer layers without touching session/control systems.
- **IMPLEMENT**:
  - Add server tests for every new operation across all three roles and unknown roles/operations.
  - Add route/integration tests for cross-Space IDs, Student source/group/roster denial, Teacher roster access, Teacher student-invite allowance, Teacher teacher-invite denial, and owner teacher-invite allowance.
  - Add renderer tests proving Student markup contains no Library, Activity editor, Run, roster, group, upload, or invite controls.
  - Add Class workspace tests for no classes, one class, mixed Teaching/Learning roles, deterministic ordering, class removal, switching, and selected-class filtering.
  - Update README, Knowledge Spaces, and security docs with the exact matrix, Class workspace naming boundary, and the statement that Teacher does not imply device access.
  - Run full repository verification and package smoke test.
- **MIRROR**: Existing server policy tests, integration isolation fixtures, renderer SSR tests, and repository verification commands.
- **IMPORTS**: None expected.
- **GOTCHA**: Do not “fix” adjacent lifecycle, control, dashboard, telemetry, or session behavior in this change; record unrelated findings separately.
- **VALIDATE**: Run every command and manual check below.

---

## Testing Strategy

### Permission Tests

| Case | Expected result |
|---|---|
| Owner reads roster | Allowed |
| Facilitator reads roster | Allowed |
| Student reads roster | Denied |
| Owner invites facilitator/Teacher | Allowed |
| Facilitator invites facilitator/Teacher | Denied |
| Owner invites participant/Student | Allowed |
| Facilitator invites participant/Student | Allowed |
| Student creates any invite | Denied |
| Owner/facilitator lists full sources | Allowed |
| Student lists full sources | Denied; pinned Activity sources remain available through existing Activity context |
| Owner/facilitator lists groups | Allowed |
| Student lists groups | Denied |
| Student opens own assigned work/help/submission | Existing behavior remains allowed |
| Unknown role or operation | Denied |
| Teacher in Space A uses Space B ID | Denied/non-enumerating according to existing service convention |

### Renderer Tests

- Class workspace groups `owner|facilitator` under Teaching and `participant` under Learning.
- Mixed-role account can switch between Teacher and Student class experiences without changing global identity.
- One-class state shows a current-class indicator; multiple-class state exposes the grouped switcher; empty state shows create/join.
- Switching class updates only renderer selection and selected-class filtering; it invokes no Run/task/session/control mutation.
- Teacher · Owner sees Teacher · Owner, Library, Activities, People, roster, Invite Student, and Invite Teacher.
- Teacher sees Teacher, Library, Activities, People, roster, and Invite Student; no Invite Teacher.
- Student sees Student and Open my classwork; no teacher tabs or controls.
- Student render does not invoke teacher-only list methods.
- English and Vietnamese strings exist for every new label/action.
- Role badges do not rely on color alone.

### Edge Cases

- [ ] Missing/null member display name falls back to a bounded neutral label or user ID.
- [ ] Owner, facilitator, and participant in different Spaces on the same account render contextually.
- [ ] Same account teaches one class and learns in another; both appear in the correct Class workspace groups.
- [ ] Selected class disappears after refresh; shell clears it and returns to overview safely.
- [ ] Equal timestamps/names still produce deterministic ordering by ID.
- [ ] Switching while a task exists does not cancel, resume, start, or rebind that task.
- [ ] Role changes on the server are reflected after the next Space fetch; no role is cached globally.
- [ ] Removed/non-member receives the existing non-enumerating Space-not-found behavior.
- [ ] Facilitator crafts a direct facilitator invite request despite hidden UI; server denies.
- [ ] Student directly calls source/group/member IPC with a valid Space ID; hosted API denies.
- [ ] Cross-Space group ID in an invite remains rejected by existing repository constraint/query.
- [ ] Expired/used-up invite behavior remains unchanged.
- [ ] Knowledge Spaces disabled leaves existing Agent and other app views unaffected.

---

## Validation Commands

Run from `/Users/ducng/.codex/worktrees/ed6a/TroCode`.

### Focused Server Tests

```bash
node --test \
  services/api/test/knowledge-space-domain.test.mjs \
  services/api/test/server.test.mjs
```

EXPECT: Permission matrix and route denial tests pass.

### Focused Desktop/Renderer Tests

```bash
npx vitest run \
  src/shared/contracts.test.ts \
  src/renderer/classroom-role.test.ts \
  src/renderer/class-workspace.test.ts \
  src/renderer/ClassWorkspaceSwitcher.test.tsx \
  src/renderer/SpaceDetailPage.test.tsx \
  src/renderer/app-language.test.ts
```

EXPECT: Contracts, all role presentations, hidden affordances, and translations pass.

### Database Isolation Tests

```bash
TEST_DATABASE_URL='postgresql://<isolated-test-database>' \
  npm --prefix services/api run test:integration
```

EXPECT: The PostgreSQL integration test runs rather than skips and passes cross-Space membership/roster/invite cases. Use an isolated disposable database.

### Required Repository Gates

```bash
npm run check
npm run package
git diff --check
```

EXPECT: No lint/type/test/package regression. No Bazel check is needed because this plan touches no Rust, Cargo, Bazel, or Rust CI files.

### Manual Validation

- [ ] Create one Space as Account A; it displays Teacher · Owner.
- [ ] Create/join multiple Spaces; verify the Class workspace groups them under Teaching and Learning and clearly shows the selected class.
- [ ] Switch repeatedly between a Teaching class and a Learning class; verify only navigation/visible permissions change and no task/Run/session call fires.
- [ ] As owner, create one Teacher invite and one Student invite.
- [ ] Redeem Teacher invite as Account B; it displays Teacher and cannot invite another Teacher.
- [ ] Account B can invite Account C as Student.
- [ ] Account C displays Student and sees only class summary plus My classwork.
- [ ] Account C cannot access full library, groups, roster, Activity authoring, or existing Run controls through UI or direct IPC/API calls.
- [ ] Account A/B roster shows the three members with classroom labels and no email/activity/session data.
- [ ] Existing Activity launch, Run behavior, control restrictions, dashboard, help, and submission continue unchanged.

---

## Acceptance Criteria

- [ ] Stored roles remain exactly `owner | facilitator | participant`; no migration or global role is added.
- [ ] UI consistently maps them to Teacher · Owner, Teacher, and Student.
- [ ] Class workspace detects existing memberships from `listKnowledgeSpaces()`, groups them into Teaching/Learning, and shows the current class and role clearly.
- [ ] Users can switch classes without creating or mutating a backend workspace, Run, Attempt, Work Session, or control session.
- [ ] Student classwork is filtered to the selected Learning class in the renderer while the existing assigned-work API remains unchanged.
- [ ] Server policy implements the exact matrix above and fails closed.
- [ ] Owner can invite Teachers and Students; Teacher can invite Students only; Student cannot invite.
- [ ] Owner and Teacher can see a bounded membership roster; Student cannot.
- [ ] Roster contains only user ID, nullable display name, role, and join time—no email, activity, progress, screen, conversation, session, or file data.
- [ ] Students cannot list the teacher library or groups and use pinned sources only through existing assigned Activity behavior.
- [ ] Student Space UI does not render or request teacher-only features.
- [ ] Teacher Space UI preserves existing Activity/Run/dashboard behavior without lifecycle changes.
- [ ] Computer-control and task limitation behavior is untouched.
- [ ] Focused, integration, full check, and package validation pass.

## Completion Checklist

- [ ] Server policy is authoritative; renderer affordances are presentation only.
- [ ] Every new response is bounded and parsed at hosted client/preload boundaries.
- [ ] No raw IPC or generic membership API is exposed.
- [ ] No email or classroom activity data is added to the roster.
- [ ] Unknown role/operation and cross-Space access fail closed.
- [ ] Role mapping is pure, exhaustive, and context-specific per Space.
- [ ] Class grouping, ordering, selection, and selected-class filtering are pure and exhaustively tested.
- [ ] Class workspace code does not import or modify trusted-folder Workspace contracts/services.
- [ ] English and Vietnamese copy and accessible states are covered.
- [ ] No lifecycle, session trigger, telemetry, dashboard, agent, CUA, control, or submission scope was added.
- [ ] Documentation matches the exact implemented matrix.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| UI permission map drifts from server | Medium | Medium | Keep renderer map presentation-only; server tests remain canonical; exhaustive role tests |
| Facilitator gains owner-only teacher-management authority | Low | High | Separate `invite.participant` from `member.manage`; direct-request negative tests |
| Student retrieves teacher library/groups through existing broad reads | Medium | High | Tighten service operations to `source.read` and `group.manage`; route/integration tests |
| “Teacher” is interpreted as computer access | Medium | High | Explicit copy/docs boundary; no changes to control/runtime modules |
| Roster exposes unnecessary personal/activity data | Low | High | Explicit bounded schema; name only, no email or task/session joins |
| “Class workspace” is confused with trusted-folder Workspace | Medium | Medium | Use explicit UI/code naming, no shared types/services, documentation and import-boundary review |
| Class switch accidentally changes active task/session state | Low | High | Renderer-only Space ID selection; negative tests/spies for Run/task/session/control methods |

## Notes

- The core authorization system already exists. This work is mainly a permission correction and classroom presentation layer, not a new subsystem.
- Existing Run controls stay visible to Teachers because `run.manage` is already part of facilitator authority. Their state transitions and active-session behavior are out of scope.
- Existing dashboards may remain visible to Teachers through `attempt.read_all` and `insight.read`; this plan does not change what they contain or how their data is produced.
- Class workspace is intentionally a navigation shell over Spaces, not another level in the domain hierarchy. If durable favorites, ordering, or last-class restore are later needed, plan them separately.
- If a future product decision needs a global school-managed Student account that cannot use TroCode outside assigned Activities, plan that separately against the existing control branch. It is intentionally not inferred from a per-Space role here.
