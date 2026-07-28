#!/usr/bin/env node
/**
 * ADB proof for P-LOGIN-AUTH-ERROR-HINT.
 * If a session is restored (Android backup after pm clear), signs out first,
 * then submits wrong password and asserts the on-screen credentials hint.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { loadMobileAppUserCredentials } from './credential-registry.mjs';
import {
  dumpUiHierarchy,
  parseUiNodes,
  typeText,
  sleep,
  getAdbDevice,
  tapBounds,
  findNodeByText,
  normalizeText,
} from './localization/adb-ui.mjs';

function decodeUi(value) {
  return String(value || '')
    .replace(/&#10;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n/g, ' ');
}

/** Exact / tab-label match — avoids "…in Profile." false hits. */
function findExactLabel(nodes, labels) {
  const wants = labels.map(normalizeText).filter(Boolean);
  for (const n of nodes) {
    if (n.packageName !== PKG || !n.bounds) continue;
    const hay = [n.text, n.contentDesc]
      .map((v) => normalizeText(decodeUi(v)))
      .filter(Boolean);
    for (const h of hay) {
      if (wants.includes(h)) return n;
      // Flutter bottom tabs often expose "Profile Profile"
      if (wants.some((w) => h === `${w} ${w}` || h.startsWith(`${w} `))) return n;
    }
  }
  return null;
}

const PKG = 'com.app.plasty_pesa';
const WRONG_PASSWORD = 'DefinitelyWrongPass999!';
const OUT_DIR = join(
  process.cwd(),
  '.neoxten',
  'proof',
  `login-auth-hint-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

const HINT_NEEDLES = [
  'Wrong email or password',
  'Email o password non corretti',
  'Correo o contraseña incorrectos',
  'Email ou palavra-passe incorretos',
  'Falsche E-Mail oder falsches Passwort',
  'E-mail ou mot de passe incorrect',
  'Email sau parolă greșită',
  'Invalid email or password',
];

function shot(deviceId, name) {
  const path = join(OUT_DIR, name);
  const r = spawnSync('adb', ['-s', deviceId, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 25 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout?.length) writeFileSync(path, r.stdout);
  console.log('screenshot', path);
  return path;
}

function clearFocusedField(deviceId) {
  spawnSync('adb', [
    '-s',
    deviceId,
    'shell',
    'input',
    'keyevent',
    '123',
    ...Array.from({ length: 96 }, () => '67'),
  ]);
}

function launch(deviceId) {
  spawnSync(
    'adb',
    [
      '-s',
      deviceId,
      'shell',
      'monkey',
      '-p',
      PKG,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ],
    { stdio: 'inherit' },
  );
}

async function waitTap(deviceId, labels, { timeoutMs = 20000 } = {}) {
  const start = Date.now();
  const expanded = labels.flatMap((l) => [
    l,
    l.replace(/&/g, '&amp;'),
    decodeUi(l),
  ]);
  while (Date.now() - start < timeoutMs) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'wt').xml);
    let n = findNodeByText(nodes, expanded, { packageName: PKG });
    if (!n?.bounds) n = findExactLabel(nodes, labels);
    // Consent CTA often stores "&amp;" literally in content-desc
    if (!n?.bounds) {
      n = nodes.find((node) => {
        if (node.packageName !== PKG || !node.bounds || !node.clickable) return false;
        const h = normalizeText(decodeUi(node.contentDesc || node.text || ''));
        return labels.some((l) => h.includes(normalizeText(decodeUi(l))));
      });
    }
    if (n?.bounds) {
      console.log('tap', labels[0], decodeUi(n.contentDesc || n.text));
      tapBounds(n.bounds, { deviceId });
      await sleep(1400);
      return true;
    }
    await sleep(700);
  }
  return false;
}

function hasLoginFields(nodes) {
  const email = nodes.find(
    (n) =>
      n.packageName === PKG &&
      n.className === 'android.widget.EditText' &&
      !n.password &&
      n.bounds,
  );
  const pass = nodes.find(
    (n) =>
      n.packageName === PKG &&
      n.className === 'android.widget.EditText' &&
      n.password &&
      n.bounds,
  );
  return { email, pass };
}

function isLoggedInShell(nodes) {
  return Boolean(
    findExactLabel(nodes, ['Home', 'Leaderboard', 'Learn', 'Scan', 'Community']) ||
      findExactLabel(nodes, ['Profile']),
  );
}

function hintInUi(nodes) {
  const blob = nodes.map((n) => `${n.text || ''} ${n.contentDesc || ''}`).join(' ');
  const lower = blob.toLowerCase();
  return HINT_NEEDLES.find((n) => lower.includes(n.toLowerCase())) || null;
}

async function signOutIfNeeded(deviceId, nodes) {
  if (!isLoggedInShell(nodes)) return false;
  console.log('session present — signing out');
  const start = Date.now();
  let tappedProfile = false;
  while (Date.now() - start < 12000) {
    const cur = parseUiNodes(dumpUiHierarchy(deviceId, 'profile-tab').xml);
    const tab = findExactLabel(cur, ['Profile']);
    if (tab?.bounds) {
      tapBounds(tab.bounds, { deviceId });
      tappedProfile = true;
      console.log('tap Profile tab');
      break;
    }
    await sleep(700);
  }
  if (!tappedProfile) throw new Error('Profile tab not found');
  await sleep(1000);
  for (let i = 0; i < 6; i += 1) {
    const cur = parseUiNodes(dumpUiHierarchy(deviceId, `so-${i}`).xml);
    if (findNodeByText(cur, ['Sign Out', 'Sign out'], { packageName: PKG })) break;
    spawnSync('adb', [
      '-s',
      deviceId,
      'shell',
      'input',
      'swipe',
      '360',
      '1200',
      '360',
      '400',
      '400',
    ]);
    await sleep(700);
  }
  const signed = await waitTap(deviceId, ['Sign Out', 'Sign out'], { timeoutMs: 12000 });
  if (!signed) throw new Error('Sign Out not found');
  await waitTap(deviceId, ['Sign Out', 'Confirm', 'Yes', 'OK'], { timeoutMs: 5000 });
  await sleep(2000);
  return true;
}

async function ensureLoginScreen(deviceId) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'ensure-loop').xml);
    const fields = hasLoginFields(nodes);
    if (fields.email && fields.pass) return fields;

    const blob = nodes.map((n) => decodeUi(n.contentDesc || n.text || '')).join(' | ');

    if (await signOutIfNeeded(deviceId, nodes)) continue;

    if (/privacy|usage analytics|save &/i.test(blob)) {
      await waitTap(deviceId, ['Save & continue', 'Save & Continue'], { timeoutMs: 12000 });
      await sleep(1000);
      continue;
    }
    if (/choose your language/i.test(blob)) {
      await waitTap(deviceId, ['Continue'], { timeoutMs: 12000 });
      await sleep(1000);
      continue;
    }
    if (/\bnext\b/i.test(blob) && findExactLabel(nodes, ['Next'])) {
      await waitTap(deviceId, ['Next'], { timeoutMs: 8000 });
      await sleep(800);
      continue;
    }
    if (/get started/i.test(blob)) {
      await waitTap(deviceId, ['Get Started', 'Get started'], { timeoutMs: 10000 });
      await sleep(1000);
      continue;
    }
    if (findExactLabel(nodes, ['Login', 'Sign In', 'Sign in'])) {
      const loginEntry = findExactLabel(nodes, ['Login', 'Sign In', 'Sign in']);
      if (loginEntry?.bounds) {
        tapBounds(loginEntry.bounds, { deviceId });
        await sleep(1200);
        continue;
      }
    }

    await sleep(900);
  }

  const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'ensure-fail').xml);
  shot(deviceId, 'fail-no-login.png');
  console.error(
    'visible:',
    nodes.map((n) => n.contentDesc || n.text).filter(Boolean).slice(0, 40),
  );
  throw new Error('Could not reach login fields');
}

async function main() {
  bootstrapPlastyPesaEnv();
  mkdirSync(OUT_DIR, { recursive: true });
  const deviceId = getAdbDevice();
  if (!deviceId) throw new Error('No adb device');

  const mobile = loadMobileAppUserCredentials();
  const email = String(mobile.email || '').trim().toLowerCase();
  if (!email) throw new Error('No mobile test email');
  console.log(JSON.stringify({ deviceId, email, wrongPassword: true, out: OUT_DIR }));

  spawnSync('adb', ['-s', deviceId, 'shell', 'am', 'force-stop', PKG], {
    stdio: 'inherit',
  });
  launch(deviceId);
  await sleep(8000);
  // Dismiss possible app-open / wait for Flutter
  await sleep(4000);
  shot(deviceId, '00-start.png');

  const fields = await ensureLoginScreen(deviceId);
  shot(deviceId, '01-login.png');

  tapBounds(fields.email.bounds, { deviceId });
  await sleep(400);
  clearFocusedField(deviceId);
  await typeText(email, { deviceId, perCharacter: true, charDelayMs: 18 });
  tapBounds(fields.pass.bounds, { deviceId });
  await sleep(400);
  clearFocusedField(deviceId);
  await typeText(WRONG_PASSWORD, { deviceId, perCharacter: true, charDelayMs: 16 });
  await sleep(400);
  // Hide IME so Login CTA is in the accessibility tree / tappable.
  spawnSync('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', '4']);
  await sleep(700);

  let nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'pre').xml);
  let login = findNodeByText(nodes, ['Login', 'Logging in'], { packageName: PKG });
  if (!login?.bounds) login = findExactLabel(nodes, ['Login']);
  if (!login?.bounds) {
    // Fallback: hard-tap typical Login CTA band on 720x1640.
    console.log('Login node missing — hard-tapping CTA band');
    spawnSync('adb', ['-s', deviceId, 'shell', 'input', 'tap', '360', '1180']);
  } else {
    tapBounds(login.bounds, { deviceId });
  }

  let matched = null;
  const started = Date.now();
  while (Date.now() - started < 15000) {
    await sleep(900);
    nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'after').xml);
    matched = hintInUi(nodes);
    if (matched) break;
  }
  shot(deviceId, '02-wrong.png');
  if (!matched) {
    console.error(
      'UI sample:',
      nodes
        .map((n) => `${n.text} ${n.contentDesc}`)
        .join(' | ')
        .slice(0, 900),
    );
    throw new Error('Credentials hint not visible after wrong password');
  }

  await sleep(800);
  nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'pass2').xml);
  const still = hintInUi(nodes) || matched;
  shot(deviceId, '03-pass2.png');
  console.log(JSON.stringify({ pass: true, matchedHint: still, proofDir: OUT_DIR }));
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
