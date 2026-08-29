# Implementation Report: Stateful Animated Desktop Pet

## Summary

Implemented a real frame-animated default desktop duck with nine six-frame
states, idle hover reactions, main-process-only pointer hit-testing, sparse
phase-derived task encouragement, six bilingual nudge moods, reduced-motion
poses, and preserved custom-companion behavior. The renderer remains sandboxed:
only validated state, nudge, appearance, position, and hover-boolean projections
cross the preload boundary. A follow-up Codex-style picker now keeps the animated
Tro default and encrypted generated pets in one selection surface, with the
existing image-plus-description generator presented as “Create your own pet.”

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | 8/10 | 9/10 for automated behavior; packaged Windows hover/click-through remains a manual release gate |
| Files Changed | 29 logical operations | 32 feature operations (8 created, 22 updated, 2 renamed; 34 physical paths) |
| Runtime Dependencies | None | None |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Produce and validate the default sprite atlas | Complete | 768 x 1152 RGBA, 978,567 bytes, 54 fixed cells; original static asset hash unchanged |
| 2 | Add the animation model and atlas renderer | Complete | Exhaustive rows, precedence, labels, one-shot terminal poses, custom-image fallback |
| 3 | Implement safe cross-platform hover tracking | Complete | 10 Hz eligible-only local hit-test, 8 px inset, boolean-only IPC, Wayland gate |
| 4 | Generalize the nudge contract and renderer | Complete | Six strict moods, bilingual labels, passive plain-text accessibility contract retained |
| 5 | Add sparse task-phase encouragement | Complete | 20 s first delay, 2 min cadence, 5 s visibility, bounded busy retry, stale-task guards |
| 6 | Wire task nudges and mood expressions in Electron main | Complete | Shared slot, preserved priority, independent window publication, centralized interruption/cleanup |
| 7 | Update settings, localization, privacy, and architecture docs | Complete | Local/ephemeral hover wording and Wayland/reduced-motion behavior documented |
| 8 | Run verification | Complete with unavailable manual rows documented | Automated gates and macOS packaging pass; interactive packaged macOS/Windows/Linux rows were not claimed |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Asset | Pass | Source and packaged atlas are 768 x 1152 RGBA PNGs and 978,567 bytes; source is below 2 MiB and has real transparent alpha |
| Static Analysis | Pass | Protocol check, admin build, runtime-version check, Rust-only check, ESLint, TypeScript, Cargo fmt, Clippy, and audit completed; audit reported only the repository's three allowed advisories |
| Unit Tests | Pass | 4 new suites and 5 expanded suites; all 124 Vitest files / 821 tests passed, plus all runnable Rust suites |
| Build | Pass | `npm run package` produced `out/Tro-darwin-arm64/Tro.app`; packaged ASAR contains the atlas and `trocode-api` sidecar |
| Integration | Automated pass; manual rows unavailable | IPC/service/window integration is covered by tests and package inspection; interactive packaged platform behavior remains documented in the TDD matrix |
| Edge Cases | Pass in automated coverage | Includes non-idle hover precedence, exact hit-test edges, Wayland disablement, stale task IDs, busy retry, preference disable, hostile nudge text, custom URLs, and reduced-motion CSS |
| Whitespace | Pass | `git diff --check` completed with no errors |

The first aggregate check found import-order issues and two stale renderer test
expectations. Those were corrected, and only the failed checks were rerun as
required by the implementation workflow. A separate coverage rerun was omitted
to avoid duplicating the full 821-test run. After the picker follow-up, the full
`npm run check` and `npm run package` gates were rerun and passed end to end.

## Files Changed

| File | Action | Lines / Size |
|---|---|---|
| `src/assets/tro-desktop-pet-atlas.png` | CREATED | 978,567-byte RGBA PNG |
| `src/renderer/companion-animation.ts` | CREATED | +85 |
| `src/renderer/companion-animation.test.ts` | CREATED | +120 |
| `src/main/companion/companion-hover-tracker.ts` | CREATED | +159 |
| `src/main/companion/companion-hover-tracker.test.ts` | CREATED | +125 |
| `src/main/companion/task-pet-service.ts` | CREATED | +329 |
| `src/main/companion/task-pet-service.test.ts` | CREATED | +294 |
| `docs/testing/stateful-animated-desktop-pet.tdd.md` | CREATED | +44 |
| `src/renderer/ClassroomPetNudge.tsx` -> `src/renderer/CompanionPetNudge.tsx` | RENAMED / GENERALIZED | +62 / -56 |
| `src/renderer/ClassroomPetNudge.test.tsx` -> `src/renderer/CompanionPetNudge.test.tsx` | RENAMED / EXPANDED | +89 / -83 |
| `src/index.ts` | UPDATED | +146 / -17 |
| `src/index.css` | UPDATED | +71 / -22 |
| `src/renderer/CursorCompanion.tsx` | UPDATED | +98 / -32 |
| `src/renderer/CursorCompanion.test.ts` | UPDATED | +34 / -3 |
| `src/preload.ts` | UPDATED | +17 |
| `src/shared/contracts.ts` | UPDATED | +6 |
| `src/shared/contracts.test.ts` | UPDATED | +18 / -2 |
| `src/shared/desktop-api.ts` | UPDATED | +3 |
| `src/main/companion/classroom-pet-service.ts` | UPDATED | +10 / -5 |
| `src/main/companion/classroom-pet-service.test.ts` | UPDATED | +11 |
| `src/renderer/GuidanceCallout.tsx` | UPDATED | +2 / -2 |
| `src/renderer/SettingsPage.tsx` | UPDATED | +1 / -1 |
| `src/renderer/SettingsPage.test.ts` | UPDATED | +8 / -6 |
| `src/renderer/app-language.ts` | UPDATED | +4 / -2 |
| `src/renderer/app-language.test.ts` | UPDATED | +13 |
| `src/renderer/CompanionCustomizationCard.tsx` | UPDATED | Codex-style picker and explicit generation section |
| `src/renderer/CompanionCustomizationCard.test.ts` | UPDATED | Picker/default/generated/localization coverage |
| `README.md` | UPDATED | +7 |
| `docs/architecture.md` | UPDATED | +25 |
| `docs/security.md` | UPDATED | +18 |
| `docs/knowledge-spaces.md` | UPDATED | +4 / -1 |
| `docs/testing/classroom-codex-pet.tdd.md` | UPDATED | +1 / -1 |

## Deviations from Plan

1. Updated `docs/testing/classroom-codex-pet.tdd.md` in addition to the planned
   list because the component rename otherwise left a stale test-file reference.
2. The generated artwork needed a second edit to replace a visually rendered
   checkerboard with genuine alpha, then a deterministic nearest-neighbor resize
   to the exact atlas contract.
3. The plan listed focused tests, coverage, and the full suite separately. The
   implementation workflow requires deduplicated validation, so the full suite
   covered the focused areas and coverage was not rerun separately.
4. Packaged interactive macOS, Windows, Linux X11, and Wayland rows were not
   exercised in this noninteractive run. They remain explicitly marked
   unavailable in the verification record rather than being reported as passes.

## Issues Encountered

- Dependencies were absent in the fresh worktree; `npm ci` restored the locked
  dependency tree and reported zero npm vulnerabilities.
- The first static pass found three import/order lint errors; imports were
  reordered without behavioral changes.
- Two renderer expectations still used the previous spacing/Vietnamese copy;
  they were updated to the new generalized nudge output, after which all 821
  Vitest tests passed.

## Tests Written

| Test File | Change | Coverage |
|---|---|---|
| `src/renderer/companion-animation.test.ts` | New | Exhaustive state rows, animation precedence, mood aliases, custom fallback |
| `src/main/companion/companion-hover-tracker.test.ts` | New | Geometry, transition dedupe, lifecycle cleanup, supported platforms, Wayland |
| `src/main/companion/task-pet-service.test.ts` | New | Phase table, exact timers, suppression, retry, task identity, preferences, EN/VI rotation |
| `src/renderer/CompanionPetNudge.test.tsx` | Renamed/expanded | Six bilingual moods, polite status, escaped text, no controls |
| `src/shared/contracts.test.ts` | Expanded | Six strict moods and boolean-only hover payload |
| `src/main/companion/classroom-pet-service.test.ts` | Expanded | Classroom service cannot emit task-only moods |
| `src/renderer/CursorCompanion.test.ts` | Expanded | Default sprite markup and exact custom private URL path |
| `src/renderer/SettingsPage.test.ts` | Expanded | Accurate task-message and local-only hover privacy copy |
| `src/renderer/app-language.test.ts` | Expanded | Vietnamese coverage for every new companion string |
| `src/renderer/CompanionCustomizationCard.test.ts` | Expanded | Default/generated pet picker, generator entry point, and Vietnamese labels |

## Generated Asset Record

- Tool/mode: built-in image generation, reference-image creation followed by an
  image edit for true background extraction.
- Reference: `src/assets/tro-desktop-pet.png`.
- Generated source:
  `/Users/ducng/.codex/generated_images/01a04c65-f7d5-7352-a22c-c50492d5045d/exec-11aaab95-6848-4667-9b0a-24b6162fc994.png`.
- Checked-in output: `src/assets/tro-desktop-pet-atlas.png`.
- Final edit prompt:

  > Use case: background-extraction. Asset type: production sprite atlas for an
  > Electron desktop pet. Input image: Image 1 is the edit target. Primary
  > request: Remove only the gray-and-white checkerboard background and replace
  > it with genuine transparent alpha. Constraints: preserve every one of the 54
  > duck frames exactly; preserve the exact 6-column by 9-row layout, canvas
  > aspect ratio, frame positions, pixel-art edges, palette, poses, and spacing.
  > Keep no visible checkerboard pixels. Do not redraw, rearrange, crop, add,
  > remove, or merge any duck. No text, labels, grid lines, new objects, shadows,
  > or watermark. Output must be a genuinely transparent RGBA PNG.

## Next Steps

- [ ] Exercise packaged macOS hover/drag/reduced-motion behavior interactively.
- [ ] Exercise packaged Windows overlay click-through and hover behavior before release.
- [ ] Code review via `/code-review`.
- [ ] Create PR via `/prp-pr`.
