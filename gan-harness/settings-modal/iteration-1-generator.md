# Iteration 1 — Generator: The Tro Ledger

## Design intent

Use the reference for its strong modal hierarchy, not its visual identity. Tro's
version should feel like a warm field ledger opened above the current workspace:
a fixed paper frame, a quiet numbered index at left, and one carefully typeset
settings folio at right. The signature detail is a small **yellow registration
mark crossed by a blue rule**. It appears in the rail masthead, on the active
index entry, and beside section status—enough to make the surface recognizably
Tro without decorating every control.

The result is calm rather than card-heavy. Large categories are separated by
space and fine rules; only genuinely interactive sub-surfaces (the companion
studio and an error/status notice) receive a tinted field.

## Information architecture

The six rail destinations are numbered `01–06` and map every existing capability
without changing behavior:

| Folio | Destination | Existing content |
| --- | --- | --- |
| 01 | General | App language, classroom pet messages, autonomy |
| 02 | Voice | Primary spoken language, shortcuts, system-audio mute |
| 03 | Companion | `CompanionCustomizationCard` in full |
| 04 | Connections | Gmail connection state and actions |
| 05 | Account | Plan/promo code and the conditional organization summary |
| 06 | About | Application version, update status, check/restart action |

All six panels should remain mounted and use `hidden` for inactive panels. This
preserves a selected companion image, typed prompt, promo input, fetched
connection state, and unsaved preference drafts when moving between folios.

## Composition and visual system

- Use a native modal `<dialog>` in the browser top layer. Size it at
  `min(1120px, calc(100vw - 64px))` by
  `min(760px, calc(100dvh - 48px))`, with a 22px outer radius, a firm hairline,
  and a deep but diffuse shadow. At the 960px minimum width, reduce the edge
  inset to 20px and the rail from 236px to 204px.
- The backdrop is `rgba(31, 31, 27, .40)` with 3px blur and slightly reduced
  saturation. The workspace remains legible as context, not usable as another
  layer.
- The rail uses `#efede5`; the content uses Tro's `--panel`. A single vertical
  border divides them. Avoid gradients and nested outer cards.
- Rail masthead: small Tro mark, `TRO / PREFERENCES`, then grouped labels
  `Preferences` (General, Voice, Companion), `Workspace` (Connections,
  Account), and `Product` (About). The bottom carries the existing “Bounded by
  default” message with its yellow safety dot.
- Each navigation entry is a 44px target. The active entry becomes a white
  paper slip with a 1px border, a 3px yellow left rule, and a 5px blue square at
  the rule's top. The folio number is monospaced and muted; the text remains
  dark, so selection is never color-only.
- The content column is a three-row grid: stable section header, independently
  scrolling panel, and an optional save shelf for General/Voice. The header
  pairs a quiet `01` folio number with a 32–36px Iowan/Palatino title (already
  part of Tro's editorial vocabulary), a short localized description, and a
  44px close button. It does not scroll.
- Within a panel, use `.settings-group` sections with 32px vertical spacing and
  fine bottom borders. A row is a two-column grid: explanatory copy on the left
  and a 200–240px control on the right. Status pills stay compact and sit next
  to group headings, not in floating card corners.
- Convert large checkbox cards into native-checkbox switch rows. Keep the input
  in the accessibility tree and style a separate track; show a 2px yellow focus
  ring around the track. Selects and text inputs retain the existing Tro border,
  10px radius, and high-contrast focus treatment.
- Scope legacy card normalization under `.settings-dialog`: ordinary
  `.settings-card` surfaces become borderless groups. The companion studio may
  keep one soft `rgba(242, 201, 76, .07)` inset field because image generation
  is a true workflow, but it should lose its outer shadow.

## Interaction and modal behavior

Opening Settings must not set `activeView = 'settings'`. Add a separate
`settingsOpen` state in `App.tsx`, leave the current workspace rendered, and
mount `SettingsPage` as a sibling overlay. The sidebar trigger uses
`aria-haspopup="dialog"` and returns focus after close.

`SettingsPage` keeps its export name but receives `onClose`. On mount it calls
`dialogRef.current.showModal()`. The dialog uses `aria-modal="true"`, a stable
accessible name (`Settings · {active folio}`), and handles native `cancel` by
preventing the default and calling `onClose`. Clicking the dimmed backdrop does
not dismiss it; this avoids losing partially entered promo or companion work.
The explicit close button and Escape are sufficient.

One important integration detail: the app's capture-phase Escape handler can
currently stop a live task. Pass `settingsOpen` into its `modalOpen` guard so
Escape closes Settings and never cancels work running behind it.

Changing folios updates `aria-current="page"`, reveals the corresponding panel,
and resets the right scroll container to the top. Do not slide panels; use only
a 120ms opacity/translate reveal. Opening the dialog uses a restrained 180ms
scale from `.985` and 8px vertical offset. Disable both animations under
`prefers-reduced-motion: reduce`.

General and Voice share the existing draft state. Their stable bottom save
shelf contains the current error/status and `Save preferences` action; it is
shown only on those two folios. Account, Connections, Companion, and About keep
their current immediate actions. `Open organization settings` closes the modal
before routing to the organization page.

## Recommended component and CSS architecture

Keep changes local rather than introducing a new UI framework:

```text
App.tsx
  settingsOpen + settingsTriggerRef
  current workspace (unchanged and still mounted)
  SettingsPage onClose=...

SettingsPage.tsx
  SettingsPage                 native dialog lifecycle + active folio
  SettingsRail                 grouped numbered navigation
  SettingsPanelHeader          folio, title, description, close
  SettingsGroup / SettingsRow  quiet content primitives
  SettingsSaveShelf            existing save/error behavior
  existing CompanionCustomizationCard
  existing ConnectedApplicationsCard
```

Replace the current page-level block with these scoped selectors:

```text
.settings-dialog / ::backdrop
.settings-dialog__rail / __masthead / __nav / __nav-item / __footer
.settings-dialog__content / __header / __folio / __close
.settings-dialog__scroller / __panel
.settings-group / __heading / .settings-row
.settings-switch / .settings-save-shelf
```

Set `-webkit-app-region: no-drag` on `.settings-dialog` and all descendants.
This is essential because the underlying Electron sidebar/topbar are draggable;
the modal itself must never become a window drag handle. No preload, IPC,
contract, or Node-in-renderer change is needed.

For short viewports, reduce header/panel padding at `max-height: 640px`; keep the
rail and modal frame fixed while `.settings-dialog__scroller` uses
`min-height: 0; overflow-y: auto`. At the 960px width breakpoint, use a 204px
rail, 28px content padding, and 180px control column. This yields roughly 668px
of content width and no horizontal overflow.

## Acceptance checks for implementation

- Test `role="dialog"`, accessible naming, initial General selection, all six
  nav destinations, inactive `hidden` panels, close button, native cancel, and
  focus restoration. Mock `HTMLDialogElement.showModal/close` in jsdom.
- Add an App-level regression proving the prior workspace remains mounted while
  Settings is open and Escape cannot reach the live-task cancellation handler.
- Keep all existing copy behind `t(...)`; add translations for new rail and
  panel descriptions rather than reusing text from the screenshot.
- Preserve every callback, busy/disabled state, alert/status live region,
  safety explanation, connector polling rule, and explicit companion activation.
- Verify at 960×600 and a normal desktop viewport, then run `npm run check`,
  `npm run package`, and `git diff --check`.

This direction borrows the reference's clarity but gives Tro its own memorable
object: a compact, numbered settings ledger floating above work that remains
visibly in progress.
