# Tro hosted API

This directory contains the Rust candidate for Tro's hosted backend alongside
the JavaScript release oracle. The Rust crate builds one locked `trocode-api`
binary for the API, ingestion worker, and operator commands. Railway must stay
on the JavaScript start command until every cutover gate passes.

```bash
cargo run --locked -- serve
cargo run --locked -- ingestion-worker
cargo run --locked -- access-code create --max-users 10 --plan basic
cargo run --locked -- knowledge-load-report
cargo run --locked -- knowledge-worker-smoke
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

The API preserves the installed desktop client's REST, binary, and SSE contracts. Provider requests are budget-reserved before dispatch, use bounded responses, and are never retried after acceptance may have occurred. The durable agent uses encrypted Rust checkpoint version 2; it cannot resume a nonterminal JavaScript Agents SDK checkpoint, so the production drain gate in `docs/operations/rust-backend-cutover.md` is mandatory.
