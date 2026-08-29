# Security model

Tro is an autonomous desktop agent. A model-selected registered tool can run
without a Tro confirmation card. Users and operators should treat the enabled
tool catalog and the host account's capabilities as the action boundary.

## Trust boundaries

- The Electron renderer is sandboxed and has no Node integration.
- Preload exposes narrow, schema-parsed functions; it does not expose raw IPC,
  CUA, OAuth tokens, provider credentials, or a generic command channel.
- Rust owns task lifecycle, contracts, budgets, durable invocations, leases,
  results, and verification.
- Electron owns local native handles and revalidates inputs immediately before
  local execution.
- Models and connector/browser content are untrusted. They cannot register a
  tool, change a contract, widen workspace identity, or bypass schemas.

## Retained controls

- Exact runtime v4 protocol, base catalog, and per-worker CUA catalog digest
  negotiation.
- Strict Tro tool parsing plus schema-bound CUA tool discovery and dispatch.
- Public credential-free HTTPS validation for direct browser navigation.
- Canonical selected-workspace identity and filesystem path/symlink checks.
- Shell count, length, NUL, timeout, output, environment, and cancellation
  bounds. The shell is not a security sandbox.
- Fresh observation binding and exclusion of Tro's own windows.
- Operating-system Accessibility/Screen Recording readiness.
- Provider OAuth consent, scope, endpoint, and schema-snapshot validation.
- One-time requested-to-executing ownership and result replay handling.
- Task time, tool-call, model-sample, image, and spend limits.
- No automatic replay after an unknown tool result.
- Privacy-safe lifecycle/audit metadata and encrypted sensitive persistence.

## Explicitly accepted risk

If the catalog exposes a send, delete, publish, install, trade, deployment, or
similar tool, the model may select it and Tro will execute it automatically
after the retained checks. Workspace terminal commands run with the host user's
network, credentials, and executable access. Root confinement applies to the
filesystem adapter, not arbitrary shell syntax.

Stop/Escape and backend cancellation reduce exposure but cannot undo an action
already accepted by an external application. Cancellation during an unknown
tool execution produces a blocked run rather than a retry.

## Native CUA capability

Tro runs the CUA SDK in its trusted unrestricted host mode. The worker advertises
the driver's canonical tool schemas under a digest, and every invocation must
match that exact catalog before the generic adapter calls CUA. Tro owns session
start/end and overwrites model-supplied session identifiers with the current
task ID. CUA still enforces its native contract, including capabilities that are
not exposed in any execution mode; Tro does not turn a native refusal into an
approval prompt or retry it as a different action.

## Deployment

New task execution is runtime v4 only. Cleanup migration 030 first asserts that
no nonterminal run or legacy approval wait exists. It never converts historical
pending work into execution. Operators must drain or cancel active work under
the old release before applying the cleanup.

Backend-agent canary runs are a separate, explicit privacy path: task text and
bounded tool results are processed by Railway and short-lived operational state
is stored under AES-256-GCM with authenticated run metadata and a dedicated
versioned key. Sanitized events contain no task content. Screenshot and crop
bytes live only in a bounded in-memory sidecar and are removed before any
session item or tool result is written to PostgreSQL.

Local PostgreSQL binds only to `127.0.0.1:54320`, receives its generated
password from Doppler at container startup, and persists data in a named Docker
volume. The password and `DATABASE_URL` are not committed or compiled into the
application. Production database credentials and network policy are deliberately
separate from this development setup.

PostHog runs only in the trusted Electron main process. Its event surface is an
explicit allowlist of application lifecycle, task phase, contract/runtime/profile
labels, first-delta latency, tool ID/operation, and count fields. Voice events
contain only character count. Partial text, command text, arguments, paths, and
interaction descriptions are excluded.
CUA performance events contain only the fixed route, operation name, bounded
duration, screenshot-present boolean, fallback enum, and effect status. They do
not include titles, URLs, code, visible text, typed text, filesystem paths,
identifiers, resources, screenshots, or raw arguments.
Anonymous activity uses a random local installation ID without a person
profile. Email and display name are sent only after successful Google
authentication.

The desktop pet's hover reaction uses a bounded local main-process hit test
only while the pet is visible and idle. Electron compares the current DIP
cursor point with the pet rectangle and sends the sandboxed renderer only a
boolean. Cursor coordinates are never placed in IPC, PostHog, logs, task
history, classroom evidence, local persistence, or network requests. Pet-nudge
text crosses only the bounded parsed outbound renderer projection and is never
placed in analytics, logs, task history, classroom evidence, persistence, or
network requests. The tracker stops while the pet is busy, hidden, disabled,
destroyed, or shutting down. Wayland receives no global-input fallback or hook;
hover is simply unavailable there.

Task encouragement messages are selected from checked-in English and
Vietnamese catalogues using only the validated task ID and phase. They cannot
include request text, model output, event summaries, tool names, paths, URLs,
screen content, or inferred attention. They remain passive bounded plain text
and are suppressed by higher-priority interaction, guidance, and response
surfaces.

Do not ship a shared model-provider API key inside the renderer, Electron main,
or application bundle. Production OpenAI and optional ElevenLabs keys are
injected into the Railway API only. Electron sends its opaque device session to
fixed, HTTPS provider-proxy endpoints; provider credentials never reach the
desktop. Responses streaming is SDK-driven behind the host broker. Voice audio
crosses the narrow preload boundary only as a schema-bounded base64 PCM WAV
segment with UUIDs, sequence, and claimed duration. The hosted API parses mono,
16 kHz, PCM16 WAV structure and authoritative duration before reserving spend;
raw audio and transcript text are never persisted or added to structured logs.
MP3 bytes stream through a `trocode-audio://speech/<UUID>` protocol handler
owned by Electron main. Tickets are short-lived, one-use, bounded, and served
with `Cache-Control: no-store`; they contain no session or provider credential.
Playback reports are fixed-enum payloads accepted only from the current guidance
renderer main frame. Timing logs contain IDs, counts, status, and fixed reasons,
not guidance text, provider bodies, credentials, or audio bytes.

The Tro device credential is deliberately not a JWT. Tokens contain no user
claims and are useful only through the API; PostgreSQL-backed digest lookup
supports immediate revocation and rotation. Public endpoints reject browser
origins, validate content types and body sizes, apply rate limits, return
generic errors, and emit logs without identity tokens, provider keys, task text,
or model output.

Every hosted paid request is bound to an authenticated user, request UUID, task
UUID, server-owned price-catalog version, and transactional reservation before
provider dispatch. The client cannot provide prices, usage, limits, or
settlement state. Explicit pre-inference rejection may release a reservation;
an ambiguous dispatch retains it and is never retried automatically. Usage rows
contain IDs, lane/model, counts, integer micro-USD, disposition, and timestamps
only—never prompts, outputs, screenshots, base64, URLs, recipients, file paths,
secrets, or raw tool arguments.

Custom companion generation is available to every authenticated account with
an active membership. It has no per-feature switch or account allowlist; the
global paid-call switch remains the shared provider shutdown. ZDR on the exact
OpenAI project/key is a deployment requirement. The desktop never receives the
OpenAI key, and callers cannot override the fixed image model, one-output,
square low-quality PNG, transparent-background, or automatic-moderation
controls. Logs and usage rows never contain source bytes, prompts, or generated
PNG bytes.

Source images are limited to one PNG or JPEG of at most 5 MiB and a 1–400
character prompt. Electron main verifies the image signature and dimensions,
normalizes it before upload, keeps generated candidates in memory for ten
minutes, and encrypts only an explicitly activated 128-pixel PNG with
`safeStorage`. Account changes clear candidate and appearance state. The private
`trocode-companion` protocol serves only exact candidate or active asset URLs
with `Cache-Control: no-store`; it exposes no filesystem path or generic fetch
capability.

Every nonterminal task exposes a renderer **Stop task** control, and the trusted
main process registers **Escape** system-wide while work is active. Cancelling
does not undo an action already accepted by an external system. A stale worker
result is rejected. Loss after executing is recorded as unknown and blocks
completion rather than replaying the action.

## Release requirements

Before distributing the application:

1. Define a strict Content Security Policy without development localhost exceptions.
2. Sign and notarize macOS builds.
3. Sign Windows installers.
4. Run dependency, secret, and packaged-application security checks.
5. Test permission upgrades, revocation, and app restarts on clean machines.
