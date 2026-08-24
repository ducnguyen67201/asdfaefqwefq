# Generator State

- Brief: Tro Class workspaces classroom-role and roster UI polish
- Maximum iterations: 10
- Pass threshold: 7.5
- Current iteration: 2
- Status: ready for evaluation

## Iteration 2 response

- Collapsed duplicate class context: the current-class identity, description,
  role, and switcher now share one compact rail; the repeated detail hero is
  removed, so compact layouts reach the selected tab immediately.
- Added honest large-roster ergonomics over the already-loaded member list:
  local name/email/account search, Teacher/Student filtering, visible-result
  count, a 430px bounded viewport, sticky column headings, and an empty result.
- Raised the classroom operational type floor to 11–12px, including roster,
  group, status, switcher, and Admin metadata.
- Completed the ARIA tab pattern with controlled tab panels, roving tab focus,
  Arrow Left/Right, Home, and End keyboard behavior.
- Extended the folio metaphor into Assigned Activities with class-level
  shelves that remain composed for both one-item and dense queues.
- Refined the real Admin interaction model: separately labelled search/role/
  status filters, mutable selects, inline Saving/Saved/Not saved feedback,
  status and row actions, and responsive row cards.
- Added disabled/busy create and join states and clears previous class content
  immediately when switching classes.

## Iteration 2 proof

- `gan-harness/screenshots/iteration-2-people-wide.png`
- `gan-harness/screenshots/iteration-2-people-compact.png`
- `gan-harness/screenshots/iteration-2-dense-roster.png` (500 loaded rows)
- `gan-harness/screenshots/iteration-2-people-vi-compact.png`
- `gan-harness/screenshots/iteration-2-assigned-folios.png`
- `gan-harness/screenshots/iteration-2-admin-wide.png`
- `gan-harness/screenshots/iteration-2-admin-compact.png`

## Iteration 1 direction

“Class folios”: a calm editorial classroom identity built from warm paper,
charcoal ink, yellow teaching rails, blue-green learning accents, serif display
type, and small ledger details. Class context is now the strongest visual layer,
while operational controls stay compact and familiar.

## Production work

- Class overview: composed hero, role/class count, paired create/join cards,
  Teaching/Learning shelves, and tactile class folios.
- Current class: high-contrast switcher, identity monogram, contextual role, and
  class-detail summary hero.
- People: roster composition panel, 5–500 account composer, scannable batch
  result ledger, accessible roster region, group cards, and join-code treatment.
- Library: editorial header, compact upload command bar, review state, resource
  count, and clearer source/status rows.
- Assigned: student-focused class filter, activity folios, status cues, loading,
  and empty state.
- Admin: explicit three-step classroom setup cue plus clear, color-independent
  Teacher/Student/Unassigned role controls that remain compact in the table.
- English/Vietnamese: added translations for every new production label.
- Craft: visible focus states, long-content containment, responsive compositions,
  semantic controls, and reduced-motion coverage.

## Visual proof

- `gan-harness/preview.html?view=overview`
- `gan-harness/preview.html?view=people`
- `gan-harness/preview.html?view=assigned`
- `gan-harness/preview.html?view=admin`
- `gan-harness/screenshots/iteration-1-overview.png`
- `gan-harness/screenshots/iteration-1-people.png`
- `gan-harness/screenshots/iteration-1-assigned.png`
- `gan-harness/screenshots/iteration-1-admin.png`

Focused ESLint and whitespace checks pass for the owned production files.
