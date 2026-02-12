import { spawn, type ChildProcess } from 'child_process';
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
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new Error(`Dev server did not start within ${this.harnessOptions.startupTimeoutMs}ms`));
      }, this.harnessOptions.startupTimeoutMs);

      const [cmd, ...args] = this.harnessOptions.devCommand.split(/\s+/);
      this.process = spawn(cmd, args, {
        cwd: this.harnessOptions.devCwd,
        env: { ...process.env, NEOXTEN_AUTOMATION: '1' },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const checkReady = async (attempt: number) => {
        if (attempt > 120) {
          clearTimeout(timeout);
          this.cleanup();
          reject(new Error('Dev server failed to become ready'));
          return;
        }
        try {
          const res = await fetch(this.harnessOptions.devUrl, { method: 'HEAD' }).catch(() => null);
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
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        this.process.kill('SIGKILL');
      }
      this.process = null;
    }
  }

  override async close(): Promise<void> {
    await super.close();
    this.cleanup();
  }
}
