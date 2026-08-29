import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ProcessEntry {
  command: string;
  parentPid: number;
  pid: number;
}

export function parseProcessTable(output: string): ProcessEntry[] {
  return output
    .split('\n')
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      command: match[3] ?? '',
      parentPid: Number(match[2] ?? 0),
      pid: Number(match[1] ?? 0),
    }));
}

export function findTroDevelopmentRoots(
  processes: readonly ProcessEntry[],
  repositoryRoot: string,
): number[] {
  const forgeEntry = path.join(
    repositoryRoot,
    'node_modules',
    '@electron-forge',
    'cli',
    'dist',
    'electron-forge-start.js',
  );
  const electronEntries = new Set([
    `${path.join(
      repositoryRoot,
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron',
    )} .`,
    `${path.join(
      repositoryRoot,
      'node_modules',
      'electron',
      'dist',
      'electron',
    )} .`,
  ]);

  return processes
    .filter(
      ({ command }) =>
        command.includes(forgeEntry) || electronEntries.has(command),
    )
    .map(({ pid }) => pid);
}

export function collectProcessTreePostOrder(
  processes: readonly ProcessEntry[],
  rootPids: readonly number[],
): number[] {
  const children = new Map<number, number[]>();
  for (const processEntry of processes) {
    const siblings = children.get(processEntry.parentPid) ?? [];
    siblings.push(processEntry.pid);
    children.set(processEntry.parentPid, siblings);
  }

  const visited = new Set<number>();
  const ordered: number[] = [];
  const visit = (pid: number): void => {
    if (visited.has(pid)) return;
    visited.add(pid);
    for (const childPid of children.get(pid) ?? []) visit(childPid);
    ordered.push(pid);
  };
  for (const rootPid of rootPids) visit(rootPid);
  return ordered;
}

function readProcessTable(): ProcessEntry[] {
  return parseProcessTable(
    execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
    }),
  );
}

function signal(pid: number, signalName: NodeJS.Signals): void {
  try {
    process.kill(pid, signalName);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function waitForExit(pids: readonly number[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let remaining = [...pids];
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    remaining = remaining.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
      }
    });
  }
  return remaining;
}

export async function stopExistingDevelopmentRun({
  dryRun = false,
  repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
  ),
}: {
  dryRun?: boolean;
  repositoryRoot?: string;
} = {}): Promise<number[]> {
  if (process.platform === 'win32') {
    console.warn(
      '[dev] Existing Tro process cleanup is currently available on macOS and Linux.',
    );
    return [];
  }

  const snapshot = readProcessTable();
  const roots = findTroDevelopmentRoots(snapshot, repositoryRoot).filter(
    (pid) => pid !== process.pid,
  );
  const targets = collectProcessTreePostOrder(snapshot, roots).filter(
    (pid) => pid !== process.pid,
  );
  if (targets.length === 0) {
    console.info('[dev] No existing Tro development process found.');
    return [];
  }

  if (dryRun) {
    console.info(
      `[dev] Would stop ${targets.length} existing Tro development process${targets.length === 1 ? '' : 'es'}.`,
    );
    return targets;
  }

  for (const pid of targets) signal(pid, 'SIGTERM');
  const remaining = await waitForExit(targets, 2_000);
  if (remaining.length > 0) {
    const originalCommands = new Map(
      snapshot.map(({ command, pid }) => [pid, command]),
    );
    const currentCommands = new Map(
      readProcessTable().map(({ command, pid }) => [pid, command]),
    );
    for (const pid of remaining) {
      if (currentCommands.get(pid) === originalCommands.get(pid)) {
        signal(pid, 'SIGKILL');
      }
    }
  }

  console.info(
    `[dev] Stopped ${targets.length} existing Tro development process${targets.length === 1 ? '' : 'es'}.`,
  );
  return targets;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await stopExistingDevelopmentRun({
    dryRun: process.argv.includes('--dry-run'),
  });
}
