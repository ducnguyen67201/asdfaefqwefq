# TroCode Rust API foundation

This service is a non-production migration foundation. It currently exposes
only `GET /healthz`; the existing Node service in `services/api` continues to
serve all production traffic and every `/v1` endpoint.

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

## Dependency ownership

`Cargo.toml` files and the root `Cargo.lock` are the Rust dependency source of
truth. Bazel imports them through Crate Universe and owns the CI build graph.
After changing a Cargo manifest, update both dependency locks locally:

```bash
cargo generate-lockfile
CARGO_BAZEL_REPIN=1 bazel query //services/api-rs/...
bazel build //services/api-rs:trocode_api
```

Commit `Cargo.lock` and any resulting `MODULE.bazel.lock` update together. CI
uses Bazel lockfile error mode and will not rewrite dependency state.
