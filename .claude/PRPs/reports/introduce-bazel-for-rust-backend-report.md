# Implementation Report: Introduce Bazel for the Rust Backend Foundation

## Summary

Introduced a parallel Bazel/Rust build lane without changing TroCode's existing
Electron Forge desktop pipeline or production Node API. The repository now pins
Bazel 9.2.0, `rules_rust` 0.73.0, and Rust 1.97.1; imports Cargo dependencies
through Crate Universe; builds, tests, formats, and lints a non-production Rust
health service; and verifies that service in a dedicated Ubuntu CI job.
Repository-owned reusable Rust lint and verification macros live under
`bazel/rust`, while each service keeps its compilation graph explicit in its
nearest `BUILD.bazel` file.

The Rust service exposes only `GET /healthz`. It defaults to port 8081, reports
the Railway commit SHA or `local`, applies the existing API's hardening headers,
logs bounded structured lifecycle events, and shuts down gracefully. All
production `/v1` traffic, Railway deployment, renderer/preload/main authority,
native CUA staging, signing, and installer creation remain unchanged.

The pre-existing `package-lock.json` modification was preserved exactly. Its
diff SHA-256 remained
`1a465bdc0b7e679ded370da73b5319b6c38262b6e4878c24996a2abca55a205c`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | Not specified | High after full validation |
| Files Changed | 20 implementation files | 23 implementation files after requested follow-up |

Workflow artifacts—the archived plan and this report—are not included in the
implementation-file count. The unrelated pre-existing `package-lock.json`
modification is also excluded.

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Protect the current build and trust boundaries | Complete | Baseline and package-lock diff hash captured and rechecked |
| 2 | Add pinned Bazel, Bzlmod, and repository configuration | Complete | Bazel 9.2.0, Bzlmod, repository ignores, root package, and module lock added |
| 3 | Establish Cargo as the Rust dependency source of truth | Complete | Workspace, Rust 1.97.1 override, manifests, and Cargo lock added |
| 4 | Implement the non-production Rust health service | Complete | Health contract, configuration, structured logs, graceful shutdown, and tests added |
| 5 | Define Bazel build, test, format, and Clippy targets | Complete | Library, binary, test, rustfmt, lint config, and Clippy targets pass |
| 6 | Add developer commands and document ownership | Complete | npm scripts, service guide, root README, architecture, and contributor guidance updated |
| 7 | Add an independent Linux Bazel/Rust CI gate | Complete | Ubuntu job uses Bazelisk caches and lockfile error mode without secrets |
| 8 | Run full regression and manual health validation | Complete | All consolidated gates and edge checks pass |
| 9 | Add a scalable repository-owned Bazel support folder | Complete | Requested follow-up centralizes reusable Rust lint/check conventions without hiding service compilation targets |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | Bazel/Rust pins and graph verified; Cargo fmt/Clippy and npm lint/typecheck pass |
| Unit Tests | Pass | 7 Rust tests pass through Cargo and Bazel; existing npm checks report 903 passed and 1 database-dependent skip |
| Build | Pass | Locked Bazel binary build and Electron Forge macOS/arm64 package pass |
| Integration | Pass | Live `/healthz` returns exact 200 JSON and all five hardening headers |
| Edge Cases | Pass | Default/invalid ports, occupied port, missing route, concurrent health requests, structured logs, and graceful shutdown verified |

Additional reproducibility checks passed:

- `Cargo.lock` SHA-256:
  `0d0964764d24b99ef8c50bbe2f654044eec458103879be26f693b1f3ee4d66df`
- `MODULE.bazel.lock` SHA-256:
  `c9723c61195dba44bb6ae39033e9abb0b815aa61cbd5b4aba316221e5345d24a`
- `bazel query --lockfile_mode=error //services/api-rs/...` left both files
  byte-identical.

## Files Changed

| File | Action | Lines |
|---|---|---:|
| `.bazelrc` | Created | +4 |
| `.bazelversion` | Created | +1 |
| `BUILD.bazel` | Created | +6 |
| `Cargo.lock` | Generated | +670 |
| `Cargo.toml` | Created | +7 |
| `MODULE.bazel` | Created | +25 |
| `MODULE.bazel.lock` | Generated | +1538 |
| `REPO.bazel` | Created | +8 |
| `rust-toolchain.toml` | Created | +4 |
| `bazel/README.md` | Created | +13 |
| `bazel/rust/BUILD.bazel` | Created | +4 |
| `bazel/rust/defs.bzl` | Created | +35 |
| `services/api-rs/BUILD.bazel` | Created | +60 |
| `services/api-rs/Cargo.toml` | Created | +26 |
| `services/api-rs/README.md` | Created | +37 |
| `services/api-rs/src/lib.rs` | Created | +195 |
| `services/api-rs/src/main.rs` | Created | +59 |
| `.github/workflows/ci.yml` | Updated | +13 |
| `.gitignore` | Updated | +4 |
| `AGENTS.md` | Updated | +3 |
| `README.md` | Updated | +17 / -1 |
| `docs/architecture.md` | Updated | +8 |
| `package.json` | Updated | +4 |

## Deviations from Plan

1. **Crate Universe repin command corrected for Bazel 9.** The plan originally
   used `CARGO_BAZEL_REPIN=1 bazel sync --only=crates`, following the upstream
   Crate Universe page. Bazel 9.2.0 has removed the `sync` command. The working
   equivalent is
   `CARGO_BAZEL_REPIN=1 bazel query //services/api-rs/...`, which evaluates and
   repins the module extension without compiling the service. The plan and
   service documentation were updated to the verified command.

No architecture, ownership, deployment, or feature-scope deviations were made.

## Issues Encountered

- The first Rust formatting gate reported deterministic rustfmt changes.
  `cargo fmt --all` applied them, after which only the affected Cargo and Bazel
  gates were rerun and passed.
- The pinned Rust and Bazel toolchains required first-run downloads. Both exact
  requested versions installed and passed validation.

## Tests Written

| Test File | Tests | Coverage |
|---|---:|---|
| `services/api-rs/src/lib.rs` | 7 | Default/valid/invalid port parsing, version fallback, exact health contract and headers, 404 behavior, concurrent requests |

## Next Steps

- [ ] Review the implementation with `/code-review`.
- [ ] Commit with `/prp-commit` after review.
- [ ] Create a pull request with `/prp-pr` when ready.
- [ ] Plan the first contract-fixture or pure-policy migration as a separate Rust phase.
