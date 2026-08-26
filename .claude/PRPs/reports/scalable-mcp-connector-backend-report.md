# Implementation Report: Scalable MCP Connector Backend with Gmail Pilot

## Summary

TroCode now has a backend-owned connector platform and a fail-closed Gmail
Developer Preview. Users can connect or disconnect Gmail from Settings, while
Electron main—not the renderer—opens the OAuth authorization URL. The hosted
Rust agent discovers a reviewed MCP snapshot, projects two deferred OpenAI
function namespaces plus hosted `tool_search`, evaluates every namespaced call
through Tro's existing policy, persists exact approvals, and executes the call
once from the backend.

The pilot exposes ten reviewed Gmail tools: five private reads and five
reversible draft/label operations. It intentionally exposes no send, delete,
trash, or arbitrary MCP endpoint capability. Gmail data remains untrusted,
prompt-injection-like content is withheld, credentials and MCP payloads are
encrypted, and ambiguous consequential dispatch is terminal and never retried.

## Assessment vs Reality

| Metric | Predicted | Actual |
|---|---:|---:|
| Complexity | XL | XL |
| Files changed | 38-46 | 46 paths before this report and plan archive |
| Delivery shape | Gmail pilot plus reusable backend | Gmail pilot plus catalog/schema/OAuth/executor extension seams |

## Tasks Completed

| # | Area | Status | Result |
|---:|---|---|---|
| 1 | Threat model and fixtures | Complete | Reviewed Gmail inventory, schema drift, token-AAD, action-digest, and prompt-injection fixtures/tests are committed. |
| 2 | Configuration, dependencies, crypto | Complete | Fail-closed connector rollout, exact `rmcp`/schema/HTTP dependencies, separate connector OAuth credentials, and versioned AES-GCM envelopes are implemented. |
| 3 | Persistence | Complete | Migration 027 adds OAuth attempts, connections, immutable snapshots, audit records, connector executor state, leases, and durable approval columns. |
| 4 | Verified catalog | Complete | Immutable Gmail endpoint/scope/namespaces/tool policies, local schemas, effect floors, and canonical policy digest are code owned. |
| 5 | MCP client and schemas | Complete | HTTPS Streamable HTTP only, no redirects, bounded discovery/calls, reviewed-tool intersection, JSON Schema validation, and unsupported-content rejection are implemented. |
| 6 | OAuth lifecycle | Complete | PKCE/state, one-time callback consumption, token validation/refresh lease, snapshot-before-connect, revocation, tombstone disconnect, and fixed callback HTML are implemented. |
| 7 | Desktop control plane | Complete | Narrow parsed IPC/preload APIs, authenticated main-process client, validated browser launch, polling, disconnect, and Settings states are wired. |
| 8 | OpenAI projection | Complete | Deferred `gmail_read` and `gmail_organize` namespaces, server `tool_search`, preserved tool-search items, and exact encrypted route resolution are implemented. |
| 9 | Policy normalization | Complete | Catalog-owned actions/effects, full private-argument digests, redacted presentations, sensitive-read approval, and draft/label intent grants are implemented. |
| 10 | Durable approval | Complete | Protocol v3 carries the exact action; decision commands bind interaction, digest, run version, client command ID, expiry, and invocation with CAS semantics. |
| 11 | Backend execution | Complete | Connector-only runs need no desktop worker; execution ownership is committed before network I/O; results/evidence are encrypted and unknown outcomes block replay. |
| 12 | Content trust | Complete | HTML/script normalization, Unicode handling, deterministic risk detection, provenance, safe withholding, and fixed non-content logs are implemented. |
| 13 | Gmail pilot behavior | Complete | Read/draft/label inventory and send exclusion are covered by deterministic contract and policy tests. |
| 14 | Operations and release | Complete | Kill switch, rollout, maintenance, rotation/revocation guidance, architecture/security docs, package, Cargo, and Bazel gates are complete. |

## Architecture Delivered

```text
Settings renderer
  -> parsed narrow DesktopApi
  -> Electron ConnectorClient
       -> authenticated Rust connector control plane
       -> validated system-browser OAuth launch

Rust AgentService
  -> user-scoped active connector snapshots
  -> OpenAI deferred namespaces + hosted tool_search
  -> exact encrypted route map
  -> catalog action normalization
  -> pure Tro policy / durable exact approval
  -> backend ConnectorService
       -> refresh lease -> reviewed MCP endpoint -> one call
       -> content guard -> encrypted result/evidence -> recovery
```

The reusable unit is a code-reviewed catalog definition plus local schemas,
effect policy, approval presentation, OAuth profile, and deterministic
compatibility fixtures. Adding another provider does not require new renderer
execution authority or a second agent loop.

## Security and Product Boundaries

- Runtime users cannot enter connector URLs, headers, scopes, or arbitrary MCP
  server definitions.
- The renderer never receives the OAuth authorization URL, access token,
  refresh token, PKCE verifier, raw OAuth state, endpoint, or route map.
- Connector OAuth is separate from Tro's Google identity client and requests
  only the Gmail modify scope needed by the reviewed pilot.
- Unknown remote tools and changed reviewed schemas are not model-executable.
- Private reads always require an exact approval; strict mode also approves
  mutations, while balanced mode can use an explicit draft/organize intent.
- Approval display may redact bodies, but the digest binds the original full
  arguments, connection, snapshot, tool, effect, and intent revision.
- MCP POSTs are never retried after uncertain completion. Stale executing
  actions become unknown and block the run.
- Gmail content never becomes system/developer authority. High-risk content is
  withheld and all other content remains explicitly untrusted.
- Activity/Attempt runs do not receive personal connector namespaces.
- Gmail sending, deletion, trash/archive, media/resource content, arbitrary
  connectors, and OpenAI-managed connector pass-through remain out of scope.

## Validation Results

| Check | Result |
|---|---|
| Protocol freshness, admin build, runtime versions, Rust-only engine | Pass |
| ESLint and TypeScript | Pass |
| Rust formatting and Clippy | Pass |
| Cargo audit | Pass with the repository's two allowed warnings: `ttf-parser` and `lru` |
| Vitest | Pass — 117 files, 734 tests after rebasing onto current `main` |
| Rust tests | Pass — 79 library tests plus contract/compatibility/property suites |
| PostgreSQL integration | Pass — migration idempotency/adoption, durable agent, provider budget, and HTTP compatibility under Bazel with PostgreSQL 17 |
| Electron Forge package | Pass — macOS arm64 package produced through the production Doppler environment |
| Bazel | Pass — 15/15 test targets and `//services/api:clippy` |
| Diff whitespace check | Pass |

The root `npm run check` passes end to end after rebasing onto current `main`.
During implementation it found issues in Rust visibility/inference, formatting,
and two regressions. The fixes ensure script-wrapped injection is inspected
before sanitization and distinguish “draft an email” from the noun in “delete
the draft.”

Database/S3 suites remain ignored under direct Cargo execution, as declared by
the repository tests. The exact PostgreSQL-backed Bazel CI commands pass against
a disposable PostgreSQL 17 instance; an S3-compatible integration service was
not configured. No live Gmail authorization or message access was performed
because test OAuth credentials and a dedicated Gmail account were unavailable
in this implementation environment.

## Deviations from Plan

1. The Gmail pilot uses Google's fixed, reviewed authorization/token/revocation
   endpoints and does not request OpenID identity scopes or persist an OIDC
   nonce. Tro identity is already established by the hosted session; adding
   identity claims to connector OAuth would broaden scope without improving MCP
   authorization.
2. The remote Gmail contract is not fetched during CI. Compatibility is checked
   against committed reviewed fixtures, and live discovery must pass the same
   fail-closed schema intersection before a connection becomes active.
3. The first live canary remains a release operation: connect, private-read
   approval, draft, label/unlabel, refresh, disconnect, and schema-drift
   observation with a dedicated test account and redacted logs.
4. The connector migration moved from planned version 026 to 027 while rebasing
   because current `main` already owns migration 026 for organization banners.

## Principal Files

| File/group | Purpose |
|---|---|
| `services/api/src/connectors/` | Catalog, schema boundary, MCP transport, OAuth, content guard, execution service, policy normalization |
| `services/api/migrations/027_mcp_connectors.sql` | Durable connector, snapshot, audit, approval, and executor state |
| `services/api/src/agent/service.rs` | Dynamic OpenAI namespace projection, route checkpoints, approvals, connector execution/recovery |
| `services/api/src/http/connectors.rs` | Exact callback and authenticated user-scoped control-plane routes |
| `src/main/connectors/connector-client.ts` | Safe main-process OAuth launch and connector API client |
| `src/renderer/SettingsPage.tsx` | Connected applications Developer Preview card |
| `src/shared/agent-runtime-protocol.ts` | Canonical v3 approval action and typed decision command |
| `docs/connectors.md` | Setup, rollout, extension, rotation, revocation, retention, incident, and canary guidance |

## Release Follow-up

- Configure a dedicated Google confidential web client and exact hosted callback.
- Start with the connector kill switch off, then enable a small canary cohort.
- Run the documented live Gmail smoke sequence with a non-production mailbox.
- Review schema-drift, OAuth, approval, content-risk, and unknown-outcome
  counters before increasing percentage rollout.
- Add the next connector by committing a new reviewed catalog manifest and
  fixtures; do not add runtime custom-server fields.
