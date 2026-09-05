https://github.com/user-attachments/assets/ab86a7a6-d9e1-4645-bd5e-9090b13950b9

# Tro

Tro is a cross-platform, general-purpose agent foundation. Hosted Everyday and
Workspace tasks run through one Rust agent engine and Tro's authenticated
backend. The Electron process is a typed UI/native-device adapter; it does not
replace an unavailable Rust runtime with a second engine.

Read the [privacy policy](PRIVACY.md), [code signing policy](CODE_SIGNING_POLICY.md),
the [security model](docs/security.md), and the
[Knowledge Spaces guide](docs/knowledge-spaces.md).

The desktop application uses Electron, React, TypeScript, and [CUA Driver](https://github.com/trycua/cua). It is domain-agnostic and goal-driven. Registered tools run automatically after protocol, schema, technical-prerequisite, and execution-ownership checks. Tro does not add a per-action approval gate.

## Current status

Implemented:

- Feature-flagged Knowledge Spaces with a private versioned Library, reusable
  Activities, Teacher-managed rosters and groups, live/async/hybrid Runs,
  private Attempts, starter Workspaces, scoped source search, explicit
  submissions, and evidence-based facilitator dashboards. PostgreSQL is
  authoritative; no manifest or Firebase is required.

- Live classroom rooms built on the same Run and Attempt model: teacher-only
  material publishing, short-lived room admission, lobby/start/end lifecycle,
  typed exercise and safe-link broadcasts, sticky student Activity context,
  explicit Help/Check/Ready/Submit actions, and teacher Complete/Return review.
  This release records lifecycle facts only—no cursor, typing, or continuous
  screen observation.

- Secure Electron main/preload/renderer separation.
- One durable Rust model/tool loop for multilingual reasoning, writing,
  desktop work, and installed tools, with replayable lifecycle events.
- An explicit Workspace mode backed by a canonical user-selected root and
  trusted local shell and patch adapters. Bounded shell commands run with the
  host user's capabilities; provider credentials remain backend-only.
- A trusted model-visible Tro tool registry plus CUA's live, schema-validated
  driver catalog; compatible new CUA tools require no Tro allowlist change.
- Typed task lifecycle with guarded transitions.
- Task-scoped clarification replies that continue the same goal conversation.
- Structured clarification interactions when a material choice is missing.
- Task steering applied by Rust at the next safe model boundary.
- Rust-owned concrete Tro tool/operation and target validation, plus exact
  per-worker CUA catalog-digest binding.
- Native Google OAuth sign-in with Authorization Code + PKCE, Rust-side code
  exchange, server-verified identity claims, and an operating-system-encrypted,
  revocable hosted session.
- Text-first workspace readiness; microphone and computer permissions are
  optional and requested only when their feature is used.
- Hosted production access for signed-in users, with membership and plans
  authorized by the Rust API.
- Permission-free CUA catalog discovery when the worker connects, with native
  CUA execution initialized only when a computer tool actually runs or the user
  explicitly chooses Connect computer.
- Host-owned, task-scoped CUA sessions. Tro injects the task session and forwards
  every compatible driver tool except session start/end through `callTool`.
- One configured GPT-5.6 model through the Responses API (Luna by default),
  with no classifier or fallback request after a failure.
- API-owned Free, Basic, Pro, and Max entitlements with atomic agent-message and
  integer micro-USD reservations before any paid provider dispatch.
- One resized current screenshot per visual sample, bounded context, and a
  4,000-token output ceiling.
- Rust-owned model → tool → result continuation with host-owned
  tool/time limits, cancellation, safe steering, post-action screenshots, and
  no repeat after unknown results.
- Direct public HTTPS navigation and fresh-observation validation for visual
  CUA actions.
- Explicit Dictation and Task push-to-talk modes with local VAD, bounded PCM
  WAV segments, and upload-based `gpt-transcribe` transcription. Dictation
  inserts text without sending; the Shift-modified Task gesture submits through
  the existing task pipeline. Voice enabled while idle creates no provider
  audio session.
- Every grounded `show_guidance` step has one narration attempt. Optional
  ElevenLabs `eleven_flash_v2_5` audio streams progressively through a private,
  one-time Electron media URL; unavailable or slow startup falls back once to
  local system speech and never blocks the desktop task.
- Railway-hosted Responses, GPT Transcribe, and optional ElevenLabs
  access; provider keys are never compiled into or stored by the customer
  application.
- A fixed, click-through action cursor buddy that follows the real operating-
  system pointer independently from the desktop pet. When local computer use
  moves the pointer, the buddy follows the performed action; it does not replace
  or recolor the operating-system cursor.
- A custom desktop pet generator in Settings: any signed-in user with an
  active membership can edit one PNG/JPEG through the hosted OpenAI Images API,
  preview it in memory, and activate an account-scoped, operating-system-
  encrypted local PNG. A Codex-style picker switches between the animated Tro
  default and previously generated pets without spending another preview.
  Every plan receives five generations per UTC month.
- A stateful animated desktop pet with distinct idle, guidance, voice,
  thinking, sending, working, completion, and error poses. Long-running tasks
  may show sparse curated local status messages, and idle pointer hover triggers
  a click-through reaction without recording or transmitting coordinates.
  Reduced-motion mode freezes a representative pose. Wayland keeps lifecycle
  animation but disables hover because Electron does not expose cursor position
  there.
- PostHog product analytics for count-only app, model, and tool activity; task
  text, voice transcripts, screenshots, and tool arguments are excluded.
- Account-scoped PostgreSQL task history that saves the latest validated task
  snapshot and immutable lifecycle events, then restores History and Insights
  after restart.
- Streamed draft text, bounded live activity and optional plan history, explicit
  Everyday/Workspace selection, goal-driven execution, and always-available
  Stop/Escape cancellation.
- Unit tests and cross-platform CI definition.

Current computer-context support and limits:

- Compatible CUA builds use browser semantics or native-window accessibility
  before screenshots, with opaque observation-local element references. Canvas
  editors, ambiguous windows, unsupported apps, and incomplete accessibility
  trees fall back to window or full-desktop vision.
- CUA runs in its unrestricted trusted-host mode without a Tro action-approval
  gate. The driver still rejects capabilities that its own contract does not
  expose. Tro does not ship a browser or VS Code extension, so unsaved editor
  buffers and diagnostics are available only when the browser or operating-
  system accessibility surface exposes them.

Not implemented yet:

- Production application allowlists beyond current-window selection and the
  explicit exclusion of Tro's own windows.
- Calendar and general third-party connector catalog expansion beyond the
  canary Gmail MCP pilot.
- Persistent screenshot-rich execution trajectory storage.
- General-purpose media/music generation providers and release-credential
  provisioning. Custom cursor companion edits are the only implemented media
  generation path.

Music and other creative work can already be performed through an installed or
browser-based application using navigation, visible guidance, clicks, hotkeys,
typing, scrolling, and drag. Tro does not yet claim to generate an MP3
directly: that requires a separately configured `music.generate` adapter, which
can be added to the registry without changing request classification.

When a host-created task reaches `ready`, Tro starts its selected task-scoped
runtime. CUA remains stopped unless the agent requests a desktop tool.
The visible **Stop task** control and
**Escape while Tro is focused** can cancel a server-cancellable task. Escape is
suppressed for editors, modals, and permission waits, and is never registered
system-wide. The loop observes after every state-changing visual action. OS
permission or provider OAuth setup can pause execution, but registered actions
do not pause for a Tro approval card.

## Requirements

- Node.js 24 or newer.
- npm 11 or newer.
- Rust 1.97.1 with Cargo (the pinned hosted-backend toolchain).
- Docker Desktop with Docker Compose v2 for local PostgreSQL.
- macOS 13+ or a supported 64-bit Windows environment for CUA.
- macOS development requires Accessibility and Screen Recording permissions.
- Bazelisk and rustup are required only when changing the Rust backend. The
  repository pins Bazel 9.2.0 and Rust 1.97.1 automatically.

## Start locally

```bash
npm install
npm start
```

`npm start` starts the loopback-only PostgreSQL container, waits for its health
check, and then launches Electron. The named Docker volume keeps task history
between container restarts. Use `npm run db:down` to stop the container without
deleting its data.

On first launch, sign in with Google and choose a language. Text work is then
available immediately. Push-to-talk requests microphone access when used.
System-wide Dictation needs Accessibility so Tro can insert text into the
frontmost external window; it does not need Screen Recording. Full computer use
continues to require Accessibility and Screen Recording. System Settings opens
only from an explicit user action, and the app rechecks grants when it regains
focus.

The registration attempt is controlled by the trusted Electron main process. It
creates a hidden, sandboxed renderer with its own in-memory session, starts a
real display-media stream, waits for its first frame (or a short bounded
fallback), and then stops every track. The temporary session accepts only that
window's main-frame request; captured images and source details are never
exposed to the application renderer.

For macOS permission testing, use the packaged `Tro.app`. Raw `npm start`
runs through Electron's development host, whose separate identity can appear as
`Electron` in Privacy & Security and does not represent the shipped app's grant.
The packaged application uses the stable bundle identifier
`com.trocode.desktop`; production releases must keep that identifier and use a
consistent Apple signing identity so macOS can preserve grants across updates.
Local packages fall back to an ad-hoc signature so they remain launchable, but
an ad-hoc build is not an authoritative test of automatic TCC registration or
grant persistence. Set `TROCODE_MACOS_SIGNING_IDENTITY` to the installed
Developer ID Application certificate name for distributable macOS builds;
those builds retain hardened runtime signing and a stable code requirement.

### Environment and Doppler

The default `npm start` command runs Electron through the `tro-app` project and
`dev` config in Doppler, then uses npm to resolve the project-local Electron
Forge executable. The project and config are explicit in the script, so startup
does not depend on a machine-local Doppler selection. Configure these values:

```bash
doppler secrets set TROCODE_API_BASE_URL GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_OAUTH_PROJECT_ID
npm start
```

Companion speech is optional. To use ElevenLabs credits, also configure
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`. Everyday agent sampling defaults
to `gpt-5.6-luna` and never falls back to a second model. See the
[inference cost lifecycle](docs/inference-cost-lifecycle.md) for the text,
screen, reservation, settlement, and presentation flow.

Paste the value at Doppler's prompt, then enter a line containing only `.`.
Doppler injects the public configuration while Electron Forge builds and starts
the app. Provider keys stay only in the hosted API. A desktop OAuth client
secret is public-client configuration rather than an authorization credential;
the user session itself is encrypted with Electron `safeStorage` and never
crosses into the renderer.

For a machine that is not linked yet, run:

```bash
doppler setup --project tro-app --config dev
```

`npm start` and the local database scripts use the explicit Doppler
`tro-app/dev` configuration. Release scripts (`npm run package`, `npm run make`,
and `npm run publish`) use `tro-app/prd`; `npm run package:dev` and
`npm run make:dev` remain available for local packaged-build testing. Copy
`.env.example` only as a reference; never commit a populated environment file.

The production desktop build receives public build-time configuration such as
the Google desktop OAuth client metadata, PostHog project token, and
`TROCODE_API_BASE_URL`. Do not compile `OPENAI_API_KEY`,
`ELEVENLABS_API_KEY`, `DATABASE_URL`, or database passwords into the desktop
application. Those secrets belong only in the hosted API's Railway runtime;
Doppler `tro-app/prd` is their administrative source.

### Shared test environment

Run `npm run start:test` on both computers to connect the local desktop to the
shared Railway test API using Doppler `tro-app/stg`. It starts **Tro Test** with
separate login storage; no local API or Docker is required. See the
[two-computer test guide](docs/testing/shared-test-environment.md) for initial
setup, teacher/student roles, and `npm run package:test`.

### Hosted production API

The production API runs at
`https://api-production-3022a.up.railway.app` with a separate Railway
PostgreSQL service. `GET /healthz` checks process liveness and `GET /readyz`
checks database readiness. Railway builds from the repository root so Railpack
can read the shared Cargo workspace, then uses
[`services/api/railway.json`](services/api/railway.json) to start the API and
apply its idempotent migrations before accepting traffic. The root
[`railpack.json`](railpack.json) forces Rust provider selection even though the
Electron frontend keeps its root `package.json`.

The hosted backend is the locked Rust `trocode-api` binary. Railway's checked-in
service configuration starts `./bin/trocode-api serve`; the ingestion service
uses [the worker configuration](services/api/railway.worker.json) to start the
same artifact with the `ingestion-worker` command. Deployment and rollback gates
are documented in the
[same-service runbook](docs/operations/rust-backend-cutover.md).

The protected web admin at `/source/admin` is a static React and TypeScript
client built from [`apps/admin`](apps/admin). Its generated assets are embedded
in `trocode-api`, so Railway does not need a separate frontend or Next.js
service. Run `npm run admin:build` after changing the admin source.

Run the backend locally with:

```bash
cargo run --manifest-path services/api/Cargo.toml --locked -- serve
```

Run its unit/contract tests with `npm run api:test`, or the complete Electron and
Rust-backend gate with `npm run check`.

At sign-in, the bundled Rust engine exchanges the PKCE code and verifies the
nonce, then the hosted Rust API independently verifies Google's signed claims
and exchanges them for a random opaque device session. Tro does not issue a
JWT. Only a HMAC digest of the device token is
stored in PostgreSQL, enabling expiration, rotation, and immediate sign-out
revocation. The desktop stores the token with operating-system encryption.

The API requires these production variables:

- `DATABASE_URL`, supplied through a Railway reference to PostgreSQL
- `GOOGLE_OAUTH_CLIENT_ID`
- `OPENAI_API_KEY`
- `TROCODE_SESSION_TOKEN_HMAC_KEY`
- `TROCODE_AGENT_MODEL`
- `TROCODE_COST_GUARD_MODE` (`enforce` by default; `observe` is available for
  reconciliation)
- optional server-owned budget overrides documented in `.env.example`
- optional `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and
  `ELEVENLABS_MODEL_ID`
- optional canary-only connector configuration documented in
  `docs/connectors.md`; connector OAuth credentials and encryption keys are
  separate from Google identity sign-in and agent-state encryption

Provider endpoints require the opaque session, atomically reserve spend before
dispatch, enforce per-user message/task/day/month limits and bounded bodies,
restrict Responses models to the configured allowlist, and keep `store: false`.
Burst limits use shared PostgreSQL buckets, so adding API replicas does not
multiply an allowance. The API stores sanitized usage counts and integer cost,
but never task prompts, model responses, screenshots, or desktop actions.
The bundled local Agents SDK process selects only the tools Electron freezes for
the turn. Electron binds the graph/catalog, encrypts SDK state, and journals
exactly-once native execution; Rust binds authenticated provider requests to
server-owned budgets and accounting.

#### Custom companion availability

Companion image generation is available to every signed-in account with an
active membership. It has no companion-specific feature flag or user allowlist;
the global paid-call switch remains the emergency shutdown for every hosted
model call. Each account receives five successful or uncertain generations per
UTC month, with a separate two-request-per-minute abuse limit and a fixed
50,000 micro-USD reservation per attempt. Definitive pre-inference rejection
releases a slot; an outcome that may have reached the provider remains counted
and is never retried automatically.

Before deploying, verify the exact OpenAI Images model and project, enable ZDR
on that project/key, complete privacy and child-safety review, test moderation,
and reconcile provider usage against Tro's integer micro-USD settlements.
Existing encrypted custom images continue rendering when the global paid-call
shutdown prevents new provider calls.

### PostgreSQL task history

PostgreSQL belongs exclusively to the Rust API. Local development may start the
PostgreSQL 17 container from [`compose.yaml`](compose.yaml), but Electron never
opens a database connection and never receives `DATABASE_URL`. The Rust API
owns migrations, account scoping, encrypted task state, lifecycle events, and
history projections. If the API or database is unavailable, new tasks fail
closed and History reports the hosted service as unavailable; there is no
session-only TypeScript persistence backend.

### Production access codes

Access checks are bypassed by raw local development (`npm start`). In hosted
builds, every Google account must complete the plan-choice screen after sign-in.
New access codes are organization-managed by default: one person claims the
code as organizer, then opens **Settings → Organization settings** to name the
organization and reserve the remaining seats by exact Google email. No
invitation email is sent. A person with a reserved seat joins the organization
automatically on their next verified Google sign-in and never needs to enter
the organizer's code. Users can still
explicitly continue on the Free plan and enter a promo code later from
Settings. The Free choice is stored per account so it remains complete across
devices. Packaged builds require the hosted API.

An organization seat grants plan access; it does not enroll the account in a
Class workspace. After the account is registered and an administrator assigns
the Student role, a Teacher adds it from **Class workspaces → class → People**.

Hosted builds configured with `TROCODE_API_BASE_URL` store each account's plan,
access codes, organizations, reserved seats, and code redemptions in
PostgreSQL. Organization-managed access is implemented by the Rust hosted API
and the same locked binary owns migrations and operator commands. Create codes
with the Rust operator CLI; do not insert them manually:

```bash
doppler run --project tro-app --config prd -- \
  cargo run --locked --manifest-path services/api/Cargo.toml -- \
  access-code create \
  --code CODEA \
  --max-users 10 \
  --plan basic \
  --label "Private beta batch A"
```

Omit `--code CODEA` to generate a strong random code. The command applies
pending API migrations, stores a keyed HMAC digest plus the admin-retrievable
encrypted copy, and prints the code once for secure distribution. Give that
code to the intended organizer. `CODEA --max-users 10` has ten total seats,
including the organizer;
pending email reservations and active members both consume capacity. At the
limit, the organizer sees a persistent full-capacity warning and must cancel a
pending reservation before adding another person. Active members cannot be
removed or transferred by this flow.

Legacy shared-code behavior remains available only when explicitly requested:

```bash
cargo run --locked --manifest-path services/api/Cargo.toml -- \
  access-code create \
  --max-users 10 \
  --plan basic \
  --distribution-mode shared \
  --label "Legacy shared batch"
```

Migration 021 leaves every existing code in `shared` mode and does not create
organizations for historical redemptions. Pausing an organization code blocks
its initial claim and new reservations, but preserves existing access and lets
an already-reserved verified email complete its automatic join.

The API tier catalog is the pricing and entitlement source of truth:

| Plan  | Recommended price | Agent messages/week | Provider-cost cap/month | Responses RPM | Companion images/month |
| ----- | ----------------: | ------------------: | ----------------------: | ------------: | ---------------------: |
| Free  |                $0 |                  25 |                      $1 |            15 |                      5 |
| Basic |               $20 |                 300 |                      $8 |            30 |                      5 |
| Pro   |               $50 |                 750 |                     $20 |            45 |                      5 |
| Max   |              $100 |               1,875 |                     $45 |            60 |                      5 |

#### Admin dashboard

Set a unique, random `TROCODE_ADMIN_ACCESS_TOKEN` of at least 32 characters in
the hosted API environment to enable the separate dashboard at
`/source/admin`. The raw token is used only for login; the server then issues a
signed, `HttpOnly`, `Secure`, `SameSite=Strict` browser session that lasts for
30 days or until the administrator selects **Lock**.

The dashboard lists registered users, their current plans
and access status, can grant an available code directly to an unlinked user,
can block or unblock an account, and can generate 1–100 codes in a batch. On
the Rust API those dashboard-created batches default to organization-managed;
use the Rust CLI when an explicit shared code is required. The Rust admin API
also exposes assigned, active, and pending seat counts and rejects grants of an
already claimed organization code. Blocking an account immediately revokes all
of its device sessions and prevents new sessions from being issued.
Access-code verification uses keyed HMAC digests; new codes also keep an
AES-256-GCM encrypted copy for authenticated admin retrieval. Legacy digest-only
codes remain valid but cannot be displayed. An administrator can pause or
resume any code without changing existing users' access. Permanent deletion is
limited to unused codes so redemption history cannot be removed accidentally.

One agent message is one accepted user turn: the initial request, a clarification
answer, or a steering message. The desktop sends its message UUID to
`POST /v1/agent-turns`; the API atomically and idempotently reserves the weekly
allowance and returns the server turn token required by `/v1/openai/responses`.
Internal model/tool continuations reuse that token and do not consume more agent
messages. Speech and transcription do not consume agent messages. A turn whose
only provider request is explicitly rejected before
inference is released; an ambiguous dispatched turn remains counted. Whichever
weekly message or monthly provider-cost limit is reached first blocks more inference.
Environment budget values are emergency ceilings and may only lower a tier's
dollar limits.

Plans are account entitlements. New accounts default to Free but must explicitly
choose that plan during onboarding; redeeming a code atomically assigns that
code's plan to the account. Existing redemptions are backfilled into the account
plan during migration. New database-level
access-code rows default to Free, while the administrator CLI requires an
explicit `--plan free|basic|pro|max`.

The API resolves the account plan again before proxying model, voice
transcription, or speech requests, so bypassing the renderer does not bypass the
quota.

### Product analytics

Set the PostHog project token and ingestion host in Doppler, or in an ignored
local environment file when using `npm run start:local`. Analytics is disabled
when `POSTHOG_PROJECT_TOKEN` is absent. The build injects these values into the
Electron main bundle only; the preload and renderer cannot access them.

Tro records `application opened`, `application closed`, task funnel events,
non-sensitive goal metadata, and a `voice transcription completed` event that
contains only character count, mode, destination category, and result
disposition. A durable anonymous installation ID powers DAU before sign-in;
authenticated identity is associated with the same installation and its
content-free voice events.

Typed task text, messages, voice transcript content, screenshots, URLs,
document contents, file paths, credentials, and tool arguments are not
added to analytics events.

Closing the Tro window hides it while Tro stays available from the menu
bar or system tray for background voice input. Choose **Quit Tro** there, or
press **Command+Q** on macOS, to stop the cursor buddy and desktop pet, shut
down CUA, and exit. If native shutdown does not respond, Tro forces a process
exit after a short grace period.

Choose **Write my words** or **Ask Tro** in the composer voice bar, then use
one shared hold gesture. The selected mode persists across launches and can
also be toggled in the app with **Command + Backslash** on macOS or
**Control + Backslash** on Windows.

| Action | macOS | Windows |
|---|---|---|
| Talk in the selected mode | **Command + Control** | physical **left Control + left Alt** |

The selected mode locks for the full turn. Write my words adds text at the saved selection in
Tro, or inserts once into the frontmost external window after release. The
non-focusable Voice Island shows the locked mode, icon, destination, and
teal Dictation or yellow Task accent; Tro does not recolor the operating-system
cursor. Dictation never presses Enter, clicks, submits a form, or starts a task.
If the external target
changes or insertion cannot be verified, Tro does not retry; it keeps a recovery
copy in the Tro composer. External targeting is window-level in this release,
so place the text caret in the intended field before holding the shortcut. Task
retains a one-second Escape window and then sends the transcript through the
same bounded task, clarification, or steering path as typed input. Audio is sent
to the configured GPT Transcribe provider. Linux does not provide a global
voice shortcut in this version.

When `TROCODE_API_BASE_URL` is compiled into a production build, Tro enables
agent and voice access from the signed-in device session. The renderer and
Electron main never ask for or receive long-lived provider keys. OpenAI
Responses, segmented GPT Transcribe transcription, and ElevenLabs synthesis are
authenticated and proxied by Railway.

### First Gmail execution test

1. Start Tro with `TROCODE_API_BASE_URL` configured and choose **Connect
   computer** if CUA is not ready.
2. Sign in to Gmail yourself. Tro will not type passwords.
3. Enter a complete bounded request, for example: `Open Gmail, compose an
email from my work account to me@example.com with subject "Tro test"
and body "The desktop loop works".`
4. Review the compiled goal as Tro starts it automatically. Press
   **Escape** or choose **Stop task** to cancel at any time.
5. If Tro needs a material detail, answer in the same task from the main
   window or by selecting **Ask Tro** and using the shared voice shortcut.
6. Watch the live task and use Stop/Escape if needed. A registered Send action
   is dispatched at most once after a fresh observation and the durable
   requested-to-executing transition.

## Quality checks

```bash
npm run check
npm run test:coverage
npm run package
npm run bazel:check
```

`npm run bazel:check` builds, tests, formats, and lints the in-place Rust backend
candidate, including the live-classroom route family. Run it for Rust or Bazel
changes; it is intentionally not part of the Electron release workflow.

`npm run make` generates a distributable for the current operating system.
Development commands inject Doppler `dev`; package, make, and publish inject
Doppler `prd`. The release workflow requires Apple notarization and Windows
code-signing credentials before it will publish a release.

CUA installs a native package for the host OS and CPU, so build each release on
its target operating system. During packaging, Tro stages the CUA JavaScript
SDK and native libraries together outside ASAR; this preserves CUA's relative
native-library resolution in the packaged application. Electron packaging
remains owned by Forge; Bazel currently owns only targets under
`services/api` and does not create desktop installers.

### Application updates and releases

Installed macOS and Windows builds expose **Settings → Application update**.
The trusted main process checks the fixed Tro feed on
`update.electronjs.org`; the sandboxed renderer can request a check or restart,
but it cannot replace the feed URL. Available updates download in the
background and install after the user selects **Restart to update**.

To publish a release, bump `package.json`, commit the change, then push a tag
that exactly matches the version, such as `v0.2.0`. The release workflow builds
macOS arm64, macOS x64, and Windows x64 artifacts sequentially into one draft
GitHub Release, then publishes the release only after every signed artifact is
uploaded.

Configure these GitHub Actions secrets before pushing a release tag:

- `DOPPLER_TOKEN`
- `MACOS_CERTIFICATE_P12_BASE64`, `MACOS_CERTIFICATE_PASSWORD`, and
  `MACOS_SIGNING_IDENTITY`
- `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`
- `WINDOWS_CERTIFICATE_PFX_BASE64` and `WINDOWS_CERTIFICATE_PASSWORD`

The tag-triggered workflow above is the certificate-file release path. Tro
also provides a free open-source Windows path through SignPath Foundation. See
the [code signing policy](CODE_SIGNING_POLICY.md) for its roles and controls.
After SignPath accepts the project, configure this repository secret:

- `SIGNPATH_API_TOKEN`

Configure these repository variables using the values created in SignPath:

- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`
- `SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG`
- `SIGNPATH_INSTALLER_ARTIFACT_CONFIGURATION_SLUG`

Import [`signpath/windows-app.xml`](signpath/windows-app.xml) and
[`signpath/windows-installer.xml`](signpath/windows-installer.xml) as the two
artifact configurations. Install the SignPath GitHub App for this repository,
restrict the signing policy to `main`, require manual approval, and then run
**Windows SignPath release**. The workflow signs the packaged app first and the
installer second, verifies both signatures, and publishes the stable release.

The first updater-enabled build still requires a normal manual installation.
After that bootstrap release, future published versions can be installed from
inside Tro. Linux continues to use its package manager because Electron's
native updater supports only macOS and Windows.

For a Windows-only customer build, run **Windows build and release** from the
GitHub Actions page. Leave `publish_release` disabled to receive a private CI
artifact. Enable both `require_signing` and `publish_release` to verify the
Authenticode signature and publish the Squirrel installer, full package,
`RELEASES` manifest, and SHA-256 checksums as `v<package.json version>`. Bump
`package.json` before each published run; an existing version is never
overwritten. Published assets are consumed by both the installed-app updater
and the Tro website's latest-release download routes.

Before SignPath approval, that workflow can also publish a clearly labeled
unsigned prerelease solely as the public artifact sample required by the
SignPath Foundation application. It must not be presented as a trusted customer
release; Windows will warn when it is installed. Stable customer releases use
the SignPath workflow or the certificate-file workflow above.

For macOS CI, run **macOS build and release**. The workflow builds separate
Apple silicon (`arm64`) and Intel (`x64`) ZIPs on native GitHub-hosted runners,
checks each application bundle, writes SHA-256 checksum files, and retains the
artifacts for 30 days. Leave `publish_release` disabled for a private CI build.
To add the ZIPs to a shared desktop prerelease, set `source_ref` and
`release_tag` to that existing tag, enable `publish_release`, and—until Apple
credentials are configured—explicitly enable `allow_unsigned_preview`.
Unsigned, unnotarized Mac builds are previews and may be blocked by Gatekeeper;
the workflow will never attach one to a stable release. Once all six Apple
secrets listed above exist, enable `require_signing` to require Developer ID
signing and notarization before upload.

## Architecture

```text
React renderer
  -> typed preload API
    -> trusted Electron IPC
      -> Google OAuth service / encrypted local session
      -> bundled OpenAI Agents SDK utility process (sole reasoning loop)
        <-> encrypted local SDK state + trusted CUA/Workspace tool bridge
        -> authenticated Rust model/budget/provider proxy
      -> bundled trocode-api desktop engine (OAuth + voice transport)
      -> PostHog analytics service (allowlisted metadata only)
      -> local PCM/VAD voice capture
        -> bundled Rust engine -> bounded GPT Transcribe API
      -> CUA service
        -> native CUA runtime
```

The renderer cannot import Node, Electron, CUA, or filesystem APIs. Every message crosses a narrow preload contract and is validated again in the main process.

Read:

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/computer-use-lifecycle.md`](docs/computer-use-lifecycle.md)
- [`docs/security.md`](docs/security.md)
- [`docs/conversational-task-execution.md`](docs/conversational-task-execution.md)

## Repository map

```text
src/
├── main/
│   ├── agent/       local task lifecycle and native tool adapters
│   ├── agent-runtime/ encrypted state and utility-process supervision
│   ├── engine/      private Rust desktop-engine process bridge
│   ├── analytics/   privacy-safe PostHog events and durable identity
│   ├── workspace/   canonical folder selection and opaque root binding
│   ├── cua/         permission-aware CUA lifecycle
│   └── ipc/         trusted renderer boundary
├── renderer/        React desktop interface
├── shared/          Zod schemas and typed preload contract
├── index.ts         Electron main entry
├── preload.ts       minimal renderer API
└── renderer.tsx     React entry
bazel/
└── rust/             shared first-party Rust lint and check macros
services/
├── agent-runtime/    bundled OpenAI Agents SDK utility process
└── api/              Rust auth/provider API, migrations, commands, and tests
Cargo.toml            Rust workspace dependency source
MODULE.bazel          Bazel module and Rust toolchain graph
```

## Design rule

GPT chooses between assistant text and host-advertised tools, but it cannot add
tools or bypass their schemas. Tro base tools are registered explicitly; CUA
tools come from the driver's canonical catalog and are bound to a per-worker
digest. The main process owns session lifecycle, parsing, public-target checks,
technical prerequisites, exactly-once execution, cancellation, and limits. CUA
is one lazy execution adapter behind that boundary.
