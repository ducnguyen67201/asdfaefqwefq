# Plan: Introduce Bazel for the Rust Backend Foundation

## Summary

Introduce Bazel beside TroCode's existing npm, Electron Forge, and Webpack pipeline, and make Bazel responsible only for a first Rust backend slice. The implementation will pin the Bazel and Rust toolchains, use Bzlmod plus `rules_rust`/Crate Universe with `Cargo.toml` and `Cargo.lock` as the Rust dependency source of truth, add a small Rust service exposing the existing public `GET /healthz` contract, and enforce its build, tests, formatting, and Clippy checks in a dedicated Linux CI job.

This is a reversible build-foundation change, not the full Node-to-Rust migration. The Electron renderer, preload, main process, native CUA packaging, hosted Node API, Railway deployment, and all production `/v1` traffic remain unchanged.

## User Story

As a TroCode maintainer, I want a pinned and CI-verified Bazel foundation around the first Rust backend service, so that future backend migration can proceed endpoint-by-endpoint without disrupting the Electron desktop application or discovering Bazel incompatibilities at the end.

## Problem → Solution

TroCode currently has an npm/Electron build and a separate Node 24 hosted API, but no Rust workspace, Bazel module, Bazel targets, or Rust CI gate → Add a parallel Bazel/Rust lane with one real HTTP health target, lock both dependency systems, preserve current desktop and production routing, and establish the conventions future Rust endpoints must follow.

## Metadata

- **Complexity**: Large
- **Source PRD**: N/A
- **PRD Phase**: N/A — standalone build-foundation plan
- **Repository Baseline**: `c48ef86f3006c80160cef1f7dce92e6979a2702e`
- **Research Date**: 2026-08-24
- **Estimated Files**: 20 planned changes: 14 created/generated, 6 updated; 1 pre-existing modified file preserved
- **Estimated Tasks**: 8
- **Delivery Shape**: One mergeable foundation change; future API migration remains separate
- **Existing Worktree State**: `package-lock.json` is already modified and must be preserved without alteration
- **Navigation Note**: `docs/CODEX-NAVIGATION-GUIDE.md` is referenced by workspace instructions but absent at this baseline. This plan uses checked-in `AGENTS.md`, architecture, packaging, API, CI, and test files instead.

---

## Architecture Decision

### Chosen approach

Use two build lanes with explicit ownership:

~~~text
Electron desktop and existing Node API
  package.json + package-lock.json
  Electron Forge + Webpack + npm tests
  Owner: existing npm pipeline

New Rust backend foundation
  Cargo.toml + Cargo.lock
  MODULE.bazel + MODULE.bazel.lock
  rules_rust + Crate Universe
  Owner: Bazel build/test/lint targets
~~~

Cargo remains the human-friendly Rust manifest and lockfile format. Bazel consumes that workspace through Crate Universe so dependency names and versions are not manually maintained twice. Bazel becomes authoritative for the new Rust CI lane, while Cargo remains usable for editor tooling and ordinary Rust development.

### Target topology

~~~text
Sandboxed React renderer
        │ narrow DesktopApi
Validated preload
        │ authenticated IPC
Electron main ───────────────► Existing Node API /v1 over HTTPS + SSE
  │                                  production path remains unchanged
  └─ native CUA, OS permissions,
     signing, Forge packaging

New Rust service
  └─ GET /healthz only
     ├─ built/tested/formatted/linted by Bazel
     ├─ runs on PORT or local default 8081
     └─ receives no production traffic in this change
~~~

### Build ownership table

| Surface | Owner after this change | Why |
|---|---|---|
| React renderer | Webpack/Electron Forge | Existing mature pipeline; no Rust dependency |
| Electron preload/main | TypeScript/Webpack/Electron Forge | Owns trusted IPC, OS permissions, CUA, and signed app identity |
| Desktop installers | Electron Forge makers on matching host OS | Native CUA and signing require target-specific builds |
| Existing `services/api` | Node/npm/Railpack | Production behavior remains stable during foundation work |
| New `services/api-rs` | Bazel + `rules_rust` | First Rust backend slice and future migration destination |
| Rust dependency declarations | Cargo manifests and `Cargo.lock` | Preserves Cargo/rust-analyzer ergonomics |
| Rust build graph and CI | Bazel `BUILD.bazel` targets | Reproducible toolchain, dependency graph, tests, lint, and cache |

### Alternatives considered

| Alternative | Decision | Reason |
|---|---|---|
| Migrate the whole backend to Rust, then add Bazel | Rejected | Defers build-graph/toolchain problems until the migration is expensive to reshape |
| Add Bazel before any Rust target exists | Rejected | Creates configuration with no meaningful target or contract to validate |
| Bazelize Electron, React, Webpack, and npm now | Rejected | Adds package-manager and native-packaging churn without helping the first Rust migration slice |
| Wrap existing npm commands in Bazel `genrule` targets | Rejected | Adds indirection but not a hermetic or incrementally useful build graph |
| Use Cargo only until the entire backend is migrated | Rejected | Allows Cargo and eventual Bazel assumptions to diverge for too long |
| Replace Electron main with Rust now | Rejected | CUA permissions, raw IPC authority, signing identity, and Forge lifecycle must remain stable |
| Build Rust on the Windows CI matrix immediately | Deferred | `rules_rust` officially prioritizes Linux/macOS and warns that Windows support is not fully maintained; the hosted backend target is Linux |

---

## UX Design

### Before

N/A — internal build and backend-foundation change. Users run the existing Electron application against the existing hosted Node API.

### After

N/A — no user-facing behavior changes. Maintainers gain Bazel commands and a non-production Rust health service.

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Desktop startup | `npm run start` | Unchanged | Rust service is not launched by Electron |
| Desktop packaging | `npm run package` / Forge | Unchanged | No Rust binary is bundled in this phase |
| Production API routing | Node `services/api` | Unchanged | `TROCODE_API_BASE_URL` continues to point to Node |
| Rust development | No Rust workspace | Cargo workspace plus Bazel targets | Bazel owns CI verification |
| CI | macOS/Windows npm verification | Existing job plus independent Ubuntu Bazel/Rust job | Desktop release jobs remain untouched |
| Health probe | Node `GET /healthz` | Node remains production; Rust implements a contract-compatible probe for migration validation | Rust default port is 8081 to avoid local conflict |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `AGENTS.md` | 3-22 | Architecture invariants and required repository gates |
| P0 | `package.json` | 6-31 | Existing npm script ownership and the `check` pipeline that must remain stable |
| P0 | `forge.config.ts` | 65-185, 188-289 | Host-specific native compilation, CUA staging, signing, makers, and Webpack ownership |
| P0 | `docs/architecture.md` | 5-36, 57-78, 112-173, 217-230 | Desktop/backend trust boundary and why CUA stays in Electron main |
| P0 | `services/api/src/main.mjs` | 48-75, 225-298 | Existing API composition root, health dependency, structured startup/error logs, shutdown |
| P0 | `services/api/src/server.mjs` | 297-348, 908-962 | Existing `/healthz`/`/readyz` contract, security headers, sanitized errors, structured request logging |
| P0 | `services/api/test/server.test.mjs` | 130-261, 332-342 | In-process HTTP test harness and exact health/readiness assertions |
| P1 | `services/api/package.json` | 1-25 | Node 24 ESM service ownership and dependency separation |
| P1 | `services/api/src/config.mjs` | 1-45, 230-260 | Fail-fast environment parsing and current `PORT` default |
| P1 | `services/api/src/http-primitives.mjs` | 1-44 | Typed HTTP errors, bounded JSON parsing, authentication primitive |
| P1 | `services/api/src/agent-turn-service.mjs` | 1-45 | Thin service layer with injected repository and typed domain outcomes |
| P1 | `services/api/src/agent-turn-repository.mjs` | 27-98 | Transaction, rollback, normalization, and idempotency repository pattern |
| P1 | `services/api/test/agent-turn-service.test.mjs` | 1-88 | In-memory dependency tests and idempotency assertions |
| P1 | `src/shared/contracts.ts` | 1414-1540, 1666-1700, 1980-2153 | Desktop-side hosted and budget contracts; future Rust endpoints must remain compatible |
| P1 | `src/shared/desktop-api.ts` | 73-222 | Narrow renderer API that must not be expanded for this build change |
| P1 | `src/preload.ts` | 1-130, 690-711 | Schema parsing and narrow context-bridge exposure |
| P1 | `src/main/application/hosted-task-client.ts` | 1-34, 130-230 | Existing `/v1` and SSE client boundary |
| P1 | `src/main/knowledge/knowledge-space-client.ts` | 63-118 | Authenticated fetch, timeouts, and response schema parsing |
| P1 | `.github/workflows/ci.yml` | 1-30 | Existing macOS/Windows desktop verification job |
| P2 | `services/api/railway.json` | 1-11 | Production Railpack ownership and `/healthz` healthcheck |
| P2 | `README.md` | 439-455, 533-574 | Documented quality gates, native packaging constraints, and repository map |
| P2 | `.gitignore` | 1-101 | Existing generated-output exclusions to extend for Bazel/Cargo |

---

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Bazel release model | https://bazel.build/release | Pin active Bazel 9 LTS at `9.2.0` |
| Bazelisk | https://docs.bazel.build/versions/main/install-bazelisk.html | `.bazelversion` makes Bazelisk select the repository's Bazel version |
| Bzlmod | https://bazel.build/external/overview | Bazel 9 uses `MODULE.bazel`; do not introduce legacy `WORKSPACE` configuration |
| Bazel lockfile | https://bazel.build/versions/9.2.0/external/lockfile | Generate and commit `MODULE.bazel.lock`; use lockfile error mode in CI |
| Repository ignores | https://bazel.build/versions/9.2.0/rules/lib/globals/repo | `REPO.bazel` `ignore_directories` supports glob-style ignores |
| `rules_rust` registry | https://registry.bazel.build/modules/rules_rust/ | Pin `rules_rust` `0.73.0` |
| Rust toolchain extension | https://bazelbuild.github.io/rules_rust/ | Pin edition 2024 and Rust `1.97.1` in the Bazel toolchain |
| Crate Universe with Bzlmod | https://bazelbuild.github.io/rules_rust/crate_universe_bzlmod.html | Import the Cargo workspace and use `aliases`, `all_crate_deps`, and `crate_edition` |
| Rust test rules | https://bazelbuild.github.io/rules_rust/rust.html | Use `rust_library`, `rust_binary`, and `rust_test(crate = ...)` |
| Rustfmt integration | https://bazelbuild.github.io/rules_rust/rust_fmt.html | Use a `rustfmt_test` so formatting failure is a Bazel test failure |
| Clippy integration | https://bazelbuild.github.io/rules_rust/rust_clippy.html | Use `rust_clippy` against first-party Rust targets |
| GitHub Actions setup | https://github.com/bazel-contrib/setup-bazel | `setup-bazel@0.19.0` installs Bazelisk and manages repository/disk caches |
| Rust toolchain file | https://rust-lang.github.io/rustup/overrides.html | Commit `rust-toolchain.toml` with matching Rust, rustfmt, and Clippy components |

### External research findings

**KEY_INSIGHT:** Bazel 9's modern dependency mechanism is Bzlmod with `MODULE.bazel`.
**APPLIES_TO:** Root Bazel bootstrap.
**GOTCHA:** Do not add `WORKSPACE` or cargo repository macros based on legacy examples.

**KEY_INSIGHT:** `rules_rust` 0.73.0 supports Cargo workspace ingestion through `crate.from_cargo` and currently defaults to Rust 1.97.1.
**APPLIES_TO:** Toolchain and dependency pinning.
**GOTCHA:** Rust 1.98.0 is newer than the toolchain explicitly covered by the selected rules release; pin 1.97.1 until a verified `rules_rust` upgrade adds 1.98 support.

**KEY_INSIGHT:** `Cargo.toml`/`Cargo.lock` can remain dependency truth while generated Crate Universe macros populate Bazel deps.
**APPLIES_TO:** `MODULE.bazel` and `services/api-rs/BUILD.bazel`.
**GOTCHA:** After changing Cargo manifests, regenerate `Cargo.lock`, repin/sync Crate Universe, run Bazel, and commit any `MODULE.bazel.lock` update in the same change.

**KEY_INSIGHT:** `rustfmt_test` and `rust_clippy` can make formatting and lint part of the Bazel graph.
**APPLIES_TO:** Local Rust `BUILD.bazel` and CI.
**GOTCHA:** `bazel test` does not execute a non-test `rust_clippy` target; CI must also `bazel build //services/api-rs:clippy`.

**KEY_INSIGHT:** `rules_rust` aims to support Linux and macOS but explicitly does not claim complete Windows maintenance.
**APPLIES_TO:** CI topology.
**GOTCHA:** Do not add the Rust job to the existing Windows desktop matrix in this phase; use Ubuntu because the hosted service deploys to Linux.

**KEY_INSIGHT:** Bazel's module lockfile can be set to error mode.
**APPLIES_TO:** CI reproducibility.
**GOTCHA:** Generate/update the lockfile locally before CI; CI must fail instead of modifying tracked dependency state.

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Evidence |
|---|---|---|---|
| Similar implementation | `services/api/src/server.mjs:297-348` | Public health and readiness routes live in a dependency-injected HTTP handler | `GET /healthz` returns status/version; `GET /readyz` calls injected DB health |
| Naming | `services/api/src/agent-turn-service.mjs:3-45` | Kebab-case service filenames, PascalCase service/error classes, verb methods | `AgentTurnService.create` and `AgentTurnError` |
| Error handling | `services/api/src/server.mjs:908-948` | Typed HTTP errors are exposed; unknown errors become sanitized 500 responses | Raw internal errors are not returned |
| Logging | `services/api/src/main.mjs:253-280` | Small JSON events with stable event names and bounded metadata | `server.ready`, `agent.worker.failed`, `agent.maintenance.failed` |
| Type definitions | `src/shared/contracts.ts:1414-1540` | Schema-first boundary contracts with strict validation and inferred TS types | Hosted task/invocation/result schemas |
| Test pattern | `services/api/test/server.test.mjs:130-261,332-342` | Start an in-process server on an ephemeral loopback port and assert status/body/headers | Health tests require no database or network |
| Configuration | `services/api/src/config.mjs:3-45,230-260` | Pure helper functions parse an injected environment and fail fast | `positiveInteger` plus `PORT` default |
| Dependencies | `services/api/package.json:1-25` | Services own a separate manifest and lockfile | Hosted API dependencies do not leak into Electron packaging |
| Entry point | `services/api/src/main.mjs:48-75,225-253` | Composition root loads config, builds repositories/services, creates handler, then listens | Constructors receive dependencies; modules do not self-start |
| Data flow | `src/index.ts:208-228` → `src/main/application/hosted-task-client.ts:130-230` | Electron main reads one API base URL and calls hosted endpoints over authenticated HTTP/SSE | Rust can replace endpoints later without renderer changes |
| State changes | `services/api/src/agent-turn-repository.mjs:32-98` | PostgreSQL mutations use explicit transaction/commit/rollback/finally-release | Future Rust repositories must preserve atomic and idempotent semantics |
| Contracts | `src/shared/contracts.ts:1414-1540,1666-1700` | Installed desktop clients validate hosted records and budget responses | Backend migration must preserve wire shapes and versioning |
| Architecture | `docs/architecture.md:112-173,217-230` | Electron main owns local authority and native execution; API owns hosted orchestration/data | Bazel introduction must not move CUA or IPC authority |

---

## Patterns to Mirror

All snippets below are copied from the current codebase. Proposed Rust and Bazel code is specified later under tasks.

### NAMING_AND_SERVICE_PATTERN

SOURCE: `services/api/src/agent-turn-service.mjs:3-18`

~~~js
export class AgentTurnError extends Error {
  constructor(code, message, status = 402) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class AgentTurnService {
  constructor(repository, options) {
    this.repository = repository;
    this.mode = options.mode;
  }

  async create(input) {
~~~

Use a thin application/service layer with injected dependencies. In Rust, keep `main.rs` as composition/startup only and put router/config behavior in `lib.rs` so it is directly testable.

### CONFIG_VALIDATION

SOURCE: `services/api/src/config.mjs:3-30`

~~~js
function required(name, environment) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
~~~

Rust configuration must accept an injected environment lookup in unit-testable helpers, reject invalid ports, and default locally without hiding invalid supplied values.

### ERROR_HANDLING

SOURCE: `services/api/src/server.mjs:908-948`

~~~js
} catch (error) {
  const isTypedHttpError =
    error instanceof HttpError ||
    (error &&
      typeof error === 'object' &&
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status <= 599);
  const status = isTypedHttpError ? error.status : 500;
  const message =
    isTypedHttpError ? error.message : 'An internal error occurred.';
  if (!response.headersSent) {
    sendJson(response, status, {
      ...(typeof error?.code === 'string' ? { code: error.code } : {}),
      error: message,
    });
  }
  else response.destroy();
}
~~~

Do not expose raw startup, dependency, or provider errors to clients. This first Rust slice has no fallible public operation beyond startup, so invalid configuration exits with a bounded message and `/healthz` returns a stable response only after the server is listening.

### LOGGING_PATTERN

SOURCE: `services/api/src/main.mjs:253-267`

~~~js
server.listen(config.port, '0.0.0.0', () => {
  console.info(
    JSON.stringify({ event: 'server.ready', port: config.port }),
  );
  if (agentRunWorker) {
    let running = false;
    agentWorkerTimer = setInterval(() => {
      if (running) return;
      running = true;
      agentRunWorker.runOnce().catch((error) => {
        console.error(JSON.stringify({
          event: 'agent.worker.failed',
          code: typeof error?.code === 'string' ? error.code : 'agent_worker_error',
          name: error instanceof Error ? error.name : 'UnknownError',
        }));
~~~

Configure `tracing_subscriber` for JSON and emit stable `event` fields such as `server.ready` and `server.stopping`. Do not log request bodies, credentials, environment values, or raw errors.

### REPOSITORY_PATTERN

SOURCE: `services/api/src/agent-turn-repository.mjs:32-51,92-97`

~~~js
async create(input) {
  const client = await this.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [input.userId],
    );
    const existing = await client.query(
      `SELECT id, client_turn_id, task_id, plan, status, would_deny, created_at
       FROM agent_turns
       WHERE user_id = $1 AND client_turn_id = $2`,
      [input.userId, input.clientTurnId],
    );
    if (existing.rows[0]) {
      const turn = normalizeTurn(existing.rows[0]);
      await client.query('COMMIT');
      return turn.taskId === input.taskId
        ? { kind: 'duplicate', turn }
        : { kind: 'conflict', turn };
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
~~~

No repository is added in this foundation slice. Future Rust persistence work must use the same transaction/idempotency behavior and arrive in a separate plan with Node-vs-Rust conformance tests.

### CONTRACT_BOUNDARY

SOURCE: `src/main/budget/usage-budget-service.ts:51-69`

~~~ts
async get(taskId?: string): Promise<UsageBudgetSnapshot> {
  const baseUrl = this.apiBaseUrl.trim().replace(/\/+$/u, '');
  if (!baseUrl) return localSnapshot();
  const credential = await this.accessTokenProvider();
  if (!credential) throw new Error('Sign in to view the hosted usage budget.');
  const url = new URL(`${baseUrl}/v1/usage/budget`);
  if (taskId) url.searchParams.set('taskId', taskId);
  const response = await this.fetchImpl(url, {
    headers: { Authorization: `Bearer ${credential}` },
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Usage budget returned HTTP ${response.status}.`);
  }
  return UsageBudgetSnapshotSchema.parse({
    ...(await response.json()),
    source: 'hosted',
  });
}
~~~

Keep the desktop-to-hosted-service seam HTTP-based and response-validated. Do not expose Rust through renderer IPC in this phase.

### TEST_STRUCTURE

SOURCE: `services/api/test/server.test.mjs:250-260,332-342`

~~~js
const server = createServer(handler);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
try {
  await run({ accessCodes, baseUrl, sessions });
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('health and readiness endpoints are public and hardened', async () => {
  await withApi(async ({ baseUrl }) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  });
});
~~~

Rust route tests should execute the Axum router in memory with `tower::ServiceExt::oneshot`. Keep network binding in `main.rs` and test it once manually on a loopback-only validation port.

---

## Exact Foundation Specification

### Version pins

| Component | Pin | Rationale |
|---|---:|---|
| Bazel | `9.2.0` | Active Bazel 9 LTS |
| `rules_rust` | `0.73.0` | Current BCR release at research date |
| Rust | `1.97.1` | Exact stable toolchain explicitly included by selected `rules_rust` |
| Rust edition | `2024` | Current edition; supported by pinned toolchain |
| `bazel-contrib/setup-bazel` | `0.19.0` | Current action documented by upstream |

### Initial Cargo dependencies

Use these direct dependencies in `services/api-rs/Cargo.toml` and let `Cargo.lock` pin the full graph:

~~~toml
[dependencies]
axum = "0.8.9"
serde = { version = "1.0.229", features = ["derive"] }
tokio = { version = "1.53.1", features = ["macros", "net", "rt-multi-thread", "signal"] }
tracing = "0.1.44"
tracing-subscriber = { version = "0.3.23", features = ["env-filter", "fmt", "json"] }

[dev-dependencies]
http-body-util = "0.1.5"
serde_json = "1.0.151"
tower = { version = "0.5.3", features = ["util"] }
~~~

Do not add PostgreSQL, OpenAI, S3, authentication, SSE, or migration crates yet.

### Initial HTTP behavior

| Input | Expected behavior |
|---|---|
| `GET /healthz` | `200` JSON `{"status":"ok","version":"<RAILWAY_GIT_COMMIT_SHA or local>"}` |
| Health response headers | `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` |
| Missing `PORT` | Bind `0.0.0.0:8081` to avoid colliding with the Node API's local `8080` |
| Valid `PORT` | Bind supplied positive `u16` port |
| Invalid/zero/out-of-range `PORT` | Fail startup with a bounded error; do not silently default |
| Missing commit SHA | Use `local` |
| Shutdown signal | Stop gracefully through Axum/Tokio graceful shutdown |

### Root `MODULE.bazel` shape

~~~starlark
module(
    name = "trocode",
    version = "0.1.0",
)

bazel_dep(name = "rules_rust", version = "0.73.0")

rust = use_extension("@rules_rust//rust:extensions.bzl", "rust")
rust.toolchain(
    edition = "2024",
    versions = ["1.97.1"],
)
use_repo(rust, "rust_toolchains")
register_toolchains("@rust_toolchains//:all")

crate = use_extension(
    "@rules_rust//crate_universe:extensions.bzl",
    "crate",
)
crate.from_cargo(
    name = "crates",
    cargo_lockfile = "//:Cargo.lock",
    manifests = ["//:Cargo.toml"],
)
use_repo(crate, "crates")
~~~

### Root `BUILD.bazel` shape

~~~starlark
package(default_visibility = ["//visibility:private"])

exports_files([
    "Cargo.lock",
    "Cargo.toml",
])
~~~

This root package is required because Crate Universe receives `//:Cargo.toml` and `//:Cargo.lock` as Bazel labels. Keep other root files private unless a later target needs them.

### Rust target names

| Label | Rule | Responsibility |
|---|---|---|
| `//services/api-rs:api_lib` | `rust_library` | Config parsing, app state, health handler, router |
| `//services/api-rs:trocode_api` | `rust_binary` | Logging setup, listener, graceful shutdown |
| `//services/api-rs:api_lib_test` | `rust_test` | Inline unit/router tests compiled from `api_lib` |
| `//services/api-rs:rustfmt_test` | `rustfmt_test` | Format check for first-party library/binary |
| `//services/api-rs:clippy` | `rust_clippy` | Clippy gate for library, binary, and test |

Use `@crates//:defs.bzl` helpers:

- `crate_edition()` for edition parity with Cargo
- `aliases()` for dependency aliases
- `all_crate_deps(normal = True)` and `all_crate_deps(proc_macro = True)` for normal dependencies
- `aliases(normal_dev = True, proc_macro_dev = True)` and dev variants for `rust_test`

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `.bazelversion` | CREATE | Pin Bazel 9.2.0 for Bazelisk |
| `.bazelrc` | CREATE | Standardize test output and a CI config using lockfile error mode |
| `MODULE.bazel` | CREATE | Declare Bzlmod, `rules_rust`, Rust toolchain, and Crate Universe |
| `MODULE.bazel.lock` | GENERATE + COMMIT | Lock module resolution and extension evaluation |
| `REPO.bazel` | CREATE | Ignore Node, Electron, Cargo, and generated output directories during Bazel traversal |
| `BUILD.bazel` | CREATE | Make the repository root a Bazel package and export the Cargo manifest/lock labels consumed by Crate Universe |
| `rust-toolchain.toml` | CREATE | Pin local Cargo/rustfmt/Clippy to Rust 1.97.1 |
| `Cargo.toml` | CREATE | Root Cargo workspace with resolver 3 and `services/api-rs` member |
| `Cargo.lock` | GENERATE + COMMIT | Lock Rust crates consumed by Cargo and Crate Universe |
| `services/api-rs/Cargo.toml` | CREATE | Declare the first Rust service package and exact direct dependencies |
| `services/api-rs/BUILD.bazel` | CREATE | Define library, binary, test, format, and Clippy targets |
| `services/api-rs/src/lib.rs` | CREATE | Testable router/config/health implementation |
| `services/api-rs/src/main.rs` | CREATE | Minimal process composition and graceful server lifecycle |
| `services/api-rs/README.md` | CREATE | Record local commands, ownership, port, and explicit non-production status |
| `.gitignore` | UPDATE | Ignore root `target/` and Bazel output symlinks; keep both lockfiles tracked |
| `package.json` | UPDATE | Add `bazel:build`, `bazel:start`, `bazel:test`, and `bazel:check` scripts without changing `check` |
| `.github/workflows/ci.yml` | UPDATE | Add independent Ubuntu Bazel/Rust job with caches and locked verification |
| `README.md` | UPDATE | Add Bazel/Rust setup, commands, quality gate, and repository map |
| `docs/architecture.md` | UPDATE | Document split build ownership and migration boundary |
| `AGENTS.md` | UPDATE | Add `npm run bazel:check` to required verification for Rust/Bazel changes |
| `package-lock.json` | PRESERVE | It is already user-modified; this plan adds no npm dependency and must not alter it |

---

## NOT Building

- No migration of existing `services/api` endpoints beyond the isolated health probe.
- No production deployment of `services/api-rs` and no Railway service switch.
- No `TROCODE_API_BASE_URL` change or traffic splitting.
- No PostgreSQL connection, migrations, repositories, OpenAI Agents SDK replacement, S3, knowledge ingestion, authentication, rate limiting, budgets, SSE, or desktop-worker protocol in Rust.
- No Bazel rules for Electron, React, TypeScript, Webpack, npm, Swift, or native CUA packages.
- No Rust sidecar bundled into Electron.
- No change to renderer sandboxing, `DesktopApi`, preload, IPC, CUA authority, approval policy, or signed app identity.
- No remote Bazel cache/execution service or cloud credentials.
- No cross-compilation of desktop installers; matching-host Forge release builds remain authoritative.
- No modification of the existing user-owned `package-lock.json` change.

---

## Step-by-Step Tasks

### Task 1: Protect the current build and trust boundaries

- **ACTION**: Record the baseline and establish explicit ownership before adding files.
- **IMPLEMENT**:
  - Confirm `git rev-parse HEAD` is the planned baseline or document the new baseline if implementation starts later.
  - Confirm `git status --short` and preserve the existing `package-lock.json` modification.
  - Verify no `MODULE.bazel`, `BUILD.bazel`, `Cargo.toml`, or Rust source already exists before creating the named files.
  - Treat npm/Forge and Node API behavior as a regression boundary.
- **MIRROR**: `AGENTS.md:3-22` and `docs/architecture.md:217-230`.
- **IMPORTS**: None.
- **GOTCHA**: Do not “clean up” or regenerate `package-lock.json`; no npm dependency is needed.
- **VALIDATE**:
  - `git diff -- package-lock.json` is identical before and after the implementation.
  - Existing `npm run check` behavior is unchanged.

### Task 2: Add pinned Bazel, Bzlmod, and repository configuration

- **ACTION**: Create the root Bazel foundation.
- **IMPLEMENT**:
  - Create `.bazelversion` containing exactly `9.2.0`.
  - Create `.bazelrc` with:
    - `build --verbose_failures`
    - `test --test_output=errors`
    - `build:ci --lockfile_mode=error`
    - `test:ci --lockfile_mode=error`
  - Create `MODULE.bazel` exactly from the “Root MODULE.bazel shape,” using `rules_rust` 0.73.0 and Rust 1.97.1.
  - Create `REPO.bazel` with one `ignore_directories` call covering:
    - `**/node_modules`
    - `.generated-native`
    - `.webpack`
    - `coverage`
    - `out`
    - `target`
  - Create root `BUILD.bazel` with private default visibility and `exports_files(["Cargo.toml", "Cargo.lock"])`; this is required so the `//:Cargo.toml` and `//:Cargo.lock` labels in `MODULE.bazel` belong to a real package.
  - Do not create `WORKSPACE`, `WORKSPACE.bazel`, or `.bazelignore`.
  - After Cargo files exist, run Bazel once in update mode so `MODULE.bazel.lock` is generated, then commit it.
- **MIRROR**: The repository pins exact runtime versions in `package.json:78,93-103`; follow that reproducibility convention.
- **IMPORTS**:
  - `@rules_rust//rust:extensions.bzl` → `rust`
  - `@rules_rust//crate_universe:extensions.bzl` → `crate`
- **GOTCHA**:
  - `MODULE.bazel.lock` is incomplete until a target using the extensions has been analyzed.
  - CI's `--lockfile_mode=error` must not be used for the initial local lock generation.
  - `ignore_directories` may be called only once in `REPO.bazel`.
- **VALIDATE**:
  - `bazel version` reports 9.2.0.
  - `bazel mod graph` resolves `rules_rust@0.73.0`.
  - `bazel info workspace` returns the TroCode repository root.
  - `bazel query //:Cargo.toml //:Cargo.lock` resolves both source-file labels.
  - `git status --short` shows `MODULE.bazel.lock` as tracked work, not ignored.

### Task 3: Establish Cargo as the Rust dependency source of truth

- **ACTION**: Create the pinned Cargo workspace and first service manifest.
- **IMPLEMENT**:
  - Create root `Cargo.toml`:
    - `[workspace]` with `members = ["services/api-rs"]` and `resolver = "3"`.
    - `[workspace.package]` with `edition = "2024"` and `rust-version = "1.97.1"`.
  - Create `rust-toolchain.toml`:
    - `channel = "1.97.1"`
    - `profile = "minimal"`
    - `components = ["clippy", "rustfmt"]`
  - Create `services/api-rs/Cargo.toml`:
    - package name `trocode-api`, version `0.1.0`, `publish = false`.
    - inherit edition and rust-version from workspace.
    - add only the dependencies in “Initial Cargo dependencies.”
  - Run `cargo generate-lockfile` and commit `Cargo.lock`.
  - Run `CARGO_BAZEL_REPIN=1 bazel query //services/api-rs/...` after manifests and lockfile are final. Bazel 9 no longer provides the legacy `sync` command; querying the targets evaluates and repins the Crate Universe module extension without compiling them.
- **MIRROR**: `services/api/package.json:1-25` keeps hosted API dependencies isolated from the desktop package.
- **IMPORTS**: Cargo crates listed in the exact foundation specification.
- **GOTCHA**:
  - Do not declare external crates again as hand-written Bazel labels in `MODULE.bazel`.
  - Any Cargo manifest change must update `Cargo.lock` and re-evaluate `MODULE.bazel.lock`.
  - Keep package `rust-version` aligned with both `rust-toolchain.toml` and the Bazel toolchain.
- **VALIDATE**:
  - `cargo metadata --format-version 1 --locked --no-deps` lists only `services/api-rs`.
  - `rustc --version` under the repository override reports 1.97.1.
  - `cargo tree --locked` resolves without duplicate workspace packages.

### Task 4: Implement the non-production Rust health service

- **ACTION**: Add one real, testable Rust HTTP slice matching the existing public health contract.
- **IMPLEMENT**:
  - In `src/lib.rs`:
    - Define a cloneable private `AppState` containing the version string.
    - Define a `#[derive(Serialize)]` response with `status` and `version`.
    - Implement a pure `parse_port(Option<&str>) -> Result<u16, ConfigError>` or equivalent:
      - missing/blank → 8081
      - supplied positive `u16` → accepted
      - zero, non-integer, negative, or >65535 → bounded error
    - Implement `version_from_env` or accept the version as an argument so tests do not mutate process-global environment.
    - Implement `pub fn app(version: impl Into<String>) -> Router`.
    - Register only `GET /healthz`.
    - Return the exact JSON shape and security headers in “Initial HTTP behavior.”
  - In `src/main.rs`:
    - Initialize JSON `tracing_subscriber` with `EnvFilter` and a safe default level.
    - Read `PORT` and `RAILWAY_GIT_COMMIT_SHA` once at startup.
    - Bind `0.0.0.0:<port>` with `tokio::net::TcpListener`.
    - Emit `event = "server.ready"` with the port only after binding succeeds.
    - Serve `trocode_api::app(version)` with graceful shutdown on Ctrl-C/SIGTERM where supported.
    - Return a process error without printing environment values or secrets.
- **MIRROR**:
  - Health contract: `services/api/src/server.mjs:333-348`.
  - Config parsing: `services/api/src/config.mjs:3-30`.
  - Logging: `services/api/src/main.mjs:253-298`.
- **IMPORTS**:
  - Library: `axum::{extract::State, http::{header, HeaderMap, HeaderValue}, routing::get, Json, Router}`, `serde::Serialize`.
  - Binary: `tokio::net::TcpListener`, `tracing::info`, `tracing_subscriber::EnvFilter`.
  - Tests: `axum::{body::Body, http::{Request, StatusCode}}`, `http_body_util::BodyExt`, `serde_json::json`, `tower::ServiceExt`.
- **GOTCHA**:
  - Do not bind 8080 by default; the Node service already uses it.
  - Do not add `/readyz` yet because the Rust slice has no database readiness dependency.
  - Do not read or log the full environment.
  - Do not add permissive CORS; current server rejects browser-origin API requests.
- **VALIDATE**:
  - Unit tests cover default/valid/invalid port parsing.
  - Router test asserts exact status, JSON, content type, and all security headers.
  - A missing route returns 404 and does not panic.

### Task 5: Define Bazel build, test, format, and Clippy targets

- **ACTION**: Make Bazel fully own verification of the first Rust slice.
- **IMPLEMENT**:
  - In `services/api-rs/BUILD.bazel` load:
    - `aliases`, `all_crate_deps`, `crate_edition` from `@crates//:defs.bzl`.
    - `rust_binary`, `rust_clippy`, `rust_library`, `rust_lint_config`, `rust_test`, and `rustfmt_test` from `@rules_rust//rust:defs.bzl`.
  - Define `rust_lint_config(name = "rust_lints")`:
    - forbid Rust `unsafe_code`.
    - deny Clippy `all` for first-party targets.
  - Define `api_lib`:
    - source `src/lib.rs`.
    - crate name `trocode_api`.
    - generated normal/proc-macro deps and aliases.
    - local lint config.
  - Define `trocode_api`:
    - source `src/main.rs`.
    - distinct binary crate name such as `trocode_api_server`.
    - dependency on `:api_lib` plus normal/proc-macro deps.
    - local lint config.
    - public visibility so developers and CI can run it by label.
  - Define `api_lib_test` with `crate = ":api_lib"`, generated dev dependency aliases/deps, and the local lint config.
  - Define `rustfmt_test` over `:api_lib` and `:trocode_api`.
  - Define test-only `clippy` over `:api_lib`, `:trocode_api`, and `:api_lib_test`.
- **MIRROR**: `services/api/test/agent-turn-service.test.mjs:6-88` keeps behavior testable behind an in-memory dependency; `api_lib` serves the same purpose for Rust.
- **IMPORTS**: Exact loads listed above.
- **GOTCHA**:
  - `rust_test(crate = ":api_lib")` must use dev aliases/deps; normal deps come through the crate.
  - `rust_clippy` is built, not executed by `bazel test`.
  - Avoid broad `glob(["**"])` patterns that capture `target` or generated files; list `src/lib.rs` and `src/main.rs` explicitly for this small slice.
- **VALIDATE**:
  - `bazel query //services/api-rs/...` lists all five named targets plus the lint config.
  - `bazel build //services/api-rs:trocode_api` passes.
  - `bazel test //services/api-rs/...` passes `api_lib_test` and `rustfmt_test`.
  - `bazel build //services/api-rs:clippy` passes.
  - `bazel run //services/api-rs:trocode_api` starts the service.

### Task 6: Add developer commands and document ownership

- **ACTION**: Make the new build lane discoverable without replacing npm/Forge.
- **IMPLEMENT**:
  - Update `package.json` scripts:
    - `bazel:build` → `bazel build //services/api-rs:trocode_api`
    - `bazel:start` → `bazel run //services/api-rs:trocode_api`
    - `bazel:test` → `bazel test //services/api-rs/...`
    - `bazel:check` → run `bazel test --config=ci //services/api-rs/...` and `bazel build --config=ci //services/api-rs:clippy`
  - Do not add `bazel:check` to the existing `check` script; release workflows and desktop packaging should not acquire a Rust prerequisite in this phase.
  - Update `.gitignore` with root `/target/` and `/bazel-*` patterns. Do not ignore `Cargo.lock` or `MODULE.bazel.lock`.
  - Create `services/api-rs/README.md` documenting:
    - non-production status
    - default port 8081 and `PORT` override
    - Bazel commands
    - Cargo manifest/lock ownership
    - dependency-change sync procedure
  - Update root `README.md`:
    - add Bazelisk/Rust bootstrap notes
    - add `npm run bazel:check` to quality checks
    - add `services/api-rs` to repository map
    - state that Electron packaging remains Forge-owned
  - Update `docs/architecture.md` under Native execution and packaging with the split build ownership.
  - Update `AGENTS.md` required verification so Rust/Bazel changes run `npm run bazel:check` in addition to existing gates.
- **MIRROR**: `README.md:439-455` documents executable quality commands and native build ownership.
- **IMPORTS**: None.
- **GOTCHA**:
  - Editing package scripts should not require or justify a `package-lock.json` change.
  - Avoid telling developers that `bazel build //...` packages Electron; it only owns declared Rust targets.
- **VALIDATE**:
  - `npm run bazel:build`, `npm run bazel:test`, and `npm run bazel:check` resolve on a Bazelisk-enabled machine.
  - README and architecture use the same version pins and ownership terms as configuration.

### Task 7: Add an independent Linux Bazel/Rust CI gate

- **ACTION**: Extend CI without modifying desktop release workflows.
- **IMPLEMENT**:
  - Add a new job, e.g. `rust-backend`, to `.github/workflows/ci.yml`.
  - Use `ubuntu-24.04`.
  - Steps:
    1. `actions/checkout@v4`.
    2. `bazel-contrib/setup-bazel@0.19.0` with:
       - `bazelisk-cache: true`
       - `disk-cache: ${{ github.workflow }}-rust`
       - `repository-cache: true`
       - `cache-save: ${{ github.event_name != 'pull_request' }}`
    3. `npm run bazel:check`.
    4. `bazel build --config=ci //services/api-rs:trocode_api`, unless already guaranteed by the Clippy target; keep it explicit for artifact build coverage.
  - Keep the existing `verify` job's macOS/Windows matrix and npm/Forge commands unchanged.
  - Do not add Doppler, database, OpenAI, or deployment secrets to the Rust job.
- **MIRROR**: `.github/workflows/ci.yml:11-30` uses a small job with checkout/setup/verify steps and read-only contents permission.
- **IMPORTS**: GitHub Action `bazel-contrib/setup-bazel@0.19.0`.
- **GOTCHA**:
  - CI must use `--lockfile_mode=error` through `--config=ci` so it cannot produce an uncommitted lockfile.
  - Disable cache writes on pull requests to prevent untrusted PR cache pollution.
  - Do not place this job in the desktop OS matrix.
- **VALIDATE**:
  - A clean checkout completes without modifying tracked files.
  - `git diff --exit-code -- Cargo.lock MODULE.bazel.lock` passes after the CI commands.
  - The existing desktop `verify` job remains byte-for-byte unchanged except for YAML positioning caused by adding the new sibling job.

### Task 8: Run full regression and manual health validation

- **ACTION**: Verify both build lanes and the health behavior before handoff.
- **IMPLEMENT**:
  - Run the Bazel/Rust gates first.
  - Run the existing npm and packaging gates required by `AGENTS.md`.
  - Start Rust on an explicit loopback validation port and inspect its response.
  - Review the complete diff for accidental npm, Electron, production routing, or deployment changes.
- **MIRROR**: `AGENTS.md:13-22` and `README.md:439-455`.
- **IMPORTS**: None.
- **GOTCHA**:
  - `npm run package` requires the repository's Doppler production configuration.
  - Do not run the Rust and Node API on the same port.
  - Stop the manual Rust process after validation.
- **VALIDATE**: Run every command in “Validation Commands” and complete the manual checklist.

---

## Testing Strategy

### Unit and Router Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Default port | no `PORT` | `8081` | Yes |
| Blank port | whitespace | `8081` | Yes |
| Valid port | `18081` | parsed `u16` 18081 | No |
| Zero port | `0` | bounded configuration error | Yes |
| Invalid port | `abc` | bounded configuration error | Yes |
| Out-of-range port | `65536` | bounded configuration error | Yes |
| Health local version | app built with `local` | 200 with exact local JSON | No |
| Health commit version | app built with `test-sha` | 200 with exact version JSON | No |
| Security headers | `GET /healthz` | all five required hardening headers | No |
| Content type | `GET /healthz` | JSON content type | No |
| Unknown route | `GET /missing` | 404, no panic | Yes |
| Concurrent health requests | multiple in-memory/loopback requests | every request returns independent 200 response | Yes |

### Build-System Tests

| Check | Expected |
|---|---|
| Bazel version | 9.2.0 through Bazelisk |
| Bzlmod graph | `rules_rust@0.73.0` resolved |
| Rust toolchain | 1.97.1, edition 2024 |
| Cargo metadata | one workspace member, locked |
| Bazel binary build | `//services/api-rs:trocode_api` succeeds |
| Bazel tests | router/unit and rustfmt tests pass |
| Bazel Clippy | no first-party Clippy warnings |
| Lockfile discipline | CI error mode accepts both tracked locks |
| npm regression | existing lint/typecheck/Vitest/Node API tests pass |
| package regression | Electron Forge package succeeds on host |

### Edge Cases Checklist

- [ ] Missing environment variables use only documented safe defaults
- [ ] Invalid `PORT` fails closed
- [ ] Port already in use returns a bounded startup failure
- [ ] Empty/missing commit SHA returns `local`
- [ ] Concurrent health requests remain stable
- [ ] Unknown route does not expose internal errors
- [ ] Dependency registry/network failure does not alter committed locks in CI
- [ ] Fresh clone generates no untracked dependency files after locked checks
- [ ] Existing Node API can still use port 8080 while Rust defaults to 8081
- [ ] Existing user-owned `package-lock.json` diff is preserved exactly

---

## Validation Commands

### Baseline and toolchains

~~~bash
git status --short
bazel version
rustc --version
cargo --version
~~~

EXPECT: Existing `package-lock.json` modification remains visible; Bazel is 9.2.0; Rust/Cargo are the pinned 1.97.1 toolchain.

### Dependency graph and lock generation

~~~bash
cargo generate-lockfile
cargo metadata --format-version 1 --locked --no-deps
CARGO_BAZEL_REPIN=1 bazel query //services/api-rs/...
bazel mod graph
~~~

EXPECT: Cargo lists `services/api-rs`; Bazel resolves `rules_rust` 0.73.0; both lockfiles are present and tracked.

### Bazel build, format, tests, and Clippy

~~~bash
bazel build //services/api-rs:trocode_api
bazel test //services/api-rs/... --test_output=errors
bazel build //services/api-rs:clippy
npm run bazel:check
~~~

EXPECT: Binary builds; unit/router and rustfmt tests pass; Clippy reports no denied lint.

### Cargo parity checks

~~~bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
~~~

EXPECT: Cargo agrees with Bazel on formatting, lint, compilation, and tests. These are transition checks; Bazel remains the CI owner.

### Existing static analysis and test suite

~~~bash
npm run check
~~~

EXPECT: Runtime version gate, ESLint, TypeScript, Vitest, script tests, and Node API tests all pass.

### Existing desktop package

~~~bash
npm run package
~~~

EXPECT: Electron Forge packages the current host target, including native CUA staging; Bazel does not participate.

### Locked CI simulation

~~~bash
bazel test --config=ci //services/api-rs/...
bazel build --config=ci //services/api-rs:clippy
bazel build --config=ci //services/api-rs:trocode_api
git diff --exit-code -- Cargo.lock MODULE.bazel.lock
~~~

EXPECT: Locked mode succeeds and does not mutate dependency state.

### Manual health validation

~~~bash
PORT=18081 RAILWAY_GIT_COMMIT_SHA=test-sha bazel run //services/api-rs:trocode_api
curl --fail-with-body --include http://127.0.0.1:18081/healthz
~~~

EXPECT:

- HTTP 200.
- JSON is `{"status":"ok","version":"test-sha"}`.
- Required no-store/CSP/referrer/nosniff/frame headers are present.
- The process emits a bounded structured `server.ready` event without secrets.

### Final diff review

~~~bash
git status --short
git diff --check
git diff --stat
git diff -- package-lock.json
~~~

EXPECT: Only scoped files plus the pre-existing `package-lock.json` modification are present; no whitespace errors; the package-lock diff is unchanged from baseline.

---

## Manual Validation Checklist

- [ ] Install/use Bazelisk and verify `.bazelversion` is honored.
- [ ] Run `npm run bazel:start` with no `PORT` and confirm default port 8081.
- [ ] Run with `PORT=18081` and confirm the override.
- [ ] Request `/healthz` and inspect body plus all security headers.
- [ ] Request an unknown path and confirm 404 without internal details.
- [ ] Start the existing Node API separately on 8080 and confirm no default collision.
- [ ] Confirm Electron still uses its configured existing `TROCODE_API_BASE_URL`.
- [ ] Confirm no production Railway config points to `services/api-rs`.
- [ ] Confirm no Rust executable appears in `forge.config.ts` `extraResource`.
- [ ] Confirm existing desktop CI/release workflows still use npm/Forge.

---

## Acceptance Criteria

- [ ] Bazel is pinned to 9.2.0 through `.bazelversion`.
- [ ] `MODULE.bazel` uses Bzlmod, `rules_rust` 0.73.0, Rust 1.97.1, and Crate Universe.
- [ ] No legacy `WORKSPACE` configuration is introduced.
- [ ] `Cargo.toml`/`Cargo.lock` are the Rust dependency source of truth.
- [ ] `MODULE.bazel.lock` and `Cargo.lock` are generated and committed.
- [ ] Rust exposes a tested, contract-compatible public `GET /healthz` route.
- [ ] Rust defaults to port 8081 and rejects invalid supplied ports.
- [ ] Bazel builds the binary and runs unit/router plus rustfmt tests.
- [ ] Bazel Clippy passes with unsafe code forbidden.
- [ ] A dedicated Ubuntu CI job runs locked Bazel verification with safe caches.
- [ ] Existing macOS/Windows npm/Forge CI behavior remains unchanged.
- [ ] Existing Node API, Railway deployment, desktop API base URL, and production traffic remain unchanged.
- [ ] Electron renderer/preload/main, CUA, IPC, signing, and packaging ownership remain unchanged.
- [ ] `npm run check` passes.
- [ ] `npm run package` passes.
- [ ] The pre-existing `package-lock.json` change is not altered.
- [ ] Documentation clearly states what Bazel owns and what it does not own.

## Completion Checklist

- [ ] Code follows discovered naming, error, logging, configuration, and test patterns.
- [ ] Health response does not expose raw errors or environment data.
- [ ] JSON logs contain bounded stable event fields.
- [ ] Tests are deterministic and require no database, external API, or secret.
- [ ] No hardcoded production endpoint or credential exists.
- [ ] Version pins agree across `.bazelversion`, `MODULE.bazel`, `rust-toolchain.toml`, and Cargo manifests.
- [ ] Both lockfiles are tracked and CI uses error mode.
- [ ] README, architecture, service README, and contributor verification are updated.
- [ ] No unnecessary JavaScript Bazelization or backend migration is included.
- [ ] The implementation can be reverted without affecting the current production app.
- [ ] Self-contained — no additional codebase search or architecture choice is required during implementation.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cargo and Bazel dependency state drift | Medium | High | Cargo manifests/lock are canonical; use generated Crate Universe macros, repin after manifest changes, commit both locks, use CI error mode |
| Newer Rust is pinned before `rules_rust` supports it | Low | High | Pin 1.97.1, explicitly supported by selected rules; upgrade pins together in a separate change |
| Windows `rules_rust` failures block desktop CI | Medium | Medium | Use dedicated Ubuntu hosted-backend job; do not add Rust to desktop matrix |
| Bazel cold-start/download time is surprising | High initially | Low | Use Bazelisk, repository cache, and disk cache; document first-run expectation |
| Developers assume Bazel packages Electron | Medium | Medium | Document explicit ownership; keep Forge scripts and workflows unchanged |
| Rust health implementation accidentally receives traffic | Low | High | No Railway/routing/base URL changes; label service non-production in README and architecture |
| Health contract drifts from Node | Medium | Medium | Assert exact body/status/security headers based on existing server test |
| Broad Clippy settings create noisy future migrations | Medium | Low | Apply lint config only to first-party Rust targets; tune intentionally in later Rust PRPs |
| CI modifies `MODULE.bazel.lock` | Medium | Medium | `--config=ci` uses `--lockfile_mode=error` and checks lockfile diff |
| Existing dirty `package-lock.json` is overwritten | Medium | High | Snapshot its diff before implementation and verify the exact diff after all work |
| Scope expands into full Node-to-Rust migration | Medium | High | Enforce NOT Building list and accept only `/healthz` in this phase |

---

## Follow-on Migration Gates

These are intentionally separate plans after this foundation merges:

1. Add shared HTTP conformance fixtures for Node and Rust.
2. Migrate pure policies/catalogs with no I/O.
3. Introduce Rust PostgreSQL repository ports and transaction tests.
4. Migrate authenticated non-streaming `/v1` endpoints behind a rollout flag.
5. Migrate SSE and durable agent-runtime endpoints.
6. Move Railway traffic gradually with rollback and client-version compatibility.
7. Evaluate a Rust desktop sidecar only for pure local engine work; retain Electron main authority over IPC, CUA, OS permissions, and signed-app behavior.

Each follow-on gate must preserve existing request/response schemas, idempotency, unknown-outcome handling, and the rule that consequential desktop actions are never retried when completion is uncertain.

## Notes

- This plan intentionally introduces Bazel after one meaningful Rust vertical slice but before broad backend migration.
- Bazel will not automatically build “everything”; it builds only declared labels.
- The first service is deliberately small enough to prove version pins, dependency import, build, unit tests, router tests, format, Clippy, CI caching, and runtime startup without creating production risk.
- If implementation begins after the documented research date, verify only the chosen pins' availability; do not opportunistically upgrade them inside the same foundation change.
