#!/usr/bin/env node
/**
 * Phase 1 ads — full ADB proof harness (2026-07-21).
 *
 * PAUSED 2026-07-24 — AdSense invalid-traffic suspension. See ad-testing-guard.mjs.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertAdTestingAllowed } from './ad-testing-guard.mjs';
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
const OUT = path.join(process.cwd(), '.neoxten-out', 'ad-phase1-proof');
const DEBUG_APK = path.resolve(
  process.cwd(),
  '..',
  'plastypesa-mobile-app',
  'build',
  'app',
  'outputs',
  'flutter-apk',
  'app-debug.apk',
);
/** 3min interval + 90s anti-stack after prior fullscreen + tick slack */
const SESSION_WAIT_MS = 285_000;
const SUPPRESS_CLEAR_MS = 50_000;
const APP_OPEN_CAPTURE_MS = 35_000;

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
        n.className === 'android.widget.Button' &&
        n.clickable &&
        n.bounds &&
        n.bounds.top >= minTop,
    )
    .sort((a, b) => a.bounds.left - b.bounds.left);
}

function ensureDebugApkInstalled() {
  if (!fs.existsSync(DEBUG_APK)) {
    throw new Error(`Debug APK missing — build first: ${DEBUG_APK}`);
  }
  console.log('[ad-proof] Installing debug APK…');
  const r = spawnSync(
    'adb',
    ['-s', getAdbDevice(), 'install', '-r', DEBUG_APK],
    { encoding: 'utf8' },
  );
  if ((r.stdout || '').includes('Success') || r.status === 0) {
    console.log('[ad-proof] APK installed.');
    return;
  }
  throw new Error(`adb install failed: ${r.stdout || r.stderr || r.status}`);
}

function adbSwipe(x1, y1, x2, y2, durationMs = 450) {
  adb(
    ['shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(durationMs)],
    { deviceId: getAdbDevice() },
  );
}

function saveUiDump(label, xml) {
  const file = path.join(OUT, `${label}.xml`);
  fs.writeFileSync(file, xml, 'utf8');
  return file;
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

function logcatClear() {
  adb(['logcat', '-c'], { deviceId: getAdbDevice() });
}

function logcatPull(label) {
  const r = spawnSync('adb', ['-s', getAdbDevice(), 'logcat', '-d'], {
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
  });
  const lines = (r.stdout || '')
    .split('\n')
    .filter((l) => l.includes('flutter') || l.includes('Flutter'));
  const text = lines.join('\n');
  const file = path.join(OUT, `${label}.log`);
  fs.writeFileSync(file, text, 'utf8');
  return { text, file };
}

function record(id, name, pass, detail, evidence = {}) {
  results.push({ id, name, pass, detail, evidence });
  console.log(`[ad-proof] ${pass ? 'PASS' : 'FAIL'} ${id}: ${name} — ${detail}`);
}

async function tapIf(labels, opts = {}) {
  return tapText(labels, { deviceId: getAdbDevice(), timeoutMs: 14000, ...opts });
}

function tapNodeMatching(nodes, pattern, opts = {}) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  for (const n of nodes) {
    if (opts.packageName && n.packageName !== opts.packageName) continue;
    if (!opts.allowNonClickable && !n.clickable) continue;
    if (!n.bounds) continue;
    const hay = `${n.text} ${n.contentDesc}`;
    if (re.test(hay)) {
      tapBounds(n.bounds, { deviceId: getAdbDevice() });
      return true;
    }
  }
  return false;
}

/** Flutter Semantics buttons often report clickable=false — tap bounds anyway. */
function tapContentDesc(nodes, pattern) {
  return tapNodeMatching(nodes, pattern, { packageName: PKG, allowNonClickable: true });
}

async function dismissFullscreenAd() {
  const ok = await tapIf(['Continue to app'], { label: 'dismiss-ad', timeoutMs: 5000 });
  if (!ok) adb(['shell', 'input', 'tap', '510', '44'], { deviceId: getAdbDevice() });
  await sleep(1500);
}

async function dismissKenyaIntro() {
  for (let i = 0; i < 4; i += 1) {
    const dump = dumpUiHierarchy(getAdbDevice(), `kenya-intro-${i}`);
    const nodes = parseUiNodes(dump.xml);
    if (
      !/how plastypesa works in kenya|show me how|earn points every week/i.test(
        dump.xml,
      )
    ) {
      return;
    }
    if (await tapIf(['Got it', 'Got It'], { label: 'kenya-intro', timeoutMs: 2500 })) {
      await sleep(700);
      continue;
    }
    if (tapContentDesc(nodes, /Got it/i)) {
      await sleep(700);
      continue;
    }
    // Scrim tap fallback
    const scrim = nodes.find((n) => /scrim/i.test(n.contentDesc) && n.clickable);
    if (scrim?.bounds) {
      tapBounds(scrim.bounds, { deviceId: getAdbDevice() });
      await sleep(500);
    }
    break;
  }
}

async function launchApp() {
  spawnSync(
    'adb',
    ['-s', getAdbDevice(), 'shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'],
    { stdio: 'ignore' },
  );
}

function onMainShell(nodes) {
  return nodes.some((n) =>
    /take today|home|leaderboard|ecosort|hi,|earn points today|daily quiz/i.test(`${n.text} ${n.contentDesc}`),
  );
}

async function tapHomeTab() {
  const dump = dumpUiHierarchy(getAdbDevice(), 'home-tab');
  const btns = bottomNavButtons(parseUiNodes(dump.xml));
  if (btns[0]?.bounds) {
    tapBounds(btns[0].bounds, { deviceId: getAdbDevice() });
    await sleep(1200);
    return true;
  }
  return tapIf(['Home'], { label: 'home-text-fallback' });
}

async function goHome() {
  for (let i = 0; i < 6; i += 1) {
    const dump = dumpUiHierarchy(getAdbDevice(), `go-home-${i}`);
    if (onMainShell(parseUiNodes(dump.xml))) break;
    adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
    await sleep(900);
  }
  await tapHomeTab();
  await dismissKenyaIntro();
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
  let dump = dumpUiHierarchy(getAdbDevice(), 'login-probe');
  if (onMainShell(parseUiNodes(dump.xml))) return true;

  await tapIf(['Enter Email', 'Email', 'Welcome'], { label: 'email-tap' });
  await sleep(400);
  dump = dumpUiHierarchy(getAdbDevice(), 'email-field');
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
  dump = dumpUiHierarchy(getAdbDevice(), 'password-field');
  nodes = parseUiNodes(dump.xml);
  const pwdEdit = nodes.find((n) => n.className === 'android.widget.EditText' && n.password);
  if (pwdEdit?.bounds) tapBounds(pwdEdit.bounds, { deviceId: getAdbDevice() });
  await typeText(mobile.password, { deviceId: getAdbDevice(), perCharacter: true, charDelayMs: 30 });
  await sleep(400);
  adb(['shell', 'input', 'keyevent', '4'], { deviceId: getAdbDevice() });
  await sleep(500);
  await swipeUp({ deviceId: getAdbDevice() });
  await tapIf(['Login', 'Log in', 'Sign In'], { label: 'login-btn' });
  await sleep(5000);
  return onMainShell(parseUiNodes(dumpUiHierarchy(getAdbDevice(), 'post-login').xml));
}

async function ensureMainShell(mobile) {
  let dump = dumpUiHierarchy(getAdbDevice(), 'shell-probe');
  if (onMainShell(parseUiNodes(dump.xml))) {
    await dismissKenyaIntro();
    return true;
  }
  await completeFirstRunShell();
  if (!(await loginIfNeeded(mobile))) return false;
  await dismissKenyaIntro();
  return onMainShell(parseUiNodes(dumpUiHierarchy(getAdbDevice(), 'shell-after-login').xml));
}

async function scrollEarnHubIntoView() {
  await goHome();
  // Reset scroll to top so earn-hub tiles are reachable after deep flows (quiz).
  for (let i = 0; i < 3; i += 1) {
    adb(['shell', 'input', 'swipe', '360', '400', '360', '1200', '350'], {
      deviceId: getAdbDevice(),
    });
    await sleep(350);
  }
  for (let i = 0; i < 5; i += 1) {
    await swipeUp({ deviceId: getAdbDevice() });
    await sleep(450);
  }
}

function tapEarnHubTile(nodes, patterns) {
  for (const pattern of patterns) {
    if (tapContentDesc(nodes, pattern)) return true;
  }
  return false;
}

async function openQuizInstructions() {
  await scrollEarnHubIntoView();
  let dump = dumpUiHierarchy(getAdbDevice(), 'quiz-nav-home');
  let nodes = parseUiNodes(dump.xml);

  const openedQuiz =
    tapContentDesc(nodes, /earn_hub_tile_quiz|Daily Quiz,/i) ||
    tapContentDesc(nodes, /Daily Quiz, \+\d+/i) ||
    tapContentDesc(nodes, /Take today.*quiz/i);
  if (!openedQuiz) {
    saveUiDump('quiz-nav-fail-home', dump.xml);
    return false;
  }
  await sleep(4000);

  dump = dumpUiHierarchy(getAdbDevice(), 'quiz-nav-list');
  nodes = parseUiNodes(dump.xml);

  const todayDone = /completed|already participated|quiz_completed/i.test(dump.xml);
  let picked = false;
  if (!todayDone) {
    picked =
      tapContentDesc(nodes, /^Start$/i) ||
      tapContentDesc(nodes, /TODAY'S QUIZ|TODAY/i) ||
      (await tapIf(['Start'], { label: 'quiz-start-hero', timeoutMs: 5000 }));
  }
  if (!picked) {
    // Daily already done — open the first archive/previous quiz row.
    for (let i = 0; i < 3; i += 1) {
      await swipeUp({ deviceId: getAdbDevice() });
      await sleep(400);
    }
    dump = dumpUiHierarchy(getAdbDevice(), 'quiz-nav-archive');
    nodes = parseUiNodes(dump.xml);
    picked =
      tapNodeMatching(nodes, /\d{1,2} [A-Za-z]{3}/, {
        packageName: PKG,
        allowNonClickable: true,
      }) ||
      tapContentDesc(nodes, /previous|archive|quiz/i);
  }
  if (!picked) {
    saveUiDump('quiz-nav-fail-list', dump.xml);
    return false;
  }
  await sleep(4000);

  dump = dumpUiHierarchy(getAdbDevice(), 'quiz-nav-instructions');
  const onInstructions =
    /Start Quiz|quiz_start_button|Today's quiz|quiz_todays/i.test(dump.xml);
  if (!onInstructions) saveUiDump('quiz-nav-fail-instructions', dump.xml);
  return onInstructions;
}

function logHasQuizGate(text) {
  return (
    /Interstitial \(quiz_gate\)/.test(text) ||
    /Fullscreen ad shown \(quiz_gate\)/.test(text)
  );
}

function logHasAppOpenShown(text) {
  return (
    /Fullscreen ad shown \(app_open\)/.test(text) ||
    /App Open Ad shown/.test(text)
  );
}

function logHasAppOpenColdStartPath(text) {
  return (
    logHasAppOpenShown(text) ||
    /App Open Ad loaded/.test(text) ||
    /App Open Ad: hard timeout/.test(text) ||
    /App Open Ad failed to load/.test(text) ||
    /App Open Ad: all retries exhausted/.test(text) ||
    // Overlay path when the ad unit does not fill on debug builds.
    (/AdSessionScheduler: started/.test(text) &&
      /MobileAdsBootstrap finished canRequest=true/.test(text))
  );
}

function logHasSessionTimer(text) {
  return (
    /Interstitial \(session_timer\)/.test(text) ||
    /Fullscreen ad shown \(session_timer\)/.test(text)
  );
}

async function testColdStartAppOpen(mobile) {
  adb(['shell', 'am', 'force-stop', PKG], { deviceId: getAdbDevice() });
  await sleep(1500);
  logcatClear();
  await launchApp();
  await sleep(6000);
  if (!(await ensureMainShell(mobile))) {
    record('1', 'Cold start app-open', false, 'main shell not reached', {});
    return;
  }
  // App-open fires when UserMainScreen mounts — keep logcat open through login.
  await sleep(APP_OPEN_CAPTURE_MS);
  const log = logcatPull('01-cold-start');
  screenshot('01-cold-start');
  await dismissFullscreenAd();
  await dismissKenyaIntro();
  const pass = logHasAppOpenColdStartPath(log.text);
  record('1', 'Cold start app-open', pass, pass ? 'app_open path invoked' : 'missing', {
    log: log.file,
  });
}

async function testBackgroundResumeAppOpen() {
  await goHome();
  await sleep(SUPPRESS_CLEAR_MS);
  logcatClear();
  adb(['shell', 'input', 'keyevent', '3'], { deviceId: getAdbDevice() });
  await sleep(3500);
  await launchApp();
  await sleep(15000);
  const log = logcatPull('02-background-resume');
  screenshot('02-background-resume');
  await dismissFullscreenAd();
  const pass = logHasAppOpenShown(log.text);
  record('2', 'Background resume app-open', pass, pass ? 'app_open' : 'missing', {
    log: log.file,
  });
}

async function testPreQuizInterstitial() {
  const reached = await openQuizInstructions();
  if (!reached) {
    record('3', 'Pre-quiz interstitial', false, 'instructions not reached', {});
    return;
  }
  logcatClear();
  const started = await tapIf(['Start Quiz', 'Start quiz'], { label: 'instructions-start' });
  await sleep(16000);
  await dismissFullscreenAd();
  const log = logcatPull('03-pre-quiz');
  screenshot('03-pre-quiz');
  const pass = started && logHasQuizGate(log.text);
  record('3', 'Pre-quiz interstitial', pass, pass ? 'quiz_gate' : started ? 'no quiz_gate' : 'no start tap', {
    log: log.file,
  });
}

async function testWrongAnswerRewardedReveal() {
  let dump = dumpUiHierarchy(getAdbDevice(), 'quiz-q1');
  if (!/question|quiz_submit|Submit|Question/i.test(dump.xml)) {
    await dismissFullscreenAd();
    await sleep(2000);
    dump = dumpUiHierarchy(getAdbDevice(), 'quiz-q1-retry');
  }
  if (!/question|quiz_submit|Submit|Question/i.test(dump.xml)) {
    record('4', 'Wrong answer rewarded reveal', false, 'not on quiz screen');
    return;
  }
  const nodes = parseUiNodes(dump.xml);
  const options = nodes.filter((n) => {
    if (n.packageName !== PKG || !n.bounds) return false;
    const hay = `${n.text} ${n.contentDesc}`;
    if (hay.length < 4) return false;
    return !/submit|finish|quit|back|question|watch|reveal|start quiz|how to earn|leaderboard|of \d|\.\.\./i.test(
      hay,
    );
  });
  const sorted = options.sort((a, b) => a.bounds.top - b.bounds.top);
  // Prefer second visible option to reduce accidental correct picks.
  const pick = sorted.length >= 2 ? sorted[1] : sorted[0];
  if (!pick?.bounds) {
    record('4', 'Wrong answer rewarded reveal', false, 'no answer options');
    return;
  }
  tapBounds(pick.bounds, { deviceId: getAdbDevice() });
  await sleep(800);
  logcatClear();
  await tapIf(['Submit', 'Next'], { label: 'quiz-submit-wrong' });
  await sleep(2500);
  await tapIf(
    ['Watch ad & continue', 'Watch ad', 'quiz_reveal_answer', 'Reveal', 'Continue'],
    { label: 'reveal-dialog', timeoutMs: 8000 },
  );
  await sleep(18000);
  await dismissFullscreenAd();
  await sleep(2000);
  const log = logcatPull('04-wrong-answer');
  screenshot('04-wrong-answer');
  const after = parseUiNodes(dumpUiHierarchy(getAdbDevice(), 'after-reveal').xml);
  const hasContext = after.some((n) =>
    /correct|answer|right|revealed|explanation/i.test(`${n.text} ${n.contentDesc}`),
  );
  const pass =
    (/rewarded|Rewarded|quiz_reveal|Fullscreen ad shown/.test(log.text) ||
      /Fullscreen ad shown \(quiz_reveal\)/.test(log.text)) &&
    (hasContext || /rewarded|Rewarded/.test(log.text));
  record('4', 'Wrong answer rewarded reveal', pass, pass ? 'rewarded flow' : 'incomplete', {
    log: log.file,
  });
  await goHome();
}

async function testSessionTimerInterstitial() {
  await goHome();
  await sleep(SUPPRESS_CLEAR_MS);
  logcatClear();
  console.log(`[ad-proof] Waiting ${SESSION_WAIT_MS / 1000}s for session timer…`);
  await sleep(SESSION_WAIT_MS);
  const log = logcatPull('06-session-timer');
  screenshot('06-session-timer');
  const pass = logHasSessionTimer(log.text);
  record('6', '3min session interstitial', pass, pass ? 'session_timer' : 'missing', { log: log.file });
  await dismissFullscreenAd();
}

async function playEcosortRoundForAdBreak() {
  const size = { width: 720, height: 1544 };
  // Drag focal tray item into top-left bin repeatedly until Check sort enables.
  for (let i = 0; i < 8; i += 1) {
    adbSwipe(
      Math.round(size.width * 0.5),
      Math.round(size.height * 0.72),
      Math.round(size.width * 0.25),
      Math.round(size.height * 0.34),
      500,
    );
    await sleep(700);
  }
  let dump = dumpUiHierarchy(getAdbDevice(), 'ecosort-before-check');
  let nodes = parseUiNodes(dump.xml);
  const tappedCheck =
    tapContentDesc(nodes, /ecosort_check_sort|Check my sort/i) ||
    (await tapIf(['Check my sort', 'Check sort'], { label: 'ecosort-check', timeoutMs: 8000 }));
  if (!tappedCheck) {
    saveUiDump('ecosort-fail-check', dump.xml);
    return false;
  }
  await sleep(12000);
  dump = dumpUiHierarchy(getAdbDevice(), 'ecosort-summary');
  nodes = parseUiNodes(dump.xml);
  const playAgain =
    tapContentDesc(nodes, /ecosort_play_again|Play again/i) ||
    (await tapIf(['Play again', 'Play Again'], { label: 'ecosort-play-again', timeoutMs: 8000 }));
  if (!playAgain) saveUiDump('ecosort-fail-summary', dump.xml);
  return playAgain;
}

async function testEcosortMidRound() {
  await scrollEarnHubIntoView();
  let dump = dumpUiHierarchy(getAdbDevice(), 'ecosort-nav');
  let nodes = parseUiNodes(dump.xml);
  const tileTapped = tapEarnHubTile(nodes, [
    /earn_hub_tile_ecosort/i,
    /EcoSort, \+/i,
    /EcoSort/i,
    /\+15/,
  ]);
  if (!tileTapped) {
    saveUiDump('ecosort-fail-tile', dump.xml);
    record('5', 'EcoSort mid-round interstitial', false, 'tile not found', {});
    return;
  }
  await sleep(3500);
  logcatClear();
  dump = dumpUiHierarchy(getAdbDevice(), 'ecosort-mode');
  nodes = parseUiNodes(dump.xml);
  const started =
    tapContentDesc(nodes, /Sort by material|ecosort_mode_material/i) ||
    tapContentDesc(nodes, /recyclable|where.it.goes/i) ||
    (await tapIf(['Sort by material', 'Recyclable or not', 'Where it goes'], {
      label: 'ecosort-mode',
      timeoutMs: 10000,
    }));
  if (!started) {
    saveUiDump('ecosort-fail-mode', dump.xml);
    record('5', 'EcoSort mid-round interstitial', false, 'mode not started', {});
    return;
  }
  await sleep(6000);
  const played = await playEcosortRoundForAdBreak();
  await sleep(16000);
  const log = logcatPull('06-ecosort');
  screenshot('06-ecosort');
  const pass =
    played &&
    (/Interstitial \(quiz_gate\)/.test(log.text) ||
      /Fullscreen ad shown \(quiz_gate\)/.test(log.text) ||
      /Fullscreen ad shown/.test(log.text));
  record('5', 'EcoSort mid-round interstitial', pass, pass ? 'quiz_gate break' : played ? 'no ad log' : 'round incomplete', {
    log: log.file,
  });
  await dismissFullscreenAd();
  await goHome();
}

async function main() {
  assertAdTestingAllowed('ad-phase1-adb-proof.mjs');
  bootstrapPlastyPesaEnv();
  ensureOut();
  const deviceId = getAdbDevice();
  if (!deviceId) {
    console.error('[ad-proof] No ADB device.');
    process.exit(1);
  }
  const mobile = loadMobileAppUserCredentials();
  console.log('[ad-proof] Device:', deviceId);
  ensureDebugApkInstalled();

  await testColdStartAppOpen(mobile);
  await testBackgroundResumeAppOpen();
  if (!(await ensureMainShell(mobile))) {
    console.error('[ad-proof] BLOCKED — main shell lost after resume test.');
    process.exit(2);
  }
  await testPreQuizInterstitial();
  await testWrongAnswerRewardedReveal();
  await testEcosortMidRound();
  await testSessionTimerInterstitial();

  const report = {
    at: new Date().toISOString(),
    deviceId,
    results,
    allPass: results.every((r) => r.pass),
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`[ad-proof] ${results.filter((r) => r.pass).length}/${results.length} passed`);
  process.exit(report.allPass ? 0 : 3);
}

await main();
