/**
 * Probe: does the built Operator UI mount under Playwright Chromium?
 * Run: npm run build --prefix ui && node scripts/probe-dashboard-ui.mjs
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ui = path.join(repo, 'ui');
const viteBin = path.join(ui, 'node_modules', 'vite', 'bin', 'vite.js');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(p)));
    });
    s.on('error', reject);
  });
}

/** Wait until something accepts TCP on 127.0.0.1:port (HTTP GET can hang on some servers). */
function waitTcpPort(port, ms) {
  const host = '127.0.0.1';
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect({ port, host }, () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() - t0 > ms) reject(new Error(`tcp wait timeout :${port}`));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

const port = await getFreePort();
const base = `http://127.0.0.1:${port}`;

const proc = spawn(
  process.execPath,
  [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: ui, stdio: 'ignore' },
);

let exitCode = 0;
/** @type {import('playwright').Browser | undefined} */
let browser;
try {
  await waitTcpPort(port, 45_000);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(20_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  const title = await page.title();
  try {
    await page.waitForSelector('[data-testid="app-shell"]', { state: 'attached', timeout: 25_000 });
    console.log(JSON.stringify({ ok: true, port, title, errors }, null, 2));
  } catch {
    console.log(
      JSON.stringify(
        {
          ok: false,
          port,
          title,
          errors,
          note: 'app-shell not attached — React did not render or selectors differ',
        },
        null,
        2,
      ),
    );
    exitCode = 1;
  }
} catch (e) {
  console.error('probe failed:', e);
  exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  try {
    proc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  process.exit(exitCode);
}
