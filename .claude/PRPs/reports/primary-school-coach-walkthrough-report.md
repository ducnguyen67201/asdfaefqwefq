# Implementation Report: Primary-School Coach Walkthrough

## Summary

Implemented an adaptive, voice-led coaching loop for visible student tasks. Natural Vietnamese requests now enter walkthrough mode; each grounded `show_guidance` call carries a short hook, one learner action, one reason, and an expected outcome. Tro speaks the hook while gliding, reveals the target on arrival, speaks the action and reason without overlap, then waits for stable learner screen activity or an explicit learner control before the Agents SDK re-observes and decides what comes next.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | High | High |
| Confidence | Medium-high | High after validation |
| Files Changed | Approximately 20-25 | 21 updated, 4 implementation/test files created |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Natural Vietnamese walkthrough routing | Done | Includes `Cách làm bài tập Scratch này.` regression coverage |
| 2 | Structured coach-step contract | Done | Bounded hook, instruction, reason, expected outcome, language, target, and fresh observation ID |
| 3 | Learner-gated lifecycle | Done | Tool completion is delayed until stable activity, explicit continue, or bounded timeout |
| 4 | Synchronized presentation | Done | Hook and glide run together; highlight reveals on arrival; action/reason follows without speech overlap |
| 5 | Learner controls | Done | Localized Replay, Pause/Resume, and “I did it” controls through narrow validated IPC |
| 6 | Fresh observation and recovery | Done | Screen changes are detected locally; the model must re-observe and compare the prior expected outcome |
| 7 | Primary-school engagement constraints | Done | Short copy, one action, one reason, warm language, no invented total, no unverified success |
| 8 | Tests and validation | Done | Policy, schema, timing, gating, cancellation, IPC, accessibility, and integration coverage |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static analysis | Pass | SDK lint/typecheck, application lint/typecheck, Rust fmt/clippy |
| Unit tests | Pass | 68 SDK tests, 861 application tests, 71 Rust unit tests plus compatibility suites |
| Build/package | Pass | Electron Forge packaged macOS arm64 successfully |
| Integration | Pass | Fake CUA guidance dispatch, learner activity evidence, IPC boundary, and ordered presentation flow |
| Edge cases | Pass | Unchanged screen, stable change, repeat, pause/resume, explicit continue, cancellation, timeout, stale target region |
| Security audit | Pass with allowed warnings | Existing `ttf-parser`, `lru`, and yanked `chacha20` warnings only |

## Files Changed

Key implementation files:

| File | Action |
|---|---|
| `services/agent-runtime/src/walkthrough-runtime.ts` | Updated routing and teacher instructions |
| `services/agent-runtime/src/tool-adapter.ts` | Updated result hook to preserve learner evidence |
| `services/agent-runtime/src/local-runtime-server.ts` | Applied timeout-aware walkthrough progress |
| `src/main/presentation/coach-presentation-sequence.ts` | Created synchronized motion/voice sequence |
| `src/main/presentation/learner-action-gate.ts` | Created bounded screen-change and learner-control gate |
| `src/main/agent/runtime-tool-registry.ts` | Added strict structured coach-step tool schema |
| `src/main/agent/execution-coordinator.ts` | Returned learner evidence with guidance results |
| `src/shared/contracts.ts` | Added coach copy, phase, and learner-action IPC schemas |
| `src/shared/desktop-api.ts`, `src/preload.ts`, `src/main/ipc/register-ipc.ts` | Added narrow guidance action IPC |
| `src/index.ts` | Wired presentation, narration, overlay-safe observation, and learner gate |
| `src/renderer/GuidanceCallout.tsx`, `src/index.css` | Added localized interactive coach controls and states |

## Deviations from Plan

- The learner wait remains inside the already checkpointed guidance tool execution, bounded to 75 seconds so it stays below the existing 180-second tool bridge timeout. A separate suspended-task protocol was not added because the current durable pre-effect checkpoint already provides safe cancellation/restart behavior with less protocol surface.
- Application mismatch is handled after the mandatory fresh observation by the Agents SDK instruction, rather than by an OS-specific active-application API. This preserves cross-platform behavior and still prevents blind clicking; Tro can only point and coach.
- Success feedback is intentionally produced only by the next grounded model observation. The host does not fabricate praise from a pixel change.

## Issues Encountered

- Initial lint found import ordering, one React callback dependency, and JSX in a `.ts` test; corrected locally.
- Type checking found an attempted merge from a native point receipt that has no data field; learner evidence is now attached as new trusted result data.
- One cancellation test attached its rejection assertion too late; the handler is now installed before aborting.

## Tests Written

| Test area | Coverage |
|---|---|
| Walkthrough runtime | Production Vietnamese request, child-friendly prompt, learner timeout behavior |
| Coach presentation sequence | Voice/motion concurrency, reveal ordering, no narration overlap |
| Learner action gate | Stable changes, unchanged screens, replay, pause/resume, explicit continue, cancellation |
| Runtime tool registry | Strict structured fields, bounds, language, coordinate grounding |
| Execution coordinator | Learner activity and expected-outcome evidence |
| IPC | Trusted companion sender and parsed learner action |
| Renderer/contracts | Localized controls, learner status, pointer interaction, bounded coach copy |

## Next Steps

- Run a manual Vietnamese Scratch lesson with a primary-school learner to tune the 75-second wait and narration lengths.
- Review the implementation before committing.
