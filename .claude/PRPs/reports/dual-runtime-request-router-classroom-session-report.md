# Implementation Report: Fast Coach and Heavy Agent Routing

## Summary

Implemented one task entry point with exactly two locally selected execution
lanes. `TaskApplicationService` resolves trusted classroom/workspace context,
persists the v11 authority contract, and starts either the new non-mutating
`CoachRuntime` or the existing OpenAI Agents SDK runtime. The pure router makes
no network or model request.

Coach captures one fresh screen observation when required, requests one strict
structured decision, validates observation identity and tight normalized target
coordinates, then presents through the existing `CursorBuddyController`, target
highlight, compact callout, and ElevenLabs narration. The learner's operating-
system cursor is never moved. Waiting, Repeat, Pause, and the visible timer are
local; normal waiting is indefinite and performs no capture or model polling.
One debounced learner activity produces one fresh observation and one next
decision.

Heavy Agent no longer owns walkthrough state, prompt correction, or a
`show_guidance` tool. Its SDK session, checkpoint-before-dispatch, approval,
invocation journal, cancellation, budgets, and uncertain-outcome/no-replay
protections remain intact.

## Assessment vs Reality

| Metric | Predicted | Actual |
|---|---|---|
| Complexity | Large | Large |
| New architectural components | 2 | 2: `TaskRequestRouter`, `CoachRuntime` |
| New files | 5 | 5 |
| Confidence | High after consolidated validation | High for automated behavior and package integrity; live signed-in Scratch visual feel remains manual |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Contracts and pure router | Complete | Added v11 route/runtime authority, explicit requested mode, bounded Coach progress, strict decision schemas, and English/Vietnamese routing corpus |
| 2 | Coach runtime | Complete | One current observation, one structured response, evidence/coordinate validation, one paid-turn reservation per Coach session, zero automatic retries |
| 3 | Activity-gated Cursor Buddy | Complete | Coarse pointer activity, local debounce, no idle polling, stable mounted callout/highlight, local Replay/Pause, real cursor isolation |
| 4 | Existing facade and classroom continuity | Complete | Route once after trusted context resolution, persist before runtime start, reuse exact owner/Attempt/version progress, cancel invalid inherited sessions |
| 5 | Heavy Agent cleanup | Complete | Removed walkthrough prompt/state/tool branches and `show_guidance`; retained all autonomous execution safety mechanisms |
| 6 | UX, rollout, docs, and verification | Complete | Stable transcript/thinking path, no Coach callout entrance animation, no “I'm done?” loop, one `TROCODE_FAST_COACH_ENABLED` kill switch, architecture/cost docs updated |

## Expected Runtime Behavior

```text
voice or typed request
  -> TaskApplicationService resolves trusted context once
  -> pure TaskRequestRouter selects Coach or Agent once

Coach:
  observe once -> one decision -> Buddy/highlight/callout/speech
  -> wait locally with zero calls/captures
  -> learner activity -> debounce -> one observation -> one decision

Agent:
  existing Agents SDK -> policy/checkpoint -> tool -> verify -> continue
```

Explicit “do it for me,” mutations, and workspace work use Agent. Visible
how-to, classroom Help/Check, and required-screen ambiguity use Coach. Plain
questions use Coach without a screenshot. An explicit disabled screen policy is
preserved. Coach cannot inherit workspace execution authority or any mutating
tool dependency.

## Validation Results

| Gate | Result |
|---|---|
| Focused Coach/router/classroom/state tests | Pass |
| Bundled Agents SDK tests | 5 files, 23 tests passed |
| Full desktop Vitest suite | 131 files, 847 tests passed |
| Full Rust unit/compatibility suite | Pass; environment-gated PostgreSQL/S3 tests intentionally ignored |
| Lint and TypeScript | Pass |
| Rust format and clippy | Pass |
| `npm run check` | Pass |
| `npm run package` | Pass; Electron Forge packaged macOS arm64 |
| `git diff --check` | Pass |

`cargo audit` completed under the repository policy with three existing allowed
warnings: unmaintained `ttf-parser`, the `lru` advisory, and yanked `chacha20`.
No dependency, Cargo, Rust, CUA driver, or Bazel files changed, so
`npm run bazel:check` was not required.

## Independent Review

The final review found two high-severity integration defects and both were
addressed:

1. The first Coach request shape omitted proxy-required no-tool fields, which
   could reproduce the historical `400 Responses request is invalid`. Coach now
   sends `tools: []`, `parallel_tool_calls: false`, `store: false`, and a bounded
   output limit; a regression test inspects the dispatched payload.
2. A bounded learner timeout could leave a logically active but non-resumable
   Coach session. Normal teaching now waits indefinitely on coarse learner
   activity without timers, captures, or model calls. A genuine presentation
   failure terminates and releases the task cleanly.

The reviewer rechecked both fixes and reported no remaining issue. Focused tests
for the repaired flow passed (3 files, 16 tests).

## Key Files

| Area | Files |
|---|---|
| Routing and lifecycle | `src/main/application/task-request-router.ts`, `src/main/application/task-application-service.ts`, `src/main/agent/task-runtime.ts` |
| Coach | `src/main/coach/coach-contracts.ts`, `src/main/coach/coach-runtime.ts` |
| Presentation/activity | `src/main/companion/cursor-buddy-controller.ts`, `src/main/presentation/learner-action-gate.ts`, `src/renderer/GuidanceCallout.tsx` |
| Persistence/classroom | `src/main/agent-runtime/encrypted-agent-state-store.ts`, existing `ClassroomSessionService` and `ActivityContextService` |
| Heavy Agent | `services/agent-runtime/src/local-runtime-server.ts`, `services/agent-runtime/src/protocol.ts`, `src/main/agent/runtime-tool-registry.ts` |
| Contracts/composition | `src/shared/contracts.ts`, `src/index.ts` |

## Deviations and Constraints

- Did not pull or rebase. The branch already contained substantial user-owned
  staged and uncommitted media, tour, voice, and Cursor Buddy changes; mutating
  that state would have been unsafe.
- Retained legacy v10 history/checkpoint parsing so completed history remains
  readable. New tasks use v11 and new Heavy Agent checkpoints omit walkthrough
  state.
- Global learner activity currently uses a content-free pointer-change signal.
  It does not persist or transmit coordinates, keys, screenshots, audio,
  secrets, consent, or classroom codes as Coach progress.
- A live signed-in Scratch session is still the appropriate final product check
  for target feel, narration pacing, Retina/secondary-display placement, and
  child engagement. Automated tests cover coordinate mapping, stale-target
  rejection, call counts, cursor isolation, stable presentation, and package
  integrity.

## Next Steps

- Run one live Scratch walkthrough in the packaged app on the primary Retina
  display, then one on a secondary display.
- Capture transcript-to-first-step p50/p95 metrics under supported production
  network conditions; the architecture now enforces one initial model call but
  cannot prove network latency in a local test.
- Roll back routing with `TROCODE_FAST_COACH_ENABLED=false` if production Coach
  behavior needs to be disabled; this never shadow-runs both runtimes.
