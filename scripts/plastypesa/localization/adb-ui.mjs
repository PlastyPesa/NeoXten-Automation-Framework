import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureAdbArtifacts, getAdbDevice } from './adb-artifacts.mjs';
import { defaultMobileRoot, getLocalizationOutDir, writeJson } from './config.mjs';

export { getAdbDevice };

const TRANSLATION_FILES = {
  en_US: 'en.dart',
  it_IT: 'it.dart',
  es_ES: 'es.dart',
  de_DE: 'de.dart',
  fr_FR: 'fr.dart',
  pt_PT: 'pt.dart',
  ro_RO: 'ro.dart',
};

export function adb(args, options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  if (!deviceId) {
    throw new Error('No adb device in "device" state.');
  }
  const finalArgs = ['-s', deviceId, ...args];
  return spawnSync('adb', finalArgs, {
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
}

export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function normalizeText(value) {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function getDisplaySize(deviceId = getAdbDevice()) {
  const result = adb(['shell', 'wm', 'size'], { deviceId });
  const match = `${result.stdout || ''}`.match(/(\d+)x(\d+)/);
  if (!match) {
    return { width: 1080, height: 1920 };
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

export function dumpUiHierarchy(deviceId = getAdbDevice(), label = 'ui-dump') {
  const outDir = getLocalizationOutDir();
  const remotePath = `/sdcard/${label}.xml`;
  adb(['shell', 'uiautomator', 'dump', remotePath], { deviceId });
  const pulled = adb(['exec-out', 'cat', remotePath], {
    deviceId,
    encoding: 'utf8',
  });
  const xml = `${pulled.stdout || ''}`;
  const localPath = resolve(outDir, `${label}.xml`);
  writeFileSync(localPath, xml, 'utf8');
  return { xml, localPath };
}

function getAttr(attributes, name) {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? match[1] : '';
}

function parseBounds(boundsText) {
  const match = boundsText.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  return {
    left,
    top,
    right,
    bottom,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
  };
}

export function parseUiNodes(xml) {
  const nodes = [];
  const matches = xml.matchAll(/<node\b([^>]*?)(?:\/>|>)/g);
  for (const match of matches) {
    const attributes = match[1];
    const bounds = parseBounds(getAttr(attributes, 'bounds'));
    nodes.push({
      text: getAttr(attributes, 'text'),
      contentDesc: getAttr(attributes, 'content-desc'),
      resourceId: getAttr(attributes, 'resource-id'),
      className: getAttr(attributes, 'class'),
      packageName: getAttr(attributes, 'package'),
      clickable: getAttr(attributes, 'clickable') === 'true',
      password: getAttr(attributes, 'password') === 'true',
      bounds,
    });
  }
  return nodes;
}

export function findNodeByText(nodes, candidates, options = {}) {
  const normalizedCandidates = candidates.map(normalizeText).filter(Boolean);
  let bestMatch = null;
  for (const node of nodes) {
    if (options.packageName && node.packageName !== options.packageName) {
      continue;
    }
    const haystacks = [node.text, node.contentDesc].map(normalizeText);
    for (const haystack of haystacks) {
      if (!haystack) continue;
      const exact = normalizedCandidates.includes(haystack);
      const partial = normalizedCandidates.some((candidate) => haystack.includes(candidate));
      if (!exact && !partial) {
        continue;
      }

      const score = [
        exact ? 2 : 0,
        node.clickable ? 1 : 0,
        -haystack.length,
      ];
      if (!bestMatch || isBetterScore(score, bestMatch.score)) {
        bestMatch = { node, score };
      }
      break;
    }
  }
  return bestMatch?.node || null;
}

function isBetterScore(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) {
      return (left[index] ?? 0) > (right[index] ?? 0);
    }
  }
  return false;
}

export async function waitForNodeByText(candidates, options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  const timeoutMs = options.timeoutMs ?? 12000;
  const pollMs = options.pollMs ?? 800;
  const label = options.label ?? 'wait-node';
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const dump = dumpUiHierarchy(deviceId, label);
    const nodes = parseUiNodes(dump.xml);
    const node = findNodeByText(nodes, candidates, {
      packageName: options.packageName,
    });
    if (node?.bounds) {
      return { node, nodes, xmlPath: dump.localPath };
    }
    await sleep(pollMs);
  }
  return null;
}

export async function tapText(candidates, options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  const found = await waitForNodeByText(candidates, {
    deviceId,
    timeoutMs: options.timeoutMs,
    label: options.label ?? 'tap-target',
    packageName: options.packageName,
  });
  if (!found?.node?.bounds) {
    return false;
  }
  adb(
    [
      'shell',
      'input',
      'tap',
      `${found.node.bounds.centerX}`,
      `${found.node.bounds.centerY}`,
    ],
    { deviceId },
  );
  await sleep(options.afterMs ?? 1000);
  return true;
}

export function findNodesByClass(nodes, className, options = {}) {
  return nodes.filter((node) => {
    if (node.className !== className) return false;
    if (options.packageName && node.packageName !== options.packageName) {
      return false;
    }
    return Boolean(node.bounds);
  });
}

export function tapBounds(bounds, options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  if (!bounds) return false;
  adb(
    ['shell', 'input', 'tap', `${bounds.centerX}`, `${bounds.centerY}`],
    { deviceId },
  );
  return true;
}

export async function tapNode(node, options = {}) {
  if (!node?.bounds) return false;
  const ok = tapBounds(node.bounds, options);
  await sleep(options.afterMs ?? 700);
  return ok;
}

export async function typeText(text, options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  const value = String(text);
  if (options.perCharacter) {
    for (const char of value) {
      adb(['shell', 'input', 'text', encodeAdbInputText(char)], {
        deviceId,
      });
      await sleep(options.charDelayMs ?? 140);
    }
    await sleep(options.afterMs ?? 600);
    return;
  }

  adb(['shell', 'input', 'text', encodeAdbInputText(value)], {
    deviceId,
  });
  await sleep(options.afterMs ?? 600);
}

export async function pasteText(text, options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  adb(['shell', 'cmd', 'clipboard', 'set', 'text', String(text)], {
    deviceId,
  });
  await sleep(options.afterMsBeforePaste ?? 350);
  adb(['shell', 'input', 'keyevent', '279'], { deviceId });
  await sleep(options.afterMs ?? 700);
}

function encodeAdbInputText(value) {
  return String(value)
    .replace(/ /g, '%s')
    .replace(/([?!@&<>|()%;])/g, '\\$1');
}

export async function pressKey(keyCode, options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  adb(['shell', 'input', 'keyevent', `${keyCode}`], { deviceId });
  await sleep(options.afterMs ?? 400);
}

export async function swipeUp(options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  const size = getDisplaySize(deviceId);
  const x = Math.round(size.width / 2);
  const startY = Math.round(size.height * 0.78);
  const endY = Math.round(size.height * 0.32);
  const duration = options.durationMs ?? 650;
  adb(
    [
      'shell',
      'input',
      'swipe',
      `${x}`,
      `${startY}`,
      `${x}`,
      `${endY}`,
      `${duration}`,
    ],
    { deviceId },
  );
  await sleep(options.afterMs ?? 1000);
}

/** Scroll content upward (finger moves down) — reveals fields above the fold. */
export async function swipeDown(options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  const size = getDisplaySize(deviceId);
  const x = Math.round(size.width / 2);
  const startY = Math.round(size.height * 0.32);
  const endY = Math.round(size.height * 0.78);
  const duration = options.durationMs ?? 650;
  adb(
    [
      'shell',
      'input',
      'swipe',
      `${x}`,
      `${startY}`,
      `${x}`,
      `${endY}`,
      `${duration}`,
    ],
    { deviceId },
  );
  await sleep(options.afterMs ?? 1000);
}

export function forceStopAndLaunchApp(options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  const packageName = options.packageName ?? 'com.app.plasty_pesa';
  adb(['shell', 'am', 'force-stop', packageName], { deviceId });
  adb(
    ['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'],
    {
      deviceId,
    },
  );
}

export function resolvePreferredApkPath() {
  const mobileRoot = defaultMobileRoot();
  const releaseApk = resolve(mobileRoot, 'build/app/outputs/flutter-apk/app-release.apk');
  if (existsSync(releaseApk)) {
    return releaseApk;
  }
  return resolve(mobileRoot, 'build/app/outputs/flutter-apk/app-debug.apk');
}

export function installApkIfNeeded(options = {}) {
  const deviceId = options.deviceId || getAdbDevice();
  const packageName = options.packageName ?? 'com.app.plasty_pesa';
  const forceInstall = options.forceInstall === true;
  if (!forceInstall && isPackageInstalled(packageName, deviceId)) {
    return { installed: false, packageName };
  }
  const apkPath = options.apkPath || resolvePreferredApkPath();
  const result = adb(['install', '-r', apkPath], {
    deviceId,
    encoding: 'utf8',
  });
  if (result.status !== 0 || !`${result.stdout || ''}${result.stderr || ''}`.includes('Success')) {
    throw new Error(
      `Failed to install ${packageName} from ${apkPath}: ${result.stdout || ''} ${result.stderr || ''}`.trim(),
    );
  }
  return { installed: true, packageName, apkPath };
}

export function isPackageInstalled(packageName, deviceId = getAdbDevice()) {
  const result = adb(['shell', 'pm', 'list', 'packages', packageName], {
    deviceId,
  });
  return `${result.stdout || ''}`.includes(`package:${packageName}`);
}

export function loadTranslationValue(localeCode, key) {
  const file = TRANSLATION_FILES[localeCode];
  if (!file) return null;
  const path = resolve(
    defaultMobileRoot(),
    'lib/core/translations',
    file,
  );
  const text = readFileSync(path, 'utf8');
  const singleLine = text.match(
    new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:\\s*'([^']*)'`),
  );
  if (singleLine) return singleLine[1];
  return null;
}

export function buildTextCandidates(keys, extras = []) {
  const values = new Set(extras);
  for (const key of keys) {
    for (const localeCode of Object.keys(TRANSLATION_FILES)) {
      const value = loadTranslationValue(localeCode, key);
      if (value) values.add(value);
    }
  }
  return [...values].filter(Boolean);
}

export function recordAdbStep(report, step) {
  report.steps.push({
    at: new Date().toISOString(),
    ...step,
  });
}

export function writeAdbReport(name, report) {
  const outDir = getLocalizationOutDir();
  writeJson(resolve(outDir, `${name}.json`), report);
}

export async function captureStepArtifacts(label) {
  return captureAdbArtifacts(label);
}
