#!/usr/bin/env node
/**
 * Post-P8 launch certification: real-device visible UI snapshot.
 *
 * This does not replace manual judgement, but it captures the current Flutter
 * UI hierarchy, bottom navigation walk, and visible text evidence on the
 * connected ADB device. It fails fast if ADB is offline.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  dumpUiHierarchy,
  getAdbDevice,
  parseUiNodes,
  sleep,
  tapBounds,
  tapText,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';

function outDir() {
  const dir = resolve(process.cwd(), '.neoxten-out');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function bottomNavButtons(nodes) {
  let maxBottom = 0;
  for (const node of nodes) {
    if (node.bounds?.bottom > maxBottom) maxBottom = node.bounds.bottom;
  }
  const minTop = maxBottom - 220;
  return nodes
    .filter(
      (node) =>
        node.packageName === PKG &&
        node.className === 'android.widget.Button' &&
        node.clickable &&
        node.bounds &&
        node.bounds.top >= minTop,
    )
    .sort((a, b) => a.bounds.left - b.bounds.left);
}

function visibleText(nodes) {
  return nodes
    .map((node) => node.text || node.contentDesc || '')
    .map((text) => text.trim())
    .filter((text) => text.length >= 2)
    .filter((text, index, arr) => arr.indexOf(text) === index)
    .slice(0, 80);
}

const NAV_LABELS = new Set([
  'Home',
  'Learn',
  'Quizzes',
  'Leaderboard',
  'Activity',
  'Community',
  'Profile',
]);

const EXPECTED_TAB_PATTERNS = [
  [/PlastyPesa|Eco actions|Sort Plastics by Grade|Top 5 weekly reward/i],
  [/Learn|Daily tip|Scan\s*&\s*Learn|Sorting Academy|recycling expert/i],
  [/Daily Quiz|Previous quizzes|Eco Quiz/i],
  [/Leaderboard|weekly top 5|This week's rewards|Lifetime/i],
  [/Activity|Points Breakdown|History|Badges/i],
  [/Community|Share with the community|post|feed/i],
  [/Profile|Account|Settings|Privacy|Legal|Lunar/i],
];

function bodyText(text) {
  return text.filter((entry) => {
    const normalized = entry
      .replace(/&#10;/g, '\n')
      .split('\n')
      .map((part) => part.trim())
      .filter(Boolean);
    return !normalized.every((part) => NAV_LABELS.has(part));
  });
}

function launchApp(deviceId) {
  spawnSync(
    'adb',
    ['-s', deviceId, 'shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'],
    { stdio: 'inherit' },
  );
}

function screencap(deviceId, label) {
  const path = resolve(outDir(), `plastypesa-${label}-${Date.now()}.png`);
  const result = spawnSync('adb', ['-s', deviceId, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 15 * 1024 * 1024,
  });
  if (result.status === 0 && result.stdout?.length) {
    writeFileSync(path, result.stdout);
    return path;
  }
  return null;
}

async function ensureMainShell(deviceId) {
  let dump = dumpUiHierarchy(deviceId, 'launch-mobile-preflight');
  let nodes = parseUiNodes(dump.xml);
  if (bottomNavButtons(nodes).length >= 5) return { dump, nodes, onShell: true };

  if (/Choose your language|Continue|Continuă|Continuar|Weiter/.test(dump.xml)) {
    await tapText(['Continue', 'Continuă', 'Continuar', 'Weiter'], {
      deviceId,
      timeoutMs: 8000,
      label: 'launch-language-continue',
      packageName: PKG,
    });
    await sleep(1500);
  }

  for (let i = 0; i < 3; i += 1) {
    const tapped = await tapText(
      ['Next', 'Următorul', 'Weiter', 'Siguiente', 'Suivant', 'Avanti', 'Próximo', 'Get Started', 'Get started', 'Începe', 'Skip'],
      { deviceId, timeoutMs: 3000, label: `launch-onboarding-${i}`, packageName: PKG },
    );
    if (!tapped) break;
    await sleep(1200);
  }

  dump = dumpUiHierarchy(deviceId, 'launch-mobile-shell-check');
  nodes = parseUiNodes(dump.xml);
  return { dump, nodes, onShell: bottomNavButtons(nodes).length >= 5 };
}

async function main() {
  const deviceId = getAdbDevice();
  if (!deviceId) {
    console.error('[launch-mobile] No authorized ADB device.');
    process.exit(2);
  }

  launchApp(deviceId);
  await sleep(9000);
  const preflight = await ensureMainShell(deviceId);
  const nav = bottomNavButtons(preflight.nodes);
  const results = [];
  const screenshots = [];

  if (nav.length < 5) {
    const text = visibleText(preflight.nodes);
    const shot = screencap(deviceId, 'not-on-shell');
    if (shot) screenshots.push(shot);
    const report = {
      generatedAt: new Date().toISOString(),
      deviceId,
      pass: 0,
      fail: 1,
      reason: 'Not on main shell; login or onboarding is required before full walk.',
      visibleText: text,
      dump: preflight.dump.localPath,
      screenshots,
    };
    const path = resolve(outDir(), `plastypesa-launch-mobile-${Date.now()}.json`);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error(`[launch-mobile] Not on main shell. Report: ${path}`);
    process.exit(2);
  }

  for (let i = 0; i < nav.length; i += 1) {
    const button = nav[i];
    tapBounds(button.bounds, { deviceId });
    await sleep(3000);
    const dump = dumpUiHierarchy(deviceId, `launch-mobile-tab-${i}`);
    const nodes = parseUiNodes(dump.xml);
    const text = visibleText(nodes);
    const shot = screencap(deviceId, `tab-${i}`);
    if (shot) screenshots.push(shot);
    const errors = [];
    const nonNavText = bodyText(text);
    const joinedBodyText = nonNavText.join('\n');
    if (text.length < 4) errors.push('too little visible text');
    if (nonNavText.length < 1) errors.push('no visible body content');
    if (!EXPECTED_TAB_PATTERNS[i]?.some((pattern) => pattern.test(joinedBodyText))) {
      errors.push('expected tab content not visible');
    }
    if (text.some((entry) => /exception|error|crash/i.test(entry))) errors.push('visible error text');
    results.push({
      tabIndex: i,
      button: button.text || button.contentDesc || '',
      bounds: button.bounds,
      pass: errors.length === 0,
      errors,
      dump: dump.localPath,
      screenshot: shot,
      visibleText: text,
      bodyText: nonNavText,
    });
    console.log(
      `  ${errors.length ? 'FAIL' : 'PASS'}  tab ${i} ${(button.text || button.contentDesc || '').slice(0, 40)}${errors.length ? ` — ${errors.join('; ')}` : ''}`,
    );
  }

  const failed = results.filter((entry) => !entry.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    deviceId,
    packageName: PKG,
    total: results.length,
    pass: results.length - failed.length,
    fail: failed.length,
    results,
    screenshots,
  };
  const path = resolve(outDir(), `plastypesa-launch-mobile-${Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[launch-mobile] Report: ${path}`);
  console.log(`[launch-mobile] ${report.pass} pass, ${report.fail} fail`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('[launch-mobile]', err);
  process.exit(1);
});
