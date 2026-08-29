# OpenAI Agents SDK runtime operations

New tasks use public runtime v5 and authority v10. The separate
`services/agent-runtime` process is the sole planner/executor loop. Rust remains
the trusted control plane for authentication, leases, encrypted Session and
`RunState` storage, spend, OpenAI proxying, connectors, and desktop work.

## Deployment order

1. Build and health-check the SDK worker with
   `npm --prefix services/agent-runtime ci` and
   `npm --prefix services/agent-runtime run check`.
2. Give the Rust API `OPENAI_API_KEY`,
   `TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN`, and database credentials.
3. Give the SDK worker only `TROCODE_API_BASE_URL` and the same orchestrator
   token. It must not receive an OpenAI key, database URL, connector credential,
   or desktop session.
4. Deploy the worker idle, then the Rust private endpoints, then the v5
   API/desktop release together.
5. Enable the backend-agent rollout only after the worker's `/healthz` is ready
   and a staging task has completed through a real desktop worker.

## v5 drain and migration 031

Migration 031 intentionally refuses to run while any legacy task is nonterminal:

```sql
SELECT protocol_version, orchestrator_kind, state, COUNT(*)
FROM agent_runs
WHERE state NOT IN ('completed','blocked','failed','cancelled','expired')
GROUP BY protocol_version, orchestrator_kind, state
ORDER BY protocol_version, orchestrator_kind, state;
```

Stop v4 starts first, then let known in-flight actions finish or cancel them
through the old release. Do not weaken the migration guard. Migration 029 is
`class_session_materials`; never replace or renumber it on a database where
SQLx already recorded version 29. Migration 030 remains the approval-policy
cleanup. Terminal legacy records remain read-only history.

Before changing `@openai/agents`, instructions, protocol schemas, or tool shape,
drain every nonterminal SDK graph:

```sql
SELECT sdk_version, orchestrator_graph_version, state, COUNT(*)
FROM agent_runs
WHERE orchestrator_kind='openai_agents_sdk'
  AND state NOT IN ('completed','blocked','failed','cancelled','expired')
GROUP BY sdk_version, orchestrator_graph_version, state;
```

A pending serialized `RunState` may resume only on the exact SDK and graph
version that created it.

## Incident checks

- Worker health: inspect `agent_orchestrator_workers` heartbeat, expiry, SDK,
  graph, and release fields; do not select service tokens.
- Lease recovery: an expired SDK lease is reclaimable. A live lease must never be
  manually reassigned.
- Session conflict: stop the run and inspect only revision/generation/mutation
  metadata. Do not edit encrypted Session items.
- Compaction failure: keep the previous generation. The atomic replace-suffix
  transaction must either commit completely or not at all.
- Provider ambiguity: `ambiguous_dispatch` or `ambiguous_response` is terminal
  `provider_outcome_unknown`; do not repeat the request manually. Inspect only
  state and timestamps in `agent_model_dispatches`. A repeated digest is also
  blocked after a completed provider response because the SDK checkpoint may
  have been lost; provider bodies are never stored for replay.
- Tool ambiguity: an invocation that reached `executing` and lost its executor
  becomes `unknown`; the SDK blocks and must not replan an equivalent action.
- OS permission wait: this is a macOS/Windows prerequisite for the same durable
  invocation, not an approval decision.
- Connector OAuth failure: repair authorization, then start a new user task. Do
  not mutate a pending invocation into executable state.

## Service-token rotation

Deploy a coordinated API and worker release with the new random token. Keep the
old pair running only long enough to drain their exact graph, then remove the old
secret. Never log the token or place it in public protocol payloads.

## Release gates

- `npm run agent:protocol:check`
- `npm run agent:orchestrator:check`
- `npm --prefix services/agent-runtime run check`
- `npm run agent:runtime-versions`
- `npm run check`
- `npm run bazel:check`
- `npm run package`
- zero nonterminal legacy rows before migration 031;
- zero duplicate adapter dispatches or unknown-result retries;
- packaged v5 handshake, cancellation, steering, direct navigation, and workspace
  smoke tests.
