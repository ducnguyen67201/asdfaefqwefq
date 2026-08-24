# TroCode Rust API

This service is TroCode's incremental hosted-API migration target. It always
exposes `GET /healthz`. When `TROCODE_KNOWLEDGE_SPACES_ENABLED=true`, it also
serves the live-classroom room, directive, assessment, and dashboard routes used
by the existing desktop client. The Node service in `services/api` remains the
compatibility owner for authentication issuance, Spaces, material ingestion,
Activity publishing, agent execution, submissions, and unrelated `/v1` routes.

Both services use the same PostgreSQL schema and opaque `tro_live_` device
sessions. Apply the Node-owned SQL migrations before starting Rust; the Rust
process fails closed when migration 018 is missing and never creates schema at
runtime.

## Classroom route ownership

The Rust slice owns these route families:

- room-code create/revoke/join, current session, leave, Run open/close;
- typed classroom directives, ordered delivery, and one-time claims;
- Help, Ready, teacher review, Help resolution, and teacher dashboard deltas.

Ingress must route each whole family to one backend at a time. Do not load
balance a mutation family across Node and Rust during cutover. Both
implementations retain the same desktop wire contract so rollback is a route
switch plus `TROCODE_KNOWLEDGE_SPACES_ENABLED=false`, with no data rewrite.

## Run and verify

Install Bazelisk, then run commands from the repository root:

```bash
npm run bazel:start
npm run bazel:build
npm run bazel:test
npm run bazel:check
```

The server binds `0.0.0.0:8081` by default. Set `PORT` to a positive port up to
65535 to override it. `RAILWAY_GIT_COMMIT_SHA` supplies the health response
version; it defaults to `local`.

Enabling the classroom slice also requires `DATABASE_URL` and the same
`TROCODE_SESSION_TOKEN_HMAC_KEY` used by Node. The key must be at least 32
characters. `TROCODE_DATABASE_POOL_MAX` defaults to 10.

Run the real PostgreSQL contract and capacity test with a disposable migrated
database:

```bash
TEST_DATABASE_URL='<disposable-postgres-url>' \
  cargo test --test classroom_e2e -- --nocapture
```

## Dependency ownership

`Cargo.toml` files and the root `Cargo.lock` are the Rust dependency source of
truth. Bazel imports them through Crate Universe and owns the CI build graph.
Shared first-party lint and verification conventions live under `bazel/rust`;
each service keeps its compilation targets explicit in its local `BUILD.bazel`.
After changing a Cargo manifest, update both dependency locks locally:

```bash
cargo generate-lockfile
CARGO_BAZEL_REPIN=1 bazel query //services/api-rs/...
bazel build //services/api-rs:trocode_api
```

Commit `Cargo.lock` and any resulting `MODULE.bazel.lock` update together. CI
uses Bazel lockfile error mode and will not rewrite dependency state.
