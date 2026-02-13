import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { FlowStep } from '../config/schema.js';
import type { UIDriver, StepResult } from './base.js';

export interface PlaywrightWebOptions {
  url: string;
  headless?: boolean;
  traceDir?: string;
}

export class PlaywrightWebDriver implements UIDriver {
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected page: Page | null = null;
  protected consoleLogs: Array<{ type: string; text: string }> = [];
  protected options: PlaywrightWebOptions;

  constructor(options: PlaywrightWebOptions) {
    this.options = {
      headless: true,
      ...options,
    };
  }

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.options.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.context = await this.browser.newContext({
      ignoreHTTPSErrors: true,
    });

    await this.context.tracing.start({ screenshots: true, snapshots: true });

    this.page = await this.context.newPage();

    this.page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      this.consoleLogs.push({ type, text });
    });

    await this.page.goto(this.options.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  getPage(): Page {
    if (!this.page) throw new Error('Driver not launched');
    return this.page;
  }

  async executeStep(step: FlowStep): Promise<StepResult> {
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
          await page.goto(step.url ?? this.options.url, { waitUntil: 'domcontentloaded', timeout });
          return { success: true };
        }
        case 'wait': {
          await page.waitForTimeout(step.timeout ?? 1000);
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
          return { success: false, error: `Unknown action: ${step.action}` };
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      return { success: false, error: err };
    }
  }

  async captureScreenshot(path: string): Promise<void> {
    const page = this.getPage();
    await page.screenshot({ path, fullPage: true });
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

  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {
        /* ignore */
      }
    }
    if (this.browser) {
      await this.browser.close();
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
