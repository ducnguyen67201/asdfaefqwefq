# Implementation Report: Deterministic Coach Target Highlighting

## Summary

Removed rectangle sizing from every Coach model boundary. A Coach step now
contains a semantic target label plus one normalized center point tied to the
fresh observation identity. The runtime maps that point through the existing
normalized-to-screenshot-to-desktop coordinate pipeline and passes no
`screenRegion` to Cursor Buddy.

The trusted presentation host remains the sole owner of highlight geometry. It
uses the existing fixed 76x76, display-clamped point marker, so an oversized or
inconsistent model rectangle can no longer produce the `Coach target region is
too broad` failure. This adds no repair inference, observation, TTS request,
native cursor movement, dependency, feature flag, or persistence.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium-small; the trusted point path already existed |
| Confidence | 9/10 | High for automated coverage; live signed-in Scratch visual pass remains manual |
| Files Changed | 6 updated | 6 scoped files updated, plus this report |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Lock point authority with tests | [done] Complete | Added strict rejection of legacy `region`; provider and presentation assertions cover point-only output |
| 2 | Remove rectangle authority from Coach contracts | [done] Complete | Domain, raw response, strict provider JSON schema, prompt, and normalization now agree |
| 3 | Narrow grounding to the verified point pipeline | [done] Complete | Preserved freshness checks and both existing coordinate transforms; removed all Coach region mapping |
| 4 | Exercise the trusted point marker through Cursor Buddy | [done] Complete | Default step has no region and asserts `showHighlight(point, undefined)` |
| 5 | Document geometry ownership | [done] Complete | Architecture docs now assign meaning/point to the model and dimensions/clamping to the host |
| 6 | Consolidated verification | [done] Automated complete | Repository checks and macOS arm64 packaging pass; live visual check remains manual |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Diff hygiene | [done] Pass | `git diff --check` returned no whitespace errors |
| Static analysis | [done] Pass | Agent runtime and desktop lint/typecheck; Rust fmt and clippy |
| Unit tests | [done] Pass | Agent runtime: 23; desktop Vitest: 850; available Rust unit/compatibility tests passed |
| Build | [done] Pass | Electron Forge packaged macOS arm64 successfully |
| Integration | [done] Automated pass | Existing runtime, presentation, coordinate, and IPC coverage passed; PostgreSQL/S3-gated Rust tests remained intentionally ignored |
| Edge cases | [done] Pass | Existing tests cover Retina scaling, negative display origins, point-marker clamping, stale evidence, cancellation, Reduce Motion, and no native pointer movement |
| Manual Scratch visual pass | [next] Not run | Requires the live signed-in Electron session and the Scratch surface that reproduced the issue |

Rust audit completed with the three repository-allowed warnings: unmaintained
`ttf-parser`, the allowed `lru` advisory, and yanked `chacha20`. No Rust or
dependency files were changed for this PRP.

## Files Changed

| File | Action | Scope |
|---|---|---|
| `src/main/coach/coach-contracts.ts` | UPDATED | Removed model-owned normalized region and region validation |
| `src/main/coach/coach-runtime.ts` | UPDATED | Removed region schema/prompt/mapping/presentation flow |
| `src/main/coach/coach-runtime.test.ts` | UPDATED | Added strict contract regression and point-only provider/runtime assertions |
| `src/main/companion/cursor-buddy-controller.test.ts` | UPDATED | Made point-only highlighting the primary teaching path |
| `docs/architecture.md` | UPDATED | Documented model/host geometry ownership |
| `docs/conversational-task-execution.md` | UPDATED | Documented fixed host marker and no repair call |

## Deviations from Plan

- Did not run `git pull --rebase`. The feature branch has substantial
  user-owned staged, untracked, and modified work; rebasing would risk changing
  or conflicting with that work.
- Deduplicated the plan's focused and full validation commands into one
  `npm run check`, as required by the implementation workflow. The full suite
  includes the focused Coach, coordinate, Cursor Buddy, and marker tests.
- Did not automate the live Scratch visual checklist. The app package and
  deterministic boundaries are verified, but visual target accuracy on the
  signed-in lesson must be judged in the running desktop app.
- Retained optional `CursorBuddyStep.screenRegion` for future trusted host
  geometry. The Coach model/runtime path can no longer populate it.

## Issues Encountered

None during the consolidated validation pass.

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/main/coach/coach-runtime.test.ts` | 1 new regression test plus strengthened runtime/provider assertions | Rejects a legacy `region`, proves the strict response schema omits it, and verifies only the mapped point reaches presentation |
| `src/main/companion/cursor-buddy-controller.test.ts` | Strengthened primary sequence test | Proves Cursor Buddy invokes point-only highlighting after its teaching glide |
| Existing coordinate/placement tests | Reused in full suite | Retina/negative-origin mapping and exact 76x76 display-clamped marker geometry |

## Next Steps

- [ ] Restart the Electron main process with `rs`.
- [ ] Re-run “Cách làm bài tập này.” on the original Scratch lesson and confirm the compact marker surrounds the intended control.
- [ ] Confirm Cursor Buddy moves while the learner's operating-system cursor remains untouched.
- [ ] Repeat near a Retina display edge and, if available, on a secondary display.
- [ ] Run `/code-review` before committing, then `/prp-pr` when the live visual pass is accepted.
