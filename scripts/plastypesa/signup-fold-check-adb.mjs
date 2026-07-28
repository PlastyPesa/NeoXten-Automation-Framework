#!/usr/bin/env node
/**
 * ADB: signup after 2-screen split (market → email).
 * Asserts email field + Verify CTA are fully on-screen without scrolling.
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
  `signup-fold-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);

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
  return nodes
    .map((n) => decodeUi(`${n.text || ''} ${n.contentDesc || ''}`))
    .join(' | ');
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
  const expanded = labels.flatMap((l) => [
    l,
    l.replace(/&/g, '&amp;'),
    decodeUi(l),
  ]);
  while (Date.now() - start < timeoutMs) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'wt').xml);
    let n = findNodeByText(nodes, expanded, { packageName: PKG });
    if (!n?.bounds) n = findExactLabel(nodes, labels);
    if (!n?.bounds) {
      n = nodes.find((node) => {
        if (node.packageName !== PKG || !node.bounds || !node.clickable)
          return false;
        const h = normalizeText(
          decodeUi(node.contentDesc || node.text || ''),
        );
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
  const hasSignUp = /sign up|înregistrează|registrati|registrarse|anmelden|s'inscrire|inscrever/i.test(
    blob,
  );
  return hasEmail && hasPass && (hasForgot || hasLoginCta) && hasSignUp;
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
          if (
            await waitTap(deviceId, ['Sign Out', 'Sign out'], {
              timeoutMs: 3000,
            })
          ) {
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

function screenHeight(nodes) {
  let maxY = 0;
  for (const n of nodes) {
    if (n.bounds?.bottom > maxY) maxY = n.bounds.bottom;
  }
  return maxY || 1640;
}

function analyzeEmailFold(nodes) {
  const h = screenHeight(nodes);
  const emailField = nodes.find(
    (n) =>
      n.packageName === PKG &&
      n.className === 'android.widget.EditText' &&
      !n.password &&
      n.bounds,
  );
  const verify =
    findExactLabel(nodes, ['Verify OTP', 'Verify', 'Verifică OTP', 'Verifica']) ||
    nodes.find((n) => {
      if (n.packageName !== PKG || !n.clickable || !n.bounds) return false;
      const t = decodeUi(n.text || n.contentDesc || '').toLowerCase();
      return /verify|otp|verif/.test(t);
    });

  const emailVisible =
    emailField?.bounds &&
    emailField.bounds.top >= 0 &&
    emailField.bounds.bottom <= h - 8 &&
    emailField.bounds.bottom - emailField.bounds.top >= 40;
  const verifyVisible =
    verify?.bounds &&
    verify.bounds.top >= 0 &&
    verify.bounds.bottom <= h - 8 &&
    verify.bounds.bottom - verify.bounds.top >= 36;

  return {
    screenH: h,
    hasEmail: Boolean(emailField),
    hasVerify: Boolean(verify),
    emailBounds: emailField?.bounds || null,
    verifyBounds: verify?.bounds || null,
    emailFullyVisible: Boolean(emailVisible),
    verifyFullyVisible: Boolean(verifyVisible),
    foldOk: Boolean(emailVisible && verifyVisible),
    blobSample: uiBlob(nodes).slice(0, 900),
  };
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

  if (
    !(await waitTap(deviceId, ['Sign Up', 'sign up', 'Înregistrează-te'], {
      timeoutMs: 12000,
    }))
  ) {
    throw new Error('Sign Up link missing');
  }
  await sleep(1000);

  // Language screen → Continue
  if (
    !(await waitTap(deviceId, ['Continue', 'Continua', 'Continuar', 'Weiter'], {
      timeoutMs: 10000,
    }))
  ) {
    throw new Error('Language Continue missing');
  }
  await sleep(1000);
  shot(deviceId, '02-market.png');

  // Market: Kenya + Continue
  await waitTap(
    deviceId,
    ['I live in Kenya — weekly M-Pesa rewards', 'Kenya'],
    { timeoutMs: 8000 },
  );
  await sleep(800);
  if (
    !(await waitTap(deviceId, ['Continue', 'Continua', 'Continuar', 'Weiter'], {
      timeoutMs: 8000,
    }))
  ) {
    throw new Error('Market Continue missing');
  }
  await sleep(1200);

  const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'email').xml);
  shot(deviceId, '03-email-fold.png');
  const fold = analyzeEmailFold(nodes);
  const result = {
    pass: fold.foldOk,
    splitScreens: true,
    ...fold,
  };
  writeFileSync(join(OUT_DIR, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!fold.foldOk) {
    console.error('Email screen still not fully visible');
    process.exit(2);
  }
  console.log('Email screen fold OK');
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
