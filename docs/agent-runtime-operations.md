# Durable Rust agent runtime operations

The Rust runtime is the only task backend. New tasks require a configured API,
an authenticated opaque device session, protocol v2, a compatible v8 authority
contract, and a healthy desktop-engine handshake. Failure at any gate is
fail-closed; there is no TypeScript rollback loop.

## Rollout

1. Configure `TROCODE_BACKEND_AGENT_ENABLED=true` on the Rust API.
2. Configure the versioned 32-byte agent-state encryption key and session HMAC
   key.
3. Deploy current migrations and protocol v2 desktop builds.
4. Add internal IDs or raise the backend rollout percentage.
5. Enable intent authorization for the same cohort, then advance gradually.
6. Require zero false completions, duplicate consequential actions, and
   hard-confirm bypasses before broadening the cohort.

Assignment uses an HMAC of the user ID, so cohorts remain stable. Disabling
intent authorization creates new Rust contracts with no instruction grants;
stored contracts are not rewritten.

## Incident checks

- Inspect nonterminal `agent_runs` by state, deadline, lease owner, and lease
  expiry without selecting ciphertext columns.
- `awaiting_worker` requires a current signed-in desktop heartbeat.
- An expired lease in a runnable state may be reclaimed by Rust.
- An invocation left in `executing` after worker loss is unknown. Never mark it
  confirmed or replay it manually.
- Disable the Rust runtime for provider, schema, encryption, or false-completion
  incidents. Existing runs remain inspectable and cancellable.
- Disable intent authorization for authorization incidents; do not modify stored
  revisions or in-flight invocations.
- Reject protocol-v1 workers.

## Key rotation and retention

Add the new encryption key alongside the previous key, increment
`TROCODE_AGENT_STATE_KEY_VERSION`, and write only with the new version. Retain
old read keys until older encrypted payloads have passed their TTL and cleanup
has run. Never reuse the device-session HMAC key.

Cleanup deletes expired checkpoints and sensitive session items while retaining
sanitized lifecycle and billing rows. Screenshot bytes are device-memory-only.

## Release gates

- `npm run agent:benchmark -- --baseline <json> --candidate <json>`
- `npm run check`
- `npm run bazel:check`
- `npm run package`
- packaged Rust engine handshake on macOS and Windows;
- stale-worker rejection and restart recovery;
- zero duplicate consequential actions and hard-confirm bypasses;
- privacy documentation matching the deployed data flow.
