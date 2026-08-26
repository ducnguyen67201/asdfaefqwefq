# Durable Rust agent runtime operations

The Rust runtime is the only task backend. New tasks require a configured API,
an authenticated opaque device session, a compatible v8 authority contract,
and a healthy desktop-engine handshake. Canonical v3 work also requires exact
protocol and hosted-tool digests. Failure at any gate is
fail-closed; there is no TypeScript rollback loop.

## Canonical v3 rollout

1. Generate and commit the contract with `npm run agent:protocol:generate`, then
   require `npm run agent:protocol:check` in review and CI.
2. Deploy migration 025 and a backend with `AGENT_RUNTIME_V3_MODE=observe`.
   Observe records compatibility diagnostics but preserves v2 new-work paths.
3. Deploy v3 desktops, verify both digests, then switch the backend to `dual`.
   Dual accepts explicitly tagged, exactly matching v3 work while existing v2
   runs drain.
4. Run `npm run agent:runtime-versions`. With `DATABASE_URL` configured it
   reports active v2/v3 counts and whether the v2 drain is complete.
5. Switch to `enforce` only when active v2 is zero. Enforce rejects v2 task
   creation and worker connections with an upgrade error; v2 GET/list/events
   remain readable.

The drain query used by the report is:

```sql
SELECT protocol_version, COUNT(*)
FROM agent_runs
WHERE state NOT IN ('completed','blocked','failed','cancelled','expired')
GROUP BY protocol_version;
```

For rollback, return to `dual` or `observe` before deploying an older backend.
Do not let a v2 binary claim v3 rows. Existing v3 terminal/history records stay
readable through the deployed v3 service while the cause is repaired.

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
- Reject unknown versions and any v3 worker whose protocol or tool digest does
  not exactly match the manifest.
- `failed` means a definite technical failure; `blocked` is terminal and means
  safe recovery or effect outcome is unknown. Never cancel or retry a blocked
  consequential outcome.

## Key rotation and retention

Add the new encryption key alongside the previous key, increment
`TROCODE_AGENT_STATE_KEY_VERSION`, and write only with the new version. Retain
old read keys until older encrypted payloads have passed their TTL and cleanup
has run. Never reuse the device-session HMAC key.

Cleanup deletes expired checkpoints and sensitive session items while retaining
sanitized lifecycle and billing rows. Screenshot bytes are device-memory-only.

## Release gates

- `npm run agent:benchmark -- --baseline <json> --candidate <json>`
- `npm run agent:protocol:check`
- `npm run agent:runtime-versions`
- `npm run check`
- `npm run bazel:check`
- `npm run package`
- packaged Rust engine handshake on macOS and Windows;
- stale-worker rejection and restart recovery;
- zero duplicate consequential actions and hard-confirm bypasses;
- privacy documentation matching the deployed data flow.
