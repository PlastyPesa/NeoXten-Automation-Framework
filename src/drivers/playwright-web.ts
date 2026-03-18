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
          if (step.type === 'hidden' || step.type === 'timeout') {
            await loc.waitFor({ state: 'hidden', timeout });
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
          if (step.type === 'not-contains') {
            await loc.waitFor({ state: 'visible', timeout });
            const text = await loc.textContent();
            if (text?.includes(step.text ?? '')) {
              return { success: false, error: `Expected NOT to contain "${step.text}" but it was present` };
            }
            return { success: true };
          }
          if (step.type === 'css') {
            const prop = (step as { property?: string }).property;
            const expected = (step as { value?: string }).value;
            if (!prop) return { success: false, error: 'css assert requires property' };
            await loc.waitFor({ state: 'attached', timeout });
            const actual = await loc.evaluate((el, p) => window.getComputedStyle(el).getPropertyValue(p), prop);
            if (expected && actual.trim() !== expected.trim()) {
              return { success: false, error: `CSS "${prop}": expected "${expected}", got "${actual}"` };
            }
            return { success: true };
          }
          if (step.type === 'attribute') {
            const attr = (step as { attribute?: string }).attribute;
            const expected = (step as { value?: string }).value;
            if (!attr) return { success: false, error: 'attribute assert requires attribute name' };
            await loc.waitFor({ state: 'attached', timeout });
            const actual = await loc.getAttribute(attr);
            if (expected !== undefined) {
              if (actual !== expected) {
                return { success: false, error: `Attribute "${attr}": expected "${expected}", got "${actual}"` };
              }
            } else if (actual === null) {
              return { success: false, error: `Attribute "${attr}" not present on element` };
            }
            return { success: true };
          }
          if (step.type === 'count') {
            const expected = (step as { count?: number }).count ?? 0;
            const actual = await page.locator(step.selector).count();
            if (actual < expected) {
              return { success: false, error: `Element count: expected >= ${expected}, got ${actual}` };
            }
            return { success: true };
          }
          return { success: false, error: `Unknown assert type: ${step.type}` };
        }
        case 'setInputFiles': {
          if (!step.selector) return { success: false, error: 'Missing selector for setInputFiles' };
          const files = step.files ?? [];
          if (files.length === 0) return { success: false, error: 'Missing files for setInputFiles' };
          await page.locator(step.selector).first().setInputFiles(files, { timeout });
          return { success: true };
        }
        case 'evaluate': {
          const expression = (step as { expression?: string }).expression;
          if (!expression) return { success: false, error: 'evaluate step requires expression' };
          await page.evaluate(expression);
          return { success: true };
        }
        case 'getTestState': {
          const state = await page.evaluate(() => {
            const fn = (window as unknown as Record<string, unknown>).__NEOXTEMUS_TEST_STATE__;
            if (typeof fn === 'function') return fn();
            return null;
          });
          return { success: true, testState: (state as Record<string, unknown>) ?? undefined };
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
