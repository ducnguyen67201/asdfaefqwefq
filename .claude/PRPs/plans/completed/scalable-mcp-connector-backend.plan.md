# Plan: Scalable MCP Connector Backend with Gmail Pilot

## Summary

Add a user-scoped connector platform to Tro's hosted Rust backend, with the official Google Gmail remote MCP server as the first verified connector. OpenAI continues to choose tools through the Responses API, using deferred namespaced function tools and `tool_search`; Tro owns OAuth tokens, MCP transport, schema validation, effect classification, exact approvals, execution, encrypted results, and audit state.

This is intentionally a backend platform rather than a Gmail-specific integration. Adding a later verified application should normally require a reviewed catalog definition, OAuth profile, policy manifest, fixtures, and presentation metadata—not a new agent loop or a new trust model.

## User Story

As a signed-in Tro user, I want to connect applications such as Gmail and ask Tro to work with them, so that I can complete personal tasks through natural language while retaining control over private data and consequential actions.

## Problem → Solution

Tro currently offers only a fixed desktop-worker tool catalog and has no durable connector credentials or backend tool executor → Add a Rust-owned MCP connector broker that dynamically exposes only a user's connected and policy-reviewed tools to OpenAI, then intercepts and governs every call before executing it against the remote MCP server.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: N/A
- **Estimated Files**: 38-46 files
- **Recommended Delivery**: Five mergeable gates: foundation, connector control plane, MCP data plane, agent integration, Gmail pilot/UX rollout.
- **Initial Connector**: Google Gmail remote MCP (Developer Preview)
- **Primary Transport**: Remote Streamable HTTP only

---

## Product Boundary

### This plan builds

- A verified connector catalog owned by Tro code.
- Per-user connector connections and encrypted OAuth token storage.
- A fixed hosted OAuth callback with PKCE and horizontally safe database-backed attempts.
- A remote MCP client in the Rust API using the official Rust MCP SDK.
- Bounded and cached MCP `tools/list` snapshots.
- Dynamic OpenAI function namespaces backed by MCP tools.
- OpenAI `tool_search` and deferred tool loading so tool growth does not inflate every model turn.
- Backend execution through the existing durable run, checkpoint, policy, approval, evidence, and unknown-outcome lifecycle.
- A Settings card to connect, reconnect, and disconnect Gmail.
- Gmail search/read, draft, and label operations exposed by Google's current server.

### It does not build

- An arbitrary MCP URL input in the renderer.
- Local stdio MCP servers or child-process launching.
- User-uploaded OAuth client IDs/secrets.
- Organization-shared, teacher-owned, or classroom-inherited connections.
- MCP resources, prompts, sampling, elicitation, tasks, subscriptions, or app UI extensions.
- Background connector triggers, webhooks, scheduled inbox monitoring, or autonomous email processing.
- Gmail send through MCP; Google's current Gmail MCP surface creates drafts but does not send.
- A replacement for the existing Google identity sign-in flow.
- Direct OpenAI-managed connector pass-through in the first release.
- A public connector marketplace or third-party connector certification workflow.

### Education-specific boundary

- A connector belongs only to the authenticated `user_id`; a teacher, organizer, classroom directive, or knowledge-space membership cannot inherit it.
- Connector namespaces are omitted from Activity/Attempt-bound runs in this release. This prevents an assigned activity or teacher directive from causing access to a student's personal Gmail.
- A future classroom connector feature requires a separate participant opt-in and data-governance design.

---

## UX Design

### Before

~~~text
┌──────────────────────────────────────────────┐
│ Settings                                     │
│                                              │
│ Companion · Language · Voice · Updates       │
│                                              │
│ No connected applications                    │
└──────────────────────────────────────────────┘

User: "Find Ariel's latest email and draft a reply."
Tro:  Can only operate visible Gmail through desktop control.
~~~

### After

~~~text
┌──────────────────────────────────────────────┐
│ Settings                                     │
│                                              │
│ Connected applications                       │
│ ┌──────────────────────────────────────────┐ │
│ │ Gmail · Developer Preview                │ │
│ │ Search, read, draft, and organize mail.  │ │
│ │                         [Connect Gmail]  │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘

User: "Find Ariel's latest email and draft a reply."
Tro:  requests exact approval before private mail is sent to
      the model, searches Gmail, then creates a reviewable draft.
~~~

### Connection flow

~~~text
Settings/Connect
  -> narrow DesktopApi request
  -> Electron main creates authenticated OAuth attempt
  -> Electron opens the returned Google authorization URL
  -> Google redirects to fixed hosted HTTPS callback
  -> Rust validates state + issuer + PKCE and exchanges once
  -> Rust encrypts tokens, discovers Gmail tools, stores snapshot
  -> Settings polls safe attempt status and shows Connected
~~~

### Agent call flow

~~~text
User request
  -> Rust loads active user connector namespaces
  -> Responses receives namespace descriptions + deferred functions
  -> OpenAI tool_search loads the relevant Gmail functions
  -> model emits a normal function_call
  -> Rust resolves namespace/name against encrypted pinned route map
  -> JSON Schema validation + connector policy + exact approval
  -> one MCP tools/call dispatch through rmcp
  -> bounded untrusted result becomes encrypted function_call_output
  -> model summarizes or proposes the next governed action
~~~

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Settings | No application connections | Connected applications card | Renderer sees status and labels, never OAuth tokens or client secrets |
| OAuth | Google identity sign-in only | Separate connector authorization | Do not expand the existing `openid email profile` sign-in token |
| Tool selection | 13 fixed desktop tools gated by worker capability | Fixed desktop tools plus per-user connector namespaces | Connector tools are independent of desktop-worker availability |
| Large tool inventory | Every offered function schema is in every request | Namespaces contain deferred tools and Responses `tool_search` loads a subset | Split namespaces to fewer than ten functions |
| Private connector reads | Not available | Exact approval before private connector content enters the model | Installation consent is not action approval |
| Gmail writes | Visible CUA only | Create draft and label/unlabel via MCP | No MCP send tool exists |
| Approval | Desktop-local approval wait | Rust-owned durable approval wait for connector actions | Existing approval card is reused after v3 projection is completed |
| Failure | Desktop result or CUA uncertainty | Connector errors are bounded; ambiguous consequential calls become unknown | Never retry an ambiguous MCP POST |
| Classroom tasks | No connector | Still no connector | Personal accounts never flow into assigned Activities by default |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---:|---|
| P0 | `docs/architecture.md` | 5-24, 42-85, 87-97 | One Rust backend, protocol-digest boundary, model/host split, and exactly-once execution invariants |
| P0 | `docs/security.md` | 65-85, 103-125 | Tool calls are proposals; hard-confirm effects; private data and logging rules |
| P0 | `services/api/src/agent/service.rs` | 369-430, 592-689, 1384-1420, 1611-1945, 2625-2691 | Projection, incomplete approval control, worker-only claim path, model loop, fixed call resolution, and tool emission |
| P0 | `services/api/src/agent/policy.rs` | 368-483, 1208-1264 | Pure effect raising, exact approval, and intent authorization |
| P0 | `services/api/src/agent/tool_catalog.rs` | 8-75, 82-193 | Generated fixed tool catalog and effect/operation resolution |
| P0 | `services/api/migrations/014_agent_runtime.sql` | 1-180 | Durable runs, events, checkpoints, invocations, evidence, and worker sessions |
| P0 | `services/api/migrations/025_agent_runtime_contract_v3.sql` | all | Current v3 state, permission wait, failure, and invocation constraints |
| P0 | `src/shared/agent-runtime-protocol.ts` | 150-240 | Action effects, durable `waitingOn`, and approval projection gap |
| P0 | `src/shared/contracts.ts` | 40-142, 1012-1052, 1102-1125 | Connector capabilities, effect vocabulary, approval action, and TaskSnapshot |
| P0 | `src/main/application/hosted-task-client.ts` | 21-87, 169-229, 352-470 | v3-to-renderer projection, authenticated client requests, event replay, and approval endpoint |
| P0 | `src/main/hosted/desktop-tool-worker.ts` | 130-225 | Current device-side policy/approval/execution sequence to preserve for desktop tools |
| P1 | `services/api/src/auth/crypto.rs` | 153-262 | Versioned AES-256-GCM JSON envelopes and metadata-bound AAD |
| P1 | `services/api/src/config.rs` | 1-140 and environment parsers | Fail-closed configuration, feature flags, canaries, key rings, and limits |
| P1 | `services/api/src/app.rs` | 1-115 | Shared HTTP client and service composition |
| P1 | `services/api/src/http/mod.rs` | 1-100 | Manual route dispatcher, browser-origin denial, and bounded JSON helpers |
| P1 | `services/api/src/http/organization.rs` | 18-136 | Authenticated handler, rate limiting, strict inputs, and response style |
| P1 | `services/api/src/providers/responses.rs` | 21-43, 83-190 | Provider request boundary, timeouts, response bounds, cost reservation, and ambiguous dispatch handling |
| P1 | `services/api/src/error.rs` | 9-141 | Stable public error codes with private internal causes |
| P1 | `services/api/src/db.rs` | 1-138 | Explicit migration registration; migration files are not auto-discovered |
| P1 | `src/main/auth/google-auth-service.ts` | 150-235 | Existing identity OAuth is online-only and uses only identity scopes |
| P1 | `src/main/agent/action-approval.ts` | 1-40 | Exact canonical action digest including tool, operation, effect, and parameters |
| P1 | `src/renderer/App.tsx` | 787-844, 1854-1890, 2538-2595 | Existing exact approval UI/decision path and Settings composition |
| P1 | `src/renderer/SettingsPage.tsx` | 1-180 and remaining cards | Settings component conventions and translated copy |
| P1 | `src/shared/desktop-api.ts` | 180-330 | Narrow renderer bridge contract |
| P1 | `src/preload.ts` | 480-520 and IPC method implementations | Parse both request and response at preload boundary |
| P1 | `src/main/ipc/register-ipc.ts` | 235-290, 330-360 | Trusted-frame IPC handler registration |
| P1 | `scripts/generate-agent-runtime-contract.mts` | all | Canonical schema, tool catalog, manifest, digests, and fixture generation |
| P1 | `services/api/tests/agent_runtime_compat.rs` | 1-190 and run tests | Disposable PostgreSQL, Wiremock provider, encrypted agent integration pattern |
| P1 | `services/api/tests/google_auth_compat.rs` | 1-145 | Wiremock OAuth/JWT compatibility testing pattern |
| P1 | `services/api/BUILD.bazel` | 1-180 | Rust library data, generated contract data, and integration-test registration |
| P2 | `README.md` | 103-117, 631-636 | Current connector limitation and host-owned tool authority claim |
| P2 | `services/api/Cargo.toml` | all | Rust dependency and test dependency declarations |
| P2 | `Cargo.toml`, `MODULE.bazel` | all | Workspace MSRV and Bazel crate-universe generation from Cargo manifests |

The repository supplement references `docs/CODEX-NAVIGATION-GUIDE.md`, but that file is absent in this checkout. The plan uses the checked-in architecture and security documents as the authoritative navigation baseline.

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| OpenAI MCP/connectors | [OpenAI MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) | Responses can call managed connectors or public remote MCP servers, supports tool filtering and approvals, and warns that private data/prompt injection require explicit controls |
| OpenAI tool growth | [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search) | GPT-5.4+ can load deferred functions at runtime; namespaces should be small and clear; hosted search is appropriate when the candidate inventory is known |
| MCP authorization | [MCP Authorization 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) | Use PKCE, scope minimization, validated metadata/issuer binding, and protected-resource discovery; state must be bound to the attempt |
| MCP tools | [MCP Tools 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) | Tool input is JSON Schema; tool names collide across servers; annotations are untrusted unless the server is trusted; clients should validate structured output |
| Official Rust SDK | [modelcontextprotocol/rust-sdk](https://github.com/modelcontextprotocol/rust-sdk) and [3.0.1 release](https://github.com/modelcontextprotocol/rust-sdk/releases/tag/rmcp-v3.0.1) | `rmcp` 3.0.1 supports MCP 2026-07-28, Streamable HTTP, pagination helpers, version negotiation, JSON/SSE responses, and does not retry uncertain recovery POSTs |
| Rust JSON Schema validation | [jsonschema 0.50.0](https://docs.rs/crate/jsonschema/0.50.0) | Provides Draft 2020-12 validation; disable external resolution and apply Tro's own schema/resource limits |
| Gmail MCP setup | [Configure Gmail MCP](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server) | Gmail MCP is Developer Preview, requires Gmail API plus Gmail MCP API, and needs `gmail.readonly` and `gmail.compose` scopes |
| Gmail MCP tools | [Gmail MCP Reference](https://developers.google.com/workspace/gmail/api/reference/mcp) | Current endpoint is `https://gmailmcp.googleapis.com/mcp/v1`; it exposes ten read/draft/label tools and no send tool |
| Gmail scopes | [Choose Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) | Request the narrowest scopes and complete Google verification before a public external release |

### Research findings

`KEY_INSIGHT`: OpenAI-managed connectors are hosted product wrappers, not an open-source Gmail connector to vendor. The official Google Gmail MCP server is the standards-based remote endpoint for Tro's own MCP host.

`APPLIES_TO`: Connector source choice and OAuth ownership.

`GOTCHA`: Do not describe OpenAI's managed Gmail connector as open source or assume its permissions equal Google's Gmail MCP surface.

`KEY_INSIGHT`: Native Responses `type: "mcp"` is the shortest integration, but OpenAI then receives the server authorization token and performs the remote call.

`APPLIES_TO`: Architecture alternative decision.

`GOTCHA`: That bypasses Tro's current invocation executor, durable approval, outcome, and token-residency model; do not use it in this release.

`KEY_INSIGHT`: Deferred namespaced functions plus hosted `tool_search` preserve Tro execution while using OpenAI's scalable discovery path.

`APPLIES_TO`: Dynamic tool projection.

`GOTCHA`: Namespaces should remain under ten functions; split Gmail into `gmail_read` and `gmail_organize` rather than one ten-function namespace.

`KEY_INSIGHT`: MCP tool annotations are hints, not authorization.

`APPLIES_TO`: Effect policy.

`GOTCHA`: A remote server may raise risk, but it may never lower Tro's catalog-owned effect or approval requirement.

`KEY_INSIGHT`: Google's Gmail MCP server is Developer Preview and explicitly calls out indirect prompt injection.

`APPLIES_TO`: Canary rollout, content guard, and release gates.

`GOTCHA`: Keep Gmail disabled outside canary users until OAuth verification, tool-contract fixtures, and prompt-injection evaluations pass.

---

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Evidence |
|---|---|---|---|
| Similar implementation | `services/api/src/agent/service.rs:1871-1945` | Resolve function call, validate, classify effect, encrypt request/checkpoint, create invocation, release lease | Connector calls should enter the same durable invocation graph, with a different executor |
| Naming | `services/api/src/app.rs:17-39` | PascalCase service structs, snake_case modules, verb methods | `ResponsesService`, `KnowledgeService`, `ClassroomService` |
| Error handling | `services/api/src/error.rs:31-91` | Fixed public message/code, private `anyhow` source | Provider bodies and token errors must not reach the client |
| Logging | `services/api/src/providers/responses.rs:67-79` | `tracing` with fixed event names and IDs | Log connector key/tool/status/duration, never args, results, codes, or tokens |
| Type definitions | `src/shared/agent-runtime-protocol.ts:188-225` | Strict Zod schemas generate canonical JSON Schema and Rust Typify types | Add approval action to v3 at the source and regenerate artifacts |
| Test pattern | `services/api/tests/agent_runtime_compat.rs:26-83` | Wiremock responder inspects exact provider JSON and returns deterministic output | Add namespace/tool-search/function-call sequences and MCP mock responses |
| Configuration | `services/api/src/config.rs:1-140` | Typed config, fail-closed secret validation, feature/canary rollout | Add a dedicated ConnectorConfig and token key ring |
| Dependencies | `services/api/Cargo.toml:1-70`, `MODULE.bazel:17-28` | Cargo is canonical; Bazel crate universe reads Cargo.toml/Cargo.lock | Add pinned `rmcp` and `jsonschema`, update lock, run Bazel checks |
| Entry point trace | `SettingsPage.tsx` → `DesktopApi` → `preload.ts` → `register-ipc.ts` → connector HTTP client → `/v1/connectors/*` | Narrow renderer IPC, authenticated main-process HTTP | OAuth URL is opened in Electron main, not returned to renderer state |
| Data-flow trace | `service.rs:1704-1808` → `ResponsesService` → function call → `interrupt` | Model proposes one function call per turn | Dynamic names resolve only through a pinned per-run connector route map |
| State trace | `014_agent_runtime.sql`, `025_agent_runtime_contract_v3.sql` | PostgreSQL run/invocation state plus encrypted envelopes and CAS transitions | OAuth attempts, tokens, tool snapshots, approval waits, and execution receipts must be durable |
| Contract trace | `scripts/generate-agent-runtime-contract.mts:1-150` | Zod source → closed schema/catalog → two digests → manifest/fixtures | Approval projection changes require regenerated committed artifacts and both-client/server upgrade |
| Architecture trace | `docs/architecture.md:68-85` | Host chooses, approves, executes once, and blocks unknown consequential outcomes | MCP is an execution capability; it grants no authority by being connected |

---

## Patterns to Mirror

### RUST_SERVICE_COMPOSITION

SOURCE: `services/api/src/app.rs:42-68`

~~~rust
let client = reqwest::Client::builder()
    .redirect(reqwest::redirect::Policy::none())
    .build()
    .map_err(ApiError::internal)?;
let budget = BudgetService::new(pool.clone(), config.cost_guard.clone());
let responses =
    ResponsesService::new(budget.clone(), client.clone(), &config.openai_api_key);
~~~

Construct ConnectorService once in `AppState::compose`, inject the shared pool and a separately configured HTTP client, and keep redirects disabled. The connector transport must enforce fixed verified origins even though the first catalog contains only Google.

### VERSIONED_ENCRYPTED_ENVELOPE

SOURCE: `services/api/src/auth/crypto.rs:208-230`

~~~rust
pub fn encrypt_json(&self, value: &Value, metadata: &Value) -> ApiResult<AgentEnvelope> {
    let key = self.keys.get(&self.current_version).expect("validated");
    let mut iv = [0_u8; IV_BYTES];
    rand::rng().fill_bytes(&mut iv);
    let aad = stable_json(metadata)?;
    let message = serde_json::to_vec(value).map_err(ApiError::internal)?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(ApiError::internal)?;
    // AES-GCM encrypts with stable metadata as AAD.
}
~~~

Extract a generic internal versioned JSON envelope primitive or create a ConnectorTokenCrypto wrapper with connector-specific public errors and AAD. Token AAD must include `kind`, `connectionId` or `attemptId`, `userId`, and `schemaVersion`; an envelope cannot be moved to another user or row.

### STRICT_AUTHENTICATED_HANDLER

SOURCE: `services/api/src/http/organization.rs:87-136`

~~~rust
if !matches(path) {
    return Ok(None);
}
let session = core::session(state, headers).await?;
core::access(state, &session).await?;
let user_id = &session.user.id;
let input = read_json(headers, body, 4_096)?;
~~~

All `/v1/connectors/*` routes except the exact OAuth callback require the Tro session. Validate object keys exactly, bound bodies, and derive ownership from the session rather than request input.

### PUBLIC_ERROR_PRIVATE_CAUSE

SOURCE: `services/api/src/error.rs:43-91`

~~~rust
pub const fn coded(status: StatusCode, code: &'static str, message: &'static str) -> Self {
    Self {
        status,
        code: Some(code),
        message,
        retry_after_seconds: None,
        source: None,
    }
}

pub fn internal(error: impl Into<anyhow::Error>) -> Self {
    Self {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        code: None,
        message: "An internal error occurred.",
        retry_after_seconds: None,
        source: Some(error.into()),
    }
}
~~~

Return stable connector codes such as `connector_not_available`, `connector_reauthorization_required`, `connector_contract_changed`, `connector_approval_stale`, and `connector_outcome_unknown`. Never return provider descriptions containing tokens or private mail.

### EXACT_ACTION_DIGEST

SOURCE: `src/main/agent/action-approval.ts:20-39`

~~~ts
const normalizedAction = {
  action: action.action,
  operation: identity.operation,
  toolId: identity.toolId,
  description: action.description,
  effect: action.effect ?? null,
  intentRevision,
  parameters: normalizeParameters(action.parameters),
  target: action.target ?? null,
};

return createHash('sha256')
  .update(JSON.stringify(normalizedAction))
  .digest('hex');
~~~

Implement the canonical equivalent in Rust and prove it against shared fixtures. The connector digest must cover connection ID, tool snapshot digest, MCP tool name, canonical full argument JSON, normalized effect, intent revision, target, and expiry-independent presentation. Approval display may redact fields, but the digest may not omit any dispatch-relevant argument.

### PURE_POLICY_THEN_EFFECT

SOURCE: `services/api/src/agent/policy.rs:368-445`

~~~rust
let host_effect = resolve_action_effect(&input.action)?;
let mut proposed_action = input.action.clone();
proposed_action.effect = Some(input.proposed_effect);
let proposed_effect = resolve_action_effect(&proposed_action)?;
let effect = raise_action_effect(host_effect, proposed_effect);

if is_sensitive(&input.goal, &input.action, &effect) {
    return Ok(decision(
        "needs_approval",
        effect,
        "none",
        true,
        consequential,
        /* bounded summary */,
        &["Present a scoped approval request to the user."],
    ));
}
~~~

Catalog policy provides the minimum connector effect. Server annotations and argument facts can raise it. They can never convert a catalog write into a read or turn `sensitive_transfer` into `none`.

### AMBIGUOUS_DISPATCH_NO_RETRY

SOURCE: `services/api/src/providers/responses.rs:139-157`

~~~rust
let result = tokio::time::timeout(Duration::from_secs(60), request.send()).await;
let response = match result {
    Ok(Ok(response)) => response,
    Ok(Err(_)) | Err(_) => {
        self.budget.mark_uncertain(input.user_id, input.request_id).await?;
        return Err(ApiError::coded(
            StatusCode::BAD_GATEWAY,
            "ambiguous_dispatch",
            "The model provider is temporarily unavailable. This call was not retried.",
        ));
    }
};
~~~

Once `tools/call` begins its Streamable HTTP POST, a timeout, connection loss, cancellation, or malformed response can mean the server acted. Mark a consequential invocation `unknown`, block the run, and do not retry. A pre-dispatch validation/token-refresh failure is safe to fail without `unknown`.

### CANONICAL_PROTOCOL_GENERATION

SOURCE: `scripts/generate-agent-runtime-contract.mts:55-91`

~~~ts
const schema = z.toJSONSchema(AgentRuntimeProtocolDocumentV3Schema, {
  target: 'draft-2020-12',
  unrepresentable: 'throw',
  cycles: 'ref',
  reused: 'inline',
  io: 'input',
});

const protocolDigest = digest(schemaContent);
const toolCatalogDigest = digest(toolCatalogContent);
~~~

Change the Zod source first, regenerate schema/manifest/fixtures, and allow existing digest negotiation to force synchronized desktop/API upgrades. Dynamic connector inventories do not enter the static desktop tool-catalog digest; their per-connection snapshot digest is pinned inside encrypted run state.

### WIREMOCK_INTEGRATION_TEST

SOURCE: `services/api/tests/agent_runtime_compat.rs:31-82`

~~~rust
impl Respond for AgentResponder {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        let body: Value =
            serde_json::from_slice(&request.body).expect("agent provider request JSON");
        ResponseTemplate::new(200)
            .insert_header("content-type", "application/json")
            .set_body_json(json!({ /* deterministic output */ }))
    }
}
~~~

Use independent Wiremock servers for OAuth, MCP, and Responses. Assert exact paths, authorization headers without logging their values, tool-search namespace shape, one `tools/call`, and no second call after ambiguity.

### NARROW_PRELOAD_BOUNDARY

SOURCE: `src/main/auth/google-auth-service.ts:187-203` and `src/shared/desktop-api.ts:207-230`

~~~ts
const hostedSession = await this.exchangeHostedSession(tokens.idToken);
await this.options.sessionStore.write({
  accessToken: hostedSession.accessToken,
  accessTokenExpiresAt: hostedSession.expiresAt,
  signedInAt: new Date().toISOString(),
  user: hostedSession.user,
});
~~~

The connector client lives in Electron main and uses the existing Tro session provider. Preload exposes list/begin/status/disconnect functions with Zod parsing. Electron main opens the OAuth URL; renderer state never receives OAuth tokens, client secrets, code verifiers, or raw callback data.

---

## Strategic Design

### Chosen architecture: Tro-owned MCP broker

~~~text
                       tool definitions only
Rust AgentService ───────────────────────────────> OpenAI Responses
       │                                               │
       │ route + args                                  │ function_call
       └───────────────────────────────────────────────┘
       │
       ├─ validate snapshot schema
       ├─ normalize effect and action
       ├─ evaluate intent/exact approval
       ├─ CAS invocation to executing once
       ▼
ConnectorBroker ── bearer token ──> verified remote MCP server
       │
       └─ bounded, guarded, encrypted result ──> function_call_output
~~~

The model decides whether a connector tool is useful. It does not receive the connector access token, choose a server URL, decide an effect, approve an action, or call the server directly.

### Why not native Responses MCP in v1

Native Responses MCP is a valid future optimization, but today it would:

- Put the remote MCP access token in the OpenAI request.
- Let the provider perform the remote call outside `agent_tool_invocations` execution CAS.
- Introduce `mcp_list_tools`, `mcp_call`, and provider approval items that the current loop does not parse or project.
- Duplicate or bypass Tro's catalog-owned effect mapping and durable exact approval.
- Make ambiguous remote outcomes and receipts harder to reconcile with Tro's evidence model.

Revisit native MCP only after a design proves equivalent token residency, exact action binding, execution receipts, cancellation, unknown-outcome handling, and audit semantics.

### Connector catalog

Create an immutable in-code catalog with definitions shaped conceptually as:

~~~rust
pub struct ConnectorDefinition {
    pub key: &'static str,
    pub display_name: &'static str,
    pub description: &'static str,
    pub maturity: ConnectorMaturity,
    pub server_url: &'static str,
    pub oauth: OAuthProfile,
    pub namespaces: &'static [ConnectorNamespace],
    pub tools: &'static [ConnectorToolPolicy],
}

pub struct ConnectorToolPolicy {
    pub mcp_name: &'static str,
    pub operation: &'static str,
    pub minimum_effect: ActionEffect,
    pub argument_contract_digest: &'static str,
    pub approval_presentation: &'static [ApprovalField],
    pub result_policy: ConnectorResultPolicy,
}
~~~

These are design types, not code to copy blindly. Follow existing Rust naming and serde patterns.

Catalog rules:

- Catalog keys and server URLs are code-reviewed and immutable at runtime.
- Connection rows store `catalog_key`, never an arbitrary execution URL.
- Unknown tools discovered from a verified server are stored for diagnostics but never exposed to the model.
- A known tool whose reviewed argument-contract digest changes is disabled as `contract_changed` until reviewed.
- Tool annotations may raise risk but never lower `minimum_effect`.
- Namespace names are stable, non-sensitive, and disambiguated by a short opaque connection alias.
- Gmail is split into two namespaces with five functions each:
  - `gmail_read`: `get_message`, `get_thread`, `list_drafts`, `list_labels`, `search_threads`
  - `gmail_organize`: `create_draft`, `label_message`, `label_thread`, `unlabel_message`, `unlabel_thread`

### Dynamic OpenAI tool projection

For active personal runs with connected apps:

1. Load the active tool snapshot for each eligible user connection.
2. Intersect snapshot tools with the reviewed catalog policy.
3. Build namespace descriptions and functions with `defer_loading: true`.
4. Set `strict: false` because remote MCP JSON Schemas are not guaranteed to satisfy OpenAI strict-function rules.
5. Add `{"type":"tool_search"}` for GPT-5.4+ when at least one connector namespace exists.
6. Keep `parallel_tool_calls: false`.
7. Persist a canonical encrypted route map with namespace, model name, connection ID, MCP name, snapshot digest, schema digest, and policy digest.
8. When output contains hosted `tool_search_call`/`tool_search_output`, retain those bounded items in the checkpoint before the eventual `function_call` so subsequent turns preserve the loaded set and cache.
9. Resolve connector calls by both namespace and function name through the pinned map. Never parse a connection ID from model text or accept a function absent from the map.

Limits for the first release:

- Maximum 8 active connector connections per user.
- Maximum 100 discovered tools per connection and 10 functions per namespace.
- Maximum 16 connector namespaces and 80 connector functions in one Responses request.
- Maximum 32 KiB input schema per tool, 12 nesting levels, 100 object properties, and 64 KiB combined descriptions per run.
- Maximum 15 connector calls per run, in addition to the existing overall model-turn bound.
- If a catalog exceeds these limits, the connector remains connected but the excess tools are not advertised; log fixed counts only.

When per-user inventories exceed these limits, the next architecture step is OpenAI client-executed `tool_search` backed by Tro's catalog index. Do not implement that advanced injection path until the hosted namespace limits are measured in production.

### MCP schema and result handling

- Pin `rmcp = 3.0.1` with client and `transport-streamable-http-client-reqwest` features.
- Pin `jsonschema = 0.50.0` with external/file resolution disabled.
- Prefer `ClientLifecycleMode::Auto` with MCP 2026-07-28 and the SDK-supported legacy fallback.
- Use Streamable HTTP only; accept JSON or SSE through rmcp.
- Use `list_all_tools` once after authorization and on snapshot refresh; never list on every model turn.
- Reject external `$ref`/`$dynamicRef`, all `x-mcp-header` in v1, malformed schemas, non-object input roots, and schemas beyond limits.
- Compile and validate the stored schema before every `tools/call`.
- Verify output schema when present.
- Accept bounded text and structured content only for Gmail v1. Reject/omit image, audio, blob, embedded resource, and resource-link content.
- Strip active HTML, CSS-hidden content, scripts, data URLs, remote images, and control characters before model context.
- Cap normalized connector result at 256 KiB and model-facing text at 64 KiB; return a bounded truncation notice.
- Wrap output as untrusted external data with provenance `{catalogKey, toolName, invocationId, snapshotDigest}`. Do not let result content enter developer/system instructions.

### Gmail effect policy

| Tool | Minimum effect | Balanced mode | Strict mode | Evidence |
|---|---|---|---|---|
| `search_threads`, `get_message`, `get_thread`, `list_drafts`, `list_labels` | `sensitive_transfer`, private email/resource, no mutation | Exact approval for the concrete query/ID before private result enters the model | Exact approval | Successful verified-server result supports read provenance, not a mutation |
| `create_draft` | `create_resource`, `email`, cloud-private, draft communication, reversible | User-intent grant may authorize when the request explicitly asks for a draft; otherwise exact approval | Exact approval | Successful result supports draft creation |
| `label_*`, `unlabel_*` | `update_resource`, `email`, cloud-private, reversible | User-intent grant may authorize an explicit organize request; otherwise exact approval | Exact approval | Successful result supports label update |

No Gmail tool is mapped to `send_communication`. If Google later adds send/delete/archive tools, they remain unavailable until a reviewed policy and approval presentation are committed.

### OAuth control plane

Use a distinct connector OAuth flow rather than modifying Tro identity sign-in:

- For each verified connector, follow MCP protected-resource and authorization-server metadata discovery. Validate every discovered URL and issuer against catalog-pinned HTTPS origins before using it; discovery may narrow a reviewed endpoint but may not redirect Tro to an arbitrary authorization or token host.
- `POST /v1/connectors/{catalogKey}/oauth-attempts` requires a Tro session, rate limits by user and IP, creates PKCE/state/nonce, stores only an HMAC digest of state plus encrypted verifier/nonce, and returns a safe attempt ID plus authorization URL to Electron main.
- Electron main opens the URL with `shell.openExternal`; it returns only safe status to the renderer.
- `GET /v1/connectors/oauth/callback` is the only unauthenticated/browser-origin connector route. It accepts only bounded `code`, `state`, `iss`, and OAuth error fields.
- Callback lookup hashes state, atomically consumes one live attempt, verifies the recorded issuer rules, exchanges the code once, verifies granted scopes, encrypts tokens, discovers tools, then shows a fixed CSP-protected success/error HTML page.
- `GET /v1/connectors/oauth-attempts/{id}` is authenticated and user-owned; Settings polls it with bounded backoff.
- Token refresh uses a database lease so two API replicas do not spend the same rotating refresh token. A failed refresh marks `reauthorization_required` without deleting the encrypted prior envelope.
- Disconnect tombstones the local connection first and makes it unusable; provider revocation is best-effort and never restores a tombstoned connection.
- OAuth attempts expire after ten minutes and are purged by maintenance.

Gmail production prerequisites outside code:

- Enable Gmail API and Gmail MCP API in the Tro Google Cloud project.
- Configure a separate Web OAuth client with the exact hosted callback URL.
- Request `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.compose` only.
- Complete Google external-app verification and the required prompt-injection/security review before broad rollout.

### Persistence

Add `026_mcp_connectors.sql` and register it explicitly in `services/api/src/db.rs`.

Tables and columns:

1. `connector_connections`
   - `id`, `user_id`, `catalog_key`, opaque `connection_alias`
   - `status`: `pending`, `connected`, `reauthorization_required`, `contract_changed`, `revoked`, `error`
   - encrypted credential/account envelope columns and `token_expires_at`
   - granted scopes JSON, active snapshot digest, refresh lease owner/expiry
   - created/updated/last_used/revoked timestamps
   - indexes by user/status and a bounded uniqueness rule for alias
2. `connector_oauth_attempts`
   - attempt/user/catalog IDs, state digest, encrypted PKCE/nonce envelope
   - status, exact redirect URI, recorded issuer, connection ID, expiry/consumed timestamps
   - unique state digest and user/attempt lookup
3. `connector_tool_snapshots`
   - connection ID, snapshot digest, negotiated protocol version, bounded canonical tool JSON
   - catalog policy digest, discovered/refreshed/valid-until timestamps, active flag
   - unique connection/digest; one active snapshot per connection
4. `connector_audit_events`
   - user/connection/run/invocation IDs where applicable
   - fixed event type, result code, tool name, duration bucket, timestamp
   - no arguments, results, email addresses, OAuth codes, state, or tokens
5. Extend `agent_tool_invocations`
   - `executor_kind` constrained to `desktop|connector`
   - nullable `connector_connection_id`, `connector_snapshot_digest`
   - approval interaction/digest/expiry and approved/denied timestamps
   - constraints tying connector columns to executor kind
6. Extend `agent_runs`
   - durable approval interaction/invocation/digest/action envelope/expiry columns
   - a check requiring all approval columns exactly when state is `awaiting_approval`

Sensitive envelopes use the connector key ring for OAuth attempts/tokens/account labels and the existing agent-state key ring for run/invocation/approval payloads. Do not put access or refresh tokens in `agent_tool_invocations`.

### Durable connector approval

Complete the currently partial v3 approval state:

1. Add a strict bounded `ApprovalActionV3` object to `WaitingOnV3Schema.approval` with action/effect/tool/operation/target/presentation parameters.
2. Project approval columns in `AgentService::project_v3_run`.
3. Update the v3 task projection in `HostedTaskClient` to construct `pendingInteraction` from `waitingOn.approval` instead of preserving stale local state.
4. Add a v3 approval command containing protocol/digests, `clientCommandId`, `expectedRunVersion`, interaction ID, action digest, and decision.
5. Lock run plus invocation; require exact ownership, state, version, interaction, digest, and unexpired timestamp.
6. Approve by recording one-use approval and moving the same run to recovery. Deny by committing a `function_call_output` with `denied` and recovering the model.
7. Consume approval only in the CAS that transitions the connector invocation to `executing`.
8. Clear all wait columns on deny, cancel, expiry, execution, or terminal transition.

The existing renderer approval card can render the projected action. Spoken/typed “yes” remains unable to approve.

### Backend execution state machine

Refactor `AgentService` so worker availability is optional during planning:

- Desktop tools are included only when a compatible worker capability snapshot is present.
- Connector tools are included from user connections independently of a worker.
- A connector-only run can plan and execute with no desktop worker.
- Only desktop invocations enter `awaiting_worker` and appear in desktop worker event streams.
- A pending connector invocation is handled by the backend executor according to `requested`, `awaiting_approval`, `executing`, or terminal state.

Connector dispatch sequence:

1. Resolve pinned route and schema.
2. Recheck user ownership, connection state, snapshot digest, token expiry, and catalog policy digest.
3. Validate arguments and normalize the full ProposedAction/effect.
4. Evaluate pure Rust policy.
5. If denied, commit a denied output.
6. If approval is needed, persist `awaiting_approval` and release the run lease.
7. If allowed/approved, atomically move invocation and run to `executing` and commit before network dispatch.
8. Refresh token before the call if necessary; a pre-dispatch refresh failure does not make the tool outcome unknown.
9. Dispatch exactly one `tools/call` with cancellation and timeout.
10. Commit confirmed/failed/unknown result and connector audit metadata.
11. Append one encrypted `function_call_output` and recover the same run.

For any ambiguous post-dispatch outcome:

- Consequential invocation → `unknown`, required evidence `unknown`, terminal run `blocked`, no retry.
- Effect-free non-mutating invocation → `failed`, bounded retry suggestion to the user, but the agent does not automatically replay the call.

### Prompt-injection and content guard

Implement defense in depth rather than trusting email text:

- Treat all MCP output as untrusted external content.
- Convert Gmail HTML to normalized plain text; remove hidden/active elements and remote references.
- Add a deterministic `ConnectorContentGuard` for instruction-override/system impersonation/tool-use requests, hidden content, encoded payload blocks, and credential-exfiltration patterns.
- When high risk is detected, withhold the risky content from model context and return a safe notice with provenance; do not silently continue.
- Untrusted output cannot alter tool catalogs, route maps, policy effects, approval state, system instructions, or intent grants.
- Every later action is independently revalidated even when an email tells Tro to call another tool.
- Add a Gmail prompt-injection corpus covering plain text, HTML, zero-width characters, quoted/replied chains, base64-like blocks, and multilingual attacks.

The deterministic guard is not proof that content is safe. The host-owned catalog and exact action policy remain the primary control. Broad Gmail release is blocked until the documented corpus passes and security review accepts the residual risk.

### Rollout

Use `ConnectorConfig` with:

- `enabled`
- `canary_users`
- `rollout_percent`
- dedicated encryption key ring/current version
- public OAuth callback URL
- verified Gmail OAuth client ID/secret
- connection/tool/schema/result/call limits
- OAuth/MCP/token-refresh timeouts

Rollout gates:

1. **Observe**: migrations, catalog, OAuth, snapshots, no model advertising.
2. **Canary read**: Gmail read namespace for named users, exact approval on each read.
3. **Canary organize**: drafts/labels after contract and injection evals pass.
4. **Percentage rollout**: verified Google OAuth app only; monitor fixed error/latency counts.
5. **General availability**: remove Developer Preview label only when Google changes the product status and Tro re-reviews contracts.

Kill switch behavior: stop advertising tools and block new calls; do not delete connections or token envelopes. Users can still disconnect.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `services/api/migrations/026_mcp_connectors.sql` | CREATE | Connector control-plane tables and agent invocation/approval extensions |
| `services/api/src/connectors/mod.rs` | CREATE | ConnectorService, repository boundary, public DTOs, and maintenance |
| `services/api/src/connectors/catalog.rs` | CREATE | Immutable verified connector/tool/effect catalog with Gmail pilot |
| `services/api/src/connectors/oauth.rs` | CREATE | PKCE attempts, callback exchange, token refresh lease, and revocation |
| `services/api/src/connectors/mcp.rs` | CREATE | rmcp client factory, tools/list snapshot, tools/call, and result normalization |
| `services/api/src/connectors/schema.rs` | CREATE | Schema bounds, canonical digests, external-ref rejection, and jsonschema validation |
| `services/api/src/connectors/content_guard.rs` | CREATE | Gmail text normalization and injection-risk screening |
| `services/api/src/http/connectors.rs` | CREATE | Authenticated connector API plus exact public OAuth callback |
| `services/api/tests/connectors_compat.rs` | CREATE | OAuth/MCP/Responses/PostgreSQL end-to-end compatibility tests |
| `services/api/tests/fixtures/connectors/gmail-tools.json` | CREATE | Reviewed Gmail tool/schema contract fixture |
| `services/api/tests/fixtures/connectors/prompt-injection.json` | CREATE | Security/eval corpus |
| `src/main/connectors/connector-client.ts` | CREATE | Authenticated main-process control-plane client and OAuth browser launch |
| `src/main/connectors/connector-client.test.ts` | CREATE | Client parsing, polling, auth, and URL non-exposure tests |
| `src/renderer/ConnectorsSettingsCard.tsx` | CREATE | Connect/reconnect/disconnect UI |
| `src/renderer/ConnectorsSettingsCard.test.ts` | CREATE | Static/interaction rendering tests |
| `services/api/src/db.rs` | UPDATE | Register migration 026 |
| `services/api/src/config.rs` | UPDATE | ConnectorConfig, secret validation, rollout, limits, and tests |
| `services/api/src/app.rs` | UPDATE | Compose ConnectorService and maintenance worker |
| `services/api/src/lib.rs` | UPDATE | Export connector module for integration tests |
| `services/api/src/http/mod.rs` | UPDATE | Dispatch exact callback before origin denial and authenticated connector routes after it |
| `services/api/src/auth/crypto.rs` | UPDATE | Extract/reuse versioned JSON envelope primitive for connector-specific crypto |
| `services/api/src/agent/service.rs` | UPDATE | Optional worker, dynamic namespaces, route maps, connector executor, durable approval, tool-search items |
| `services/api/src/agent/policy.rs` | UPDATE | Connector action normalization/effect floor and shared digest fixtures |
| `services/api/src/agent/lifecycle.rs` | UPDATE | Verify approval/execution/cancel/expiry transitions and tests |
| `services/api/src/agent/tool_catalog.rs` | UPDATE | Keep fixed desktop catalog separate from dynamic connector routes; remove fixed-count fragility if needed |
| `services/api/src/agent/protocol.rs` | UPDATE/REGENERATE | Compile updated v3 approval projection |
| `services/api/src/providers/responses.rs` | UPDATE | Accept/measure namespaced deferred tools/tool_search in estimates and fixtures if catalog validation requires it |
| `services/api/Cargo.toml` | UPDATE | Add pinned rmcp/jsonschema dependencies |
| `Cargo.lock` | UPDATE | Lock new dependency graph |
| `services/api/BUILD.bazel` | UPDATE | Register connector integration test/fixtures |
| `src/shared/agent-runtime-protocol.ts` | UPDATE | Add bounded approval action and v3 command contract |
| `src/shared/contracts.ts` | UPDATE | Connector catalog/connection/attempt schemas and reused approval presentation |
| `src/shared/desktop-api.ts` | UPDATE | Add narrow connector IPC methods/channels |
| `scripts/generate-agent-runtime-contract.mts` | UPDATE | Generate approval fixtures/inventory changes |
| `protocol/agent-runtime.v3.schema.json` | REGENERATE | Canonical v3 schema |
| `protocol/agent-runtime.v3.manifest.json` | REGENERATE | New protocol digest |
| `test/fixtures/agent-runtime-v3/*` | REGENERATE/ADD | Approval-valid and stale-invalid fixtures |
| `src/main/application/hosted-task-client.ts` | UPDATE | Project durable approval and call v3 CAS endpoint |
| `src/main/application/hosted-task-client.test.ts` | UPDATE | Approval projection/version/idempotency tests |
| `src/main/ipc/register-ipc.ts` | UPDATE | Trusted connector IPC handlers |
| `src/main/ipc/register-ipc.test.ts` | UPDATE | Trusted-frame and parsed contract tests |
| `src/preload.ts` | UPDATE | Parse connector IPC inputs/outputs |
| `src/index.ts` | UPDATE | Compose ConnectorClient, open OAuth URL, and inject handlers |
| `src/renderer/SettingsPage.tsx` | UPDATE | Render connected-applications section |
| `src/renderer/SettingsPage.test.ts` | UPDATE | Connected/loading/error/preview states |
| `src/renderer/App.tsx` | UPDATE | Load connector status/actions and project approval from backend |
| `src/renderer/app-language.ts` | UPDATE | English/Vietnamese connector and approval copy |
| `src/index.css` | UPDATE | Settings connector card states using existing design tokens |
| `.env.example`, `services/api/README.md` | UPDATE | Connector configuration and Google prerequisites |
| `README.md`, `docs/architecture.md`, `docs/security.md` | UPDATE | Remove “not implemented,” document broker/trust/data flow and education boundary |

---

## Step-by-Step Tasks

### Task 1: Lock the connector threat model and evaluation matrix

- **ACTION**: Add executable fixtures and acceptance cases before implementation.
- **IMPLEMENT**:
  - Create Gmail tool-contract and prompt-injection fixtures.
  - Define golden paths for connect, refresh, discover, read approval, draft, label, revoke, schema drift, cancellation, and ambiguous dispatch.
  - Include Activity/Attempt runs proving connector tools are absent.
  - Record the expected Gmail tool inventory and policy mapping; unknown future Gmail tools must be excluded.
- **MIRROR**: Contract fixtures generated/consumed by `scripts/generate-agent-runtime-contract.mts` and `services/api/tests/agent_runtime_contract.rs`.
- **IMPORTS**: `serde_json`, existing test fixture helpers; no production dependencies yet.
- **GOTCHA**: Do not fetch live Gmail schemas in CI. Commit reviewed deterministic fixtures and reserve live smoke tests for a credentialed manual environment.
- **VALIDATE**: Fixture parser tests reject duplicate names, policy omissions, changed schema digests, oversized schemas, and unreviewed send/delete tools.

### Task 2: Add connector configuration, dependencies, and crypto boundary

- **ACTION**: Establish fail-closed runtime configuration and secret handling.
- **IMPLEMENT**:
  - Add pinned `rmcp = 3.0.1` client/Streamable HTTP features and `jsonschema = 0.50.0` without external resolution.
  - Add `ConnectorConfig` fields and parsers for rollout, encryption keys, callback URL, Gmail OAuth credentials, and all hard limits/timeouts.
  - Require a public HTTPS callback with no query/fragment and a fixed `/v1/connectors/oauth/callback` path when enabled.
  - Require connector key ring and Gmail client secret only when the connector rollout is active.
  - Extract a generic versioned envelope core or add ConnectorTokenCrypto while preserving AgentStateCrypto public behavior.
  - Use connector-specific AAD and public error strings.
- **MIRROR**: `AgentRuntimeConfig`, `RolloutConfig`, and `AgentStateCrypto::parse`.
- **IMPORTS**: `rmcp`, `jsonschema`, `url`, existing AES-GCM/base64/rand/serde modules.
- **GOTCHA**: Never reuse `GOOGLE_OAUTH_CLIENT_ID` from desktop identity sign-in. Connector OAuth uses a confidential web client and fixed hosted redirect.
- **VALIDATE**: Config tests cover disabled defaults, missing key/client secret, malformed key ring, non-HTTPS callback, wrong callback path, excessive limits, and successful canary configuration.

### Task 3: Create durable connector persistence and repository methods

- **ACTION**: Add migration 026 and transactional repository operations.
- **IMPLEMENT**:
  - Create the four connector tables and extend run/invocation approval/executor columns described above.
  - Add strict checks for statuses, digest formats, envelope dimensions, ownership, executor/connection consistency, and approval-state completeness.
  - Add repository methods for user-scoped list/get, attempt creation/consumption, connection upsert/tombstone, snapshot activation, refresh lease, and audit append.
  - Make snapshot activation atomic: insert immutable snapshot, deactivate prior active row, update connection digest.
  - Add maintenance for expired attempts, refresh leases, and stale non-active snapshots without deleting active credentials.
  - Register migration 026 explicitly in `db.rs`.
- **MIRROR**: Migration construction in `db.rs`, encrypted agent tables in migration 014, and row-lock/CAS patterns in `AgentService`.
- **IMPORTS**: `sqlx`, `uuid`, `time`, ConnectorTokenCrypto.
- **GOTCHA**: Never store raw OAuth state, PKCE verifier, code, access token, refresh token, account email, MCP arguments, or MCP result in plaintext/audit columns.
- **VALIDATE**: PostgreSQL integration tests prove user isolation, one-time state consumption, envelope AAD binding, active snapshot uniqueness, refresh lease recovery, approval checks, and cascade/tombstone behavior.

### Task 4: Implement the verified connector catalog and Gmail policy manifest

- **ACTION**: Make all executable connector capabilities code-reviewed.
- **IMPLEMENT**:
  - Add immutable ConnectorDefinition/Namespace/ToolPolicy types and uniqueness validation.
  - Add Gmail endpoint, maturity, OAuth scopes, two namespace descriptions, ten allowed tools, effects, reviewed input-contract digests, approval fields, and result policies.
  - Calculate a canonical catalog policy digest used in snapshots and route maps.
  - Provide lookups by catalog key and `(catalog_key, mcp_tool_name)` only.
  - Return safe public catalog DTOs without endpoint, scopes beyond user-facing descriptions, client IDs, or policy internals.
- **MIRROR**: Generated hosted tool-catalog uniqueness checks in `agent/tool_catalog.rs:34-61`.
- **IMPORTS**: `serde`, `serde_json`, `sha2`, `url`, agent ActionEffect types.
- **GOTCHA**: The MCP server's name and annotations are not unique authority. Tro's catalog key plus connection ID plus exact tool policy identifies the executable capability.
- **VALIDATE**: Unit tests fail on duplicate catalog/tool/namespace keys, namespace size >=10, unsafe endpoint, missing effect, schema mismatch, send-like Gmail operations, and nondeterministic digest ordering.

### Task 5: Build schema normalization and the remote MCP client

- **ACTION**: Discover and invoke verified remote tools through rmcp with bounded data.
- **IMPLEMENT**:
  - Build an injected McpClientFactory using Streamable HTTP, bearer auth, no redirects, fixed endpoint equality, timeout/cancellation, and supported lifecycle negotiation.
  - Implement paginated `list_all_tools`, canonical tool snapshot generation, and active snapshot persistence.
  - Validate names, descriptions, input/output schemas, size/depth/property limits, local refs, and catalog contract digests.
  - Reject `x-mcp-header`, external refs, unsupported content, and extra catalog-unreviewed tools from advertisement.
  - Implement exactly one `call_tool` dispatch with JSON Schema argument validation.
  - Normalize protocol errors vs tool-level errors into fixed internal result codes.
  - Bound and validate structured output, text, and result provenance.
- **MIRROR**: ResponsesService injected endpoint/client/timeout/ambiguous-result design and tool_catalog argument validation boundary.
- **IMPORTS**: `rmcp::{ClientInfo, ClientLifecycleMode, ClientServiceExt, ProtocolVersion}`, Streamable HTTP transport, `jsonschema`, `serde_json`, `tokio_util::CancellationToken`.
- **GOTCHA**: Do not use rmcp stdio/child-process features. Do not retry a Streamable HTTP POST after session recovery or ambiguous response.
- **VALIDATE**: Wiremock tests cover JSON and SSE responses, pagination, 401, expired token, tool error, schema error, oversized result, timeout before/after dispatch, cancellation, and exactly one POST.

### Task 6: Implement OAuth attempts, callback, refresh, and disconnect

- **ACTION**: Add the connector authorization lifecycle in Rust.
- **IMPLEMENT**:
  - Generate high-entropy state/nonce/verifier; store state HMAC and encrypted attempt secrets.
  - Build Gmail authorization URL from catalog scopes and exact callback.
  - Add authenticated create/status/list/disconnect endpoints and the exact public callback.
  - On callback, validate bounded query, attempt state/status/expiry, recorded issuer, PKCE, token response, scopes, and token type.
  - Discover and activate tool snapshot before marking connection `connected`.
  - Add token refresh lease with bounded wait/steal-after-expiry behavior and atomic refresh-token rotation.
  - Tombstone locally before best-effort provider revocation.
  - Return a fixed CSP/Referrer-Policy/no-store HTML callback page.
- **MIRROR**: Google identity verifier Wiremock tests and authenticated organization handlers/rate limits.
- **IMPORTS**: Connector repository/crypto/catalog/MCP factory, `reqwest`, `sha2`/HMAC, `url`, Axum response builders.
- **GOTCHA**: Browser-origin denial currently occurs before authenticated feature handlers. Route only the exact callback before that denial; do not move the general connector API into browser-origin reachability.
- **VALIDATE**: Integration tests cover success, denial, duplicate callback, expired/unknown state, wrong issuer, wrong verifier, scope downgrade, missing refresh token policy, refresh race, disconnect replay, and no secrets in response/log/audit.

### Task 7: Add the narrow desktop connector control plane and Settings card

- **ACTION**: Let users manage connections without exposing OAuth internals to React.
- **IMPLEMENT**:
  - Add strict shared schemas for catalog entries, connection summaries, and attempt status.
  - Add ConnectorClient in Electron main using the existing hosted session provider.
  - `beginConnectorConnection(catalogKey)` creates the attempt and immediately calls `shell.openExternal` on the validated HTTPS authorization URL; return only safe attempt data.
  - Add status polling with abort/backoff and idempotent disconnect.
  - Register narrow trusted-frame IPC and parse inputs/outputs in preload.
  - Add the Connected applications Settings card with loading, connected, reauthorize, contract-changed, preview, and error states.
  - Disable Connect when hosted auth is unavailable; never offer custom URL fields.
- **MIRROR**: `OrganizationClient`, GoogleAuthService URL launch, SettingsPage cards, preload parsing, and trusted IPC tests.
- **IMPORTS**: Shared connector schemas, `shell`, existing access-token provider and API base URL.
- **GOTCHA**: The authorization URL contains a live state capability. Electron main may use it to open the browser but must not persist it, log it, put it in Redux/React state, or return it across preload.
- **VALIDATE**: Vitest tests cover trusted frame, schema rejection, one browser open, safe status only, polling abort, sign-out, translated card states, and absence of raw URL/token fields.

### Task 8: Project dynamic connector namespaces into Responses

- **ACTION**: Extend model tool construction without mixing connector inventory into the fixed desktop digest.
- **IMPLEMENT**:
  - Refactor `model_tools` into a builder that accepts optional compatible desktop capabilities plus eligible connector snapshots.
  - Keep current static strict desktop functions unchanged.
  - Add Gmail namespace objects with reviewed function descriptions, original MCP schemas, `strict:false`, and `defer_loading:true`.
  - Add hosted `tool_search` only for supported models and nonempty connector inventory.
  - Persist the encrypted route map and connector snapshot/policy digests in the checkpoint.
  - Preserve bounded `tool_search_call` and `tool_search_output` items returned before a connector function call.
  - Split route resolution into fixed desktop versus dynamic connector and require namespace for dynamic calls.
  - Omit all connector namespaces for Activity/Attempt-bound runs.
- **MIRROR**: `model_tools` fixed catalog emission, checkpoint encryption, and single function-call filtering in `process_run`.
- **IMPORTS**: ConnectorService catalog/snapshot DTOs, protocol/tool catalog modules, serde_json.
- **GOTCHA**: Do not add per-user connector tools to `agent-tools.v3.json` or its digest. The static digest describes the desktop execution contract; encrypted snapshot digests bind dynamic tools.
- **VALIDATE**: Provider-body tests assert desktop-only, connector-only, mixed, activity-bound, no-connection, unsupported-model, deferred namespace, fewer-than-ten functions, one tool_search, and stable route-map digests.

### Task 9: Normalize connector actions and apply host policy

- **ACTION**: Turn every connector function call into a catalog-owned ProposedAction before execution.
- **IMPLEMENT**:
  - Add connector action normalizers per reviewed Gmail tool.
  - Derive tool ID/operation/target/presentation parameters and minimum ActionEffect from catalog plus arguments.
  - Canonicalize full arguments and compute the Rust exact action digest compatible with shared fixtures.
  - Let server annotations/opaque facts raise to `unknown`; never lower catalog effect.
  - Evaluate through the existing pure Rust policy and intent authorization.
  - Map private read tools to exact sensitive-transfer approval, drafts/labels to explicit intent grants or exact approval, and strict mode to approval for mutations.
  - Ensure unknown/unreviewed connector calls are denied, not treated as routine.
- **MIRROR**: `tool_catalog::resolve_effect`, `policy::raise_action_effect`, and TypeScript `createActionDigest` canonical ordering.
- **IMPORTS**: Agent policy/effect/action types, connector catalog policy, sha2/stable JSON helper.
- **GOTCHA**: Approval presentation can be redacted, but the digest must include every original argument. Reject an argument-contract change rather than approving unseen fields.
- **VALIDATE**: Unit/property tests cover every Gmail tool, nested argument reordering, changed recipient/body/query/thread/label, annotation risk raising, strict/balanced modes, and TypeScript/Rust digest parity.

### Task 10: Complete durable backend approval projection and commands

- **ACTION**: Make `awaiting_approval` a real API-owned wait for connector invocations.
- **IMPLEMENT**:
  - Extend v3 WaitingOn approval with ApprovalActionV3 and exact validation.
  - Add migration checks and AgentService projection for all approval fields.
  - Add a typed v3 approval command with expected version and idempotent client command ID.
  - Replace the current generic approval event writer with run/invocation row locks and exact CAS validation.
  - On approval, mark the same invocation approved and recover; on deny, commit a denied function output and recover.
  - Expire stale approval waits in maintenance and never allow an old interaction/digest to approve a newer call.
  - Update HostedTaskClient projection and renderer snapshots so the existing card appears after reconnect/restart.
  - Regenerate v3 schema, manifest, digest, Rust Typify bindings, and fixtures.
- **MIRROR**: Durable permission resolution at `service.rs:930-1014`, lifecycle projection, and canonical generator.
- **IMPORTS**: Protocol v3 generated types, ProposedAction/ApprovalInteraction schemas, existing HostedTaskClient error handling.
- **GOTCHA**: The current `/v1/tasks/{run}/approval` accepts a plausible digest without binding it to pending state. Do not leave that behavior as a fallback for v3 connector approvals.
- **VALIDATE**: Contract/integration tests cover reconnect projection, approve, deny, expiry, wrong user, wrong run version, wrong interaction, changed digest, replayed command, cancel while waiting, and one-use consumption.

### Task 11: Execute connector invocations in the backend lifecycle

- **ACTION**: Add connector executor dispatch alongside, not inside, the desktop worker.
- **IMPLEMENT**:
  - Allow run planning with `Option<worker_capabilities>`; include desktop tools only when present.
  - Add `executor_kind` routing to checkpoint continuation and pending invocation recovery.
  - For connector calls, create invocation/checkpoint/outcome criterion transactionally.
  - Persist `awaiting_approval` or CAS to `executing` before dispatch.
  - Refresh tokens pre-dispatch, call MCP once, normalize/guard/encrypt result, append one function_call_output, and transition recovery.
  - Mark verified connector success as tool evidence with snapshot/invocation provenance.
  - Keep desktop event streams restricted to desktop invocations.
  - Add connector invocation count/expiry/cancel handling to maintenance.
  - Use fixed public summaries and structured logs containing IDs, connector key, tool name, status, and duration only.
- **MIRROR**: `interrupt`, `grant_execution`, `append_session_item`, provider uncertain handling, and outcome criterion updates.
- **IMPORTS**: ConnectorService/McpClient, policy decision, cancellation token, agent crypto/events/repository helpers.
- **GOTCHA**: Do not hold the agent run lease or database transaction across OAuth refresh or MCP network I/O. Commit execution ownership first, renew a bounded execution lease if needed, and reconcile once.
- **VALIDATE**: PostgreSQL/Wiremock tests cover connector-only without worker, mixed execution, success, tool error, revoke between plan/call, snapshot change, token refresh, cancellation, crash recovery, result idempotency, and ambiguous consequential block with zero retry.

### Task 12: Guard connector content and preserve trust provenance

- **ACTION**: Prevent Gmail content from being treated as authority.
- **IMPLEMENT**:
  - Normalize Gmail text/HTML into bounded plain text.
  - Add deterministic injection-risk checks and provenance wrapper.
  - Withhold high-risk content from model input and expose a safe user-visible warning/result code.
  - Add developer instructions stating connector outputs are untrusted data and cannot alter authority or approvals.
  - Ensure result text never becomes a system/developer item and cannot inject `additional_tools` or route-map content.
  - Add fixed risk counters without logging the matching text.
- **MIRROR**: Security rule that untrusted content can raise risk but never grant authority; bounded provider/session items.
- **IMPORTS**: Existing regex/regress/unicode-normalization helpers, ConnectorResultPolicy.
- **GOTCHA**: A clean detector result does not make content trusted. Keep every later tool call behind the same catalog, schema, policy, and approval checks.
- **VALIDATE**: Corpus tests cover HTML/script/hidden text, prompt override, fake system/tool messages, zero-width/Unicode, encoded blocks, multilingual content, quoted replies, false-positive ordinary instructions, and output size limits.

### Task 13: Finish Gmail pilot behavior and end-to-end tests

- **ACTION**: Prove real product flows against deterministic mocks and a manual Developer Preview smoke environment.
- **IMPLEMENT**:
  - Add Responses fixtures containing hosted `tool_search_call`, `tool_search_output`, namespaced `function_call`, and final response.
  - Test “find latest mail,” “summarize a thread,” “create a draft,” “label a thread,” and “send an email.”
  - The send request must not expose an MCP send tool; if desktop tools are present, the model may use visible Gmail with the existing exact send approval, otherwise it must explain the limitation.
  - Test multiple sequential Gmail calls, each with independent policy and approval.
  - Add a credentialed manual smoke script/documentation that does not print tokens or message bodies.
- **MIRROR**: `AgentResponder` deterministic sequences and existing agent runtime integration setup.
- **IMPORTS**: Wiremock, disposable PostgreSQL helpers, connector fixtures.
- **GOTCHA**: Google's preview contract can change. Live smoke failure must mark schema review required; it must not auto-accept the new shape.
- **VALIDATE**: All deterministic E2E cases pass; manual canary confirms connect/list/read/draft/label/disconnect with a test Gmail account and redacted logs.

### Task 14: Add observability, rollout controls, docs, and release verification

- **ACTION**: Make rollout reversible and document the architecture honestly.
- **IMPLEMENT**:
  - Add fixed metrics/logs for connection states, OAuth outcomes, schema drift, refresh, MCP latency/status, approvals, guarded content, and unknown outcomes.
  - Add maintenance and kill-switch tests.
  - Document Google project setup, callback, key rotation, revocation, retention, and incident response.
  - Update architecture/security diagrams and remove README's direct-connector “not implemented” claim.
  - Document that OpenAI managed connectors are not vendored and native MCP pass-through is deferred.
  - Run dependency audit, Rust/Bazel checks, full app checks, package, and diff review.
- **MIRROR**: Existing rollout configs, `tracing` fixed events, API README environment documentation, and architecture/security ownership language.
- **IMPORTS**: N/A beyond prior tasks.
- **GOTCHA**: A kill switch must not delete credentials. Key rotation requires old decrypt keys until every live envelope is re-encrypted or disconnected.
- **VALIDATE**: Observe/canary/percentage/kill-switch tests, no-secret log assertions, documentation review, all commands below, and a clean diff check.

---

## Testing Strategy

### Unit and Integration Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Disabled rollout | Connector config absent | No endpoints/catalog advertising; existing agent unchanged | No |
| Create OAuth attempt | Authenticated Gmail catalog request | Encrypted live attempt and browser authorization URL in main only | No |
| OAuth replay | Same callback state twice | First consumes; second rejected | Yes |
| Cross-user attempt | User B polls User A attempt | Not found | Yes |
| Scope downgrade | Token omits compose or readonly | Connection not activated | Yes |
| Snapshot discovery | Gmail ten-tool fixture | Two five-function namespaces, policy digest pinned | No |
| Unknown Gmail tool | Fixture adds send/delete | Tool stored diagnostically but never exposed | Yes |
| Schema drift | Reviewed tool schema digest changes | Connection/tool becomes `contract_changed` | Yes |
| Deferred namespace | Connected Gmail | Responses body has namespace functions with `defer_loading:true` and one tool_search | No |
| Activity-bound run | Same user has Gmail connection | No connector namespaces | Yes |
| Connector-only run | No desktop worker | Model can call Gmail; no awaiting_worker | Yes |
| Private read | `search_threads` call | Exact durable approval before MCP dispatch | No |
| Draft requested | Explicit balanced-mode draft request | Intent-authorized create draft; one dispatch | No |
| Strict draft | Same request in strict mode | Exact approval | Yes |
| Approval mutation | Arguments change after approval | Digest mismatch, no dispatch | Yes |
| Approval replay | Same decision/call twice | One execution maximum | Yes |
| Revoked connection | Revoke between planning and dispatch | not_executed; no token use | Yes |
| Ambiguous mutation | Timeout after `tools/call` POST | invocation unknown, run blocked, zero retry | Yes |
| Tool-level error | MCP `isError` result | Failed bounded output, no provider detail leak | No |
| Oversized result | > limits | Truncated/rejected bounded output | Yes |
| Prompt injection | Email asks model to ignore policy/send data | Content withheld or flagged; no authority change | Yes |
| Send request | User asks Gmail MCP to send | No MCP send function; desktop fallback or honest limitation | Yes |
| Disconnect | User clicks disconnect | Local connection tombstoned immediately, provider revoke best effort | No |
| Refresh race | Two API instances refresh same token | One lease winner, one waits/reloads | Yes |
| Kill switch | Disable after connection | No new advertising/calls; disconnect still works | Yes |

### Edge Cases Checklist

- [ ] Empty/unknown connector catalog key
- [ ] Maximum active connection count
- [ ] OAuth error callback without code
- [ ] Duplicate, expired, consumed, or cross-user OAuth state
- [ ] Wrong/missing issuer and redirect URI mismatch
- [ ] Token endpoint timeout before and after response
- [ ] Missing/rotated refresh token
- [ ] Refresh lease owner crash and expiry takeover
- [ ] Connection revoked while run is awaiting approval
- [ ] Tool list pagination, duplicate tool name, invalid characters, and more than 100 tools
- [ ] Schema with external ref, dynamic ref, x-mcp-header, deep recursion, too many properties, unsupported root, or excessive bytes
- [ ] Namespace/function collision across two connections
- [ ] Tool-search output before function call and no function call
- [ ] Model emits connector function without namespace or route-map entry
- [ ] Nested arguments and canonical ordering
- [ ] Approval expiry, version conflict, wrong digest, replay, cancellation, and reconnect
- [ ] MCP JSON response, SSE response, malformed response, tool error, 401, 429, 5xx, timeout, cancellation
- [ ] Connector result with text, structured content, HTML, binary, link, resource, and excessive size
- [ ] Prompt injection in plaintext, HTML, Unicode, quoted thread, and multilingual mail
- [ ] Activity/Attempt run, teacher directive, and organization role never expose personal connectors
- [ ] Sign-out during connection/poll/run
- [ ] Key rotation with old envelope version
- [ ] Kill switch during a queued call versus already executing call
- [ ] Logs/audit/API bodies contain no tokens, OAuth state/code, email content, search query, recipients, or message body

---

## Validation Commands

### Contract generation

~~~bash
npm run agent:protocol:generate
npm run agent:protocol:check
~~~

EXPECT: v3 schema, manifest, digests, and fixtures are regenerated once and immediately pass the stale-artifact check.

### Rust formatting, lint, audit, and focused tests

~~~bash
cargo fmt --manifest-path services/api/Cargo.toml --all -- --check
cargo clippy --manifest-path services/api/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path services/api/Cargo.toml --all-features --locked connectors
npm run api:audit
~~~

EXPECT: No formatting/lint/audit failures; connector unit tests pass.

### Focused TypeScript tests

~~~bash
npx vitest run \
  src/main/connectors/connector-client.test.ts \
  src/main/application/hosted-task-client.test.ts \
  src/main/ipc/register-ipc.test.ts \
  src/renderer/ConnectorsSettingsCard.test.ts \
  src/renderer/SettingsPage.test.ts
~~~

EXPECT: Narrow IPC, approval projection, connector client, and Settings tests pass.

### PostgreSQL integration tests

~~~bash
TEST_DATABASE_URL=postgres://localhost/trocode_connectors_test \
  cargo test --manifest-path services/api/Cargo.toml --all-features --locked \
  --test connectors_compat -- --ignored --nocapture

TEST_DATABASE_URL=postgres://localhost/trocode_agent_test \
  cargo test --manifest-path services/api/Cargo.toml --all-features --locked \
  --test agent_runtime_compat -- --ignored --nocapture
~~~

EXPECT: Disposable local `_test` databases pass OAuth/MCP/approval/execution and existing agent compatibility tests. Test helpers must retain the existing host/path safety assertion before resetting schemas.

### Full repository verification

~~~bash
npm run check
npm run package
npm run bazel:check
~~~

EXPECT: Protocol checks, admin build, runtime versions, Rust engine, lint, typecheck, Rust formatting/lint/audit, all tests, Electron package, and Bazel Rust graph pass.

### Diff validation

~~~bash
git diff --check
git status --short
~~~

EXPECT: No whitespace errors, no generated artifacts left stale, and no secrets/credential files appear in the diff.

### Manual canary validation

- [ ] Enable connectors for one canary user with a dedicated test Gmail account.
- [ ] Connect Gmail and verify Settings reaches Connected without seeing any token/code/state in renderer devtools or logs.
- [ ] Restart the desktop during OAuth polling; verify safe status recovery.
- [ ] Ask “Find the latest email from Ariel.” Verify exact approval precedes MCP dispatch and the summary contains only requested data.
- [ ] Put a prompt-injection email in the test inbox; verify content is flagged/withheld and cannot trigger another tool.
- [ ] Ask “Draft a reply saying I approve the plan.” Verify a Gmail draft is created, not sent.
- [ ] Ask “Apply the Important label to that thread.” Verify one label call and evidence.
- [ ] Ask “Send the draft.” Verify no Gmail MCP send call; use existing visible Gmail path only if desktop tools are available and exact send approval is granted.
- [ ] Disconnect Gmail during a paused approval; verify the old action cannot execute.
- [ ] Simulate MCP timeout after request receipt; verify unknown/block/no retry.
- [ ] Start an assigned Activity containing an email instruction; verify Gmail tools are absent.
- [ ] Activate kill switch; verify connections remain listed/disconnectable but no tools are advertised or called.

---

## Acceptance Criteria

- [ ] Gmail can be connected from Settings through a separate hosted OAuth flow with PKCE and fixed HTTPS callback.
- [ ] Connector OAuth tokens and account labels are encrypted at rest with versioned connector keys and row/user-bound AAD.
- [ ] OAuth tokens, codes, state, PKCE verifier, client secret, private mail, and raw tool arguments/results never enter logs, analytics, audit details, or renderer state.
- [ ] The official rmcp client uses remote Streamable HTTP only and pins current supported versions/features.
- [ ] Tools are discovered once, bounded, schema-validated, cached as immutable snapshots, and pinned to run route maps.
- [ ] Only code-reviewed catalog tools are exposed; new/changed Gmail contracts fail closed.
- [ ] Responses receives deferred functions in small namespaces plus tool_search; it does not receive the MCP authorization token.
- [ ] Connector function calls are resolved by namespace/name against the encrypted pinned route map.
- [ ] Desktop and connector executors coexist; connector-only tasks do not require a live desktop worker.
- [ ] Every connector call passes JSON Schema validation, catalog effect normalization, pure Rust policy, and exact approval when required.
- [ ] Private Gmail reads require durable exact approval before their content is sent to the model.
- [ ] Draft and label operations obey balanced intent grants and strict-mode exact approval.
- [ ] Approval is bound to full canonical arguments, connection, snapshot, tool, effect, and intent revision; it expires and is consumed once.
- [ ] v3 approval state survives event reconnect and desktop restart and renders through the existing approval card.
- [ ] A connector call is dispatched at most once; ambiguous consequential outcomes are blocked and never retried.
- [ ] MCP results are bounded, schema-checked where possible, provenance-labeled, content-guarded, encrypted, and inserted only as untrusted function output.
- [ ] Gmail send is not claimed or attempted through MCP.
- [ ] Personal connectors are never exposed to Activity/Attempt runs, teacher directives, other users, or organizations.
- [ ] Kill switch stops new advertising/execution without deleting credentials.
- [ ] Google verification/security prerequisites and Developer Preview status are documented.
- [ ] All validation commands pass.

## Completion Checklist

- [ ] Code follows Rust service, strict HTTP handler, envelope crypto, pure policy, Zod protocol, narrow IPC, and Wiremock patterns captured above.
- [ ] Every network effect is orchestrated outside pure lifecycle/policy functions and outside open database transactions.
- [ ] Every connector mutation uses user ownership and exact connection/snapshot policy checks.
- [ ] No arbitrary URL, local process, raw MCP client, token, or OAuth secret crosses DesktopApi.
- [ ] No MCP annotation grants authorization or lowers risk.
- [ ] Generated protocol files and Cargo.lock are committed; no generated tool snapshot is fetched during CI.
- [ ] Dependency versions and features are exact and audited.
- [ ] Configuration is fail-closed and supports rotation/canary/kill-switch operations.
- [ ] Documentation covers retention, revocation, schema drift, unknown outcomes, and education isolation.
- [ ] Existing desktop tool execution remains compatible and its exactly-once behavior is unchanged.
- [ ] Plan can be implemented without additional architecture discovery.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Indirect prompt injection in email | High | High | Untrusted provenance, HTML normalization, content guard, catalog-owned authority, exact approvals, red-team corpus, canary gate |
| Gmail Developer Preview changes tool schemas/behavior | High | Medium | Immutable snapshots, reviewed contract digests, fail-closed `contract_changed`, manual canary smoke |
| OAuth token compromise | Low | Critical | Dedicated AES-GCM key ring, strict AAD, no renderer/log exposure, least scopes, revocation, rotation, fixed origins |
| Duplicate connector action after timeout/recovery | Medium | High | Commit executing CAS before one POST, rmcp no-retry behavior, unknown terminal state, invocation uniqueness |
| Approval UI omits consequential argument | Medium | High | Reviewed per-tool argument contract, full canonical digest, fail closed on schema drift, presentation tests |
| Tool growth increases Responses payload/cost | Medium | Medium | Connected-user inventory only, deferred functions, two small Gmail namespaces, hard limits, later client-executed search boundary |
| Optional desktop worker refactor regresses existing tools | Medium | High | Separate executor enum, unchanged static catalog/digest semantics, mixed/desktop-only compatibility tests |
| Token refresh race across replicas | Medium | High | Database refresh lease, atomic rotation, bounded wait/takeover tests |
| Google OAuth verification delays rollout | High | Medium | Keep canary/test-user mode; treat production verification as explicit release gate |
| Teacher/classroom request leaks student personal mail | Low | Critical | User-scoped ownership and unconditional connector omission for Activity/Attempt runs |
| Provider/OpenAI learns connector data | High | Medium | Exact approval before private reads, minimal result selection/truncation, no direct MCP authorization token sharing |
| Native OpenAI MCP later diverges from broker | Medium | Medium | Keep executor interface explicit; require a new architecture/security review before pass-through |

## Notes

- The first backend is not a Gmail API wrapper. It is an MCP host/client and policy broker; Gmail is the verification case.
- OpenAI remains the planning core through Responses. The leverage comes from deferred namespaced functions and tool_search, not from ceding execution authority.
- The current Rust backend calls the Responses REST API through `reqwest`; it is not using the OpenAI Agents SDK. These tool capabilities are Responses API features and do not require an SDK migration. An Agents SDK migration would be a separate architectural change and would not replace Tro's policy or execution broker.
- OpenAI-managed Gmail connectors and Google's Gmail MCP server are different products. This plan uses Google's remote MCP endpoint.
- Google's current Gmail MCP tools can create drafts and manage labels but cannot send. Tro must state this honestly.
- A connected app is availability, not authorization. The user's instruction, normalized action effect, and exact approval rules still decide whether a call can run.
- Remote custom MCP servers should be a later phase. Their URL/OAuth/SSRF/supply-chain model is materially riskier than verified catalog entries.
- Local stdio MCP should be later still because it adds arbitrary process execution and package-install risk to the desktop trust boundary.
