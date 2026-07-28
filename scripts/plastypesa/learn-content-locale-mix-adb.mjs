/**
 * ADB ×2 proof for P-LEARN-CONTENT-LOCALE-MIX.
 * Learn chrome + tip/article bodies must show the user's language (RO),
 * not English CMS leftovers.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig, url } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';
import {
  dumpUiHierarchy,
  parseUiNodes,
  sleep,
  getAdbDevice,
  tapBounds,
  findNodeByText,
  normalizeText,
  swipeUp,
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

function haystack(nodes) {
  return nodes
    .filter((n) => n.packageName === PKG)
    .flatMap((n) => [n.text, n.contentDesc])
    .map((v) => normalizeText(decodeUi(v)))
    .filter(Boolean)
    .join(' | ');
}

function findBottomTab(nodes, labels) {
  const wants = labels.map(normalizeText).filter(Boolean);
  let best = null;
  for (const n of nodes) {
    if (n.packageName !== PKG || !n.bounds || n.clickable !== true) continue;
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
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'locale-wt').xml);
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

async function fetchExpectedTip(cfg, lang) {
  const r = await fetch(url(cfg, `/home/daily-tip?lang=${lang}`), {
    headers: { ...cfg.authHeaders, 'X-Language': lang },
  });
  const j = await r.json();
  const tip = j?.data;
  if (!tip?.name) throw new Error(`daily-tip ${lang} missing: status=${r.status}`);
  return { tipName: String(tip.name), lang, body: String(tip.description || '') };
}

function assertTipOnScreen(xml, tipName, passLabel, lang) {
  const hay = haystack(parseUiNodes(xml));
  const needle = normalizeText(tipName).slice(0, 28);
  const has = needle && hay.includes(needle);
  console.log(`[${passLabel}] expect[${lang}]="${needle}" has=${has}`);
  console.log(`[${passLabel}] sample=`, hay.slice(0, 500));
  if (!has) {
    throw new Error(
      `${passLabel}: ${lang} tip body missing on Learn (expected contains "${needle}")`
    );
  }
  return { has, needle, lang };
}

async function waitLearnTipLoaded(deviceId, { timeoutMs = 45000 } = {}) {
  const start = Date.now();
  let lastXml = '';
  while (Date.now() - start < timeoutMs) {
    const { xml } = dumpUiHierarchy(deviceId, 'learn-tip-wait');
    lastXml = xml;
    const hay = haystack(parseUiNodes(xml));
    const loading =
      hay.includes('tips refresh from the server') ||
      hay.includes('pull down to reload') ||
      hay.includes('learn_daily_tip_loading');
    const hasTipChrome =
      hay.includes('daily tip') ||
      hay.includes('sfatul zilei') ||
      hay.includes('tipp des tages') ||
      hay.includes('consiglio del giorno');
    if (!loading && hasTipChrome) return xml;
    await sleep(900);
  }
  writeFileSync(join(OUT_DIR, 'learn-tip-wait-timeout.xml'), lastXml, 'utf8');
  throw new Error('Learn tip still loading after timeout');
}

async function onePass(deviceId, expected, pass) {
  const tapped = await waitTap(deviceId, LEARN_LABELS);
  if (!tapped) throw new Error(`pass ${pass}: could not tap Learn tab`);
  const xml = await waitLearnTipLoaded(deviceId);
  writeFileSync(join(OUT_DIR, `learn-locale-mix-${pass}.xml`), xml, 'utf8');
  shot(deviceId, `learn-locale-mix-${pass}.png`);
  return assertTipOnScreen(xml, expected.tipName, `ADB${pass}`, expected.lang);
}

async function tapIf(deviceId, labels, { timeoutMs = 8000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, 'tapif').xml);
    const n = findNodeByText(nodes, labels, { packageName: PKG });
    if (n?.bounds) {
      tapBounds(n.bounds, { deviceId });
      await sleep(1000);
      return true;
    }
    await sleep(350);
  }
  return false;
}

function findByDecodedNeedle(nodes, needles) {
  const wants = needles.map(normalizeText).filter(Boolean);
  for (const n of nodes) {
    if (n.packageName !== PKG || !n.bounds) continue;
    const hay = normalizeText(decodeUi(`${n.text || ''} ${n.contentDesc || ''}`));
    if (wants.some((w) => hay.includes(w))) return n;
  }
  return null;
}

async function switchToRomanian(deviceId) {
  const profileOk = await waitTap(deviceId, ['Profile', 'Profil'], { timeoutMs: 15000 });
  if (!profileOk) throw new Error('could not open Profile for language switch');
  await sleep(1200);
  // Language lives under Help/settings list — scroll until the Language row appears.
  let langNode = null;
  for (let i = 0; i < 6; i += 1) {
    const nodes = parseUiNodes(dumpUiHierarchy(deviceId, `lang-scroll-${i}`).xml);
    langNode = findByDecodedNeedle(nodes, ['language', 'limba', 'limbă']);
    if (langNode?.bounds) break;
    try {
      await swipeUp({ deviceId });
    } catch {
      /* optional */
    }
    await sleep(500);
  }
  if (!langNode?.bounds) {
    throw new Error('language row not found on Profile');
  }
  tapBounds(langNode.bounds, { deviceId });
  await sleep(1500);
  const pickerNodes = parseUiNodes(dumpUiHierarchy(deviceId, 'lang-picker').xml);
  const roNode = findByDecodedNeedle(pickerNodes, [
    'romanian',
    'română',
    'romana',
    'românia',
  ]);
  if (!roNode?.bounds) {
    shot(deviceId, 'lang-picker-miss.png');
    throw new Error('Romanian option not found in language picker');
  }
  tapBounds(roNode.bounds, { deviceId });
  await sleep(800);
  await tapIf(deviceId, ['Save', 'Salvează', 'Salveaza', 'Apply', 'Continue', 'Done', 'OK']);
  await sleep(3000);
  return true;
}

async function main() {
  bootstrapPlastyPesaEnv();
  const cfgBase = getConfig();
  const auth = await resolvePlastyPesaAuth(cfgBase);
  if (!auth.authHeaders) throw new Error(`auth failed: ${auth.authError || 'no headers'}`);
  const cfg = { ...cfgBase, authHeaders: auth.authHeaders };

  const deviceId = getAdbDevice();
  if (!deviceId) throw new Error('No adb device');
  mkdirSync(OUT_DIR, { recursive: true });

  const expectedEn = await fetchExpectedTip(cfg, 'en');
  const expectedRo = await fetchExpectedTip(cfg, 'ro');
  console.log('expected tips', { expectedEn, expectedRo });
  if (normalizeText(expectedEn.tipName) === normalizeText(expectedRo.tipName)) {
    throw new Error('API still serves EN tip for lang=ro — abort ADB');
  }

  spawnSync('adb', ['-s', deviceId, 'shell', 'am', 'force-stop', PKG], {
    stdio: 'inherit',
  });
  await sleep(800);
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
  await sleep(12000);

  const homeLabels = ['Home', 'Acasă', 'Acasa', 'Inicio', 'Accueil', 'Start'];

  // Wait until splash/overlays clear and main shell is up.
  {
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < 60000) {
      const hay = haystack(parseUiNodes(dumpUiHierarchy(deviceId, 'shell-wait').xml));
      if (
        hay.includes('members') ||
        hay.includes('membri') ||
        hay.includes('learn') ||
        hay.includes('învață') ||
        hay.includes('invata')
      ) {
        ready = true;
        break;
      }
      await sleep(1000);
    }
    if (!ready) throw new Error('main shell never became ready after launch');
  }

  // Pass A — prove EN tip body matches live API (device currently English).
  const rEn1 = await onePass(deviceId, expectedEn, 'en-1');
  await waitTap(deviceId, homeLabels, { timeoutMs: 8000 });
  await sleep(700);
  const rEn2 = await onePass(deviceId, expectedEn, 'en-2');

  // Pass B — switch to Romanian and prove tip body is RO (not chrome-only).
  await switchToRomanian(deviceId);
  await waitTap(deviceId, homeLabels, { timeoutMs: 8000 });
  await sleep(1000);
  const rRo1 = await onePass(deviceId, expectedRo, 'ro-1');
  await waitTap(deviceId, homeLabels, { timeoutMs: 8000 });
  await sleep(700);
  const rRo2 = await onePass(deviceId, expectedRo, 'ro-2');

  const manifest = {
    ok: true,
    expectedEn,
    expectedRo,
    adbEn1: rEn1,
    adbEn2: rEn2,
    adbRo1: rRo1,
    adbRo2: rRo2,
    screenshots: [
      join(OUT_DIR, 'learn-locale-mix-en-1.png'),
      join(OUT_DIR, 'learn-locale-mix-en-2.png'),
      join(OUT_DIR, 'learn-locale-mix-ro-1.png'),
      join(OUT_DIR, 'learn-locale-mix-ro-2.png'),
    ],
  };
  writeFileSync(
    join(OUT_DIR, 'learn-locale-mix-manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
