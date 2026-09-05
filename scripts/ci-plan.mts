import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CheckPlan {
  source: boolean;
  rust: boolean;
  desktop: boolean;
}

// Only known low-risk paths get a reduced check set. Unknown paths run everything.
export function planChecks(paths: string[], full = false): CheckPlan {
  const plan = { source: full, rust: full, desktop: full };
  for (const path of paths) {
    if (/^(?:docs\/|\.claude\/|\.tours\/).*\.md$/.test(path)
      || /^(?:AGENTS|README|LICENSE|CHANGELOG)(?:\.md)?$/.test(path)) continue;
    if (/^src\/renderer\/.*\.(?:tsx?|css)$/.test(path)
      || path === 'src/index.css'
      || /^(?:src|apps\/admin\/src)\/.*\.test\.tsx?$/.test(path)) {
      plan.source = true;
      continue;
    }
    return { source: true, rust: true, desktop: true };
  }
  return plan;
}

const migrationDirectory = 'services/api/migrations/';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function migrationFiles(root: string, ref: string): string[] {
  return git(root, 'ls-tree', '-r', '--name-only', '-z', ref, '--', migrationDirectory)
    .split('\0').filter((path) => path.endsWith('.sql'));
}

function migrationVersion(path: string): number {
  const match = /^services\/api\/migrations\/(\d+)_[^/]+\.sql$/.exec(path);
  if (!match) throw new Error(`Invalid migration filename: ${path}`);
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error(`Invalid migration version: ${path}`);
  return version;
}

export function checkMigrations(root: string, base: string, head = 'HEAD'): void {
  const previous = migrationFiles(root, base);
  const current = migrationFiles(root, head);
  const maximum = Math.max(0, ...previous.map(migrationVersion));
  const previousSet = new Set(previous);
  const currentSet = new Set(current);
  const versions = new Set<number>();
  for (const path of previous) {
    if (!currentSet.has(path)
      || git(root, 'rev-parse', `${base}:${path}`).trim() !== git(root, 'rev-parse', `${head}:${path}`).trim()) {
      throw new Error(`Published migration was changed, renamed, or deleted: ${path}. Add a new migration instead.`);
    }
  }
  const registry = git(root, 'show', `${head}:services/api/src/db.rs`);
  for (const path of current) {
    const version = migrationVersion(path);
    if (versions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    versions.add(version);
    if (!previousSet.has(path)) {
      if (version <= maximum) throw new Error(`New migration must follow version ${maximum}: ${path}`);
      const filename = path.slice(migrationDirectory.length);
      if (!registry.includes(`"../migrations/${filename}"`)) {
        throw new Error(`New migration is missing from services/api/src/db.rs: ${path}`);
      }
    }
  }
}

interface GitHubEvent {
  before?: string;
  pull_request?: { base: { sha: string } };
  merge_group?: { base_sha: string };
}

export function runPlan(root: string, event: GitHubEvent, eventName: string): CheckPlan {
  const base = event.pull_request?.base.sha ?? event.merge_group?.base_sha
    ?? (eventName === 'workflow_dispatch' ? git(root, 'rev-parse', 'HEAD').trim() : event.before);
  if (!base || !/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base)) {
    throw new Error('A valid base commit is required to verify migration history. Fetch the base before retrying.');
  }
  // Diff both sides of renames, and compare the entire PR, not just its last commit.
  const paths = git(root, 'diff', '--name-only', '--no-renames', '-z', base, 'HEAD').split('\0').filter(Boolean);
  checkMigrations(root, base);
  return planChecks(paths, eventName !== 'pull_request');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required.');
  const plan = runPlan(process.cwd(), JSON.parse(readFileSync(eventPath, 'utf8')) as GitHubEvent,
    process.env.GITHUB_EVENT_NAME ?? '');
  const output = Object.entries(plan).map(([key, value]) => `${key}=${value}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Selected checks\n\n| Check | Required |\n|---|---|\n${Object.entries(plan).map(([key, value]) => `| ${key} | ${value} |`).join('\n')}\n\nMigration history is unchanged; new migrations have unique, increasing versions and registry entries.\n`);
  }
  console.log(output);
}
