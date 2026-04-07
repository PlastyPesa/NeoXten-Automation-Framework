#!/usr/bin/env node
/**
 * Cross-surface sort-proof ON/OFF visibility:
 * 1) Admin toggles + Save (Playwright) → .neoxten/sort-proof-e2e-state.json
 * 2) GET /home/sort-proof/config (user JWT) matches expectedEnabled
 * 3) Flutter on device: pull-to-refresh on Home → quick action visibility
 * 4) Admin restore (optional unless PLASTYPESA_SORT_PROOF_E2E_SKIP_RESTORE=1)
 *
 * @see PLASTYPESA_SORT_PROOF_VISIBILITY_E2E.md
 */
import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getAdminPlaywrightProcessEnv } from './admin-playwright-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = resolve(__dirname, '../..');

function defaultAdminRoot() {
  return (
    process.env.PLASTYPESA_ADMIN_ROOT ||
    resolve(NEOXTEN_ROOT, '../plastypesa-admin-dashboard/lib/frontend')
  );
}

function defaultMobileRoot() {
  return (
    process.env.PLASTYPESA_MOBILE_ROOT ||
    resolve(NEOXTEN_ROOT, '../plastypesa-mobile-app')
  );
}

function getAdbDevice() {
  const explicit = (process.env.PLASTYPESA_ANDROID_DEVICE || '').trim();
  if (explicit) return explicit;
  const r = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const lines = (r.stdout || '').split('\n').slice(1);
  for (const line of lines) {
    const m = line.trim().match(/^(\S+)\s+device\s*$/);
    if (m) return m[1];
  }
  return null;
}

function runShell(command, cwd, env = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
    child.on('error', () => resolvePromise(1));
  });
}

async function main() {
  bootstrapPlastyPesaEnv();

  const startedAt = new Date().toISOString();
  const verdict = {
    schema: 'plastypesa-sort-proof-visibility-e2e-v1',
    startedAt,
    neoxtenRoot: NEOXTEN_ROOT,
    phases: [],
    overall: 'PASS',
  };
  let anyFailed = false;

  const adminRoot = defaultAdminRoot();
  const mobileRoot = defaultMobileRoot();
  const deviceId = getAdbDevice();

  if (!existsSync(resolve(adminRoot, 'package.json'))) {
    console.error('[sort-proof-e2e] Admin root not found:', adminRoot);
    process.exit(2);
  }
  if (!existsSync(resolve(mobileRoot, 'pubspec.yaml'))) {
    console.error('[sort-proof-e2e] Mobile root not found:', mobileRoot);
    process.exit(2);
  }
  if (!deviceId) {
    console.error('[sort-proof-e2e] No adb device in "device" state');
    process.exit(2);
  }

  mkdirSync(resolve(NEOXTEN_ROOT, '.neoxten-out'), { recursive: true });

  const neoxtenEnv = {
    PLASTYPESA_NEOXTEN_ROOT: NEOXTEN_ROOT,
    ...getAdminPlaywrightProcessEnv(),
  };

  console.log('\n=== [1/4] Admin: toggle sort-proof & save ===\n');
  let code = await runShell(
    'npx playwright test e2e/sort-proof-visibility.e2e.spec.ts --grep "toggles sort-proof"',
    adminRoot,
    neoxtenEnv,
  );
  verdict.phases.push({ id: 'admin_toggle', status: code === 0 ? 'passed' : 'failed', exitCode: code });
  if (code !== 0) {
    anyFailed = true;
    verdict.phases.push({
      id: 'api_verify',
      status: 'skipped',
      reason: 'admin_toggle failed',
    });
    verdict.phases.push({
      id: 'mobile_home',
      status: 'skipped',
      reason: 'admin_toggle failed',
      deviceId,
    });
  }

  if (!anyFailed) {
    console.log('\n=== [2/4] API: GET sort-proof/config ===\n');
    code =
      spawnSync(process.execPath, [resolve(__dirname, 'e2e-sort-proof-verify-api.mjs')], {
        cwd: NEOXTEN_ROOT,
        env: process.env,
        stdio: 'inherit',
      }).status ?? 1;
    verdict.phases.push({ id: 'api_verify', status: code === 0 ? 'passed' : 'failed', exitCode: code });
    if (code !== 0) anyFailed = true;
  }

  if (anyFailed && !verdict.phases.some((p) => p.id === 'mobile_home')) {
    const apiP = verdict.phases.find((p) => p.id === 'api_verify');
    const reason =
      apiP?.status === 'failed' ? 'api_verify failed' : 'previous phase failed';
    verdict.phases.push({
      id: 'mobile_home',
      status: 'skipped',
      reason,
      deviceId,
    });
  }

  if (!anyFailed) {
    const statePath = resolve(NEOXTEN_ROOT, '.neoxten/sort-proof-e2e-state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const vis = state.expectedEnabled === true ? 'true' : 'false';
    console.log('\n=== [3/4] Device: Home UI (expect visible=' + vis + ') ===\n');
    const flutterArgs = [
      'test',
      'integration_test/manual/sort_proof_visibility_e2e_test.dart',
      '-d',
      deviceId,
      '--dart-define=INTEGRATION_TEST=true',
      `--dart-define=PLASTYPESA_SORT_PROOF_E2E_EXPECT_VISIBLE=${vis}`,
      '--reporter',
      'expanded',
    ];
    const b = process.env.PLASTYPESA_API_BASE;
    const em = process.env.PLASTYPESA_TEST_EMAIL;
    const pw = process.env.PLASTYPESA_TEST_PASSWORD;
    if (b) flutterArgs.push(`--dart-define=PLASTYPESA_API_BASE=${b}`);
    if (em) flutterArgs.push(`--dart-define=PLASTYPESA_TEST_EMAIL=${em}`);
    if (pw) flutterArgs.push(`--dart-define=PLASTYPESA_TEST_PASSWORD=${pw}`);
    // Windows: shell:true so PATH resolves `flutter` / `flutter.bat` when spawned from npm/Node.
    code =
      spawnSync(process.platform === 'win32' ? 'flutter.bat' : 'flutter', flutterArgs, {
        cwd: mobileRoot,
        env: process.env,
        stdio: 'inherit',
        shell: true,
      }).status ?? 1;
    verdict.phases.push({
      id: 'mobile_home',
      status: code === 0 ? 'passed' : 'failed',
      exitCode: code,
      deviceId,
      expectVisible: state.expectedEnabled,
    });
    if (code !== 0) anyFailed = true;
  }

  if (!anyFailed && process.env.PLASTYPESA_SORT_PROOF_E2E_SKIP_RESTORE !== '1') {
    console.log('\n=== [4/4] Admin: restore previous flag ===\n');
    code = await runShell(
      'npx playwright test e2e/sort-proof-visibility.e2e.spec.ts --grep "restore sort-proof"',
      adminRoot,
      neoxtenEnv,
    );
    verdict.phases.push({ id: 'admin_restore', status: code === 0 ? 'passed' : 'failed', exitCode: code });
    if (code !== 0) anyFailed = true;
  } else {
    verdict.phases.push({
      id: 'admin_restore',
      status: 'skipped',
      reason:
        process.env.PLASTYPESA_SORT_PROOF_E2E_SKIP_RESTORE === '1'
          ? 'PLASTYPESA_SORT_PROOF_E2E_SKIP_RESTORE=1'
          : 'previous phase failed',
    });
  }

  verdict.overall = anyFailed ? 'FAIL' : 'PASS';
  verdict.finishedAt = new Date().toISOString();

  const outPath = resolve(
    NEOXTEN_ROOT,
    `.neoxten-out/plastypesa-sort-proof-visibility-verdict-${startedAt.replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(outPath, JSON.stringify(verdict, null, 2), 'utf8');
  console.log(`\n[sort-proof-e2e] Verdict: ${outPath}`);
  console.log(`[sort-proof-e2e] Overall: ${verdict.overall}\n`);

  process.exit(anyFailed ? 1 : 0);
}

await main();
