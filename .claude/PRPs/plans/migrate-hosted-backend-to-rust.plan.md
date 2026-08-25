# Plan: Migrate the Hosted Backend to Rust In Place

## Summary

Replace the deployable JavaScript backend in `services/api` with one Rust crate while preserving the current Railway API service, public URL, PostgreSQL schema and data, S3 object layout, environment variables, HTTP/SSE contracts, embedded admin UI, provider behavior, and existing knowledge-ingestion worker topology. The Electron/React desktop application remains TypeScript and is treated as an unchanged compatibility client; the production cutover replaces the implementation behind the existing service rather than adding a new service.

The migration is intentionally parity-first. The JavaScript implementation remains the executable reference until Rust passes differential contract tests, database/crypto compatibility tests, desktop packaging checks, and a production-like staging rehearsal. The final deployment is permitted only after legacy OpenAI Agents SDK work has drained, because serialized JavaScript `RunState` checkpoints are not a safe cross-language persistence format.

## User Story

As the operator of Tro,
I want the existing hosted backend replaced by Rust without changing its external behavior or deployment identity,
so that the application can run on the Rust implementation without breaking installed clients, persisted data, background work, security guarantees, or rollback.

## Problem -> Solution

The Railway backend is currently 58 JavaScript runtime modules plus JavaScript operational scripts, relies on Node-only packages, and owns security- and state-sensitive API behavior -> replace those modules with a single Rust crate and command binary, preserve all observable contracts, prove parity against the current implementation, then switch the existing Railway service and existing worker command to the Rust artifact.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: N/A (standalone migration)
- **Estimated Files**: approximately 135 paths (about 40 Rust source/test/config files created, 90 JavaScript backend/test/script files retired, and 5-10 repository/CI/docs/deployment files updated)
- **Current backend size**: 58 runtime `.mjs` files, 29 `.test.mjs` files, 2 operational `.mjs` files, 17 SQL migrations, 39 PostgreSQL tables, and about 16.7K lines across implementation/tests/migrations/scripts
- **Baseline on 2026-08-24**: `npm --prefix services/api test` passes 130 tests; the one real-PostgreSQL test is skipped when `TEST_DATABASE_URL` is absent; `npm --prefix services/api ci` reports zero known vulnerabilities
- **Rust baseline**: `rustc 1.95.0`, `cargo 1.95.0`
- **Confidence**: 7/10 before the direct Responses runner and PDF differential spikes; 9/10 is required before production cutover

---

## Scope Decision

### In scope

- Every executable backend module under `services/api/src`.
- The API process currently started by `node src/main.mjs`.
- The existing knowledge-ingestion worker command currently started by `node src/ingestion-main.mjs`.
- Backend operational scripts in `services/api/scripts`.
- The root access-code administration command in `scripts/access-codes.mjs`, because it imports backend repositories and migration code that will be removed.
- All backend unit, integration, security, contract, performance, and migration tests.
- Railway build/start configuration for the existing API service and the already documented ingestion-worker process.
- Root CI/package scripts that currently invoke the Node backend tests or CLI.
- Backend-specific architecture, security, operations, and deployment documentation.

### Preserved, not migrated

- Electron main/preload/renderer code under `src/`; this is the desktop client, not the Railway backend.
- React and the sandboxed renderer.
- The embedded admin frontend assets in `services/api/public/admin.html`, `admin.css`, `admin.js`, and `admin-favicon.svg`. `admin.js` is browser frontend code and remains JavaScript.
- The 17 forward-only SQL migrations and all existing PostgreSQL rows.
- The production API domain, health path, environment-variable names, secret values, Railway service identity, and PostgreSQL/S3 resources.
- The existing separate ingestion-worker deployment/process if it is already configured. No third service, sidecar daemon, proxy tier, new domain, new database, or new bucket is introduced.

### Explicit interpretation of “no new service”

The Rust artifact replaces the current API command in the same Railway service. The existing ingestion worker remains an alternate command from the same crate and artifact; it is not split into a new codebase or additional service. If production currently has a Railway worker service for `start:worker`, update that existing worker's start command in place. If no worker is deployed, do not create one as part of this migration.

---

## UX Design

### Before

```text
Electron/React desktop ── HTTPS/SSE ──> Railway Node API ──> PostgreSQL/S3/providers
Admin browser          ── same host ──> embedded admin assets and admin API
Existing worker command ──────────────> knowledge ingestion tables and S3
```

### After

```text
Electron/React desktop ── identical HTTPS/SSE ──> same Railway service, Rust binary
Admin browser          ── identical same-host UI/API ──> assets embedded by Rust
Existing worker command ── same crate/binary subcommand ─> same tables and S3 keys
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Desktop API base URL | Existing Railway URL | Unchanged | No desktop configuration or release required for cutover |
| REST/SSE behavior | Node HTTP server | Axum/Tokio | Status, body, headers, replay, heartbeat, cancellation, and chunking remain compatible |
| Admin dashboard | Static assets served by Node | Same bytes embedded/served by Rust | CSP, cookies, same-origin checks, and no-store semantics are frozen |
| PostgreSQL | Existing 17 migrations and 39 tables | Same schema and rows | Rust adds only SQLx bookkeeping after compatibility proof; no destructive migration |
| Knowledge ingestion | Existing worker command | Rust subcommand | Same lease, parser limits, S3 checksums, object keys, and terminal states |
| Deployment | Railway/Railpack Node detection | Same Railway service, Railpack Rust detection | Health check stays `/healthz`; rollback uses prior Railway deployment |

Internal migration only; there is no intended user-facing UX transformation.

---

## Mandatory Reading

Files that MUST be read before implementation. Line ranges refer to the current JavaScript reference implementation and must remain available until parity fixtures are frozen.

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `AGENTS.md` | all | Security invariants and required `npm run check` / `npm run package` gates |
| P0 | `docs/architecture.md` | 57-78, 148-173, 175-198, 217-230 | Backend ownership, trust split, encrypted durable state, provider proxy, and native authority boundaries |
| P0 | `services/api/src/main.mjs` | 48-298 | Dependency composition, feature flags, worker timers, server timeouts, startup migrations, and shutdown |
| P0 | `services/api/src/server.mjs` | 1-962 | Canonical public API, bounds, upstream streaming, security headers, error mapping, and request logs |
| P0 | `services/api/src/agent-runtime-contracts.mjs` | all | Protocol-v2 runtime schemas and all cross-process invariants |
| P0 | `services/api/src/backend-agent-runtime.mjs` | all | Agents SDK behavior that must become an explicit Rust Responses loop |
| P0 | `services/api/src/agent-run-repository.mjs` | all | Lease/fencing/idempotency/event/evidence/checkpoint semantics; never simplify these SQL transitions |
| P0 | `services/api/src/agent-run-worker.mjs` | all | Run lifecycle and unknown-result behavior |
| P0 | `services/api/src/durable-agent-session.mjs` | all | Encrypted session generations and compaction replacement semantics |
| P0 | `services/api/src/agent-state-crypto.mjs` | all | Exact AES-256-GCM envelope, AAD canonicalization, and key-version compatibility |
| P0 | `services/api/src/openai-responses-service.mjs` | all | Response proxy bounds, usage settlement, SSE forwarding, cancellation, and no-retry rules |
| P0 | `services/api/src/budgeted-responses-transport.mjs` | all | Agent-owned provider reservations, compact lane, circuit breaker, and pre-event retry ceiling |
| P0 | `services/api/src/usage-repository.mjs` | all | Advisory locking, integer micro-USD accounting, idempotency, and uncertain dispatch lifecycle |
| P0 | `services/api/migrations/*.sql` | all | Authoritative, already-deployed schema and constraints |
| P0 | `src/main/application/hosted-task-client.ts` | all | Installed client's durable task and SSE parser contract |
| P0 | `src/main/hosted/desktop-worker-client.ts` | all | Installed desktop-worker SSE and callback contract |
| P0 | `src/main/knowledge/knowledge-space-client.ts` | all | Installed Knowledge Spaces request/response schema contract |
| P1 | `services/api/src/config.mjs` | all | Exact environment variables, defaults, flags, and failure behavior |
| P1 | `services/api/src/admin-http-controller.mjs` | all | Embedded asset bytes, origin policy, admin sessions, pagination, and admin routes |
| P1 | `services/api/src/knowledge-space-http-controller.mjs` | all | Knowledge route inventory, validation, rate scopes, and response status codes |
| P1 | `services/api/src/agent-runtime-http-controller.mjs` | all | Task/worker route inventory and SSE wire format |
| P1 | `services/api/src/knowledge-space-contracts.mjs` | all | Knowledge input limits and validation error projection |
| P1 | `services/api/src/knowledge-extractors.mjs` | all | Text/PDF limits and chunk locator algorithm |
| P1 | `services/api/src/s3-object-store.mjs` | all | Presigned PUT/GET headers, expirations, checksum, and HEAD/GET behavior |
| P1 | `services/api/src/google-token-verifier.mjs` | all | Google JWKS cache and exact claim checks |
| P1 | `services/api/src/access-code-cipher.mjs` | all | Existing encrypted access-code byte format |
| P1 | `services/api/src/admin-session.mjs` | all | Existing browser-session and cookie byte format |
| P1 | `services/api/src/session-repository.mjs` | all | Existing opaque device tokens and session rotation behavior |
| P1 | `services/api/src/rate-limit-repository.mjs` | all | Shared database bucket digest and reset calculation |
| P1 | `services/api/src/activity-repository.mjs` | all | Largest Knowledge repository and transaction/idempotency patterns |
| P1 | `services/api/src/admin-repository.mjs` | all | Admin privacy projection, audit, access-code lifecycle, and SQL boundaries |
| P1 | `services/api/test/server.test.mjs` | all | Current black-box HTTP compatibility suite and test-server pattern |
| P1 | `services/api/test/backend-agent-runtime.test.mjs` | all | Agent interruption/effect behavior |
| P1 | `services/api/test/openai-responses-service.test.mjs` | all | Streaming and ambiguous-dispatch behavior |
| P1 | `services/api/test/openai-transcription-service.test.mjs` | all | Exact WAV/multipart/usage behavior |
| P1 | `services/api/test/integration/knowledge-postgres.test.mjs` | all | Existing real-PostgreSQL integration gate |
| P2 | `services/api/package.json` | all | Commands and pinned Node dependency responsibilities to replace |
| P2 | `services/api/railway.json` | all | Existing Railpack and health-check configuration |
| P2 | `.github/workflows/ci.yml` | all | Current cross-platform verification pipeline |
| P2 | `.env.example` | 1-76 | Public configuration contract and operator documentation |
| P2 | `README.md` | 207-240, 271-349, 417-421 | Production API, access, usage, and provider behavior documented to users/operators |

`docs/CODEX-NAVIGATION-GUIDE.md` is referenced by the supplied repository instructions but is absent from this checkout. Do not create behavior assumptions from that missing document; the files above are the concrete migration sources.

---

## Current Architecture and Data Flow

```text
Railway start
  -> load/validate every environment value
  -> open bounded PostgreSQL pool
  -> apply 17 idempotent SQL migrations in filename order
  -> compose repositories/services/controllers
  -> optionally compose admin, Knowledge Spaces, and backend agent runtime
  -> bind 0.0.0.0:$PORT with fixed timeout policy

Request
  -> request UUID + hardened security headers
  -> admin same-origin/static route delegation
  -> reject browser Origin on desktop API routes
  -> health/readiness OR knowledge controller OR agent controller OR core route
  -> authenticate opaque session and resolve account plan where required
  -> consume PostgreSQL-backed shared rate limit
  -> strict bounded validation
  -> transaction/repository OR bounded provider call/stream
  -> sanitized JSON/SSE/binary response
  -> structured completion log; structured failure log for 5xx only

Durable agent run
  -> submit + encrypted v8 request/contract + outcome criteria
  -> PostgreSQL SKIP LOCKED claim with lease owner/version fencing
  -> Responses loop with encrypted local session items and store:false
  -> at most one function interruption
  -> reconnectable desktop worker receives SSE invocation
  -> desktop obtains one-time execution grant and returns bounded result/evidence
  -> resume, verify all required current-revision criteria, complete or block
  -> executing disconnect/unknown result is never replayed
```

### Unified Discovery Table

| Category | File:Lines | Pattern | Required Rust equivalent |
|---|---|---|---|
| Similar implementation | `services/api/src/server.mjs:297-962` | One dependency-injected handler owns common HTTP behavior | One Axum `Router<AppState>` with narrow subrouters and common middleware |
| Naming | `services/api/src/session-repository.mjs:11-136` | Domain noun + `Repository` / `Service` / `Controller`; methods are verb-oriented | Rust modules in `snake_case`; public types in `PascalCase`; preserve domain terms |
| Error handling | `services/api/src/http-primitives.mjs:1-44`, `server.mjs:909-948` | Typed status/code errors; unknown errors become sanitized 500 | `ApiError` enum implementing `IntoResponse`; internal sources logged but never returned |
| Logging | `services/api/src/server.mjs:925-959` | Structured JSON allowlist with request ID, path, status, duration | `tracing` JSON events with identical event names/fields and explicit redaction tests |
| Types/contracts | `agent-runtime-contracts.mjs:1-281`, `knowledge-space-contracts.mjs:1-194` | Strict schemas, closed enums, size limits, cross-field refinements | Serde structs/enums plus `validator`/manual `Validate` implementations and `deny_unknown_fields` |
| Tests | `services/api/test/server.test.mjs:1-260` | In-memory test doubles plus real loopback server; provider fetch injected | Axum `tower::ServiceExt` tests plus loopback tests for streaming; traits/mocks for repos/providers |
| Configuration | `services/api/src/config.mjs:45-260` | Fail-fast required secrets, exact booleans/enums, bounded integers, stable defaults | Immutable `Config::from_env`; table-driven tests for every current variable |
| Dependencies | `services/api/package.json` | Node HTTP, pg, Zod, OpenAI Agents, AWS S3, pdfjs | Axum/Tokio, SQLx, Serde, Reqwest direct OpenAI HTTP, AWS Rust SDK, PDF extractor |
| Entry points | `main.mjs:48-298`, `ingestion-main.mjs:1-23` | API and ingestion worker are commands from one backend package | One `trocode-api` binary with `serve`, `ingestion-worker`, and operator subcommands |
| Data flow | `main.mjs:60-246` | Explicit dependency composition; optional features are null/fail closed | `AppState` composition with `Option<Arc<_>>`; disabled routes retain current behavior |
| State changes | `usage-repository.mjs:35-379`, `agent-run-repository.mjs:52-940` | Parameterized SQL, explicit transactions, row/advisory locks, idempotency keys, fencing | SQLx transactions with the SQL and transition preconditions preserved verbatim |
| Contracts | Desktop clients listed above | Existing installed clients validate responses independently | Golden HTTP/SSE fixtures and unchanged desktop tests are release-blocking |
| Architecture | `docs/architecture.md:57-73` | Backend owns model/session/leases; desktop retains local authority and approvals | Rust must not absorb CUA authority or weaken desktop revalidation |

---

## Frozen External Contract Inventory

The implementation may reorganize internals, but it must not rename or silently change these surfaces.

### Core API routes (`services/api/src/server.mjs`)

| Method and path | Contract that must remain stable |
|---|---|
| `GET /healthz` | Public 200 JSON `{status:"ok", version}` plus hardened headers |
| `GET /readyz` | 200/503 JSON based on `SELECT 1`; Railway health path remains `/healthz` |
| `POST /v1/auth/google/exchange` | IP rate limit, Google RS256 verification, opaque `tro_live_` session issuance |
| `POST /v1/auth/session/refresh` | Authenticated one-use rotation; previous token stops working |
| `DELETE /v1/auth/session` | Authenticated revocation; 204 empty response |
| `GET /v1/access-code-redemptions/me` | Authenticated membership projection |
| `POST /v1/access-code-redemptions` | User+IP limits, normalized code, exact 201/200/400/403/409 cases |
| `POST /v1/access-code-redemptions/free` | Explicit Free onboarding, blocked-account rejection |
| `POST /v1/agent-turns` | Strict two-UUID body, idempotent weekly message reservation, `Location` header |
| `POST /v1/openai/responses` | Strict allowlist/body/header validation, stream or JSON proxy, store false, usage settlement |
| `GET /v1/usage/budget` | Authenticated owner-only snapshot; optional validated `taskId` |
| `POST /v1/openai/audio/transcriptions` | Exact four-field JSON, strict bounded PCM WAV, contract-v2 model alias behavior |
| `POST /v1/openai/realtime/calls` | `en|vi`, bounded SDP, multipart provider proxy, reservation lifecycle |
| `POST /v1/elevenlabs/speech` | 1-240 chars, optional configuration, bounded progressive MP3 proxy |

### Admin routes and assets (`services/api/src/admin-http-controller.mjs`)

Preserve `GET /source/admin[/]`, the three `/source/admin/assets/*` paths, strict CSP/header bytes, bearer login -> signed hardened cookie flow, same-origin validation, no-store, rate limiting, and these APIs:

- `POST|DELETE /v1/admin/session`
- `GET /v1/admin/users`
- `GET /v1/admin/usage`
- `GET /v1/admin/access-codes`
- `POST /v1/admin/access-codes/bulk`
- `PATCH|DELETE /v1/admin/access-codes/:codeId`
- `GET /v1/admin/access-codes/:codeId/users`
- `PATCH /v1/admin/users/:userId/access`
- `POST /v1/admin/users/:userId/access-code`

### Knowledge routes (`services/api/src/knowledge-space-http-controller.mjs:42-181`)

Preserve capability discovery, feature-disabled behavior, per-plan/rate-scope limits, strict request schemas, idempotent client IDs, `Location` headers, role checks, and the following families:

- `GET /v1/capabilities`
- `GET|POST /v1/spaces`
- `POST /v1/space-invites/redeem`
- `GET /v1/spaces/:spaceId`
- `GET /v1/spaces/:spaceId/sources`
- `POST /v1/spaces/:spaceId/uploads/initiate`
- `GET|POST /v1/spaces/:spaceId/groups`
- `GET /v1/spaces/:spaceId/members`
- `POST /v1/spaces/:spaceId/invites`
- `POST /v1/uploads/complete`
- `POST /v1/spaces/:spaceId/activities`
- `POST /v1/spaces/:spaceId/activities/:activityId/publish`
- `POST /v1/spaces/:spaceId/runs`
- `POST /v1/spaces/:spaceId/runs/:runId/open|close`
- `GET /v1/assignments/me`
- `GET /v1/attempts/:attemptId`
- `GET /v1/attempts/:attemptId/starter-files`
- `POST /v1/attempts/:attemptId/submissions/initiate|commit`
- `POST /v1/attempts/:attemptId/acknowledge|help|work-sessions|knowledge/search|evidence`
- `PATCH /v1/work-sessions/:workSessionId`
- `GET /v1/spaces/:spaceId/runs/:runId/dashboard`

### Durable agent/desktop-worker routes (`services/api/src/agent-runtime-http-controller.mjs:39-186`)

- `GET /v1/agent-runtime/status`
- `GET|POST /v1/tasks`
- `GET|DELETE /v1/tasks/:runId`
- `GET /v1/tasks/:runId/events` with `Last-Event-ID`/`after` replay, event IDs, named events, heartbeat, no buffering, and connection cancellation
- `POST /v1/tasks/:runId/cancel|steering|approval`
- `POST /v1/desktop-worker/connect`
- `GET /v1/desktop-worker/events?workerSessionId=...` with one-second heartbeats and de-duplicated invocation IDs
- `POST /v1/desktop-worker/:workerSessionId/heartbeat|executing|result|disconnect`

### Persistence and byte-level compatibility

- Keep all existing table/column/constraint/index names and SQL semantics in `services/api/migrations/001_*.sql` through `017_*.sql`.
- Keep opaque device tokens as `tro_live_` plus 43 base64url characters and store only the existing HMAC-SHA256 digest.
- Keep rate-limit identity digest input exactly `trocode-rate-limit-v1\0 + scope + \0 + key`.
- Keep admin cookie value exactly `v1.<expiry-seconds>.<43-char-base64url-HMAC>` and cookie attributes exactly `Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=...`.
- Keep encrypted access code format exactly `[version=1][12-byte IV][16-byte GCM tag][ciphertext]`, HMAC-derived key label `trocode-access-code-encryption-v1\0`, and code digest as GCM AAD.
- Keep agent-state AES-256-GCM fields separate (`ciphertext`, 12-byte IV, 16-byte tag, key version), and generate AAD with recursively sorted-object stable JSON exactly as `agent-state-crypto.mjs:7-13`.
- Preserve S3 object keys, exact checksum headers, 300-second PUT tickets, 120-second GET tickets, and exact-object-only operations.
- Preserve integer micro-USD calculations and never use floating-point money.
- Preserve the rule: a consequential action with unknown completion is never retried.

### Environment configuration contract

The Rust loader must recognize the same names, defaults, bounds, and cross-field checks:

- Required: `DATABASE_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `OPENAI_API_KEY`, `TROCODE_SESSION_TOKEN_HMAC_KEY`.
- Server/pool/session: `PORT`, `TROCODE_DATABASE_POOL_MAX`, `TROCODE_SESSION_DURATION_DAYS`, `RAILWAY_GIT_COMMIT_SHA`.
- Models: `TROCODE_AGENT_MODEL`, `TROCODE_AGENT_MODEL_ALLOWLIST`.
- Cost guard: `TROCODE_COST_GUARD_MODE`, `TROCODE_PAID_CALLS_ENABLED`, `TROCODE_MONTHLY_BUDGET_MICRO_USD`, `TROCODE_DAILY_BUDGET_MICRO_USD`, `TROCODE_TASK_BUDGET_MICRO_USD`, `TROCODE_BUDGET_WARNING_PERCENT`, `TROCODE_RESERVATION_TTL_MS`, `TROCODE_REALTIME_CALL_ESTIMATE_MICRO_USD`, `TROCODE_SPEECH_MICRO_USD_PER_THOUSAND_CHARACTERS`, `TROCODE_TRANSCRIPTION_MICRO_USD_PER_MINUTE`.
- Admin: `TROCODE_ADMIN_ACCESS_TOKEN`.
- Knowledge: `TROCODE_KNOWLEDGE_SPACES_ENABLED`, `TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID`, `TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY`, `TROCODE_KNOWLEDGE_S3_BUCKET`, `TROCODE_KNOWLEDGE_S3_REGION`, `TROCODE_KNOWLEDGE_S3_ENDPOINT`, `TROCODE_KNOWLEDGE_S3_FORCE_PATH_STYLE`.
- Backend agent: `TROCODE_BACKEND_AGENT_ENABLED`, `TROCODE_BACKEND_AGENT_ROLLOUT_PERCENT`, `TROCODE_BACKEND_AGENT_CANARY_USERS`, `TROCODE_AGENT_RUNTIME_PROTOCOL_VERSION`, `TROCODE_INTENT_AUTHORIZATION_ENABLED`, `TROCODE_INTENT_AUTHORIZATION_CANARY_USERS`, `TROCODE_INTENT_AUTHORIZATION_ROLLOUT_PERCENT`, `TROCODE_AGENT_STATE_ENCRYPTION_KEYS`, `TROCODE_AGENT_STATE_KEY_VERSION`, `TROCODE_AGENT_LEASE_MS`, `TROCODE_DESKTOP_WORKER_TTL_MS`, `TROCODE_AGENT_PAYLOAD_TTL_MS`, `TROCODE_AGENT_COMPACTION_ITEM_THRESHOLD`, `TROCODE_AGENT_MAX_ACTIVE_RUNS_PER_USER`, `TROCODE_AGENT_MAX_QUEUE_DEPTH`, `TROCODE_PLAYWRIGHT_CDP_ENABLED`.
- Voice: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`.

Do not introduce renamed Rust-only production variables unless they are additive diagnostics with safe defaults.

---

## External Documentation and Research

| Topic | Source | Key takeaway |
|---|---|---|
| Official Agents SDK support | https://openai.github.io/openai-agents-js/ | The official TypeScript SDK describes a Python counterpart; no supported Rust Agents SDK path is identified. This is an inference from the official supported SDK documentation, so Rust must own the Responses loop explicitly rather than depend on an unofficial agent framework. |
| Agents SDK sessions/compaction | https://openai.github.io/openai-agents-js/guides/sessions/ | Sessions prepend/persist items and `OpenAIResponsesCompactionSession` rewrites local history through `responses.compact`; reproduce those semantics around the existing encrypted session store. |
| Responses streaming | https://platform.openai.com/docs/api-reference/responses-streaming/response/output_item | Responses streams are SSE event sequences; accounting must settle only from the validated terminal `response.completed` payload. |
| Railway Rust builds | https://docs.railway.com/builds/railpack | Railpack supports Rust natively and can build/start it in the current service. |
| Railway Rust example | https://docs.railway.com/guides/actix-web | Railway explicitly states that Railpack auto-detects Rust apps; a new service is unnecessary. |
| Axum SSE | https://docs.rs/axum/latest/axum/response/sse/ | Axum 0.8 provides typed SSE events and configurable keep-alives; use it for Tro task/worker streams, but preserve Tro's IDs/names/timing. |
| SQLx migrations | https://docs.rs/sqlx/latest/sqlx/macro.migrate.html | Embedded migrations require a stable `build.rs` rerun hint for new migration files; SQLx migration bookkeeping must be tested against an already-migrated production-shaped database. |
| SQLx Postgres/TLS | https://docs.rs/sqlx/latest/sqlx/ | Use Tokio plus rustls and preserve PostgreSQL transactional locking semantics. |
| Reqwest streaming | https://docs.rs/reqwest/latest/reqwest/struct.Response.html | Reqwest exposes `bytes_stream`; enforce the current byte and line bounds while forwarding progressively. |
| Reqwest timeouts/multipart | https://docs.rs/reqwest/latest/reqwest/struct.RequestBuilder.html | Request timeout covers the response body, so use separate header/body cancellation where current streams have distinct header deadlines. |
| AWS S3 presigning | https://docs.rs/aws-sdk-s3/latest/aws_sdk_s3/operation/put_object/builders/struct.PutObjectFluentBuilder.html | The official Rust SDK supports presigned PUT and `checksum_sha256`; preserve signed headers and ticket lifetimes. |
| Google JWT/JWKS | https://docs.rs/jsonwebtoken/latest/jsonwebtoken/ and https://docs.rs/jsonwebtoken/latest/jsonwebtoken/jwk/struct.JwkSet.html | `jsonwebtoken` supports RS256/JWK sets and claim validation; retain the current cache and required issuer/audience/time/email checks. |
| PDF extraction | https://docs.rs/pdf-extract/latest/pdf_extract/ | `pdf_extract` 0.12 exposes in-memory per-page extraction; it is only accepted after corpus parity against current `pdfjs-dist`. |

### Research Findings

```text
KEY_INSIGHT: There is no official drop-in Rust equivalent for the pinned @openai/agents Runner/RunState behavior.
APPLIES_TO: Durable agent runtime, checkpoints, sessions, compaction, interruptions, and tracing.
GOTCHA: Do not serialize a new Rust state into the old JavaScript RunState format or attempt best-effort deserialization. Drain legacy nonterminal runs, introduce an explicitly versioned Rust checkpoint payload, and keep terminal history readable.
```

```text
KEY_INSIGHT: A direct Responses loop is supported by the same API primitives the Agents SDK uses.
APPLIES_TO: Model calls, function tools, store:false history, streaming usage, and compaction.
GOTCHA: The loop must preserve one-tool-at-a-time interruption, session mutation order, locally persisted items, max-turn enforcement, no replay after ambiguous dispatch, and input-based compaction when responses are not stored.
```

```text
KEY_INSIGHT: Railway can build Rust in the existing service with Railpack.
APPLIES_TO: Deployment and rollback.
GOTCHA: Because the crate exposes more than one operational command, configure an explicit API start command and update the existing ingestion worker's override; never rely on ambiguous binary auto-selection.
```

```text
KEY_INSIGHT: SQLx migration bookkeeping differs from the current “rerun every idempotent SQL file” loader.
APPLIES_TO: Existing production database startup.
GOTCHA: Rehearse first Rust startup against a restored production-shaped database. All 17 existing scripts must run safely once under SQLx, record checksums, and then become no-ops on the next startup. Force LF migration line endings and use `build.rs` to track the directory.
```

```text
KEY_INSIGHT: Framework defaults do not equal wire parity.
APPLIES_TO: SSE, JSON errors, cookies, security headers, streaming cancellation, content lengths, and timeouts.
GOTCHA: Axum/Reqwest defaults must be overridden wherever the current Node server has an observable status/header/body/chunking rule.
```

---

## Strategic Architecture

### Chosen approach

Build one Rust crate at `services/api` with a library plus one `trocode-api` binary exposing subcommands:

```text
trocode-api serve
trocode-api ingestion-worker
trocode-api access-code create ...
trocode-api knowledge-load-report ...
trocode-api knowledge-worker-smoke ...
```

The API uses Axum/Tokio, Serde, SQLx/PostgreSQL, Reqwest, the official AWS Rust S3 SDK, and explicit cryptographic primitives. The durable backend agent becomes a small Tro-owned state machine over the OpenAI Responses API rather than an unofficial Rust agent library. All domain transitions stay pure where they are pure today, while repositories preserve the current SQL locking/fencing/idempotency behavior.

### Proposed module tree

```text
services/api/
  Cargo.toml
  Cargo.lock
  rust-toolchain.toml
  build.rs
  railway.json
  migrations/                       # retain 001..017 unchanged
  public/                           # retain admin assets unchanged
  src/
    main.rs                         # clap subcommands only
    lib.rs
    app.rs                          # dependency composition and graceful shutdown
    config.rs
    error.rs
    observability.rs
    http/
      mod.rs
      middleware.rs                 # request ID, security headers, origin, logs, limits
      core.rs                       # health/auth/access/usage/provider routes
      admin.rs
      knowledge.rs
      agent_runtime.rs
      sse.rs
    auth/
      mod.rs
      google.rs
      sessions.rs
      access_codes.rs
      admin_session.rs
      admin_repository.rs
    usage/
      mod.rs
      plans.rs
      models.rs
      budget.rs
      repository.rs
      rate_limit.rs
    providers/
      mod.rs
      responses.rs
      transcription.rs
      realtime.rs
      speech.rs
      trace_export.rs
    knowledge/
      mod.rs
      contracts.rs
      policy.rs
      repositories.rs               # split internally only if the file becomes unwieldy
      services.rs
      search.rs
      object_store.rs
      extraction.rs
      ingestion.rs
    agent/
      mod.rs
      contracts.rs
      crypto.rs
      tool_catalog.rs
      intent.rs
      outcome.rs
      model_policy.rs
      rollout.rs
      repository.rs
      durable_session.rs
      responses_runner.rs
      run_service.rs
      run_worker.rs
      desktop_worker.rs
      event_stream.rs
    cli/
      mod.rs
      access_codes.rs
      knowledge_report.rs
      knowledge_smoke.rs
  tests/
    support/mod.rs
    contract_corpus.rs
    http_core.rs
    http_admin.rs
    http_knowledge.rs
    http_agent.rs
    crypto_compat.rs
    postgres_compat.rs
    provider_streaming.rs
    ingestion.rs
    agent_runtime.rs
    migration.rs
```

Exact internal splits may change to keep modules cohesive, but the ownership boundaries above are fixed: HTTP parsing does not own domain policy, repositories do not own authorization, provider clients do not own budget decisions, and the remote agent cannot grant local authority.

### Direct Responses runner state machine

1. Claim a run with the existing PostgreSQL lease owner, lease expiry, and `run_version` fence.
2. Load/decrypt the original request, v8 contract, current intent revision, current outcome contract, and current Rust session generation.
3. Intersect desktop capabilities with the exact server tool catalog and verify the same schema digest.
4. Build a Responses request with the existing system instructions, selected model/reasoning effort, `store:false`, `parallel_tool_calls:false`, strict function schemas, bounded max turns, and locally replayed session items.
5. Reserve usage before dispatch. For a request that may have reached OpenAI, mark failure uncertain and do not retry. Preserve the existing maximum of two retries only for explicitly pre-event retryable agent-internal calls.
6. Validate each output item. Reject multiple function calls, unknown tools, unknown operations, malformed effects, and graph-digest mismatches.
7. If final text is returned, append the exact input/output items atomically, verify every current required outcome, and complete only through the existing repository transition.
8. If one function call is returned, append the model items, persist a versioned Rust checkpoint containing the pending call and continuation inputs, create one invocation envelope, release the model lease, and wait for the desktop worker.
9. After an accepted desktop result, append a `function_call_output` item exactly once and continue the loop. A denied/not-executed/unknown/cancelled result follows the existing terminal or recovery decision table; an unknown consequential result blocks and is never replayed.
10. When the configured item threshold is crossed, call `/v1/responses/compact` with input-based local history, then atomically replace session generations. If compaction or restoration fails, keep the last committed generation and fail closed.
11. Emit equivalent non-sensitive trace/span records or the existing structured operational events. Trace export is best-effort and must never change task success.

### Checkpoint versioning and cutover rule

- Add a new Rust-owned checkpoint payload version inside the existing encrypted checkpoint columns; do not alter the protocol-v2 desktop API.
- Terminal JavaScript-created runs remain readable through common table projections.
- Rust must not resume a nonterminal JavaScript Agents SDK serialized `RunState`.
- Production cutover requires a query proving zero nonterminal legacy runs, zero executing/delivered invocations, and zero connected worker sessions. If the query is nonzero, keep the JavaScript deployment active and continue draining; do not force the migration.
- Do not mark old runs completed merely to satisfy the drain. Cancel/expire only through the existing product/operator rules and communicate a maintenance window if needed.

### Alternatives considered

| Alternative | Decision |
|---|---|
| Rust sidecar behind the Node server | Rejected: keeps a JavaScript backend and introduces another runtime/process boundary |
| New Rust service/domain with traffic migration | Rejected: violates the in-place/no-new-service requirement and complicates credentials/data ownership |
| Node native addon for selected hot paths | Rejected: partial migration with Node packaging and ABI risk |
| Python backend using the official Agents SDK | Rejected: does not meet the Rust requirement |
| Unofficial Rust OpenAI agent framework | Rejected: unacceptable checkpoint, security, and version-parity risk |
| Re-platform Electron to Tauri | Rejected: desktop/frontend is out of scope and would change signing/permission identity |
| Big-bang rewrite and immediate production deploy | Rejected: no differential oracle or safe rollback evidence |

## NOT Building

- No new public API version, service, URL, database, schema redesign, bucket, queue, cache, or message broker.
- No renderer, Electron, CUA, desktop policy, or local-history migration to Rust.
- No UI redesign or admin frontend rewrite.
- No pricing, plan, quota, model, prompt, tool catalog, feature-flag, or product-policy change.
- No migration from PostgreSQL to another datastore.
- No S3 object relocation or re-upload.
- No cleanup of legacy tables/data unrelated to implementation replacement.
- No retry expansion; especially no retry after unknown consequential completion.
- No feature work hidden inside the migration.

---

## Patterns to Mirror

These are actual reference patterns from the current codebase. Preserve their behavior, not their JavaScript syntax.

### NAMING_CONVENTION

```js
// SOURCE: services/api/src/session-repository.mjs:11-18
export class PostgresSessionRepository {
  constructor(pool, { hmacKey, sessionDurationDays }) {
    this.pool = pool;
    this.hmacKey = hmacKey;
    this.sessionDurationDays = sessionDurationDays;
  }

  async issue(user) {
```

Rust repositories/services keep the same domain nouns (`PostgresSessionRepository`, `BudgetService`, `AgentRunService`) and verb methods (`issue`, `authenticate`, `reserve`, `settle`, `claim`).

### ERROR_HANDLING

```js
// SOURCE: services/api/src/http-primitives.mjs:1-5
export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message); this.status = status; this.code = code;
  }
}
```

```js
// SOURCE: services/api/src/server.mjs:917-944
const status = isTypedHttpError ? error.status : 500;
const message =
  isTypedHttpError ? error.message : 'An internal error occurred.';
sendJson(response, status, {
  ...(typeof error?.code === 'string' ? { code: error.code } : {}),
  error: message,
});
```

Rust `ApiError` must preserve status/code/public message while retaining a private source chain for logs.

### LOGGING_PATTERN

```js
// SOURCE: services/api/src/server.mjs:925-959
console.error(JSON.stringify({
  durationMs: Date.now() - startedAt,
  event: 'request.failed',
  method: request.method,
  path: request.url?.split('?')[0],
  requestId,
  status,
}));

console.info(JSON.stringify({
  durationMs: Date.now() - startedAt,
  event: 'request.completed',
  method: request.method,
  path: request.url?.split('?')[0],
  requestId,
  status: response.statusCode,
}));
```

Never add token, prompt, transcript, screenshot, URL query, file path, raw provider body, or tool arguments to Rust logs.

### REPOSITORY_TRANSACTION_PATTERN

```js
// SOURCE: services/api/src/knowledge-repository-utils.mjs:1-13
export async function inTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await operation(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

Use `let mut tx = pool.begin().await?; ... tx.commit().await?;`; preserve lock order and commit-before-return semantics.

### CONCURRENCY_AND_BUDGET_PATTERN

```js
// SOURCE: services/api/src/usage-repository.mjs:35-61
await client.query('BEGIN');
await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
  input.userId,
]);
const duplicate = await client.query(
  `SELECT request_id, reserved_micro_usd, actual_micro_usd, status
   FROM model_budget_reservations
   WHERE user_id = $1 AND request_id = $2`,
  [input.userId, input.requestId],
);
if (duplicate.rows[0]) {
  await client.query('COMMIT');
  return { kind: 'duplicate', reservation: normalizeReservation(duplicate.rows[0]) };
}
```

Do not replace database serialization with process-local mutexes; multiple Railway replicas and the worker share state.

### BOUNDARY_VALIDATION

```js
// SOURCE: services/api/src/agent-runtime-contracts.mjs:20-48
export const ActionEffectSchema = z.object({
  kind: ActionEffectKindSchema,
  resourceKind: ResourceKindSchema.nullable(),
  reversibility: z.enum(['none', 'reversible', 'destructive', 'unknown']),
  externality: z.enum(['local', 'cloud_private', 'external', 'public', 'unknown']),
  communication: z.enum(['none', 'draft', 'send', 'invite', 'notify', 'unknown']),
  overwrite: z.enum(['none', 'requested', 'unexpected', 'unknown']),
  sensitiveDataTransfer: z.union([z.boolean(), z.literal('unknown')]),
}).strict().superRefine(/* cross-field invariants */);
```

Every Rust request struct uses `#[serde(deny_unknown_fields)]`; manual validation reproduces all strictness and cross-field invariants.

### CRYPTO_COMPATIBILITY

```js
// SOURCE: services/api/src/agent-state-crypto.mjs:46-59
const iv = randomBytes(IV_BYTES);
const cipher = createCipheriv(ALGORITHM, this.keys.get(this.currentKeyVersion), iv, { authTagLength: TAG_BYTES });
cipher.setAAD(Buffer.from(stableJson(metadata), 'utf8'));
const ciphertext = Buffer.concat([
  cipher.update(JSON.stringify(value), 'utf8'),
  cipher.final(),
]);
return { ciphertext, iv, keyVersion: this.currentKeyVersion, tag: cipher.getAuthTag() };
```

Cross-language golden fixtures are mandatory before changing any crypto code.

### NO_RETRY_AFTER_AMBIGUOUS_DISPATCH

```js
// SOURCE: services/api/src/openai-responses-service.mjs:124-142
try {
  response = await this.fetchImpl(OPENAI_RESPONSES_URL, { /* ... */ });
} catch {
  await this.budgetService.markUncertain(input.userId, input.requestId);
  throw new ResponsesServiceError(
    502,
    'The model provider is temporarily unavailable. This call was not retried.',
    'ambiguous_dispatch',
  );
}
```

Reqwest middleware must not install transparent request retries.

### TEST_STRUCTURE

```js
// SOURCE: services/api/test/server.test.mjs:130-260
async function withApi(run, options = {}) {
  const sessions = memorySessions();
  const accessCodes = memoryAccessCodes();
  // inject repositories/provider fetch
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run({ baseUrl, sessions, accessCodes });
  } finally {
    await new Promise((resolve, reject) => server.close(/* ... */));
  }
}
```

Keep narrow trait-based test doubles and add real loopback tests where first-chunk timing, disconnect, headers, or SSE bytes matter.

---

## Dependencies and Import Map

Pin exact versions in `Cargo.lock`; use the current compatible release at implementation time only after the listed APIs pass a spike. Expected crates and responsibilities:

| Crate/import | Responsibility | Constraints |
|---|---|---|
| `tokio` | async runtime, signals, timers, tasks | No detached task may outlive graceful shutdown without cancellation |
| `axum`, `tower`, `tower-http` | routing, middleware, bodies, SSE | Disable/override defaults that change current headers/body limits |
| `serde`, `serde_json` | contracts and persistence JSON | `deny_unknown_fields`; preserve camelCase wire names and stable canonicalization where hashed/AAD-bound |
| `sqlx` with Postgres, Tokio, rustls, migrate, uuid, time/json features | database and embedded migrations | Preserve raw SQL transition semantics and production TLS behavior |
| `reqwest` with rustls, json, multipart, stream | OpenAI/ElevenLabs/Google HTTP | No automatic retries; explicit header/body deadlines and byte bounds |
| `aws-config`, `aws-sdk-s3`, `aws-credential-types` | private object store | Endpoint override, force-path-style, checksum, HEAD/GET, presigning parity |
| `jsonwebtoken` | Google RS256/JWKS | Require `kid`, exact issuers/audience/time/email_verified/sub/email/name constraints |
| `aes-gcm`, `hmac`, `sha2`, `subtle`, `rand`, `base64` | existing cryptographic formats | Constant-time comparisons; byte-for-byte fixtures in both directions |
| `uuid` | request/entity identifiers | UUID v4 generation and permissive validation only where current regex permits versions 1-8 |
| `time` | RFC3339/UTC timestamps | Serialize with millisecond-compatible RFC3339 accepted by desktop Zod schemas |
| `bytes`, `futures-util`, `tokio-stream`, `tokio-util` | bounded streaming and cancellation | Backpressure; cancel upstream on downstream disconnect |
| `thiserror`, `anyhow` | typed/public vs internal errors | `anyhow` only at command/composition boundaries, never as public API mapping |
| `tracing`, `tracing-subscriber` | structured operational logs | JSON allowlist and sensitive-data regression tests |
| `clap` | API/worker/operator subcommands | Preserve current CLI inputs and safe output behavior |
| `pdf-extract` | per-page PDF text | Conditional on differential corpus; otherwise isolate an alternative behind `PdfExtractor` |
| Dev: `http-body-util`, `wiremock`/`mockito`, `proptest`, `insta`, `testcontainers` or CI Postgres/MinIO | tests | Snapshots must not contain secrets or user content |

Do not add a general-purpose retry crate to provider clients. Do not use `unsafe` without a separately reviewed ADR and a deny-by-default lint.

---

## Files to Change

### Create

| File/group | Action | Justification |
|---|---|---|
| `services/api/Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `build.rs` | CREATE | Reproducible Rust crate/toolchain and migration embedding |
| `services/api/src/main.rs`, `lib.rs`, `app.rs`, `config.rs`, `error.rs`, `observability.rs` | CREATE | Command entry, composition, configuration, public error, and logging foundations |
| `services/api/src/http/*.rs` | CREATE | Core/admin/knowledge/agent routes, middleware, bounded bodies, and SSE |
| `services/api/src/auth/*.rs` | CREATE | Google/session/access/admin behavior and repositories |
| `services/api/src/usage/*.rs` | CREATE | Plan/model catalogs, budget, ledger, and shared rate limiter |
| `services/api/src/providers/*.rs` | CREATE | Responses, transcription, realtime, speech, and optional trace export clients |
| `services/api/src/knowledge/*.rs` | CREATE | Contracts, policy, repositories, services, search, S3, extraction, and worker |
| `services/api/src/agent/*.rs` | CREATE | Protocol, crypto, direct Responses runner, state/repositories, worker, SSE, and desktop bridge |
| `services/api/src/cli/*.rs` | CREATE | Replace backend-dependent Node operator scripts |
| `services/api/tests/*.rs`, `services/api/tests/support/*`, `services/api/tests/fixtures/*` | CREATE | Ported tests, cross-language golden corpus, differential and real-dependency gates |
| `services/api/.cargo/config.toml` if needed | CREATE | SQLx offline/check configuration only; no secrets |
| `.gitattributes` if absent | CREATE/UPDATE | Force `services/api/migrations/*.sql text eol=lf` for stable checksums |

### Update without changing public behavior

| File | Action | Justification |
|---|---|---|
| `services/api/railway.json` | UPDATE | Explicit Rust release build/start command and same `/healthz` policy |
| `package.json` | UPDATE | Root `check` runs Rust backend gates; access-code command invokes Rust binary |
| `.github/workflows/ci.yml` | UPDATE | Install pinned Rust, cache Cargo, run fmt/clippy/test/audit plus existing macOS/Windows desktop checks |
| `.env.example` | UPDATE | Remove Node wording only; preserve every variable/default |
| `README.md` | UPDATE | Rust commands and same-service deployment/rollback documentation |
| `docs/architecture.md`, `docs/security.md`, `docs/knowledge-spaces.md`, `docs/agent-runtime-operations.md` | UPDATE | Replace SDK/runtime implementation descriptions while preserving trust invariants |
| `docs/testing/*` relevant to backend gates | UPDATE | Record differential, crypto, database, streaming, and cutover evidence |

### Retain byte-for-byte unless a separate migration requires a change

- `services/api/migrations/001_hosted_sessions.sql` through `017_free_plan_onboarding.sql`.
- `services/api/public/admin.html`, `admin.css`, `admin.js`, and `admin-favicon.svg`.
- Desktop client route and schema code under `src/main` and `src/shared`.

### Delete only after every parity gate passes

| File/group | Action | Justification |
|---|---|---|
| `services/api/src/*.mjs` | DELETE | Rust implementation is the sole backend runtime |
| `services/api/test/**/*.mjs` | DELETE | Replaced by Rust tests and contract corpus |
| `services/api/scripts/*.mjs` | DELETE | Replaced by Rust subcommands |
| `scripts/access-codes.mjs`, `scripts/access-codes.test.mjs` | DELETE | Replaced by Rust CLI/tests |
| `services/api/package.json`, `services/api/package-lock.json` | DELETE | Backend no longer needs a Node dependency tree |

Deletion is the final implementation task, not an early cleanup step.

---

## Step-by-Step Tasks

### Task 1: Freeze the reference behavior and compatibility corpus

- **ACTION**: Capture the current backend as an executable oracle before writing production Rust modules.
- **IMPLEMENT**:
  - Run `npm --prefix services/api ci`, the 130-test suite, optional real PostgreSQL test, audit, root checks, and desktop package build; record versions and results.
  - Build machine-readable route fixtures for every route family: method/path/query, headers, request bytes, expected status/headers/body, and database/provider side effects.
  - Capture raw SSE frames and timing assertions for Responses proxy, task events, and desktop-worker events.
  - Generate deterministic cross-language fixtures for session HMACs, rate-limit digests, admin cookies, access-code AES-GCM blobs, agent AES-GCM envelopes/AAD, catalog hashes, tool-schema digest, intent grants/digests, outcome digests, and canonical JSON.
  - Add a representative PDF corpus: text PDF, multi-page/unicode PDF, empty/scanned PDF, encrypted PDF, malformed signature, near-page limit, and near-character limit. Store only synthetic/licensed fixtures.
  - Export a sanitized production-shaped schema/data fixture or generator covering all 39 tables and every active/terminal state; never copy real secrets or user content.
- **MIRROR**: Existing tests under `services/api/test`; crypto sources listed in Mandatory Reading.
- **IMPORTS**: Current Node test runner only at this stage; fixture files must be language-neutral JSON/hex/base64/raw HTTP.
- **GOTCHA**: Randomized encryption needs injectable fixed IVs in a test-only harness; never add deterministic IVs to production code. Golden payloads must exclude credentials and private user data.
- **VALIDATE**: Corpus replay against the JavaScript server is green twice and produces identical normalized results; baseline remains 130 pass / 1 environment skip or better.

### Task 2: Scaffold the Rust crate, commands, lints, CI, and composition seams

- **ACTION**: Add the Rust crate without changing the production start command.
- **IMPLEMENT**:
  - Pin Rust 1.97.1 and dependencies in `Cargo.lock`.
  - Add `#![forbid(unsafe_code)]`, clippy warning policy, release profile, `build.rs` migration tracking, and LF migration rules.
  - Add the `serve`, `ingestion-worker`, `access-code`, `knowledge-load-report`, and `knowledge-worker-smoke` subcommands.
  - Define traits for repositories, provider transport, object store, clock, ID source, and PDF extraction so unit tests are deterministic.
  - Add Rust fmt/clippy/test/build/audit jobs while leaving Node backend tests active during migration.
- **MIRROR**: Dependency composition at `main.mjs:48-246`; current commands in `services/api/package.json` and root `package.json`.
- **IMPORTS**: `clap`, `tokio`, `thiserror`, `tracing`, module dependencies from the import map.
- **GOTCHA**: Do not switch Railway or root test scripts yet. Multiple binaries can confuse Railpack; one binary with subcommands avoids that.
- **VALIDATE**: `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, empty/scaffold `cargo test`, and locked release build pass on Linux CI.

### Task 3: Port configuration, errors, observability, HTTP primitives, and static admin assets

- **ACTION**: Establish fail-fast startup and wire-compatible common HTTP behavior.
- **IMPLEMENT**:
  - Port every config variable/default/bound from `config.mjs` into immutable typed structs.
  - Implement bounded JSON/body readers with 400/413/415 parity, bearer parsing, UUID path parsing, `ApiError`, and response helpers.
  - Add request IDs, security headers, origin policy, exact admin delegation order, JSON completion/failure logs, and panic-to-sanitized-500 containment.
  - Embed the four admin assets at compile time and serve the same bytes/content types/CSP/cache headers.
  - Configure equivalent header/request/keep-alive/shutdown timeouts; add downstream-disconnect cancellation tokens.
- **MIRROR**: `config.mjs:1-260`, `http-primitives.mjs:1-44`, `server.mjs:40-182, 297-348, 909-962`, `admin-http-controller.mjs:21-118`.
- **IMPORTS**: `axum::{Router, extract, response}`, `tower`, `tower-http`, `serde`, `tracing`, `uuid`.
- **GOTCHA**: Admin browser routes are handled before the desktop API rejects `Origin`. Framework JSON extractors often expose different error bodies; map them explicitly.
- **VALIDATE**: Differential tests prove exact status/header/body parity for health, readiness, 404, malformed JSON, too-large bodies, browser origin, security headers, and admin asset hashes.

### Task 4: Preserve database startup, transactions, and migration compatibility

- **ACTION**: Introduce SQLx without changing the schema contract.
- **IMPLEMENT**:
  - Configure bounded `PgPool` and production TLS behavior equivalent to current Railway settings.
  - Embed all 17 migrations and test first Rust startup on both an empty database and a clone already initialized by Node.
  - Verify SQLx's migration table/checksums and second-start no-op behavior; keep the existing migration files unchanged.
  - Add helpers for typed row conversion, ISO/RFC3339 projection, transaction scopes, conflict mapping, advisory locks, and test rollback.
  - Use runtime-checked SQL initially for very complex queries, then adopt compile-time SQLx checking with checked-in offline metadata only after the schema fixture is stable.
- **MIRROR**: `migrate.mjs`, `knowledge-repository-utils.mjs`, all migrations, and `migrate.test.mjs`.
- **IMPORTS**: `sqlx::{PgPool, Postgres, Transaction, migrate}`, `time`, `uuid`, `serde_json`.
- **GOTCHA**: SQLx should not “repair” or rename deployed objects. Ensure Postgres multi-statement migration/transaction behavior and migration locks work when API and existing worker start near each other.
- **VALIDATE**: Schema diff between Node-created and Rust-created databases is empty except approved SQLx bookkeeping; all migrations run once on a populated clone and the second Rust startup changes no domain rows.

### Task 5: Port authentication, sessions, access codes, admin API, and operator CLI

- **ACTION**: Port identity and administrative behavior with byte-compatible credentials.
- **IMPLEMENT**:
  - Implement Google JWKS fetch/cache and exact RS256 header/issuer/audience/iat/exp/email_verified/sub/email/name validation.
  - Port opaque token issuance/authentication/rotation/revocation and blocked-user behavior.
  - Port access-code normalization, HMAC digest, Free onboarding, locked redemption capacity, paused/full/linked states, and status projection.
  - Port admin signed cookies, constant-time bearer/cookie checks, same-origin validation, pagination/search filters, audit transactions, code grant/pause/delete/bulk-create behavior, and privacy-safe projections.
  - Port the root access-code create CLI with the same flags, migration behavior, validation, one-time plaintext output, and exit codes.
- **MIRROR**: `google-token-verifier.mjs`, `session-repository.mjs`, `access-code-repository.mjs`, `access-code-cipher.mjs`, `admin-session.mjs`, `admin-http-controller.mjs`, `admin-repository.mjs`, `scripts/access-codes.mjs`.
- **IMPORTS**: `jsonwebtoken`, `reqwest`, `hmac`, `sha2`, `aes-gcm`, `subtle`, `rand`, `base64`, `sqlx`, `clap`.
- **GOTCHA**: Google JWKS refresh-on-unknown-`kid`, clock skew, base64url padding, Node string normalization, GCM tag layout, and user-ID URL decoding are all compatibility risks.
- **VALIDATE**: Rust opens every JavaScript crypto fixture; temporary JavaScript verifier opens every Rust fixture; all auth/admin differential routes and database lock-order tests pass; CLI snapshot/exit-code tests pass.

### Task 6: Port plans, model catalog, rate limiting, agent turns, budget, and usage ledger

- **ACTION**: Reproduce all entitlement and money state machines before provider dispatch exists in Rust.
- **IMPLEMENT**:
  - Port exact Free/Basic/Pro/Max constants, pricing catalog version, model aliases, long-context/cache pricing, integer ceiling math, and emergency-cap lowering.
  - Port PostgreSQL fixed-window rate buckets and identity HMAC.
  - Port idempotent weekly agent-turn reservation and maximum provider calls per turn.
  - Port reservation expiry, advisory locking, duplicate handling, enforce/observe modes, committed-spend snapshots, dispatch, settle, release, uncertain, and immutable usage events.
  - Preserve transaction order and status coupling between reservations and agent turns.
- **MIRROR**: `plan-catalog.mjs`, `model-catalog.mjs`, `rate-limit-repository.mjs`, `agent-turn-*`, `budget-service.mjs`, `usage-repository.mjs`.
- **IMPORTS**: `sqlx`, `hmac`, `sha2`, typed `i64`/checked arithmetic; never `f32`/`f64` for money.
- **GOTCHA**: PostgreSQL `BIGINT` can exceed JavaScript's safe integer even though current validation rejects it; Rust must keep the current public bound and fail rather than silently expose a larger value. Advisory lock keys and date truncation must remain database-owned.
- **VALIDATE**: Property tests compare catalog estimates/costs to the golden corpus; concurrent real-PostgreSQL tests prove caps cannot be crossed; every state transition and duplicate request is idempotent.

### Task 7: Port provider proxies with streaming and ambiguous-outcome parity

- **ACTION**: Implement direct provider HTTP clients after budget state is trustworthy.
- **IMPLEMENT**:
  - Responses JSON proxy: validate allowlisted model/input/tools/tool settings/store/output cap and required Tro headers; reserve -> dispatch -> bounded response -> parse usage -> settle.
  - Responses SSE proxy: validate content type, forward first chunk progressively with backpressure, enforce 5 MB total and 1 MB line bounds, parse terminal usage while streaming, settle exactly once, and mark uncertain on malformed/cancelled streams without breaking already-delivered chunks.
  - Transcription: port strict RIFF/WAVE PCM16 mono 16 kHz parsing, duration tolerance, exact multipart names, response projection, legacy `whisper-1` alias for clients without contract header 2, and no raw audio/transcript logs.
  - Realtime SDP: port exact language/SDP checks, multipart fields, 30-second header timeout, bounded body, and flat estimate lifecycle.
  - ElevenLabs: port optional configuration, 240-character bound, progressive MP3 proxy, 20-second header timeout, provider abort on client disconnect/error, and estimated character settlement.
  - Set a no-retry Reqwest policy. Only the agent-internal pre-event transport in Task 10 may perform its current bounded retry.
- **MIRROR**: `openai-responses-service.mjs`, `openai-transcription-service.mjs`, `server.mjs:570-905`.
- **IMPORTS**: `reqwest::{Client, multipart}`, `futures_util::StreamExt`, `bytes`, `tokio_util::sync::CancellationToken`.
- **GOTCHA**: A Reqwest per-request timeout includes body consumption and would terminate long streams. Use header timeouts and explicit bounded streaming cancellation to match current behavior.
- **VALIDATE**: Wiremock/loopback tests reproduce every provider status family, delayed headers, delayed chunks, malformed usage, oversized bodies/lines, downstream disconnect, and first-byte-before-provider-completion behavior.

### Task 8: Port Knowledge Spaces, S3, PDF/text ingestion, and worker commands

- **ACTION**: Port the feature-flagged knowledge subsystem without changing object or database ownership.
- **IMPLEMENT**:
  - Port strict contracts, limits, public validation errors, roles, lifecycle transitions, evidence policy, support suggestions, and plan limits.
  - Port space/source/activity/run/attempt/work-session/evidence repositories with exact idempotency, owner scoping, locks, event sequences, and projections.
  - Port upload initiation/completion with exact presigned headers/lifetimes, HEAD checksum/media/size verification, and submission separation.
  - Port lexical search SQL and deterministic ordering.
  - Port text normalization/chunking exactly: UTF-8, NUL removal, NFC, per-page trim, 1,200-character chunks, 150-character overlap, locators, and maximum counts.
  - Implement `PdfExtractor` with per-page extraction and exact current error codes. Accept `pdf-extract` only if the corpus meets parity; otherwise choose the best audited pure-Rust alternative behind the same trait and document the difference before continuing.
  - Port ingestion leasing/retry/terminal-state behavior, API/worker shared compatibility, smoke command, and load report.
- **MIRROR**: All `knowledge-*`, `activity-*`, `insight-service.mjs`, `s3-object-store.mjs`, `knowledge-space-http-controller.mjs`, and knowledge scripts/tests.
- **IMPORTS**: `aws-sdk-s3`, `aws-config`, `pdf-extract`, `unicode-normalization`, `sha2`, `sqlx`, `tokio`.
- **GOTCHA**: PDF extraction text spacing/order differs across libraries. Do not approve based only on “text exists”; compare normalized page text, error classification, chunk bodies, locators, page counts, memory ceiling, and timeouts.
- **VALIDATE**: Synthetic S3-compatible integration tests cover PUT/HEAD/GET/checksum; PDF corpus parity meets the agreed exact/normalized thresholds; two workers cannot finalize one job twice; 200/500-row report gates meet current latency/memory expectations.

### Task 9: Port agent contracts, crypto, pure policies, repository, and durable session

- **ACTION**: Move the durable runtime's deterministic and persistence layers before model orchestration.
- **IMPLEMENT**:
  - Port every enum/struct/refinement in `agent-runtime-contracts.mjs`, using exact camelCase serialization and unknown-field rejection.
  - Port tool catalog ordering/canonical hash, capability intersection, model routing, rollout HMAC assignment, circuit breaker, intent compiler/digest, outcome compiler/verifier, action/evidence rules, and visual sidecar bounds.
  - Port AES-GCM agent envelopes and stable JSON AAD byte-for-byte.
  - Port all agent repository queries and transition checks: submission capacity/idempotency, claims, renewals, fencing, events, controls, outcomes/evidence, checkpoints, invocations, worker sessions, cancellation, expiry, recovery, and payload cleanup.
  - Port durable session generation replacement/pop/clear and strip image bytes before storage.
  - Add a Rust checkpoint discriminator/version without changing the existing table layout.
- **MIRROR**: `agent-runtime-contracts.mjs`, `agent-tool-catalog.mjs`, `agent-model-policy.mjs`, `agent-rollout-policy.mjs`, `intent-authorization-compiler.mjs`, `outcome-*`, `agent-state-crypto.mjs`, `agent-run-repository.mjs`, `durable-agent-session.mjs`, `agent-visual-sidecar.mjs`.
- **IMPORTS**: `serde`, `serde_json`, `regex`, `sha2`, `hmac`, `aes-gcm`, `sqlx`, `uuid`, `time`.
- **GOTCHA**: JavaScript object key order affects several digests while recursive stable JSON affects AAD. Use distinct canonicalization functions matching each source, not one generic “canonical JSON” helper.
- **VALIDATE**: Every parity fixture matches byte-for-byte; real-PostgreSQL concurrent lease/fence tests prove stale workers cannot commit; protocol-v2 desktop fixtures parse both directions.

### Task 10: Implement the Tro-owned direct Responses agent runner and worker lifecycle

- **ACTION**: Replace `@openai/agents` Runner/RunState/Session with the explicit state machine defined above.
- **IMPLEMENT**:
  - Reproduce system instructions, strict tool schemas, model tool-name normalization, capability intersection, one interruption maximum, 30-turn default, route metadata, and store/parallel-call settings.
  - Persist Responses input/output items locally in encrypted session generations.
  - Persist Rust checkpoints around pending calls and continuation state; never persist API keys, raw reasoning, tracing keys, screenshots, or cookies.
  - Implement start/resume/cancel/recovery and result mapping consumed by `AgentRunWorker`.
  - Implement budget context around `/v1/responses` and `/v1/responses/compact`, current circuit breaker, at most two pre-event attempts, and no retry once an event/request may have been accepted.
  - Implement input-based compaction at the configured threshold with atomic session rewrite/rollback.
  - Implement best-effort trace export compatible with the pinned SDK's `POST https://api.openai.com/v1/traces/ingest`, `OpenAI-Beta: traces=v1`, sensitive-data disabled, and non-fatal retry behavior; if the endpoint is not an approved public contract at implementation time, preserve structured local/Railway traces and explicitly document/approve that observability delta before release.
  - Port the 250 ms worker poll, overlap guard, 60-second maintenance, timer cancellation, and graceful shutdown.
- **MIRROR**: `backend-agent-runtime.mjs`, `budgeted-responses-transport.mjs`, `agent-run-worker.mjs`, `main.mjs:178-223, 253-298`; pinned tracing exporter in `services/api/node_modules/@openai/agents-openai/dist/openaiTracingExporter.mjs:510-606` while dependencies remain installed.
- **IMPORTS**: `reqwest`, `serde_json`, `tokio`, `futures-util`, agent/usage/session modules.
- **GOTCHA**: This is the critical migration seam. Do not claim Agents SDK parity from happy-path final text. Approvals, interruption serialization, session write order, compaction, cancellation, max turns, tool-result replay protection, and ambiguous provider outcomes are release blockers.
- **VALIDATE**: Golden scripted provider conversations cover final-only, tool interruption/resume, denial, unknown result, cancellation, steering, compaction, provider error before/after dispatch, graph upgrade, and recovery. Run the same scripts through JS and Rust and compare public events, database states, provider requests, and terminal results.

### Task 11: Port all routes and prove desktop/admin wire compatibility

- **ACTION**: Connect the ported modules through the full Rust router.
- **IMPLEMENT**:
  - Implement every route in the frozen inventory with exact method/path matching, auth/access ordering, rate scopes, body bounds, response status, headers, and public errors.
  - Implement task and worker SSE with exact IDs/event names/data, replay precedence (`Last-Event-ID` over `after`), heartbeats, `Connection: keep-alive`, `X-Accel-Buffering: no`, and cancellation.
  - Run unchanged desktop client tests against the Rust test server where possible.
  - Run the embedded admin frontend's existing request flow against Rust.
  - Add a route-coverage assertion so every frozen route has positive, unauthenticated, invalid, and not-found cases as applicable.
- **MIRROR**: `server.mjs`, three HTTP controllers, desktop clients under `src/main`, and `services/api/public/admin.js` request sites.
- **IMPORTS**: `axum`, `tower`, all completed services.
- **GOTCHA**: Route ordering is security behavior. Admin same-origin routes precede the general Origin denial; feature-disabled knowledge paths currently fall through to 404; agent paths require both session and access.
- **VALIDATE**: Differential corpus has zero unapproved differences; `npm run check` passes without desktop client changes; browser smoke confirms admin login/list/create/pause/resume/delete/block/grant/lock flows.

### Task 12: Build the full verification, security, and performance gate

- **ACTION**: Make “nothing is broken” an evidence-backed release criterion.
- **IMPLEMENT**:
  - Port all 131 discovered tests into Rust or a language-neutral black-box suite; no test is silently dropped.
  - Require at least 80% line coverage overall and higher targeted coverage for contracts, crypto, budget, auth, and agent state transitions.
  - Run unit/property/contract tests without external services; real integration tests use disposable PostgreSQL 17 and S3-compatible storage.
  - Add concurrency stress for redemptions, budgets, rate limits, claims, session generations, ingestion leases, and worker reconnects.
  - Add fuzz/property tests for JSON/body bounds, WAV parser, JWT parser/header selection, SSE parser, canonical JSON, PDF failures, and encrypted envelope rejection.
  - Add dependency/license/vulnerability audit and secret scan.
  - Benchmark p50/p95 latency, time-to-first-SSE-byte, RSS under large bounded streams/PDFs, DB pool behavior, graceful shutdown, and worker throughput against Node. Block regressions over agreed thresholds (default: >10% p95 or >20% peak RSS without an approved reason).
- **MIRROR**: Existing Node tests and `docs/testing/*.tdd.md` evidence style.
- **IMPORTS**: `cargo llvm-cov`, `cargo audit`, `proptest`, fuzz tooling if CI supports it, testcontainers or CI services.
- **GOTCHA**: The current PostgreSQL test is skipped by default. A production migration cannot rely on the skip; the real database and S3 suites are mandatory in a protected CI/staging job.
- **VALIDATE**: Full verification matrix passes repeatedly, no flaky streaming/concurrency tests, no high/critical advisories, and benchmark report is approved.

### Task 13: Switch repository commands and retire the JavaScript backend

- **ACTION**: Make Rust the only backend implementation after parity is proven.
- **IMPLEMENT**:
  - Update `services/api/railway.json` to build locked release Rust and start `./target/release/trocode-api serve` (confirm exact Railpack output path during staging).
  - Update the existing worker service/command to `./target/release/trocode-api ingestion-worker` without creating another service.
  - Update root `package.json` so `npm run check` invokes Rust fmt/clippy/test/audit in addition to desktop lint/typecheck/tests; update access-code command to the Rust CLI.
  - Update CI caches/toolchain and retain macOS/Windows Electron package gates.
  - Delete Node backend runtime/tests/scripts/package files only after a commit/tag preserves the final reference implementation and fixtures.
  - Update architecture/security/operations/deployment docs and dependency claims.
- **MIRROR**: Current `services/api/package.json`, `railway.json`, root scripts, CI, and docs.
- **IMPORTS**: N/A.
- **GOTCHA**: Root `npm run test` currently invokes `npm --prefix services/api test`; change it atomically with deleting the backend package. Do not delete public `admin.js` or unrelated Electron/Node tooling.
- **VALIDATE**: `rg` finds no backend `.mjs` import or Node backend start command; locked Rust release binary starts from a clean checkout; root `npm run check` and `npm run package` pass on supported OS CI.

### Task 14: Rehearse and execute the same-service Railway cutover

- **ACTION**: Replace the existing deployment only after data, workload, and rollback gates pass.
- **IMPLEMENT**:
  - Back up PostgreSQL and object storage together and verify restore in an isolated environment.
  - Deploy the Rust artifact to a production-like staging environment using a scrubbed database clone and disposable bucket; do not point it at production providers until contract tests pass.
  - Start with backend-agent and intent rollout flags disabled/0 and Knowledge Spaces disabled unless its worker and S3 parity are ready.
  - Before production deploy, stop accepting new backend-agent work through existing rollout controls and drain legacy nonterminal runs. Pause the ingestion worker after its lease completes.
  - Execute the drain SQL checklist below. If any blocking count is nonzero, postpone deployment.
  - Redeploy the existing Railway API service from the Rust commit; keep the same variables, domain, database reference, and `/healthz` check.
  - Update/redeploy the existing ingestion worker command from the same commit if that worker exists.
  - Smoke health/readiness/auth/session/access/budget/provider stream/admin/knowledge/task worker flows with synthetic accounts/data.
  - Re-enable features gradually with current canary/percentage flags and monitor error rate, p95, DB pool saturation, uncertain reservations, lease recovery, SSE disconnects, and worker failures.
- **MIRROR**: `docs/knowledge-spaces.md:34-40`, current feature flags, Railway deployment behavior.
- **IMPORTS**: Operational commands only; no code dependency.
- **GOTCHA**: Do not run JS and Rust agent workers against the same queue unless mixed-version lease/checkpoint compatibility is explicitly proven. Terminal history can coexist; nonterminal JS checkpoints cannot be resumed by Rust.
- **VALIDATE**: All smoke checks pass on the same public domain; metrics remain within thresholds for the observation window; existing installed desktop build completes text, voice, and one durable tool-interruption task.

### Task 15: Verify rollback and close the migration

- **ACTION**: Prove reversibility before declaring success.
- **IMPLEMENT**:
  - Redeploy the last known-good JavaScript Railway deployment against the post-Rust database in staging.
  - Confirm the old server ignores SQLx bookkeeping, reads existing rows, serves all non-agent contracts, and does not attempt to resume Rust checkpoint payloads.
  - Define rollback trigger thresholds and operator steps: disable flags, stop worker after lease, redeploy previous image, run health/readiness/smoke, reconcile uncertain reservations, preserve Rust-created diagnostic evidence.
  - Keep schema changes backward-compatible through the rollback window. Any future Rust-only schema migration is a separate change after the window closes.
  - Record final verification evidence and remove temporary JavaScript differential runner only after rollback window approval.
- **MIRROR**: Existing Railway rollback and feature-disable guidance.
- **IMPORTS**: N/A.
- **GOTCHA**: A rollback may not safely resume Rust nonterminal agent checkpoints. During the migration window keep backend-agent rollout controlled and require zero active Rust runs before exercising a full rollback, or block affected runs with the existing explicit upgrade/recovery policy.
- **VALIDATE**: Staging rollback and roll-forward each pass; operator runbook can be executed from a clean terminal without codebase discovery.

---

## Testing Strategy

### Test layers

| Layer | Purpose | Required evidence |
|---|---|---|
| Pure unit | Contracts, policies, catalogs, crypto helpers, WAV, canonicalization, lifecycle | Port every current unit case; property tests for bounds/invariants |
| Repository unit | SQL shape/projection with mocks only where useful | Parameter binding/order and invalid-row failures |
| Differential HTTP | JS oracle vs Rust candidate | Status, selected headers, JSON/body bytes, SSE normalized frames, provider requests |
| Crypto/data compatibility | Existing rows remain usable | Bidirectional fixed fixtures for every digest/cipher/cookie/envelope |
| PostgreSQL integration | Real transactions, locks, leases, migrations | PostgreSQL 17, concurrent connections, empty + Node-populated DB |
| S3/PDF integration | Object tickets/checksums/parser behavior | Disposable S3-compatible store and synthetic corpus |
| Desktop compatibility | Installed client behavior | Unchanged TypeScript tests plus packaged-app smoke |
| Load/soak | Streaming, worker, pool, memory | First-byte latency, p95, RSS, disconnects, lease recovery |
| Deployment/rollback | Same-service operational safety | Staging deploy, drain, smoke, rollback, roll-forward |

### Core unit/contract cases

| Test | Input | Expected output | Edge case? |
|---|---|---|---|
| Strict JSON | Unknown field in every request type | Same 400 code/message as Node | Yes |
| Opaque session | Valid/invalid/expired/revoked/blocked token | Same authenticate/rotate behavior | Yes |
| Access capacity | Concurrent final slot redemption | One success, all others conflict | Yes |
| Budget cap | Concurrent reservations at boundary | Never exceeds enforced cap | Yes |
| Provider ambiguity | Connection fails after dispatch may have occurred | `uncertain`, no retry | Critical |
| Responses stream | Terminal usage split across chunks | Progressive bytes and one settlement | Yes |
| Client disconnect | Downstream closes mid-provider stream | Abort upstream, uncertain reservation | Yes |
| WAV | Invalid headers/rates/channels/duration mismatch | Reject before reserve | Yes |
| Admin crypto | Existing JS ciphertext/cookie | Rust decrypts/verifies exactly | Critical |
| Agent crypto | Existing JS envelope and AAD metadata | Rust decrypts; wrong metadata fails | Critical |
| Agent fence | Stale lease owner/version attempts commit | No state change | Critical |
| Tool interruption | Two function calls or unknown tool | Fail closed; no desktop dispatch | Critical |
| Unknown result | Consequential execution disconnects | Block/unknown, never requeue | Critical |
| Compaction | Threshold crossed, replacement fails | Previous generation remains committed | Yes |
| PDF parity | Synthetic multilingual/malformed/encrypted/scanned corpus | Same page/error/chunk behavior | Critical |
| Migration | Node-populated DB first Rust boot | Domain schema/data preserved | Critical |
| SSE replay | Header and query both supplied | `Last-Event-ID` precedence and exact later events | Yes |
| Graceful shutdown | SIGTERM with requests/worker lease | Stop intake/timers, bounded drain, close pool | Yes |

### Edge Cases Checklist

- [ ] Empty input and empty JSON object
- [ ] Duplicate and unknown fields
- [ ] Maximum and one-over-maximum request/response/SSE line/body sizes
- [ ] Unicode normalization, surrogate-equivalent content, base64/base64url padding
- [ ] Invalid UUID versions/shape and percent-encoded user IDs
- [ ] Expired/revoked/rotated sessions and admin cookies
- [ ] Google unknown `kid`, stale JWKS cache, clock skew, wrong issuer/audience/email verification
- [ ] Concurrent access-code, rate-limit, budget, queue, lease, and session-generation changes
- [ ] Database timeout, serialization error, connection exhaustion, rollback failure
- [ ] Provider failure before dispatch, ambiguous dispatch, non-2xx, malformed success, oversized response, stalled headers/body
- [ ] Downstream cancellation during each streaming endpoint
- [ ] S3 permission denied, checksum/size/media mismatch, missing body, endpoint/path-style variants
- [ ] Empty/scanned/encrypted/malformed/large PDF and invalid UTF-8 text input
- [ ] Worker crash before/after lease, stale lease, duplicate worker, disconnect while executing
- [ ] Agent graph digest mismatch, old checkpoint version, multiple tool calls, invalid effect, expired payload
- [ ] Signal during migration/startup, active request, active provider stream, worker poll, and maintenance
- [ ] Disabled admin/knowledge/backend-agent/intent features

---

## Validation Commands

Commands shown for the completed migration. During implementation, keep the current Node oracle commands until Task 13.

### Baseline/reference while JavaScript still exists

```bash
npm --prefix services/api ci
npm --prefix services/api test
npm --prefix services/api audit --audit-level=high
```

EXPECT: 130 pass, 0 fail, and only the documented `TEST_DATABASE_URL` skip when the variable is absent; zero high/critical vulnerabilities.

### Rust formatting and static analysis

```bash
cargo fmt --manifest-path services/api/Cargo.toml --all -- --check
cargo clippy --manifest-path services/api/Cargo.toml --all-targets --all-features -- -D warnings
```

EXPECT: Zero formatting or clippy findings.

### Rust unit and contract tests

```bash
cargo test --manifest-path services/api/Cargo.toml --all-features --locked
```

EXPECT: Every ported test and language-neutral compatibility fixture passes; no ignored core tests.

### Coverage

```bash
cargo llvm-cov --manifest-path services/api/Cargo.toml --all-features --workspace --fail-under-lines 80
```

EXPECT: At least 80% line coverage and no untested security-critical transition identified in the review checklist.

### Real PostgreSQL/S3 integration

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" \
TROCODE_TEST_S3_ENDPOINT="$TROCODE_TEST_S3_ENDPOINT" \
cargo test --manifest-path services/api/Cargo.toml --locked --test postgres_compat --test ingestion -- --ignored
```

EXPECT: Migrations, all locking/lease/concurrency tests, S3 checksums, PDF corpus, and load fixtures pass against disposable services. Never point this command at production.

### Security and dependency audit

```bash
cargo audit --file Cargo.lock
npm audit --omit=dev
```

EXPECT: No high/critical Rust backend advisory and no production desktop advisory. Review exceptions explicitly; do not blanket-ignore.

### Release build

```bash
cargo build --manifest-path services/api/Cargo.toml --release --locked
./target/release/trocode-api --help
```

EXPECT: Reproducible release binary exposes documented subcommands and contains embedded admin/migration assets.

### Full repository verification

```bash
npm run check
npm run package
```

EXPECT: Zero regressions; this is required by `AGENTS.md` and must include the Rust backend gates after Task 13.

### Manual API validation

- [ ] Start Rust API with development secrets and a disposable PostgreSQL database.
- [ ] Verify `/healthz` and `/readyz` headers/status/body.
- [ ] Exchange a synthetic/approved Google token path in staging; rotate and revoke the opaque session.
- [ ] Choose Free and redeem/pause/resume an access code through admin flows.
- [ ] Create an agent turn and stream a Responses fixture; verify first chunk arrives before completion and ledger settles once.
- [ ] Transcribe a bounded English and Vietnamese WAV; verify legacy and contract-v2 model fields.
- [ ] Stream ElevenLabs fixture bytes and cancel midstream.
- [ ] Run Knowledge upload -> S3 HEAD -> ingestion -> search -> Activity/run/attempt/submission/evidence/dashboard.
- [ ] Run durable task -> SSE -> desktop worker connect -> tool request -> executing grant -> result -> completion.
- [ ] Disconnect during an executing consequential action and confirm it becomes unknown/blocked without replay.
- [ ] SIGTERM during idle, request, SSE, and worker activity; confirm bounded graceful shutdown.

### Production drain queries before cutover

Run read-only equivalents through the approved operator path and require zero counts:

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

EXPECT: All zero before the API/agent cutover. For the ingestion worker, wait for the current lease to finish or expire cleanly; do not mutate rows by hand.

---

## Deployment and Rollback Runbook

### Pre-deploy gates

- [ ] Production database and object storage backups completed and restore-tested together.
- [ ] Differential corpus: zero unapproved differences.
- [ ] Bidirectional crypto compatibility: all fixtures pass.
- [ ] Empty and Node-populated PostgreSQL migrations: pass twice.
- [ ] Real S3/PDF and concurrent worker tests: pass.
- [ ] Desktop `npm run check` and platform package builds: pass.
- [ ] Rust staging soak and same-service rollback rehearsal: pass.
- [ ] Backend agent rollout/intent flags disabled or set to 0 for cutover.
- [ ] Legacy agent/worker drain queries: zero.
- [ ] Existing Railway variables inventoried by name only; no secret values copied into artifacts/logs.

### Cutover

1. Pause the existing ingestion worker after its lease completes.
2. Deploy the Rust commit to the existing API service using the same root/domain/database/variables.
3. Wait for Railway `/healthz`; independently verify `/readyz`.
4. Run non-mutating smoke checks, then synthetic authenticated flows.
5. Update/redeploy the existing ingestion worker command from the same Rust artifact if present.
6. Enable Knowledge Spaces only after worker/S3 smoke passes.
7. Enable backend agent for explicit canaries, then current percentage rollout; do not change rollout percentages as part of the code deploy without operator approval.
8. Observe at least the agreed window for request 5xx/429, latency, stream disconnects, uncertain reservations, DB pool saturation, agent recovery/unknown outcomes, ingestion retries, and memory.

### Rollback triggers

- Health/readiness instability or startup migration failure.
- Any authentication/session/crypto incompatibility.
- Double charge, missing settlement, or increased uncertain reservation rate.
- SSE buffering/truncation/replay failure affecting installed clients.
- Stale lease commits, duplicate consequential dispatch, or weakened approval/effect checks.
- Knowledge checksum/object-key/parser corruption.
- Sustained error/latency/RSS regression above approved threshold.

### Rollback steps

1. Set backend-agent/intent rollout to 0 and disable Knowledge Spaces if it is implicated.
2. Stop the existing ingestion worker after its current lease.
3. Ensure no Rust nonterminal runs require a Rust checkpoint resume.
4. Redeploy the last known-good JavaScript Railway deployment to the same service.
5. Verify `/healthz`, `/readyz`, auth/session/access/budget/admin/provider smoke paths.
6. Reconcile `reserved`/`uncertain` entries through existing safe operator logic; never retry provider calls based only on missing local completion.
7. Preserve logs and backups; do not roll back or delete data manually.

Because the initial Rust migration retains the 17 domain migrations unchanged and adds no Rust-only required domain schema, the JavaScript rollback should ignore SQLx's bookkeeping table. This must be proven in staging before production.

---

## Acceptance Criteria

- [ ] The production backend runtime and backend-dependent operator commands are Rust; no executable backend `.mjs` remains.
- [ ] The Electron/React client and embedded admin UI require no behavioral change.
- [ ] The existing Railway API service, domain, environment variables, health path, PostgreSQL, S3 bucket, and existing worker topology are preserved.
- [ ] All frozen REST, binary, and SSE contracts pass differential testing with zero unapproved differences.
- [ ] All 130 current passing tests are represented; the formerly optional real-PostgreSQL and S3 gates pass in protected CI/staging.
- [ ] All existing database rows and cryptographic formats remain readable; bidirectional compatibility fixtures pass.
- [ ] All money remains checked integer micro-USD; budget reservations are atomic and idempotent.
- [ ] Provider streaming remains progressive and bounded; client cancellation is propagated.
- [ ] No consequential or ambiguously dispatched operation is retried.
- [ ] Protocol-v2 desktop worker, effect, intent, approval, evidence, lease, and outcome invariants remain fail closed.
- [ ] Legacy nonterminal Agents SDK checkpoints are drained before cutover; none is guessed or silently discarded.
- [ ] Knowledge S3 keys/checksums, PDF/text limits, chunk locators, leases, and lifecycle are compatible.
- [ ] Rust fmt, clippy, tests, coverage, audit, locked release build, `npm run check`, and `npm run package` pass.
- [ ] Same-service staging deployment, rollback, and roll-forward are demonstrated.
- [ ] Production smoke/monitoring window passes before rollout flags are restored.

## Completion Checklist

- [ ] Code follows the module/ownership boundaries in this plan.
- [ ] Error handling exposes only current public codes/messages and logs private causes safely.
- [ ] Structured logging matches current event names/allowlisted fields.
- [ ] Every input/model/IPC-equivalent boundary has strict validation and body limits.
- [ ] Tests cover happy, invalid, concurrent, cancellation, unknown, and recovery paths.
- [ ] No secret, raw task text, transcript, screenshot, URL query, file path, or tool payload enters logs/traces/fixtures.
- [ ] No hardcoded production credential, URL override, or secret value is added.
- [ ] No unnecessary service/schema/feature dependency is added.
- [ ] Documentation and operator commands are updated.
- [ ] JavaScript reference is retired only after parity and rollback evidence exists.
- [ ] A developer can implement each task from this plan and mandatory files without making a new architecture choice.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| No official Rust Agents SDK; direct loop differs from Runner/RunState | High | Critical | Explicit state machine, scripted differential conversations, versioned Rust checkpoints, legacy drain gate |
| Existing nonterminal JS checkpoints cannot be resumed | High if active | Critical | Rollout-off maintenance drain and zero-count production query; postpone rather than guess |
| Crypto/canonical JSON mismatch makes stored data unreadable | Medium | Critical | Bidirectional fixed byte fixtures for every format before DB code cutover |
| SQLx first boot replays existing migrations differently | Medium | Critical | Populated-clone rehearsal, schema/data diff, second-start no-op, staging rollback |
| PDF text differs from pdfjs-dist | High | High | Synthetic corpus spike before module commitment; extractor trait; block on page/chunk/error parity |
| SSE framework buffering/cancellation differs | Medium | High | Raw-frame and first-byte timing tests; explicit backpressure, no-buffer header, disconnect tokens |
| Provider retry middleware duplicates paid/consequential work | Medium | Critical | No automatic retry client; state-specific tests for before/after-dispatch ambiguity |
| Mixed JS/Rust workers contend on incompatible checkpoints | Medium | Critical | Never overlap agent workers during cutover without proof; drain and coordinated start commands |
| Admin/session behavior changes due to cookies/header defaults | Medium | High | Exact golden header/cookie/asset tests and real browser smoke |
| S3 presigned request headers differ across SDKs | Medium | High | Exact signed-header/lifetime integration tests against the configured S3-compatible service |
| Rust build auto-detection selects wrong command | Medium | High | One binary with explicit subcommands and explicit Railway start command |
| Test port accidentally drops behavior | Medium | High | Route/test inventory mapping; every current test linked to a Rust test; differential corpus stays until rollback window closes |
| Large scope creates a long-lived divergent branch | High | Medium | Land behind inactive Rust start command in vertical slices; keep Node oracle green; small reviewable commits |

## Notes

- “Nothing is broken” is treated as a release standard backed by differential, integration, desktop, staging, and rollback evidence—not as a claim that a language rewrite is risk-free.
- The safest implementation sequence is foundations -> data/security -> providers -> knowledge -> agent runtime -> routes -> differential proof -> cleanup -> deploy. Do not begin by deleting the Node code.
- The direct Responses runner is the only planned intentional implementation change. Its public behavior must remain compatible, but its checkpoint payload is explicitly versioned as Rust-owned.
- Any proposed domain schema change, new feature, model change, pricing change, API version, topology change, or client change discovered during implementation must be split into a separate plan.

---

## Plan Verification Checklist

### Context Completeness

- [x] Backend scope and non-scope are explicit.
- [x] Entry points, routes, clients, database, object storage, providers, workers, scripts, and deployment are inventoried.
- [x] Naming, error, logging, validation, repository, transaction, crypto, retry, and test patterns include real source snippets.
- [x] External Rust/Railway/OpenAI/PostgreSQL/S3/PDF constraints are documented.

### Implementation Readiness

- [x] Every task has ACTION, IMPLEMENT, MIRROR, IMPORTS, GOTCHA, and VALIDATE.
- [x] Proposed module ownership and dependency responsibilities are specified.
- [x] Legacy checkpoint incompatibility has a concrete drain gate.
- [x] Same-service deployment and rollback steps are explicit.

### Validation Coverage

- [x] Static analysis, unit, property, differential, integration, coverage, audit, release build, desktop package, manual, staging, and production gates are specified.
- [x] Concurrency, streaming, cancellation, crypto, database, PDF, and ambiguous outcome risks have dedicated tests.
- [x] Current baseline test result is recorded.

### No-Prior-Knowledge Test

A developer should be able to implement the migration by following the task order, proposed module tree, frozen contracts, mandatory reading, exact invariants, and validation/runbook sections without choosing a different architecture or searching for an undocumented deployment boundary.
