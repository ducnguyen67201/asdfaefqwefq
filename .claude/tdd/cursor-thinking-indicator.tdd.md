# Cursor thinking indicator — TDD evidence

## Source and user journey

No plan file was supplied. The journey was derived from the reported defect:

> As a learner who has submitted a request, I want visible activity around the
> action cursor while Tro is sending, thinking, or working, so I know the
> application accepted my request and has not stalled.

## RED and GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED: missing state delivery and visual | `npm exec -- vitest run src/renderer/CursorBuddy.test.ts src/main/companion/companion-state-broadcast.test.ts --reporter=verbose` | Expected failure | The broadcaster module was absent, the cursor did not subscribe to lifecycle state, and the busy markup/keyframes were missing. Checkpoint: `687afdc`. |
| GREEN: activity ring connected | Same focused Vitest target | PASS — 2 files / 8 tests | Both active auxiliary windows receive parsed state; the cursor renders and cleans up its subscription; busy and reduced-motion CSS hooks are present. Checkpoint: `308bc53`. |

## Test specification

| # | Guarantee | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Working state is delivered to both the desktop pet and the action cursor | `src/main/companion/companion-state-broadcast.test.ts` | Unit | PASS |
| 2 | Missing or destroyed auxiliary windows are skipped safely | `src/main/companion/companion-state-broadcast.test.ts` | Unit | PASS |
| 3 | Sending, thinking, and working state can produce a visible, accessible busy hook around the action cursor | `src/renderer/CursorBuddy.test.ts` | Component | PASS |
| 4 | Cursor state subscriptions render updates and unsubscribe on unmount | `src/renderer/CursorBuddy.test.ts` | Component integration | PASS |
| 5 | The spinner animates with `transform` and becomes a static signal under Reduce Motion | `src/renderer/CursorBuddy.test.ts`, `src/index.css` | Accessibility/style | PASS |

## Coverage and release gates

- Focused coverage: 92.85% statements, 90.47% branches, 87.5% functions,
  and 95.83% lines.
- `npm run check`: PASS — 65 Agents SDK tests, 854 desktop tests, and 71
  Rust library tests. The existing allowed `ttf-parser`, `lru`, and
  `chacha20` audit warnings remain unchanged.
- `npm run package`: PASS for macOS arm64.

## Known gap

The multi-window Electron behavior is covered at the broadcaster and renderer
boundaries and the packaged app compiles successfully. Perceived ring size and
pacing should still be visually smoke-tested on a live desktop cursor.

## Merge evidence

Preserve the RED/GREEN mapping above if these commits are later squash-merged.
