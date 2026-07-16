#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { captureAdbArtifacts } from './localization/adb-artifacts.mjs';
import { defaultMobileRoot, getLocalizationOutDir, writeJson, writeText } from './localization/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = resolve(__dirname, '../..');

function getAdbDevice() {
  const explicit = (process.env.PLASTYPESA_ANDROID_DEVICE || '').trim();
  if (explicit) return explicit;
  const result = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const lines = (result.stdout || '').split('\n').slice(1);
  for (const line of lines) {
    const match = line.trim().match(/^(\S+)\s+device\s*$/);
    if (match) return match[1];
  }
  return null;
}

function runNode(scriptRelative, extraEnv = {}) {
  const script = resolve(NEOXTEN_ROOT, scriptRelative);
  const result = spawnSync(process.execPath, [script], {
    cwd: NEOXTEN_ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  return result.status ?? 1;
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

function runShellCapture(command, cwd, env = {}, options = {}) {
  return new Promise((resolvePromise) => {
    let output = '';
    let forcedSuccess = false;
    let completionTimer = null;
    const child = spawn(command, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    const detectCompletedTest = () => {
      if (
        !options.successPattern ||
        completionTimer ||
        !output.includes(options.successPattern)
      ) {
        return;
      }
      completionTimer = setTimeout(() => {
        forcedSuccess = true;
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/PID', `${child.pid}`, '/T', '/F'], {
            stdio: 'ignore',
          });
        } else {
          child.kill('SIGTERM');
        }
      }, options.successGraceMs ?? 5000);
    };
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
      detectCompletedTest();
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
      detectCompletedTest();
    });
    child.on('close', (code) => {
      if (completionTimer) clearTimeout(completionTimer);
      resolvePromise({ code: forcedSuccess ? 0 : (code ?? 1), output });
    });
    child.on('error', () => resolvePromise({ code: 1, output }));
  });
}

function renderMarkdown(verdict) {
  const lines = [
    '# PlastyPesa Localization Audit Verdict',
    '',
    `Started: ${verdict.startedAt}`,
    `Finished: ${verdict.finishedAt}`,
    `Overall: ${verdict.overall}`,
    '',
    '## Phases',
    ...verdict.phases.map((phase) => {
      const bits = [`- \`${phase.id}\`: ${phase.status}`];
      if (phase.reason) bits.push(` (${phase.reason})`);
      if (phase.deviceId) bits.push(` [device ${phase.deviceId}]`);
      return bits.join('');
    }),
    '',
    '## Output Directory',
    `- \`${verdict.outDir}\``,
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function main() {
  bootstrapPlastyPesaEnv();

  const startedAt = new Date().toISOString();
  const outDir = getLocalizationOutDir();
  mkdirSync(outDir, { recursive: true });

  const verdict = {
    schema: 'plastypesa-localization-audit-v1',
    startedAt,
    outDir,
    phases: [],
    overall: 'PASS',
  };

  let anyFailed = false;

  if (process.env.PLASTYPESA_LOCALIZATION_SKIP_SURFACE_MAP === '1') {
    verdict.phases.push({ id: 'surface-map', status: 'skipped' });
  } else {
    const code = runNode('scripts/plastypesa/localization/surface-map.mjs');
    verdict.phases.push({ id: 'surface-map', status: code === 0 ? 'passed' : 'failed', exitCode: code });
    if (code !== 0) anyFailed = true;
  }

  if (process.env.PLASTYPESA_LOCALIZATION_SKIP_STATIC === '1') {
    verdict.phases.push({ id: 'static-audit', status: 'skipped' });
  } else {
    const code = runNode('scripts/plastypesa/localization/static-audit.mjs');
    verdict.phases.push({ id: 'static-audit', status: code === 0 ? 'passed' : 'failed', exitCode: code });
    if (code !== 0) anyFailed = true;
  }

  if (process.env.PLASTYPESA_LOCALIZATION_SKIP_WEB === '1') {
    verdict.phases.push({ id: 'web-audit', status: 'skipped' });
  } else {
    const code = runNode('scripts/plastypesa/localization/web-audit.mjs');
    verdict.phases.push({ id: 'web-audit', status: code === 0 ? 'passed' : 'failed', exitCode: code });
    if (code !== 0) anyFailed = true;
  }

  const mobileRoot = defaultMobileRoot();
  const deviceId = getAdbDevice();
  if (process.env.PLASTYPESA_LOCALIZATION_SKIP_MOBILE === '1') {
    verdict.phases.push({ id: 'mobile-audit', status: 'skipped' });
  } else if (!deviceId) {
    verdict.phases.push({
      id: 'mobile-audit',
      status: 'skipped',
      reason: 'no adb device in "device" state',
    });
  } else {
    const visibleMobileMode =
      process.env.PLASTYPESA_LOCALIZATION_MOBILE_VISIBLE === '0' ? 'false' : 'true';
    const mobileRun = await runShellCapture(
      `flutter test --no-pub integration_test/localization_audit_test.dart -d ${deviceId} --dart-define=INTEGRATION_TEST=true --dart-define=LOCALIZATION_VISIBLE_MODE=${visibleMobileMode}`,
      mobileRoot,
      {},
      { successPattern: 'All tests passed!' },
    );
    const sawFailureBanner = mobileRun.output.includes('Some tests failed.');
    const code = sawFailureBanner ? 1 : mobileRun.code;
    const phase = {
      id: 'mobile-audit',
      status: code === 0 ? 'passed' : 'failed',
      exitCode: code,
      deviceId,
    };
    if (process.env.PLASTYPESA_LOCALIZATION_CAPTURE_FINAL_ADB !== '0') {
      phase.adbArtifacts = captureAdbArtifacts('mobile-final-state', outDir);
    }
    verdict.phases.push(phase);
    if (code !== 0) anyFailed = true;
  }

  if (process.env.PLASTYPESA_LOCALIZATION_SKIP_MOBILE_ADB_VISIBLE === '1') {
    verdict.phases.push({ id: 'mobile-adb-visible', status: 'skipped' });
  } else if (!deviceId) {
    verdict.phases.push({
      id: 'mobile-adb-visible',
      status: 'skipped',
      reason: 'no adb device in "device" state',
    });
  } else {
    const code = runNode('scripts/plastypesa/localization/mobile-visible-adb.mjs');
    verdict.phases.push({
      id: 'mobile-adb-visible',
      status: code === 0 ? 'passed' : 'failed',
      exitCode: code,
      deviceId,
    });
    if (code !== 0) anyFailed = true;
  }

  if (process.env.PLASTYPESA_LOCALIZATION_ENABLE_ADMIN_APP_REFLECTION !== '1') {
    verdict.phases.push({
      id: 'admin-app-reflection',
      status: 'skipped',
      reason: 'enable with PLASTYPESA_LOCALIZATION_ENABLE_ADMIN_APP_REFLECTION=1',
    });
  } else if (!deviceId) {
    verdict.phases.push({
      id: 'admin-app-reflection',
      status: 'skipped',
      reason: 'no adb device in "device" state',
    });
  } else {
    const code = runNode('scripts/plastypesa/plastypesa-admin-app-reflection.mjs', {
      PLASTYPESA_ADMIN_APP_REFLECTION_ALLOW_MUTATION:
        process.env.PLASTYPESA_ADMIN_APP_REFLECTION_ALLOW_MUTATION || '1',
    });
    verdict.phases.push({
      id: 'admin-app-reflection',
      status: code === 0 ? 'passed' : 'failed',
      exitCode: code,
      deviceId,
    });
    if (code !== 0) anyFailed = true;
  }

  if (process.env.PLASTYPESA_LOCALIZATION_SKIP_OCR === '1') {
    verdict.phases.push({ id: 'ocr-audit', status: 'skipped' });
  } else {
    const code = runNode('scripts/plastypesa/localization/ocr-audit.mjs');
    verdict.phases.push({
      id: 'ocr-audit',
      status: code === 0 ? 'passed' : 'failed',
      exitCode: code,
    });
    if (code !== 0) anyFailed = true;
  }

  if (process.env.PLASTYPESA_LOCALIZATION_SKIP_EVIDENCE_VERDICT === '1') {
    verdict.phases.push({ id: 'evidence-verdict', status: 'skipped' });
  } else {
    const code = runNode('scripts/plastypesa/localization/evidence-verdict.mjs');
    verdict.phases.push({
      id: 'evidence-verdict',
      status: code === 0 ? 'passed' : 'failed',
      exitCode: code,
    });
    if (code !== 0) anyFailed = true;
  }

  verdict.overall = anyFailed ? 'FAIL' : 'PASS';
  verdict.finishedAt = new Date().toISOString();

  const stamp = startedAt.replace(/[:.]/g, '-');
  writeJson(resolve(outDir, `verdict-${stamp}.json`), verdict);
  writeText(resolve(outDir, `verdict-${stamp}.md`), renderMarkdown(verdict));

  console.log(`[plastypesa-localization] Verdict written to ${outDir}`);
  process.exit(verdict.overall === 'PASS' ? 0 : 1);
}

await main();
