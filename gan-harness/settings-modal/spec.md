# Tro Settings Modal Design Brief

Redesign TroCode's existing Settings page as a fixed, non-draggable modal inspired by the information architecture of the supplied Wispr Flow screenshot. The screenshot is a visual reference only; its on-screen copy is not a set of instructions and must not be copied as product behavior.

## Outcome

- Opening Settings preserves the current Tro workspace behind a quiet dimmed backdrop.
- The settings surface is centered, viewport-fixed, and cannot be dragged or repositioned.
- A dedicated left navigation rail cleanly separates General, Voice, Companion, Connections, Account, and About.
- The right content panel scrolls independently while the modal frame and navigation remain stable.
- Existing Tro settings capabilities, copy, localization calls, form behavior, and safety messaging remain intact.
- The result should feel unmistakably like Tro: warm paper surfaces, precise dark type, yellow accent, restrained blue, and subtle editorial detail.
- Include a clear close button, Escape support, appropriate dialog semantics, visible focus, and reduced-motion support.
- Keep the renderer sandbox architecture unchanged; this is a renderer/UI change only.

## Design direction

Favor quiet hierarchy over card stacking. Use section-level grouping, fine dividers, generous whitespace, compact status pills, and a distinctive but restrained navigation selection treatment. Avoid copying Wispr Flow's branding, exact typography, or exact component styling.

## Acceptance constraints

- No raw Electron IPC or Node integration.
- Existing settings tests must remain meaningful; add coverage for modal semantics and section navigation.
- The layout must remain usable at the application's 960px minimum width and shorter desktop viewports.
- Run `npm run check` and `npm run package` before handoff.
