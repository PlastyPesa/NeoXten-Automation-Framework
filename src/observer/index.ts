/**
 * PageObserver — unified page observation combining DOM snapshots,
 * streaming console capture, and network activity monitoring.
 *
 * Attach to a Playwright Page once; call observe() at any time
 * to get a full PageSnapshot with live console/network state.
 */
import type { Page, Request as PwRequest } from 'playwright';
import { takeSnapshot, type PageSnapshot } from './snapshot.js';

/* ------------------------------------------------------------------ */
/*  Console stream                                                     */
/* ------------------------------------------------------------------ */

export interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: string;
}

/* ------------------------------------------------------------------ */
/*  PageObserver                                                       */
/* ------------------------------------------------------------------ */

export class PageObserver {
  private page: Page;
  private consoleLogs: ConsoleEntry[] = [];
  private pendingRequests = new Set<PwRequest>();
  private attached = false;

  constructor(page: Page) {
    this.page = page;
  }

  /* ---- Lifecycle ---- */

  /** Attach event listeners. Safe to call multiple times (idempotent). */
  attach(): void {
    if (this.attached) return;
    this.attached = true;

    this.page.on('console', (msg) => {
      this.consoleLogs.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: new Date().toISOString(),
      });
    });

    this.page.on('request', (req) => {
      this.pendingRequests.add(req);
    });

    this.page.on('requestfinished', (req) => {
      this.pendingRequests.delete(req);
    });

    this.page.on('requestfailed', (req) => {
      this.pendingRequests.delete(req);
    });
  }

  /** Detach is a no-op (Playwright cleans up on page close). */
  detach(): void {
    this.attached = false;
  }

  /* ---- Observation ---- */

  /** Take a full page snapshot including live console/network state. */
  async observe(): Promise<PageSnapshot> {
    return takeSnapshot(this.page, {
      consoleErrors: this.getConsoleErrors(),
      pendingRequests: this.pendingRequests.size,
    });
  }

  /* ---- Console queries ---- */

  /** All console entries since attach (or last clear). */
  getConsoleLogs(): ConsoleEntry[] {
    return [...this.consoleLogs];
  }

  /** Console error messages only. */
  getConsoleErrors(): string[] {
    return this.consoleLogs
      .filter((e) => e.type === 'error')
      .map((e) => e.text);
  }

  /** Console warnings only. */
  getConsoleWarnings(): string[] {
    return this.consoleLogs
      .filter((e) => e.type === 'warning')
      .map((e) => e.text);
  }

  /** Clear console buffer. */
  clearConsole(): void {
    this.consoleLogs = [];
  }

  /* ---- Network queries ---- */

  /** Number of in-flight requests right now. */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }

  /** True when no requests are in flight. */
  isNetworkIdle(): boolean {
    return this.pendingRequests.size === 0;
  }
}

/* Re-export snapshot types for convenience */
export { type PageSnapshot, type ElementInfo } from './snapshot.js';
