#!/usr/bin/env node
/**
 * Uses ALL CREDENTIALS folder (via credential-registry) + API login check +
 * optional cold install (pm clear) + ADB UI: language → skip onboarding →
 * email/password → Login. Stops with exit 2 if 2FA / unexpected screen.
 *
 * Env:
 *   PLASTYPESA_E2E_CLEAR_APP=1   — adb pm clear before run (default: 0)
 *   PLASTYPESA_ANDROID_DEVICE   — serial (optional)
 */
import { spawnSync } from 'node:child_process';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { loadMobileAppUserCredentials } from './credential-registry.mjs';
import { getConfig } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';
import {
  adb,
  dumpUiHierarchy,
  parseUiNodes,
  findNodeByText,
  tapText,
  pasteText,
  typeText,
  sleep,
  getAdbDevice,
  swipeUp,
  swipeDown,
  tapBounds,
  normalizeText,
  buildTextCandidates,
  waitForNodeByText,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';

function hasTwoFactorUi(nodes) {
  const blob = nodes.map((n) => `${n.text} ${n.contentDesc}`).join(' ').toLowerCase();
  return (
    blob.includes('two-factor') ||
    blob.includes('2fa') ||
    blob.includes('authenticator') ||
    blob.includes('verification code') ||
    blob.includes('totp')
  );
}

/** Flutter sometimes exposes the primary CTA as a Button with content-desc "Login". */
function findLoginButtonBounds(nodes) {
  for (const n of nodes) {
    if (n.className !== 'android.widget.Button' || !n.bounds) continue;
    const d = normalizeText(n.contentDesc || n.text || '');
    if (d === 'login' || d.includes('log in') || d.includes('sign in')) {
      return n.bounds;
    }
  }
  return null;
}

function findPasswordEditBounds(nodes) {
  for (const n of nodes) {
    if (n.className === 'android.widget.EditText' && n.password && n.bounds) {
      return n.bounds;
    }
  }
  return null;
}

function findFirstPlainEditBounds(nodes) {
  for (const n of nodes) {
    if (
      n.packageName === PKG &&
      n.className === 'android.widget.EditText' &&
      !n.password &&
      n.bounds
    ) {
      return n.bounds;
    }
  }
  return null;
}

function countPkgNodes(nodes) {
  return nodes.filter((n) => n.packageName === PKG).length;
}

/** Flutter often needs several seconds before uiautomator exposes the real tree. */
async function waitForFlutterSurface(deviceId, minNodes = 6, timeoutMs = 50_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const dump = dumpUiHierarchy(deviceId, 'flutter-surface-wait');
    const n = countPkgNodes(parseUiNodes(dump.xml));
    if (n >= minNodes) {
      return true;
    }
    await sleep(900);
  }
  return false;
}

async function main() {
  bootstrapPlastyPesaEnv();
  const deviceId = getAdbDevice();
  if (!deviceId) {
    console.error('[device-login-e2e] No adb device.');
    process.exit(1);
  }

  let mobile;
  try {
    mobile = loadMobileAppUserCredentials();
  } catch (e) {
    console.error('[device-login-e2e] Credentials:', e.message);
    process.exit(1);
  }

  process.env.PLASTYPESA_TEST_EMAIL = mobile.email;
  process.env.PLASTYPESA_TEST_PASSWORD = mobile.password;
  const cfg = getConfig();
  const auth = await resolvePlastyPesaAuth(cfg);
  if (!auth.authHeaders) {
    console.error('[device-login-e2e] API login failed:', auth.authError || auth.authSource);
    process.exit(1);
  }
  console.log('[device-login-e2e] API login OK —', auth.authSource);

  if (process.env.PLASTYPESA_E2E_CLEAR_APP === '1') {
    console.log('[device-login-e2e] pm clear', PKG);
    spawnSync('adb', ['-s', deviceId, 'shell', 'pm', 'clear', PKG], { stdio: 'inherit' });
    await sleep(1500);
  }

  // Match a user tapping the launcher icon (more reliable than explicit activity on some OEMs).
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
  await sleep(5200);
  const surfaced = await waitForFlutterSurface(deviceId, 6, 55_000);
  if (!surfaced) {
    console.warn('[device-login-e2e] UI tree still thin — continuing (retries below).');
  }

  // Language → Continue
  let ok = await tapText(['Continue', 'Continuă', 'Continuar', 'Weiter', 'Continuer'], {
    deviceId,
    timeoutMs: 20000,
    label: 'phase-language-continue',
  });
  if (!ok) {
    console.log('[device-login-e2e] No Continue (maybe already past language).');
  }
  await sleep(1200);

  // Onboarding: 3 pages — Next, Next, Get Started (Skip tap is unreliable; full-screen image hijacks "Skip" in content-desc)
  for (let step = 0; step < 2; step += 1) {
    ok = await tapText(
      ['Next', 'Următorul', 'Weiter', 'Siguiente', 'Suivant', 'Avanti', 'Próximo'],
      { deviceId, timeoutMs: 15000, label: `onboarding-next-${step}` },
    );
    if (!ok) {
      console.log(`[device-login-e2e] Onboarding Next missing at step ${step} — trying Get Started.`);
      break;
    }
    await sleep(1100);
  }
  ok = await tapText(
    [
      'Get Started',
      'Get started',
      'Începe',
      'Inizia',
      'Comenzar',
      'Commencer',
      'Loslegen',
      'Começar',
    ],
    { deviceId, timeoutMs: 20000, label: 'onboarding-get-started' },
  );
  if (!ok) {
    console.log('[device-login-e2e] Get Started not found — trying Skip to login.');
    await tapText(['Skip', 'Sari', 'Überspringen', 'Omitir'], {
      deviceId,
      timeoutMs: 10000,
      label: 'onboarding-skip-fallback',
    });
  }
  await sleep(2000);

  // After pm clear, Android backup sometimes restores app data — user may already be on the main shell.
  let probe = dumpUiHierarchy(deviceId, 'post-onboarding-probe');
  let probeNodes = parseUiNodes(probe.xml);
  const onMainShell = findNodeByText(probeNodes, ['leaderboard', 'clasament', 'home', 'acasă', 'quizzes', 'chestionare'], {
    packageName: PKG,
  });
  if (onMainShell) {
    console.log('[device-login-e2e] PASS — already on main shell (session restored or prior login).');
    process.exit(0);
  }

  const emailTapCandidates = [
    ...buildTextCandidates(['enter_email', 'email_label', 'welcome_back'], [
      'Enter Email',
      'enter email',
      'Email',
      'E-mail',
      'Welcome',
      'Back',
    ]),
  ];

  ok = await tapText(emailTapCandidates, {
    deviceId,
    timeoutMs: 22_000,
    label: 'phase-email-field',
    packageName: PKG,
  });

  if (!ok) {
    let focused = false;
    for (let attempt = 0; attempt < 6 && !focused; attempt += 1) {
      if (attempt > 0) {
        await swipeUp({ deviceId });
        await sleep(600);
      }
      const dump = dumpUiHierarchy(deviceId, `email-fallback-${attempt}`);
      const nodes = parseUiNodes(dump.xml);
      const b = findFirstPlainEditBounds(nodes);
      if (b) {
        tapBounds(b, { deviceId });
        focused = true;
        break;
      }
      await swipeDown({ deviceId });
      await sleep(800);
    }
    if (!focused) {
      const w = await waitForNodeByText(emailTapCandidates, {
        deviceId,
        timeoutMs: 15_000,
        label: 'phase-email-retry',
        packageName: PKG,
      });
      if (w?.node?.bounds) {
        tapBounds(w.node.bounds, { deviceId });
        focused = true;
      }
    }
    if (!focused) {
      const dump = dumpUiHierarchy(deviceId, 'login-miss-email');
      console.error('[device-login-e2e] Could not find email field. XML:', dump.localPath);
      process.exit(2);
    }
  }

  await sleep(500);
  await typeText(mobile.email, { deviceId, perCharacter: true, charDelayMs: 28 });
  await sleep(800);

  const passwordTapCandidates = [
    ...buildTextCandidates(['enter_password'], [
      'Enter Password',
      'Password',
      'enter password',
      'Parolă',
      'Parola',
      'Mot de passe',
    ]),
  ];
  await tapText(passwordTapCandidates, {
    deviceId,
    timeoutMs: 14_000,
    label: 'phase-password-field',
    packageName: PKG,
  });
  await sleep(400);
  let prePwd = dumpUiHierarchy(deviceId, 'pre-password-fill');
  const pwdBounds = findPasswordEditBounds(parseUiNodes(prePwd.xml));
  if (pwdBounds) {
    tapBounds(pwdBounds, { deviceId });
    await sleep(300);
  }
  // Password: prefer typing — many devices block paste into password fields.
  console.log('[device-login-e2e] Entering password via per-character input.');
  await typeText(mobile.password, { deviceId, perCharacter: true, charDelayMs: 35 });
  await sleep(600);

  // PrimaryButton often lacks a11y text — scroll then try label match + center tap.
  await swipeUp({ deviceId });
  await sleep(400);
  await swipeUp({ deviceId });
  await sleep(500);

  let dump = dumpUiHierarchy(deviceId, 'pre-login-tap');
  let nodes = parseUiNodes(dump.xml);
  let loginB = findLoginButtonBounds(nodes);
  if (loginB) {
    console.log('[device-login-e2e] Tapping Login button by parsed bounds.');
    tapBounds(loginB, { deviceId });
  } else {
    ok = await tapText(
      ['Login', 'Sign In', 'Log in', 'Conectează-te', 'Conecteaza-te', 'Entrar', 'Se connecter'],
      {
        deviceId,
        timeoutMs: 12000,
        label: 'phase-login-button',
      },
    );
    if (!ok) {
      const w = 720;
      const guessTap = { centerX: Math.round(w / 2), centerY: 1105 };
      console.log('[device-login-e2e] Fallback tap center of typical Login row.');
      tapBounds(guessTap, { deviceId });
    }
  }

  await sleep(4500);
  dump = dumpUiHierarchy(deviceId, 'post-login');
  nodes = parseUiNodes(dump.xml);
  if (hasTwoFactorUi(nodes)) {
    console.error('[device-login-e2e] Stopped: 2FA / verification screen (manual OTP required).');
    process.exit(2);
  }

  // Home tab / Romanian Acasă / English Home
  const homeLike = findNodeByText(nodes, ['Acasă', 'Home', 'Leaderboard', 'Clasament'], {
    packageName: PKG,
  });
  if (homeLike) {
    console.log('[device-login-e2e] PASS — post-login UI shows main app chrome.');
    process.exit(0);
  }

  console.error(
    '[device-login-e2e] FAIL — after login tap, main shell not detected. UI dump:',
    dump.localPath,
  );
  process.exit(2);
}

await main();
