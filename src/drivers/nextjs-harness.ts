/**
 * NextJsHarnessDriver — Next.js dev server harness.
 *
 * Hardened: server reuse, killProcessTree, structured error messages.
 */
import type { ChildProcess } from 'child_process';
import { safeSpawn, killProcessTree, isUrlReachable } from '../utils/spawn.js';
import { PlaywrightWebDriver } from './playwright-web.js';

export interface NextJsHarnessOptions {
  projectRoot: string;
  devCommand: string;
  devCwd: string;
  devUrl: string;
  startupTimeoutMs?: number;
}

export class NextJsHarnessDriver extends PlaywrightWebDriver {
  private process: ChildProcess | null = null;
  private harnessOptions: NextJsHarnessOptions;
  private reusingServer = false;

  constructor(options: NextJsHarnessOptions) {
    super({
      url: options.devUrl,
      headless: true,
    });
    this.harnessOptions = {
      startupTimeoutMs: 60000,
      ...options,
    };
  }

  override async launch(): Promise<void> {
    const cwd = this.harnessOptions.devCwd;
    const devUrl = this.harnessOptions.devUrl;

    /* Reuse existing server if already running */
    const alreadyRunning = await isUrlReachable(devUrl);
    if (alreadyRunning) {
      this.reusingServer = true;
      await super.launch();
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = this.harnessOptions.startupTimeoutMs!;
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new Error(
          `Next.js dev server did not start within ${timeoutMs}ms.\n` +
          `  command: ${this.harnessOptions.devCommand}\n` +
          `  cwd:     ${cwd}\n` +
          `  url:     ${devUrl}`,
        ));
      }, timeoutMs);

      const [cmd, ...args] = this.harnessOptions.devCommand.split(/\s+/);
      this.process = safeSpawn(
        cmd,
        args,
        {
          cwd,
          env: { ...process.env, NEOXTEN_AUTOMATION: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
        (err) => {
          clearTimeout(timeout);
          this.cleanup();
          reject(new Error(
            `Failed to spawn Next.js dev: ${err.message}\n` +
            `  command: ${this.harnessOptions.devCommand}\n` +
            `  cwd:     ${cwd}`,
          ));
        },
      );

      if (!this.process) return;

      const checkReady = async (attempt: number) => {
        if (attempt > 120) {
          clearTimeout(timeout);
          this.cleanup();
          reject(new Error(
            `Next.js dev server spawned but never became ready (120 attempts).\n` +
            `  url: ${devUrl}`,
          ));
          return;
        }
        try {
          const res = await fetch(devUrl, { method: 'HEAD' }).catch(() => null);
          if (res?.ok) {
            clearTimeout(timeout);
            await super.launch();
            resolve();
            return;
          }
        } catch {
          /* retry */
        }
        setTimeout(() => checkReady(attempt + 1), 500);
      };

      setTimeout(() => checkReady(0), 2000);
    });
  }

  private cleanup(): void {
    if (this.process && this.process.pid && !this.process.killed) {
      killProcessTree(this.process.pid);
    }
    this.process = null;
  }

  override async close(): Promise<void> {
    await super.close();
    if (!this.reusingServer) {
      this.cleanup();
    }
  }
}
