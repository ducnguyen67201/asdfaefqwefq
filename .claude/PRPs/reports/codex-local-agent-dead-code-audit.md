# Codex-Local Agent Runtime — Dead-Code Audit

## Result

The live hosted orchestration path has been removed. Production source/config searches show no remaining reader or caller for the private orchestration token, backend-agent flags, worker leases, remote desktop-worker client, hosted task submission client, or generated v3-v5 runtime contracts.

## Removed

| Area | Removed artifacts |
|---|---|
| Rust live orchestration | `services/api/src/agent/**`, tool broker/catalog snapshots, run/session/model-dispatch stores, maintenance ownership, and module exports |
| Private and worker HTTP surface | `services/api/src/http/agent_orchestrator.rs`, `agent_runtime.rs`, private orchestration routes, desktop-worker connect/events/result routes, and their compatibility tests |
| Hosted Node worker | control-plane client, brokered OpenAI client, Rust session adapter, worker loop/entry, Railway worker config, and hosted crash/session fixtures |
| Electron hosted bridge | desktop-worker client/protocol/worker, hosted permission coordinator, hosted task client, and writable hosted history store |
| Generated contracts | orchestrator v1 and runtime/tool v3-v5 schemas, manifests, fixtures, generator scripts, and build targets |
| Configuration | backend-agent enable/rollout/canary readers, private service-token requirement, deployment values, and developer startup documentation |
| Product/schema legacy | task contract v2-v9 live branches, `rust_hosted`, autonomy mode, Bounded/Balanced/Strict UI/copy, old approval/outcome/checklist fields, and hosted runtime analytics labels |
| Static tool catalog | the hosted canonical tool list/digest and duplicated desktop-worker catalog |

## Replaced

| Removed responsibility | Replacement |
|---|---|
| Remote Agents SDK worker | Bundled `services/agent-runtime` utility process |
| Rust/PostgreSQL live run ownership | Electron-main `TaskRuntime` plus encrypted local state |
| Remote tool lease and desktop-worker callback | Direct typed utility-process interruption to Electron-main dispatcher |
| Static hosted tool contract | Dynamic host registry frozen and digested per turn |
| Hosted task history for new runs | Encrypted local canonical history |
| Hosted permission helper | Local CUA permission coordinator |
| Private brokered OpenAI client | Authenticated user-scoped Rust Responses proxy client |

## Retained intentionally

| Match | Reason |
|---|---|
| `services/api/migrations/014`, `025`, `030`, `031`, `032` and `schema_inventory.json` | Immutable database history and drift verification; deleting them would invalidate existing databases |
| `awaiting_worker` and `agent_orchestrator_workers` in historical migrations/inventory | Historical enum/table values only; they are absent from the live TypeScript lifecycle |
| `/v1/legacy-agent-history` and `LegacyHostedTaskHistoryStore` | Read-only projection for already-terminal hosted tasks; it cannot submit, resume, or mutate a run |
| Route-removal assertion for `/v1/desktop-worker/connect` | Negative compatibility evidence that the old endpoint is gone |
| Rust hosted services for auth, provider proxy, budgets, usage, organizations, connectors, voice, and knowledge | These are intentional backend capabilities, not live agent-loop ownership |
| API Railway configuration and ingestion worker | Unrelated backend deployment remains supported; only the Agents SDK worker deployment was deleted |
| Tests containing `autonomyMode` | Migration/strip assertions proving the removed preference is not persisted or returned |
| Archived PRPs and reports mentioning old architecture | Historical design evidence, not imported runtime code |

## Search evidence

Scoped production searches across `src`, `services`, `docs`, root configuration, CI, and packaging found:

- No `TROCODE_AGENT_ORCHESTRATOR_SERVICE_TOKEN` or backend-agent flag reader.
- No `DesktopWorker`, `desktop-worker`, `dispatchHostedTool`, `hostedToolContract`, worker lease, or private orchestrator caller.
- No live `AgentTaskContractV2` through `V9`, `AutonomyMode`, Bounded/Balanced approval product copy, or hosted runtime kind.
- The only live-code old-preference strings are tests that assert `autonomyMode` is discarded.
- The only old worker route match outside historical documents/migrations is a test asserting `/v1/desktop-worker/connect` is not present.

## Operational residue

The repository no longer consumes the old orchestration secret. Removing or rotating its remote Doppler value is a deployment operation and must happen only after verifying that no older deployed backend/worker version still consumes it. That external credential mutation was intentionally not performed as part of the code cleanup.
