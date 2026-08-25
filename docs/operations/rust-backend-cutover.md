# Rust backend same-service cutover

This runbook replaces the JavaScript hosted backend in the existing Railway API and ingestion-worker services. It does not create a new public service, domain, database, bucket, or trust boundary. Production deployment and third-party changes require explicit operator approval.

## Artifact and commands

The API and worker use the same locked artifact:

```bash
cargo build --manifest-path services/api/Cargo.toml --release --locked
./target/release/trocode-api serve
./target/release/trocode-api ingestion-worker
```

When Railway's service root is the repository root, the configured paths are
`./target/release/trocode-api serve` and `./target/release/trocode-api
ingestion-worker`.

## Required pre-deploy evidence

- Back up PostgreSQL and the private object store together, then restore both into an isolated environment.
- Pass crypto/route fixtures, companion image provider/quota parity, Rust fmt/clippy/test/audit/release build, desktop `npm run check`, and supported-platform packaging.
- Run migrations twice against an empty PostgreSQL 17 database and a scrubbed clone initialized by the JavaScript release. The only allowed schema delta is SQLx migration bookkeeping.
- Pass disposable PostgreSQL/S3 integration tests and the PDF corpus.
- Rehearse Rust deploy, JavaScript rollback, and Rust roll-forward in staging.
- Inventory Railway variable names only. Never copy secret values into logs or reports.
- Set backend-agent and intent-authorization rollout to zero and disable Knowledge Spaces until its worker smoke passes.

## Legacy drain gate

Stop accepting new legacy backend-agent work with the existing rollout control. Pause the existing ingestion worker only after its current lease completes. Run these read-only queries through the approved operator path:

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

1. Confirm the backup/restore evidence and record the last known-good JavaScript deployment identifier.
2. Deploy the Rust commit to the existing API service with the same root, domain, database reference, variables, and `/healthz` check.
3. Wait for Railway health, then independently check `/healthz` and `/readyz`.
4. Run non-mutating checks, followed by synthetic auth/session/access/budget/provider/admin flows.
5. Change the existing ingestion worker command to `./target/release/trocode-api ingestion-worker` from the same commit. Do not overlap JavaScript and Rust agent workers.
6. Smoke upload, HEAD verification, ingestion, search, Activity/Run/Attempt/submission/evidence/dashboard before enabling Knowledge Spaces.
7. Enable backend-agent only for explicit canaries. Verify task SSE replay, worker connect/request/executing/result/completion, and disconnect-during-consequential-action becoming unknown/blocked without replay.
8. Expand the existing percentage gradually under separate operator approval.

Observe 5xx/429 rate, p50/p95, SSE disconnect/replay errors, uncertain reservations, PostgreSQL pool saturation, stale leases, unknown outcomes, ingestion retries, and RSS for the approved window.

## Rollback triggers

- Health/readiness or startup migration instability.
- Any auth, session, cookie, digest, or encrypted-row incompatibility.
- Double charge, missing settlement, or a material increase in uncertain reservations.
- SSE buffering, truncation, or replay breakage affecting installed clients.
- Stale-lease commit, duplicate consequential dispatch, or weaker approval/effect enforcement.
- Object checksum/key/parser corruption or an unapproved latency/RSS regression.

## Rollback

1. Set backend-agent and intent rollout to zero; disable Knowledge Spaces if implicated.
2. Stop the Rust ingestion worker after its current lease.
3. Require zero nonterminal Rust runs before a full rollback. Never ask JavaScript to interpret a Rust checkpoint.
4. Redeploy the recorded JavaScript deployment to the same service.
5. Check health/readiness and synthetic auth/session/access/budget/admin/provider paths.
6. Reconcile reserved/uncertain entries through existing safe operator logic. Never retry a provider or consequential action because local completion is missing.
7. Preserve logs, diagnostic rows, and backups. Do not delete or manually roll back domain data.

The migration retains all 18 domain migrations without a Rust-only required schema. The JavaScript rollback is expected to ignore SQLx bookkeeping; staging must prove that before production cutover.
