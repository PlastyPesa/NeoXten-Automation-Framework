#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  buildTextCandidates,
  captureStepArtifacts,
  forceStopAndLaunchApp,
  findNodesByClass,
  getAdbDevice,
  installApkIfNeeded,
  parseUiNodes,
  pressKey,
  recordAdbStep,
  sleep,
  swipeUp,
  tapNode,
  tapText,
  typeText,
  waitForNodeByText,
  writeAdbReport,
} from './adb-ui.mjs';
import { getLocalizationOutDir, writeText } from './config.mjs';
import { getPlastypesaPersona, rememberPersonaSession } from '../personas.mjs';

const APP_PACKAGE = 'com.app.plasty_pesa';

const SUPPORTED_LANGUAGE_NAMES = [
  'English',
  'Italiano',
  'Español',
  'Deutsch',
  'Français',
  'Português',
  'Română',
];

const TARGET_VISIBLE_LANGUAGE =
  process.env.PLASTYPESA_LOCALIZATION_ADB_LANGUAGE_NAME || 'Română';
const EXPECTED_BANNER_TITLE =
  (process.env.PLASTYPESA_LOCALIZATION_ADB_EXPECT_BANNER_TITLE || '').trim();
const EXPECTED_BANNER_MESSAGE =
  (process.env.PLASTYPESA_LOCALIZATION_ADB_EXPECT_BANNER_MESSAGE || '').trim();
const EXPECTED_BANNER_TIMEOUT_MS = Number(
  process.env.PLASTYPESA_LOCALIZATION_ADB_EXPECT_BANNER_TIMEOUT_MS || 20000,
);
const FORCE_INSTALL_MOBILE_APK =
  process.env.PLASTYPESA_LOCALIZATION_ADB_FORCE_INSTALL === '0' ? false : true;
const OVERRIDE_MOBILE_APK_PATH = (
  process.env.PLASTYPESA_LOCALIZATION_ADB_APK_PATH || ''
).trim();

function getLanguageScreenCandidates() {
  return [
    ...SUPPORTED_LANGUAGE_NAMES,
    ...buildTextCandidates(
      ['signup_choose_language_title', 'signup_choose_language_subtitle'],
      ['Select your language', 'Choose your preferred language to continue'],
    ),
  ];
}

function renderMarkdown(report) {
  const lines = [
    '# PlastyPesa ADB Visible Walkthrough',
    '',
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    `Device: ${report.deviceId}`,
    `Result: ${report.result}`,
    '',
    '## Steps',
    ...report.steps.map((step) => {
      const outcome = step.ok === false ? 'failed' : 'ok';
      const detail = step.detail ? ` - ${step.detail}` : '';
      return `- ${step.action}: ${outcome}${detail}`;
    }),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function hasSuccessfulStep(report, actions) {
  return report.steps.some(
    (step) => step.ok === true && actions.includes(step.action),
  );
}

async function maybeTap(candidates, report, action, detail) {
  const ok = await tapText(candidates, {
    timeoutMs: 10000,
    afterMs: 1200,
    label: action,
    packageName: APP_PACKAGE,
  });
  recordAdbStep(report, { action, detail, ok });
  return ok;
}

function loadMobileCredentials() {
  const { credentials } = getPlastypesaPersona('mobileUser');
  const { email, password } = credentials;
  return { email, password };
}

async function clearSystemUiAndRelaunch(report, action = 'dismiss-system-ui-overlay') {
  await pressKey(4, { afterMs: 500 });
  await pressKey(4, { afterMs: 500 });
  await pressKey(3, { afterMs: 900 });
  forceStopAndLaunchApp({ deviceId: report.deviceId, packageName: APP_PACKAGE });
  recordAdbStep(report, {
    action,
    ok: true,
    detail: 'cleared system overlays and relaunched app',
  });
  await sleep(4500);
}

function buildBannerMatchCandidates(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const words = text.split(' ').filter(Boolean);
  const candidates = new Set([text]);
  if (words.length >= 3) {
    candidates.add(words.slice(0, 3).join(' '));
  }
  if (words.length >= 4) {
    candidates.add(words.slice(0, 4).join(' '));
    candidates.add(words.slice(-4).join(' '));
  }
  if (words.length >= 6) {
    candidates.add(words.slice(0, 6).join(' '));
  }
  return [...candidates].filter((candidate) => candidate.length >= 8);
}

async function maybeVerifyExpectedBanner(report) {
  if (!EXPECTED_BANNER_TITLE && !EXPECTED_BANNER_MESSAGE) {
    return true;
  }

  const deadline = Date.now() + EXPECTED_BANNER_TIMEOUT_MS;
  let titleSeen = !EXPECTED_BANNER_TITLE;
  let messageSeen = !EXPECTED_BANNER_MESSAGE;
  const titleCandidates = buildBannerMatchCandidates(EXPECTED_BANNER_TITLE);
  const messageCandidates = buildBannerMatchCandidates(EXPECTED_BANNER_MESSAGE);

  while (Date.now() < deadline && (!titleSeen || !messageSeen)) {
    const titleMatch = !titleSeen
      ? await waitForNodeByText(titleCandidates, {
          packageName: APP_PACKAGE,
          timeoutMs: 2500,
          label: 'expected-banner-title',
        })
      : true;
    if (titleMatch) {
      titleSeen = true;
    }

    const messageMatch = !messageSeen
      ? await waitForNodeByText(messageCandidates, {
          packageName: APP_PACKAGE,
          timeoutMs: 2500,
          label: 'expected-banner-message',
        })
      : true;
    if (messageMatch) {
      messageSeen = true;
    }

    if (!titleSeen || !messageSeen) {
      await sleep(500);
    }
  }

  const ok = titleSeen && messageSeen;
  recordAdbStep(report, {
    action: 'verify-expected-banner',
    ok,
    detail: ok
      ? [EXPECTED_BANNER_TITLE, EXPECTED_BANNER_MESSAGE].filter(Boolean).join(' | ')
      : 'expected banner title/message not fully visible',
  });
  if (ok) {
    await captureStepArtifacts('verify-expected-banner');
  } else {
    report.result = 'FAIL';
  }
  return ok;
}

async function enterCredentialsIfVisible(report) {
  const loginScreen = await waitForNodeByText(
    buildTextCandidates(
      ['login_button'],
      [
        'Conectare',
        'Login',
        'E-mail',
        'Email',
        'Parola',
        'Password',
        'Welcome Back!!',
        'Forgot Password?',
        'Sign up.',
      ],
    ),
    {
      packageName: APP_PACKAGE,
      timeoutMs: 20000,
      label: 'login-screen',
    },
  );
  if (!loginScreen) {
    recordAdbStep(report, {
      action: 'detect-login-screen',
      ok: false,
    });
    return false;
  }

  const nodes = parseUiNodes(loginScreen.xmlPath ? readFileSync(loginScreen.xmlPath, 'utf8') : '');
  let editFields = findNodesByClass(nodes, 'android.widget.EditText', {
    packageName: APP_PACKAGE,
  });
  if (editFields.length < 1) {
    recordAdbStep(report, {
      action: 'locate-login-fields',
      ok: false,
    });
    return false;
  }

  const credentials = loadMobileCredentials();
  editFields = [...editFields].sort((left, right) => {
    return (left.bounds?.top || 0) - (right.bounds?.top || 0);
  });
  const emailField = editFields.find((field) => !field.password) || editFields[0];
  await tapNode(emailField, { afterMs: 700 });
  await typeText(credentials.email, {
    perCharacter: true,
    charDelayMs: 120,
    afterMs: 900,
  });
  recordAdbStep(report, { action: 'enter-email', ok: true });
  await pressKey(4, { afterMs: 700 });

  if (editFields.length < 2) {
    await swipeUp({ afterMs: 1200, durationMs: 850 });
  }
  const passwordScreen = await waitForNodeByText(
    ['Parola', 'Password', 'Conectare', 'Login'],
    {
      packageName: APP_PACKAGE,
      timeoutMs: 8000,
      label: 'password-screen',
    },
  );
  let passwordNodes = parseUiNodes(
    passwordScreen?.xmlPath ? readFileSync(passwordScreen.xmlPath, 'utf8') : '',
  );
  let passwordFields = findNodesByClass(passwordNodes, 'android.widget.EditText', {
    packageName: APP_PACKAGE,
  }).sort((left, right) => {
    return (left.bounds?.top || 0) - (right.bounds?.top || 0);
  });
  let passwordField =
    passwordFields.find((field) => field.password) ||
    passwordFields[passwordFields.length - 1];
  if (!passwordField || passwordField.text === credentials.email) {
    await swipeUp({ afterMs: 1200, durationMs: 850 });
    const passwordRetry = await waitForNodeByText(
      ['Parolă', 'Password', 'Conectare', 'Login'],
      {
        packageName: APP_PACKAGE,
        timeoutMs: 8000,
        label: 'password-screen-retry',
      },
    );
    passwordNodes = parseUiNodes(
      passwordRetry?.xmlPath ? readFileSync(passwordRetry.xmlPath, 'utf8') : '',
    );
    passwordFields = findNodesByClass(passwordNodes, 'android.widget.EditText', {
      packageName: APP_PACKAGE,
    }).sort((left, right) => {
      return (left.bounds?.top || 0) - (right.bounds?.top || 0);
    });
    passwordField =
      passwordFields.find((field) => field.password) ||
      passwordFields.find((field) => field.text !== credentials.email) ||
      passwordFields[passwordFields.length - 1];
  }
  if (!passwordField) {
    recordAdbStep(report, {
      action: 'locate-password-field',
      ok: false,
    });
    return false;
  }

  await tapNode(passwordField, { afterMs: 700 });
  await typeText(credentials.password, {
    perCharacter: true,
    charDelayMs: 140,
    afterMs: 900,
  });
  recordAdbStep(report, { action: 'enter-password', ok: true });
  await pressKey(4, { afterMs: 700 });

  const loginTapped = await maybeTap(
    buildTextCandidates(['login_button'], ['Conectare', 'Login']),
    report,
    'submit-login',
  );
  if (!loginTapped) return false;

  const authSignal = await waitForNodeByText(
    buildTextCandidates(['nav_home', 'nav_profile', 'community'], ['Quiz']),
    {
      packageName: APP_PACKAGE,
      timeoutMs: 25000,
      label: 'post-login-shell',
    },
  );
  const ok = Boolean(authSignal);
  recordAdbStep(report, {
    action: 'post-login-shell',
    ok,
  });
  if (!ok) {
    report.result = 'FAIL';
  }
  return ok;
}

async function runAuthenticatedWalkthrough(report) {
  await maybeVerifyExpectedBanner(report);

  const tabSteps = [
    { action: 'tap-home', candidates: buildTextCandidates(['nav_home']) },
    { action: 'tap-learn', candidates: buildTextCandidates(['nav_learn']) },
    { action: 'tap-quiz', candidates: ['Quiz'] },
    { action: 'tap-activity', candidates: buildTextCandidates(['nav_activity']) },
    {
      action: 'tap-community',
      candidates: buildTextCandidates(['community', 'eco_discussions']),
    },
    { action: 'tap-profile', candidates: buildTextCandidates(['nav_profile']) },
  ];

  for (const step of tabSteps) {
    const tapped = await maybeTap(step.candidates, report, step.action);
    if (!tapped) continue;
    await captureStepArtifacts(step.action);
    await swipeUp({ afterMs: 1200, durationMs: 850 });
    recordAdbStep(report, {
      action: `${step.action}-scroll`,
      detail: 'visible swipe up',
      ok: true,
    });
  }

  const openedLanguage = await maybeTap(
    buildTextCandidates(['language']),
    report,
    'open-language-picker',
  );
  if (openedLanguage) {
    await captureStepArtifacts('open-language-picker');
    const switched = await maybeTap(
      [TARGET_VISIBLE_LANGUAGE],
      report,
      'switch-language',
      `target ${TARGET_VISIBLE_LANGUAGE}`,
    );
    if (switched) {
      await captureStepArtifacts('switch-language');
    }
  }
}

async function runGuestWalkthrough(report) {
  const languageScreenCandidates = getLanguageScreenCandidates();
  let sawLanguageScreen = await waitForNodeByText(languageScreenCandidates, {
    timeoutMs: 12000,
    label: 'guest-language-screen',
    packageName: APP_PACKAGE,
  });
  if (!sawLanguageScreen) {
    await sleep(3000);
    sawLanguageScreen = await waitForNodeByText(languageScreenCandidates, {
      timeoutMs: 10000,
      label: 'guest-language-screen-retry',
      packageName: APP_PACKAGE,
    });
  }
  if (!sawLanguageScreen) {
    await clearSystemUiAndRelaunch(report, 'guest-language-relaunch');
    sawLanguageScreen = await waitForNodeByText(languageScreenCandidates, {
      timeoutMs: 15000,
      label: 'guest-language-screen-relaunch',
      packageName: APP_PACKAGE,
    });
  }
  if (!sawLanguageScreen) {
    recordAdbStep(report, {
      action: 'guest-language-screen',
      ok: false,
      detail: 'did not find locale picker',
    });
    report.result = 'FAIL';
    return;
  }

  recordAdbStep(report, {
    action: 'guest-language-screen',
    ok: true,
  });
  await captureStepArtifacts('guest-language-screen');

  let switchedLanguage = await maybeTap(
    [TARGET_VISIBLE_LANGUAGE],
    report,
    'guest-switch-language',
  );
  if (!switchedLanguage) {
    await swipeUp({ afterMs: 1200, durationMs: 900 });
    recordAdbStep(report, {
      action: 'guest-language-scroll',
      ok: true,
      detail: `searching for ${TARGET_VISIBLE_LANGUAGE}`,
    });
    switchedLanguage = await maybeTap(
      [TARGET_VISIBLE_LANGUAGE],
      report,
      'guest-switch-language-retry',
    );
  }
  await captureStepArtifacts('guest-switch-language');
  await maybeTap(buildTextCandidates(['signup_continue']), report, 'guest-continue');
  await captureStepArtifacts('guest-continue');

  for (const step of [
    'guest-onboarding-next-1',
    'guest-onboarding-next-2',
    'guest-onboarding-next-3',
    'guest-onboarding-next-4',
    'guest-onboarding-next-5',
  ]) {
    const moved = await maybeTap(
      ['Next', 'Următorul', 'Continue', 'Începe', 'Get Started'],
      report,
      step,
    );
    if (!moved) break;
    await captureStepArtifacts(step);
  }

  const loggedIn = await enterCredentialsIfVisible(report);
  if (loggedIn) {
    await runAuthenticatedWalkthrough(report);
  }
}

async function main() {
  const deviceId = getAdbDevice();
  if (!deviceId) {
    throw new Error('No adb device in "device" state.');
  }

  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: 'PASS',
    deviceId,
    targetLanguage: TARGET_VISIBLE_LANGUAGE,
    steps: [],
  };

  const installResult = installApkIfNeeded({
    deviceId,
    packageName: APP_PACKAGE,
    forceInstall: FORCE_INSTALL_MOBILE_APK,
    apkPath: OVERRIDE_MOBILE_APK_PATH || undefined,
  });
  recordAdbStep(report, {
    action: 'ensure-mobile-apk-installed',
    ok: true,
    detail: installResult.installed
      ? `installed apk from ${installResult.apkPath}`
      : 'already installed',
  });

  forceStopAndLaunchApp({ deviceId, packageName: APP_PACKAGE });
  recordAdbStep(report, { action: 'launch-app', ok: true });
  await sleep(3500);
  await captureStepArtifacts('adb-visible-launch');

  const languagePickerAtLaunch = await waitForNodeByText(getLanguageScreenCandidates(), {
    deviceId,
    timeoutMs: 4000,
    label: 'launch-language-screen',
    packageName: APP_PACKAGE,
  });

  if (languagePickerAtLaunch) {
    recordAdbStep(report, {
      action: 'detected-authenticated-shell',
      ok: false,
      detail: 'language picker visible at launch',
    });
    await runGuestWalkthrough(report);
  } else {
    const authSignal = await waitForNodeByText(
      buildTextCandidates(['nav_home', 'nav_profile', 'community'], ['Quiz']),
      {
        deviceId,
        timeoutMs: 10000,
        label: 'auth-signal',
        packageName: APP_PACKAGE,
      },
    );

    if (authSignal) {
      recordAdbStep(report, {
        action: 'detected-authenticated-shell',
        ok: true,
      });
      await runAuthenticatedWalkthrough(report);
    } else {
      recordAdbStep(report, {
        action: 'detected-authenticated-shell',
        ok: false,
        detail: 'trying login screen, then guest walkthrough',
      });
      await clearSystemUiAndRelaunch(report, 'pre-login-overlay-reset');
      const loggedIn = await enterCredentialsIfVisible(report);
      if (loggedIn) {
        await runAuthenticatedWalkthrough(report);
      } else {
        await runGuestWalkthrough(report);
      }
    }
  }

  if (!hasSuccessfulStep(report, ['detected-authenticated-shell', 'post-login-shell', 'guest-language-screen'])) {
    report.result = 'FAIL';
  }
  if (
    (EXPECTED_BANNER_TITLE || EXPECTED_BANNER_MESSAGE) &&
    !hasSuccessfulStep(report, ['verify-expected-banner'])
  ) {
    report.result = 'FAIL';
  }

  report.finishedAt = new Date().toISOString();
  rememberPersonaSession(
    hasSuccessfulStep(report, ['post-login-shell', 'enter-email']) ? 'mobileUser' : 'guest',
    {
      deviceId,
      targetLanguage: TARGET_VISIBLE_LANGUAGE,
      lastResult: report.result,
      lastFinishedAt: report.finishedAt,
    },
  );
  const outDir = getLocalizationOutDir();
  writeAdbReport('mobile-adb-visible', report);
  writeText(`${outDir}/mobile-adb-visible.md`, renderMarkdown(report));
  console.log(`[plastypesa-localization] ADB visible walkthrough written to ${outDir}`);
  process.exit(report.result === 'PASS' ? 0 : 1);
}

await main();
