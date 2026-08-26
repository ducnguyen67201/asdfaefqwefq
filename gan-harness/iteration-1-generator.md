# Iteration 1 — Generator

## Design intent

The original implementation exposed every required capability, but its visual
story was a sequence of similarly weighted boxes. This iteration turns the card
into a small **companion studio** with one obvious path: see what is active,
choose a picture, describe its vibe, generate a preview, and explicitly adopt
it.

The signature moment is deliberately quiet. The current companion sits on a
soft paper-and-sunlight stage, while numbered yellow trail markers carry the
student through creation. A successful candidate receives a larger, warmer
reveal surface without visually competing with the Settings page around it.

## High-leverage decisions

- The active companion and five-pip monthly allowance stay above the fold and
  can be understood independently of the generator form.
- Paste, drop, and file browsing are now one full-surface native button. The
  same control shows the selected image, its filename, and the way to replace
  it; there are no competing upload controls.
- The form is explicitly sequenced as “1 Choose a picture”, “2 Describe the
  vibe”, then “3 Meet your new companion”. Supporting copy is student-facing
  and concrete rather than technical.
- The disabled primary action says what is missing: “Add an image to continue”
  or “Describe a style to continue”. Once ready, it becomes “Generate preview”.
- Privacy is scannable without losing required detail. A short, persistent
  statement explains the one-time OpenAI send and Tro non-retention; a native
  disclosure contains encryption, child-safety review, uncertain-slot, and
  no-auto-retry details.
- The generated candidate is visually distinct and repeats that activation is
  explicit: “Nothing changes until you choose to use it.”

## State handling

- **Loading:** a stable, centered loading surface prevents the card from
  collapsing and announces progress with `role="status"`.
- **Empty first use:** step 1 is the strongest interactive surface and the
  primary action names the missing image.
- **Image selected:** the upload surface changes from dashed to a calm success
  treatment and exposes the local preview, filename, and “Change” affordance.
- **Prompt missing / ready:** the primary action advances from prompt guidance
  to “Generate preview” without changing location.
- **Generating:** source and prompt controls remain disabled, the action gains
  a restrained spinner, and an announced note sets the honest two-minute
  expectation. No retry behavior was added.
- **Candidate ready:** a numbered reveal panel shows the generated companion,
  expiry time, explicit activation action, and reassurance that nothing has
  changed yet.
- **Activating / resetting:** existing callbacks and busy labels remain intact;
  all conflicting actions stay disabled.
- **Exhausted:** creation controls are removed so a student cannot spend time on
  a form that cannot submit. The reset date and continued active appearance are
  stated directly; an already-generated candidate remains activatable.
- **Unavailable / error:** a compact, semantically announced notice follows the
  active companion. Reset remains available for an existing custom companion.
- **Local input error:** invalid type, empty file, oversize file, and read
  failures appear directly beneath the image control. Service errors remain in
  the existing card-level alert and are not treated as automatically retryable.

## Craft and accessibility

- All actions remain native buttons/details/textarea/input controls with at
  least 44px targets and visible `:focus-visible` treatment.
- The full upload button supports keyboard activation, paste, and drag/drop;
  its help text is connected with `aria-describedby`.
- Live regions remain scoped to status changes, quota, current appearance,
  candidate arrival, progress, and errors.
- Breakpoints at 760px and 520px collapse the trail offsets, action row, current
  stage, upload surface, and candidate composition without horizontal overflow.
- Motion is limited to loading and candidate reveal and inherits the global
  reduced-motion override.
- New visible copy has Vietnamese translations; filenames and external error
  content are rendered as content rather than passed through translation.

## Contracts preserved

The component still keeps the source `File`, object URL, prompt, and drag state
locally; revokes object URLs; accepts only PNG/JPEG up to 5 MiB; enforces the
400-character prompt; creates one request UUID per submit; clears the source
only after successful generation; uses the existing callbacks/status model;
and requires explicit activation.

## Verification

- `npm exec -- vitest run src/renderer/CompanionCustomizationCard.test.ts src/renderer/app-language.test.ts` — 10 tests passed.
- `npm run typecheck` — passed.
- Scoped ESLint with fixes — passed.
- `git diff --check` — passed.
