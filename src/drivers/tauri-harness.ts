/**
 * TauriHarnessDriver — frontend-only dev server (e.g. Vite).
 *
 * Hardened behaviors:
 * - Checks if devUrl is already responding before spawning (reuses existing server)
 * - Uses killProcessTree for Windows-compatible cleanup
 * - Includes command, cwd, url in timeout error messages
 */
import { join } from 'path';
import type { ChildProcess } from 'child_process';
import { safeSpawn, killProcessTree, isUrlReachable } from '../utils/spawn.js';
import { PlaywrightWebDriver } from './playwright-web.js';

export interface TauriHarnessOptions {
  projectRoot: string;
  devCommand: string;
  devCwd?: string;
  devUrl: string;
  startupTimeoutMs?: number;
}

export class TauriHarnessDriver extends PlaywrightWebDriver {
  private process: ChildProcess | null = null;
  private harnessOptions: TauriHarnessOptions;
  /** True if we connected to an existing dev server instead of spawning one. */
  private reusingServer = false;

  constructor(options: TauriHarnessOptions) {
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
    const cwd = this.harnessOptions.devCwd ?? join(this.harnessOptions.projectRoot, 'ui');
    const devUrl = this.harnessOptions.devUrl;

    /* ---- Check if dev server is already running ---- */
    const alreadyRunning = await isUrlReachable(devUrl);
    if (alreadyRunning) {
      this.reusingServer = true;
      await super.launch();
      return;
    }

    /* ---- Spawn dev server ---- */
    return new Promise((resolve, reject) => {
      const timeoutMs = this.harnessOptions.startupTimeoutMs!;
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new Error(
          `Dev server did not start within ${timeoutMs}ms.\n` +
          `  command: ${this.harnessOptions.devCommand}\n` +
          `  cwd:     ${cwd}\n` +
          `  url:     ${devUrl}\n` +
          `Check that the dev server starts correctly when run manually.`,
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
            `Failed to spawn dev server: ${err.message}\n` +
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
            `Dev server spawned but never became ready (120 attempts).\n` +
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
    /* Only kill the dev server if we spawned it */
    if (!this.reusingServer) {
      this.cleanup();
    }
  }
}
