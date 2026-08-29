# Security model

Tro is an autonomous desktop agent. A model-selected registered tool can run
without a Tro confirmation card. Users and operators should treat the enabled
tool catalog and the host account's capabilities as the action boundary.

## Trust boundaries

- The Electron renderer is sandboxed and has no Node integration.
- Preload exposes narrow, schema-parsed functions; it does not expose raw IPC,
  CUA, OAuth tokens, provider credentials, or a generic command channel.
- Rust owns task lifecycle, contracts, budgets, durable invocations, leases,
  results, and verification.
- Electron owns local native handles and revalidates inputs immediately before
  local execution.
- Models and connector/browser content are untrusted. They cannot register a
  tool, change a contract, widen workspace identity, or bypass schemas.

## Retained controls

- Exact runtime v4 protocol and catalog digest negotiation.
- Strict registered tool/operation and bounded input parsing.
- Public credential-free HTTPS validation for direct browser navigation.
- Canonical selected-workspace identity and filesystem path/symlink checks.
- Shell count, length, NUL, timeout, output, environment, and cancellation
  bounds. The shell is not a security sandbox.
- Fresh observation binding and exclusion of Tro's own windows.
- Operating-system Accessibility/Screen Recording readiness.
- Provider OAuth consent, scope, endpoint, and schema-snapshot validation.
- One-time requested-to-executing ownership and result replay handling.
- Task time, tool-call, model-sample, image, and spend limits.
- No automatic replay after an unknown tool result.
- Privacy-safe lifecycle/audit metadata and encrypted sensitive persistence.

## Explicitly accepted risk

If the catalog exposes a send, delete, publish, install, trade, deployment, or
similar tool, the model may select it and Tro will execute it automatically
after the retained checks. Workspace terminal commands run with the host user's
network, credentials, and executable access. Root confinement applies to the
filesystem adapter, not arbitrary shell syntax.

Stop/Escape and backend cancellation reduce exposure but cannot undo an action
already accepted by an external application. Cancellation during an unknown
tool execution produces a blocked run rather than a retry.

## Native CUA capability

The CUA SDK's authorization-host interface is implemented as an internal
capability broker, not a user approval system. Only `browser.prepare` may arm
one exact task/session/window resource for a short TTL; it is consumed once.
Unexpected, expired, malformed, mismatched, or replayed native requests are
denied automatically.

## Deployment

New task execution is runtime v4 only. Cleanup migration 030 first asserts that
no nonterminal run or legacy approval wait exists. It never converts historical
pending work into execution. Operators must drain or cancel active work under
the old release before applying the cleanup.
