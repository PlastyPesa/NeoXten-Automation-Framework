import { chromium } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { FlowStep } from '../config/schema.js';
import type { UIDriver, StepResult } from './base.js';

export interface TauriCDPOptions {
  /** Path to project root (containing ui/) */
  projectRoot: string;
  /** Command to run (e.g. npm run tauri:dev) */
  devCommand: string;
  /** CWD for dev command (default: projectRoot/ui) */
  devCwd?: string;
  /** Dev server URL (for readiness check) */
  devUrl: string;
  /** CDP port for WebView2 */
  cdpPort: number;
  /** Startup timeout ms */
  startupTimeoutMs?: number;
}

export class TauriCDPDriver implements UIDriver {
  private process: ChildProcess | null = null;
  private page: import('playwright').Page | null = null;
  private browser: import('playwright').Browser | null = null;
  private context: import('playwright').BrowserContext | null = null;
  private consoleLogs: Array<{ type: string; text: string }> = [];
  private backendLog: string[] = [];
  private options: TauriCDPOptions;
  private userDataDir: string | null = null;

  constructor(options: TauriCDPOptions) {
    this.options = {
      startupTimeoutMs: 60000,
      ...options,
    };
  }

  async launch(): Promise<void> {
    const port = this.options.cdpPort;
    this.userDataDir = mkdtempSync(join(tmpdir(), 'neoxten-'));
    const cwd = this.options.devCwd ?? join(this.options.projectRoot, 'ui');

    const env = {
      ...process.env,
      NEOXTEN_AUTOMATION: '1',
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: this.userDataDir,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new Error(`Tauri app did not expose CDP on port ${port} within ${this.options.startupTimeoutMs}ms. Check that WebView2 is configured for remote debugging.`));
      }, this.options.startupTimeoutMs);

      this.process = spawn('npm', ['run', 'tauri:dev'], {
        cwd,
        env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

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
          reject(new Error(`CDP attach failed after 120 attempts. Last stderr: ${stderr.slice(-500)}`));
          return;
        }
        try {
          const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
            timeout: 2000,
          });
          clearTimeout(timeout);
          this.browser = browser;
          const contexts = browser.contexts();
          this.context = contexts[0];
          if (!this.context) {
            await browser.close();
            reject(new Error('No browser context found after CDP connect'));
            return;
          }
          const pages = this.context.pages();
          this.page = pages[0];
          if (!this.page) {
            const np = await this.context.waitForEvent('page', { timeout: 5000 });
            this.page = np;
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

          await this.page.goto(this.options.devUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          resolve();
        } catch {
          setTimeout(() => tryConnect(attempt + 1), 500);
        }
      };

      setTimeout(() => tryConnect(0), 2000);
    });
  }

  getPage(): import('playwright').Page {
    if (!this.page) throw new Error('Tauri CDP driver not launched');
    return this.page;
  }

  async executeStep(step: import('../config/schema.js').FlowStep): Promise<StepResult> {
    const page = this.getPage();
    const timeout = step.timeout ?? 10000;

    try {
      switch (step.action) {
        case 'click': {
          if (!step.selector) return { success: false, error: 'Missing selector for click' };
          await page.locator(step.selector).first().click({ timeout });
          return { success: true };
        }
        case 'type': {
          if (!step.selector) return { success: false, error: 'Missing selector for type' };
          await page.locator(step.selector).first().fill(step.text ?? '', { timeout });
          return { success: true };
        }
        case 'navigate': {
          await page.goto(step.url ?? this.options.devUrl, { waitUntil: 'domcontentloaded', timeout });
          return { success: true };
        }
        case 'wait': {
          await new Promise((r) => setTimeout(r, step.timeout ?? 1000));
          return { success: true };
        }
        case 'assert': {
          if (!step.selector) return { success: false, error: 'Missing selector for assert' };
          const loc = page.locator(step.selector).first();
          if (step.type === 'visible') {
            await loc.waitFor({ state: 'visible', timeout });
            return { success: true };
          }
          if (step.type === 'contains') {
            await loc.waitFor({ state: 'visible', timeout });
            const text = await loc.textContent();
            if (!text?.includes(step.text ?? '')) {
              return { success: false, error: `Expected to contain "${step.text}", got: ${text?.slice(0, 100)}` };
            }
            return { success: true };
          }
          if (step.type === 'timeout') {
            await loc.waitFor({ state: 'hidden', timeout });
            return { success: true };
          }
          return { success: false, error: `Unknown assert type: ${step.type}` };
        }
        default:
          return { success: false, error: `Unknown action: ${(step as FlowStep).action}` };
      }
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async captureScreenshot(path: string): Promise<void> {
    await this.getPage().screenshot({ path, fullPage: true });
  }

  async captureTrace(path: string): Promise<void> {
    if (this.context) {
      await this.context.tracing.stop({ path });
    }
  }

  getConsoleLogs(): Array<{ type: string; text: string }> {
    return [...this.consoleLogs];
  }

  getConsoleErrors(): string[] {
    return this.consoleLogs.filter((l) => l.type === 'error' || l.type === 'warning').map((l) => l.text);
  }

  getBackendLog(): string {
    return this.backendLog.join('');
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

  async close(): Promise<void> {
    if (this.browser) await this.browser.close().catch(() => {});
    this.cleanup();
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
