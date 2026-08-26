import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const MAX_COMMANDS = 8;
const MAX_COMMAND_LENGTH = 8_000;
const MAX_FILE_LENGTH = 5 * 1024 * 1024;
const MAX_OUTPUT_LENGTH = 100_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const COMMAND_ENVIRONMENT_ALLOWLIST = [
  'APPDATA',
  'COMSPEC',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'LOGNAME',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WINDIR',
] as const;

export interface WorkspaceShellAction {
  commands: string[];
  maxOutputLength?: number;
  timeoutMs?: number;
}

export interface WorkspaceShellOutput {
  outcome:
    | { type: 'exit'; exitCode: number | null }
    | { type: 'timeout' };
  stderr: string;
  stdout: string;
}

interface ActiveShellProcess {
  done: Promise<void>;
  terminate(): void;
}

function withinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value ?? fallback)));
}

function commandEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of COMMAND_ENVIRONMENT_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function shellInvocation(command: string): {
  args: string[];
  executable: string;
  windowsVerbatimArguments?: boolean;
} {
  if (process.platform === 'win32') {
    return {
      args: ['/d', '/s', '/c', `"${command}"`],
      executable: process.env.COMSPEC?.trim() || 'cmd.exe',
      windowsVerbatimArguments: true,
    };
  }
  return {
    args: ['-lc', command],
    executable: process.env.SHELL?.trim() || '/bin/sh',
  };
}

function appendBounded(
  current: string,
  chunk: Buffer | string,
  limit: number,
): string {
  if (current.length >= limit) return current;
  return (current + chunk.toString()).slice(0, limit);
}

function signalProcessTree(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    }
  }
  child.kill(signal);
}

function validateShellAction(action: WorkspaceShellAction): {
  commands: string[];
  maxOutputLength: number;
  timeoutMs: number;
} {
  if (
    action.commands.length < 1 ||
    action.commands.length > MAX_COMMANDS ||
    action.commands.some(
      (command) =>
        !command.trim() || command.length > MAX_COMMAND_LENGTH || command.includes('\0'),
    )
  ) {
    throw new Error('Workspace shell commands must be nonempty and bounded.');
  }
  return {
    commands: action.commands,
    maxOutputLength: boundedInteger(
      action.maxOutputLength,
      MAX_OUTPUT_LENGTH,
      MAX_OUTPUT_LENGTH,
    ),
    timeoutMs: boundedInteger(
      action.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    ),
  };
}

export class WorkspaceShell {
  private readonly children = new Set<ActiveShellProcess>();

  constructor(
    private readonly root: string,
    private readonly signal?: AbortSignal,
  ) {}

  async run(action: WorkspaceShellAction): Promise<{
    maxOutputLength: number;
    output: WorkspaceShellOutput[];
  }> {
    const validated = validateShellAction(action);
    const output: WorkspaceShellOutput[] = [];
    for (const command of validated.commands) {
      if (this.signal?.aborted) throw new Error('Workspace command was cancelled.');
      output.push(
        await this.runCommand(
          command,
          validated.timeoutMs,
          validated.maxOutputLength,
        ),
      );
    }
    return { maxOutputLength: validated.maxOutputLength, output };
  }

  async close(): Promise<void> {
    const active = [...this.children];
    for (const child of active) child.terminate();
    await Promise.all(active.map((child) => child.done));
  }

  private runCommand(
    command: string,
    timeoutMs: number,
    maxOutputLength: number,
  ): Promise<WorkspaceShellOutput> {
    return new Promise<WorkspaceShellOutput>((resolve) => {
      const invocation = shellInvocation(command);
      const child = spawn(invocation.executable, invocation.args, {
        cwd: this.root,
        detached: process.platform !== 'win32',
        env: commandEnvironment(process.env),
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let terminationRequested = false;
      let forceTimer: NodeJS.Timeout | undefined;
      let resolveDone: () => void = () => undefined;
      const done = new Promise<void>((resolveDonePromise) => {
        resolveDone = resolveDonePromise;
      });

      const finish = (result: WorkspaceShellOutput): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        this.signal?.removeEventListener('abort', cancel);
        this.children.delete(active);
        resolveDone();
        resolve(result);
      };
      const terminate = (): void => {
        if (terminationRequested) return;
        terminationRequested = true;
        signalProcessTree(child, 'SIGTERM');
        forceTimer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), 500);
      };
      const cancel = (): void => terminate();
      const active: ActiveShellProcess = { done, terminate };
      this.children.add(active);
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout = appendBounded(stdout, chunk, maxOutputLength);
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr = appendBounded(stderr, chunk, maxOutputLength);
      });
      child.once('error', (error) => {
        finish({
          outcome: { type: 'exit', exitCode: null },
          stderr: appendBounded(stderr, error.message, maxOutputLength),
          stdout,
        });
      });
      child.once('close', (code) => {
        finish({
          outcome: timedOut
            ? { type: 'timeout' }
            : { type: 'exit', exitCode: code },
          stderr,
          stdout,
        });
      });
      this.signal?.addEventListener('abort', cancel, { once: true });
    });
  }
}

export class WorkspaceEditor {
  constructor(private readonly root: string) {}

  async readTextFile(candidate: string): Promise<string> {
    const target = await this.resolveExistingFile(candidate);
    const content = await readFile(target, 'utf8');
    this.validateFileLength(content);
    return content;
  }

  async replaceTextFile(candidate: string, content: string): Promise<void> {
    this.validateFileLength(content);
    const target = await this.resolvePath(candidate);
    await mkdir(path.dirname(target), { recursive: true });
    await this.assertResolvedParent(target);
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(
          'Workspace edits require a regular file inside the selected root.',
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await writeFile(target, content, 'utf8');
  }

  private async resolveExistingFile(candidate: string): Promise<string> {
    const target = await this.resolvePath(candidate);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('Workspace edits require a regular file inside the selected root.');
    }
    const canonical = await realpath(target);
    const canonicalRoot = await realpath(this.root);
    if (!withinRoot(canonicalRoot, canonical)) {
      throw new Error('Workspace file path escapes the selected root.');
    }
    return target;
  }

  private async resolvePath(candidate: string): Promise<string> {
    if (!candidate.trim() || candidate.length > 4_096 || candidate.includes('\0')) {
      throw new Error('Workspace file path is invalid.');
    }
    const target = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.root, candidate);
    if (!withinRoot(this.root, target)) {
      throw new Error('Workspace file path escapes the selected root.');
    }
    await this.assertResolvedParent(target);
    return target;
  }

  private async assertResolvedParent(target: string): Promise<void> {
    const canonicalRoot = await realpath(this.root);
    let current = target;
    for (;;) {
      try {
        const canonical = await realpath(current);
        if (!withinRoot(canonicalRoot, canonical)) {
          throw new Error('Workspace file path escapes the selected root.');
        }
        return;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Workspace file path escapes the selected root.'
        ) {
          throw error;
        }
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        current = parent;
      }
    }
  }

  private validateFileLength(content: string): void {
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_LENGTH) {
      throw new Error('Workspace file exceeds the supported edit size.');
    }
  }
}
