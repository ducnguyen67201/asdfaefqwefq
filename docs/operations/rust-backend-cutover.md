# Rust backend deployment and rollback

The repository backend is Rust-only. This runbook deploys its unified binary to
the existing Railway API and ingestion-worker services without creating a new
public service, domain, database, bucket, or trust boundary. Production
deployment and third-party changes require explicit operator approval.

## Artifact and commands

The API and worker use the same locked artifact:

```bash
cargo build --manifest-path services/api/Cargo.toml --release --locked
./target/release/trocode-api serve
./target/release/trocode-api ingestion-worker
```

Railpack stages the release binary at `./bin/trocode-api`. The checked-in API
config starts `./bin/trocode-api serve`. Both services must build with Railway
Root Directory `/` because the crate inherits the root Cargo workspace and lock
file. Set the API config path to `/services/api/railway.json` and the worker
config path to `/services/api/railway.worker.json`; the latter starts
`./bin/trocode-api ingestion-worker`. The root `railpack.json` forces the Rust
provider; do not remove it while the Electron `package.json` remains at root.

## Required pre-deploy evidence

- Back up PostgreSQL and the private object store together, then restore both into an isolated environment.
- Pass crypto/route fixtures, companion image provider/quota parity, Rust fmt/clippy/test/audit/release build, desktop `npm run check`, and supported-platform packaging.
- Run migrations twice against an empty PostgreSQL 17 database and a scrubbed production-shaped clone. The second run must be a no-op and preserve existing rows.
- Pass disposable PostgreSQL/S3 integration tests and the PDF corpus.
- Rehearse deploy, roll-forward, and a coordinated PostgreSQL/object-store restore to a pre-migration-030 snapshot in staging.
- Inventory Railway variable names only. Never copy secret values into logs or reports.
- Set `TROCODE_BACKEND_AGENT_ENABLED=false` and disable Knowledge Spaces until
  its worker smoke test passes.

## Active-work drain gate

Stop accepting new backend-agent work with the existing rollout control. Pause the ingestion worker only after its current lease completes. Run these read-only queries through the approved operator path:

```sql
SELECT count(*) AS nonterminal_legacy_runs
FROM agent_runs
WHERE state NOT IN ('completed','blocked','failed','cancelled','expired');

SELECT count(*) AS in_flight_invocations
FROM agent_tool_invocations
WHERE state IN ('delivered','executing');

SELECT count(*) AS connected_workers
FROM agent_worker_sessions
WHERE disconnected_at IS NULL AND expires_at > NOW();

SELECT count(*) AS leased_ingestion_jobs
FROM knowledge_ingestion_jobs
WHERE state = 'leased' AND lease_expires_at > NOW();
```

Every count must be zero. Do not edit rows to make the gate pass. A nonzero count postpones the deployment.

## Cutover

1. Confirm the backup/restore evidence and record the last known-good deployment identifier.
2. Change the existing API and worker Root Directory from the legacy `/services/api` value to `/`, assign their checked-in config paths above, then deploy the Rust commit with the same domain, database reference, variables, and `/healthz` check.
3. Wait for Railway health, then independently check `/healthz` and `/readyz`.
4. Run non-mutating checks, followed by synthetic auth/session/access/budget/provider/admin flows.
5. Change the existing ingestion worker command to `./bin/trocode-api ingestion-worker` from the same commit. Do not overlap old and new agent workers.
6. Smoke upload, HEAD verification, ingestion, search, Activity/Run/Attempt/submission/evidence/dashboard before enabling Knowledge Spaces.
7. Enable backend-agent only for explicit canaries. Verify task SSE replay, worker connect/request/executing/result/completion, and disconnect-during-consequential-action becoming unknown/blocked without replay.
8. Expand the existing percentage gradually under separate operator approval.

Observe 5xx/429 rate, p50/p95, SSE disconnect/replay errors, uncertain reservations, PostgreSQL pool saturation, stale leases, unknown outcomes, ingestion retries, and RSS for the approved window.

## Rollback triggers

- Health/readiness or startup migration instability.
- Any auth, session, cookie, digest, or encrypted-row incompatibility.
- Double charge, missing settlement, or a material increase in uncertain reservations.
- SSE buffering, truncation, or replay breakage affecting installed clients.
- Stale-lease commit, duplicate consequential dispatch, or weaker effect/outcome enforcement.
- Object checksum/key/parser corruption or an unapproved latency/RSS regression.

## Rollback

Migration 030 is destructive and is not backward-compatible with the previous
backend. After it has been applied, never redeploy the previous application
against the migrated database and never reconstruct dropped columns manually.

1. Set `TROCODE_BACKEND_AGENT_ENABLED=false` to reject new starts; set
   `TROCODE_BACKEND_AGENT_ROLLOUT_PERCENT=0` and clear
   `TROCODE_BACKEND_AGENT_CANARY_USERS` before re-enabling the runtime later.
   Disable Knowledge Spaces if implicated.
2. Stop the Rust ingestion worker after its current lease. Preserve current
   workers until every executing or unknown-outcome action is reconciled; never
   replay a consequential action.
3. Prefer a roll-forward from the current v4 backend. Deploy the corrected
   commit against the migrated database, then check health/readiness and
   synthetic auth/session/access/budget/admin/provider paths.
4. If roll-forward is impossible, declare disaster recovery and stop all
   writers. Restore PostgreSQL and the private object store together from the
   verified pre-migration-030 backup, then deploy only the application version
   matched to that restored schema.
5. Confirm the restore point does not discard accepted work. If newer work
   exists, keep the service disabled and reconcile it through the approved
   incident/data-recovery process before reopening.
6. Reconcile reserved/uncertain entries through existing safe operator logic. Never retry a provider or consequential action because local completion is missing.
7. Preserve logs, diagnostic rows, and backups. Do not perform an
   application-only rollback or manually roll back domain data.

The Rust backend owns all 30 domain migrations and SQLx bookkeeping. A previous
deployment is permitted only with the coordinated pre-migration restore rehearsed
in staging; current source contains no legacy backend implementation.
