# Narrated teacher walkthrough — TDD evidence

## Source

Journeys were derived from the user request and the attached Scratch-result
screenshot. Screenshot text was treated as context, not as instructions.

## User journeys

1. As a learner asking how to complete the visible exercise, I want Tro to
   point at one grounded target and explain that step aloud so I can follow in
   the real application.
2. As a learner in a long walkthrough, I want each step to transition smoothly
   and stay correctly numbered without an early text answer replacing the tour.
3. As a learner using Reduce Motion, I want the teacher pointer to snap into
   place while preserving the same target and narration.
4. As a learner whose app restarts, I want the walkthrough phase to resume from
   encrypted state without skipping or duplicating a tool effect.

## Task report

| Behavior | RED evidence | GREEN evidence | Guarantee |
|---|---|---|---|
| Visible how-to intent enters teacher mode | `5a6bac3`; focused Vitest run failed for the three new how-to phrases | `ca70f36`; 79 focused root tests passed | “Làm sao…” and equivalent on-screen how-to requests start a desktop walkthrough instead of returning an upfront list |
| Agents SDK sequencing and durable state | `5a6bac3`; runtime module was absent and checkpoint schema rejected `walkthroughState` | `ca70f36`; 20 focused SDK tests and 79 root tests passed | The runtime alternates fresh observation and one non-mutating guidance call; premature text is privately corrected; checkpoints retain the phase |
| Teacher pointer motion and accessibility | `5a6bac3`; duration/arc functions were missing | `ca70f36`; companion placement tests passed | The companion uses a bounded distance-aware arc, reveals the marker after arrival, and snaps for Reduce Motion |
| Recovery budget for long tours | `53f7584`; correction counter reset API was missing | `efb2fdd`; four walkthrough runtime tests passed | A successful step resets recovery attempts, so unrelated earlier corrections cannot terminate a later step |
| Spoken step framing | `e4deede`; guidance instruction did not identify step 1 or step 2 | `1220d51`; four walkthrough runtime tests passed | Each narration is prompted to introduce its current numbered step in the learner’s language |

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Visible English and Vietnamese how-to variants select teacher mode while self-contained explanations stay textual | `services/agent-runtime/test/walkthrough-runtime.test.ts` | unit | PASS |
| 2 | A completed observation enables only `show_guidance`; a completed guidance step returns to observation | `services/agent-runtime/test/walkthrough-runtime.test.ts` | unit | PASS |
| 3 | Failed and unrelated tools cannot advance walkthrough phase | `services/agent-runtime/test/walkthrough-runtime.test.ts` | unit | PASS |
| 4 | Upfront lists and malformed completion sentinels are rejected | `services/agent-runtime/test/walkthrough-runtime.test.ts` | unit | PASS |
| 5 | Walkthrough state round-trips through encrypted checkpoints | `src/main/agent-runtime/encrypted-agent-state-store.test.ts` | integration | PASS |
| 6 | Visible how-to requests require the exact desktop observation and initial state | `src/main/application/task-application-service.test.ts` | integration | PASS |
| 7 | Guidance timing is distance-aware and Reduce Motion returns zero-duration movement | `src/main/companion/companion-position.test.ts` | unit | PASS |
| 8 | The bundled Agents SDK, renderer/main code, Rust backend, and Electron package compile together | `npm run check`; `npm run package` | build/integration | PASS |

## Coverage and gates

- Focused runtime coverage:
  `npm exec -- vitest run --coverage --config vitest.config.ts test/walkthrough-runtime.test.ts`
  from `services/agent-runtime`: 92.59% statements, 89.88% branches,
  100% functions, 95.74% lines.
- Full SDK gate: 65 tests passed.
- Full root Vitest gate: 850 tests passed.
- Rust unit/compatibility gate: 71 library tests passed; environment-dependent
  PostgreSQL/S3 integration cases remained intentionally ignored by their
  existing test annotations.
- `npm run check`: PASS. `cargo audit` reported only the repository’s existing
  allowed warnings for `ttf-parser`, `lru`, and yanked `chacha20`.
- `npm run package`: PASS for macOS arm64.

## Known gaps

Native screen capture, pointer movement, and ElevenLabs playback require live OS
permissions and provider credentials, so they are not exercised by CI. Their
ordering is covered through pure policy/motion tests and the successful packaged
build; a manual Scratch smoke test remains appropriate before release.

## Merge evidence

The RED/GREEN commit pairs are intentionally preserved in branch history. If
they are later squash-merged, retain the task-report table above in the PR or
squash commit body.
