/**
 * TauriCDPDriver — connects to a Tauri app via Chrome DevTools Protocol.
 *
 * Extends PlaywrightWebDriver: executeStep, captureScreenshot, etc. are inherited.
 * Hardened: killProcessTree for cleanup, structured error messages.
 */
import { chromium } from 'playwright';
import type { ChildProcess } from 'child_process';
import { safeSpawn, killProcessTree } from '../utils/spawn.js';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PlaywrightWebDriver } from './playwright-web.js';

export interface TauriCDPOptions {
  projectRoot: string;
  devCommand: string;
  devCwd?: string;
  devUrl: string;
  cdpPort: number;
  startupTimeoutMs?: number;
}

export class TauriCDPDriver extends PlaywrightWebDriver {
  private process: ChildProcess | null = null;
  private backendLog: string[] = [];
  private cdpOptions: TauriCDPOptions;
  private userDataDir: string | null = null;

  constructor(options: TauriCDPOptions) {
    super({
      url: options.devUrl,
      headless: true,
    });
    this.cdpOptions = {
      startupTimeoutMs: 60000,
      ...options,
    };
  }

  override async launch(): Promise<void> {
    const port = this.cdpOptions.cdpPort;
    const cwd = this.cdpOptions.devCwd ?? join(this.cdpOptions.projectRoot, 'ui');
    this.userDataDir = mkdtempSync(join(tmpdir(), 'neoxten-'));

    const env = {
      ...process.env,
      NEOXTEN_AUTOMATION: '1',
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: this.userDataDir,
    };

    return new Promise((resolve, reject) => {
      const timeoutMs = this.cdpOptions.startupTimeoutMs!;
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new Error(
          `Tauri app did not expose CDP on port ${port} within ${timeoutMs}ms.\n` +
          `  command: ${this.cdpOptions.devCommand}\n` +
          `  cwd:     ${cwd}\n` +
          `Check that WebView2 is configured for remote debugging.`,
        ));
      }, timeoutMs);

      const [cmd, ...args] = this.cdpOptions.devCommand.split(/\s+/);
      this.process = safeSpawn(
        cmd,
        args,
        { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
        (err) => {
          clearTimeout(timeout);
          this.cleanup();
          reject(new Error(
            `Failed to spawn Tauri dev: ${err.message}\n` +
            `  command: ${this.cdpOptions.devCommand}\n` +
            `  cwd:     ${cwd}`,
          ));
        },
      );

      if (!this.process) return;

      let stderr = '';
      this.process.stderr?.on('data', (d) => {
        const txt = d.toString();
        stderr += txt;
        this.backendLog.push(txt);
      });
      this.process.stdout?.on('data', (d) => {
        this.backendLog.push(d.toString());
      });

      const tryConnect = async (attempt: number) => {
        if (attempt > 120) {
          clearTimeout(timeout);
          this.cleanup();
          reject(new Error(
            `CDP attach failed after 120 attempts on port ${port}.\n` +
            `  last stderr: ${stderr.slice(-500)}`,
          ));
          return;
        }
        try {
          const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
            timeout: 2000,
          });
          clearTimeout(timeout);

          this.browser = browser;
          const contexts = browser.contexts();
          this.context = contexts[0] ?? null;
          if (!this.context) {
            await browser.close();
            reject(new Error('No browser context found after CDP connect'));
            return;
          }

          const pages = this.context.pages();
          this.page = pages[0] ?? null;
          if (!this.page) {
            this.page = await this.context.waitForEvent('page', { timeout: 5000 });
          }
          if (!this.page) {
            await browser.close();
            reject(new Error('No page found in WebView2 context'));
            return;
          }

          this.page.on('console', (msg) => {
            this.consoleLogs.push({ type: msg.type(), text: msg.text() });
          });

          await this.context.tracing.start({ screenshots: true, snapshots: true }).catch(() => {});
          await this.page.goto(this.cdpOptions.devUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
          }).catch(() => {});

          resolve();
        } catch {
          setTimeout(() => tryConnect(attempt + 1), 500);
        }
      };

      setTimeout(() => tryConnect(0), 2000);
    });
  }

  getBackendLog(): string {
    return this.backendLog.join('');
  }

  private cleanup(): void {
    if (this.process && this.process.pid && !this.process.killed) {
      killProcessTree(this.process.pid);
    }
    this.process = null;
  }

  override async close(): Promise<void> {
    await super.close();
    this.cleanup();
  }
}
