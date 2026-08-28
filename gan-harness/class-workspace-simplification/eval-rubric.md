# Class workspace design evaluation rubric

The evaluator must be strict. A merely functional rearrangement does not pass. Score each category from 1–10 and compute the weighted total. Passing score: 7.5.

## Design Quality — weight 0.35

- Is the selected class and current section obvious within three seconds?
- Is there one dominant action in the empty Materials state?
- Are duplicate navigation and duplicate member-management actions removed?
- Does typography and spacing replace nested borders and control clutter?
- Would a first-time Teacher understand where to add material, create an Activity, and manage People?

Penalize generic admin-dashboard composition, border soup, oversized empty panels, and competing primary buttons.

## Originality — weight 0.30

- Does the design extend Tro's warm editorial classroom identity?
- Are the class identity, navigation, and empty state composed with deliberate character rather than a component-library default?
- Does the result avoid predictable AI gradients, random pills, and decorative noise?

Penalize novelty that makes the workflow harder to understand.

## Craft — weight 0.25

- Are spacing, type scale, alignment, hover/focus states, and responsive behavior polished?
- Does the disclosure work with keyboard and screen-reader semantics?
- Do empty, populated, loading, error, Teacher, and Student/read-only states remain coherent?
- Is visible copy concise and teacher-centered?

Penalize layout shifts, ambiguous labels, inaccessible tab behavior, and controls that overflow at narrower widths.

## Functionality — weight 0.10

- Do upload files, snapshot folder, content role, tabs, and roster flows still call the existing APIs?
- Do focused tests, typecheck, and lint pass?
- Are backend contracts untouched?

## Required evaluator output

Write `gan-harness/class-workspace-simplification/feedback-NNN.md` containing:

1. scores and weighted total;
2. pass/fail against 7.5;
3. the five most important concrete issues, ordered by impact;
4. interaction evidence from the live UI or focused tests;
5. no implementation edits—the evaluator critiques only.
