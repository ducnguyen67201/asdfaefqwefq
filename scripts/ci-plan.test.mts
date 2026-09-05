import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkMigrations, planChecks, runPlan } from './ci-plan.mts';

const full = { source: true, rust: true, desktop: true };

test('renderer and test changes get shared checks; unknown and native changes get full checks', () => {
  assert.deepEqual(planChecks(['src/renderer/Sidebar.tsx', 'src/index.css']),
    { source: true, rust: false, desktop: false });
  assert.deepEqual(planChecks(['docs/testing/example.md', 'AGENTS.md']),
    { source: false, rust: false, desktop: false });
  for (const path of ['src/shared/contracts.ts', 'src/index.ts', 'src/preload.ts',
    'native/helper.swift', 'services/api/src/db.rs', 'services/agent-runtime/src/index.ts',
    'package-lock.json', 'webpack.plugins.ts', '.github/workflows/ci.yml',
    'src/renderer/example.mjs', 'docs/helper.ts', 'new-unknown-file']) {
    assert.deepEqual(planChecks([path]), full, path);
  }
  assert.deepEqual(planChecks(['src/renderer/App.tsx', 'src/shared/contracts.ts']), full);
  assert.deepEqual(planChecks(['README.md'], true), full);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'tro-ci-plan-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (path: string, content: string) => writeFileSync(join(root, path), content);
  git('init', '--quiet');
  git('config', 'user.email', 'ci-test@example.invalid');
  git('config', 'user.name', 'CI test');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, 'services/api/migrations'), { recursive: true });
  mkdirSync(join(root, 'services/api/src'), { recursive: true });
  write('services/api/migrations/001_initial.sql', 'SELECT 1;\n');
  write('services/api/src/db.rs', 'include_str!("../migrations/001_initial.sql");\n');
  const commit = () => { git('add', '.'); git('commit', '--quiet', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = commit();
  return { root, write, commit, base, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('unchanged history and a registered append-only migration pass', () => {
  const f = fixture();
  try {
    checkMigrations(f.root, f.base);
    f.write('services/api/migrations/002_next.sql', 'SELECT 2;\n');
    f.write('services/api/src/db.rs', 'include_str!("../migrations/001_initial.sql");\ninclude_str!("../migrations/002_next.sql");\n');
    f.commit();
    checkMigrations(f.root, f.base);
  } finally { f.cleanup(); }
});

for (const operation of ['edit', 'delete', 'rename', 'duplicate', 'unregistered', 'out-of-order'] as const) {
  test(`rejects ${operation} migrations`, () => {
    const f = fixture();
    try {
      if (operation === 'edit') f.write('services/api/migrations/001_initial.sql', 'SELECT 99;\n');
      if (operation === 'delete') rmSync(join(f.root, 'services/api/migrations/001_initial.sql'));
      if (operation === 'rename') renameSync(join(f.root, 'services/api/migrations/001_initial.sql'), join(f.root, 'services/api/migrations/001_renamed.sql'));
      if (operation === 'duplicate') f.write('services/api/migrations/001_duplicate.sql', 'SELECT 2;\n');
      if (operation === 'unregistered') f.write('services/api/migrations/002_next.sql', 'SELECT 2;\n');
      let base = f.base;
      if (operation === 'out-of-order') {
        f.write('services/api/migrations/003_third.sql', 'SELECT 3;\n');
        base = f.commit();
        f.write('services/api/migrations/002_late.sql', 'SELECT 2;\n');
      }
      f.commit();
      assert.throws(() => checkMigrations(f.root, base), /migration/i);
    } finally { f.cleanup(); }
  });
}

test('CI considers earlier PR commits and fails closed without a base', () => {
  const f = fixture();
  try {
    f.write('services/api/src/db.rs', '// backend change\n');
    f.commit();
    f.write('README.md', 'Documentation added after the backend change.\n');
    f.commit();
    assert.deepEqual(runPlan(f.root, { pull_request: { base: { sha: f.base } } }, 'pull_request'), full);
    assert.throws(() => runPlan(f.root, {}, 'pull_request'), /valid base/);
    assert.throws(() => runPlan(f.root, { before: '0'.repeat(40) }, 'push'), /valid base/);
    assert.deepEqual(runPlan(f.root, {}, 'workflow_dispatch'), full);
  } finally { f.cleanup(); }
});
