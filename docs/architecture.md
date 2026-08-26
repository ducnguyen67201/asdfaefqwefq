# Architecture

## Decision

Tro uses one Rust backend engine. The `trocode-api` workspace owns the model
loop, task lifecycle, intent compilation, outcome contracts, policy decisions,
provider calls, persistence, membership, organizations, budgets, and durable
events. There is no TypeScript model loop or local database backend.

Electron and React are client/device layers:

- React renders validated projections and sends narrow requests through
  `DesktopApi`.
- Preload exposes fixed IPC functions; it never exposes Electron or raw IPC.
- Electron main validates IPC, stores device credentials with `safeStorage`,
  runs the OAuth loopback listener, presents approvals, and owns OS handles.
- The bundled Rust desktop-engine process performs local policy and provider
  transport that must remain beside the device, over a private JSON-lines stdio
  protocol.
- The hosted Rust API owns canonical tasks and sends signed, expiring tool
  invocations to a reconnectable Electron worker.
- The web admin is a separate static React client embedded in the hosted Rust
  binary. It calls only authenticated `/v1/admin/*` HTTP contracts and does not
  introduce another backend runtime.

```mermaid
flowchart LR
    UI["Sandboxed React renderer"] --> PRELOAD["Typed preload API"]
    PRELOAD --> MAIN["Electron UI + device adapter"]
    MAIN --> SIDECAR["Bundled Rust desktop engine"]
    MAIN --> API["Hosted Rust API"]
    API --> PG["PostgreSQL"]
    API --> PROVIDERS["Responses / Transcription / TTS"]
    API -->|"signed tool invocation"| MAIN
    MAIN -->|"one-time execution request"| API
    MAIN --> CUA["CUA / browser / OS adapters"]
    MAIN --> WORKSPACE["root-confined file + shell adapters"]
    MAIN -->|"bounded result + evidence"| API
    ADMIN["Static React admin"] -->|"authenticated HTTPS"| API
```

## Task authority

The Rust API creates the complete v8 authority contract: original request,
runtime kind, execution profile, autonomy mode, intent grants, outcome criteria,
hard-confirm effects, and limits. Electron rejects responses without that exact
contract and projects it into renderer state. It never fills missing authority
with locally compiled defaults.

The selected Workspace root is intentionally device-local. The API binds the
contract to an opaque selection ID; Electron resolves that ID to the previously
trusted canonical path and rejects a mismatch. File paths remain confined to
that root, while shell commands receive only an allowlisted environment.

## Tool execution

The Rust supervisor chooses tools and persists the lifecycle. A durable tool
envelope includes a schema digest, expiration, effect, intent revision,
authorization source, approval requirement, and verification obligations.
Electron parses and normalizes the envelope, asks the bundled Rust policy
engine to independently validate it, obtains the API's one-time executing
transition, and dispatches the native adapter once.

If a consequential operation begins and connectivity is lost, the result is
unknown and is never retried. Exact approval is bound to the full normalized
action digest and is consumed once. Clarification and approval cards are local
presentation state; their answers return to the same Rust run.

## Provider and persistence ownership

Production provider credentials and PostgreSQL credentials exist only in the
Rust API environment. Voice and Google code exchange use the Rust sidecar so
Electron does not implement provider protocols. TypeScript HTTP/WebSocket/SSE
classes are typed clients, not alternative services.

Task history is read from the Rust task API. Knowledge Spaces, organizations,
membership, budgets, encrypted agent state, evidence, and billing ledgers are
all PostgreSQL-backed Rust services. Screenshots and original-resolution crops
remain bounded device memory and are not written to task history.

## Failure behavior

Missing API configuration, an incompatible Rust contract, a failed sidecar
handshake, or a disabled hosted runtime blocks new work. Tro never falls back to
JavaScript inference, local PostgreSQL, offline membership verification, or a
direct provider call from Electron.
