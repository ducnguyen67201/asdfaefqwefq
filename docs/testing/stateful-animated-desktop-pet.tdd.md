# Stateful animated desktop pet verification record

## Scope

This change adds a nine-row bundled sprite atlas, pure animation precedence,
ephemeral local hover detection, generalized passive pet nudges, and sparse
task-phase encouragement. The Electron renderer remains sandboxed and receives
only validated projections.

## Test-first coverage authored

| Area | Test file | Required evidence |
|---|---|---|
| Animation rows and precedence | `src/renderer/companion-animation.test.ts` | Eight operational states, idle hover, six nudge moods, custom fallback |
| Hover geometry and lifecycle | `src/main/companion/companion-hover-tracker.test.ts` | Edges, inset, transition dedupe, eligibility cleanup, Wayland |
| Task nudge timer service | `src/main/companion/task-pet-service.test.ts` | Exact delays, phase changes, busy retry, stale task, preference, bilingual rotation |
| Shared boundaries | `src/shared/contracts.test.ts` | Six strict moods and boolean-only hover payload |
| Passive nudge rendering | `src/renderer/CompanionPetNudge.test.tsx` | Bilingual labels, polite status, escaped plain text, no controls |
| Companion rendering | `src/renderer/CursorCompanion.test.ts` | Bundled sprite markup and unchanged custom URL path |
| Settings/localization | `src/renderer/SettingsPage.test.ts`, `src/renderer/app-language.test.ts` | Accurate local-only hover and task-message copy |
| Pet picker/generator | `src/renderer/CompanionCustomizationCard.test.ts` | Animated default, generated library, creation entry point, and bilingual labels |

The PRP implementation workflow requires one consolidated validation pass after
coding. RED/GREEN command output is recorded below after that pass rather than
running checks after each file.

## Automated validation

| Gate | Result | Notes |
|---|---|---|
| Atlas metadata and size | Pass | 768 x 1152 RGBA PNG, 978,567 bytes, transparent alpha; the packaged ASAR contains the same 978,567-byte atlas |
| Focused Vitest suite | Pass | Covered by the consolidated full Vitest run: 124 files and 821 tests passed |
| Lint and typecheck | Pass | ESLint and `tsc --noEmit` passed in the repository check |
| Coverage | Not run separately | The implementation workflow deduplicates validation; the full 821-test suite covered the focused areas without a second coverage rerun |
| `npm run check` | Pass after focused retry | Protocol/admin/runtime/Rust-only checks, lint, typecheck, Cargo fmt/clippy/audit, 821 Vitest tests, and all runnable Rust suites passed; environment-dependent PostgreSQL/S3 tests remained explicitly ignored |
| `npm run package` | Pass | Electron Forge produced `out/Tro-darwin-arm64/Tro.app`; webpack included the RGBA atlas and the release `trocode-api` sidecar |

## Packaged manual matrix

| Platform/mode | Drag | Click-through | Hover | State rows | Nudges | Reduced motion |
|---|---|---|---|---|---|---|
| macOS native window | Not manually exercised in this noninteractive run | N/A outside pet | Not manually exercised | Not manually exercised | Not manually exercised | Not manually exercised |
| Windows virtual-desktop overlay | N/A | Not available on this host | Not available on this host | Not available on this host | Not available on this host | Not available on this host |
| Linux X11 native window | Not available on this host | N/A outside pet | Not available on this host | Not available on this host | Not available on this host | Not available on this host |
| Linux Wayland | Not available on this host | Not available on this host | Expected disabled | Not available on this host | Not available on this host | Not available on this host |
