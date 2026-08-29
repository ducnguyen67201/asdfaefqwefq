# Durable Rust agent runtime operations

The Rust runtime is the only task backend. New work requires a configured API,
an authenticated device session, authority contract v9, protocol v4, and exact
protocol/tool-catalog digests. There is no TypeScript fallback loop.

## Runtime v4 cutover

1. Generate and commit v4 artifacts with `npm run agent:protocol:generate` and
   enforce `npm run agent:protocol:check`.
2. While the old deployment is still running, stop new agent starts and run
   `npm run agent:runtime-versions`. With `DATABASE_URL` configured it
   reports active v2 and v3 rows.
3. Let known in-flight effects finish, and cancel stale legacy waits through
   the old deployment. Require zero nonterminal v2/v3 rows.
4. Deploy the v4 desktop and v4/v9 backend together. Startup applies migration
   030 and admits only v4 starts and workers with both exact digests.

```sql
SELECT protocol_version, state, COUNT(*)
FROM agent_runs
WHERE state NOT IN ('completed','blocked','failed','cancelled','expired')
GROUP BY protocol_version, state;
```

Cancel stale legacy waits using the old deployment. Never synthesize a user
decision, move an old pending invocation to executing, or let an old desktop
claim a v4 row. Terminal legacy rows remain readable through the generic
history endpoint.

Migration 029 is `class_session_materials`; do not replace or renumber it on a
database where SQLx recorded migration 29. Migration 030 performs the guarded
approval-policy cleanup and renames the connector catalog-contract digest.

## Incident checks

- Inspect nonterminal runs by protocol, state, deadline, lease owner, and lease
  expiry without selecting ciphertext.
- `awaiting_worker` requires a current signed-in desktop heartbeat.
- `awaiting_permission` means an OS technical prerequisite is unresolved.
- A requested invocation may be reclaimed before execution ownership.
- An invocation left executing after worker/provider loss is unknown. Never
  mark it confirmed or replay it manually.
- `blocked` is terminal for unknown effects or unmet required outcomes.
- Disable new runtime work for provider, schema, encryption, privacy, duplicate
  effect, or false-completion incidents; retain read/cancel access as deployed.

## Release gates

- `npm run agent:protocol:check`
- `npm run agent:runtime-versions`
- `npm run check`
- `npm run bazel:check`
- `npm run package`
- zero active v2/v3 rows before migration 030;
- zero duplicate consequential actions and unknown-effect retries;
- packaged v4 handshake and direct navigation/workspace smoke tests;
- privacy and security documentation matching the deployed catalog.
