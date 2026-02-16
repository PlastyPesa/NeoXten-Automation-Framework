/**
 * ExtensionDriver — Launches Chromium with an unpacked Chrome extension loaded.
 *
 * Uses Playwright's persistent context with --load-extension and
 * --disable-extensions-except to inject the extension into a real
 * Chromium profile. After launch, pre-seeds chrome.storage.local
 * via the extension's background service worker so tests can control
 * kidMode / ageBand state.
 */
import { resolve } from 'path';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { FlowStep } from '../config/schema.js';
import type { UIDriver, StepResult } from './base.js';

export interface ExtensionDriverOptions {
  extensionPath: string;
  headless?: boolean;
  traceDir?: string;
  /** Pre-seed chrome.storage.local values before flows run. */
  storageSeed?: Record<string, unknown>;
}

export class ExtensionDriver implements UIDriver {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private consoleLogs: Array<{ type: string; text: string }> = [];
  private options: ExtensionDriverOptions;

  constructor(options: ExtensionDriverOptions) {
    this.options = options;
  }

  async launch(): Promise<void> {
    const extPath = resolve(this.options.extensionPath);

    // Playwright persistent context with extension loaded.
    // headless: false is required for extensions (Chromium limitation).
    this.context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Use a small viewport to keep it lightweight
        '--window-size=1280,800',
      ],
      ignoreHTTPSErrors: true,
    });

    await this.context.tracing.start({ screenshots: true, snapshots: true });

    // Wait for the extension service worker to initialize
    let sw = this.context.serviceWorkers()[0];
    if (!sw) {
      sw = await this.context.waitForEvent('serviceworker', { timeout: 10000 });
    }

    // Pre-seed storage via the service worker if storageSeed is provided
    if (this.options.storageSeed && sw) {
      await sw.evaluate((seed: Record<string, unknown>) => {
        // @ts-expect-error chrome is available in service worker context
        return chrome.storage.local.set(seed);
      }, this.options.storageSeed);
      // Small delay for storage write propagation
      await new Promise((r) => setTimeout(r, 300));
    }

    // Open a new page for testing
    this.page = await this.context.newPage();
    this.page.on('console', (msg) => {
      this.consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
  }

  getPage(): Page {
    if (!this.page) throw new Error('Extension driver not launched');
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
          await page.goto(step.url ?? 'about:blank', { waitUntil: 'commit', timeout });
          return { success: true };
        }
        case 'wait': {
          await page.waitForTimeout(step.timeout ?? 1000);
          return { success: true };
        }
        case 'assert': {
          if (step.type === 'visible') {
            if (!step.selector) return { success: false, error: 'Missing selector' };
            await page.locator(step.selector).first().waitFor({ state: 'visible', timeout });
            return { success: true };
          }
          if (step.type === 'contains') {
            if (!step.selector) return { success: false, error: 'Missing selector' };
            const loc = page.locator(step.selector).first();
            await loc.waitFor({ state: 'visible', timeout });
            const text = await loc.textContent();
            if (!text?.includes(step.text ?? '')) {
              return { success: false, error: `Expected "${step.text}", got: ${text?.slice(0, 100)}` };
            }
            return { success: true };
          }
          if (step.type === 'timeout') {
            if (!step.selector) return { success: false, error: 'Missing selector' };
            await page.locator(step.selector).first().waitFor({ state: 'hidden', timeout });
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
    if (this.page) await this.page.screenshot({ path, fullPage: true });
  }

  async captureTrace(path: string): Promise<void> {
    if (this.context) await this.context.tracing.stop({ path });
  }

  getConsoleLogs(): Array<{ type: string; text: string }> {
    return [...this.consoleLogs];
  }

  getConsoleErrors(): string[] {
    return this.consoleLogs
      .filter((l) => l.type === 'error' || l.type === 'warning')
      .map((l) => l.text);
  }

  async close(): Promise<void> {
    if (this.context) {
      try { await this.context.close(); } catch { /* ignore */ }
    }
    this.context = null;
    this.page = null;
  }
}
