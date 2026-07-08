#!/usr/bin/env node
/**
 * Phase 2 staff access — admin dashboard OPERATOR flow (local, Playwright).
 *
 * Spins up the same isolated local environment as the API suite (in-memory
 * MongoDB + real backend), creates an operator via the staff API, then
 * drives the real admin dashboard in a browser the way a remote operator
 * would:
 *
 *   - operator logs in on /login
 *   - is landed on the sort-proof review queue (not the admin dashboard)
 *   - sidebar shows ONLY the whitelisted pages
 *   - the review queue renders WITHOUT submitter name/email (PII masked)
 *   - navigating to a blocked page (/users) bounces back to the queue
 *   - community moderation shows the flagged post but hides the admin-only
 *     Feature / Warn Author buttons
 *   - control run: an admin still sees the full sidebar + queue PII
 *
 * The dashboard dev server is spawned on a dedicated port (8093) pointed at
 * the local backend — a dev server already running against prod on 8080 is
 * never reused. Production is not touched.
 *
 * Run: npm run test:plastypesa-admin-rbac-dashboard
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { SuiteRunner, printFailureDetails } from './plastypesa/runner.mjs';
import { startLocalRbacEnv } from './plastypesa/local-rbac-env.mjs';

const FRONTEND_DIR =
  process.env.PLASTYPESA_ADMIN_FRONTEND_DIR ||
  'C:\\Users\\Bobby\\Documents\\plastypesa-admin-dashboard\\lib\\frontend';
const WEB_PORT = Number(process.env.PLASTYPESA_RBAC_WEB_PORT || 8093);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const SHOT_DIR = '.neoxten/admin-rbac';

const OPERATOR_EMAIL = 'rbac-dashboard-operator@test.local';
const OPERATOR_PASSWORD = 'OperatorPass123!';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function startWebServer(backendOrigin) {
  const child = spawn(
    `npm run dev -- --port ${WEB_PORT} --strictPort`,
    {
      cwd: FRONTEND_DIR,
      env: {
        ...process.env,
        VITE_APP_DEV_BACKEND_URL: backendOrigin,
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.resume();
  child.stderr.on('data', (d) => process.stderr.write(`[vite:err] ${d}`));
  return child;
}

function killWebServer(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', `${child.pid}`, '/t', '/f'], {
      stdio: 'ignore',
      shell: true,
    });
    return;
  }
  child.kill('SIGTERM');
}

async function waitForWeb(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(WEB_URL, { signal: AbortSignal.timeout(3000) });
      if (r.status < 500) return true;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  return false;
}

async function loginViaUi(page, email, password) {
  await page.goto(`${WEB_URL}/login`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.getByTestId('admin-login-email').fill(email);
  await page.getByTestId('admin-login-password').fill(password);
  await page.getByTestId('admin-login-submit').click();
}

async function sidebarLabels(page) {
  return page
    .locator('aside nav a span')
    .allInnerTexts()
    .then((xs) => xs.map((x) => x.trim()).filter(Boolean));
}

async function main() {
  console.log('\n=== PlastyPesa Admin RBAC — dashboard operator flow ===\n');
  mkdirSync(SHOT_DIR, { recursive: true });

  const env = await startLocalRbacEnv({ quietBackend: true });
  let web = null;
  let browser = null;
  let exitCode = 1;

  try {
    // Provision the operator over the real staff API.
    const adm = await fetch(`${env.baseUrl}/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env.adminEmail, password: env.adminPassword }),
    }).then((r) => r.json());
    if (!adm?.token) throw new Error('admin API login failed');
    const created = await fetch(`${env.baseUrl}/admin/staff/operators`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adm.token}`,
      },
      body: JSON.stringify({
        email: OPERATOR_EMAIL,
        password: OPERATOR_PASSWORD,
        firstName: 'Dash',
        lastName: 'Operator',
      }),
    });
    if (created.status !== 201) {
      throw new Error(`operator creation failed: ${created.status}`);
    }

    console.log(`Starting dashboard dev server on :${WEB_PORT} → ${env.backendOrigin} ...`);
    web = startWebServer(env.backendOrigin);
    if (!(await waitForWeb())) throw new Error('dashboard dev server never came up');
    console.log(`Dashboard up at ${WEB_URL}\n`);

    browser = await chromium.launch({ headless: true });
    const runner = new SuiteRunner('admin-rbac-dashboard');

    // ---------------- Operator session ----------------
    const opCtx = await browser.newContext();
    const op = await opCtx.newPage();

    await runner.test('operator_login_lands_on_review_queue_not_dashboard', async () => {
      await loginViaUi(op, OPERATOR_EMAIL, OPERATOR_PASSWORD);
      await op.waitForURL(/\/sort-proof-review/, { timeout: 45000 });
      await op.screenshot({ path: `${SHOT_DIR}/operator-landing.png`, fullPage: true });
    });

    await runner.test('operator_queue_renders_without_pii', async () => {
      // The seeded pending submission must be on screen ("300 pts" row)…
      await op.waitForSelector('text=300 pts', { timeout: 30000 });
      const body = await op.locator('body').innerText();
      // …but the submitter identity must not.
      if (body.includes(env.subjectEmail)) throw new Error('PII LEAK: email visible');
      if (body.includes(env.subjectLastName)) throw new Error('PII LEAK: last name visible');
      await op.screenshot({ path: `${SHOT_DIR}/operator-queue.png`, fullPage: true });
    });

    await runner.test('operator_sidebar_shows_only_whitelisted_pages', async () => {
      // The sort-proof review page renders standalone (no sidebar layout),
      // so assert the sidebar on the moderation page, which uses it.
      await op.goto(`${WEB_URL}/community-moderation`, { waitUntil: 'domcontentloaded' });
      await op.locator('aside nav a').first().waitFor({ timeout: 20000 });
      const labels = await sidebarLabels(op);
      const expected = ['Sort-by-Grade Review', 'Community Moderation'];
      const unexpected = labels.filter((l) => !expected.includes(l));
      if (unexpected.length > 0) {
        throw new Error(`operator sees extra nav: ${unexpected.join(', ')}`);
      }
      for (const e of expected) {
        if (!labels.includes(e)) throw new Error(`missing nav item: ${e}`);
      }
    });

    await runner.test('operator_blocked_page_redirects_back', async () => {
      await op.goto(`${WEB_URL}/users`, { waitUntil: 'domcontentloaded' });
      await op.waitForURL(/\/sort-proof-review/, { timeout: 20000 });
    });

    await runner.test('operator_moderation_page_hides_admin_only_actions', async () => {
      await op.goto(`${WEB_URL}/community-moderation`, { waitUntil: 'domcontentloaded' });
      await op.waitForSelector('text=GreenJane', { timeout: 30000 });
      // Operator keeps Approve/Remove but must not see the admin-only
      // Feature / Warn Author action buttons (help copy may mention the
      // words, so assert on the buttons themselves).
      const approveBtns = await op.getByRole('button', { name: 'Approve' }).count();
      if (approveBtns < 1) throw new Error('Approve button missing for operator');
      const featureBtns = await op.getByRole('button', { name: 'Feature' }).count();
      if (featureBtns > 0) throw new Error('Feature button visible to operator');
      const warnBtns = await op.getByRole('button', { name: 'Warn Author' }).count();
      if (warnBtns > 0) throw new Error('Warn Author button visible to operator');
      await op.screenshot({ path: `${SHOT_DIR}/operator-moderation.png`, fullPage: true });
    });

    await opCtx.close();

    // ---------------- Admin control run ----------------
    const admCtx = await browser.newContext();
    const admPage = await admCtx.newPage();

    await runner.test('admin_still_sees_full_sidebar', async () => {
      await loginViaUi(admPage, env.adminEmail, env.adminPassword);
      await admPage.waitForURL(/\/dashboard/, { timeout: 45000 });
      await admPage.locator('aside nav a').first().waitFor({ timeout: 15000 });
      const labels = await sidebarLabels(admPage);
      for (const must of ['Dashboard', 'Users', 'Settings', 'Sort-by-Grade Review']) {
        if (!labels.includes(must)) throw new Error(`admin missing nav item: ${must}`);
      }
      await admPage.screenshot({ path: `${SHOT_DIR}/admin-sidebar.png`, fullPage: true });
    });

    await runner.test('admin_queue_still_shows_submitter_identity', async () => {
      await admPage.goto(`${WEB_URL}/sort-proof-review`, { waitUntil: 'domcontentloaded' });
      await admPage.waitForSelector('text=300 pts', { timeout: 30000 });
      const body = await admPage.locator('body').innerText();
      if (!body.includes(env.subjectEmail) && !body.includes(env.subjectLastName)) {
        throw new Error('admin lost submitter identity — masking over-applied');
      }
      await admPage.screenshot({ path: `${SHOT_DIR}/admin-queue.png`, fullPage: true });
    });

    await admCtx.close();

    const s = runner.summary();
    console.log(
      `\n=== Summary ===\n\n  admin-rbac-dashboard: ${s.pass} pass, ${s.fail} fail, ${s.skip} skip\n`,
    );
    printFailureDetails(
      s.results
        .filter((r) => r.status === 'FAIL')
        .map((r) => ({ suite: 'admin-rbac-dashboard', name: r.name, error: r.error })),
    );
    console.log(`Screenshots: ${SHOT_DIR}/\n`);
    exitCode = s.fail > 0 ? 1 : 0;
  } catch (err) {
    console.error('\nFATAL:', err?.message || err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    killWebServer(web);
    await env.stop();
  }
  process.exit(exitCode);
}

main();
