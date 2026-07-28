#!/usr/bin/env node
/**
 * ADB proof for P-OTP-SPAM-FOLDER-HINT-UI (Batch 3).
 * Opens Forgot Password (pre-send surface) and asserts the spam/junk notice
 * is visible. Optionally opens Sign Up email screen too.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import {
  dumpUiHierarchy,
  parseUiNodes,
  sleep,
  getAdbDevice,
  tapBounds,
  findNodeByText,
  normalizeText,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';
const OUT_DIR = join(
  process.cwd(),
  '.neoxten',
  'proof',
  `otp-spam-hint-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

const HINT_NEEDLES = [
  'Check Spam, Junk or Promotions',
  'Our code often lands outside the inbox',
  'Spam, Junk, Promotions',
  'Controlla Spam',
  'Revisa Spam',
  'Verifica Spam',
  'Prüfe Spam',
  'Vérifie Spam',
  'Verifică Spam',
];

function decodeUi(value) {
  return String(value || '')
    .replace(/&#10;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n/g, ' ');
}

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

function uiBlob(nodes) {
  return nodes.map((n) => decodeUi(`${n.text || ''} ${n.contentDesc || ''}`)).join(' | ');
}

function hintVisible(nodes) {
  const blob = uiBlob(nodes).toLowerCase();
  return HINT_NEEDLES.find((n) => blob.includes(n.toLowerCase())) || null;
}

function findExactLabel(nodes, labels) {
  const wants = labels.map(normalizeText).filter(Boolean);
  for (const n of nodes) {
    if (n.packageName !== PKG || !n.bounds) continue;
    const hay = [n.text, n.contentDesc]
      .map((v) => normalizeText(decodeUi(v)))
      .filter(Boolean);
    for (const h of hay) {
      if (wants.includes(h) || wants.some((w) => h === `${w} ${w}`)) return n;
    }
  }
  return null;
}

async function waitTap(deviceId, labels, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  const expanded = labels.flatMap((l) => [l, l.replace(/&/g, '&amp;'), decodeUi(l)]);
  while (Date.now() - start < timeoutMs) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'wt').xml);
    let n = findNodeByText(nodes, expanded, { packageName: PKG });
    if (!n?.bounds) n = findExactLabel(nodes, labels);
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
      await sleep(1200);
      return true;
    }
    await sleep(700);
  }
  return false;
}

function isLoginScreen(nodes) {
  const blob = uiBlob(nodes);
  const hasEmail = nodes.some(
    (n) =>
      n.packageName === PKG &&
      n.className === 'android.widget.EditText' &&
      !n.password &&
      n.bounds,
  );
  const hasPass = nodes.some(
    (n) =>
      n.packageName === PKG &&
      n.className === 'android.widget.EditText' &&
      n.password &&
      n.bounds,
  );
  const hasForgot = /forgot password/i.test(blob);
  const hasLoginCta = Boolean(findExactLabel(nodes, ['Login']));
  return hasEmail && hasPass && (hasForgot || hasLoginCta);
}

async function reachLogin(deviceId) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'reach').xml);
    const blob = uiBlob(nodes);
    if (isLoginScreen(nodes)) return true;
    if (/privacy|usage analytics|save &/i.test(blob)) {
      await waitTap(deviceId, ['Save & continue', 'Save & Continue']);
      continue;
    }
    if (/choose your language/i.test(blob)) {
      await waitTap(deviceId, ['Continue']);
      continue;
    }
    if (findExactLabel(nodes, ['Next'])) {
      await waitTap(deviceId, ['Next']);
      continue;
    }
    if (/get started/i.test(blob)) {
      await waitTap(deviceId, ['Get Started', 'Get started']);
      continue;
    }
    if (findExactLabel(nodes, ['Profile', 'Home', 'Learn'])) {
      const tab = findExactLabel(nodes, ['Profile']);
      if (tab?.bounds) {
        tapBounds(tab.bounds, { deviceId });
        await sleep(1000);
        for (let i = 0; i < 5; i += 1) {
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
          await sleep(500);
          if (await waitTap(deviceId, ['Sign Out', 'Sign out'], { timeoutMs: 3000 })) {
            await waitTap(deviceId, ['Sign Out', 'Confirm', 'Yes', 'OK'], {
              timeoutMs: 4000,
            });
            await sleep(1500);
            break;
          }
        }
      }
      continue;
    }
    await sleep(900);
  }
  return false;
}

async function main() {
  bootstrapPlastyPesaEnv();
  mkdirSync(OUT_DIR, { recursive: true });
  const deviceId = getAdbDevice();
  if (!deviceId) throw new Error('No adb device');
  console.log(JSON.stringify({ deviceId, out: OUT_DIR }));

  spawnSync('adb', ['-s', deviceId, 'shell', 'am', 'force-stop', PKG], {
    stdio: 'inherit',
  });
  launch(deviceId);
  await sleep(10000);
  shot(deviceId, '00-start.png');

  const onLogin = await reachLogin(deviceId);
  if (!onLogin) {
    shot(deviceId, 'fail-login.png');
    throw new Error('Could not reach login');
  }
  shot(deviceId, '01-login.png');

  // Forgot Password — pre-send spam notice
  const forgot = await waitTap(
    deviceId,
    ['Forgot Password?', 'Forgot Password', 'Ai uitat parola?'],
    { timeoutMs: 12000 },
  );
  if (!forgot) throw new Error('Forgot Password link missing');
  await sleep(1200);
  let nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'forgot').xml);
  let hit = hintVisible(nodes);
  shot(deviceId, '02-forgot-spam.png');
  if (!hit) {
    console.error('forgot blob', uiBlob(nodes).slice(0, 700));
    throw new Error('Spam notice missing on Forgot Password');
  }
  console.log(JSON.stringify({ surface: 'forgot_password', matchedHint: hit }));

  // Back → Sign Up path (signup email = UserCheckScreen)
  spawnSync('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', '4']);
  await sleep(1000);
  const signup = await waitTap(deviceId, ['Sign Up', 'sign up', 'Înregistrează-te'], {
    timeoutMs: 12000,
  });
  if (signup) {
    // May hit language/market steps — keep advancing toward email
    for (let i = 0; i < 6; i += 1) {
      nodes = parseUiNodes(dumpUiHierarchy(deviceId, `su-${i}`).xml);
      hit = hintVisible(nodes);
      if (hit) break;
      if (await waitTap(deviceId, ['Continue', 'Next', 'English'], { timeoutMs: 2500 })) {
        continue;
      }
      // Kenya / Europe market cards — tap Continue-like CTAs if present
      await sleep(800);
    }
    shot(deviceId, '03-signup-spam.png');
    nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'signup').xml);
    hit = hintVisible(nodes);
    if (!hit) {
      console.error('signup blob', uiBlob(nodes).slice(0, 700));
      throw new Error('Spam notice missing on signup email screen');
    }
    console.log(JSON.stringify({ surface: 'signup_email', matchedHint: hit }));
  } else {
    console.warn('Sign Up not reached — forgot-password proof stands');
  }

  console.log(JSON.stringify({ pass: true, proofDir: OUT_DIR }));
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
