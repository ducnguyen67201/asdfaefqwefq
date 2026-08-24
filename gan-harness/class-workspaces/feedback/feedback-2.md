# GAN Design Evaluation — Iteration 2

## Verdict

**Weighted score: 8.00 / 10 — PASS** (pass threshold: 7.5)

Iteration 2 crosses the threshold. It converts the strongest iteration-1 idea,
the class folio, into a more complete product language and resolves the most
important teacher-usability failures: the detail header is substantially
shorter, a 500-person roster is searchable and bounded, tabs use a complete
keyboard pattern, and Assigned Activities now has meaningful class-level
composition. It is still not flawless production craft; preview fidelity and
cross-class state safety remain the largest concerns.

| Category | Raw score | Weight | Weighted score |
| --- | ---: | ---: | ---: |
| Design Quality | 8.4 / 10 | 0.35 | 2.94 |
| Originality | 8.1 / 10 | 0.30 | 2.43 |
| Craft | 7.4 / 10 | 0.25 | 1.85 |
| Functionality | 7.8 / 10 | 0.10 | 0.78 |
| **Total** |  |  | **8.00 / 10** |

## Direct comparison with iteration 1

| Category | Iteration 1 | Iteration 2 | Change |
| --- | ---: | ---: | ---: |
| Design Quality | 7.8 | 8.4 | +0.6 |
| Originality | 7.6 | 8.1 | +0.5 |
| Craft | 6.8 | 7.4 | +0.6 |
| Functionality | 7.6 | 7.8 | +0.2 |
| **Weighted total** | **7.47** | **8.00** | **+0.53** |

The biggest improvement is not decorative. Iteration 1 spent nearly half the
compact viewport repeating the class name and context; iteration 2 removes the
separate hero and reaches the selected People tab much sooner. The roster also
moves from a three-row demonstration to a real large-list interaction model.
Assigned Activities changes from isolated generic cards in empty space to a
recognizable classroom archive.

## Design Quality — 8.4 / 10

### Evidence that earns the score

- `iteration-2-people-wide.png` reads as one mature teacher workflow. Current
  class, contextual role, selected tab, composition, batch entry, results,
  roster, and groups have a clear order without requiring interpretation.
- The compact context rail in `iteration-2-people-compact.png` preserves class
  name, description, role, and switching while eliminating the former repeated
  detail hero. The People heading now appears in the first screenful.
- `iteration-2-dense-roster.png` proves that 500 members no longer turn the page
  into a 500-row document. Search, role filtering, result count, sticky headers,
  and a bounded scroll region form a credible operational surface.
- `iteration-2-assigned-folios.png` is a material improvement. Class grouping,
  colored folio rails, monograms, counts, and numbered activity cards turn the
  page into a navigable classroom archive rather than a generic task grid.
- The real Admin information hierarchy is clearer in
  `iteration-2-admin-wide.png`: filters are independently labelled, role
  controls read as controls, and Saving/Saved/Not saved are visible without
  relying on color.

### Remaining deductions

- The overview was not redesigned or recaptured. Its two large create/join
  forms still compete with the class shelves for prime space, especially for a
  returning teacher.
- The compact People view is more efficient at the top, but the composition
  block plus large composer still creates a long pre-roster path. It is usable,
  though not exceptionally economical.
- In Assigned, an odd activity count leaves a deliberately empty grid cell, and
  a one-activity class uses only about half the folio width. The folio metaphor
  makes this more intentional than iteration 1’s empty canvas, but dense and
  sparse classes could still balance more gracefully.
- No iteration-2 proof shows the actual Student class detail, pending-role
  overview, loading/error state, or empty class state, all named in the brief.

## Originality — 8.1 / 10

### Evidence that earns the score

- The folio system is now a product language rather than a single card style:
  it connects class shelves, class monograms, roster-ledger typography, and
  Assigned class groupings.
- The dark roster-composition panel remains an excellent original device. It
  communicates scale and role balance quickly without looking like an
  enterprise analytics dashboard.
- The design uses warm teaching rails and cool learning/activity accents with
  text labels, making the palette both memorable and useful.
- The restrained editorial serif/sans contrast, numbered activity folios, and
  small ledger details feel specific to Tro rather than copied from a generic
  classroom LMS.

### Remaining deductions

- Admin appropriately remains operational, but its KPI-card/table structure is
  conventional and contributes little to the distinctive classroom identity.
- Create/join forms, result tiles, and group cards still use familiar SaaS
  compositions. The original thinking is concentrated in overview, People,
  and Assigned rather than fully pervasive.
- Alternating Assigned folio rail colors are based on list position rather than
  a durable class meaning; this is attractive but primarily decorative.

## Craft — 7.4 / 10

### Evidence that earns the score

- Classroom operational typography is raised to an 11–12px floor in the new
  production rules. Account IDs, roster roles, switcher labels, group metadata,
  and batch-result labels are meaningfully more robust than iteration 1.
- The roster has `max-height: 430px`, sticky headings, keyboard-focusable scroll
  containment, a thin scrollbar, query/role controls, an `aria-live` visible
  result count, and a clear no-match row.
- The tab implementation now includes `tabpanel`, `aria-controls`,
  `aria-labelledby`, roving `tabIndex`, Arrow Left/Right, Home, and End.
- Create/join controls have disabled and busy copy, Admin mutations expose
  inline live status, and reduced-motion/focus treatments remain present.
- `iteration-2-people-vi-compact.png` shows that several longer Vietnamese
  labels fit the compact rail, tab strip, composition panel, and composer
  without collisions.

### Remaining deductions

- The Vietnamese screenshot is only partially production-faithful. Fixed UI
  copy such as the People explanation, role-verification note, batch help,
  result explanation, and `Student` option remains English because the preview
  uses an incomplete DOM text-substitution map. Production translations exist,
  but this screenshot does not actually prove them.
- The Admin proof still uses custom `admin-proof-*` markup and CSS instead of
  loading production `admin.html` and `admin.css`. Wide structure is now close,
  but the 760px compact proof is not faithful: preview cards activate at 900px,
  whereas production converts the table at 700px and changes the sidebar to a
  top layout at that same breakpoint. The screenshot also adds field labels via
  `data-label` behavior that the generated production rows do not provide for
  every cell.
- Production renders `{count} activities` for every class. English therefore
  becomes “1 activities,” while the handcrafted preview shows “1 activity.”
  This is a concrete preview/production mismatch visible in the Design Lab
  folio.
- The 500-row implementation renders all 500 DOM rows and filters them on every
  query update. That is acceptable at this scale, but the proof does not test
  long real names/emails, unusually long Vietnamese class names, or Windows
  fallback typography.
- Overview, student, pending, empty, loading, error, and role-mismatch states
  remain without iteration-2 visual evidence.

## Functionality — 7.8 / 10

### Evidence that earns the score

- Existing role-gated behavior remains intact; the design additions are local
  renderer state and styling rather than authorization or API changes.
- Bulk-add validation and result handling are preserved while the roster adds
  non-destructive client-side filtering.
- Empty create/join submissions are now disabled and each operation visibly
  enters a busy state.
- Switching class immediately clears sources, groups, members, roster filters,
  errors, batch results, and returns to Library, reducing the stale-data flash
  identified in iteration 1.
- Admin role mutation disables the select, announces Saving/Saved/Not saved,
  restores the previous value after failure, and preserves row actions.

### Remaining deductions

- Class switching does not reset all class-specific state. `memberEmails`,
  `memberRole`, `groupName`, `selectedGroupId`, `inviteCode`,
  `activityVersionId`, `runId`, `participants`, and `mode` can survive into the
  next class. The most consequential case is a prepared email batch or selected
  group remaining available after the teacher changes class.
- Clearing arrays does not cancel or identity-guard in-flight requests from the
  previous class. An older sources/groups/members request can still resolve
  after the switch and temporarily overwrite the cleared/new class state.
- The English singular activity-count defect is production-visible even though
  the preview hides it.
- There is no automated or visual evidence here for keyboard execution of the
  completed tab model, Admin compact production behavior, or cross-class race
  handling.

## Production-versus-preview fidelity

### Faithful or substantially faithful

- People wide/compact markup closely mirrors the production
  `ClassWorkspaceSwitcher`, People panel, composer, result ledger, and roster
  toolbar.
- The dense roster uses the same production classes and realistically inserts
  500 rows, so it is useful proof of scroll density and sticky headings.
- Assigned folios structurally match the production React component and its
  class-level grouping.
- Admin wide now represents the actual filter, role-select, status, access-code,
  last-seen, and action concepts rather than the simplified iteration-1 table.

### Not faithful enough

- Admin remains a custom reconstruction with different responsive breakpoints
  and mobile row labelling. `iteration-2-admin-compact.png` should not be treated
  as proof of the production Admin layout.
- Vietnamese proof uses a partial client-side replacement map rather than the
  production translation function, producing a mixed-language screenshot.
- The preview manually writes the correct singular “1 activity,” masking the
  production pluralization defect.
- The common preview sidebar is not the Electron renderer’s full production
  navigation, though this has limited impact on evaluating the classroom body.

## Remaining issues ranked by impact

1. **Cross-class state and request isolation — high.** Reset every class-bound
   editor, invite, composer, and run state on switch, and ignore responses whose
   space ID is no longer current. This protects teachers from acting on data
   prepared for another class.
2. **Admin compact production fidelity — high.** Test and capture the actual
   Admin page at its real breakpoints. Either make the production 760px table
   match the intended card layout or stop presenting the preview-only cards as
   production proof.
3. **Complete localization proof — medium.** Render screenshots through the
   production translation path and test long Vietnamese user-visible copy, not
   a selected replacement map.
4. **English pluralization — medium.** Render “1 activity” and “N activities”
   from an explicit singular/plural message choice.
5. **Missing student/pending/error evidence — medium.** Capture these core
   states and verify that compact Student navigation exposes no teacher-only
   controls.
6. **Overview return-user priority — low.** Reduce the visual dominance of
   create/join after a teacher has classes, allowing folios to become the
   immediate destination.

## Pass decision

**Passes iteration 2 at 8.00 / 10.** The result now feels at home in a premium,
distinctive desktop product and remains immediately understandable for a real
teacher. The pass does not waive the production concerns above; cross-class
state isolation and honest Admin responsive validation are the most important
follow-up work before release.
