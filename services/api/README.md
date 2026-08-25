# Tro hosted API

This directory is Tro's Rust hosted backend. One locked `trocode-api` binary
owns the HTTP API, ingestion worker, migrations, and operator commands. The
Electron application remains a separate TypeScript desktop frontend.

Both Railway services must use `/` as their Root Directory so Railpack can read
the shared root `Cargo.toml` and `Cargo.lock`. Because Railway config paths are
repository-relative, set the API service's config path to
`/services/api/railway.json` and the worker service's path to
`/services/api/railway.worker.json`. The root `railpack.json` explicitly selects
the Rust provider so the Electron `package.json` does not select Node.

```bash
cargo run --manifest-path services/api/Cargo.toml --locked -- serve
cargo run --manifest-path services/api/Cargo.toml --locked -- ingestion-worker
cargo run --manifest-path services/api/Cargo.toml --locked -- access-code create --max-users 10 --plan basic
cargo run --manifest-path services/api/Cargo.toml --locked -- knowledge-load-report
cargo run --manifest-path services/api/Cargo.toml --locked -- knowledge-worker-smoke
```

The crate embeds the unchanged migrations in `migrations/`. Startup applies them before binding the HTTP listener. Do not edit an applied migration or point integration tests at production.

Local verification from the repository root:

```bash
npm run api:fmt
npm run api:lint
npm run api:test
npm run api:audit
npm run api:build
```

The API preserves the installed desktop client's REST, binary, and SSE contracts. Provider requests are budget-reserved before dispatch, use bounded responses, and are never retried after acceptance may have occurred. The durable agent uses encrypted Rust checkpoint version 2; it cannot resume a nonterminal legacy Agents SDK checkpoint, so the production drain gate in `docs/operations/rust-backend-cutover.md` is mandatory when upgrading an older deployment.

Live-classroom endpoints are part of this same binary and database migration
set. They cover room admission, teacher directives, participant help and review
transitions, and snapshot/delta dashboards; the ignored PostgreSQL E2E test
also verifies the 200-seat Basic-plan boundary.
