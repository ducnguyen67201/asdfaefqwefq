# Local Code Review: Live Classroom Room Flow

## Verdict

Approved for pull request. No unresolved critical or high-severity findings remain.

## Findings addressed

| Severity | Location | Finding | Resolution |
|---|---|---|---|
| High | `src/main/knowledge/classroom-directive-service.ts:113` | One failed automatic directive claim could prevent later directives from advancing, while retrying an uncertain open could duplicate navigation. | Advance each sequence independently, publish `open_failed`, never retry a consumed/uncertain claim, and continue to later directives. |
| High | `src/renderer/FacilitatorRunPage.tsx:86` | Teacher Run state was local and could disagree with the hosted Run after remount/polling. | Carry authoritative `runState` on dashboard snapshots/deltas and render lobby/live/closed/archived from it. |
| High | `src/renderer/AttemptLaunchPage.tsx:48` | Return, Complete, Submit, and Withdraw could leave student controls on a stale Attempt state. | Propagate Attempt state through the trusted session poll and lock terminal/submitted actions. |
| High | `services/api/src/agent-run-service.mjs:392` | Generic hosted Activity launches could bypass inactive Attempt or terminal Work Session checks. | Re-resolve authenticated Attempt, open Run, launch profile, intent, and active Work Session before issuing hosted Activity authority. |
| High | `src/main/application/hosted-task-client.ts:137` | A hosted POST accepted upstream but losing its response could be mislabeled `launch_failed`. | Retry once with the identical idempotency identity, preserve repeated ambiguity as unknown, and rebind restored Activity runs. |
| Medium | `services/api/src/activity-repository.mjs:365` | Concurrent Help inserts could collide on the partial unique index instead of remaining naturally idempotent. | Use an unqualified conflict handler under the existing Attempt lock and cover the real concurrent case. |
| Medium | `services/api/src/activity-service.mjs:59` | Submitted or terminal Attempts could still initiate submission uploads and consume storage. | Apply the shared active-Attempt policy before upload initiation and hide submission controls for terminal Attempts. |
| Medium | `services/api/src/activity-repository.mjs:552` | Leaving the room could mask Ready/Submitted/Completed state and remove teacher review actions. | Prioritize review/terminal state over physical presence and exclude left participants from the live Help queue. |
| Medium | `src/shared/classroom-url-policy.ts:24` | Renderer/main link checks did not fully reject IPv6 link-local and multicast literals, and response schemas accepted overly broad URLs. | Share the renderer/main policy, mirror it server-side, reject IPv6 link-local/multicast targets, and strengthen directive/claim schemas. |
| Medium | `src/renderer/ActivityEditorPage.tsx:363` | Editing after Save draft could publish the previously persisted definition. | Always persist the current form immediately before publish and remove the redundant cached Activity ID state. |
| Medium | `services/api/src/activity-repository.mjs:456` | Work Session update and its dashboard event were separate writes, permitting lost or orphaned launch state. | Make state update and event insertion one transaction and expose explicit `launch_failed`. |
| Low | Multiple | Duplicate URL helpers, redundant renderer flags, an unused client wrapper, and an unused migration column added maintenance surface. | Consolidated/removed them and retained only protocol IDs required for idempotency consistency. |

## Ponytail review

`src/shared/classroom-url-policy.ts:L1: duplication: Main and renderer maintained parallel classroom URL helpers. Replace with one shared pure policy.`

`src/renderer/ActivityEditorPage.tsx:L363: cached-state: A separate Activity ID branch let publish skip the current draft and added state. Replace with an unconditional current-form save before publish.`

`src/renderer/AttemptLaunchPage.tsx:L100: duplicate-state: Submitted and Help flags duplicated the authoritative Attempt state. Replace with derived booleans from attempt.state.`

`src/main/knowledge/knowledge-space-client.ts:L101: pass-through: A one-use classroom session wrapper and unused notice accessor added no policy or transformation. Delete them and call the owning service directly.`

`services/api/migrations/018_live_classroom_room_flow.sql:L104: speculative-data: handled_result had no writer or reader and its own future-state enum. Remove the column until an outcome protocol exists.`

`net: -31 lines applied.`

Final ponytail pass: `net: -0 lines possible.`

## Validation

- `npm run check`: pass — 113 Vitest files / 791 tests, 12 script tests, 143 API tests; two expected DB skips.
- Real PostgreSQL integration: pass — 2/2, including 200 concurrent students.
- Root and API `npm audit --audit-level=high`: pass — zero vulnerabilities.
- `npm run package`: pass — arm64 macOS package.
- `git diff --check`: pass.
