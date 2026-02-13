/**
 * Safe process spawning with Windows-compatible tree killing and cleanup.
 */
import { spawn, execSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';

/* ------------------------------------------------------------------ */
/*  Shell detection                                                    */
/* ------------------------------------------------------------------ */

function getWindowsShell(): string {
  const raw = process.env.ComSpec || 'cmd.exe';
  return raw.replace(/[;]+$/, '').trim() || 'cmd.exe';
}

/* ------------------------------------------------------------------ */
/*  Process tree kill                                                  */
/* ------------------------------------------------------------------ */

/**
 * Kill a process and all its children.
 * On Windows, `process.kill(pid)` only kills the shell — child processes survive.
 * `taskkill /T /F` kills the entire tree.
 */
export function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
    } else {
      // Negative PID kills the process group on Unix
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    // Fallback: direct kill
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* process already dead — that's fine */
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Managed child process registry                                     */
/* ------------------------------------------------------------------ */

const activeChildren = new Set<ChildProcess>();

/** Register a child process for cleanup on exit. */
function trackChild(child: ChildProcess): void {
  activeChildren.add(child);
  child.on('exit', () => activeChildren.delete(child));
  child.on('error', () => activeChildren.delete(child));
}

/** Kill all tracked child processes. Called on framework exit. */
export function killAllChildren(): void {
  for (const child of activeChildren) {
    if (child.pid && !child.killed) {
      killProcessTree(child.pid);
    }
  }
  activeChildren.clear();
}

/* Register global cleanup — runs once per process */
let cleanupRegistered = false;
function ensureCleanupRegistered(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    killAllChildren();
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (err) => {
    cleanup();
    console.error('Uncaught exception:', err);
    process.exit(1);
  });
}

/* ------------------------------------------------------------------ */
/*  Port availability check                                            */
/* ------------------------------------------------------------------ */

/**
 * Check if a URL is already responding. Used to detect if a dev server
 * is already running (from a previous launch cycle or manual start).
 */
export async function isUrlReachable(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timer);
    return res !== null && res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Safe spawn                                                         */
/* ------------------------------------------------------------------ */

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: ['ignore', 'pipe', 'pipe'];
}

/**
 * Safe spawn for npm scripts.
 * - Uses ComSpec on Windows to avoid hardcoded cmd.exe path
 * - Validates cwd existence before spawn
 * - Tracks the child for cleanup on process exit
 * - Routes ChildProcess 'error' through onError callback
 */
export function safeSpawn(
  command: string,
  args: string[],
  options: SpawnOptions,
  onError: (err: Error) => void,
): ChildProcess {
  ensureCleanupRegistered();

  const { cwd, env, stdio } = options;

  if (cwd && !existsSync(cwd)) {
    const err = new Error(`ENOENT: cwd does not exist: ${cwd}`);
    (err as NodeJS.ErrnoException).code = 'ENOENT';
    onError(err);
    return null as unknown as ChildProcess;
  }

  const shell = process.platform === 'win32' ? getWindowsShell() : true;

  const child = spawn(command, args, {
    cwd,
    env: env ?? process.env,
    shell,
    stdio: stdio ?? ['ignore', 'pipe', 'pipe'],
  });

  trackChild(child);

  child.on('error', (err) => {
    onError(err);
  });

  return child;
}
