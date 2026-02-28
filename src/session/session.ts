/**
 * Session — the live execution environment.
 *
 * Hardened:
 * - connect() retries with exponential backoff
 * - Page readiness wait after navigation
 * - Structured error messages with context
 * - Safe close (idempotent, never throws)
 */
import { resolve } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { chromium } from 'playwright';
import type { Page, Browser, BrowserContext } from 'playwright';
import { PageObserver, type PageSnapshot } from '../observer/index.js';
import { EvidenceCollector } from '../evidence/collector.js';
import { executeAction } from '../actions/execute.js';
import type { Action, ActionResult } from '../actions/types.js';
import type { UIDriver } from '../drivers/base.js';
import type { NeoxtenConfig } from '../config/schema.js';
import { TauriAdapter } from '../adapters/tauri.js';
import { NextJsAdapter } from '../adapters/nextjs.js';
import { WebAdapter } from '../adapters/web.js';
import { ExtensionAdapter } from '../adapters/extension.js';
import { AndroidAdapter } from '../adapters/android.js';
import { generateRunId } from '../utils/run-id.js';

/* ------------------------------------------------------------------ */
/*  Session                                                            */
/* ------------------------------------------------------------------ */

export class Session {
  readonly id: string;
  readonly evidence: EvidenceCollector;
  readonly observer: PageObserver;

  private page: Page;
  private driver: UIDriver | null;
  private ownBrowser: Browser | null = null;
  private ownContext: BrowserContext | null = null;
  private closed = false;

  private screenshotDir: string;
  private screenshotCounter = 0;

  private constructor(
    page: Page,
    driver: UIDriver | null,
    screenshotDir: string,
  ) {
    this.id = generateRunId();
    this.page = page;
    this.driver = driver;
    this.screenshotDir = screenshotDir;

    /* Ensure screenshot dir exists */
    if (!existsSync(screenshotDir)) {
      mkdirSync(screenshotDir, { recursive: true });
    }

    this.observer = new PageObserver(page);
    this.observer.attach();
    this.evidence = new EvidenceCollector();
  }

  /* ---------------------------------------------------------------- */
  /*  Factory: launch from config                                      */
  /* ---------------------------------------------------------------- */

  static async launch(
    config: NeoxtenConfig,
    configPath: string,
    options?: { screenshotDir?: string },
  ): Promise<Session> {
    const adapter = Session.getAdapter(config);
    const driver = adapter.createDriver(config, configPath);

    const launchStart = Date.now();
    await driver.launch();
    const launchMs = Date.now() - launchStart;

    const page = driver.getPage();
    const screenshotDir = options?.screenshotDir ?? resolve(process.cwd(), '.neoxten-out', 'session');
    const session = new Session(page, driver, screenshotDir);

    session.evidence.stageStart('launch');
    session.evidence.stageEnd('launch', launchMs);
    session.evidence.addNote(`Launched ${config.project.type} in ${launchMs}ms`);

    return session;
  }

  /* ---------------------------------------------------------------- */
  /*  Factory: connect to running app (with retries)                   */
  /* ---------------------------------------------------------------- */

  static async connect(
    url: string,
    options?: {
      screenshotDir?: string;
      headless?: boolean;
      retries?: number;
      retryDelayMs?: number;
      pageReadinessMs?: number;
    },
  ): Promise<Session> {
    const retries = options?.retries ?? 3;
    const baseDelay = options?.retryDelayMs ?? 2000;
    const readinessWait = options?.pageReadinessMs ?? 1500;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const browser = await chromium.launch({
          headless: options?.headless ?? true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        let context: BrowserContext | null = null;
        let page: Page | null = null;

        try {
          context = await browser.newContext({ ignoreHTTPSErrors: true });
          await context.tracing.start({ screenshots: true, snapshots: true });
          page = await context.newPage();

          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

          /* Wait for client-side rendering to settle */
          await page.waitForTimeout(readinessWait);

          const screenshotDir = options?.screenshotDir ?? resolve(process.cwd(), '.neoxten-out', 'session');
          const session = new Session(page, null, screenshotDir);
          session.ownBrowser = browser;
          session.ownContext = context;

          session.evidence.addNote(`Connected to ${url}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);

          return session;
        } catch (e) {
          /* Clean up partial resources before retry */
          if (context) await context.close().catch(() => {});
          await browser.close().catch(() => {});
          throw e;
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < retries) {
          const delay = baseDelay * Math.pow(1.5, attempt);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw new Error(
      `Failed to connect to ${url} after ${retries + 1} attempts.\n` +
      `  last error: ${lastError?.message}`,
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Factory: connect via CDP (with retries)                          */
  /* ---------------------------------------------------------------- */

  static async connectCDP(
    cdpUrl: string,
    options?: {
      screenshotDir?: string;
      retries?: number;
      retryDelayMs?: number;
    },
  ): Promise<Session> {
    const retries = options?.retries ?? 3;
    const baseDelay = options?.retryDelayMs ?? 2000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10000 });
        const contexts = browser.contexts();
        const context = contexts[0];
        if (!context) {
          await browser.close().catch(() => {});
          throw new Error('No browser context found after CDP connect');
        }

        const pages = context.pages();
        let page = pages[0];
        if (!page) {
          page = await context.waitForEvent('page', { timeout: 5000 });
        }
        if (!page) {
          await browser.close().catch(() => {});
          throw new Error('No page found via CDP');
        }

        const screenshotDir = options?.screenshotDir ?? resolve(process.cwd(), '.neoxten-out', 'session');
        const session = new Session(page, null, screenshotDir);
        session.ownBrowser = browser;

        session.evidence.addNote(`Connected via CDP to ${cdpUrl}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);

        return session;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < retries) {
          const delay = baseDelay * Math.pow(1.5, attempt);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw new Error(
      `Failed to connect via CDP to ${cdpUrl} after ${retries + 1} attempts.\n` +
      `  last error: ${lastError?.message}`,
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Observe                                                          */
  /* ---------------------------------------------------------------- */

  async observe(): Promise<PageSnapshot> {
    const snapshot = await this.observer.observe();
    this.evidence.addObservation(snapshot);
    return snapshot;
  }

  /* ---------------------------------------------------------------- */
  /*  Act                                                              */
  /* ---------------------------------------------------------------- */

  async act(action: Action): Promise<ActionResult> {
    const result = await executeAction(
      this.page,
      this.observer,
      action,
      this.screenshotDir,
    );
    this.evidence.addAction(result);
    return result;
  }

  async actSequence(actions: Action[]): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    for (const action of actions) {
      const result = await this.act(action);
      results.push(result);
      if (!result.success) break;
    }
    return results;
  }

  /* ---------------------------------------------------------------- */
  /*  Screenshot                                                       */
  /* ---------------------------------------------------------------- */

  async screenshot(label?: string): Promise<string> {
    this.screenshotCounter++;
    const name = label ?? `screenshot-${this.screenshotCounter}`;
    const path = resolve(this.screenshotDir, `${name}.png`);
    await this.page.screenshot({ path, fullPage: true });
    this.evidence.addScreenshot(path, name);
    return path;
  }

  /* ---------------------------------------------------------------- */
  /*  Page access                                                      */
  /* ---------------------------------------------------------------- */

  getPage(): Page {
    return this.page;
  }

  getDriver(): UIDriver | null {
    return this.driver;
  }

  isClosed(): boolean {
    return this.closed;
  }

  /* ---------------------------------------------------------------- */
  /*  Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  /** Close the session. Safe to call multiple times (idempotent). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    this.observer.detach();

    if (this.driver) {
      await this.driver.close().catch(() => {});
    }
    if (this.ownContext) {
      await this.ownContext.close().catch(() => {});
    }
    if (this.ownBrowser) {
      await this.ownBrowser.close().catch(() => {});
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Internal                                                         */
  /* ---------------------------------------------------------------- */

  private static getAdapter(config: NeoxtenConfig) {
    switch (config.project.type) {
      case 'web':
        return new WebAdapter();
      case 'tauri':
        return new TauriAdapter();
      case 'nextjs':
        return new NextJsAdapter();
      case 'extension':
        return new ExtensionAdapter();
      case 'android':
        return new AndroidAdapter();
      default:
        throw new Error(`Unsupported project type: ${(config.project as { type: string }).type}`);
    }
  }
}
