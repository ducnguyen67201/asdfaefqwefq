# Iteration 1 Evaluation — The Tro Ledger

## Verdict

**PASS, with implementation refinements required.**

The proposal understands the reference at the right level: it borrows the
modal information architecture and leaves Wispr's branding behind. The numbered
folio rail, editorial typography, and yellow-registration-mark/blue-rule motif
give Tro a credible visual signature. It also maps the current settings surface
into six understandable destinations without inventing new product behavior.

The concept-level accessibility and sandbox gates pass: it specifies a native
modal dialog, an explicit close path, native `cancel` handling, focus return,
an inert background through `showModal()`, visible focus, reduced motion, and
no renderer/preload/IPC change. The fixed/non-draggable gate also passes in
intent, but the implementation must make the CSS positioning and Electron drag
exclusion explicit as described below.

This score is intentionally capped below award-level excellence because there
is no rendered artifact yet. Exact rhythm, density, long-copy behavior, and the
registration motif's visual restraint still have to be proven in the browser.

## Scores

| Category | Score | Weight | Weighted |
| --- | ---: | ---: | ---: |
| Design Quality | 8.1 | 0.35 | 2.835 |
| Originality | 8.2 | 0.30 | 2.460 |
| Craft | 7.2 | 0.25 | 1.800 |
| Functionality | 7.8 | 0.10 | 0.780 |
| **Total** |  |  | **7.875 / 10** |

All categories exceed 6.5 and the weighted score exceeds the 7.5 threshold.

## Category assessment

### Design Quality — 8.1

The large fixed frame, stable rail, fixed header, independently scrolling
content, and restrained section rules should create a much clearer hierarchy
than the current vertical stack of cards. Warm paper surfaces and an editorial
display face are consistent with Tro. The proposal also shows good judgment in
allowing only the companion workflow to retain a contained field.

The risk is over-signalling the ledger metaphor. Folio numbers, grouped rail
labels, a masthead, a footer, status pills, a registration mark, and large
editorial headings all compete for hierarchy. In implementation, the folio
number and registration mark must remain genuinely quiet; the user's setting
and its consequence should always dominate.

### Originality — 8.2

The numbered index and print-registration detail are a distinctive Tro-specific
answer to the reference. This is not a reskinned Wispr sidebar. The concept has
a memorable object-level idea without requiring a new component library or an
ornamental visual effect.

Originality is not higher because the underlying split-rail settings dialog is
familiar, and the design's signature has not yet been visually demonstrated.
The implementation should resist adding more ledger decoration to compensate.

### Craft — 7.2

The proposal addresses the important structural details: short viewports,
960px width, stable scroll regions, reduced motion, mounted inactive panels,
native controls, focus indication, and no-drag regions. It correctly notices
the capture-phase Escape collision in `App.tsx`, which is the easiest severe
regression to miss.

Craft is the weakest category because several details are currently assertions
rather than fully specified mechanics: native-dialog entry animation can fail
without `@starting-style` or a staged class; initial focus is not defined; the
dialog's fixed positioning is not expressed as an explicit CSS contract; and
panel/control relationships need concrete accessible IDs. Long Vietnamese copy
and the dense companion editor are also unproven at 960×600.

### Functionality — 7.8

The six-way content mapping accounts for all current capabilities and retains
the important callbacks, busy states, drafts, polling, update actions, and
organization routing. Keeping all panels mounted is the right choice for the
promo and companion workflows. Separating `settingsOpen` from `activeView`
preserves the workspace and directly answers the user's request.

The main implementation risk is the current combined preferences form. General
and Voice must share the same draft/save behavior without introducing nested
forms, duplicated IDs, accidental submits, or a save shelf that is disconnected
from its controls.

## Required refinements for implementation

1. **Make immovability a hard CSS invariant.** Set the dialog itself to
   `position: fixed; inset: 0; margin: auto`, remove UA dialog padding/max-size
   behavior explicitly, and set `-webkit-app-region: no-drag` on the dialog,
   its descendants, and the backdrop layer where supported. Add no pointer
   handlers that alter its position.

2. **Define initial and return focus.** On open, focus either the active General
   rail button or a programmatically focusable dialog heading; do not leave the
   browser to select a surprising first control. Restore focus to the exact
   sidebar trigger for close button, Escape, and organization-route dismissal.
   Guard `showModal()` against an already-open dialog and keep React state as
   the single source of truth for mounting and closing.

3. **Make the Escape safety fix closure-safe.** Include `settingsOpen` in the
   capture-handler effect dependency or read it through a current ref. A stale
   `false` must never allow Escape in Settings to cancel the live task behind
   the dialog. Test the actual capture-phase path, not only the helper in
   isolation.

4. **Use explicit navigation/panel semantics.** Give every rail button and
   panel stable IDs, connect them with `aria-controls` and `aria-labelledby`,
   retain `aria-current="page"`, and apply the native `hidden` attribute to all
   inactive panels. Keep a stable localized dialog name (`Settings`) and expose
   the active panel through its visible heading instead of relying only on a
   dynamically concatenated `aria-label`.

5. **Preserve form and live-region behavior exactly.** Do not wrap the entire
   modal in a new form. General and Voice can use a shared form ID or deliberate
   submit wiring, but the existing save callback, disabled state, error alert,
   success status, connector polling, promo validation, companion activation,
   and updater states must survive unchanged. Keep all six panels mounted so
   local form values and generated candidates survive navigation.

6. **Make animation mechanics real and optional.** Use `@starting-style`, a
   staged data attribute, or a measured two-frame open sequence so the native
   dialog actually animates. Avoid animating layout properties. Under
   `prefers-reduced-motion: reduce`, remove dialog and panel transforms and
   transitions entirely, not merely shorten them.

7. **Prove the layout under pressure.** At 960×600, verify that the header,
   close button, rail, and optional save shelf remain fixed while only the
   content scroller moves. Test the longest Vietnamese labels/help text,
   disabled controls, alert copy, and the full companion editor. Use
   `min-width: 0`, wrapping, and control-column collapse where necessary; no
   horizontal scrollbar is acceptable.

8. **Keep the motif subordinate.** Use the crossed yellow/blue registration
   mark only in the three proposed locations, and reduce or remove it if the
   active rail item becomes visually noisy. The active item must remain obvious
   in grayscale and at high zoom through shape, border, and type weight—not
   yellow/blue alone.

## Implementation gate

Do not treat this concept pass as a visual QA pass. Implementation is ready for
handoff only after keyboard-only navigation, Escape isolation, focus return,
960×600 and normal-desktop screenshots, reduced-motion behavior, existing
Settings tests, new dialog/navigation tests, `npm run check`, and
`npm run package` all pass.
