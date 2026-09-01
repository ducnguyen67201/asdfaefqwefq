# Computer-use lifecycle

1. Electron discovers the installed CUA driver's canonical tool inventory at
   startup, validates each model tool independently, quarantines incompatible
   optional tools, and makes CUA unavailable if a required tool is missing or
   incompatible.
2. Before any task starts, the local Agents SDK process validates each admitted
   schema and rejects any schema it would rewrite. Electron then registers the
   accepted tools. During a turn, the harness checkpoints RunState before a
   callback may cross into Electron.
3. Electron checks the local protocol/tool digest and, for CUA, the live
   driver-catalog digest, then checks task/workspace mapping.
4. If Accessibility or Screen Recording is unavailable, the run enters the
   durable `awaiting_permission` technical state. The user may open system
   settings, refresh, continue without computer use, or stop.
5. Electron atomically moves the encrypted local journal record from
   `checkpointed` to `executing`.
6. The selected local adapter is called once and its bounded result is persisted
   before it returns to the same SDK callback.
7. The SDK continues, completes, or stops on a definite failure. An uncertain
   external outcome becomes terminal `unknown` and is never replayed.

Tro does not display an action approval card. OS permissions and account OAuth
are technical/provider prerequisites, not per-action product policy.

## Observation freshness

Visual actions use opaque references bound to one task-scoped observation and
fingerprint. A changed or stale target is rejected before dispatch. After a
state-changing action, the next visual decision must use a fresh observation.
Original-resolution crops are bounded and stay in active device memory.

## Browser navigation

`browser.navigate` is the direct adapter for public URLs. Both normalization
and the final Electron adapter require HTTPS, no embedded credentials, and a
non-local/non-private hostname or literal IP. This protects the process
boundary but does not by itself prevent DNS rebinding; a future network-layer
resolver can add address pinning without introducing user approval.

## CUA session and browser profile

Tro starts and ends the CUA session for the task and overwrites any supplied
`session` argument with that task identity. CUA runs in unrestricted trusted-
host mode, so browser-profile preparation does not create a Tro approval step.
CUA still validates the target and may refuse a malformed, stale, or natively
unavailable operation.

Inventory schema 2 uses declared `audience`, `schemaDialect`, and
`schemaVersion` metadata. Model schemas are admitted exactly as supplied after
check-only validation; Tro does not widen or narrow them. `set_config` remains
host-owned. Schema 1 is supported only through a reported legacy adapter. See
`docs/cua-tool-inventory-contract.md`.

## Workspace shell

The shell adapter retains command-count, length, NUL, timeout, output,
environment, cancellation, and selected-working-directory bounds. It has no
semantic command allow/deny classifier. Commands such as network access,
package installation, git push, or deployment can run with the host user's
available credentials and operating-system access.
