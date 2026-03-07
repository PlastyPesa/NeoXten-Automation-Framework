/**
 * AndroidCDPDriver — run flows against an Android app (emulator + APK) via CDP to WebView.
 *
 * Requires: WebView.setWebContentsDebuggingEnabled(true) in the app (or equivalent).
 * 1. Optionally starts emulator (avd).
 * 2. Installs APK via adb.
 * 3. Launches app (package/activity).
 * 4. Forwards CDP port and connects Playwright.
 * Reuses same executeStep as PlaywrightWebDriver (same selectors/flows).
 */
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import { spawn } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';

import type { FlowStep } from '../config/schema.js';
import type { StepResult } from './base.js';
import { PlaywrightWebDriver } from './playwright-web.js';

async function waitForDevtoolsReady(cdpPort: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (res.ok) {
        const txt = await res.text();
        if (txt && txt.includes('webSocketDebuggerUrl')) return;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `Android WebView DevTools endpoint not ready on port ${cdpPort} within ${timeoutMs}ms${lastErr ? `: ${String(lastErr)}` : ''}`
  );
}

export interface AndroidCDPOptions {
  /** Absolute path to APK. */
  apkPath: string;
  avd?: string;
  cdpPort: number;
  package: string;
  activity: string;
  emulatorBootTimeoutMs: number;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(cmd, args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    const t = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${cmd} ${args.join(' ')} timed out after ${timeoutMs}ms. ${stderr.slice(-300)}`));
    }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} exited ${code}. ${stderr.slice(-300)}`));
    });
    proc.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function runOut(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(cmd, args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.stderr?.on('data', (d) => { err += d.toString(); });
    const t = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Timeout. stderr: ${err.slice(-200)}`));
    }, timeoutMs);
    proc.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolvePromise(out.trim());
      else reject(new Error(`Exit ${code}: ${err.slice(-200)}`));
    });
    proc.on('error', reject);
  });
}

export class AndroidCDPDriver extends PlaywrightWebDriver {
  private androidOptions: AndroidCDPOptions;
  private emulatorProc: ReturnType<typeof spawn> | null = null;

  constructor(options: AndroidCDPOptions) {
    super({ url: 'about:blank', headless: true });
    this.androidOptions = options;
  }

  override async launch(): Promise<void> {
    const { apkPath, avd, cdpPort, package: pkg, activity, emulatorBootTimeoutMs } = this.androidOptions;

    if (!existsSync(apkPath)) {
      throw new Error(`APK not found: ${apkPath}`);
    }

    const adb = 'adb';

    if (avd) {
      const base = process.env.ANDROID_HOME
        ? `${process.env.ANDROID_HOME}/emulator/emulator`
        : `${process.env.LOCALAPPDATA || ''}/Android/Sdk/emulator/emulator`;
      const emulatorPath = existsSync(base + '.exe') ? base + '.exe' : base;
      if (!existsSync(emulatorPath)) {
        throw new Error(`Emulator not found at ${emulatorPath}. Set ANDROID_HOME or install Android SDK.`);
      }
      this.emulatorProc = spawn(emulatorPath, ['-avd', avd, '-no-snapshot-load'], {
        detached: true,
        stdio: 'ignore',
      });
      this.emulatorProc.unref();
      await run(adb, ['wait-for-device'], Math.min(60000, emulatorBootTimeoutMs));
      let booted = false;
      for (let i = 0; i < Math.ceil(emulatorBootTimeoutMs / 2000); i++) {
        const v = await runOut(adb, ['shell', 'getprop', 'sys.boot_completed'], 5000).catch(() => '');
        if (v === '1') { booted = true; break; }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!booted) throw new Error(`Emulator ${avd} did not boot within ${emulatorBootTimeoutMs}ms`);
    }

    await run(adb, ['install', '-r', apkPath], 120000);
    await run(adb, ['shell', 'am', 'start', '-n', `${pkg}/${activity}`], 10000);

    await new Promise((r) => setTimeout(r, 6000));

    // WebView uses localabstract socket, not TCP. Forward to webview_devtools_remote_<pid>.
    const pidOut = await runOut(adb, ['shell', 'pidof', pkg], 5000).catch(() => '');
    const pid = pidOut.split(/\s+/)[0]?.trim();
    if (!pid) {
      throw new Error(`App ${pkg} not running. pidof returned: ${pidOut || '(empty)'}`);
    }
    await run(adb, ['forward', `tcp:${cdpPort}`, `localabstract:webview_devtools_remote_${pid}`], 5000);

    // Ensure app is foregrounded before CDP connect (WebView target can be stale when backgrounded).
    await run(adb, ['shell', 'am', 'start', '-n', `${pkg}/${activity}`], 5000);
    await new Promise((r) => setTimeout(r, 1500));

    await waitForDevtoolsReady(cdpPort, 30000);

    let lastErr: unknown;
    let browser: Browser | undefined;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        const targets = (await res.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
        const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!pageTarget?.webSocketDebuggerUrl) {
          throw new Error('No page target with webSocketDebuggerUrl found in /json/list');
        }
        const wsUrl = pageTarget.webSocketDebuggerUrl;
        browser = await chromium.connectOverCDP(wsUrl, { timeout: 30000 });
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < 5) await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    if (lastErr || !browser) throw lastErr ?? new Error('Failed to connect over CDP');
    this.browser = browser;
    const contexts = browser.contexts();
    this.context = contexts[0] ?? null;
    const ctx = this.context;
    if (!ctx) {
      await browser.close();
      throw new Error('No browser context after CDP connect. Ensure the app enables WebView debugging.');
    }

    let page: Page | null = ctx.pages()[0] ?? null;
    if (!page) page = await ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null);
    if (!page) {
      await browser.close();
      throw new Error('No page in WebView context. Enable WebView.setWebContentsDebuggingEnabled(true) in the app.');
    }

    this.page = page;
    page.on('console', (msg) => {
      this.consoleLogs.push({ type: msg.type(), text: msg.text() });
    });

    await ctx.tracing.start({ screenshots: true, snapshots: true }).catch(() => {});
  }

  override async executeStep(step: FlowStep): Promise<StepResult> {
    if (step.action === 'sendToBackground') {
      try {
        await run('adb', ['shell', 'input', 'keyevent', 'KEYCODE_HOME'], 5000);
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    if (step.action === 'bringToForeground') {
      const { package: pkg, activity } = this.androidOptions;
      try {
        await run('adb', ['shell', 'am', 'start', '-n', `${pkg}/${activity}`], 10000);
        return { success: true };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    return super.executeStep(step);
  }

  override async close(): Promise<void> {
    await super.close();
    this.emulatorProc = null;
  }
}
