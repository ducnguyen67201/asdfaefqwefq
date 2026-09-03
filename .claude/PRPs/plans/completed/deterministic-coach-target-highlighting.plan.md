# Plan: Deterministic Coach Target Highlighting

## Summary

Remove arbitrary highlight rectangles from the untrusted Coach model contract.
The model will continue to select one fresh, normalized target point, while the
trusted Electron host will always derive the visible teaching marker from that
point using the existing fixed-size, display-clamped geometry. This eliminates
the contract mismatch that currently accepts a large rectangle at the OpenAI
boundary and rejects it later inside Tro, without adding an observation, model,
or TTS call.

## User Story

As a primary-school learner, I want Tro to point clearly at one control and
continue explaining, so that a model-estimated highlight size cannot terminate
my lesson.

## Problem → Solution

The Coach model currently owns both target meaning and overlay geometry. Its
strict response schema permits a rectangle as large as the whole normalized
screen, while the local domain schema later rejects rectangles covering more
than 16% of the normalized image. The same payload is therefore valid at one
boundary and invalid at the next.

Change the authority split:

```text
CURRENT
LLM chooses point + x/y/width/height
    -> provider accepts width/height up to 1000
    -> local product-of-dimensions check may reject
    -> entire Coach task fails before presentation

TARGET
LLM chooses exact target label + normalized center point
    -> host verifies fresh observation identity
    -> host maps point: normalized image -> screenshot -> desktop
    -> host creates its existing fixed 76x76 marker
    -> Cursor Buddy glides, highlights, speaks, and waits
```

This is the root-cause fix because untrusted model output no longer controls
highlight size. Discarding an oversized rectangle after generation is only a
compatibility recovery and is not the primary design.

## Metadata

- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 6 updated, 0 created beyond this plan
- **Runtime Calls Added**: 0
- **Dependencies Added**: 0

---

## UX Design

### Before

```text
Learner asks for help
        |
        v
Tro observes and model finds the next control
        |
        v
Model estimates a broad rectangle
        |
        v
Task trace shows raw schema failure
No callout, narration, or learner wait
```

### After

```text
Learner asks for help
        |
        v
Tro observes and model returns the control center
        |
        v
Cursor Buddy glides to that center
        |
        v
Trusted host reveals one small, stable point marker
        |
        v
Callout + ElevenLabs narration continue normally
        |
        v
Tro waits for learner activity, then re-observes once
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Model target output | Point plus arbitrary rectangle | Point only | Model still decides what/where; never visual size |
| Highlight | Model-sized padded region | Host-sized 76x76 marker | Existing display clamping and negative origins remain |
| Failure behavior | Broad region fails the whole task | Broad region cannot be emitted | No retry or silent rectangle repair |
| Cursor Buddy | May never reach narration | Completes glide/highlight/speech/wait sequence | Real OS cursor remains untouched |
| Cost and latency | One model call that may be wasted | Same one model call, usable result | No second model validation pass |

---

## Root-Cause Evidence

1. `coachDecisionJsonSchema()` currently tells the Responses API that each
   rectangle dimension may be `1..1000`. It cannot encode the later
   `width * height <= 160_000` rule:

   ```ts
   // SOURCE: src/main/coach/coach-runtime.ts:392-397
   const region = closed({
     x: { type: 'integer', minimum: 0, maximum: 1_000 },
     y: { type: 'integer', minimum: 0, maximum: 1_000 },
     width: { type: 'integer', minimum: 1, maximum: 1_000 },
     height: { type: 'integer', minimum: 1, maximum: 1_000 },
   }, ['x', 'y', 'width', 'height']);
   ```

2. The domain contract rejects the response only after it returns:

   ```ts
   // SOURCE: src/main/coach/coach-contracts.ts:79-84
   if (region.width * region.height > 160_000) {
     context.addIssue({
       code: 'custom',
       message: 'The Coach target region is too broad; select one visible control.',
       path: ['region'],
     });
   }
   ```

3. The model receives a low-detail full-desktop image and only a qualitative
   instruction to choose a “tight visible target”:

   ```ts
   // SOURCE: src/main/coach/coach-runtime.ts:325-345
   {
     type: 'input_image',
     image_url: `data:${observation.screenshot.mimeType};base64,...`,
     detail: 'low',
   }
   ```

4. Region rejection occurs before normalized coordinates are converted to
   screenshot pixels or desktop coordinates. Retina scaling is therefore not
   the cause of this failure:

   ```ts
   // SOURCE: src/main/coach/coach-runtime.ts:216-223
   const screenshotPoint = mapNormalizedPointToScreenshot(...);
   const screenPoint = mapScreenshotPointToDesktop(...);
   const screenshotRegion = mapNormalizedRegionToScreenshot(...);
   return { screenRegion: mapScreenshotRegionToDesktop(...) };
   ```

5. A trusted point-only fallback already exists and is independently tested:

   ```ts
   // SOURCE: src/main/companion/companion-position.ts:284-303
   if (!region) {
     const diameter = Math.min(76, displayBounds.width, displayBounds.height);
     return { /* centered and clamped fixed marker */ };
   }
   ```

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `src/main/coach/coach-contracts.ts` | 10-99 | Untrusted decision schema and current cross-field region rejection |
| P0 | `src/main/coach/coach-runtime.ts` | 91-180, 199-225, 227-250, 310-477 | Coach loop, target mapping, Responses payload/schema, raw normalization |
| P0 | `src/main/coach/coach-runtime.test.ts` | 17-224, 225-350 | Observation fixtures, Coach lifecycle tests, mocked provider payloads |
| P0 | `src/main/companion/companion-position.ts` | 276-344 | Trusted region/point marker geometry; fixed 76x76 behavior |
| P0 | `src/main/companion/companion-position.test.ts` | 132-159 | Existing padded-region and point-only marker tests |
| P1 | `src/main/companion/cursor-buddy-controller.ts` | 220-410 | Presentation order and optional `screenRegion` forwarding |
| P1 | `src/main/companion/cursor-buddy-controller.test.ts` | 30-189 | Teaching sequence and highlight adapter test pattern |
| P1 | `src/main/agent/execution-contracts.ts` | 45-105, 260-330 | Observation coordinate spaces and normalized/screenshot/desktop mapping |
| P1 | `src/main/agent/execution-contracts.test.ts` | 16-90 | Retina, negative-origin, point, and region conversion tests |
| P1 | `docs/architecture.md` | 68-104 | Current Cursor Buddy and Coach ownership description |
| P1 | `docs/conversational-task-execution.md` | 22-49 | User-visible Coach loop and no-native-cursor invariant |
| P2 | `.claude/PRPs/plans/completed/cua-semantic-fast-path.plan.md` | 185-239, 650-663, 825-839 | Existing semantic refs and explicit warning about coordinate spaces |

The repository instruction references `docs/CODEX-NAVIGATION-GUIDE.md`, but
that file is absent in the current checkout. Implementation must not invent or
recreate it as part of this focused change.

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| CUA element geometry | [CUA Driver known limits](https://cua.ai/docs/reference/cua-driver/limits) | Accessibility `frame` is screen-absolute, but units differ: logical points on macOS and physical pixels on Windows/Linux. It must not be inserted directly into an Electron overlay without an explicit conversion contract. |
| CUA observation contracts | [CUA Driver interface contracts](https://cua.ai/docs/reference/cua-driver/contracts) | Window-local screenshot coordinates and desktop coordinates are distinct; target modality must remain explicit. |
| Accessibility snapshots | [CUA Driver MCP tools](https://cua.ai/docs/reference/cua-driver/mcp-tools) | `get_window_state` exposes structured elements and frames, but consumers should cross-check accessibility and image evidence because some surfaces report misleading trees. |

No new external API or library is required. These sources constrain what is
explicitly excluded from this PRP: semantic element bounds are not safe overlay
coordinates until Tro has a platform-aware coordinate-space contract.

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Snippet / Finding |
|---|---|---|---|
| Entry point | `src/main/coach/coach-runtime.ts:91-109` | One observation, then one structured decision | `CoachDecisionSchema.parse(await decide(...))` |
| Model boundary | `src/main/coach/coach-runtime.ts:310-420` | Strict JSON schema built locally | `text.format.type = 'json_schema'` |
| Domain validation | `src/main/coach/coach-contracts.ts:29-86` | Zod discriminated union plus cross-field checks | `CoachDecisionSchema.superRefine(...)` |
| Freshness | `src/main/coach/coach-runtime.ts:207-215` | Fail closed on missing/stale observation | Compare observation ID and fingerprint |
| Coordinate mapping | `src/main/agent/execution-contracts.ts:260-330` | Normalized -> screenshot -> desktop | Separate pure mapping functions |
| Presentation boundary | `src/main/coach/coach-runtime.ts:137-159` | Runtime builds `CursorBuddyStep` | Optional `screenRegion` is currently propagated |
| Host geometry | `src/main/companion/companion-position.ts:276-344` | Pure display-clamped placement | No region produces fixed point marker |
| Cursor ownership | `src/main/companion/cursor-buddy-controller.ts:220-410` | One controller owns glide/highlight/speech/wait | Calls injected `showHighlight(point, region)` |
| Error handling | `src/main/coach/coach-runtime.ts:63-71` | Runtime catches and reports terminal failure once | Aborted work is not reported as a new failure |
| Logging | `src/main/companion/cursor-buddy-controller.ts:250-370` | Content-free lifecycle events | `guidance.started/completed/failed` with phase/task |
| Persistence | `docs/architecture.md:98-104` | Geometry is never persisted | Only bounded progress/recap survive |
| Tests | `src/main/coach/coach-runtime.test.ts:87-224` | Factory fixture plus dependency spies | `stepFor(current)` and `vi.waitFor(...)` |
| Tests | `src/main/companion/companion-position.test.ts:132-159` | Exact pure geometry assertions | Point-only result is exactly 76x76 |
| Configuration | `package.json:31-51` | Repository-standard validation | `npm run check`, `npm run package` |
| Dependency | `package.json`, current imports | No new package required | Zod, Electron, and existing pure mapping only |

---

## Five-Traces Analysis

### 1. Entry Point

`TaskApplicationService` routes a help/check request to `CoachRuntime`. The
runtime starts its task-scoped CUA session, captures one current desktop
observation, and calls the authenticated Coach decision client.

### 2. Data Flow

```text
DesktopObservation
  -> coachResponseRequest() adds text + screenshot + identity
  -> Responses JSON schema returns CoachDecision
  -> CoachDecisionSchema validates it
  -> requireGroundedStep() verifies freshness and maps coordinates
  -> CursorBuddyController.presentStep()
  -> showGuidanceTargetMarker()
  -> placeGuidanceTargetMarker()
```

After this change, `region` disappears before the first arrow that involves the
model. The final placement function receives `undefined` for region and uses its
trusted point-marker branch.

### 3. State Changes

- Coach active-task, cancellation, and CUA-session lifecycle do not change.
- Cursor Buddy phase transitions do not change.
- LearnerActionGate timing and fresh observation behavior do not change.
- No target geometry is persisted before or after this change.
- No new mutable state is introduced.

### 4. Contracts

- `CoachDecisionSchema` is the domain contract and must no longer contain
  `region`.
- `RawCoachDecisionSchema` and `coachDecisionJsonSchema()` must mirror that
  removal exactly.
- `CursorBuddyStep.screenRegion` may remain optional as a trusted presentation
  capability, but this Coach path must never populate it from model output.
- `DesktopObservation` identity, fingerprint, screenshot, and coordinate-space
  requirements remain unchanged.

### 5. Patterns

- Schema-first model and IPC boundaries.
- Pure coordinate transformations and geometry functions.
- Dependency-injected presentation controller.
- One terminal result per task.
- No hidden retry, no replay when outcome is unknown, and no native cursor
  movement for Coach.

---

## Strategic Design

### Approach

Use a **point-authority contract**:

1. The LLM selects the semantic target label and the normalized center point.
2. The domain validates point bounds and fresh observation identity.
3. Existing pure functions map the point into Electron desktop coordinates.
4. The host constructs the marker size locally through
   `placeGuidanceTargetMarker(point, undefined, displayBounds)`.
5. Cursor Buddy performs the existing non-mutating presentation sequence.

### Architectural Invariants

1. **The model owns intent, never overlay geometry.**
2. **The host owns all pixel dimensions used by its windows.**
3. **One model decision produces at most one teaching step.**
4. **No malformed optional decoration can invalidate an otherwise grounded
   target.** In this release there is no model-owned optional decoration.
5. **Freshness remains mandatory.** A valid point tied to a stale observation
   still fails closed.
6. **The student owns the real cursor.** Coach never calls a CUA input action.
7. **No added latency or inference cost.** No retry, second verifier, crop call,
   or extra observation is introduced.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Clamp or discard oversized model rectangles | Reject as primary fix | Recovers one symptom but leaves the LLM incorrectly responsible for host geometry |
| Reduce `width` and `height` maxima independently | Reject | Cannot express an area/product constraint cleanly and still permits misleading aspect ratios |
| Ask the model to retry with a smaller rectangle | Reject | Adds latency/cost and can repeat the same invalid decision |
| Send a higher-detail screenshot | Defer | May improve point accuracy but increases image cost/latency and does not resolve geometry ownership |
| Use CUA semantic element bounds immediately | Defer | Strong future direction, but CUA frames have platform-dependent units and accessibility trees can be misleading; Tro lacks an explicit frame-to-Electron-DIP contract |
| Host-generated fixed marker around model point | Accept | Removes the invalid degree of freedom, reuses tested geometry, adds no calls, and works across current screenshot coordinate mapping |

### Scope

- Remove normalized `region` from Coach model/domain decisions.
- Keep normalized target point, target label, observation ID, and fingerprint.
- Make the prompt request the visual center of one visible control.
- Stop mapping/passing a model region into Cursor Buddy.
- Exercise point-only highlighting in Coach and Cursor Buddy tests.
- Update architecture and conversational execution documentation.

### NOT Building

- Semantic `e1`/`e2` element-reference targeting.
- A cross-platform AX-frame-to-Electron-DIP converter.
- OCR, object detection, screenshot cropping, or a second vision model.
- A model retry or repair loop.
- Changes to CUA input execution, permissions, approval policy, or the Heavy
  Agent route.
- Changes to the 76x76 visual design, narration, ElevenLabs transport, learner
  timer, or re-observation cadence.
- Migration of persisted tasks; Coach target geometry is not persisted.

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/main/coach/coach-runtime.ts:199-205
function requireGroundedStep(...): {
  observation: DesktopObservation;
  screenPoint: { x: number; y: number };
  screenRegion?: { x: number; y: number; width: number; height: number };
}
```

Retain the existing `requireGroundedStep` name; narrow its return type rather
than introducing a second resolver for this focused change.

### ERROR_HANDLING

```ts
// SOURCE: src/main/coach/coach-runtime.ts:207-215
if (!observation || !observation.coordinateSpace) {
  throw new Error('Coach returned a visible step without coordinate evidence.');
}
if (decision.observationId !== observation.observationId || ...) {
  throw new Error('Coach returned a stale screen target.');
}
```

Preserve fail-closed behavior for missing/stale required evidence. Only the
unnecessary model rectangle is removed.

### LOGGING_PATTERN

```ts
// SOURCE: src/main/companion/cursor-buddy-controller.ts:250-254
this.dependencies.log('guidance.started', {
  phase: 'gliding',
  taskId: step.taskId,
});
```

Do not add target labels, screenshots, coordinates, or raw model payloads to
logs. Existing lifecycle events are sufficient for this change.

### REPOSITORY_PATTERN

N/A — target geometry is deliberately ephemeral and must not be persisted.
The architecture documentation at `docs/architecture.md:98-104` is the pattern
to preserve.

### SERVICE_PATTERN

```ts
// SOURCE: src/main/coach/coach-runtime.ts:141-159
await this.dependencies.presenter.presentStep(
  { screenPoint: grounded.screenPoint, ... },
  { observe: ..., signal: controller.signal },
);
```

Keep Coach orchestration in `CoachRuntime`; keep window geometry inside the
injected Cursor Buddy presentation adapters.

### TEST_STRUCTURE

```ts
// SOURCE: src/main/coach/coach-runtime.test.ts:87-116
function stepFor(current: DesktopObservation) { ... }

await setupResult.runtime.start(...);
await vi.waitFor(() =>
  expect(setupResult.dependencies.presenter.presentStep).toHaveBeenCalledOnce(),
);
```

Use the existing deterministic fixtures and dependency spies. Do not require a
live OpenAI, CUA, Electron, or ElevenLabs service in unit tests.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/main/coach/coach-contracts.ts` | UPDATE | Remove model-owned `NormalizedRegionSchema`, `region`, and the impossible-to-mirror area check |
| `src/main/coach/coach-runtime.ts` | UPDATE | Remove region from raw/provider schema, prompt, normalization, imports, coordinate mapping, and presentation payload |
| `src/main/coach/coach-runtime.test.ts` | UPDATE | Convert fixtures to point-only and prove provider/runtime contracts cannot reintroduce region |
| `src/main/companion/cursor-buddy-controller.test.ts` | UPDATE | Make the primary teaching-sequence test use point-only highlighting and assert the optional region is absent |
| `docs/architecture.md` | UPDATE | Record model/host target-geometry ownership explicitly |
| `docs/conversational-task-execution.md` | UPDATE | Document fixed host marker and unchanged one-decision loop |

No production change is expected in `companion-position.ts`; its current
point-only branch is the implementation to reuse. Its tests remain required
validation evidence.

---

## Step-by-Step Tasks

### Task 1: Lock the Point-Authority Contract With Failing Tests

- **ACTION**: Update/add tests before changing production schemas.
- **IMPLEMENT**:
  - Remove `region` from `stepFor()` and mocked Coach provider responses.
  - Assert `presentStep` receives the correctly mapped `screenPoint` and does
    not have a `screenRegion` property.
  - Inspect the outbound strict JSON schema in the authenticated client test;
    assert `point` remains present and `region` is absent.
  - Add a domain contract assertion that a `coach_step` containing an unknown
    `region` key is rejected, proving the old authority cannot silently return.
  - Keep stale observation, cancellation, long-copy normalization, and one-call
    accounting tests intact.
- **MIRROR**: `src/main/coach/coach-runtime.test.ts:87-224` setup and async
  presentation assertions.
- **IMPORTS**: Existing Vitest and Coach exports only.
- **GOTCHA**: Provider raw output schemas are `.strict()`. All mocked JSON keys
  required by the Responses structured-output shape must remain present except
  the intentionally removed `region` key.
- **VALIDATE**:

  ```bash
  npm exec -- vitest run src/main/coach/coach-runtime.test.ts
  ```

  Expect the new assertions to fail before Tasks 2-3 and pass afterward.

### Task 2: Remove Rectangle Authority From Every Coach Model Boundary

- **ACTION**: Make provider, raw, and domain schemas agree on point-only target
  output.
- **IMPLEMENT**:
  - Delete `NormalizedRegionSchema` if `rg` confirms no remaining consumers.
  - Delete `region` from the `coach_step` branch of `CoachDecisionSchema`.
  - Remove region containment and area checks; they become dead because region
    no longer crosses the model boundary.
  - Remove `region` from `RawCoachDecisionSchema`.
  - Remove the local `region` JSON-schema object and the `region` property from
    `coachDecisionJsonSchema()`.
  - Remove `region` from `normalizeRawDecision()`.
  - Update the system instruction to: choose exactly one visible control and
    return the normalized center of that control; never estimate overlay size.
- **MIRROR**: The recent speech-boundary fix in
  `src/main/coach/coach-runtime.ts:227-250, 423-477`: the provider schema and
  domain contract must agree before presentation.
- **IMPORTS**: Remove unused region-related Zod/types only; add nothing.
- **GOTCHA**:
  - Do not leave `region` in the JSON schema as nullable. Nullable still grants
    the model authority and allows recurrence.
  - Do not add a repair model call.
  - Do not relax `.strict()` or stale-observation validation.
- **VALIDATE**:

  ```bash
  npm run typecheck
  npm exec -- vitest run src/main/coach/coach-runtime.test.ts
  ```

### Task 3: Narrow Grounding to the Existing Verified Point Pipeline

- **ACTION**: Remove region mapping from Coach orchestration.
- **IMPLEMENT**:
  - Remove `mapNormalizedRegionToScreenshot` and
    `mapScreenshotRegionToDesktop` imports from `coach-runtime.ts`.
  - Narrow `requireGroundedStep()` to return only the observation and
    `screenPoint`.
  - Keep `mapNormalizedPointToScreenshot()` followed by
    `mapScreenshotPointToDesktop()` exactly as-is.
  - Stop adding `screenRegion` to `CursorBuddyStep` in `presentStep()`.
  - Do not modify the OS cursor or call any CUA execution method.
- **MIRROR**: `src/main/agent/execution-contracts.test.ts:23-64` verified Retina
  and negative-origin point mapping.
- **IMPORTS**: Existing point-mapping imports only.
- **GOTCHA**: Do not pass normalized coordinates directly to Electron.
  `screenPoint` must remain desktop-space after both mapping functions.
- **VALIDATE**:

  ```bash
  npm exec -- vitest run \
    src/main/coach/coach-runtime.test.ts \
    src/main/agent/execution-contracts.test.ts
  ```

### Task 4: Exercise the Trusted Point Marker Through Cursor Buddy

- **ACTION**: Make point-only behavior the main presentation test path.
- **IMPLEMENT**:
  - Remove `screenRegion` from the default `CursorBuddyStep` fixture.
  - Change the `showHighlight` spy to capture arguments.
  - Assert it receives the mapped point and `undefined` region after the glide.
  - Keep `companion-position.test.ts` exact assertion that no region produces a
    76x76 marker, including negative display origin.
  - Retain optional region support inside the presentation API for future
    trusted host geometry; do not exercise it as model output.
- **MIRROR**: `src/main/companion/cursor-buddy-controller.test.ts:93-141` ordered
  sequence test and `src/main/companion/companion-position.test.ts:150-159`
  exact geometry test.
- **IMPORTS**: No new imports.
- **GOTCHA**: The marker appears only after Cursor Buddy reaches the target.
  Preserve motion/speech ordering and Reduce Motion behavior.
- **VALIDATE**:

  ```bash
  npm exec -- vitest run \
    src/main/companion/cursor-buddy-controller.test.ts \
    src/main/companion/companion-position.test.ts
  ```

### Task 5: Update Architecture Documentation

- **ACTION**: Make the trust boundary discoverable for future contributors.
- **IMPLEMENT**:
  - In `docs/architecture.md`, state that Coach returns target meaning plus a
    normalized center point; Electron owns marker dimensions.
  - In `docs/conversational-task-execution.md`, state that the host uses the
    fixed point marker and that no repair/retry model call occurs.
  - Record semantic element refs as a future option only after an explicit
    cross-platform coordinate-space adapter exists.
- **MIRROR**: Existing concise invariant-focused prose in both documents.
- **IMPORTS**: N/A.
- **GOTCHA**: Do not claim pixel-perfect semantic element grounding; this PRP
  removes bad region authority but still relies on model-selected visual point.
- **VALIDATE**:

  ```bash
  rg -n "point|marker|geometry|region" \
    docs/architecture.md docs/conversational-task-execution.md
  ```

### Task 6: Consolidated Verification and Live Scratch Check

- **ACTION**: Run focused, repository-wide, package, and manual validation.
- **IMPLEMENT**:
  - Run `git diff --check` before expensive validation.
  - Run focused Coach, coordinate, Cursor Buddy, and marker tests.
  - Run the repository-required `npm run check` and `npm run package`.
  - Restart the Electron main process and run the same Vietnamese Scratch help
    request that produced the broad-region error.
  - Confirm the task trace reaches presentation/waiting instead of a Zod region
    failure.
- **MIRROR**: Root `AGENTS.md` required verification.
- **IMPORTS**: N/A.
- **GOTCHA**: The worktree already contains substantial user-owned changes.
  Review only the scoped files; do not reset, rebase, or overwrite unrelated
  work.
- **VALIDATE**: Commands and manual checklist below.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Coach domain accepts point-only step | Fresh observation identity + normalized point | Parsed `coach_step` | No |
| Coach domain rejects old rectangle key | Valid step plus `region` | Strict parse failure | Yes—regression guard |
| Provider schema removes rectangle | Built response request | `point` exists; `region` absent | No |
| Runtime grounds point | Normalized point + Retina coordinate space | Correct desktop point | Yes—scale |
| Runtime preserves display origin | Normalized point + negative screen origin | Correct negative-origin desktop point | Yes—multi-display |
| Runtime rejects stale target | Wrong observation ID/fingerprint | Terminal safe failure; no presentation | Yes—safety |
| Cursor Buddy point-only presentation | Step without `screenRegion` | `showHighlight(point, undefined)` | No |
| Host marker without region | Point near display edge | Exactly 76x76 and clamped | Yes—edge |
| No extra inference | One oversized-free provider response | One `/responses` request only | No—cost |
| No native cursor mutation | Coach presentation | No CUA input command | No—product invariant |

### Edge Cases Checklist

- [ ] Target point at normalized `(0, 0)`
- [ ] Target point at normalized `(1000, 1000)`
- [ ] Retina screenshot-to-screen scale
- [ ] Negative-origin secondary display
- [ ] Display smaller than 76 pixels in one dimension
- [ ] Missing coordinate space
- [ ] Stale observation ID
- [ ] Stale observation fingerprint
- [ ] Provider emits unknown legacy `region`
- [ ] Cancellation during glide/narration
- [ ] Reduce Motion enabled
- [ ] No extra model/observation/TTS call

### Integration Boundaries

- **Model**: mocked Responses payload and strict JSON schema.
- **CUA**: existing observation fixture; no live CUA needed for unit tests.
- **Electron**: pure coordinate and placement functions, then packaged-app
  manual check.
- **TTS**: existing mocked `speak` dependency; transport is unchanged.

---

## Validation Commands

### Scoped Diff Hygiene

```bash
git diff --check
git diff -- \
  src/main/coach/coach-contracts.ts \
  src/main/coach/coach-runtime.ts \
  src/main/coach/coach-runtime.test.ts \
  src/main/companion/cursor-buddy-controller.test.ts \
  docs/architecture.md \
  docs/conversational-task-execution.md
```

EXPECT: No whitespace errors; only planned changes within these already-dirty
files.

### Static Analysis

```bash
npm run lint
npm run typecheck
```

EXPECT: Zero lint or type errors.

### Focused Unit Tests

```bash
npm exec -- vitest run \
  src/main/coach/coach-runtime.test.ts \
  src/main/agent/execution-contracts.test.ts \
  src/main/companion/cursor-buddy-controller.test.ts \
  src/main/companion/companion-position.test.ts
```

EXPECT: All focused tests pass; point-only path is the default Coach fixture.

### Full Test Suite

```bash
npm run check
```

EXPECT: Agent SDK checks, admin build, runtime-version checks, Rust ownership,
lint, TypeScript, Rust fmt/clippy/audit, Vitest, and Cargo tests pass. Existing
explicitly allowed Rust advisories and environment-gated PostgreSQL/S3 ignores
must be reported, not misrepresented as new failures.

### Package Validation

```bash
npm run package
```

EXPECT: Electron Forge packages the macOS arm64 application successfully.

### Database Validation

N/A — no schema, migration, API persistence, or database code changes.

### Manual Validation

- [ ] Restart the Electron main process (`rs` in the development terminal).
- [ ] Open the same Scratch lesson on the same display that reproduced the
  broad-region failure.
- [ ] Say: “Cách làm bài tập này.”
- [ ] Confirm trace order: ready -> Coach started -> observing -> planning ->
  presenting/waiting.
- [ ] Confirm no `Coach target region is too broad` event can appear.
- [ ] Confirm Cursor Buddy—not the real OS cursor—glides to the target.
- [ ] Confirm one compact marker appears around the target point.
- [ ] Confirm callout and ElevenLabs explanation continue after arrival.
- [ ] Confirm the marker stays visible while the learner works.
- [ ] Perform the learner action and confirm exactly one fresh observation
  leads to the next decision.
- [ ] Repeat on a Retina display edge and, if available, a secondary display.

---

## Acceptance Criteria

- [ ] `region` is absent from `CoachDecisionSchema`.
- [ ] `region` is absent from `RawCoachDecisionSchema`.
- [ ] `region` is absent from the strict Responses JSON schema and prompt
  contract.
- [ ] Coach runtime maps and presents only the normalized target point.
- [ ] Cursor Buddy receives no model-derived `screenRegion`.
- [ ] The host's existing 76x76 point marker is used and display-clamped.
- [ ] Missing/stale required coordinate evidence still fails closed.
- [ ] The real OS cursor is never moved or clicked by Coach.
- [ ] No additional model, observation, or TTS call is introduced.
- [ ] A legacy/unknown `region` key cannot silently regain authority.
- [ ] Focused and full automated tests pass.
- [ ] Electron package succeeds.
- [ ] Live Scratch reproduction reaches narration and learner waiting without
  the region-area failure.

## Completion Checklist

- [ ] Code follows existing Coach schema-first patterns.
- [ ] Provider, raw, and domain contracts agree exactly.
- [ ] Required freshness checks remain unchanged.
- [ ] Existing coordinate mapping remains the sole point conversion path.
- [ ] Host geometry remains pure and deterministic.
- [ ] Tests cover contract removal and end-to-end point presentation.
- [ ] Documentation records the ownership boundary.
- [ ] No hardcoded replacement dimensions are added outside the existing marker
  geometry.
- [ ] No new dependencies, feature flags, or persistence are introduced.
- [ ] Unrelated dirty-worktree changes remain untouched.
- [ ] The implementation can be completed without further codebase discovery.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Model-selected point is imprecise on a dense low-detail screenshot | Medium | Medium | Prompt for exact control center; retain fresh observation identity; manual Scratch validation; treat high-detail/crop/semantic grounding as a separate measured improvement |
| Fixed marker overlaps a neighboring small control | Low-Medium | Low | Existing marker is 76x76 and clamped; validate representative Scratch controls before changing its established dimensions |
| Removing region breaks stale mocked provider fixtures | High | Low | Update every Coach response fixture and assert JSON schema shape explicitly |
| Contributor later reintroduces region as nullable | Medium | High | Strict-domain regression test rejects unknown `region`; architecture docs record model/host ownership |
| Semantic element bounds are adopted without unit conversion | Medium (future) | High | Explicitly exclude until observation metadata identifies coordinate space and a platform-aware converter is tested |
| Dirty worktree hides accidental edits | Medium | Medium | Scope diff to the six planned files; use `git diff --check`; never reset/rebase user work |

## Notes

### Why This Is More Than Error Suppression

The old failure is not handled with `try/catch`, a larger threshold, or a
fallback after rejection. The invalid capability is removed from the model
contract entirely. There is no model rectangle to clamp, discard, retry, or
validate. The trusted presentation layer becomes the only owner of visual
dimensions.

### Future Semantic Grounding Follow-up

CUA already exposes public observation-scoped element refs and optional bounds.
A later PRP may let the model select an `e1`-style ref and let the host derive an
exact element center. That work must first add:

1. explicit bounds-space/unit metadata to observations;
2. conversion from macOS logical points and Windows/Linux physical pixels into
   Electron desktop DIPs across mixed-DPI displays;
3. role/visibility/size eligibility for targetable elements;
4. image/tree cross-check fallback for canvas and misleading accessibility
   surfaces;
5. stale-ref handling tied to the same observation fingerprint.

Those requirements are intentionally not hidden inside this bug fix.

### Confidence Score

**9/10** for single-pass implementation. The point-only host marker and all
coordinate transforms already exist and are tested. The remaining uncertainty
is visual point accuracy on the learner's exact low-detail Scratch screenshot,
which requires the stated live smoke test and is separate from the eliminated
rectangle-area failure.
