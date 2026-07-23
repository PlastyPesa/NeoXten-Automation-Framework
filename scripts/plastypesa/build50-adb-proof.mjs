#!/usr/bin/env node
/**
 * BUILD 50 — ADB proof (EN + RO): Learn daily tip, read progress, eco discussions copy,
 * community create-post screen (@ hint), Romanian locale spot-check.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { loadMobileAppUserCredentials } from './credential-registry.mjs';
import {
  adb,
  dumpUiHierarchy,
  parseUiNodes,
  tapText,
  tapBounds,
  typeText,
  sleep,
  getAdbDevice,
  swipeUp,
  findNodeByText,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';
const OUT = path.join(process.cwd(), '.neoxten-out', 'build50-adb-proof');
const results = [];

function ensureOut() {
  fs.mkdirSync(OUT, { recursive: true });
}

function decodeXmlEntities(value) {
  return (value || '')
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function allVisibleText(xml) {
  return parseUiNodes(xml)
    .map((n) => decodeXmlEntities([n.text, n.contentDesc].filter(Boolean).join(' ')))
    .join('\n');
}

function bottomNavButtons(nodes) {
  let maxBottom = 0;
  for (const n of nodes) {
    if (n.bounds?.bottom > maxBottom) maxBottom = n.bounds.bottom;
  }
  if (maxBottom <= 0) return [];
  const minTop = maxBottom - 220;
  return nodes
    .filter(
      (n) =>
        n.packageName === PKG &&
        n.clickable &&
        n.bounds &&
        n.bounds.top >= minTop &&
        /^(Home|Learn|Community|Profile|Acasă|Învățare|Comunitate|Profil)/i.test(
          (n.contentDesc || n.text || '').split('\n')[0].trim(),
        ),
    )
    .sort((a, b) => a.bounds.left - b.bounds.left);
}

function onMainShell(nodes) {
  return bottomNavButtons(nodes).length >= 4;
}

function screenshot(label) {
  const file = path.join(OUT, `${label}.png`);
  const r = spawnSync('adb', ['-s', getAdbDevice(), 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.stdout?.length) fs.writeFileSync(file, r.stdout);
  return file;
}

function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function tapIf(patterns, opts = {}) {
  return tapText(patterns, {
    deviceId: getAdbDevice(),
    timeoutMs: opts.timeoutMs ?? 5000,
    label: opts.label ?? 'tap',
    packageName: PKG,
    afterMs: opts.afterMs ?? 1200,
  });
}

async function navigateToMainShell(maxBack = 6) {
  for (let i = 0; i < maxBack; i += 1) {
    const dump = dumpUiHierarchy(getAdbDevice(), `b50-shell-nav-${i}`);
    if (onMainShell(parseUiNodes(dump.xml))) return true;
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
    await sleep(900);
  }
  const finalDump = dumpUiHierarchy(getAdbDevice(), 'b50-shell-nav-final');
  return onMainShell(parseUiNodes(finalDump.xml));
}

async function dismissOverlays() {
  await tapIf(['Got it', 'OK', 'Continue', 'Dismiss', 'Show me how'], { label: 'kenya-intro' });
  const dump = dumpUiHierarchy(getAdbDevice(), 'b50-overlays');
  const nodes = parseUiNodes(dump.xml);
  const updateBanner = nodes.find(
    (n) =>
      n.packageName === PKG &&
      n.clickable &&
      /update plastypesa|google play/i.test(n.contentDesc || n.text || ''),
  );
  if (updateBanner?.bounds) {
    const closeBtn = nodes.find(
      (n) =>
        n.packageName === PKG &&
        n.clickable &&
        n.bounds &&
        n.bounds.top >= 520 &&
        n.bounds.top <= 620 &&
        n.bounds.left >= 600 &&
        !n.contentDesc &&
        !n.text,
    );
    if (closeBtn?.bounds) {
      tapBounds(closeBtn.bounds, { deviceId: getAdbDevice() });
      await sleep(800);
    } else {
      adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
      await sleep(600);
    }
  }
}

async function loginIfNeeded(mobile) {
  let dump = dumpUiHierarchy(getAdbDevice(), 'b50-login-probe');
  if (onMainShell(parseUiNodes(dump.xml))) return true;

  await tapIf(['Continue'], { label: 'language-continue' });
  await sleep(800);
  for (let i = 0; i < 2; i += 1) {
    if (!(await tapIf(['Next', 'Următorul'], { label: `onboarding-${i}` }))) break;
    await sleep(900);
  }
  await tapIf(['Get Started', 'Get started', 'Începe'], { label: 'get-started' });
  await sleep(1500);

  dump = dumpUiHierarchy(getAdbDevice(), 'b50-login-form');
  const nodes = parseUiNodes(dump.xml);
  const emailEdit = nodes.find(
    (n) => n.className === 'android.widget.EditText' && !n.password && n.bounds,
  );
  if (!emailEdit?.bounds) return false;
  tapBounds(emailEdit.bounds, { deviceId: getAdbDevice() });
  await sleep(300);
  await typeText(mobile.email, { deviceId: getAdbDevice(), perCharacter: true, charDelayMs: 25 });
  await sleep(500);
  const pwdEdit = nodes.find((n) => n.className === 'android.widget.EditText' && n.password);
  if (pwdEdit?.bounds) tapBounds(pwdEdit.bounds, { deviceId: getAdbDevice() });
  await typeText(mobile.password, { deviceId: getAdbDevice(), perCharacter: true, charDelayMs: 30 });
  await sleep(400);
  adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
  await swipeUp({ deviceId: getAdbDevice() });
  await tapIf(['Login', 'Log in', 'Conectează-te'], { label: 'login-btn' });
  await sleep(7000);
  await dismissOverlays();
  return onMainShell(parseUiNodes(dumpUiHierarchy(getAdbDevice(), 'b50-post-login').xml));
}

async function openTab(labelPatterns) {
  const tapped =
    (await tapIf(labelPatterns, { label: `tab-${labelPatterns[0]}`, timeoutMs: 8000 })) ||
    (await tapIf(
      labelPatterns.map((p) => `${p}\n${p}`),
      { label: `tab-desc-${labelPatterns[0]}`, timeoutMs: 4000 },
    ));
  if (!tapped) {
    const dump = dumpUiHierarchy(getAdbDevice(), `b50-tab-fallback-${labelPatterns[0]}`);
    const btns = bottomNavButtons(parseUiNodes(dump.xml));
    const idxMap = { learn: 1, community: 2, profile: 3, home: 0 };
    const key = labelPatterns[0].toLowerCase();
    const idx = idxMap[key.includes('learn') || key.includes('înva') ? 'learn' : key.includes('comm') || key.includes('comun') ? 'community' : key.includes('prof') ? 'profile' : 'home'];
    if (btns[idx]?.bounds) {
      tapBounds(btns[idx].bounds, { deviceId: getAdbDevice() });
      await sleep(2000);
      return true;
    }
    return false;
  }
  await sleep(2000);
  return true;
}

async function switchLocale(localePatterns, savePatterns = ['Save', 'Salvează', 'Apply', 'Continue', 'Done']) {
  await openTab(['Profile', 'Profil']);
  await sleep(1200);
  await swipeUp({ deviceId: getAdbDevice() });
  await sleep(500);
  await tapIf(['Language', 'Limba', 'App language', 'Change language'], { label: 'language-menu' });
  await sleep(1500);
  const picked = await tapIf(localePatterns, { label: 'pick-locale', timeoutMs: 8000 });
  if (picked) {
    await tapIf(savePatterns, { label: 'language-save' });
    await sleep(2500);
  }
  return picked;
}

async function ensureEnglish() {
  const ok = await switchLocale(['English', 'Engleză', 'EN', 'en']);
  record('English locale ensured', ok, ok ? '' : 'could not select English');
  await dismissOverlays();
  return ok;
}

async function verifyLearnEn() {
  await openTab(['Learn', 'Învățare']);
  await dismissOverlays();
  await sleep(1500);
  const dump = dumpUiHierarchy(getAdbDevice(), 'b50-learn-en');
  const text = allVisibleText(dump.xml);
  screenshot('learn-en');
  record('learn daily tip card (EN)', /daily tip/i.test(text));
  record(
    'learn read progress chip (EN)',
    /articles earned today|of 5 articles|pts each/i.test(text),
  );
  record(
    'learn article earn copy (EN)',
    /up to five articles pay|read to the end|100 pts|articles earned today/i.test(text),
  );
}

async function verifyLeaderboardColdOpenEn() {
  await openTab(['Home', 'Acasă']);
  await dismissOverlays();
  await sleep(1200);
  const homeDump = dumpUiHierarchy(getAdbDevice(), 'b50-home-before-lb');
  const homeText = allVisibleText(homeDump.xml);
  const opened = await tapIf(
    ['See top 10 this week', 'See top 10', 'Top 10 this week'],
    { label: 'see-top10', timeoutMs: 8000 },
  );
  record('home see top 10 button (EN)', opened || /see top 10/i.test(homeText));
  if (!opened) return;
  await sleep(3500);
  const lbDump = dumpUiHierarchy(getAdbDevice(), 'b50-leaderboard-cold');
  const lbText = allVisibleText(lbDump.xml);
  screenshot('leaderboard-cold-en');
  const hasRankData =
    /\b[1-9]\b/.test(lbText) &&
    (/Weekly|Lifetime|Leaderboard|Resets in|KES|pts|points/i.test(lbText));
  const emptyOnly =
    /no leaderboard data|leaderboard_no_data|no data yet/i.test(lbText) &&
    !hasRankData;
  record(
    'leaderboard cold open shows rank data (EN)',
    hasRankData && !emptyOnly,
    emptyOnly ? 'empty state without refresh' : '',
  );
  adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
  await sleep(1200);
}

async function verifyCommunityEn() {
  await navigateToMainShell();
  await openTab(['Community', 'Comunitate']);
  await dismissOverlays();
  await sleep(2000);
  const dump = dumpUiHierarchy(getAdbDevice(), 'b50-community-en');
  const text = allVisibleText(dump.xml);
  screenshot('community-en');
  record(
    'eco discussions subtitle (EN)',
    /eco discussions|discuții eco|post live instantly|earn points/i.test(text),
  );
  const openedCreate =
    (await tapIf(['New post', 'Postare nouă'], {
      label: 'create-post',
      timeoutMs: 8000,
    })) ||
    (await tapIf(['community_new_post', 'New Post'], {
      label: 'create-post-fallback',
      timeoutMs: 4000,
    }));
  if (openedCreate) {
    await sleep(2000);
    const createDump = dumpUiHierarchy(getAdbDevice(), 'b50-create-post-en');
    const createText = allVisibleText(createDump.xml);
    screenshot('create-post-en');
    record(
      'create post earn hint (EN)',
      /earn points|community rules|share a tip/i.test(createText),
    );
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
    await sleep(800);
  } else {
    record('create post screen reachable', false, 'could not open New post');
  }
}

async function verifyLearnRo() {
  await openTab(['Learn', 'Învățare']);
  await dismissOverlays();
  await sleep(1500);
  const dump = dumpUiHierarchy(getAdbDevice(), 'b50-learn-ro');
  const text = allVisibleText(dump.xml);
  screenshot('learn-ro');
  const hasRo =
    (/sfatul zilei|sfat zilnic|articole câștigate|câștigate azi|învă/i.test(text) ||
      /discuții eco|puncte/i.test(text)) &&
    !/become a recycling expert/i.test(text);
  record('learn screen Romanian strings', hasRo, hasRo ? '' : text.slice(0, 180));
}

function writeReport(exitCode) {
  const failed = results.filter((r) => !r.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    deviceId: getAdbDevice(),
    build: 50,
    total: results.length,
    pass: results.length - failed.length,
    fail: failed.length,
    results,
    outDir: OUT,
  };
  const reportPath = path.join(OUT, `build50-adb-proof-${Date.now()}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n[build50-adb] Report: ${reportPath}`);
  console.log(`[build50-adb] ${report.pass} pass, ${report.fail} fail`);
  process.exit(exitCode);
}

async function main() {
  bootstrapPlastyPesaEnv();
  ensureOut();
  const deviceId = getAdbDevice();
  if (!deviceId) {
    console.error('No authorized ADB device.');
    process.exit(2);
  }

  const mobile = loadMobileAppUserCredentials();
  spawnSync('adb', ['-s', deviceId, 'shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'], {
    stdio: 'inherit',
  });
  await sleep(6000);

  let onShell = await navigateToMainShell();
  if (!onShell) onShell = await loginIfNeeded(mobile);
  if (!onShell) onShell = await navigateToMainShell();
  record('main shell reached', onShell);
  if (!onShell) {
    await dismissOverlays();
    onShell = await navigateToMainShell();
    if (!onShell) {
      screenshot('not-on-shell');
      writeReport(2);
      return;
    }
    record('main shell after back navigation', true);
  }

  await dismissOverlays();
  const enOk = await ensureEnglish();
  if (!enOk) {
    writeReport(2);
    return;
  }

  await verifyLearnEn();
  await verifyLeaderboardColdOpenEn();
  await verifyCommunityEn();

  const roOk = await switchLocale(['Română', 'Romanian', 'RO', 'ro', 'Romana']);
  record('switched to Romanian locale', roOk);
  if (roOk) await verifyLearnRo();

  writeReport(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((err) => {
  console.error('[build50-adb]', err);
  process.exit(1);
});
