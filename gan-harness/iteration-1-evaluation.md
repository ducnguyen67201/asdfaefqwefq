# Iteration 1 — Evaluation

## Verdict

Pass. Weighted score: **7.93 / 10**.

The card is now easy to understand for a first-time student: current companion,
monthly allowance, source image, prompt, generation action, and candidate
activation are visually ordered and readable at 900px and 360px. The design is
not just a generic upload form; the numbered studio path and larger candidate
stage give the feature a recognizable personalization moment while staying
native to Tro's Settings surface.

## Scores

| Category | Weight | Score | Weighted |
| --- | ---: | ---: | ---: |
| Design Quality | 0.35 | 8.2 | 2.87 |
| Originality | 0.30 | 7.7 | 2.31 |
| Craft | 0.25 | 7.6 | 1.90 |
| Functionality | 0.10 | 8.5 | 0.85 |
| Total | 1.00 |  | **7.93** |

## Evidence

- The strongest path is visible without instruction: picture input, prompt, and
  generate action sit in a single numbered sequence, and the disabled primary
  button states the missing requirement.
- The active companion and quota are both glanceable. Quota pips communicate
  the five-monthly-preview limit faster than text alone.
- Paste, drop, and browse are merged into one keyboard-focusable native button,
  with local validation preserved for PNG/JPEG and 5 MiB limits.
- The candidate state has a separate stage, larger image treatment, explicit
  activation button, and copy that prevents the common misconception that a
  preview is already active.
- Loading, generating, unavailable, exhausted, error, reset, and activation
  states retain semantic feedback through `role="status"`, `role="alert"`,
  `aria-busy`, disabled controls, and unchanged callbacks.
- Responsive screenshots at 900px and 360px show no horizontal overflow or
  clipped button text.

## Issues Fixed During Review

- Removed a duplicate `.companion-customization-candidate` CSS rule that
  flattened the intended candidate reveal surface.
- Removed orb/dot-only decoration from the touched companion CSS to comply with
  the frontend design constraints.
- Reset negative letter spacing in touched companion headings to `0`.

## Remaining Risks

- The screenshot harness covers empty and candidate states, but selected-image
  and generating visual states are covered by component code/tests rather than
  browser screenshots.
- Some older companion localization keys remain because they may still be used
  elsewhere or by tests. They are not harmful, but a later cleanup can remove
  unused strings once this feature stabilizes.

## Highest-Leverage Future Improvement

Add one interactive browser test that uploads a tiny in-memory PNG, types a
prompt, and captures the ready-to-generate state. That would close the main
visual coverage gap without changing the product behavior.
