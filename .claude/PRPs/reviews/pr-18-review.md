# PR Review: #18 — feat(api): add in-place Rust backend migration candidate

**Reviewed**: 2026-08-25

**Author**: ducnguyen67201

**Branch**: `codex/migrate-hosted-backend-rust` → `main`

**Follow-up reviewed**: #21 (`codex/fix-jsonwebtoken-advisory`)

**Decision**: REQUEST CHANGES for production cutover; all concrete code findings below are addressed on `codex/review-rust-backend`

## Summary

The merged candidate is broad, fail-closed in the paths exercised, and truthful about not changing production behavior. Review found one high-severity durable-agent lifecycle omission plus provider, transcription, and budget parity defects. The follow-up branch fixes those findings and passes the full local Rust/PostgreSQL/S3, Node, Bazel, release-build, coverage, and Electron packaging gates. It deliberately does not switch Railway: the migration remains incomplete until the documented differential, performance, staging, backup/restore, and rollback gates pass.

## Findings

### CRITICAL

None.

### HIGH

- **Resolved on follow-up — missing durable-agent maintenance lifecycle.** The Rust server ran agent work but never expired stale worker sessions, run deadlines, or pending tool invocations and never purged expired encrypted payloads. A worker that disappeared after a consequential dispatch could therefore leave an invocation executing instead of unknown and its run unblocked; private payloads could also outlive their configured TTL. `AgentService::maintain` now preserves the JavaScript transitions and cleanup behavior, is scheduled every 60 seconds, and has real-PostgreSQL coverage for stale workers, expired tools/runs, and payload deletion (`services/api/src/agent/service.rs:767`, `services/api/src/app.rs:100`).

- **Open release blocker — this is still a candidate, not the completed migration.** The existing service continues to execute Node (`services/api/package.json:10`), Railway has no Rust start command (`services/api/railway.json:3`), and the implementation report explicitly leaves Tasks 13–15 pending (`.claude/PRPs/reports/migrate-hosted-backend-to-rust-report.md:5`). Do not approve or perform production cutover until exhaustive differential coverage, remaining agent parity, performance/soak, staging rollback/roll-forward, backups, and operator approval are complete.

### MEDIUM

- **Resolved on follow-up — valid Responses streams could remain uncertain.** Reverse SSE parsing stopped at the terminal `data: [DONE]` marker instead of continuing to the preceding `response.completed` usage event. The parser now skips terminal/empty/malformed non-completion events, with a terminal-marker regression fixture (`services/api/src/providers/responses.rs:350`).

- **Resolved on follow-up — transcription request/response parity drift.** Rust accepted unsupported language codes, rejected valid empty transcripts, ignored malformed optional language metadata, and truncated fractional PCM duration before settlement. The HTTP whitelist, provider response validation, exact duration billing, rounded public duration, and fractional-WAV regression coverage now match the JavaScript behavior (`services/api/src/http/core.rs:406`, `services/api/src/providers/transcription.rs:49`).

- **Resolved on follow-up — task budget snapshots included prior months.** The Rust aggregate scoped monthly columns individually but left task totals all-time. The query now applies the JavaScript repository's outer current-month filter, with a prior-month reservation regression case (`services/api/src/usage/budget.rs:367`).

- **Open dependency warning — upstream Rust dependencies require an explicit release decision.** `cargo audit` has no failing vulnerability exit but reports `lru` RUSTSEC-2026-0253 through `aws-sdk-s3` and unmaintained `ttf-parser` RUSTSEC-2026-0192 through `pdf-extract`. The current compatible AWS SDK requires `lru ^0.16.3`, while the advisory fix is `lru >=0.18.2`; `ttf-parser` has no patched release. Keep both as explicit cutover blockers rather than hiding them with a blanket ignore.

### LOW

- **Resolved on follow-up — uncertain reservation disposition differed from Node.** Rust stored `ambiguous_dispatch`; the JavaScript repository stores `ambiguous`. The durable value and regression assertion now match (`services/api/src/usage/budget.rs:293`).

## Ponytail Review

The following over-engineering findings were applied on the follow-up branch:

`services/api/src/config.rs:L28: delete: unused AdminConfig.enabled duplicated access_token.is_some(). Nothing replaces it.`

`services/api/src/providers/transcription.rs:L45: delete: unused Wav.data_byte_length. Nothing replaces it.`

`services/api/src/usage/budget.rs:L32: shrink: SettlementInput.disposition was always "completed". Hard-code the durable settlement disposition at the write boundary.`

`services/api/src/knowledge/extraction.rs:L34: yagni: PdfExtractor and DefaultPdfExtractor had one implementation and one caller. Call extract_pdf_inner directly until a second implementation exists.`

`net: -30 lines possible.`

## Validation Results

| Check | Result |
|---|---|
| `cargo fmt --all -- --check` | Pass |
| `cargo clippy --workspace --locked --all-targets --all-features -- -D warnings` | Pass |
| Full Rust suite with ignored integrations, PostgreSQL 17, and S3 | Pass — 36 tests |
| `cargo llvm-cov ... --fail-under-lines 80` with all integrations | Pass — 80.37% lines |
| `cargo audit --file Cargo.lock` | Pass with two documented upstream warnings |
| `cargo build --release --locked` | Pass |
| `npm run check` | Pass |
| `npm run bazel:check` | Pass |
| `npm run package` | Pass — macOS arm64 |
| `git diff --check` | Pass |

## Files Reviewed

- **Planning/reporting/docs:** `.claude/PRPs/plans/migrate-hosted-backend-to-rust.plan.md` (added), `.claude/PRPs/reports/migrate-hosted-backend-to-rust-report.md` (added), `README.md` (modified), `docs/architecture.md` (modified), `docs/operations/rust-backend-cutover.md` (added), `.env.example` (modified), `.gitattributes` (added).
- **Build/dependency/CI:** `.github/workflows/ci.yml`, `Cargo.toml`, `Cargo.lock`, `MODULE.bazel.lock`, `package.json` (modified); `services/api/Cargo.toml`, `services/api/build.rs` (added); `services/api/BUILD.bazel` (renamed/modified); legacy `services/api-rs/{Cargo.toml,README.md,src/lib.rs,src/main.rs}` (deleted).
- **Rust application:** `services/api/src/{app,config,db,error,lib,main,observability}.rs` (added).
- **Auth:** `services/api/src/auth/{access_codes,admin_session,crypto,google,mod,sessions}.rs` (added).
- **HTTP:** `services/api/src/http/{admin,agent_runtime,core,knowledge,middleware,mod}.rs` (added).
- **Agent:** `services/api/src/agent/{mod,service}.rs` (added).
- **Knowledge:** `services/api/src/knowledge/{extraction,mod,object_store,service,worker}.rs` (added).
- **Providers/usage:** `services/api/src/providers/{mod,responses,transcription}.rs` and `services/api/src/usage/{budget,mod,models,plans,rate_limit}.rs` (added).
- **CLI:** `services/api/src/cli/mod.rs` (added).
- **Tests/fixtures:** `services/api/tests/{agent_runtime_compat,contract_corpus,google_auth_compat,http_compat,ingestion,parser_properties,postgres_compat,provider_budget_compat}.rs` and `services/api/tests/fixtures/{crypto_compat,pdf_corpus,route_inventory,schema_inventory}.json` (added).
- **Security follow-up #21:** `services/api/Cargo.toml`, `Cargo.lock`, and `services/api/src/auth/google.rs` (modified).

## Recommendation

Merge the focused follow-up after CI passes because it removes real parity and retention defects without changing production runtime selection. Keep the overall migration and deployment decision at **REQUEST CHANGES** until the remaining release blockers are proved and the existing Railway service can be switched and rolled back safely.
