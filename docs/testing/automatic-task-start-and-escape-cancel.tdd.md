# Automatic task start and Escape cancellation — TDD evidence

## Source and user journeys

This change was derived from the request to remove the extra **Start task**
click after goal compilation. No external plan file was used.

1. When a compiled task reaches `ready` and OpenAI/CUA are available, execution
   starts automatically once, without another confirmation click.
2. While any task is nonterminal, the main window shows **Stop task** with an
   **Esc** hint.
3. Pressing Escape in TroCode cancels the current task without waiting for a
   normal form action.
4. Escape is renderer-window-scoped. It is ignored when Tro is blurred, an
   editable control or modal owns the key, or a permission interaction waits.
5. Registered actions start automatically once technical prerequisites are
   ready; automatic start does not expand the tool catalog.
6. If automatic start initialization fails, the goal remains visible with a
   bounded **Try again** action rather than retrying indefinitely.

## RED and GREEN evidence

The first focused run failed at module resolution because neither automatic
start policy nor focused cancellation policy existed:

```text
npm test -- src/renderer/task-execution.test.ts
Test Files 1 failed
```

After implementing the policies, the focused run passed:

```text
Test Files 1 passed
```

The full verification run passed after renderer and main-process integration:

```text
npm run check
Test Files 39 passed
Tests 205 passed

npm run package
Packaging for arm64 on darwin: passed
```

## Test specification

| # | What is guaranteed | Test target | Result |
|---|---|---|---|
| 1 | Only a ready, dependency-ready, idle task auto-starts | `src/renderer/task-execution.test.ts` | PASS |
| 2 | Every nonterminal phase is cancellable and terminal phases are not | `src/renderer/task-execution.test.ts` | PASS |
| 3 | Only a non-repeating Escape key stops an active task | `src/renderer/task-execution.test.ts` | PASS |
| 4 | Blurred, editable, modal, and permission-wait contexts suppress Escape | `src/renderer/task-execution.test.ts` | PASS |
| 5 | The backend projection, not a renderer phase list, decides cancellation | `src/renderer/task-execution.test.ts` | PASS |

## Coverage and known gaps

Focused coverage across the new policy modules passed with 92.5% statements,
88% branches, 100% functions, and 92.1% lines. Existing lifecycle and approval
tests in the full suite continue to prove that automatic execution cannot bypass
host policy or exact-action approval.

The React screen is covered by pure policy tests, typecheck, lint, and packaged
webpack compilation because this repository does not currently include a React
DOM test harness. A packaged manual pass should confirm on macOS and Windows
that Escape in another application cannot cancel a Tro task, including while
OS permission settings are open.

No TDD checkpoint commits were created because the worktree already contained
unrelated user changes, which were preserved.
