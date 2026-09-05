# Classroom deployment compatibility fix

## Problem and deployed evidence

The hosted API is running `a6161ec` (PR #61), whose migration 034 enables
`explain_assignment` Run directives. PR #63 was based on a different history and
assigned 034 to session broadcasts. Railway's attempted deployment of `53191a8`
failed with `migration 34 was previously applied but has been modified`; the
previous healthy API remained active. Clean-database CI did not cover that
deployed SQLx history.

## Change

- Restore migration `034_classroom_explain_assignment_directive.sql` byte for byte
  from the deployed commit. Its Git blob is
  `e0c2f662cfed959781318f5e043a6388b967f98d`.
- Number the new session broadcast and guidance migrations 035 and 036. Their SQL
  is unchanged. Register all 36 migrations and update the inventory.
- Retain the deployed Run directive create/feed/claim contract, including
  `consent_required` delivery and `kind` in claim receipts. Duplicate claims remain
  rejected; claims do not change assignment completion or start work on the server.
- Allow updated desktop clients to parse existing explanation notices without
  interpreting them as a new session broadcast or automatically executing them.

There is no production SQLx-history rewrite, checksum bypass, data reset, or
conversion of historical directives into new broadcasts. The previously rejected
PR #63 migrations had not been applied by the failed hosted deployment.

## Verification

- The PostgreSQL upgrade regression installs a versioned copy of the deployed
  001–034 SQLx history and pins migration 034's SHA-384 checksum. Upgrade and restart
  preserve every previous history record and existing user data, create both new
  tables, and retain the legacy directive constraint. Corrupt checksums still fail.
- Three PostgreSQL compatibility tests and both classroom HTTP tests pass. The
  classroom test includes old-client create, feed and one-time claim behavior.
- The desktop client regression reads the deployed explanation feed using only
  GET; it does not consume a claim or start a task.
- Full `npm run check` passes with 904 desktop tests and 24 SDK tests, plus the
  enabled Rust tests, formatting, Clippy and audit policy.
- `npm run package` passes for macOS arm64, and `npm run bazel:check` passes.
- Runtime npm audit reports zero vulnerabilities. The current lockfile has three
  existing moderate development advisories; this fix changes no dependencies.

## Release

Merge only after packaging, Bazel and hosted CI pass. The existing Railway
production API follows main; verify that its healthy revision advances to the
merged fix and that `/readyz` succeeds. Preserve the database and apply migrations
through normal API startup. After the new migrations apply, use a compatible
forward fix if needed; do not rewrite migration history to return to the old API.

Real teacher/student voice and screen-context acceptance remains a separate live
test. This compatibility patch sends no classroom broadcast or paid model request.
