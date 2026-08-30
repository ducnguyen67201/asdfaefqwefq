# Separate Cursor Buddy TDD Evidence

## Source and user journey

No plan file was supplied. The journey was derived from the requested behavior:

> As a Tro user, I want the action cursor and desktop pet to be separate
> characters, so the cursor can follow performed pointer actions while the pet
> remains an independent desktop companion.

## RED and GREEN evidence

| Stage | Command | Result | Evidence |
|---|---|---|---|
| RED: distinct renderer and scheduler | `npx vitest run src/main/companion/cursor-buddy-follow-policy.test.ts src/renderer/CursorBuddy.test.ts --reporter=verbose` | Expected failure | Both suites failed because `CursorBuddy` and `cursor-buddy-follow-policy` did not exist. Checkpoint: `6388bb1`. |
| GREEN: restored behavior | Same focused Vitest command | PASS | 2 files, 7 tests passed. The buddy uses the original cursor asset, stays distinct from the pet, tracks overlay positions, unsubscribes on unmount, and reduces idle polling. |
| RED: overlay subscription | `npx vitest run src/renderer/CursorBuddy.test.ts --reporter=verbose` | Expected failure | The new mounted test observed zero subscriptions before the component accepted the injected overlay mode. Checkpoint: `abe3bec`. |
| GREEN: overlay subscription | Same renderer Vitest command | PASS | Position subscription, rendered transform updates, and cleanup all passed. Implementation checkpoint: `506d9bb`. |
| RED: initial overlay handshake | `npx vitest run src/renderer/CursorBuddy.test.ts src/main/ipc/register-ipc.test.ts --reporter=dot` | Expected failure | The renderer subscribed but never requested the already-sent initial position, and no trusted IPC handler existed. |
| GREEN: initial overlay handshake | Same focused Vitest command | PASS | 2 files, 44 tests passed. The cursor buddy subscribes before requesting its current position, and the main process accepts the request only from the authenticated cursor-buddy renderer. |

## Test specification

| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | The cursor buddy renders the original `tro-cursor-buddy.png`, while the desktop pet renders its own asset | `src/renderer/CursorBuddy.test.ts` | Component | PASS |
| 2 | Windows overlay-local coordinates are rendered without affecting native-window mode | `src/renderer/CursorBuddy.test.ts` | Component | PASS |
| 3 | The overlay subscribes to parsed positions, renders updates, and removes its listener on unmount | `src/renderer/CursorBuddy.test.ts` | Component integration | PASS |
| 4 | A Windows overlay receives its initial position after subscribing, even when the pointer remains stationary | `src/renderer/CursorBuddy.test.ts`, `src/main/ipc/register-ipc.test.ts` | IPC/component integration | PASS |
| 5 | Moving pointers use 16 ms tracking with a 250 ms active tail | `src/main/companion/cursor-buddy-follow-policy.test.ts` | Unit | PASS |
| 6 | Stationary pointers use 125 ms polling, reducing polling by more than 80% | `src/main/companion/cursor-buddy-follow-policy.test.ts` | Unit | PASS |
| 7 | The desktop-pet preference affects only the pet; the cursor buddy has an independent authenticated window lifecycle | `npm run typecheck`, `npm run package`, and code-path review | Integration/build | PASS |

## Coverage and release gates

- `CursorBuddy.tsx`: 87.5% statements, 88.88% branches, 100% functions,
  and 100% lines.
- `cursor-buddy-follow-policy.ts`: 100% statements, branches, functions, and
  lines.
- `npm run check`: PASS. The agent-runtime worker reported 4 files and 12 tests
  passed; the desktop suite reported 124 files and 811 tests passed; Rust unit
  and compatibility tests passed with only environment-gated integration tests
  ignored.
- `npm run package`: PASS for macOS arm64.
- `npm audit`: 0 vulnerabilities.

The repository-wide coverage command is intentionally configured to include
only `src/main/agent/**/*.ts`. The focused coverage commands overrode that
allowlist for the two new cursor-buddy modules.

## Known gap

The packaged artifact was inspected for the new IPC channel and renderer
bundle, but this run did not automate a signed-in, multi-window Electron visual
session. Component rendering, lifecycle contracts, the full test suite, and
packaging are green.
