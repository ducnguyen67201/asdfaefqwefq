# Computer-use lifecycle

1. Rust supplies the model with Tro's base tools and the exact CUA catalog
   advertised by the desktop worker.
2. Rust validates model arguments against the selected tool schema and records
   the exact tool and operation.
3. Electron checks the protocol/base-catalog digest and, for CUA, the live
   driver-catalog digest, then checks expiry and run/task/workspace mapping.
4. If Accessibility or Screen Recording is unavailable, the run enters the
   durable `awaiting_permission` technical state. The user may open system
   settings, refresh, continue without computer use, or stop.
5. Electron asks Rust to atomically move the invocation from `requested` to
   `executing` using the expected run version.
6. The selected adapter is called once. Results and bounded evidence are sent
   back to Rust.
7. Rust verifies required outcomes and either replans, completes, recovers from
   a definite failure, or blocks an unknown result.

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

## Workspace shell

The shell adapter retains command-count, length, NUL, timeout, output,
environment, cancellation, and selected-working-directory bounds. It has no
semantic command allow/deny classifier. Commands such as network access,
package installation, git push, or deployment can run with the host user's
available credentials and operating-system access.
