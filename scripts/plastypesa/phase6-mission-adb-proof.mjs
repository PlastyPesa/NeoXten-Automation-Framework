#!/usr/bin/env node
/**
 * Phase 6 mission campaign — EN ADB proof (community strip + Eco Guardian rules + referral boost).
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
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';
const OUT = path.join(process.cwd(), '.neoxten-out', 'phase6-mission-proof');
const results = [];

function ensureOut() {
  fs.mkdirSync(OUT, { recursive: true });
}

function bottomNavButtons(nodes) {
  let maxBottom = 0;
  for (const n of nodes) {
    if (n.bounds?.bottom > maxBottom) maxBottom = n.bounds.bottom;
  }
  if (maxBottom <= 0) return [];
  const minTop = maxBottom - 200;
  return nodes
    .filter(
      (n) =>
        n.packageName === PKG &&
        n.clickable &&
        n.bounds &&
        n.bounds.top >= minTop &&
        /^(Home|Learn|Scan|Community|Profile)(?:&#10;|\n|$)/i.test(
          n.text || n.contentDesc || '',
        ),
    )
    .sort((a, b) => a.bounds.left - b.bounds.left);
}

function onMainShell(nodes) {
  return bottomNavButtons(nodes).length >= 5;
}

function allVisibleText(xml) {
  return parseUiNodes(xml)
    .map((n) => [n.text, n.contentDesc].filter(Boolean).join(' '))
    .join('\n');
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
    timeoutMs: opts.timeoutMs ?? 4000,
    label: opts.label ?? 'tap',
    packageName: PKG,
  });
}

async function dismissKenyaIntro() {
  await tapIf(['Got it', 'OK', 'Continue', 'Dismiss'], { label: 'kenya-intro' });
  await sleep(800);
}

async function dismissHomeCoachmarks() {
  const dump = dumpUiHierarchy(getAdbDevice(), 'p6-coachmark');
  const nodes = parseUiNodes(dump.xml);
  const close = nodes.find(
    (n) =>
      n.packageName === PKG &&
      n.clickable &&
      n.bounds &&
      n.bounds.top < 220 &&
      n.bounds.right > 600 &&
      !n.contentDesc &&
      !n.text,
  );
  if (close?.bounds) {
    tapBounds(close.bounds, { deviceId: getAdbDevice() });
    await sleep(700);
  }
}

async function completeFirstRunShell() {
  await tapIf(['Continue'], { label: 'language-continue' });
  await sleep(800);
  await tapIf(['Save & continue', 'Save and continue'], { label: 'privacy-save' });
  await sleep(1200);
  for (let i = 0; i < 2; i += 1) {
    if (!(await tapIf(['Next'], { label: `onboarding-next-${i}` }))) break;
    await sleep(900);
  }
  await tapIf(['Get Started', 'Get started'], { label: 'get-started' });
  await sleep(1500);
}

async function loginIfNeeded(mobile) {
  let dump = dumpUiHierarchy(getAdbDevice(), 'p6-login-probe');
  if (onMainShell(parseUiNodes(dump.xml))) return true;

  await tapIf(['Enter Email', 'Email', 'Welcome'], { label: 'email-tap' });
  await sleep(400);
  dump = dumpUiHierarchy(getAdbDevice(), 'p6-email-field');
  let nodes = parseUiNodes(dump.xml);
  const emailEdit = nodes.find(
    (n) => n.className === 'android.widget.EditText' && !n.password && n.bounds,
  );
  if (!emailEdit?.bounds) return false;
  tapBounds(emailEdit.bounds, { deviceId: getAdbDevice() });
  await sleep(300);
  await typeText(mobile.email, { deviceId: getAdbDevice(), perCharacter: true, charDelayMs: 25 });
  await sleep(500);
  await tapIf(['Enter Password', 'Password'], { label: 'password-tap' });
  await sleep(300);
  dump = dumpUiHierarchy(getAdbDevice(), 'p6-password-field');
  nodes = parseUiNodes(dump.xml);
  const pwdEdit = nodes.find((n) => n.className === 'android.widget.EditText' && n.password);
  if (pwdEdit?.bounds) tapBounds(pwdEdit.bounds, { deviceId: getAdbDevice() });
  await typeText(mobile.password, { deviceId: getAdbDevice(), perCharacter: true, charDelayMs: 30 });
  await sleep(400);
  adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
  await sleep(500);
  await swipeUp({ deviceId: getAdbDevice() });
  await tapIf(['Login', 'Log in', 'Sign In'], { label: 'login-btn' });
  await sleep(6000);
  return onMainShell(parseUiNodes(dumpUiHierarchy(getAdbDevice(), 'p6-post-login').xml));
}

async function ensureMainShell(mobile) {
  let dump = dumpUiHierarchy(getAdbDevice(), 'p6-shell-probe');
  if (onMainShell(parseUiNodes(dump.xml))) {
    await dismissKenyaIntro();
    await dismissHomeCoachmarks();
    return true;
  }
  await completeFirstRunShell();
  if (!(await loginIfNeeded(mobile))) return false;
  await dismissKenyaIntro();
  await dismissHomeCoachmarks();
  return onMainShell(parseUiNodes(dumpUiHierarchy(getAdbDevice(), 'p6-shell-after-login').xml));
}

async function goHome() {
  const dump = dumpUiHierarchy(getAdbDevice(), 'p6-home-tab');
  const btns = bottomNavButtons(parseUiNodes(dump.xml));
  if (btns[0]?.bounds) {
    tapBounds(btns[0].bounds, { deviceId: getAdbDevice() });
    await sleep(1500);
  }
}

async function scrollHomeDown(steps = 4) {
  for (let i = 0; i < steps; i += 1) {
    await swipeUp({ deviceId: getAdbDevice() });
    await sleep(500);
  }
}

async function scrollHomeUp(steps = 3) {
  for (let i = 0; i < steps; i += 1) {
    adb(['shell', 'input', 'swipe', '360', '400', '360', '1200', '350'], {
      deviceId: getAdbDevice(),
    });
    await sleep(400);
  }
}

async function verifyHomeMissionStrip() {
  await goHome();
  await scrollHomeUp(3);
  await sleep(1200);
  let dump = dumpUiHierarchy(getAdbDevice(), 'p6-home-top');
  let text = allVisibleText(dump.xml);
  screenshot('home-top');

  const hasStripTitle = /building this together/i.test(text);
  record('community strip title visible', hasStripTitle);

  await scrollHomeDown(2);
  dump = dumpUiHierarchy(getAdbDevice(), 'p6-home-mission');
  text = allVisibleText(dump.xml);
  screenshot('home-mission');

  const hasKenyaMembers = /learners in Kenya/i.test(text);
  const hasEcoLink = /First Eco Guardian/i.test(text);
  const hasFoundingCard = /125,000|125000/i.test(text) && /30 approved sorts/i.test(text);
  record('community Kenya member counter', hasKenyaMembers, hasKenyaMembers ? '' : 'missing learners in Kenya');
  record('First Eco Guardian link/card', hasEcoLink || hasFoundingCard);

  if (hasEcoLink) {
    await tapIf(['First Eco Guardian'], { label: 'open-eco-guardian' });
    await sleep(2500);
    dump = dumpUiHierarchy(getAdbDevice(), 'p6-eco-rules');
    text = allVisibleText(dump.xml);
    screenshot('eco-guardian-rules');
    record('rules screen headline', /First Eco Guardian/i.test(text));
    record('rules screen 125k threshold', /125,?000/i.test(text));
    record('rules screen 30 sorts gate', /\b30\b/.test(text) && /approved sort/i.test(text));
    record('rules progress section', /Your progress|Lifetime points|Approved sorts/i.test(text));
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
    await sleep(1200);
  } else {
    record('rules screen open', false, 'could not find First Eco Guardian tap target');
  }
}

async function verifyReferralBoost() {
  await goHome();
  await scrollHomeUp(2);
  await scrollHomeDown(5);
  let dump = dumpUiHierarchy(getAdbDevice(), 'p6-earn-hub');
  let text = allVisibleText(dump.xml);
  screenshot('earn-hub');

  const boostVisible = /Boost \+2,?000|Boost \+2000/i.test(text);
  record('referral boost chip on earn hub', boostVisible, boostVisible ? '' : 'scroll/tap Invite tile if needed');

  const openedInvite =
    (await tapIf(['Invite friends', 'Invite a friend', 'Refer friends'], { label: 'invite-tile' })) ||
    /Invite/i.test(text);
  if (openedInvite) {
    await sleep(2500);
    dump = dumpUiHierarchy(getAdbDevice(), 'p6-referral-screen');
    text = allVisibleText(dump.xml);
    screenshot('referral-screen');
    record('referral screen opened', /referral|invite|share/i.test(text));
    record('referral boost banner', /2,?000|boost/i.test(text));
    record('referral history entry', /Referral history|friends joined|No friends joined yet/i.test(text));
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
    await sleep(1000);
  }
}

async function verifyAnnouncementBanner() {
  await goHome();
  await scrollHomeUp(4);
  await sleep(1500);
  const dump = dumpUiHierarchy(getAdbDevice(), 'p6-announcement');
  const text = allVisibleText(dump.xml);
  screenshot('home-announcement');
  const hasDay1 =
    /Eco Guardian|First Eco|founding|Kenya|community mission|We.?re building/i.test(text);
  record('day-1 announcement or mission banner visible', hasDay1, hasDay1 ? '' : 'banner may be dismissed or below fold');
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
  await sleep(8000);

  const onShell = await ensureMainShell(mobile);
  record('main shell reached', onShell);
  if (!onShell) {
    screenshot('not-on-shell');
    writeReport(2);
    return;
  }

  await verifyAnnouncementBanner();
  await verifyHomeMissionStrip();
  await verifyReferralBoost();

  writeReport(results.some((r) => !r.pass) ? 1 : 0);
}

function writeReport(exitCode) {
  const failed = results.filter((r) => !r.pass);
  const report = {
    generatedAt: new Date().toISOString(),
    deviceId: getAdbDevice(),
    total: results.length,
    pass: results.length - failed.length,
    fail: failed.length,
    results,
    outDir: OUT,
  };
  const reportPath = path.join(OUT, `phase6-mission-proof-${Date.now()}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n[phase6-mission] Report: ${reportPath}`);
  console.log(`[phase6-mission] ${report.pass} pass, ${report.fail} fail`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[phase6-mission]', err);
  process.exit(1);
});
