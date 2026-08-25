# Plan: Custom Cursor Companion Image Generation

## Summary

Add a **Cursor companion** card to Settings where a signed-in student can paste or choose a PNG/JPEG reference, add a short customization prompt, generate one low-quality square companion through Tro's hosted OpenAI Images proxy, preview it, and explicitly activate it. Each authenticated account receives five completed companion generations per UTC calendar month; the limit and provider spend are reserved atomically in the existing model-usage ledger.

The generated companion is the existing 44px pet that follows the cursor, not the operating-system pointer. Source bytes and prompts remain transient, the generated preview lives only in Electron main memory, and the activated 128px PNG is encrypted and isolated by account in Electron `userData`.

## User Story

As a student, I want to turn an image and a short prompt into my own Tro cursor companion, so that Tro feels personal while I work without exposing an unrestricted or expensive image generator.

## Problem -> Solution

Tro always renders the bundled `tro-cursor-buddy.png`, so students cannot personalize the companion they see throughout a session. -> Add a bounded Settings workflow that performs one reference-image edit, previews the result, applies it to the existing companion overlay, persists only the chosen output locally, and enforces five generations per account per UTC month.

## Product Decisions Locked by This Plan

- Interpret the request as **five successful generations per authenticated account per UTC calendar month**.
- A reservation counts while a generation is in flight. `settled` and completion-`uncertain` calls consume a slot; a definitive pre-inference rejection or moderation block releases it. This prevents concurrency races and ambiguous retries while still matching "five generated" in ordinary use.
- All Free, Basic, Pro, and Max accounts receive the same limit of five. Plan access must still be active.
- Generation uses the pinned `gpt-image-2-2026-04-21` snapshot via `POST /v1/images/edits` with one input PNG, `quality=low`, `size=1024x1024`, `background=transparent`, `output_format=png`, `moderation=auto`, and `n=1`.
- The fixed system prompt requires one centered, friendly, text-free, high-contrast character with a clean silhouette that remains legible at 29-44px. The user's prompt is a delimited customization detail and cannot override size, count, moderation, model, or background settings.
- A result is not activated automatically. It is a ten-minute, account-bound, main-memory candidate until the user selects **Use this companion**.
- Clicking **Use default companion** removes the current account's local custom output. Generating and then discarding a preview does not refund a slot.
- The source image and prompt are not written to local disk, PostgreSQL, analytics, or application logs. The chosen output is stored only on that device, encrypted with Electron `safeStorage`.
- The launch gate is fail-closed for a student product: the hosted feature defaults off, requires an operator assertion that the OpenAI project has Zero Data Retention enabled, and is limited to an explicit account allowlist whose consent/eligibility was established outside this feature. Clicking Generate is not treated as legal guardian consent.

## Metadata

- **Complexity**: XL
- **Source PRD**: N/A
- **PRD Phase**: N/A (standalone)
- **Estimated Files**: 44
- **Estimated Tasks**: 10
- **New Dependencies**: None; use Node 24 `fetch`/`FormData`/`Blob`, Electron 43 `nativeImage`/`protocol`/`safeStorage`, current React/Zod/PostgreSQL patterns

---

## UX Design

### Before

```text
Settings
  Plan access
  App interface / task safety / voice
  Application update

Cursor companion
  Always renders bundled tro-cursor-buddy.png
```

### After

```text
Settings
  Plan access
  Cursor companion                                      3 of 5 left
  +--------------------------------------------------------------+
  | Current companion        Paste or choose a PNG/JPEG          |
  |      [pet]               [ reference preview / drop zone ]   |
  |                          "Make it a blue space cat"  31/400  |
  |                          [ Generate companion ]               |
  |                                                              |
  | Candidate preview: [new pet] [Use this companion]            |
  | Input + prompt go to OpenAI; Tro does not save either.       |
  +--------------------------------------------------------------+
  App interface / task safety / voice
  Application update

Cursor companion
  Receives an appearance event and swaps to the encrypted local asset
  without recreating the transparent companion window.
```

### End-to-End Data Flow

```text
PNG/JPEG + prompt
  -> sandboxed Settings renderer (source preview in memory)
  -> schema-bounded preload IPC
  -> Electron main validates, decodes, and normalizes source to <=1024px PNG
  -> authenticated Tro API request with UUID; no automatic retry
  -> atomic image-generation slot + micro-USD reservation
  -> OpenAI Images edit (one low-quality transparent PNG)
  -> settle provider usage; return base64 PNG without persistence
  -> Electron main validates/downsizes to 128px and keeps a 10-minute candidate
  -> trocode-companion:// preview
  -> explicit Use action
  -> safeStorage-encrypted account-scoped active asset
  -> companion appearance event -> existing 44px overlay
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Settings landing | Language, autonomy, voice, membership, update | Adds a dedicated Cursor companion card below plan access | This is independent of the generic Save preferences form. |
| Image input | No image customization | Paste, drop, or browse for one PNG/JPEG up to 5 MiB | Clipboard/file bytes stay in renderer memory until Generate. |
| Prompt | None | Required, trimmed 1-400 characters with counter | User text cannot control provider parameters. |
| Generate | None | One explicit click starts one request and shows a potentially two-minute progress state | Disable while busy, at zero remaining, or when rollout/storage is unavailable. No automatic retry. |
| Candidate | None | Preview with **Use this companion** | Candidate expires after ten minutes or on sign-out/restart/new generation. |
| Active companion | Bundled PNG | Bundled PNG or account-scoped custom PNG | Appearance swaps live; animation/state/ring behavior remains unchanged. |
| Reset | None | **Use default companion** removes the account's custom asset | Does not restore or refund prior generations. |
| Quota | None | Remaining/used count and exact UTC reset date | Server is authoritative; client never decrements optimistically. |
| Unavailable/error | N/A | Concise localized reason and retained current companion | Moderation, quota, connectivity, and rollout errors are distinct and actionable. |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `AGENTS.md` | all | Renderer sandbox, narrow `DesktopApi`, boundary parsing, no ambiguous consequential retry, and required verification. |
| P0 | `src/shared/contracts.ts` | 1575-1665, 1715-1750, 1940-1970 | Zod contract placement, companion schemas, private media scheme convention, auth types. |
| P0 | `src/shared/desktop-api.ts` | 65-125, 150-345 | IPC channel naming and the separate `DesktopApi` versus `CompanionApi` surfaces. |
| P0 | `src/preload.ts` | 1-110 and existing method/listener implementations | Parse input before invoke, parse output after invoke, remove listener on cleanup. |
| P0 | `src/main/ipc/register-ipc.ts` | 55-145, 215-330, 540-700 | Trusted sender and membership authorization gates, auth lifecycle hooks, handler cleanup. |
| P0 | `src/index.ts` | 150-260, 875-905, 1350-1370, 2395-2475 | Service composition, custom protocol registration, auth-owner binding, companion window lifecycle. |
| P0 | `src/renderer/CursorCompanion.tsx` | 1-56 | Current static image and companion state/position subscriptions. |
| P0 | `src/renderer/SettingsPage.tsx` | 20-44, 76-130, 123-401 | Settings props, card order, translation calls, status/error semantics. |
| P0 | `src/renderer/App.tsx` | 840-930, 1110-1170, 1340-1420, 2190-2270 | Settings state loading and handler ownership. |
| P0 | `services/api/src/openai-transcription-service.mjs` | 138-305 | Closest one-shot provider proxy: bounds, reserve/dispatch/settle, uncertain failure, no retry, content-free log. |
| P0 | `services/api/src/usage-repository.mjs` | 1-120, 130-265, 267-379 | Atomic per-user advisory lock, reservation lifecycle, sanitized settlement, monthly aggregation. |
| P0 | `services/api/src/budget-service.mjs` | 1-146, 212-247 | Entitlement/cost authorization and error mapping. |
| P0 | `services/api/src/server.mjs` | 297-330, 667-721 | Authenticated route dependency injection, browser-origin rejection, exact-body validation, rate limiting. |
| P1 | `services/api/src/model-catalog.mjs` | all | Versioned integer micro-USD pricing and bounded token validation. |
| P1 | `services/api/src/plan-catalog.mjs` | all | API-owned entitlements for every plan. |
| P1 | `services/api/src/config.mjs` | 1-45, 45-105, 106-260 | Boolean/list parsing and fail-closed feature configuration. |
| P1 | `src/main/auth/auth-session-store.ts` | 1-69 | Existing async `safeStorage` availability/encryption/key-rotation behavior. |
| P1 | `src/main/knowledge/activity-workspace-preparation-service.ts` | 58-110 | Create-first/cleanup-later filesystem writes with restrictive modes and failure cleanup. |
| P1 | `src/main/voice/companion-narration-service.ts` | 109-215 | Main-owned private protocol descriptors, bounded tickets, method/path validation, `Response` handling. |
| P1 | `src/index.html` | 9-12 | CSP currently permits only self/data images and must explicitly allow the new scheme. |
| P1 | `src/index.css` | 1968-2030, 3848-4025 | 44px image constraints and Settings card styles. |
| P1 | `PRIVACY.md` | all | Provider/local storage disclosures that must match the new data flow before launch. |
| P1 | `docs/security.md` | 81-144 | Sensitive-data rules and private protocol documentation style. |
| P1 | `docs/inference-cost-lifecycle.md` | 92-135 | Reservation/uncertain semantics and usage-log prohibition. |
| P2 | `src/renderer/SettingsPage.test.ts` | all | Node-environment React static-markup test pattern. |
| P2 | `services/api/test/openai-transcription-service.test.mjs` | 96-218 | Provider form assertions, lifecycle order, and single-fetch failure tests. |
| P2 | `services/api/test/integration/knowledge-postgres.test.mjs` | all | Optional real-PostgreSQL test using `TEST_DATABASE_URL` with a clean skip. |

`docs/CODEX-NAVIGATION-GUIDE.md` is referenced by the repository supplement but is not present in this worktree; do not block implementation on it.

## Unified Discovery Table

| Category | File:Lines | Pattern | Key Snippet / Implication |
|---|---|---|---|
| Similar UI | `src/renderer/SettingsPage.tsx:123-401` | Settings is a stack of independent `.settings-card` sections | Insert a companion card after membership and before the preferences form. |
| Similar overlay | `src/renderer/CursorCompanion.tsx:1-56` | Image is a leaf inside state-driven rings/animations | Change only image URL subscription; retain all state/position code. |
| Naming | `src/main/voice/companion-narration-service.ts:63-107` | PascalCase service, typed options, injected clock/logger/providers | Name service `CompanionCustomizationService`; inject native image, safe storage, fetch, clock, and paths for tests. |
| Boundary types | `src/shared/contracts.ts:1586-1654` | Export Zod schema then inferred TS type | Define all request/status/appearance/candidate schemas centrally. |
| IPC | `src/preload.ts` and `src/main/ipc/register-ipc.ts` | Parse on both sides and expose narrow functions | Never expose raw filesystem, protocol handler, auth token, or provider client. |
| Authorization | `src/main/ipc/register-ipc.ts:245-330` | Main-window identity and membership are checked per handler | Generation/status/activate/reset all use the current authenticated main window; generation also requires active membership. |
| Local encryption | `src/main/auth/auth-session-store.ts:27-69` | Async OS-backed `safeStorage`, mode `0600`, fail if unavailable | Preflight encryption before spending a generation; store only chosen PNG. |
| Private media | `src/main/voice/companion-narration-service.ts:197-215` | Exact GET/HEAD protocol handling with opaque IDs | Serve only the signed-in account's active hash or unexpired candidate UUID; never accept a path. |
| Provider proxy | `services/api/src/openai-transcription-service.mjs:157-305` | Validate -> reserve -> mark dispatched -> fetch once -> release/uncertain -> settle | Mirror exactly for Images edits. |
| Atomic quota | `services/api/src/usage-repository.mjs:30-120,304-318` | Per-user advisory transaction lock precedes aggregate and insert | Count image-generation lanes inside the same reservation transaction; no separate counter table. |
| Error handling | `services/api/src/openai-transcription-service.mjs:210-259` | Definitive 4xx releases; network/5xx/malformed success is uncertain; no retry | Preserve both spend and monthly-slot correctness under ambiguity. |
| Logging | `services/api/src/openai-transcription-service.mjs:284-298` | JSON metadata only, no content | Log byte count, duration, usage, model, request ID, quota remaining; never prompt/base64/output/hash. |
| Config | `services/api/src/config.mjs:41-43,59-74` | Exact boolean values and deduplicated comma lists | Add disabled-by-default, ZDR assertion, and eligible-user allowlist; reject unsafe enabled config. |
| Tests | `services/api/test/openai-transcription-service.test.mjs:112-218` | Inject fetch and record lifecycle calls | Assert exact multipart provider fields and fetch count `1`. |
| Renderer tests | `src/renderer/SettingsPage.test.ts:1-43` | `renderToStaticMarkup` in Node | Test available/exhausted/candidate/unavailable card markup without adding jsdom. |

---

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Image API selection and edits | [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation) | The Image API is the best fit for one prompt/one image; edits accept reference images and return base64 output without paying for a mainline Responses model. |
| GPT Image 2 model | [GPT-Image-2 model page](https://developers.openai.com/api/docs/models/gpt-image-2) | Pin `gpt-image-2-2026-04-21`; the model supports image edit and generation endpoints and high-fidelity image input. Organization verification may be required. |
| Output parameters | [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation#customize-image-output) | `quality=low` is intended for fast drafts/thumbnails, square output is typically fastest, and transparent background is preview-only and requires PNG/WebP. Complex jobs may still take up to two minutes. |
| Image response/usage | [OpenAI Images API reference](https://developers.openai.com/api/reference/resources/images) | Validate `data[0].b64_json` plus `usage.input_tokens_details.image_tokens`, `.text_tokens`, and `usage.output_tokens`; GPT image URLs are not the transport. |
| Moderation | [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation#content-moderation) | Keep `moderation=auto`; never expose the less restrictive `low` setting to students. Handle `moderation_blocked` as a definitive non-generation. |
| Current pricing | [OpenAI API pricing](https://platform.openai.com/pricing) | Dated catalog values: text input $5/M, image input $8/M, image output $30/M for GPT Image 2. A low 1024 square output is about $0.006 before input tokens. |
| Retention | [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint) | Images edits have no application-state retention and GPT Image 2 is ZDR compatible, but ZDR must be approved/configured; image inputs flagged as potential CSAM can still be retained for manual review. API content is not used for training by default. |
| Under-18 requirements | [OpenAI Under 18 API Guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance) | Under-13/applicable-age personal data requires ZDR; deployments serving minors need age-appropriate disclosures, filters, monitoring/escalation, and applicable consent. This drives the fail-closed allowlist gate. |
| Electron image normalization | [Electron `nativeImage`](https://www.electronjs.org/docs/latest/api/native-image) | Electron 43 reliably decodes PNG/JPEG, preserves aspect ratio when one resize dimension is supplied, and emits PNG. Limit accepted source formats to PNG/JPEG. |
| Electron encrypted storage | [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) | Use async availability/encrypt/decrypt APIs; key rotation is signaled by `shouldReEncrypt`, and temporary unavailability must fail safely. |
| Electron custom protocols | [Electron `protocol`](https://www.electronjs.org/docs/latest/api/protocol/) | Register schemes before app ready and install `protocol.handle` after ready; return a `Response`. The current windows use the default session, so the app-level handler applies. |

### Research Findings in PRP Form

```text
KEY_INSIGHT: Use one Images edit rather than the Responses image-generation tool.
APPLIES_TO: Hosted provider service.
GOTCHA: Responses would add mainline model token cost and conversational state that this one-shot Settings flow does not need.

KEY_INSIGHT: Low-quality 1024px square output is appropriate for a 29-44px companion and costs roughly $0.006 in output tokens.
APPLIES_TO: Fixed provider parameters and 50,000 micro-USD conservative reservation.
GOTCHA: High-fidelity reference input still has variable image-token cost; settle from returned usage rather than treating $0.006 as total cost.

KEY_INSIGHT: Transparent GPT Image 2 output is preview functionality.
APPLIES_TO: UI copy, prompt, provider validation.
GOTCHA: Do not promise perfect background removal. Accept a valid PNG even if the model returns an opaque background.

KEY_INSIGHT: Student deployments require a stronger release gate than ordinary feature rollout.
APPLIES_TO: Hosted config, privacy copy, operations checklist.
GOTCHA: Model ZDR compatibility is not the same as an organization having ZDR enabled; account allowlisting must follow external consent/eligibility verification.

KEY_INSIGHT: Electron `nativeImage` is cross-platform for PNG/JPEG, not WebP.
APPLIES_TO: Accepted source types and normalization.
GOTCHA: Do not advertise WebP unless a separate renderer decoding path and tests are added later.
```

---

## Patterns to Mirror

These are actual repository patterns; preserve their behavior and style.

### CONTRACT_AND_TYPE_PATTERN

```ts
// SOURCE: src/shared/contracts.ts:1586-1600
export const AppLanguageSchema = z.enum(['en', 'vi']);
export const AppPreferencesSchema = z.object({
  appLanguage: AppLanguageSchema.default('en'),
  autonomyMode: AutonomyModeSchema.default('balanced'),
  muteSystemAudioWhileSpeaking: z.boolean().default(false),
  primaryLanguage: PrimaryLanguageSchema.nullable().default(null),
});
```

Define schemas first in `contracts.ts`, export inferred types near the existing type-export block, and parse at renderer/preload/main boundaries.

### PRELOAD_BOUNDARY_PATTERN

```ts
// SOURCE: src/preload.ts (existing request methods)
const request = CreateKnowledgeSpaceRequestSchema.parse(input);
const response: unknown = await ipcRenderer.invoke(
  IPC_CHANNELS.createKnowledgeSpace,
  request,
);
return CreateKnowledgeSpaceResponseSchema.parse(response);
```

Every new method parses both directions. Listener methods parse the event payload and return a function that removes exactly that listener.

### MEMBERSHIP_AUTHORIZATION_PATTERN

```ts
// SOURCE: src/main/ipc/register-ipc.ts:278-287
ipcMain.handle(IPC_CHANNELS.listKnowledgeSpaces, async (event) => {
  await assertMembershipAuthorizedSender(event, mainWindow, services);
  return services.knowledgeSpaceClient.listSpaces();
});
```

All customization methods originate only from the current main-window main frame; status/generate also require active membership so the hosted API and local boundary agree.

### PROVIDER_LIFECYCLE_AND_NO_RETRY_PATTERN

```js
// SOURCE: services/api/src/openai-transcription-service.mjs:198-215
await this.budgetService.markDispatched(input.userId, input.requestId);
let response;
try {
  response = await this.fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
    body: form,
    headers: {
      Authorization: `Bearer ${this.openAiApiKey}`,
      'OpenAI-Safety-Identifier': input.safetyIdentifier,
    },
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
  });
} catch {
  await this.budgetService.markUncertain(input.userId, input.requestId);
  throw new TranscriptionServiceError(
    502,
    'The transcription provider is temporarily unavailable. This call was not retried.',
    'ambiguous_dispatch',
  );
}
```

Image generation follows the same reserve-before-dispatch and single-fetch rule, with a 130-second timeout because image jobs may take two minutes.

### ATOMIC_REPOSITORY_PATTERN

```js
// SOURCE: services/api/src/usage-repository.mjs:30-42
await client.query('BEGIN');
await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
  input.userId,
]);
await client.query(
  `UPDATE model_budget_reservations
   SET status = CASE WHEN dispatched_at IS NULL THEN 'released' ELSE 'uncertain' END,
       disposition = CASE WHEN dispatched_at IS NULL
         THEN 'expired_before_dispatch' ELSE 'ambiguous' END,
       updated_at = NOW()
   WHERE user_id = $1
     AND status = 'reserved'
     AND created_at < NOW() - ($2 * INTERVAL '1 millisecond')`,
  [input.userId, input.reservationTtlMs],
);
```

Extend the same transaction's committed aggregate with `image_generation` count. Do not add a process-local or client-local monthly counter.

### ENCRYPTED_LOCAL_STORE_PATTERN

```ts
// SOURCE: src/main/auth/auth-session-store.ts:49-60
if (!(await safeStorage.isAsyncEncryptionAvailable())) {
  throw new Error('Operating-system credential encryption is unavailable.');
}
const validated = StoredAuthSessionSchema.parse(session);
const destination = sessionPath();
await mkdir(path.dirname(destination), { recursive: true });
const encrypted = (
  await safeStorage.encryptStringAsync(JSON.stringify(validated))
).toString('base64');
await writeFile(destination, encrypted, { encoding: 'utf8', mode: 0o600 });
```

Store an envelope containing only schema version, output SHA-256, and 128px PNG base64. Put it below a domain-separated hash of the signed-in user ID, never the raw ID.

### PRIVATE_PROTOCOL_PATTERN

```ts
// SOURCE: src/main/voice/companion-narration-service.ts:197-215
async handleRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return responseWithStatus(405);
  }
  const id = speechIdFromUrl(request.url);
  if (!id) return responseWithStatus(404);
  // ... resolve an exact, bounded main-owned ticket ...
}
```

The companion protocol must serve only the current active content hash or an unexpired candidate UUID. It returns `image/png`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and no filesystem path.

### CONTENT_FREE_LOG_PATTERN

```js
// SOURCE: services/api/src/openai-transcription-service.mjs:284-298
console.info(
  JSON.stringify({
    audioDurationMs: Math.round(wav.durationMs),
    billedSeconds,
    byteCount: audio.byteLength,
    durationMs,
    event: 'voice.segment.completed',
    lane: 'transcription',
    microUsd: actualMicroUsd,
    model: TRANSCRIPTION_MODEL,
    requestId: input.requestId,
    taskId: input.body.utteranceId,
    usageSource,
  }),
);
```

The new event may contain counts, duration, quota remaining, fixed model/lane, and IDs. It must not contain prompt text, image/output bytes, filenames, image hash, moderation details, or provider error bodies.

### TEST_STRUCTURE

```js
// SOURCE: services/api/test/openai-transcription-service.test.mjs:177-195
test('malformed success is uncertain and is not retried', async () => {
  const calls = [];
  let fetchCount = 0;
  // injected fetch returns malformed success
  await assert.rejects(service.execute(input()), {
    code: 'ambiguous_response',
    status: 502,
  });
  assert.equal(fetchCount, 1);
  assert.equal(calls.at(-1), 'uncertain');
});
```

Tests assert lifecycle state and number of provider calls, not only the returned error message.

---

## Strategic Design

### Approach

Build one narrow vertical slice through the existing architecture:

1. Extend shared Zod contracts and typed preload APIs.
2. Add one Electron-main `CompanionCustomizationService` that owns source/output normalization, hosted calls, short-lived candidates, encrypted active assets, owner switching, and the exact private image protocol.
3. Add a Settings card controlled by `App.tsx`, plus one appearance subscription in the existing companion renderer.
4. Add one hosted OpenAI Images service and two routes (quota/status and generate).
5. Reuse `model_budget_reservations` for the monthly entitlement and spend lifecycle, adding image-token audit columns and the `image_generation` lane in migration 018.
6. Keep deployment off until ZDR, organization verification, privacy notice, and explicit eligible-account provisioning are complete.

### Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Change the OS cursor | Rejected | Platform-specific hotspot/size/accessibility behavior and no fit with Tro's existing animated pet window. |
| Store output in `AppPreferences` | Rejected | Preferences are device-global and JSON-oriented; large image data would leak across signed-in accounts and couple unrelated settings. |
| Persist source image/prompt or a gallery on the server | Rejected | Not needed for the experience; increases minor-data retention, deletion, and moderation obligations. |
| Store candidate on disk | Rejected | Preview need is short-lived. Main-memory tickets reduce retained data and make activation explicit. |
| Send provider output directly as a renderer data URL | Rejected | Large base64 crosses/stays in renderer state and cannot be proven to be the candidate later activated. The private protocol keeps bytes main-owned. |
| Create a separate quota table | Rejected | Existing per-user advisory-locked usage reservations already model reserved/settled/released/uncertain paid calls and can enforce the slot in the same transaction. |
| Use the Responses image-generation tool | Rejected | Adds mainline-model cost and conversational machinery to a single-edit workflow. |
| Use `gpt-image-1-mini` | Rejected for this iteration | Cheaper, but the current flagship image model is preferred for minors and `gpt-image-2` low output is already inexpensive at this five/month cap. |
| Allow `moderation=low` | Rejected | It is explicitly less restrictive and inappropriate for the student surface. |
| Auto-retry timeout/5xx | Rejected | Provider completion is unknown; another call can double cost and consume an extra monthly slot. |

### Scope

- Settings paste/drop/file selection, prompt, preview, activate, reset, quota, errors, EN/VI strings.
- PNG/JPEG source, max 5 MiB, one image, one prompt, one output.
- One generated candidate at a time with ten-minute TTL.
- One encrypted custom output per local account/device.
- Live custom/default appearance updates to the existing companion window.
- Hosted auth/access/rate/monthly/cost enforcement and exact OpenAI Images edit proxy.
- Content-free usage accounting, operations/privacy/security documentation, and automated/manual tests.

## NOT Building

- Actual operating-system cursor replacement, cursor hotspots, trails, or pointer themes.
- Multiple reference images, masks, free-form provider options, multiple outputs, streaming partial images, or an iterative chat editor.
- A companion gallery, sharing, leaderboard, marketplace, cross-device sync, cloud output storage, teacher-curated packs, or image export.
- WebP/GIF/SVG/HEIC input in this pass; clipboard PNG and PNG/JPEG files cover the fast path supported by Electron `nativeImage`.
- Automated age estimation, date-of-birth collection, or a new guardian-consent product. Initial access is a server allowlist populated only after external eligibility/consent checks.
- Additional PostHog events. Server usage logs are sufficient and avoid creating a new analytics privacy surface.
- Refunds for generated-but-discarded candidates or for successful provider output that later cannot be activated locally.
- Direct provider calls from renderer/Electron main or local `OPENAI_API_KEY` fallback.
- A new arbitrary external-link IPC surface; the in-product privacy disclosure is plain text in this pass.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `.env.example` | UPDATE | Document disabled feature, ZDR assertion, eligible users, and reservation ceiling. |
| `README.md` | UPDATE | Move companion image generation out of the blanket media-not-implemented statement and document operation/limits. |
| `PRIVACY.md` | UPDATE | Disclose source/prompt transfer, ZDR/CSAM caveat, transient processing, and encrypted local chosen output. |
| `docs/architecture.md` | UPDATE | Add the companion customization path to the renderer/main/API/OpenAI diagram. |
| `docs/security.md` | UPDATE | Document exact asset scheme, account isolation, safeStorage, no content logging, and rollout prerequisites. |
| `docs/inference-cost-lifecycle.md` | UPDATE | Describe image pricing, quota semantics, and uncertain calls. |
| `services/api/migrations/018_companion_image_generation.sql` | CREATE | Add `image_generation` lane and sanitized image-token breakdown columns. |
| `services/api/src/config.mjs` | UPDATE | Parse fail-closed feature/ZDR/allowlist/reservation configuration. |
| `services/api/src/main.mjs` | UPDATE | Construct and inject `OpenAiCompanionImageService`. |
| `services/api/src/model-catalog.mjs` | UPDATE | Add dated GPT Image 2 modality prices and exact integer calculator. |
| `services/api/src/plan-catalog.mjs` | UPDATE | Add five/month and two/minute entitlements to every plan. |
| `services/api/src/budget-service.mjs` | UPDATE | Always enforce image slot denial and expose companion quota snapshot. |
| `services/api/src/usage-repository.mjs` | UPDATE | Count image reservations atomically and store input/output modality token counts. |
| `services/api/src/server.mjs` | UPDATE | Add authenticated quota/status and generation routes with exact body bounds. |
| `services/api/src/openai-companion-image-service.mjs` | CREATE | Own provider request, validation, fixed prompt/options, lifecycle, settlement, and sanitized logs. |
| `services/api/test/config.test.mjs` | UPDATE | Verify unsafe enablement fails and allowlist parsing is exact. |
| `services/api/test/model-catalog.test.mjs` | UPDATE | Verify image modality price calculation and bounds. |
| `services/api/test/plan-catalog.test.mjs` | UPDATE | Lock five/month and two/minute for all plans. |
| `services/api/test/budget-service.test.mjs` | UPDATE | Verify fifth accepted/sixth denied, observe mode still enforces entitlement, releases restore slot. |
| `services/api/test/usage-repository.test.mjs` | UPDATE | Verify advisory-locked count query and sanitized modality columns. |
| `services/api/test/server.test.mjs` | UPDATE | Verify auth/access/eligibility/rate/body/error and no content echo. |
| `services/api/test/migrate.test.mjs` | UPDATE | Expect 18 ordered, re-runnable migrations and new constraints/columns. |
| `services/api/test/openai-companion-image-service.test.mjs` | CREATE | Provider form, output parser, cost lifecycle, moderation, ambiguous failure, no retry/log-content tests. |
| `services/api/test/integration/companion-image-quota.test.mjs` | CREATE | With `TEST_DATABASE_URL`, prove six concurrent requests yield at most five reservations. |
| `src/shared/contracts.ts` | UPDATE | Add request/status/quota/appearance/candidate schemas and private scheme constant. |
| `src/shared/contracts.test.ts` | UPDATE | Reject extra keys, bad base64/MIME/URL, size/prompt overflow, and quota inconsistencies. |
| `src/shared/desktop-api.ts` | UPDATE | Add four narrow desktop methods and one companion appearance event. |
| `src/preload.ts` | UPDATE | Validate/expose new main-window methods and appearance listener. |
| `src/main/ipc/register-ipc.ts` | UPDATE | Register/authorize/parse handlers and include cleanup. |
| `src/main/ipc/register-ipc.test.ts` | UPDATE | Prove main-frame/membership enforcement and input parsing. |
| `src/main/companion/companion-customization-service.ts` | CREATE | Normalize images, call hosted API, own memory candidate, encrypted local asset, account binding, protocol. |
| `src/main/companion/companion-customization-service.test.ts` | CREATE | Test validation, owner isolation, encrypted storage, ticket expiry, protocol, provider failure, no retry. |
| `src/index.ts` | UPDATE | Construct service, register scheme/handler, publish appearance, bind/clear owner on auth lifecycle. |
| `src/index.html` | UPDATE | Add `trocode-companion:` to `img-src` only. |
| `src/renderer/App.tsx` | UPDATE | Own status/busy/error state, refresh Settings status, and invoke generate/activate/reset. |
| `src/renderer/SettingsPage.tsx` | UPDATE | Accept companion props and render the new card in the chosen order. |
| `src/renderer/SettingsPage.test.ts` | UPDATE | Supply props and assert card presence/translated state. |
| `src/renderer/CompanionCustomizationCard.tsx` | CREATE | Implement paste/drop/browse/prompt/quota/candidate/activate/reset UI. |
| `src/renderer/CompanionCustomizationCard.test.tsx` | CREATE | Static-markup tests for available, exhausted, candidate, active, unavailable, and error states. |
| `src/renderer/CursorCompanion.tsx` | UPDATE | Subscribe to appearance and select custom/default URL without changing state animations. |
| `src/renderer/CursorCompanion.test.tsx` | CREATE | Verify default/custom rendering and cleanup using a small injected view helper if needed. |
| `src/renderer/app-language.ts` | UPDATE | Add every new user-facing string in Vietnamese. |
| `src/renderer/app-language.test.ts` | UPDATE | Assert critical companion strings translate and interpolation remains safe. |
| `src/index.css` | UPDATE | Add responsive, keyboard-visible, reduced-motion-safe card/dropzone/preview styles; preserve 44px overlay. |

---

## Step-by-Step Tasks

### Task 1: Define Shared Contracts and Entitlements

- **ACTION**: Add the complete desktop contract surface and API-owned per-plan generation limits before implementing either side.
- **IMPLEMENT**:
  - In `src/shared/contracts.ts`, add `TROCODE_COMPANION_SCHEME = 'trocode-companion'` and strict URL validation for only:
    - `trocode-companion://asset/active/<64 lowercase hex>`
    - `trocode-companion://asset/candidate/<UUID>`
    - no credentials, port, query, fragment, or alternative host/path.
  - Add strict schemas/types:
    - `CompanionImageMimeTypeSchema`: `image/png | image/jpeg`.
    - `GenerateCompanionImageRequestSchema`: `{ requestId: UUID, imageBase64: strict base64 with decoded maximum 5 MiB, mimeType, prompt: trimmed 1..400 }`.
    - `ActivateCompanionCandidateRequestSchema`: `{ candidateId: UUID }`.
    - `CompanionGenerationQuotaSchema`: `{ limit, used, remaining, periodStartsAt, periodEndsAt }`, with a `superRefine` invariant `used + remaining === limit`, limit exactly `5`, and UTC datetime strings.
    - `CompanionAppearanceSchema`: `{ kind:'default' } | { kind:'custom', assetUrl, revision:<sha256> }`.
    - `CompanionCandidateSchema`: `{ id, assetUrl, expiresAt }`.
    - `CompanionCustomizationStatusSchema`: `{ state:'available'|'unavailable'|'error', appearance, candidate, quota, summary }`; available requires non-null quota, unavailable/error may use null quota.
  - Add IPC channels `companionCustomizationStatus`, `companionGenerateImage`, `companionActivateCandidate`, `companionUseDefault`, `companionAppearanceChanged`.
  - Extend `DesktopApi` with `getCompanionCustomizationStatus`, `generateCompanionImage`, `activateCompanionCandidate`, `useDefaultCompanion`; extend `CompanionApi` only with `onAppearanceChange`.
  - In `services/api/src/plan-catalog.mjs`, add `companionGenerationsPerMonth: 5` and `companionGenerationsPerMinute: 2` to all four plans. Keep quota ownership on the API, not renderer constants.
- **MIRROR**: `CONTRACT_AND_TYPE_PATTERN`, `PRELOAD_BOUNDARY_PATTERN`, and the exhaustive literal plan assertions in `services/api/test/plan-catalog.test.mjs`.
- **IMPORTS**: Existing `z` in contracts; new inferred types in `desktop-api.ts` imports. No package imports.
- **GOTCHA**: A base64 regex/length check alone is insufficient; schemas can pre-bound the string, but Electron main and the API must decode and check the authoritative byte length again. Do not put image data into `AppPreferencesSchema`.
- **VALIDATE**:
  - Add contract tests for exact valid URLs and rejection of `file:`, `https:`, traversal, query, credentials, uppercase/malformed hash, excess prompt, extra keys, invalid padding, and decoded >5 MiB.
  - Add plan catalog expectations for every plan.
  - Run `npm exec -- vitest run src/shared/contracts.test.ts && node --test services/api/test/plan-catalog.test.mjs`.

### Task 2: Extend the Existing Usage Ledger for Image Cost and Monthly Slots

- **ACTION**: Make migration 018 and extend model/budget/usage logic so the same atomic transaction authorizes both cost and the five/month entitlement.
- **IMPLEMENT**:
  - Create `018_companion_image_generation.sql` that drops/re-adds both lane constraints with `image_generation`, and adds nonnegative `input_text_tokens`, `input_image_tokens`, and `output_image_tokens` BIGINT columns to `model_usage_events` with `IF NOT EXISTS` and default `0`.
  - Do not add prompt, image, filename, image hash, moderation body, or generated-output columns. Preserve the existing table comment that forbids content.
  - In `usage-repository.mjs`:
    - Extend `committedSpend()` with `month_image_generations`: count current-UTC-month rows where `lane='image_generation'` and status is `reserved`, `settled`, or `uncertain`.
    - Because `reserve()` already holds the per-user advisory transaction lock before calling `committedSpend()`, this count and insert are serializable for one user.
    - Extend `snapshot()` with the same count and existing UTC month end.
    - Extend `settle()` to insert the three modality fields from optional usage values defaulting to zero while continuing to store aggregate input/output tokens.
  - In `BudgetService`:
    - Include `companionGenerationsPerMonth` in `limitsFor()`.
    - Before money checks, return `{ code:'companion_generation_limit_reached', message:'You have used all 5 companion generations for this month.', status:429, alwaysEnforce:true }` when the image count is at limit.
    - Change repository denial handling so `alwaysEnforce` denies even when cost guard mode is `observe`; observe mode must never turn product entitlements off.
    - Preserve current 402 defaults for budget denials and propagate optional denial status.
    - Add `companionGenerationSnapshot(userId, planId)` returning only limit/used/remaining and UTC start/end derived from the repository snapshot.
  - In `model-catalog.mjs`, add a separately named, dated image catalog without changing the text catalog's meaning:
    - model `gpt-image-2-2026-04-21`
    - text input `5_000_000` micro-USD/M tokens
    - image input `8_000_000` micro-USD/M tokens
    - image output `30_000_000` micro-USD/M tokens
    - `calculateImageUsageCost()` validates bounded nonnegative counts and uses BigInt ceiling division for the three modalities.
- **MIRROR**: `ATOMIC_REPOSITORY_PATTERN`, `services/api/migrations/004_audio_transcription_usage.sql:1-14`, and integer math in `ModelCatalog.calculateUsageCost`.
- **IMPORTS**: None beyond existing module imports; reuse `TOKENS_PER_MILLION`, `tokenCount`, and `ceilingDivide` internally.
- **GOTCHA**:
  - Calendar month means PostgreSQL/UTC `date_trunc('month', NOW())`; do not use a rolling 30-day window or client timezone.
  - `released` rows must not consume slots; `uncertain` must consume them.
  - A stale reservation expires using the existing reservation TTL: pre-dispatch becomes released, post-dispatch becomes uncertain.
  - Update fake repository committed/snapshot objects in existing tests with `monthImageGenerations: 0` so unrelated tests stay deterministic.
- **VALIDATE**:
  - Update migration count from 17 to 18 and re-run twice expectation from 34 to 36.
  - Unit-test exact image prices (including 200 output image tokens -> 6,000 micro-USD) and invalid/overflow counts.
  - Unit-test fifth reservation accepted, sixth denied at 429, cost-observe still denied, release frees a slot, and uncertain does not.
  - Add optional PostgreSQL integration test that creates a disposable user, launches six concurrent zero-cost `image_generation` reservations with unique UUIDs, asserts five fulfilled/one limit denial, and deletes the user in `finally` (cascade cleans rows).
  - Run `node --test services/api/test/{migrate,model-catalog,budget-service,usage-repository}.test.mjs services/api/test/integration/companion-image-quota.test.mjs`.

### Task 3: Add the Fail-Closed Hosted Image Edit Service and Routes

- **ACTION**: Implement the only provider call and expose authenticated quota/generation endpoints.
- **IMPLEMENT**:
  - Add config:
    - `TROCODE_COMPANION_IMAGES_ENABLED=false`
    - `TROCODE_COMPANION_IMAGES_ZDR_CONFIRMED=false`
    - `TROCODE_COMPANION_IMAGE_ELIGIBLE_USERS=` (deduplicated user IDs)
    - `TROCODE_COMPANION_IMAGE_RESERVATION_MICRO_USD=50000`
    - fixed model/snapshot in code, not client-controlled.
  - `loadConfig()` must throw if images are enabled while ZDR confirmation is false or eligible users are empty. The status route still works when disabled and reports unavailable without revealing which safety prerequisite failed.
  - Create `OpenAiCompanionImageService` with constants for endpoint, snapshot, catalog version, provider timeout 130s, source max 5 MiB, and provider response max 12 MiB.
  - Validate decoded source before reserve: exact PNG signature, authoritative byte bound, provided MIME `image/png` (Electron main always normalizes), nonempty prompt, UUIDs. The public API accepts normalized PNG only even though renderer accepts JPEG.
  - Compile the provider prompt as a fixed instruction block followed by a clearly delimited user detail. Include: single centered subject, friendly/age-appropriate, transparent background, bold silhouette, high contrast, no text/letters/logo/watermark/frame, visually legible at 29px, preserve recognizable safe traits from the reference. Never interpolate user text into provider parameters or logs.
  - Reserve `image_generation` with `taskId=requestId`, configured 50,000 micro-USD, plan ID, pinned snapshot, and dated image catalog.
  - Build one multipart form with exactly: `image[]` Blob (`reference.png`), `model`, `prompt`, `n=1`, `size=1024x1024`, `quality=low`, `background=transparent`, `output_format=png`, `moderation=auto`. Omit `input_fidelity` because GPT Image 2 forces high fidelity.
  - Mark dispatched immediately before exactly one fetch. Send `Authorization` and existing hashed `OpenAI-Safety-Identifier`. Do not stream and do not retry.
  - Read the provider response with declared and actual bounds. On 400/401/403/404/422 (including `moderation_blocked`), release as rejected-before-inference and return a content-free, age-appropriate message/code. On network/timeout/429/5xx/oversize/malformed success/missing usage, mark uncertain and return a no-retry ambiguity message. Never relay the provider body.
  - On success require exactly one valid base64 PNG within 8 MiB plus bounded numeric usage with `text_tokens`, `image_tokens`, and `output_tokens`; calculate actual micro-USD, settle aggregate and modality token counts, and return `{ imageBase64, mimeType:'image/png', model, quota }`.
  - Log one JSON completion event with request ID, input byte count, token counts, micro-USD, duration, quota remaining, fixed model/lane; no user content or hash.
  - Add routes:
    - `GET /v1/companion-images/quota`: require session and active access; return `{ state, quota, summary }`. State available only if feature enabled and user allowlisted.
    - `POST /v1/openai/images/companion-edits`: require session/access/feature/allowlist; rate limit by plan (2/minute); exact keys `imageBase64,mimeType,prompt`; UUID only from `X-Trocode-Request-Id`; bounded JSON body; execute service.
  - Construct/inject the service in `services/api/src/main.mjs` and update the test handler factory dependency.
- **MIRROR**: `PROVIDER_LIFECYCLE_AND_NO_RETRY_PATTERN`, `CONTENT_FREE_LOG_PATTERN`, and `server.mjs:667-721` exact request validation.
- **IMPORTS**: `OpenAiCompanionImageService`, `ModelCatalog`, existing `BudgetService`, `planFor`, `modelSafetyIdentifier`, Node built-in `FormData`/`Blob`/`AbortSignal`.
- **GOTCHA**:
  - The 50,000 micro-USD value is a conservative reservation, not final billing. Settlement must use provider usage and the dated modality catalog.
  - OpenAI `moderation=low` is unrelated to `quality=low`; the form must contain quality low and moderation auto.
  - If a provider success lacks usage, do not estimate and settle: completion/cost is ambiguous, so retain the conservative uncertain reservation and consume the slot.
  - Do not distinguish ZDR-not-configured versus not-allowlisted in public error text.
- **VALIDATE**:
  - Config tests cover default disabled, unsafe enabled rejection, empty allowlist rejection, deduplication, and positive reservation bound.
  - Provider tests assert exact form fields, snapshot, safety header, one fetch, lifecycle order, price settlement, PNG/base64/usage bounds, moderation release, timeout/5xx/malformed uncertainty, and absence of prompt/base64 from captured logs/errors.
  - Server tests cover browser-origin rejection, missing session, inactive access, disabled/not-eligible, exact-body validation, rate limiting, fifth/sixth behavior, and response not echoing source/prompt.
  - Run `node --test services/api/test/{config,openai-companion-image-service,server}.test.mjs`.

### Task 4: Implement the Main-Process Customization and Encrypted Asset Service

- **ACTION**: Create the main-owned orchestrator for image normalization, hosted calls, candidates, active assets, owner isolation, and protocol responses.
- **IMPLEMENT**:
  - Create `CompanionCustomizationService` with injected `apiBaseUrl`, access-token provider, fetch, `nativeImage` adapter, `safeStorage` adapter, user-data root, clock, UUID, and `publish(appearance)` callback.
  - Keep `currentOwnerKey: string | null`; derive owner directory with `sha256('trocode-companion-owner-v1\0' + userId)`. Never place raw Google ID/email/name in a path or asset envelope.
  - `setCurrentOwner(userId|null)` clears every in-memory candidate, switches owner, reads the new account's newest valid active asset, and publishes custom/default. Sign-out always publishes default before another account can render.
  - Source normalization before network:
    - strict-decode max 5 MiB PNG/JPEG according to claimed MIME;
    - `nativeImage.createFromBuffer`, reject empty, zero, dimension <16, or dimension >8192;
    - if longest edge >1024, call `resize` with only width or height to preserve aspect ratio and `quality:'best'`;
    - `toPNG()`, recheck nonempty/max 5 MiB, and send MIME `image/png` to hosted API.
  - `getStatus()` checks async safeStorage availability before declaring the generate path available, resolves local appearance, performs one authenticated GET quota/status request with a 15s timeout, validates response, and returns a shared status. No local direct-provider fallback.
  - `generate()` preflights owner, safeStorage availability, token, API URL, and source before spending. Send one POST with request ID and a 135s desktop timeout (slightly above provider timeout), `redirect:'error'`, and no retry. Read a bounded response and map stable server codes to localized-ready English messages without provider bodies.
  - Validate the returned PNG with `nativeImage`; require positive square dimensions, resize to exactly 128x128 `best`, encode PNG, cap 1 MiB, calculate SHA-256, and store one in-memory candidate for current owner with UUID and ten-minute expiry. A new candidate evicts the old one.
  - Return a candidate descriptor URL `trocode-companion://asset/candidate/<UUID>`; do not return base64 to the renderer.
  - `activateCandidate()` validates current owner/UUID/TTL, constructs a strict envelope `{ version:1, sha256, pngBase64 }`, encrypts with async safeStorage, and writes a new content-addressed/versioned file such as `active-<epoch>-<sha256>.enc` using `flag:'wx'`, mode `0600` under the current owner directory. Only after the new file is complete, delete older `active-*.enc` files; a crash therefore leaves at least one complete asset. Clear candidate, publish custom, return status.
  - On read, list only filenames matching the exact active regex, newest first; decrypt/parse/verify SHA and 128px PNG. Skip corrupt entries and fall back to the next valid/default. If `shouldReEncrypt`, write a fresh versioned file using the same create-first cleanup path.
  - `useDefault()` removes only the current owner's matching active files and candidates, publishes default, and returns status. It never touches other owner directories.
  - `handleRequest()` accepts only GET/HEAD and exact URLs. Active URL succeeds only when hash equals the signed-in current asset. Candidate succeeds only for an unexpired current-owner ticket. Return PNG headers with `Cache-Control:no-store`; 404/405 otherwise. Never pass a path to `net.fetch` or the renderer.
- **MIRROR**: `ENCRYPTED_LOCAL_STORE_PATTERN`, `PRIVATE_PROTOCOL_PATTERN`, and create-first cleanup in `ActivityWorkspacePreparationService.prepare()`.
- **IMPORTS**: `createHash`, `randomUUID`; `mkdir`, `readdir`, `readFile`, `rm`, `stat`, `writeFile`; `path`; Electron `nativeImage` and `safeStorage` are injected from `index.ts`; shared schemas/types/constants.
- **GOTCHA**:
  - Check safeStorage before the hosted call so an unactivatable output does not consume a slot.
  - A candidate is output, not source; nevertheless keep it memory-only and clear it on owner change/restart/expiry.
  - Do not use `file://`, data URLs, raw paths, or a generic protocol file server.
  - Validate SHA after decryption and verify decoded image again; filenames are not trusted state.
  - A successful provider generation consumes quota even if the app later rejects a malformed output; never issue a replacement automatically.
- **VALIDATE**:
  - Unit tests use temporary directories and fake nativeImage/safeStorage/fetch/clock.
  - Cover PNG/JPEG normalization and aspect ratio, byte/dimension/MIME failures before fetch, exact one hosted call, no retry on timeout, candidate TTL/eviction, activate encryption, corrupt-file fallback, key rotation, account switch isolation, reset scope, and protocol GET/HEAD/path/method/cache headers.
  - Assert source/prompt do not appear in filenames, stored envelope metadata outside encrypted bytes, or logs.
  - Run `npm exec -- vitest run src/main/companion/companion-customization-service.test.ts`.

### Task 5: Wire the Narrow IPC, Preload API, Protocol, and Auth Lifecycle

- **ACTION**: Connect the service without weakening the renderer sandbox or exposing provider/filesystem capabilities.
- **IMPLEMENT**:
  - In `preload.ts`, add four `window.tro` methods that parse request/response schemas and one `window.troCompanion.onAppearanceChange` listener that parses payloads and removes itself.
  - In `register-ipc.ts`, add all four invoke channels to the cleanup list. Use `assertMembershipAuthorizedSender` for status/generate/activate/reset so only the current main-window frame can invoke them; parse requests before calling the service. Add `companionCustomizationService` to `IpcServices` as a narrow Pick of required methods.
  - In `index.ts`:
    - Import/register `TROCODE_COMPANION_SCHEME` in the existing one-time `registerSchemesAsPrivileged` call with standard/secure/supportFetchAPI; do **not** set `bypassCSP`.
    - Construct the service with `app.getPath('userData')`, hosted API/token providers, Electron adapters, and a publisher that stores the current appearance and sends it to `companionWindow`.
    - Register `protocol.handle(TROCODE_COMPANION_SCHEME, request => service.handleRequest(request))` next to the audio handler after app readiness.
    - Add `sendCompanionAppearance()` and call it from companion `did-finish-load` beside `sendCompanionState()`.
    - In startup/current-user and `onAuthSignedIn`, await `setCurrentOwner(user.id)`; in `onAuthSignedOut`, await `setCurrentOwner(null)` before showing any signed-out/default state.
    - Pass the service through `registerIpcHandlers`.
  - In `index.html`, change only `img-src` to include `trocode-companion:`. Keep script/style/connect/media directives and `webSecurity:true`, sandbox, and Node integration settings unchanged.
- **MIRROR**: `PRELOAD_BOUNDARY_PATTERN`, `MEMBERSHIP_AUTHORIZATION_PATTERN`, `registerCompanionAudioProtocol()` and `createCompanionWindow().webContents.on('did-finish-load')`.
- **IMPORTS**: New schemas/types/constants and `CompanionCustomizationService`; existing Electron `protocol`, `nativeImage`, `safeStorage` imports.
- **GOTCHA**:
  - `registerSchemesAsPrivileged` must still be invoked once before `app.ready`; append to its array rather than call it a second time.
  - The main Settings renderer must never receive `safeStorage`, a file path, access token, arbitrary fetch, or protocol handler.
  - Companion window cannot invoke generate/reset; it only receives appearance events and fetches an exact asset URL.
- **VALIDATE**:
  - IPC tests assert unauthorized window/subframe rejection, membership rejection, schema rejection, service call inputs, and handler removal.
  - Contract/preload typecheck proves no raw API leakage.
  - Manual devtools check confirms CSP allows only the new image scheme, not arbitrary network images.
  - Run `npm exec -- vitest run src/main/ipc/register-ipc.test.ts src/shared/contracts.test.ts && npm run typecheck`.

### Task 6: Make the Existing Companion Renderer Appearance-Aware

- **ACTION**: Swap the existing pet image URL live while preserving all current lifecycle animation and positioning.
- **IMPLEMENT**:
  - Keep the bundled `cursorBuddyUrl` as the initial/default value.
  - Add `CompanionAppearance` state initialized to `{kind:'default'}` and subscribe once with `window.troCompanion.onAppearanceChange`.
  - Compute `src = appearance.kind === 'custom' ? appearance.assetUrl : cursorBuddyUrl` and optionally use `key=revision` on the image so a changed asset cannot reuse stale decoded content.
  - Keep `alt=""`, `draggable={false}`, outer `role="img"`/state aria label, overlay tracking, state classes, rings, and animations unchanged.
  - Ensure CSS uses `object-fit:contain`, max width/height within the existing 29px visual, and does not assume the custom subject's aspect ratio even though generated output is square.
- **MIRROR**: Existing `CursorCompanion.tsx:8-56` listener/effect structure and `index.css:1968-2030` sizing.
- **IMPORTS**: `CompanionAppearance` type; bundled default asset remains imported.
- **GOTCHA**: Do not use a renderer fetch or filesystem path. The `<img>` element should be the only consumer of the private URL. Keep cleanup return values from both subscriptions.
- **VALIDATE**:
  - Test default static URL, a custom appearance event selecting the private URL, reset selecting the bundle, and listener cleanup. If direct effect testing would require jsdom, extract a pure `companionImageUrl(appearance)` helper and test it plus static markup; do not add a test environment dependency solely for this.
  - Manually verify all idle/listening/processing/working/error/completed animations with a custom output on macOS and Windows overlay modes.

### Task 7: Build the Settings Customization Card and State Orchestration

- **ACTION**: Implement the user workflow in Settings with clear quota, privacy, progress, candidate, and reset states.
- **IMPLEMENT**:
  - Create `CompanionCustomizationCard` with props for app language, status, busy action, error, generate/activate/reset callbacks.
  - Maintain only unsubmitted input state locally: selected `File`, object URL preview, prompt. Revoke old/unmounted object URLs. Do not put file bytes in global App state.
  - Paste handler searches `clipboardData.items` for the first image file; drop and hidden file input share one validator. Accept PNG/JPEG only, nonempty, <=5 MiB. Reject all other input with a visible `role=alert` message. Do not silently take text/HTML clipboard content.
  - On Generate, convert the selected file to raw base64 (strip a strictly validated data-URL prefix), create one `crypto.randomUUID()` in the renderer, and call `onGenerate`. Keep the selected source/prompt after a recoverable error; clear source bytes/object URL after a successful candidate to minimize memory.
  - Show current companion, quota (`{remaining} of {limit} left this month`), and localized UTC reset date using existing `appLocale()`.
  - Disable Generate when busy, missing input/prompt, exhausted, or status is not available. Use `aria-busy`, `aria-live=polite`, and copy that image generation may take up to two minutes and must not be retried by repeated clicks.
  - Candidate block shows preview and **Use this companion**. Active custom state shows **Use default companion** with clear destructive-local wording. Reset does not require a generic Settings Save.
  - Privacy disclosure adjacent to Generate: source image and prompt are sent to OpenAI for this request; Tro does not save either; selected custom output stays encrypted on this device; images flagged for child-safety review may be retained by OpenAI. Render this as adjacent text; do not add an external link in this pass.
  - In `App.tsx`, own `status`, `companionError`, and busy enum (`loading|generating|activating|resetting|null`). Refresh when Settings becomes active and after membership activation; callbacks always replace state with the server/main response and never decrement quota locally.
  - Pass props through `SettingsPage`; insert the component below Plan access. Update the Settings intro to include companion personalization.
- **MIRROR**: Settings controlled-state pattern in `App.tsx:840-930,1340-1420,2190-2270`, card/status semantics in `SettingsPage.tsx`, and `renderToStaticMarkup` tests.
- **IMPORTS**: Shared status/request types; `translate`, `appLocale`; React `useEffect`, `useRef`, `useState`; `CompanionCustomizationCard` in Settings/App.
- **GOTCHA**:
  - Browser `accept` is a hint; validate MIME and size again in the renderer, main, and API.
  - `crypto.randomUUID()` must be generated once per explicit click and preserved for that request. A retry requires another deliberate click/new UUID after the prior failure is shown.
  - Do not promise "instant" generation or perfect transparency. Do not show raw server/provider messages.
  - Candidate expiry can occur while Settings is open; activation should surface expiry and refresh status rather than regenerate.
- **VALIDATE**:
  - Component static tests: available/3 remaining, zero remaining/disabled, unavailable disclosure, candidate/Use, custom/reset, busy/progress, and `role=alert` error.
  - Settings test includes the card in both English and Vietnamese.
  - Manual input tests cover clipboard PNG, JPEG file, drag/drop, >5 MiB, wrong MIME, prompt boundaries, double click, candidate expiry, and zero quota.

### Task 8: Add Localized, Responsive, Accessible Visual Design

- **ACTION**: Style and translate the new surface without changing companion motion semantics.
- **IMPLEMENT**:
  - Add all literal UI strings to `VIETNAMESE_TRANSLATIONS`; use placeholder interpolation for counts/dates and never translate user/provider content.
  - Add `.settings-companion-card`, two-column preview/input layout, paste zone, source/current/candidate preview frames, prompt counter, quota badge, progress/error, and action row styles.
  - At narrow widths collapse to one column; ensure no horizontal scroll in the 900px Settings container.
  - Provide visible `:focus-visible`, keyboard operability for the paste zone via a real button/label, 44px minimum action targets, sufficient muted-text contrast, and non-color status text.
  - Respect existing `prefers-reduced-motion`; no new infinite animation in Settings. Existing companion bob already has a reduced-motion rule and remains unchanged.
- **MIRROR**: `settings-card`, `settings-promo-field`, `settings-feedback`, and `settings-actions` styles at `src/index.css:3848-4025`; translation lookup at `app-language.ts:11-459`.
- **IMPORTS**: None.
- **GOTCHA**: A focusable `div` dropzone is not a substitute for the hidden file input's associated button/label. Do not place candidate/current images as informative `alt` text when adjacent labels already name them; avoid duplicate screen-reader speech.
- **VALIDATE**:
  - Translation tests assert the main heading, quota interpolation, generate/use/reset, privacy, exhausted, and progress strings do not fall back to English under `vi`.
  - Manual keyboard-only and screen-reader-label pass; resize at 900/640/360 CSS px; light theme contrast; reduced motion.

### Task 9: Update Privacy, Security, Architecture, Cost, and Operations Documentation

- **ACTION**: Make deployment and user documentation accurately describe the new data path before enabling it.
- **IMPLEMENT**:
  - `PRIVACY.md`: update effective date; add source/prompt/generated output to OpenAI section; state Tro API processes but does not persist/log bodies; explain configured ZDR and potential CSAM-review retention; explain encrypted account-scoped local chosen output and deletion through Use default/sign-out isolation.
  - `docs/security.md`: add exact private scheme grammar, no-store decrypted responses, safeStorage/key rotation, owner hash, protocol authorization, byte/dimension bounds, fixed moderation, content-free logs, no direct key, and canary eligibility gate.
  - `docs/inference-cost-lifecycle.md`: add image lane, 50,000 micro-USD reserve, provider-usage modality settlement, five/month always-enforced entitlement, and release/uncertain outcomes.
  - `docs/architecture.md`: add Settings -> IPC -> main normalization -> hosted API -> usage ledger -> Images edit -> memory candidate -> encrypted local asset -> overlay event.
  - `README.md`: list the narrowly implemented companion-image exception while keeping general media/music generation out of scope; add environment variables, operator rollout checklist, quota behavior, and user validation steps.
  - `.env.example`: add comments that `ZDR_CONFIRMED` is an operator assertion, eligible IDs require externally established permission, and provider/model verification is a release prerequisite.
  - Rollout checklist must require: OpenAI organization verification; ZDR approval enabled on the exact project/key; legal/privacy review for served ages/jurisdictions; allowlisted accounts with documented eligibility/consent; test moderation and escalation channel; cost reconciliation; then enable flag. Rollback is setting `TROCODE_COMPANION_IMAGES_ENABLED=false`; existing custom local images continue rendering but no new generation occurs.
- **MIRROR**: Current privacy provider bullets, `docs/security.md:130-144` narrow media-boundary prose, and `docs/inference-cost-lifecycle.md:102-135` reservation semantics.
- **IMPORTS**: N/A.
- **GOTCHA**: Do not claim "OpenAI never retains images". ZDR eliminates normal customer-content retention for eligible Images calls, but documented child-safety review is an exception. Do not claim the app itself establishes parental consent.
- **VALIDATE**:
  - `rg -n "companion image|COMPANION_IMAGES|ZDR|five|5" README.md PRIVACY.md docs .env.example` shows consistent names/limits.
  - `rg -n "prompt|imageBase64|pngBase64" services/api/src` confirms content appears only in bounded request/provider handling, never SQL/log payloads.

### Task 10: Complete Regression, Packaging, and End-to-End Verification

- **ACTION**: Close all test gaps and verify the packaged sandbox/protocol path, not only unit behavior.
- **IMPLEMENT**:
  - Update every existing test fixture affected by new required Settings props, `IpcServices`, plan catalog fields, config shape, usage snapshot, and API handler dependency.
  - Keep root Vitest in Node environment; use pure helpers/static markup/fakes rather than adding jsdom.
  - Run the optional PostgreSQL concurrency test against the project test database before release.
  - Reconcile one real canary generation against OpenAI usage: logged modality tokens and micro-USD must match the provider response/catalog within integer ceiling math; inspect no content in Railway logs/DB.
  - Package the Electron app because custom protocol registration/CSP/safeStorage behavior can differ from dev webpack URLs.
- **MIRROR**: Repository required verification in `AGENTS.md`; current API `node:test` and root Vitest split.
- **IMPORTS**: N/A.
- **GOTCHA**: `npm run package` uses production Doppler configuration. Ensure the release environment leaves generation disabled unless all rollout gates are satisfied; packaging validation should not silently enable the feature for non-allowlisted users.
- **VALIDATE**: Execute every command and manual checklist below; do not mark complete on focused tests alone.

---

## Testing Strategy

### Unit and Contract Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| Shared generate schema | Valid PNG base64, UUID, 400-char prompt | Parsed exact request | Boundary |
| Shared generate schema | Invalid padding, extra key, 5 MiB + 1, empty/401-char prompt | Rejected before IPC | Yes |
| Private URL schema | Exact active hash/candidate UUID | Accepted | Security |
| Private URL schema | traversal/query/credentials/file/https | Rejected | Security |
| Quota invariant | limit 5, used 3, remaining 2 | Accepted | Contract |
| Quota invariant | used + remaining != 5 | Rejected | Contract |
| Image cost | provider modality usage | Exact ceiling micro-USD | Billing |
| Budget slot | five current-month image reservations | Sixth returns 429 | Concurrency |
| Budget observe mode | sixth request in observe | Still denied | Policy |
| Usage release | definitive provider 400 | Reservation released, slot returns | Lifecycle |
| Usage uncertainty | timeout/5xx/malformed success | Reservation uncertain, slot stays consumed | Lifecycle |
| Provider form | normalized PNG + prompt | Exact fixed nine provider fields and safety header | Integration boundary |
| Provider response | one PNG + full usage | Settled once and quota returned | Happy path |
| Provider response | two images, bad PNG/base64, missing usage, oversized body | Uncertain, no retry | Security/cost |
| Main source normalization | JPEG/PNG within bounds | Aspect-preserving <=1024 PNG | Cross-platform |
| Main preflight | safeStorage unavailable | No hosted fetch | Cost/privacy |
| Candidate | generate then clock +10m | URL 404 and activation rejected | Expiry |
| Local activation | valid candidate | Encrypted 128px active file and appearance publish | Persistence |
| Owner switch | account A custom, then B | B sees default/own asset only | Privacy |
| Protocol | exact current URL GET/HEAD | PNG/no-store or headers-only | Security |
| Protocol | old hash/arbitrary path/POST | 404/405 | Security |
| Settings states | available/exhausted/candidate/custom/unavailable | Correct controls/status/disabled state | UX |
| Cursor view | default/custom/reset appearance | Correct image source; animation classes unchanged | UI regression |

### Integration Tests

| Test | Setup | Expected |
|---|---|---|
| PostgreSQL quota race | `TEST_DATABASE_URL`, six concurrent requests for one user | Exactly five durable non-released image reservations; one denial. |
| Hosted route | In-memory HTTP server/fake provider | Session/access/allowlist/rate/body gates happen before provider; successful response contains only output/quota metadata. |
| Electron packaged protocol | Packaged dev/canary build, real safeStorage | Both main Settings preview and transparent companion window load private URLs under CSP. |
| OpenAI canary | ZDR project, verified allowlisted test account | One edit, auto moderation, returned PNG/usage, no body persistence/logging, actual cost reconciles. |

### Edge Cases Checklist

- [ ] No image, no prompt, whitespace-only prompt
- [ ] PNG/JPEG at exact byte and prompt limits
- [ ] Browser/file MIME mismatch and corrupt image with valid magic
- [ ] Huge decoded dimensions with small compressed bytes
- [ ] Clipboard with text plus image and clipboard with multiple images
- [ ] Generate double-click / same request UUID replay
- [ ] Five simultaneous requests and sixth request
- [ ] UTC month boundary while request is in flight
- [ ] Stale pre-dispatch reservation versus post-dispatch uncertain reservation
- [ ] Moderation block, 429, 5xx, timeout, disconnect, oversized/malformed success, missing usage
- [ ] safeStorage unavailable/temporarily unavailable and `shouldReEncrypt`
- [ ] Candidate expires, app restarts, user signs out, user switches account
- [ ] Corrupt/newest local asset with an older valid fallback
- [ ] Reset while custom image is visible
- [ ] Protocol GET, HEAD, POST, traversal, stale active hash, expired candidate
- [ ] Feature disabled, user not allowlisted, inactive membership, missing hosted API
- [ ] Vietnamese interpolation and narrow viewport
- [ ] Reduced motion and keyboard-only input

---

## Validation Commands

Run from `/Users/ducng/.codex/worktrees/05f9/TroCode`.

### Focused Desktop Contracts, Main, and Renderer

```bash
npm exec -- vitest run \
  src/shared/contracts.test.ts \
  src/main/companion/companion-customization-service.test.ts \
  src/main/ipc/register-ipc.test.ts \
  src/renderer/CompanionCustomizationCard.test.tsx \
  src/renderer/CursorCompanion.test.tsx \
  src/renderer/SettingsPage.test.ts \
  src/renderer/app-language.test.ts
```

EXPECT: All tests pass; no test requires network, real keychain, or jsdom.

### Focused Hosted API

```bash
node --test \
  services/api/test/config.test.mjs \
  services/api/test/model-catalog.test.mjs \
  services/api/test/plan-catalog.test.mjs \
  services/api/test/budget-service.test.mjs \
  services/api/test/usage-repository.test.mjs \
  services/api/test/openai-companion-image-service.test.mjs \
  services/api/test/server.test.mjs \
  services/api/test/migrate.test.mjs
```

EXPECT: All tests pass; provider fetch is invoked at most once per explicit request.

### Database Concurrency

```bash
TEST_DATABASE_URL="$DATABASE_URL" node --test \
  services/api/test/integration/companion-image-quota.test.mjs
```

EXPECT: Six concurrent reservations for one clean account produce five accepted rows and one 429 denial. Use the development/test database only; the test creates and cleans its own user.

### Static Analysis and Full Suite

```bash
npm run lint
npm run typecheck
npm run check
```

EXPECT: Zero lint/type errors and no root/API test regressions.

### Packaging

```bash
npm run package
```

EXPECT: Forge packages successfully with sandboxed windows and both private schemes registered. No Rust/Cargo/Bazel files change, so `npm run bazel:check` is not required.

### Content/Secret Audit

```bash
rg -n "OPENAI_API_KEY|imageBase64|pngBase64|prompt" src/renderer src/main services/api/src
rg -n "console\.(info|warn|error).*prompt|JSON\.stringify\([^\n]*(imageBase64|pngBase64)" services/api/src src/main
git diff --check
git diff --stat
```

EXPECT: Provider key remains backend-only; expected transient fields appear only in contract/transport/normalization code; no content-bearing log statements; no whitespace errors.

### Manual Validation

- [ ] With feature disabled, Settings shows current/default companion and a non-sensitive unavailable message; no Generate control is enabled.
- [ ] With ZDR-confirmed canary config and an allowlisted active account, quota displays 5/5 on a fresh UTC month.
- [ ] Paste a clipboard PNG and choose a JPEG file; source preview and prompt counter work without filesystem path exposure.
- [ ] Reject wrong MIME, corrupt image, >5 MiB, extreme dimensions, empty/overlong prompt before provider dispatch.
- [ ] Generate once; progress remains honest for a slow request, repeated click is impossible, exactly one provider request occurs.
- [ ] Candidate preview loads from `trocode-companion://asset/candidate/<uuid>`; source/prompt are absent from PostgreSQL, local app data, logs, and analytics.
- [ ] **Use this companion** immediately updates the 44px companion without window recreation; all state animations still work.
- [ ] Restart app: the signed-in account's custom companion loads from encrypted local storage. Inspecting the asset file does not reveal PNG magic/base64 plaintext.
- [ ] Sign out: companion returns to default. Sign in as another account: first account's custom image is not visible.
- [ ] **Use default companion** deletes only the current account's active asset and updates live.
- [ ] Generate five results (activation/discard does not matter); sixth is blocked until the displayed UTC reset date.
- [ ] A moderation block releases a slot; a simulated timeout after dispatch consumes an uncertain slot and explicitly says Tro did not retry.
- [ ] macOS and Windows packaged builds load the custom URL under CSP in native/overlay tracking modes.
- [ ] Vietnamese, keyboard-only, screen-reader labels, 360px width, and reduced-motion checks pass.

---

## Acceptance Criteria

- [ ] Settings contains a localized Cursor companion card below Plan access.
- [ ] A student can paste/drop/select one PNG/JPEG <=5 MiB, enter a 1-400 character prompt, and start exactly one explicit generation.
- [ ] The provider request is a pinned one-image GPT Image 2 edit with fixed low-quality square PNG, transparent background request, and `moderation=auto`.
- [ ] The hosted API enforces active access, disabled-by-default ZDR/allowlist rollout, 2/minute, cost budgets, and five/account/UTC-month atomically.
- [ ] Known pre-inference failure releases the slot; success and completion-uncertain calls consume it; no ambiguous call is retried.
- [ ] The source and prompt are absent from persistent storage, structured logs, analytics, and provider error responses.
- [ ] A generated output appears first as a ten-minute main-memory candidate and activates only after **Use this companion**.
- [ ] The chosen 128px PNG is encrypted at rest, account-scoped, content-verified, and served only through an exact no-store private protocol URL.
- [ ] Sign-out/account switch cannot show another account's custom image; reset affects only the current account.
- [ ] The current companion overlay swaps custom/default appearance live while keeping its 44px placement and all lifecycle animations.
- [ ] Privacy/security/cost/architecture/readme/environment documentation matches the deployed behavior and under-18 launch prerequisites.
- [ ] Focused tests, PostgreSQL concurrency test, `npm run check`, and `npm run package` pass.

## Completion Checklist

- [ ] Code follows discovered service/repository/contract/IPC patterns.
- [ ] Renderer remains sandboxed with Node integration disabled and `webSecurity:true`.
- [ ] Every renderer/main/API boundary parses a bounded schema or exact manual equivalent.
- [ ] No new third-party dependency is introduced.
- [ ] No provider key or raw access token crosses into a renderer.
- [ ] Quota is server-owned and concurrency-safe; no client optimistic decrement.
- [ ] Cost is reserved before dispatch and settled from modality-specific provider usage.
- [ ] No automatic retry after a potentially dispatched generation.
- [ ] Errors are stable/content-free and distinguish exhausted, moderation, unavailable, expired candidate, and ambiguous dispatch.
- [ ] Logs contain only allowlisted metadata.
- [ ] Local custom data is encrypted and isolated by account.
- [ ] EN/VI, accessibility, responsiveness, and reduced motion are covered.
- [ ] Documentation and rollout gate are complete before enablement.
- [ ] No unrelated feature scope is added.
- [ ] Plan is self-contained; implementation should require no additional codebase search or product decision.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Student/minor data is processed without the required retention/consent setup | Medium | Critical | Feature off by default; config refuses unsafe enablement; exact-project ZDR assertion plus explicit eligible-user allowlist and documented legal/consent operations gate. |
| Five/month is exceeded by concurrent clicks/devices | Medium | High | Reuse advisory-locked `model_budget_reservations`; count and insert in one user transaction; real PostgreSQL six-request test. |
| Timeout causes duplicate cost/slot consumption | Medium | High | One UUID per click, no retry, mark uncertain after dispatch, keep slot/reservation committed. |
| Reference/output contains inappropriate material | Medium | High | `moderation=auto`, fixed age-appropriate prompt, OpenAI input/output safety, no `low` moderation control, content-free operational escalation. |
| Image bytes leak through logs/storage/protocol | Low | High | Strict log allowlist, no server persistence, memory candidate, encrypted local output, exact owner-bound no-store URLs, privacy tests/audit queries. |
| Custom image leaks across accounts on a shared computer | Medium | High | Domain-separated account directories, explicit owner lifecycle, candidate purge and default publish on sign-out, isolation tests. |
| safeStorage unavailable after generation | Low | Medium | Preflight availability before provider dispatch; fail unavailable without consuming a slot. |
| Transparent background is imperfect/changes because it is preview | Medium | Low | Fixed prompt and PNG request; copy avoids guarantee; render opaque valid PNG gracefully. |
| 1024px generation feels slow despite low quality | Medium | Medium | Low quality/square/one output/direct Images API, honest up-to-two-minute UI, no streaming complexity. |
| Provider pricing/schema changes | Medium | Medium | Pinned snapshot, dated modality catalog, strict response parser, usage reconciliation, kill switch. |
| Electron custom protocol works in dev but not package | Low | High | Register before ready, install handler after ready, explicit CSP, packaged macOS/Windows validation. |

## Notes

- "Five per month" is deliberately an entitlement, not a money estimate. It is always enforced even when `TROCODE_COST_GUARD_MODE=observe`.
- The existing `TROCODE_PAID_CALLS_ENABLED=false` remains the global paid-call kill switch. `TROCODE_COMPANION_IMAGES_ENABLED=false` is the narrower rollback switch.
- Local rendering remains available after the generation kill switch is turned off; users do not lose a previously chosen local companion.
- The candidate TTL and active file format are internal contracts; expose only Zod descriptors, never paths or encrypted payloads.
- If the provider snapshot or ZDR eligibility changes, keep the feature disabled until docs, model catalog, and safety review are updated together.

## Implementation Confidence

**8/10** for a single pass. The codebase already has all core primitives—sandboxed preload IPC, private protocols, safeStorage, authenticated paid-call proxying, atomic reservations, plan entitlements, bilingual Settings, and provider lifecycle tests. The remaining uncertainty is operational rather than architectural: real OpenAI organization verification/ZDR configuration and packaged cross-platform protocol behavior require canary validation.
