# Class workspaces GAN design build report

## Brief

Polish the Teacher/Student class-workspace package into a clear, distinctive TroCode experience across the Electron renderer and the production Admin dashboard. The design needed to support account-role assignment, class switching, Teacher-managed rosters of up to 500 registered accounts per batch, Student-restricted views, English/Vietnamese labels, and realistic compact layouts without changing the underlying role model.

## Result

- Status: **PASS**
- Final score: **8.00 / 10**
- Pass threshold: **7.50 / 10**
- Iterations used: **2 of 10**
- Runtime/cost: not reported by the local harness

| Iteration | Design quality | Originality | Craft | Functionality | Weighted total | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 7.8 | 7.6 | 6.8 | 7.6 | 7.47 | Fail |
| 2 | 8.4 | 8.1 | 7.4 | 7.8 | 8.00 | Pass |

## What changed

- Introduced a class-folio visual language spanning class shelves, the compact class switcher, People, and Assigned Activities.
- Added a bounded, searchable, role-filterable roster with sticky headings and clear 500-person batch results.
- Added complete keyboard/ARIA tab behavior, visible busy states, stronger operational type, and responsive Admin role controls with Saving/Saved/Not saved feedback.
- Added compact and Vietnamese evidence plus dense-roster, Assigned, and Admin states.
- After evaluation, class switching was hardened by remounting the class detail surface so drafts and late requests cannot cross class boundaries; singular activity counts were also corrected.

## Remaining follow-up opportunities

- Validate and capture the production Admin page itself at its real responsive breakpoints; the harness Admin compact image is a close reconstruction, not release proof.
- Add visual evidence for Student, unassigned-role, loading, empty, error, and role-mismatch states.
- Let returning Teachers collapse or de-emphasize create/join forms when class folios are already present.

## Evidence and files

- Brief: `gan-harness/class-workspaces/spec.md`
- Rubric: `gan-harness/class-workspaces/eval-rubric.md`
- Generator state: `gan-harness/class-workspaces/generator-state.md`
- Iteration feedback: `gan-harness/class-workspaces/feedback/feedback-1.md`, `feedback-2.md`
- Interactive proof: `gan-harness/class-workspaces/preview.html`
- Screenshots: `gan-harness/class-workspaces/screenshots/`
- Production renderer: `src/renderer/SpacesPage.tsx`, `ClassWorkspaceSwitcher.tsx`, `SpaceDetailPage.tsx`, `SpaceLibrary.tsx`, `AssignedActivitiesPage.tsx`, `app-language.ts`, and `src/index.css`
- Production Admin: `services/api/public/admin.html`, `admin.js`, and `admin.css`
