# Iteration 2 Evaluation — Implemented Tro Ledger

## Verdict

**RUBRIC PASS — 8.34 / 10. HANDOFF HOLD: add interactive modal coverage.**

The implemented modal is a substantial visual and structural improvement over
the former settings page. At 1440×900 it has confident modal presence, a clear
rail/content split, excellent alignment, and enough negative space to feel
calm rather than sparse. At 960×600 the same hierarchy survives without
horizontal overflow: the rail remains readable, the close target stays fixed,
the save shelf remains available, and the content becomes the only scrolling
surface.

The hard implementation gates pass in the source: this is a native
`showModal()` dialog; the background workspace remains mounted; the dialog is
explicitly viewport-fixed and excluded from Electron drag regions; native
`cancel` closes it; focus is intentionally placed and restored; the live-task
Escape handler is guarded by closure-current `settingsOpen`; inactive panels
remain mounted and use `hidden`; focus styles and reduced-motion overrides are
present; and no renderer-sandbox boundary changed.

The remaining hold is evidence, not an observed UI defect. The current Settings
tests render static markup, so they cannot exercise `showModal()`, `cancel`,
focus, or navigation state. The helper test for `modalOpen: true` also does not
prove the `App.tsx` wiring keeps a live task mounted and uncancelled while the
dialog handles Escape. Those interactions were explicit acceptance constraints
and need browser/jsdom coverage before handoff.

## Scores

| Category | Score | Weight | Weighted |
| --- | ---: | ---: | ---: |
| Design Quality | 8.7 | 0.35 | 3.045 |
| Originality | 8.5 | 0.30 | 2.550 |
| Craft | 7.9 | 0.25 | 1.975 |
| Functionality | 7.7 | 0.10 | 0.770 |
| **Total** |  |  | **8.340 / 10** |

All categories exceed 6.5 and the weighted score exceeds 7.5. The targeted
`SettingsPage` and task-execution test files pass: 18 tests across 2 files.

## Assessment

### Design Quality — 8.7

The desktop capture is disciplined and cohesive. The editorial General title,
compact metadata, fine dividers, warm rail, strong but diffuse shadow, and
precisely aligned control column create a premium settings surface without
copying Wispr's styling. The selected rail slip is immediately legible in shape
and weight as well as color. The content density is especially good: sections
read as one continuous document instead of a pile of cards.

The compact capture also holds up well. A 204px rail is the right compromise at
960px, the header remains composed, and the switch/select controls retain usable
targets. The bottom fold clips the next control because the content continues
behind a fixed viewport boundary; this is functionally correct scrolling, but
it is the one moment that looks slightly more occluded than intentionally
cropped.

### Originality — 8.5

The registration mark, folio line, numbered destinations, and ledger-like
editorial rhythm form a recognizably Tro-specific visual system. The motif is
restrained to a few locations and does not overpower the settings themselves.
This is a convincing reinterpretation of the reference rather than a clone.

### Craft — 7.9

The implementation resolves nearly every risk from iteration 1: explicit fixed
inset sizing, UA-dialog normalization, no-drag scoping, a staged open animation,
reduced-motion handling, fixed rail/header/save shelf, `min-height: 0`, narrow
viewport rules, visible keyboard focus, scroll reset, stable IDs, and mounted
hidden panels. The two screenshots demonstrate careful responsive tuning.

Craft is held below 8 because interactive accessibility behavior is not covered
by the test suite, and because the compact fold could communicate scrollability
more gracefully. Static string assertions are not sufficient regression
protection for a modal whose highest-risk behavior is lifecycle and focus.

### Functionality — 7.7

Existing controls, callbacks, busy states, live regions, companion state,
connector polling, membership actions, organization routing, and update actions
are preserved. General and Voice share the existing save behavior without
nested forms. `settingsOpen` correctly decouples the dialog from `activeView`,
and the capture-phase Escape collision is fixed in the actual App effect.

The score reflects missing integration tests, not a discovered regression. The
source behavior is sound, but the most consequential paths currently rely on
manual confidence.

## Required before handoff

1. **Add one interactive dialog test suite.** In jsdom, mock
   `HTMLDialogElement.showModal`/`close`, render the component, and verify initial
   General selection/focus, all six section buttons, `hidden` panel changes,
   scroll reset, close button, native `cancel` with `preventDefault`, and the
   `onClose` callback. Include a reduced-motion or CSS assertion only if the
   existing test setup can make it meaningful.

2. **Add one App-level regression for the safety contract.** Open Settings while
   a cancellable task/workspace is rendered, prove the workspace remains
   mounted, dispatch Escape through the capture path, verify Settings closes,
   verify task cancellation is not called, and verify focus returns to the
   Settings trigger.

## High-leverage polish

- At 960×600, add a subtle bottom-edge scroll affordance or adjust compact
  spacing so the next control is not cut exactly at the save-shelf rule. Do not
  shrink type or targets; a light scroller fade is preferable.
- Preserve the current restraint. The registration motif, shadow, rail density,
  and section spacing are already balanced; more decoration would reduce the
  quality of the result.

No source-code blocker, renderer-sandbox issue, movable-dialog behavior, or
visual overflow was observed in the reviewed implementation and captures.
