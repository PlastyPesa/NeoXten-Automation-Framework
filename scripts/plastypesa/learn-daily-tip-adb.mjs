#!/usr/bin/env node
/**
 * ADB proof for P-LEARN-DAILY-TIP-CLIENT-FIX + P-LEARN-DAILY-TIPS-SURFACE.
 * Opens Learn tab ×2 and asserts a read-only Daily Tip card (not quiz trap).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
const OUT_DIR = join(process.cwd(), '.neoxten', 'proof');

const LEARN_LABELS = [
  'Learn',
  'Învață',
  'Invata',
  'Impara',
  'Aprender',
  'Lernen',
  'Apprendre',
  'Aprender',
];

const TIP_LABELS = [
  'Daily Tip',
  'Sfatul Zilei',
  'Consiglio del giorno',
  'Consejo del día',
  'Dica do dia',
  'Tipp des Tages',
  'Astuce du jour',
];

const READ_ONLY_NEEDLES = [
  'read only',
  'doar citire',
  'solo lettura',
  'solo lectura',
  'apenas leitura',
  'nur lesen',
  'lecture seule',
  'no points here',
  'fără puncte',
  'fara puncte',
];

const QUIZ_TRAP_NEEDLES = [
  'take the quiz',
  'take quiz',
  'learning_module_take_quiz',
  'fă quizul',
  'fa quizul',
];

function decodeUi(value) {
  return String(value || '')
    .replace(/&#10;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n/g, ' ');
}

function shot(deviceId, name) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  const r = spawnSync('adb', ['-s', deviceId, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 25 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout?.length) writeFileSync(path, r.stdout);
  console.log('screenshot', path);
  return path;
}

function saveXml(deviceId, name) {
  mkdirSync(OUT_DIR, { recursive: true });
  const { xml } = dumpUiHierarchy(deviceId, name.replace(/\.xml$/, ''));
  const path = join(OUT_DIR, name);
  writeFileSync(path, xml, 'utf8');
  console.log('xml', path);
  return { xml, path };
}

function haystack(nodes) {
  return nodes
    .filter((n) => n.packageName === PKG)
    .flatMap((n) => [n.text, n.contentDesc])
    .map((v) => normalizeText(decodeUi(v)))
    .filter(Boolean)
    .join(' | ');
}

function hasAny(hay, needles) {
  return needles.some((n) => hay.includes(normalizeText(n)));
}

function findBottomTab(nodes, labels) {
  const wants = labels.map(normalizeText).filter(Boolean);
  let best = null;
  for (const n of nodes) {
    if (n.packageName !== PKG || !n.bounds || n.clickable !== true) continue;
    // Bottom nav only (avoid Home “Take today's quiz” / mid-screen CTAs).
    if (n.bounds.top < 1200) continue;
    const hay = [n.text, n.contentDesc]
      .map((v) => normalizeText(decodeUi(v)))
      .filter(Boolean);
    for (const h of hay) {
      const exact = wants.some(
        (w) => h === w || h === `${w} ${w}` || h.startsWith(`${w} `),
      );
      if (exact) {
        if (!best || n.bounds.top > best.bounds.top) best = n;
      }
    }
  }
  return best;
}

async function waitTap(deviceId, labels, { timeoutMs = 20000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'learn-wt').xml);
    let n = findBottomTab(nodes, labels);
    if (!n?.bounds) n = findNodeByText(nodes, labels, { packageName: PKG });
    if (n?.bounds) {
      tapBounds(n.bounds, { deviceId });
      await sleep(1200);
      return true;
    }
    await sleep(400);
  }
  return false;
}

function assertLearnTip(xml, passLabel) {
  const nodes = parseUiNodes(xml);
  const hay = haystack(nodes);
  const tipOk = hasAny(hay, TIP_LABELS);
  const readOnlyOk = hasAny(hay, READ_ONLY_NEEDLES);
  const quizTrap = hasAny(hay, QUIZ_TRAP_NEEDLES);
  const semantic =
    hay.includes('learn_daily_tip_card') ||
    nodes.some(
      (n) =>
        normalizeText(n.resourceId).includes('learn_daily_tip') ||
        normalizeText(n.contentDesc).includes('daily tip') ||
        normalizeText(n.contentDesc).includes('sfatul zilei'),
    );

  console.log(`[${passLabel}] tipLabel=${tipOk} readOnly=${readOnlyOk} quizTrap=${quizTrap} semanticHint=${semantic}`);
  console.log(`[${passLabel}] sample=`, hay.slice(0, 400));

  if (!tipOk) throw new Error(`${passLabel}: Daily Tip label missing on Learn`);
  if (!readOnlyOk) {
    throw new Error(`${passLabel}: read-only caption missing on Daily Tip card`);
  }
  if (quizTrap) {
    throw new Error(`${passLabel}: quiz-trap copy found on Learn tip surface`);
  }
  return { tipOk, readOnlyOk, quizTrap };
}

async function onePass(deviceId, pass) {
  const tapped = await waitTap(deviceId, LEARN_LABELS);
  if (!tapped) throw new Error(`pass ${pass}: could not tap Learn tab`);
  await sleep(1200);
  const { xml } = saveXml(deviceId, `learn-daily-tip-${pass}.xml`);
  shot(deviceId, `learn-daily-tip-${pass}.png`);
  return assertLearnTip(xml, `ADB${pass}`);
}

async function main() {
  const deviceId = getAdbDevice();
  if (!deviceId) throw new Error('No adb device');
  mkdirSync(OUT_DIR, { recursive: true });

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
  // Cold start after install/force-stop can take a while (ads/UMP/session).
  await sleep(8000);

  const r1 = await onePass(deviceId, 1);
  // Leave Learn and re-enter for second independent dump.
  const homeLabels = ['Home', 'Acasă', 'Acasa', 'Inicio', 'Accueil', 'Start'];
  await waitTap(deviceId, homeLabels, { timeoutMs: 8000 });
  await sleep(700);
  const r2 = await onePass(deviceId, 2);

  console.log(
    JSON.stringify(
      { ok: true, adb1: r1, adb2: r2, outDir: OUT_DIR },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
