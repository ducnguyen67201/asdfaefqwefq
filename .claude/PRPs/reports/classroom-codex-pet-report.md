# Implementation Report: Classroom Codex Pet

## Summary

Implemented the approved, bounded Classroom pet feature on top of Tro's
existing sandboxed companion guidance window. During an eligible live student
Run, Tro can show sparse, curated English or Vietnamese encouragement based
only on explicit local Run and Attempt state. Explicit blocked, Ready,
Submitted, and Complete transitions select supportive or celebratory copy;
the feature never infers attention, completion, or application use.

The experience is passive, silent, mouse-through, non-focusable, and subordinate
to every operational companion surface. A local mode-`0600` preference defaults
on for old and new installations, can be saved from Settings, and immediately
dismisses an owned visible nudge when disabled. Pet state is delivered through
one fixed, outbound-only, schema-parsed preload event and is not written to
classroom evidence, analytics, task history, or a backend.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| External services | None | None |
| Files changed | 24 estimated | 25 feature files, plus this report and the archived plan |
| Dependencies | No additions | No package or lockfile changes |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Define projection and preference | Complete | Added strict bounded nudge schemas/types, legacy-on preference default, post-write preference events, defensive snapshots, and mode-`0600` coverage. |
| 2 | Implement the scheduling policy | Complete | Added a pure, dependency-injected service with explicit-state eligibility, deterministic bilingual catalogues, one owned timer, exact identity cleanup, stale callback rejection, sparse cadence, busy retry, and idempotent lifecycle. |
| 3 | Integrate Electron presentation | Complete | Reused the secure guidance window, bounded the 320×126 callout to the nearest display work area, kept it mouse-through/non-focusable, and made operational state interrupt visible pet content. |
| 4 | Add the one-way renderer event | Complete | Added one fixed nullable event with Zod parsing and exact listener cleanup; no renderer-to-main method or IPC handler was introduced. |
| 5 | Render the passive bubble | Complete | Added the labelled polite status card, bilingual mood labels, plain-text content, compact high-contrast moods, and strict `interaction > guidance > response > pet > activity` precedence. |
| 6 | Add the local Settings control | Complete | Threaded the controlled draft through loading, both full save paths, change detection, save feedback, English/Vietnamese copy, and successful-write service updates. |
| 7 | Document the privacy boundary | Complete | Documented explicit local state, curated messages, and the absence of app/site/screen/input observation, pet telemetry, teacher reporting, or classroom evidence. |
| 8 | Verify and audit | Complete | Focused tests, lint, typecheck, the full repository check, production packaging, privacy/IPC greps, whitespace review, and the full diff audit passed. |

## Validation Results

| Level | Status | Evidence |
|---|---|---|
| Focused tests | Pass | 8 files / 103 tests |
| PR contract audit | Pass | Latest `main`: 10 files / 141 tests, including explicit disabled-preference propagation across IPC plus renderer precedence/settings and customization regressions |
| Lint | Pass | `npm run lint` |
| Typecheck | Pass | `npm run typecheck` |
| Full repository gate | Pass | Latest `main` `npm run check`: canonical protocol check, 110 Vitest files / 677 tests, admin/runtime checks, Cargo format, Clippy, audit, and Rust tests |
| Bazel | Pass | Latest `main` `npm run bazel:check`: 14 tests and `//services/api:clippy` |
| Package | Pass | `npm run package`: production-configured macOS arm64 Electron package |
| Privacy audit | Pass | No service matches for network, Electron, analytics, CUA, browser/app, cursor, keyboard, or YouTube observation |
| IPC audit | Pass | Fixed desktop API channel plus parsed preload listener/cleanup; no `register-ipc.ts` handler |
| Diff audit | Pass | `git diff --check` and manual review found no whitespace error, authority widening, pet-content logging, secret/config change, or generated artifact |

The feature did not modify Rust, Cargo manifests, Bazel configuration, or Rust
CI, but the Bazel gate was run as an additional PR preflight and passed.

## Files Changed

| Area | Files | Action |
|---|---:|---|
| Shared contracts and desktop API | 3 | Updated |
| Preferences and scheduling policy | 4 | 2 created, 2 updated |
| Electron overlay integration and selector | 3 | Updated |
| Preload and IPC fixture | 2 | Updated |
| Renderer component, Settings, localization, and styles | 11 | 2 created, 9 updated |
| Product and verification documentation | 2 | 1 created, 1 updated |

The implementation touches 25 feature files: 5 created and 20 updated. This
report and the archived plan are workflow artifacts outside that count.

## Deviations from Plan

- Two adjacent exhaustive fixtures, `src/main/ipc/register-ipc.test.ts` and
  `src/renderer/language-options.test.ts`, needed small updates for the expanded
  typed preference/API surfaces. This accounts for the one-file increase over
  the estimate after consolidation with the planned files.
- The repository supplement references `docs/CODEX-NAVIGATION-GUIDE.md`, but
  that file is absent in this checkout. The PRP's mandatory-reading and unified
  discovery maps supplied the implementation navigation evidence instead.
- Signed-in Electron journeys remain manual because this run had no live
  classroom account/UI session. Automated tests cover the underlying policy,
  exact timer boundaries, identity cleanup, overlay precedence, settings
  lifecycle, plain-text rendering, and packaging.

There were no functional scope deviations: no YouTube/app/site detection,
screen/cursor/typing/attention/idle observation, model/chat/TTS path, new
BrowserWindow, backend route, analytics event, classroom event, dependency,
database migration, or Rust change was added.

## Issues Encountered

- The worktree initially had no installed root dependencies. `npm ci` restored
  the exact lockfile environment and reported zero npm vulnerabilities.
- Initial static analysis found import ordering plus strict test/catalog
  indexing errors. Those were corrected before all required gates passed.
- Windows CI correctly exposed that POSIX permission mode bits are not portable.
  The file store still requests mode `0600`, while the exact bit assertion now
  runs only on platforms that implement POSIX modes.
- Cargo audit surfaced the repository-allowed `ttf-parser`
  (`RUSTSEC-2026-0192`) and `lru` (`RUSTSEC-2026-0253`) warnings; the configured
  audit gate passed. Repository-configured PostgreSQL/S3 integration cases
  remained ignored.

## Manual Follow-up

- Exercise the signed-in lobby/live/ended and Help/Ready/Submit/Complete flows
  at real wall-clock cadence.
- Confirm mouse-through, focus, reduced-motion, default/custom companion, and
  multi-display/negative-coordinate behavior in packaged Electron.
- Inspect a teacher dashboard and analytics session while exercising the pet to
  independently confirm that no pet event or content appears.

These are environment-dependent UX checks, not unimplemented code paths.
