/**
 * ADB ×2 proof for Batch 2:
 * 1) Weekly earners claim chips (paid vs awaiting claim)
 * 2) Paid Rewards Proof goodwill label
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
  normalizeText,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';
const OUT = join(process.cwd(), '.neoxten', 'proof');

const decode = (v) =>
  String(v || '')
    .replace(/&#10;/g, ' ')
    .replace(/&amp;/g, '&');

const hayOf = (nodes) =>
  nodes
    .filter((n) => n.packageName === PKG)
    .flatMap((n) => [n.text, n.contentDesc])
    .map((v) => normalizeText(decode(v)))
    .filter(Boolean)
    .join(' | ');

function shot(name) {
  const d = getAdbDevice();
  const path = join(OUT, name);
  const r = spawnSync('adb', ['-s', d, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 25 * 1024 * 1024,
  });
  if (r.status === 0 && r.stdout?.length) writeFileSync(path, r.stdout);
  console.log('screenshot', path);
}

function swipe(d, y1, y2) {
  spawnSync(
    'adb',
    ['-s', d, 'shell', 'input', 'swipe', '360', String(y1), '360', String(y2), '260'],
    { stdio: 'ignore' },
  );
}

async function waitShell(d) {
  const start = Date.now();
  while (Date.now() - start < 60000) {
    const h = hayOf(parseUiNodes(dumpUiHierarchy(d, 'shell').xml));
    if (h.includes('members') || h.includes('membri') || h.includes('learn') || h.includes('înva')) {
      return;
    }
    await sleep(1000);
  }
  throw new Error('shell not ready');
}

async function openLeaderboard(d) {
  // tap home then CTA
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const nodes = parseUiNodes(dumpUiHierarchy(d, 'nav').xml);
    for (const n of nodes) {
      if (n.packageName !== PKG || !n.clickable || !n.bounds || n.bounds.top < 1200) continue;
      const h = normalizeText(decode(`${n.text || ''} ${n.contentDesc || ''}`));
      if (h.includes('home') || h.includes('acas')) {
        tapBounds(n.bounds, { deviceId: d });
        await sleep(1000);
        break;
      }
    }
    const nodes2 = parseUiNodes(dumpUiHierarchy(d, 'cta').xml);
    for (const n of nodes2) {
      if (n.packageName !== PKG || !n.clickable || !n.bounds) continue;
      const h = normalizeText(decode(`${n.text || ''} ${n.contentDesc || ''}`));
      if (h.includes('see top 10') || h.includes('vezi top') || h.includes('top 10 this week')) {
        tapBounds(n.bounds, { deviceId: d });
        await sleep(3000);
        return;
      }
    }
    await sleep(400);
  }
  throw new Error('leaderboard CTA missing');
}

async function onePass(pass) {
  const d = getAdbDevice();
  await openLeaderboard(d);

  // Weekly earners sit below pulse/milestone — nudge down until claim chips appear.
  let claimHay = '';
  let paid = false;
  let awaiting = false;
  for (let i = 0; i < 8; i += 1) {
    claimHay = hayOf(parseUiNodes(dumpUiHierarchy(d, `claims-${pass}-${i}`).xml));
    paid =
      claimHay.includes('recompensa platita') ||
      claimHay.includes('reward paid') ||
      claimHay.includes('platita');
    awaiting =
      claimHay.includes('asteptarea revendicarii') ||
      claimHay.includes('awaiting claim') ||
      claimHay.includes('zile ramase') ||
      claimHay.includes('days left') ||
      claimHay.includes('in asteptarea');
    if (paid && awaiting) break;
    swipe(d, 1100, 700);
    await sleep(400);
  }
  shot(`batch2-claims-${pass}.png`);
  console.log(`[ADB${pass}] claims paid=${paid} awaiting=${awaiting}`);
  console.log(`[ADB${pass}] claimSample=`, claimHay.slice(0, 350));
  if (!paid || !awaiting) {
    throw new Error(`ADB${pass}: claim status chips missing`);
  }

  // Scroll to Paid Rewards Proof tile
  let opened = false;
  for (let i = 0; i < 24; i += 1) {
    swipe(d, 1300, 200);
    await sleep(280);
    const nodes = parseUiNodes(dumpUiHierarchy(d, `find-${pass}-${i}`).xml);
    for (const n of nodes) {
      if (n.packageName !== PKG || !n.clickable || !n.bounds) continue;
      const h = normalizeText(decode(`${n.text || ''} ${n.contentDesc || ''}`));
      if (
        h.includes('dovada pl') ||
        h.includes('paid rewards proof') ||
        h.includes('apasa ca sa vezi cine a fost platit') ||
        h.includes('tap to see who got paid')
      ) {
        tapBounds(n.bounds, { deviceId: d });
        opened = true;
        await sleep(1800);
        break;
      }
    }
    if (opened) break;
  }
  if (!opened) throw new Error(`ADB${pass}: proof wall tile not found`);

  let good = false;
  let wallHay = '';
  for (let i = 0; i < 12; i += 1) {
    swipe(d, 1200, 500);
    await sleep(300);
    wallHay = hayOf(parseUiNodes(dumpUiHierarchy(d, `wall-${pass}-${i}`).xml));
    if (
      wallHay.includes('corectat') ||
      wallHay.includes('goodwill') ||
      wallHay.includes('bunavoint') ||
      wallHay.includes('corrected a mistake')
    ) {
      good = true;
      break;
    }
  }
  writeFileSync(join(OUT, `batch2-wall-${pass}.xml`), dumpUiHierarchy(d, `wall-save-${pass}`).xml, 'utf8');
  shot(`batch2-wall-${pass}.png`);
  console.log(`[ADB${pass}] goodwill=${good}`);
  if (!good) throw new Error(`ADB${pass}: goodwill label missing — ${wallHay.slice(0, 300)}`);

  spawnSync('adb', ['-s', d, 'shell', 'input', 'keyevent', '4'], { stdio: 'ignore' });
  await sleep(600);
  return { paid, awaiting, good };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const d = getAdbDevice();
  if (!d) throw new Error('no device');
  spawnSync('adb', ['-s', d, 'shell', 'am', 'force-stop', PKG], { stdio: 'inherit' });
  await sleep(700);
  spawnSync(
    'adb',
    ['-s', d, 'shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'],
    { stdio: 'inherit' },
  );
  await sleep(10000);
  await waitShell(d);
  const r1 = await onePass(1);
  const r2 = await onePass(2);
  console.log(JSON.stringify({ ok: true, r1, r2 }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
