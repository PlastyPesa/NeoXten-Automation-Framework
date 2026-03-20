#!/usr/bin/env node
/**
 * PlastyPesa multi-layer E2E: API (optional) → cross-flow API checks → Admin Playwright → Flutter integration_test.
 * Writes a single verdict JSON under .neoxten-out/
 *
 * Env (see scripts/plastypesa/PLASTYPESA_E2E.md):
 *   PLASTYPESA_E2E_SKIP_API=1
 *   PLASTYPESA_E2E_API_MODE=smoke|release-pack  (default smoke)
 *   PLASTYPESA_E2E_SKIP_CROSSFLOW=1
 *   PLASTYPESA_E2E_SKIP_ADMIN=1
 *   PLASTYPESA_E2E_SKIP_MOBILE=1
 *   PLASTYPESA_ADMIN_ROOT — path to admin frontend (package with playwright)
 *   PLASTYPESA_MOBILE_ROOT — path to Flutter app root
 *   PLASTYPESA_ANDROID_DEVICE — adb serial (default: first authorized device)
 */
import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = resolve(__dirname, '../..');

function defaultAdminRoot() {
  const env = process.env.PLASTYPESA_ADMIN_ROOT;
  if (env) return resolve(env);
  return resolve(NEOXTEN_ROOT, '../plastypesa-admin-dashboard/lib/frontend');
}

function defaultMobileRoot() {
  const env = process.env.PLASTYPESA_MOBILE_ROOT;
  if (env) return resolve(env);
  return resolve(NEOXTEN_ROOT, '../plastypesa-mobile-app');
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

function runNode(scriptRelative, extraEnv = {}) {
  const script = resolve(NEOXTEN_ROOT, scriptRelative);
  const env = { ...process.env, ...extraEnv };
  const r = spawnSync(process.execPath, [script], {
    cwd: NEOXTEN_ROOT,
    env,
    stdio: 'inherit',
    shell: false,
  });
  return r.status ?? 1;
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
    child.on('error', (err) => {
      console.error(err);
      resolvePromise(1);
    });
  });
}

async function main() {
  bootstrapPlastyPesaEnv();

  const startedAt = new Date().toISOString();
  const verdict = {
    schema: 'plastypesa-e2e-verdict-v1',
    startedAt,
    neoxtenRoot: NEOXTEN_ROOT,
    phases: [],
    overall: 'PASS',
  };
  let anyFailed = false;

  mkdirSync(resolve(NEOXTEN_ROOT, '.neoxten-out'), { recursive: true });

  // --- API ---
  if (process.env.PLASTYPESA_E2E_SKIP_API === '1') {
    verdict.phases.push({ id: 'api', status: 'skipped' });
  } else {
    const mode = (process.env.PLASTYPESA_E2E_API_MODE || 'smoke').toLowerCase();
    let code;
    if (mode === 'release-pack') {
      code = runNode('scripts/plastypesa-release-pack.mjs'); // repo root scripts/
    } else {
      code = runNode('scripts/plastypesa/index.mjs', {
        PLASTYPESA_SUITES: process.env.PLASTYPESA_E2E_API_SUITES || 'auth-baseline,regression-core',
        PLASTYPESA_RELEASE_PACK: '0',
      });
    }
    verdict.phases.push({ id: 'api', status: code === 0 ? 'passed' : 'failed', exitCode: code });
    if (code !== 0) {
      verdict.overall = 'FAIL';
    }
  }

  // --- Cross-flow API ---
  if (process.env.PLASTYPESA_E2E_SKIP_CROSSFLOW === '1') {
    verdict.phases.push({ id: 'crossflow', status: 'skipped' });
  } else if (anyFailed && process.env.PLASTYPESA_E2E_CONTINUE_ON_FAIL !== '1') {
    verdict.phases.push({ id: 'crossflow', status: 'skipped', reason: 'previous phase failed' });
  } else {
    const code = runNode('scripts/plastypesa/e2e-cross-flow.mjs');
    verdict.phases.push({ id: 'crossflow', status: code === 0 ? 'passed' : 'failed', exitCode: code });
    if (code !== 0) anyFailed = true;
  }

  // --- Admin Playwright ---
  const adminRoot = defaultAdminRoot();
  if (process.env.PLASTYPESA_E2E_SKIP_ADMIN === '1') {
    verdict.phases.push({ id: 'admin', status: 'skipped' });
  } else if (!existsSync(resolve(adminRoot, 'package.json'))) {
    verdict.phases.push({
      id: 'admin',
      status: 'skipped',
      reason: `admin root not found: ${adminRoot}`,
    });
  } else if (anyFailed && process.env.PLASTYPESA_E2E_CONTINUE_ON_FAIL !== '1') {
    verdict.phases.push({ id: 'admin', status: 'skipped', reason: 'previous phase failed' });
  } else {
    const code = await runShell('npx playwright test', adminRoot, {
      PLASTYPESA_ADMIN_BASE_URL: process.env.PLASTYPESA_ADMIN_BASE_URL || '',
    });
    verdict.phases.push({ id: 'admin', status: code === 0 ? 'passed' : 'failed', exitCode: code });
    if (code !== 0) anyFailed = true;
  }

  // --- Flutter integration_test on device ---
  const mobileRoot = defaultMobileRoot();
  const deviceId = getAdbDevice();
  if (process.env.PLASTYPESA_E2E_SKIP_MOBILE === '1') {
    verdict.phases.push({ id: 'mobile', status: 'skipped' });
  } else if (!existsSync(resolve(mobileRoot, 'pubspec.yaml'))) {
    verdict.phases.push({
      id: 'mobile',
      status: 'skipped',
      reason: `mobile root not found: ${mobileRoot}`,
    });
  } else if (!deviceId) {
    verdict.phases.push({
      id: 'mobile',
      status: 'skipped',
      reason: 'no adb device in "device" state',
    });
  } else if (anyFailed && process.env.PLASTYPESA_E2E_CONTINUE_ON_FAIL !== '1') {
    verdict.phases.push({ id: 'mobile', status: 'skipped', reason: 'previous phase failed' });
  } else {
    const code = await runShell(
      `flutter test integration_test/smoke_test.dart -d ${deviceId} --reporter expanded`,
      mobileRoot,
    );
    verdict.phases.push({
      id: 'mobile',
      status: code === 0 ? 'passed' : 'failed',
      exitCode: code,
      deviceId,
    });
    if (code !== 0) anyFailed = true;
  }

  verdict.overall = anyFailed ? 'FAIL' : 'PASS';

  verdict.finishedAt = new Date().toISOString();
  const outPath = resolve(
    NEOXTEN_ROOT,
    `.neoxten-out/plastypesa-e2e-verdict-${startedAt.replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(outPath, JSON.stringify(verdict, null, 2), 'utf8');
  console.log(`\n[plastypesa-e2e] Verdict written: ${outPath}`);
  console.log(`[plastypesa-e2e] Overall: ${verdict.overall}\n`);

  process.exit(verdict.overall === 'PASS' ? 0 : 1);
}

await main();
