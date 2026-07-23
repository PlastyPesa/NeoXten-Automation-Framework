#!/usr/bin/env node
/**
 * BUILD 50 device closeout — read banner, leaderboard cold open, community FAB, RO locale.
 * Owner may dismiss ads manually during long dwell waits.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { loadMobileAppUserCredentials } from './credential-registry.mjs';
import { getConfig, url } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';
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
  findNodeByResourceId,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';
const OUT = path.join(process.cwd(), '.neoxten-out', 'build50-device-closeout');
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
        n.bounds.top >= minTop,
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

async function escapeExternalApp() {
  for (let i = 0; i < 8; i += 1) {
    const dump = dumpUiHierarchy(getAdbDevice(), `closeout-escape-${i}`);
    const nodes = parseUiNodes(dump.xml);
    if (nodes.some((n) => n.packageName === PKG)) return true;
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
    await sleep(900);
  }
  const finalDump = dumpUiHierarchy(getAdbDevice(), 'closeout-escape-final');
  return parseUiNodes(finalDump.xml).some((n) => n.packageName === PKG);
}

async function dismissAnrDialog() {
  const dump = dumpUiHierarchy(getAdbDevice(), 'anr-check');
  const text = allVisibleText(dump.xml);
  if (/isn't responding|not responding|responding/i.test(text)) {
    await tapIf(['Wait', 'Așteaptă', 'Asteapta'], { label: 'anr-wait', timeoutMs: 2500 });
    await sleep(2000);
  }
}

async function dismissOverlays(opts = {}) {
  const allowBack = opts.allowBack !== false;
  await dismissAnrDialog();
  if (allowBack) {
    await escapeExternalApp();
  }
  await tapIf(['Got it', 'OK', 'Continue', 'Dismiss', 'Skip', 'Show me how'], {
    label: 'overlay',
    timeoutMs: 2000,
  });
  const dump = dumpUiHierarchy(getAdbDevice(), 'closeout-overlays');
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
    } else if (allowBack) {
      adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
      await sleep(600);
    }
  }
  // Never tap bare × / X here — the frosted earn banner uses the same glyph.
  await tapIf(['Close ad', 'Skip ad', 'No thanks'], {
    label: 'ad-close',
    timeoutMs: 1200,
  });
}

function isStackedRoute(text) {
  return /post\s*\n\s*0 comments|share a tip|articles|keep reading|verify otp|6-digit code/i.test(
    text,
  );
}

async function popStackedRoutes(maxBack = 10) {
  for (let i = 0; i < maxBack; i += 1) {
    const dump = dumpUiHierarchy(getAdbDevice(), `closeout-pop-${i}`);
    const text = allVisibleText(dump.xml);
    if (onMainShell(parseUiNodes(dump.xml)) && !isStackedRoute(text)) {
      return true;
    }
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
    await sleep(700);
  }
  const dump = dumpUiHierarchy(getAdbDevice(), 'closeout-pop-final');
  const text = allVisibleText(dump.xml);
  return onMainShell(parseUiNodes(dump.xml)) && !isStackedRoute(text);
}

async function relaunchApp() {
  const deviceId = getAdbDevice();
  adb(['shell', 'am', 'force-stop', 'com.android.chrome'], { deviceId });
  adb(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`], { deviceId });
  await sleep(12000);
  await dismissOverlays();
  return popStackedRoutes();
}

function detectEarnBanner(nodes, text) {
  const hasEarnBannerNode = nodes.some(
    (n) =>
      n.packageName === PKG &&
      (n.contentDesc === 'earn_banner' ||
        /earn_banner/i.test(n.contentDesc || '') ||
        /earn_banner/i.test(n.resourceId || '')),
  );
  const hasEarnBannerCopy =
    /\+\d+\s*points earned|puncte câștigate/i.test(text) &&
    /article read verified|keep going|reading|article|continuă|verified/i.test(text);
  return hasEarnBannerNode || hasEarnBannerCopy;
}

function isArticleReader(text) {
  return /articles|keep reading|learn_keep_reading|learn_points_earned|learn_daily_read_cap/i.test(
    text,
  );
}

async function loginIfNeeded(mobile) {
  await popStackedRoutes();
  await escapeExternalApp();
  for (let wait = 0; wait < 4; wait += 1) {
    await dismissOverlays();
    const probe = dumpUiHierarchy(getAdbDevice(), `closeout-login-wait-${wait}`);
    if (onMainShell(parseUiNodes(probe.xml))) return true;
    await sleep(3000);
  }

  await tapIf(['Continue'], { label: 'language-continue' });
  await sleep(800);
  await escapeExternalApp();
  for (let i = 0; i < 2; i += 1) {
    if (!(await tapIf(['Next', 'Următorul'], { label: `onboarding-${i}` }))) break;
    await sleep(900);
    await escapeExternalApp();
  }
  await tapIf(['Get Started', 'Get started', 'Începe'], { label: 'get-started' });
  await sleep(1500);
  await escapeExternalApp();
  await popStackedRoutes();

  const dump = dumpUiHierarchy(getAdbDevice(), 'closeout-login-form');
  const nodes = parseUiNodes(dump.xml);
  const text = allVisibleText(dump.xml);
  if (onMainShell(nodes)) return true;

  const pwdEdit = nodes.find(
    (n) => n.className === 'android.widget.EditText' && n.password && n.bounds,
  );
  const hasLoginCta = /login|log in|conectează-te|sign in/i.test(text);
  if (!pwdEdit?.bounds || !hasLoginCta) {
    return onMainShell(parseUiNodes(dumpUiHierarchy(getAdbDevice(), 'closeout-login-skip').xml));
  }

  const emailEdit = nodes.find(
    (n) => n.className === 'android.widget.EditText' && !n.password && n.bounds,
  );
  if (!emailEdit?.bounds) return false;
  tapBounds(emailEdit.bounds, { deviceId: getAdbDevice() });
  await sleep(300);
  await typeText(mobile.email, { deviceId: getAdbDevice(), perCharacter: true, charDelayMs: 25 });
  await sleep(500);
  tapBounds(pwdEdit.bounds, { deviceId: getAdbDevice() });
  await typeText(mobile.password, { deviceId: getAdbDevice(), perCharacter: true, charDelayMs: 30 });
  await sleep(400);
  adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
  await swipeUp({ deviceId: getAdbDevice() });
  await tapIf(['Login', 'Log in', 'Conectează-te'], { label: 'login-btn' });
  for (let i = 0; i < 6; i += 1) {
    await sleep(5000);
    await dismissOverlays();
    await escapeExternalApp();
    const probe = dumpUiHierarchy(getAdbDevice(), `closeout-post-login-${i}`);
    if (onMainShell(parseUiNodes(probe.xml))) return true;
    if (/verification code|verify|otp|6-digit/i.test(allVisibleText(probe.xml))) {
      console.warn('[closeout] Login blocked by OTP/2FA screen on device');
      return false;
    }
  }
  const finalDump = dumpUiHierarchy(getAdbDevice(), 'closeout-post-login-final');
  return onMainShell(parseUiNodes(finalDump.xml));
}

async function navigateToMainShell(maxBack = 8) {
  for (let i = 0; i < maxBack; i += 1) {
    await dismissOverlays();
    const dump = dumpUiHierarchy(getAdbDevice(), `closeout-nav-${i}`);
    if (onMainShell(parseUiNodes(dump.xml))) return true;
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
    await sleep(900);
  }
  const dump = dumpUiHierarchy(getAdbDevice(), 'closeout-nav-final');
  return onMainShell(parseUiNodes(dump.xml));
}

async function openTab(indexOrLabel) {
  if (typeof indexOrLabel === 'string') {
    const labels =
      indexOrLabel === 'community'
        ? ['Community', 'Comunitate']
        : indexOrLabel === 'profile'
          ? ['Profile', 'Profil']
          : indexOrLabel === 'learn'
            ? ['Learn', 'Învățare']
            : ['Home', 'Acasă'];
    if (await tapIf(labels, { label: `tab-${indexOrLabel}`, timeoutMs: 6000 })) {
      await sleep(2000);
      await dismissOverlays();
      return true;
    }
  }
  const dump = dumpUiHierarchy(getAdbDevice(), `closeout-tab-${indexOrLabel}`);
  const btns = bottomNavButtons(parseUiNodes(dump.xml));
  // Nav order: Home, Learn, [Scan], Community, Profile — skip center scan when 5 items.
  let idx = indexOrLabel;
  if (btns.length >= 5 && indexOrLabel >= 2) idx = indexOrLabel + 1;
  if (btns[idx]?.bounds) {
    tapBounds(btns[idx].bounds, { deviceId: getAdbDevice() });
    await sleep(2000);
    await dismissOverlays();
    return true;
  }
  return false;
}

async function getWeeklyPointsFromUi() {
  await openTab('home');
  await sleep(1500);
  const dump = dumpUiHierarchy(getAdbDevice(), 'closeout-home-points');
  const text = allVisibleText(dump.xml);
  const m = text.match(/(\d[\d.kM]*)\s*(pts|puncte|points)?/i);
  return m ? m[1] : null;
}

async function fetchReadRewardStatus(authHeaders, cfg) {
  const statusRes = await fetch(url(cfg, '/home/read-reward/status'), {
    headers: authHeaders,
  });
  const statusJson = await statusRes.json();
  return statusJson?.data || null;
}

async function fetchUnreadArticle(authHeaders, cfg) {
  const status = await fetchReadRewardStatus(authHeaders, cfg);
  const articles = status?.dailyArticles || [];
  const unread = articles.find(
    (a) => a.eligible && a.inRotation !== false && !a.earnedToday,
  );
  return { article: unread || null, status };
}

async function verifyLeaderboardColdOpen() {
  await navigateToMainShell();
  await openTab('home');
  await dismissOverlays();
  await sleep(1000);
  const opened = await tapIf(
    ['See top 10 this week', 'See top 10', 'Top 10 this week'],
    { label: 'see-top10', timeoutMs: 8000 },
  );
  record('leaderboard button opens screen', opened);
  if (!opened) return;
  await sleep(4000);
  await dismissOverlays();
  // Fullscreen ad can cover board — back once if external ad, then re-check.
  let dump = dumpUiHierarchy(getAdbDevice(), 'closeout-lb');
  let text = allVisibleText(dump.xml);
  if (/install|play store|plum|kaspersky/i.test(text) && !/weekly|lifetime/i.test(text)) {
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
    await sleep(1500);
    await dismissOverlays();
    dump = dumpUiHierarchy(getAdbDevice(), 'closeout-lb-retry');
    text = allVisibleText(dump.xml);
  }
  screenshot('leaderboard-cold');
  const hasData =
    (/Weekly|Lifetime|Resets in|KES/i.test(text) && /\b[1-9]\b/.test(text)) ||
    /Bob|Evans/i.test(text);
  record('leaderboard rank data on first open', hasData, hasData ? '' : text.slice(0, 120));
  adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
  await sleep(1200);
}

async function verifyReadAwardBanner(authHeaders, cfg) {
  await popStackedRoutes();
  await navigateToMainShell();

  const { article, status } = await fetchUnreadArticle(authHeaders, cfg);
  const remaining = status?.todayRemaining ?? 0;
  if (remaining <= 0) {
    record(
      'read award: unread article available',
      false,
      `daily cap reached (todayRemaining=${remaining})`,
    );
    record(
      'read award: frosted earn banner visible',
      false,
      'skipped — no read slot left today',
    );
    return;
  }
  if (!article?.title) {
    record('read award: unread article available', false, 'no eligible unread article in rotation');
    record('read award: frosted earn banner visible', false, 'skipped — no unread article');
    return;
  }
  record('read award: unread article available', true, article.title.slice(0, 60));

  await navigateToMainShell();
  await openTab('learn');
  await dismissOverlays();
  await sleep(1500);
  screenshot('learn-before-read');

  const titleWords = article.title.split(/\s+/).slice(0, 4);
  let opened = await tapIf(titleWords, {
    label: 'open-article',
    timeoutMs: 10000,
  });
  if (!opened) {
    for (let i = 0; i < 6; i += 1) {
      swipeUp({ deviceId: getAdbDevice(), startY: 0.78, endY: 0.22 });
      await sleep(600);
      if (await tapIf(titleWords, { label: `open-article-scroll-${i}`, timeoutMs: 2000 })) {
        opened = true;
        break;
      }
    }
  }
  const readerDump = dumpUiHierarchy(getAdbDevice(), 'closeout-reader-open');
  const readerText = allVisibleText(readerDump.xml);
  const readerOpen =
    isArticleReader(readerText) || titleWords.some((w) => readerText.includes(w));
  record('read award: article reader opened', readerOpen);
  if (!readerOpen) return;

  console.log('\n[closeout] Scrolling article — stay on reader; do not dismiss earn banner…');
  for (let i = 0; i < 16; i += 1) {
    swipeUp({ deviceId: getAdbDevice(), startY: 0.82, endY: 0.18 });
    await sleep(700);
    if (i % 4 === 3) {
      await dismissOverlays({ allowBack: false });
    }
  }

  console.log('[closeout] Waiting for read dwell + award (poll every 1.5s, up to 30s)…');
  let banner = false;
  let hasEarnBannerNode = false;
  let lastReaderText = readerText;
  for (let wait = 0; wait < 20; wait += 1) {
    await sleep(1500);
    const probeDump = dumpUiHierarchy(getAdbDevice(), `closeout-read-wait-${wait}`);
    const probeNodes = parseUiNodes(probeDump.xml);
    const probeText = allVisibleText(probeDump.xml);
    lastReaderText = probeText;
    hasEarnBannerNode = detectEarnBanner(probeNodes, probeText);
    banner = hasEarnBannerNode;
    if (banner) {
      screenshot('read-banner-visible');
      break;
    }
    if (!isArticleReader(probeText) && !titleWords.some((w) => probeText.includes(w))) {
      console.warn('[closeout] Left article reader during dwell wait — stopping early');
      break;
    }
  }

  if (!banner) {
    screenshot('read-after-award');
  }
  record(
    'read award: frosted earn banner visible',
    banner,
    banner
      ? hasEarnBannerNode
        ? 'earn_banner semantics'
        : 'copy match'
      : lastReaderText.slice(0, 200),
  );

  await popStackedRoutes();
}

async function verifyCommunityCreatePost() {
  await popStackedRoutes();
  await navigateToMainShell();
  await openTab('community');
  await dismissOverlays();
  await sleep(2000);
  screenshot('community-hub');

  let hubDump = dumpUiHierarchy(getAdbDevice(), 'closeout-community-hub');
  let hubText = allVisibleText(hubDump.xml);
  const onHub = /eco discussions|discuții eco|discussions éco|öko-diskussionen/i.test(
    hubText,
  );
  record('community hub visible', onHub, onHub ? '' : hubText.slice(0, 120));
  if (!onHub) return;

  let openedFeed = false;
  const hubNodes = parseUiNodes(hubDump.xml);
  const discussionsNode = findNodeByResourceId(hubNodes, 'community_eco_discussions', {
    packageName: PKG,
  });
  if (discussionsNode?.bounds) {
    tapBounds(discussionsNode.bounds, { deviceId: getAdbDevice() });
    await sleep(2500);
    openedFeed = true;
  }
  if (!openedFeed) {
    openedFeed = await tapIf(
      ['Eco Discussions', 'Discuții Eco', 'Discussions Éco', 'Öko-Diskussionen'],
      { label: 'open-eco-discussions', timeoutMs: 8000 },
    );
  }
  if (!openedFeed) {
    adb(['shell', 'input', 'swipe', '540', '900', '540', '1600', '350'], {
      deviceId: getAdbDevice(),
    });
    await sleep(800);
    openedFeed = await tapIf(
      ['Eco Discussions', 'Discuții Eco', 'Discussions Éco', 'Öko-Diskussionen'],
      { label: 'open-eco-discussions-scroll', timeoutMs: 4000 },
    );
  }
  if (openedFeed) {
    await sleep(2500);
    await dismissOverlays();
  }

  screenshot('community-feed');
  const dump = dumpUiHierarchy(getAdbDevice(), 'closeout-community');
  const nodes = parseUiNodes(dump.xml);
  const text = allVisibleText(dump.xml);
  record(
    'community eco discussions visible',
    /eco discussions|discuții eco|discuții/i.test(text) && !/post\s*\n\s*0 comments/i.test(text),
    text.slice(0, 120),
  );

  let fab = findNodeByResourceId(nodes, 'community_new_post', { packageName: PKG });
  if (!fab?.bounds) {
    fab = nodes.find(
      (n) =>
        n.packageName === PKG &&
        n.bounds &&
        (/community_new_post/i.test(n.resourceId || '') ||
          /community_new_post/i.test(n.contentDesc || '')),
    );
  }
  if (!fab?.bounds) {
    fab = findNodeByText(nodes, ['New post', 'Postare nouă'], { packageName: PKG });
  }
  if (!fab?.bounds) {
    fab = nodes.find(
      (n) =>
        n.packageName === PKG &&
        n.clickable &&
        n.bounds &&
        /new post|postare nouă/i.test(`${n.text} ${n.contentDesc}`),
    );
  }
  if (fab?.bounds) {
    tapBounds(fab.bounds, { deviceId: getAdbDevice() });
    await sleep(2000);
    const createDump = dumpUiHierarchy(getAdbDevice(), 'closeout-create-post');
    const createText = allVisibleText(createDump.xml);
    screenshot('create-post');
    record(
      'community create post screen',
      /share a tip|earn points|community rules|share your story/i.test(createText),
      createText.slice(0, 120),
    );
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
  } else {
    record('community create post screen', false, 'FAB not found');
  }
}

async function dismissGdprExportOtp() {
  for (let i = 0; i < 4; i += 1) {
    const dump = dumpUiHierarchy(getAdbDevice(), `closeout-dismiss-otp-${i}`);
    const text = allVisibleText(dump.xml);
    if (!/6-digit code|verify otp|confirm the export/i.test(text)) return true;
    const dismissed = await tapIf(
      ['Dismiss', '×', 'X', 'Cancel', 'Anulează', 'Close', 'Închide'],
      { label: `dismiss-otp-${i}`, timeoutMs: 2000 },
    );
    if (!dismissed) {
      adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
      await sleep(700);
    } else {
      await sleep(900);
    }
  }
  return true;
}

async function verifyRomanianLearn() {
  await popStackedRoutes();
  await navigateToMainShell();
  await openTab('profile');
  await sleep(1200);
  await dismissGdprExportOtp();
  await swipeUp({ deviceId: getAdbDevice() });
  await sleep(500);
  await tapIf(['Language', 'Limba', 'App language'], { label: 'lang-menu', timeoutMs: 6000 });
  await sleep(1500);
  await dismissGdprExportOtp();
  const picked = await tapIf(['Română', 'Romanian', 'RO', 'ro'], {
    label: 'pick-ro',
    timeoutMs: 8000,
  });
  if (picked) {
    await tapIf(['Save', 'Salvează', 'Apply', 'Continue', 'Done'], { label: 'lang-save' });
    await sleep(3000);
  }
  await dismissOverlays();
  await dismissGdprExportOtp();
  await openTab('learn');
  await sleep(2000);
  const dump = dumpUiHierarchy(getAdbDevice(), 'closeout-learn-ro');
  const text = allVisibleText(dump.xml);
  screenshot('learn-ro');
  const hasRo =
    /sfatul zilei|articole câștigate|învă/i.test(text) &&
    !/become a recycling expert/i.test(text) &&
    !/6-digit code|verify otp|confirm the export/i.test(text);
  record('Romanian learn strings', hasRo, hasRo ? '' : text.slice(0, 160));
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
  const reportPath = path.join(OUT, `closeout-${Date.now()}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n[closeout] Report: ${reportPath}`);
  console.log(`[closeout] ${report.pass} pass, ${report.fail} fail`);
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

  const cfg = getConfig();
  const mobile = loadMobileAppUserCredentials();
  const { authHeaders } = await resolvePlastyPesaAuth(cfg);

  adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], { deviceId });
  await relaunchApp();

  const loggedIn = await loginIfNeeded(mobile);
  record('login reaches main shell', loggedIn);
  if (!loggedIn) writeReport(2);

  const shellOk = await navigateToMainShell();
  record('main shell', shellOk);
  if (!shellOk) writeReport(2);

  await verifyLeaderboardColdOpen();
  if (process.env.BUILD50_SKIP_READ !== '1') {
    await verifyReadAwardBanner(authHeaders, cfg);
  } else {
    console.log('[closeout] Skipping read award (BUILD50_SKIP_READ=1)');
  }
  await verifyCommunityCreatePost();
  await verifyRomanianLearn();

  writeReport(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((err) => {
  console.error('[closeout]', err);
  process.exit(1);
});
