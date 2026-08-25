# Knowledge Spaces

Knowledge Spaces are TroCode's database-backed container for reusable context and guided work. The vocabulary is intentionally general: a Space can be a class, onboarding program, workshop, research project, field procedure, or team playbook. Activities can be assignments, labs, drills, cases, or work orders.

## Classroom package and roles

The desktop presents education-focused Spaces as **Class workspaces**. Account
creation does not grant a classroom role. An administrator assigns one of these
roles from `/source/admin`:

- **Teacher** — may create Class workspaces. A class owner can add registered
  Teachers and Students; a non-owner Teacher can add registered Students.
- **Student** — may join only as a participant and use assigned class resources,
  Activities, Attempts, help, and submissions. Student views do not expose the
  roster, groups, upload controls, authoring, Runs, or facilitator insights.
- **Unassigned** — may not create or join a class until an administrator assigns
  Teacher or Student.

The administrator-assigned role is an eligibility boundary. The existing
`owner | facilitator | participant` membership remains the authority inside one
specific class. A Teacher may therefore own one class, facilitate another, and
participate in a third without receiving owner access everywhere. A Student may
only hold participant memberships. Existing owner/facilitator accounts are
backfilled to Teacher and participant-only accounts to Student by migration 018.

Teachers add already registered accounts by email from the People tab. Requests
are deduplicated, limited to 500 emails per idempotent batch, and may be repeated
as often as needed. Missing, blocked, ambiguous, or incorrectly assigned accounts
are not added and are reported separately. Join codes remain supported, but
redemption must match the administrator-assigned account role.

Class workspaces are navigation over existing Spaces, not trusted local folders
and not a second lifecycle/session system. Switching class changes only the
current classroom surface.

## Canonical model

PostgreSQL owns Space membership, groups, immutable Activity versions, Runs, assignment snapshots, Attempts, Work Sessions, submissions, and evidence. A private S3-compatible bucket owns uploaded bytes. There is no required `trocode.space.yaml` and no folder-as-database behavior. A folder upload is a reviewed point-in-time snapshot.

```text
Space
├── Library (versioned Sources)
├── People and Groups
└── Activities
    └── immutable Activity Version
        └── Run (live, async, or hybrid)
            └── private Attempt
                ├── bounded Work Sessions
                ├── explicit submissions
                └── provenance-labeled evidence
```

## Live classroom rooms

A live classroom is a `live` or `hybrid` Run with a `room` target; it is not a
second session model. A draft Run is the lobby, an open Run is the live class,
and a closed Run removes the student's sticky Activity authority. The teacher
creates a short-lived room code. The API stores only its HMAC digest and an
authenticated join creates or reuses exactly one Space membership, assignment,
Attempt, and participation for that Run.

Teachers can broadcast only typed exercise or public-HTTPS link directives.
Automatic link opening requires both an origin published in the immutable
Activity version and local student consent; Electron main claims and
revalidates the directive before opening it once. Otherwise the student gets a
visible Open link action. A model may assist with the student's explicit Help
or Check Work Session, but it cannot broadcast, submit, mark work ready, or
complete an Attempt on its own.

The classroom dashboard is intentionally event-based. It reports join/lobby,
Work Session, explicit Help, Ready, Submit, Return, Complete, and Leave facts.
It does not collect cursor motion, typing speed, screen history, attention, or
an inferred “stuck” state.

## Launch context and performance

An Activity launch combines a compact immutable definition with fresh work context. Workspace Activities use one explicitly trusted local folder. Current-screen Activities force one fresh CUA observation; the semantic route is preferred when available and the existing screenshot route remains the fallback. Uploaded books and course material are not inserted wholesale. The task gets a title/role catalog and an Attempt-scoped `search_activity_knowledge` tool capped at six results and 12,000 characters.

Starter materialization is explicit. Electron main downloads exact pinned starter versions using short-lived GET tickets, validates path, size, and SHA-256, writes into a new staging directory, atomically renames it, and registers that directory as a trusted Workspace. It never overwrites or runs starter code.

## Privacy and insights

Participants see the Run's insight policy before starting. The default policy reports explicit help requests and operational state. Optional agent candidates are bounded to allowlisted criteria/tags, capped per Work Session, and labeled as hypotheses. They cannot grade, diagnose, or change Attempt state. Facilitators receive no live screen, ordinary task conversation, unsaved editor state, or unrelated local files.

Submission is a separate participant action. The renderer previews relative paths; Electron main hashes and uploads only those selected files. Task completion never triggers upload.

## Deployment and rollback

Set `TROCODE_KNOWLEDGE_SPACES_ENABLED=true` only on the hosted API after configuring private bucket credentials. Run `./bin/trocode-api ingestion-worker` as a separate Railway worker process, or `cargo run --manifest-path services/api/Cargo.toml --locked -- ingestion-worker` locally. The bucket role should permit only exact-object `PutObject`, `GetObject`, and `HeadObject`; public access and bucket listing should be denied.

The Rust API owns the complete live-room, directive, assessment, and dashboard
route families. It applies migration 020, uses HMAC-authenticated `tro_live_`
sessions, and preserves the installed Electron response contracts. The same
binary owns material ingestion through its worker command. Startup with the
feature enabled fails closed if its database, HMAC key, object store, or
migration 020 tables are unavailable.

Back up PostgreSQL metadata and object storage together. Retention deletion must remove metadata and objects through an audited job; never infer object keys in desktop code. To roll back, disable the feature flag first, stop the worker after its current lease, and retain both stores. Disabling the flag hides desktop navigation and rejects feature routes without deleting data.

During rollback, redeploy the recorded last-known-good whole backend before
disabling the feature flag. Never split one mutation family across deployments;
rollback requires no row conversion or destructive SQL.

The operational load script covers 200/500-row dashboard projection. With
`TEST_DATABASE_URL`, the PostgreSQL integration suite also admits 200 students
concurrently and verifies one participation and Attempt per user. Real
assignment/start/search latency gates require a disposable S3-compatible test
service.

The Rust `classroom_e2e` test applies the checked-in migration chain to a
disposable PostgreSQL database and exercises the desktop-facing flow through
Axum: room creation, lobby join, Run start, directive delivery and one-time
claim, Help and resolution, Ready and review, Leave, authentication rejection,
and the exact 200-participant capacity boundary.
