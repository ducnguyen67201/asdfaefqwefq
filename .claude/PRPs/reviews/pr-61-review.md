# PR Review: #61 — feat(classroom): launch coach from teacher broadcasts

**Reviewed**: 2026-09-04
**Author**: Duc Minh Nguyen
**Branch**: `duc/classroom-coach-broadcast` → `main`
**Decision**: APPROVE after fixes

## Summary

The classroom broadcast flow now preserves Student consent across asynchronous
claims, keeps renderer data outside the trusted Coach prompt, selects the newest
Coach instruction in mixed batches, and queues launches behind active task
submissions. The correctness and Ponytail findings were addressed in the PR.

## Findings

### CRITICAL

None.

### HIGH

- Resolved: an automatic Coach claim could finish after the Student revoked
  consent or dismissed the direction. The post-claim gate now revalidates the
  current session, automatic consent, and dismissal state before emitting.
- Resolved: the renderer returned the complete directive and its instruction to
  main. The launch IPC now accepts only a directive UUID, and main builds the
  prompt from its trusted current notice.

### MEDIUM

- Resolved: a later exercise or link in the same poll batch could prevent the
  newest `explain_assignment` directive from launching. Polling now tracks the
  newest Coach directive independently from the visible latest notice.
- Resolved: an active task submission caused `launchKnowledgeActivity` to return
  successfully without launching, after the server claim had been consumed.
  Knowledge launches now serialize behind the active submission and resolve
  only after submission succeeds or fails.

### LOW

None.

## Ponytail Review

- Resolved `delete:` removed the renderer-lifetime directive ID set; the
  authoritative claim path already provides exactly-once delivery.
- Resolved `shrink:` removed the nested enum match and unreachable branch from
  non-URL directive delivery selection.
- Net: fewer redundant state owners and no additional dependency.

## Validation Results

| Check | Result |
|---|---|
| `npm run check` | Pass — 131 Vitest files / 853 tests and 72 Rust unit tests |
| `npm run package` | Pass |
| `npm run bazel:check` | Pass — 13 tests |
| Real PostgreSQL classroom E2E | Pass |
| Type check | Pass |
| ESLint | Pass |

The Rust audit reported only the repository's three existing allowlisted
warnings (`ttf-parser`, `lru`, and `chacha20`); no new audit failure was added.

## Files Reviewed

- Modified: `docs/knowledge-spaces.md`
- Added: `services/api/migrations/034_classroom_explain_assignment_directive.sql`
- Modified: `services/api/src/classroom/contracts.rs`
- Modified: `services/api/src/classroom/directives.rs`
- Modified: `services/api/src/classroom/policy.rs`
- Modified: `services/api/src/db.rs`
- Modified: `services/api/tests/classroom_e2e.rs`
- Modified: `services/api/tests/contract_corpus.rs`
- Modified: `src/index.css`
- Modified: `src/main/application/task-application-service.test.ts`
- Modified: `src/main/application/task-application-service.ts`
- Modified: `src/main/companion/classroom-pet-service.test.ts`
- Modified: `src/main/ipc/register-ipc.test.ts`
- Modified: `src/main/ipc/register-ipc.ts`
- Modified: `src/main/knowledge/classroom-directive-service.test.ts`
- Modified: `src/main/knowledge/classroom-directive-service.ts`
- Modified: `src/main/knowledge/classroom-session-service.test.ts`
- Modified: `src/main/knowledge/classroom-session-service.ts`
- Modified: `src/preload.ts`
- Modified: `src/renderer/App.tsx`
- Modified: `src/renderer/ClassSessionsPanel.test.tsx`
- Modified: `src/renderer/ClassSessionsPanel.tsx`
- Added: `src/renderer/ClassroomSessionBar.test.tsx`
- Modified: `src/renderer/ClassroomSessionBar.tsx`
- Modified: `src/renderer/FacilitatorRunPage.tsx`
- Modified: `src/renderer/app-language.ts`
- Modified: `src/renderer/classroom-session-view.test.ts`
- Modified: `src/renderer/classroom-session-view.ts`
- Modified: `src/shared/contracts.test.ts`
- Modified: `src/shared/contracts.ts`
- Modified: `src/shared/desktop-api.ts`
