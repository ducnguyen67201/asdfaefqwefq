# Live Classroom Design Evaluation Rubric

Passing weighted score: **7.5 / 10**. Maximum iterations: **10**, with plateau stop after two non-improving evaluations following iteration 3.

### Design Quality (weight: 0.35)

- Teacher and student roles are visually unmistakable.
- Preparation, lobby, live work, and review form one legible progression.
- Hierarchy, typography, spacing, density, and state treatment feel intentional and polished.
- The experience feels calm, trustworthy, and classroom-ready rather than like a generic CRUD dashboard.

### Originality (weight: 0.30)

- The live-class layer has a distinctive but coherent identity within Tro.
- Room code, session bar, directive banner, and status lanes use memorable composition without novelty for its own sake.
- The design avoids boilerplate SaaS cards, surveillance metaphors, gradients, and gamification.

### Craft (weight: 0.25)

- Responsive layouts, focus states, semantic labels, aria-live feedback, reduced motion, and non-color status cues are complete.
- Empty, loading, error, lobby, live, ended, Help, ready, submitted, returned, and auto/manual link states are handled.
- English/Vietnamese critical strings and concise privacy explanations are present.
- Components reuse shared schemas/APIs and do not bypass Electron-main authority.

### Functionality (weight: 0.10)

- Teacher can create/start a Room Run, create a room code, preview/broadcast directives, resolve Help, and Complete/Return.
- Student can join, consent, receive/open/dismiss directives, Help, Check, Ready/Submit, restore, and Leave.
- Participant UI does not expose teacher-only upload/publish/people/dashboard controls.
- No continuous observation or automatic submission/grade behavior is introduced.

## Evaluator output

For each iteration, write `gan-harness/feedback/feedback-N.md` containing:

- Scores for all four categories out of 10.
- Weighted total.
- Concrete evidence from code and, when runnable, screenshots/interactions.
- Highest-impact changes required for the next iteration.
- PASS when weighted total is at least 7.5; otherwise FAIL.
