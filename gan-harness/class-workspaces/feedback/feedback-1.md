# GAN Design Evaluation — Iteration 1

## Verdict

**Weighted score: 7.47 / 10 — FAIL** (pass threshold: 7.5)

This is already a coherent, handsome classroom product, especially on the
People surface. It does not yet clear the stricter question, “would this win a
design award while remaining immediately usable for a real teacher?” The class
folio language is memorable, but several surfaces fall back to conventional
dashboard patterns, the compact detail view repeats too much context, and the
500-person and real Admin states are not yet demonstrated or resolved with the
same level of craft.

| Category | Score | Weight | Contribution |
| --- | ---: | ---: | ---: |
| Design Quality | 7.8 | 0.35 | 2.73 |
| Originality | 7.6 | 0.30 | 2.28 |
| Craft | 6.8 | 0.25 | 1.70 |
| Functionality | 7.6 | 0.10 | 0.76 |
| **Total** |  |  | **7.47** |

## Design Quality — 7.8 / 10

### Evidence that works

- `iteration-1-people.png` has the strongest hierarchy of the set. The dark
  “At a glance” block, capable bulk composer, result summary, roster, and groups
  read as one deliberate teacher workflow rather than disconnected forms.
- The class switcher is unmistakable, the warm paper/charcoal/yellow palette is
  cohesive with Tro, and role labels are always accompanied by text rather than
  color alone.
- `iteration-1-overview.png` establishes an attractive class identity through
  folio numbers, notebook-like spines, initials, and distinct Teaching/Learning
  color families.
- The responsive rules do intentionally recompose grids instead of merely
  shrinking them. `iteration-1-people-compact.png` confirms the switcher, hero,
  summary counts, tabs, and composition card remain legible at the narrower
  desktop width.

### Deductions

- The detail page says “Python Foundations” three times before the teacher
  reaches the actual People work: back context, current-class switcher, and the
  large class hero. In `iteration-1-people-compact.png`, this consumes roughly
  half the viewport before the first actionable classroom content. The
  hierarchy is clear but inefficient.
- `iteration-1-assigned.png` is much less resolved than People. Two conventional
  cards sit in the upper-left of a very large empty canvas, with no meaningful
  grouping, progression, due context, or visual rhythm after the hero.
- `iteration-1-overview.png` similarly becomes visually inert after the first
  row of classes. The create/join pair is polished but still reads as two
  generic stacked forms and competes with the classes, which should be the main
  return-user destination.
- The Admin surface is visually clean but returns to a standard KPI-cards plus
  table dashboard. It lacks the decisive editorial/classroom character visible
  on People.

## Originality — 7.6 / 10

### Evidence that works

- The class-card spine, folio number, stamped initials, slightly tactile hover,
  and editorial serif titles create a specific classroom archive metaphor.
- The dark roster-composition block is a memorable functional device: it makes
  Teacher/Student proportions immediately understandable without becoming a
  chart-heavy dashboard.
- Restrained line patterns and geometric marks provide identity without using
  stock illustration or gratuitous gradients.

### Deductions

- The strongest original metaphor largely stops at the overview cards. Assigned
  Activities, Admin, roster results, and groups use familiar SaaS cards, pills,
  summary tiles, and tables.
- Decorative circles recur in several heroes without carrying new meaning.
  They start to feel like a styling motif rather than a classroom-specific
  system.
- The two large create/join panels take prime overview space but do not offer a
  novel interaction or information model. For a returning teacher, they dilute
  the more original “class folio” shelf.

## Craft — 6.8 / 10

### Evidence that works

- Spacing, borders, radii, subtle shadows, and warm/cool role accents are
  unusually consistent across the desktop screenshots.
- Production markup uses semantic forms, labels, buttons, selects, tables,
  status regions, and a keyboard-focusable roster region. Reduced-motion rules
  are present.
- Long class descriptions and titles have explicit truncation or flexible grid
  behavior; the main grids stack at 1120, 900, and 700-pixel breakpoints.

### Deductions

- Operational text is repeatedly set to 9–11px in production CSS: switcher
  labels, roster roles, account IDs, result labels, group metadata, and Admin
  flow text. This is visibly delicate in the wide screenshots and will be less
  robust with Vietnamese diacritics, display scaling, or lower-quality screens.
- “Capable at 5 or 500 accounts” is not yet solved. `.class-roster-wrap` has no
  bounded height, sticky header, local find/filter affordance, or density mode;
  500 rows would turn the entire People page into a very long document. The
  screenshot only proves three rows while displaying a total of 28.
- The compact screenshot ends before the composer, results, roster, and groups,
  so the most complex responsive states are not actually demonstrated. No
  narrow Admin capture is provided.
- The Admin screenshot is not production-faithful. The preview substitutes a
  unified Classes/People/Assigned/Admin sidebar, a combined search treatment,
  static role pills, five columns, and no row actions. Production
  `admin.html`/`admin.js` instead has Users/Usage/Access codes navigation,
  separate role/status filters, mutable role `<select>` controls, seven columns,
  and action buttons. Consequently the screenshot cannot validate the actual
  surface required by the brief.
- The tab strip declares `role="tablist"` and `role="tab"`, but the production
  panels have no `tabpanel`, `aria-controls`, or arrow-key behavior. Focus styles
  are present globally, but this is not yet a complete tab interaction.
- The chosen serif stack depends on Iowan Old Style with Georgia fallback. The
  visual metrics may change noticeably on systems without Iowan, especially in
  the largest headings.
- There is no visual proof for Vietnamese, pending-role, student class detail,
  real loading/error states, 500-input feedback, or role-mismatch details even
  though these paths exist in production code.

## Functionality — 7.6 / 10

### Evidence that works

- Role-aware visibility remains understandable: teachers receive creation and
  people-management affordances; students do not receive the People tab and are
  directed to Assigned Activities.
- The bulk composer communicates its 500-address boundary, invalid inputs
  disable submission, result categories are explicit, and details expose
  mismatched or unavailable accounts.
- Actual Admin code disables the role select during mutation, restores the
  prior value on failure, and provides an account-specific accessible label.
- No new frontend dependency or unsafe renderer capability is introduced.

### Deductions

- Create/join forms keep their submit buttons enabled while empty and have no
  submitted/busy treatment, inviting no-op clicks or duplicate requests.
- On class change, `SpaceDetailPage` does not clear or place existing sources,
  members, and groups into a loading state before the new requests settle. The
  next class can briefly display the previous class’s counts/content.
- The real Admin role mutation has no visible inline saving/error state on the
  row; feedback is only a transient toast, which is weak for a consequential
  role change.
- The screenshots do not exercise the actual Admin controls, keyboard tab
  behavior, unsuccessful bulk results, or student class view, so functional
  confidence is lower than the visual polish suggests.

## Highest-leverage changes for iteration 2

1. **Collapse duplicate class context.** Integrate the current-class identity,
   contextual role, and switcher into one compact rail or into the class hero.
   On narrow widths, show the class name once and let the People work begin much
   sooner.
2. **Design the real 500-person state.** Add a bounded roster viewport with a
   sticky header and local search/role filter, or an equally clear progressive
   disclosure. Show a populated 100–500-row proof and a dense compact state.
   Keep this client-side so authorization/API behavior remains unchanged.
3. **Make the Admin proof honest.** Capture and refine the real production
   Admin markup, including separate filters, actual role selects, saving/error
   feedback, status/actions, and narrow responsive cards. Remove preview-only
   substitutions.
4. **Push the class-folio language into Assigned.** Group work by class or use a
   restrained editorial queue/timeline so the page remains composed with two,
   ten, or zero activities. Reduce the dead lower canvas without inventing
   unsupported data.
5. **Raise the type floor and finish accessibility.** Use at least 11–12px for
   operational metadata, complete the tab pattern, preserve visible
   `:focus-visible` states, and stress-test Vietnamese wrapping at the 700 and
   900-pixel layouts.
6. **Capture the missing evidence.** Provide production-faithful screenshots of
   Teacher overview, Student class, pending/empty, role-mismatch results, 500-row
   roster behavior, real Admin wide/compact, and Vietnamese compact. These are
   core brief states, not optional polish.

## Pass decision

**Does not pass iteration 1.** The work is close, but the next iteration should
prioritize responsive information density, large-roster usability, and fidelity
between design proof and production. Those changes would move it from a polished
feature toward an award-worthy system.
