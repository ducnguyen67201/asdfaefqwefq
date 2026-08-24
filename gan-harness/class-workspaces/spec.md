# GAN Design Brief: Tro Class Workspaces

Polish the newly implemented Teacher/Student classroom experience until it feels
like a deliberate, premium part of Tro rather than a form-heavy feature bolted
onto the product.

## Surfaces

1. Desktop Class workspaces overview and empty/pending-role states.
2. Current-class switcher and class detail header.
3. Teacher People tab: bulk email entry, role choice, result summary, roster,
   groups, and join-code affordances.
4. Student class view and Assigned Activities class filter.
5. Admin Users table classroom-role assignment and filtering.

## Visual direction

- Preserve Tro's warm paper palette, charcoal ink, yellow accent, restrained
  depth, generous radii, and calm editorial tone.
- Make class context unmistakable at a glance: current class, Teaching versus
  Learning, and the person's contextual role must have a strong hierarchy.
- Replace generic stacked forms with composed, purposeful layouts. Bulk member
  management should feel capable at 5 or 500 accounts without looking like an
  enterprise spreadsheet dump.
- Use subtle original details—class identity marks, tactile cards, meaningful
  grouping, elegant status summaries, refined hover/focus/motion—without adding
  decoration that competes with classroom work.
- Admin should remain denser and operational, but classroom role controls should
  read clearly and not destabilize the responsive table.
- Support English/Vietnamese length, reduced motion, keyboard focus, smaller
  widths, empty/error/loading states, and color-independent status cues.

## Product constraints

- Do not change authorization, APIs, data flow, lifecycle, CUA, sessions, or
  membership behavior.
- Do not add dependencies or enable Node integration in the renderer.
- Reuse current React and CSS architecture. Keep all controls semantic and
  accessible.
- Preserve the functionality and tests already implemented in this worktree.
- The production UI files are the deliverable. A self-contained
  `gan-harness/preview.html` may be created to visually evaluate representative
  populated and empty states, but it must mirror production markup/styles.

## Primary goal

Visual excellence. Push beyond "clean dashboard" toward a distinctive Tro
classroom experience, while keeping it practical and trustworthy for teachers
and students.
