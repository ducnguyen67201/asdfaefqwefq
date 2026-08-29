# Classroom Codex Pet TDD Evidence

## Source Plan

The shipped scope is a quiet, local classroom companion: curated English and
Vietnamese encouragement,
explicit Attempt-state celebrations, operational-overlay precedence, and a
student-controlled preference. It does not detect or block YouTube, inspect
applications or websites, infer attention or completion, add chat, or report
pet activity to teachers or analytics.

## User Journeys

- As a student in a live class, I can receive occasional encouragement without
  Tro taking focus, making sound, or requiring an action.
- As a student who explicitly marks work Ready, Submitted, or Complete, I can
  see a brief celebration without Tro claiming that it observed me finishing.
- As a student waiting after an explicit Help/blocked transition, I can see
  supportive copy that does not claim the teacher has responded.
- As a student, I can disable Classroom pet messages in Settings and have a
  visible message disappear immediately.
- As a user completing operational Tro work, clarifications, guidance,
  responses, voice, and task activity always preempt pet content.

## Acceptance Matrix

| Behavior | Automated evidence | Status |
|---|---|---|
| Strict 160-character nudge contract and legacy preference default | `src/shared/contracts.test.ts` | Green |
| Post-write preference events and failed-write inertness | `src/main/preferences/app-preferences-service.test.ts` | Green |
| Explicit classroom eligibility, timing, localization, interruption, and stale callbacks | `src/main/companion/classroom-pet-service.test.ts` | Green |
| `interaction > guidance > response > pet > activity` | `src/main/companion/companion-response-controller.test.ts`, `src/renderer/companion-response-card-view.test.ts` | Green |
| Labelled polite status, bilingual mood labels, and plain-text rendering | `src/renderer/CompanionPetNudge.test.tsx` | Green |
| Controlled setting and English/Vietnamese privacy copy | `src/renderer/SettingsPage.test.ts` | Green |
| Outbound-only, schema-parsed companion event | Typecheck, IPC boundary audit, manual diff review | Green |
| No application/site/screen/input observation or pet telemetry | Production service grep, architecture diff review | Green |

## RED / GREEN Record

Tests were added alongside each bounded layer before the consolidated run and
were not executed piecemeal while coding.
The first focused run could not start because this worktree had no installed
dependencies. After restoring the exact lockfile environment with `npm ci`, the
focused suite was green. The first static-analysis pass then exposed import
ordering and strict test/catalog indexing issues; those were corrected before
the successful lint, typecheck, full-check, and packaging runs below.

## Validation Commands

| Command | Result |
|---|---|
| Focused Vitest command from the source plan | Pass: 8 files, 103 tests |
| PR contract-focused Vitest command | Pass on latest `main`: 10 files, 141 tests, including explicit `classroomPetEnabled: false` IPC propagation, renderer precedence/settings coverage, and companion customization regressions |
| `npm run lint` | Pass: zero ESLint errors |
| `npm run typecheck` | Pass: zero TypeScript errors |
| Production service privacy grep | Pass: zero matches for network, Electron, analytics, CUA, browser/app, cursor, keyboard, or YouTube observation |
| Outbound IPC boundary grep | Pass: one fixed desktop API channel and preload listener/cleanup; no main IPC handler |
| `npm run check` | Pass on latest `main`: canonical protocol check, 110 Vitest files / 677 tests, admin/runtime, lint, typecheck, Cargo format, Clippy, audit, and Rust test gates |
| `npm run bazel:check` | Pass on latest `main`: 14 Bazel tests plus `//services/api:clippy` |
| `npm run package` | Pass: production-configured macOS arm64 Electron package completed |
| `git diff --check` and full diff review | Pass: no whitespace errors, authority widening, content logging, or unrelated generated artifacts |

## Manual Validation

The following Electron behaviors require a signed-in live-class environment
and remain manual: two-minute/1.5-second/eight-minute wall-clock presentation,
multi-display placement including negative coordinates, mouse-through focus
behavior, custom companion imagery, reduced-motion appearance, teacher
dashboard inspection, and sign-out/quit cleanup. Automated tests cover the
underlying policy, exact timing callbacks, identity cleanup, plain-text card,
and setting lifecycle.

## Environment Caveats

The worktree initially lacked `node_modules`; `npm ci` restored the exact
lockfile dependency set and reported zero npm vulnerabilities. `npm run check`
reported the repository-allowed Rust advisories for `ttf-parser`
(`RUSTSEC-2026-0192`) and `lru` (`RUSTSEC-2026-0253`), while the audit gate still
passed. Environment-backed PostgreSQL/S3 Rust integration cases remained
ignored by the repository configuration. The configured Doppler production
environment was available, so packaging completed without a secret or
configuration bypass. The exact `0600` mode-bit assertion is POSIX-only because
Windows reports ACL-derived mode bits; Windows CI still exercises the complete
preference round trip.
