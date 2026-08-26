# Implementation Report: Voice Dictation and Task Modes

## Summary

Implemented explicit, one-turn Dictation and Task voice modes across Tro's
focused renderer and system-wide native shortcut paths. The base chord performs
Dictation; adding Shift during the 120 ms arbitration window performs a Task.
Mode is immutable for the turn and the shortcut cannot re-arm until all base
modifiers are released.

Dictation now edits the Tro composer at its captured selection or inserts once
into a uniquely selected, revalidated external window through a narrow
Accessibility-only CUA adapter. It never enters the task runtime, presses
Enter, clicks, uses the clipboard, or retries an unknown delivery. Task retains
the existing task/clarification/steering path and one-second Escape window.

The Voice Island, composer, Settings, onboarding, Vietnamese translations, and
README now explain and visibly distinguish Dictation (teal microphone) from
Task (yellow Tro spark) using redundant text, icon, destination, and color.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | XL | XL |
| Confidence | 8/10 | 8/10; automated gates pass, real-app cross-platform matrix remains |
| Files Changed | 45: 9 created, 36 updated | 47 implementation files: 12 created, 35 updated |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Add mode, dictation, presentation, and analytics contracts | Complete | Strict Zod contracts and narrow Desktop API added |
| 2 | Implement deterministic two-chord arbitration | Complete | Renderer, Swift, and Windows paths share the 120 ms rule |
| 3 | Refactor capture around immutable turn context and preflight | Complete | Preflight precedes microphone/provider work; terminal callback is once-only |
| 4 | Add safe in-app composer Dictation | Complete | Stable snapshot-based selection replacement; no task submission |
| 5 | Extract fail-closed external-window selection | Complete | Unique-frontmost selection and pid/window identity are pure and tested |
| 6 | Add Accessibility-only CUA dictation adapter | Complete | Full CUA Screen Recording gate remains unchanged |
| 7 | Implement consume-once DictationService | Complete | Atomic consumption, target revalidation, one scoped type call, no retry |
| 8 | Wire strict IPC, preload, and lifecycle cleanup | Complete | Begin/commit membership-gated; trusted cancel remains available after sign-out |
| 9 | Route final transcripts and retain recovery text | Complete | Routing uses only immutable mode/activation, never transcript classification |
| 10 | Add accessible presentation and permission copy | Complete | Island, composer, Settings, onboarding, CSS, translations, and docs updated |
| 11 | Finish analytics, regression coverage, and packaging | Complete | Content-free analytics/logging and automated packaging verified |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Repository sanity | Pass | Plan present during validation; `git diff --check` clean |
| Native helper | Pass | `xcrun swiftc -typecheck native/macos-global-voice-shortcut.swift` |
| Static analysis | Pass | Protocol check, admin build, runtime-version checks, ESLint, TypeScript, Rust fmt/clippy/audit |
| Unit tests | Pass | 116 Vitest files, 732 tests on rebased `origin/main`; hosted Rust suite also passed |
| Bazel | Pass | 14 test targets, aggregate clippy target, module-lock consistency, and `//services/api:trocode_api` build |
| Package | Pass | Electron Forge production package for macOS arm64 at `out/Tro-darwin-arm64` |
| Privacy sentinel | Pass | Sentinel appears only in the plan and assertions/fixtures; never captured output |
| Real-app integration | Pending release gate | Packaged macOS/Windows target, permission, screen-reader, forced-color, and zoom matrix requires real hosts/apps |

The consolidated `npm run check` first stopped because dependencies were not
installed; `npm ci` restored the lockfile-defined environment. The next pass
found import-order and type-fixture issues, which were corrected. Its final
test stage then exposed four focused edge cases; after correcting them, the
failed `npm run test` gate passed in full. After rebasing onto the latest main,
`npm run check`, `npm run bazel:check`, the Bazel API build, module tidy check,
native Swift typecheck, and `npm run package` all completed successfully again.

## Files Changed

| Area | Action | Files / impact |
|---|---|---|
| Shared contracts/API | Created and updated | `voice-mode.ts`, `voice-contracts.test.ts`, `contracts.ts`, `desktop-api.ts`, `preload.ts` |
| Shortcut arbitration | Created and updated | Renderer arbiter/tests, Swift helper/watcher, Windows watcher/tests, global shortcut/tests |
| Voice transport/routing | Created and updated | Mode-aware hook/tests, pure draft helper/tests, pure route helper/tests, `App.tsx` |
| Global Dictation | Created and updated | Window selector/tests, CUA contracts/service/router/tests, DictationService/tests, IPC/index wiring |
| Presentation/accessibility | Created and updated | Voice Island/test, CSS, companion/presentation policy tests, Settings/onboarding/translations |
| Privacy/docs | Updated | Analytics service/tests and README |

The final branch diff contains 47 implementation files plus the archived plan
and this report. The implementation adds 12 focused modules/test files and 53
new test cases.

## Deviations from Plan

- Added `voice-route.ts` and a dedicated strict voice-contract test file. The
  extra extraction makes the authority boundary independently testable and
  accounts for the higher created-file count.
- Kept `cua-surface-router.test.ts` unchanged because its existing selector
  regression cases exercise the compatibility export; the new pure
  `cua-window-selection.test.ts` owns the expanded ambiguity, geometry, space,
  and identity matrix.
- Made `DictationCommitResultSchema` semantically discriminated so invalid
  disposition/reason pairs are rejected, which is stricter than the flat
  illustrative target contract in the plan.

## Issues Encountered

- The worktree initially lacked `node_modules`; restored dependencies with
  `npm ci` without changing the lockfile.
- Validation found three import-order errors and two overly narrow test mock
  types; corrected the imports and explicit fixture result types.
- Tests exposed zero-segment audio being treated as partial failure, empty
  structured CUA output masking a numeric confirmed effect, a missing metadata
  fixture field, and one incorrect caret expectation. Each root cause was fixed
  and the affected/full test gate was rerun successfully.

## Tests Written

| Test area | Coverage |
|---|---|
| Voice contracts | Strict mode, UUID, size, result, activity, and analytics boundaries |
| Shortcut arbiters/watchers | Modifier sides, 0/119/120/121 ms boundary, locking, release, repeat, framing, fallback |
| Voice hook | Async preflight, no-work rejection, immediate Dictation, delayed Task, cancellation, no speech, failures, 60-second cap |
| Draft and routing helpers | Selection/caret, Unicode spacing, punctuation, provisional stability, explicit authority routing |
| Window/CUA/Dictation services | Fail-closed selection, permission split, exact scoped call, consume-once, target change, unknown delivery, cleanup, privacy |
| IPC/analytics/presentation/UI | Sender/auth gates, strict parsing, redaction, ARIA, terminal presentation, onboarding and Settings copy |

## Next Steps

- [ ] Run the packaged macOS real-application matrix from the plan.
- [ ] Run the packaged Windows matrix, including left-modifier polling and the degraded fallback.
- [ ] Review with `/code-review`.
