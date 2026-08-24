# Generator state — live classroom renderer

## Iteration

Generator iteration 1 for the live classroom teacher/student flow.

## Design direction

The classroom UI extends TroCode's warm cream, concentrated yellow, and charcoal identity with a distinct **shared signal** motif: teacher and student states are connected through circles, short rails, explicit status dots, and numbered preparation steps. It is intentionally not a generic education dashboard.

The composition follows two complementary modes:

- **Teacher studio:** a deliberate `Materials → Activity → Live room` sequence. Each phase exposes the next safe action without forcing teachers to understand the underlying Space/Run/Attempt model.
- **Student cockpit:** a calm classwork surface with one persistent session strip. Help, Check, Ready, Submit, and Leave remain visibly separate actions rather than collapsing into an ambiguous “Done” state.

Yellow is reserved for current direction, explicit consent, live state, ready-for-review, and primary confirmation. Charcoal is reserved for high-attention classroom surfaces such as joining and working with Tro. Borders and surface contrast provide most hierarchy; elevation appears only on the live join, exact broadcast preview, active session, and student support cockpit.

## Implemented renderer flow

### Shared entry

- Redesigned Knowledge Spaces as a role-neutral Tro Classroom home.
- Added a primary student room-code path with an optional safe-link consent toggle.
- States exactly what the phase records: join, Help, Check, submission, and review lifecycle events—no continuous cursor, typing, or screen monitoring.
- Kept the longer-lived Space invite flow as a secondary disclosure.
- Added clearer teacher Space creation and role-labeled existing Space cards.

### Teacher

- Participants no longer load or see teacher materials, publishing, group, Run, or dashboard controls.
- Teacher flow header makes `Materials → Activity → Live room` visible.
- Materials surface now has role explanations, reviewed upload staging, source counts, and a structured source table.
- Activity editor now includes:
  - exercise framing;
  - guidance/answer policy;
  - criterion authoring;
  - default facilitator confirmation;
  - room-join policy;
  - explicit-submission policy;
  - reviewed HTTPS allowed origins;
  - pinned immutable source versions.
- Published Activity offers a live room as the recommended delivery, while preserving direct group/account assignment.
- Live room control includes:
  - create/rotate/revoke short-lived room code;
  - lobby presence and explicit class start/end;
  - exercise/open-link directive composer;
  - attached criteria;
  - exact student preview and user-only Broadcast button;
  - public HTTPS/credential/local-address preflight;
  - deterministic auto-open eligibility preview using the published allowed origins;
  - explicit lifecycle-only class pulse;
  - Help resolution;
  - Ready/Submitted Complete or Return review actions.
- Dashboard polling retains the existing bounded delta approach and adds an in-flight guard.

### Student

- Added a persistent classroom session bar mounted below the app top bar.
- Session bar restores only through the server-owned current participation; it does not accept or persist a renderer-supplied Attempt id.
- Lobby, live, Help requested, ready, submitted, completed, and ended states have text labels in addition to color.
- Teacher directions appear without repeatedly stealing focus.
- Safe links show origin, Open, and Dismiss; auto-open consent is visible and revocable.
- Help first raises the teacher queue, then starts an Activity task with `activityIntent: 'help'`.
- Check starts an Activity task with `activityIntent: 'check'` and published criteria context.
- Ready remains explicit via `readyKnowledgeAttempt`.
- Submission preserves the reviewed-file flow and never occurs from task completion.
- Classwork now separates active/all/finished Attempts and exposes live/status metadata.
- Attempt view was rebuilt as a published brief + support cockpit, with current teacher direction, criteria, pinned sources, workspace selection, Help, Check, Ready, and submission.

## Accessibility and responsive craft

- All session and participant states include readable text; color is supplementary.
- Exact broadcast and directive updates use polite live regions.
- Errors use `role="alert"`.
- Tabs/radio groups retain accessible roles and selected state.
- Focus-visible rings cover classroom inputs and existing controls.
- Directive banners do not programmatically move focus.
- Reduced-motion disables the live pulse animations.
- At narrower desktop widths, three-column collections become two columns; teacher room, editor, and student Activity layouts collapse to a single column without hiding primary actions.

## Files changed by this generator

- `src/renderer/SpacesPage.tsx`
- `src/renderer/SpaceDetailPage.tsx`
- `src/renderer/SpaceLibrary.tsx`
- `src/renderer/ActivityEditorPage.tsx`
- `src/renderer/FacilitatorRunPage.tsx`
- `src/renderer/AttemptLaunchPage.tsx`
- `src/renderer/AssignedActivitiesPage.tsx`
- `src/renderer/KnowledgeHubPage.tsx`
- `src/renderer/ClassroomSessionBar.tsx` (new)
- `src/renderer/classroom-session-view.ts` (new)
- `src/renderer/App.tsx`
- `src/renderer/app-language.ts`
- `src/renderer/app-language.test.ts`
- `src/index.css`
- `gan-harness/generator-state.md` (new)

## Validation handoff / known risks

- Consolidated validation was completed after generation: lint, typecheck, 791 Vitest tests, 12 script tests, 143 API tests, two real PostgreSQL tests, both dependency audits, and arm64 macOS packaging passed.
- Teacher Run state now comes from authoritative dashboard snapshots and deltas. A future Run-history entry point would make leaving and later reopening the exact room-control page possible; plaintext room codes remain intentionally unrecoverable.
- The exact broadcast preview computes delivery from the immutable Activity allowed-origin list known at publication time; the server still revalidates and may reject a URL at Broadcast.
- No QR dependency was added. The human-readable room code is the complete supported admission path for this iteration.
