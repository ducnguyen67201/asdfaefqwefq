# Design Brief: Seamless Custom Companion Settings

Refine the new **Custom companion** card in Tro Settings so a student can
understand and complete the workflow without instruction or hesitation.

The finished experience should feel like a native part of Tro's warm,
paper-like visual system: friendly, calm, polished, and suitable for a student
product. It should have a clear visual story from current companion to source
image to customization prompt to generated preview and activation. The monthly
allowance and privacy implications must be understandable without dominating
the creative experience.

## Primary experience goals

1. Make the flow self-evident: add an image, describe a style, generate a
   preview, then explicitly use it.
2. Keep the current companion and remaining monthly allowance visible at a
   glance.
3. Make paste, drop, and file selection feel like one forgiving input rather
   than three separate features.
4. Give generation, candidate preview, activation, unavailable, exhausted,
   error, and reset states strong hierarchy and honest feedback.
5. Feel delightful and distinctive without becoming noisy, game-like, or
   harder to scan.

## Constraints

- Preserve every security and product invariant already implemented.
- Keep the existing callback/status contracts and the Settings placement below
  Plan access.
- Do not add dependencies, network calls, analytics, persistence, or a generic
  Settings Save requirement.
- Keep source `File`, object URL, and prompt local to the component.
- Preserve PNG/JPEG, 5 MiB, 400-character, five-per-month, explicit activation,
  and no-automatic-retry behavior.
- Preserve English/Vietnamese localization and do not translate provider/user
  content.
- Preserve keyboard access, screen-reader status, 44px targets, reduced motion,
  and usability at 900, 640, and 360 CSS pixels.
- Continue to use the current warm cream, ink, yellow-accent Tro design system.
- Avoid dashboard clutter, excessive bordered boxes, hidden essential actions,
  novelty controls, or motion that competes with the task.

## Success signal

A first-time student should be able to point to what they would do next in each
state within a few seconds. The card should look intentional enough to be a
signature personalization moment, but familiar enough to require no tutorial.

