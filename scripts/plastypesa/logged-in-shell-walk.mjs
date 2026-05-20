#!/usr/bin/env node
/**
 * Walks bottom nav on the **currently installed** app (no flutter reinstall).
 * Taps the 7 `android.widget.Button` nodes in the bottom bar (sorted by x),
 * which is stable across locales (avoids ambiguous text matches).
 */
import {
  tapText,
  sleep,
  getAdbDevice,
  dumpUiHierarchy,
  parseUiNodes,
  tapBounds,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';

/**
 * Bottom nav: only the row **anchored to the bottom** of the window (avoids
 * mistaking the Login CTA on the sign-in form for a tab).
 */
function bottomNavButtons(nodes) {
  let maxBottom = 0;
  for (const n of nodes) {
    if (n.bounds?.bottom > maxBottom) maxBottom = n.bounds.bottom;
  }
  if (maxBottom <= 0) return [];
  const minTop = maxBottom - 200;
  const list = nodes.filter(
    (n) =>
      n.packageName === PKG &&
      n.className === 'android.widget.Button' &&
      n.clickable &&
      n.bounds &&
      n.bounds.top >= minTop,
  );
  list.sort((a, b) => a.bounds.left - b.bounds.left);
  return list;
}

async function main() {
  const deviceId = getAdbDevice();
  if (!deviceId) {
    console.error('[shell-walk] No adb device.');
    process.exit(1);
  }

  const { spawnSync } = await import('node:child_process');
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
  await sleep(4500);

  let dump = dumpUiHierarchy(deviceId, 'shell-walk-preflight');
  const onShell =
    bottomNavButtons(parseUiNodes(dump.xml)).length >= 5;
  if (onShell) {
    console.log('[shell-walk] Already on main shell — skipping language/onboarding.');
  } else {
    const xml = dump.xml;
    if (xml.includes('Choose your language') || xml.includes('Continue')) {
      console.log('[shell-walk] Language picker — tapping Continue.');
      await tapText(['Continue', 'Continuă', 'Continuar', 'Weiter'], {
        deviceId,
        timeoutMs: 12000,
        label: 'lang-continue',
        packageName: PKG,
      });
      await sleep(2200);
    }

    for (let s = 0; s < 2; s += 1) {
      const n = await tapText(
        [
          'Next',
          'Următorul',
          'Weiter',
          'Siguiente',
          'Suivant',
          'Avanti',
          'Próximo',
        ],
        { deviceId, timeoutMs: 5000, label: `onb-next-${s}`, packageName: PKG },
      );
      if (!n) break;
      await sleep(1000);
    }
    await tapText(
      [
        'Get Started',
        'Get started',
        'Începe',
        'Inizia',
        'Comenzar',
        'Commencer',
        'Loslegen',
        'Começar',
        'Skip',
        'Omitir',
      ],
      { deviceId, timeoutMs: 10000, label: 'onb-end', packageName: PKG },
    );
    await sleep(2000);
  }

  dump = dumpUiHierarchy(deviceId, 'shell-walk-probe');
  const nodes = parseUiNodes(dump.xml);
  let nav = bottomNavButtons(nodes);

  if (nav.length < 5) {
    console.warn(
      `[shell-walk] Only ${nav.length} bottom nav buttons (need main shell). Dump: ${dump.localPath}`,
    );
    const hit = await tapText(['Home', 'Acasă'], {
      deviceId,
      timeoutMs: 8000,
      label: 'fallback-home',
      packageName: PKG,
    });
    if (!hit) {
      console.error(
        '[shell-walk] Not on main shell — log in, then re-run: npm run test:plastypesa-device-shell-walk',
      );
      process.exit(2);
    }
    await sleep(2000);
    const dump2 = dumpUiHierarchy(deviceId, 'shell-walk-probe-2');
    nav = bottomNavButtons(parseUiNodes(dump2.xml));
  }

  if (nav.length < 5) {
    console.error(`[shell-walk] Aborted: found ${nav.length} nav buttons.`);
    process.exit(2);
  }

  for (let i = 0; i < nav.length; i += 1) {
    const b = nav[i].bounds;
    console.log(
      `[shell-walk] Tab ${i}: tap [${b.centerX},${b.centerY}] — ${(nav[i].contentDesc || nav[i].text || '').slice(0, 40)}`,
    );
    tapBounds(b, { deviceId });
    await sleep(1000);
  }

  console.log(`[shell-walk] Done: ${nav.length} tabs.`);
  process.exit(0);
}

await main();
