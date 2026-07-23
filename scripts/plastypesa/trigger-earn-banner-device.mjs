#!/usr/bin/env node
/**
 * Opens PlastyPesa on ADB, navigates Learn → unread article, scrolls for read award
 * so the owner can see the frosted earn banner on device.
 */
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
  sleep,
  getAdbDevice,
  swipeUp,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';

async function main() {
  bootstrapPlastyPesaEnv();
  const deviceId = getAdbDevice();
  if (!deviceId) {
    console.error('No ADB device.');
    process.exit(2);
  }

  const cfg = getConfig();
  const { authHeaders } = await resolvePlastyPesaAuth(cfg);
  const statusRes = await fetch(url(cfg, '/home/read-reward/status'), {
    headers: authHeaders,
  });
  const status = (await statusRes.json())?.data;
  const article = (status?.dailyArticles || []).find(
    (a) => a.eligible && a.inRotation !== false && !a.earnedToday,
  );
  if (!article?.title) {
    console.error('No unread article — run reset-mobile-read-cap-today.js --apply first');
    process.exit(1);
  }
  console.log(`Target article: ${article.title} (+${status.pointsPerArticle} pts)`);

  adb(['shell', 'am', 'force-stop', 'com.android.chrome'], { deviceId });
  adb(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`], { deviceId });
  await sleep(12000);

  // Learn tab (2nd nav item, skip center scan if 5 buttons)
  const tabDump = dumpUiHierarchy(deviceId, 'banner-learn-tab');
  const btns = parseUiNodes(tabDump.xml)
    .filter((n) => n.packageName === PKG && n.clickable && n.bounds)
    .sort((a, b) => a.bounds.top - b.bounds.top);
  const navBtns = btns.filter((n) => n.bounds.top >= 1200);
  const learnIdx = navBtns.length >= 5 ? 1 : 1;
  if (navBtns[learnIdx]?.bounds) {
    tapBounds(navBtns[learnIdx].bounds, { deviceId });
  } else {
    await tapText(['Learn', 'Învățare'], { deviceId, timeoutMs: 6000, packageName: PKG });
  }
  await sleep(2500);

  const titleWords = article.title.split(/\s+/).slice(0, 4);
  let opened = await tapText(titleWords, {
    deviceId,
    timeoutMs: 8000,
    packageName: PKG,
    label: 'open-article',
  });
  if (!opened) {
    for (let i = 0; i < 5; i += 1) {
      swipeUp({ deviceId, startY: 0.78, endY: 0.25 });
      await sleep(500);
      if (await tapText(titleWords, { deviceId, timeoutMs: 2000, packageName: PKG })) {
        opened = true;
        break;
      }
    }
  }
  if (!opened) {
    console.error('Could not open article on Learn screen — open manually:', article.title);
    process.exit(1);
  }
  await sleep(1500);

  console.log('Scrolling article — watch TOP of screen for frosted earn banner (~15s)…');
  for (let i = 0; i < 20; i += 1) {
    swipeUp({ deviceId, startY: 0.85, endY: 0.15 });
    await sleep(700);
  }
  await sleep(12000);

  const probe = dumpUiHierarchy(deviceId, 'banner-after-read');
  const text = parseUiNodes(probe.xml)
    .map((n) => [n.text, n.contentDesc].filter(Boolean).join(' '))
    .join('\n');
  const hasBanner =
    /earn_banner|points earned|puncte câștigate/i.test(text) &&
    /article read verified|\+100|verified/i.test(text);
  console.log(hasBanner ? 'BANNER COPY DETECTED in UI dump' : 'Banner not detected in UI dump — check device visually');
  adb(['shell', 'exec-out', 'screencap', '-p'], { deviceId, encoding: 'buffer' });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
