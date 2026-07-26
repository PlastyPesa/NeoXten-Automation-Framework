#!/usr/bin/env node
/**
 * Phase 3 — rendered Home card numbers must match live API (ADB + API).
 *
 * Scrapes UIAutomator text for "N learners in Kenya" and compares to
 * GET /home/earn-hub + GET /community/pulse for the same session credentials.
 *
 * Requires: authorized ADB device + PlastyPesa app already logged in on Home.
 * Run: npm run test:plastypesa-number-sync-ui
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';
import { url } from './config.mjs';
import { readJson } from './assert.mjs';
import {
  adb,
  dumpUiHierarchy,
  sleep,
  getAdbDevice,
  swipeUp,
} from './localization/adb-ui.mjs';

const PKG = 'com.app.plasty_pesa';
const OUT = path.join(process.cwd(), '.neoxten-out', 'number-sync-ui');

function allVisibleText(xml) {
  const texts = [];
  for (const m of xml.matchAll(/text="([^"]*)"/g)) {
    if (m[1]) texts.push(m[1].replace(/&#10;/g, '\n'));
  }
  for (const m of xml.matchAll(/content-desc="([^"]*)"/g)) {
    if (m[1]) texts.push(m[1].replace(/&#10;/g, '\n'));
  }
  return texts.join('\n');
}

function extractLearnersInKenya(text) {
  const m = text.match(/(\d+)\s+learners?\s+in\s+Kenya/i);
  return m ? Number(m[1]) : null;
}

function extractPulseMembers(text) {
  // Alive strip: "38\nmembers" or "38 members"
  const m = text.match(/(\d+)\s*\n?\s*members\b/i);
  return m ? Number(m[1]) : null;
}

function extractMembersSlashTarget(text) {
  // Pulse milestone often shows "37 / 500" or "Members … 37 / 500"
  const m = text.match(/(\d+)\s*\/\s*500\b/);
  return m ? Number(m[1]) : null;
}

async function fetchApiNumbers(authHeaders) {
  const [ehRes, pulseRes] = await Promise.all([
    fetch(url(getConfig(), '/home/earn-hub'), { headers: authHeaders }),
    fetch(url(getConfig(), '/community/pulse'), { headers: authHeaders }),
  ]);
  const eh = await readJson(ehRes);
  const pu = await readJson(pulseRes);
  if (ehRes.status !== 200) {
    throw new Error(`earn-hub ${ehRes.status}: ${eh.text.slice(0, 200)}`);
  }
  if (pulseRes.status !== 200) {
    throw new Error(`pulse ${pulseRes.status}: ${pu.text.slice(0, 200)}`);
  }
  return {
    missionMembers: Number(eh.body?.data?.communityProgress?.communityMembers),
    pulseMembers: Number(pu.body?.data?.members),
    milestoneMembers: Number(pu.body?.data?.milestone?.currentKeMembers),
  };
}

async function main() {
  bootstrapPlastyPesaEnv();
  fs.mkdirSync(OUT, { recursive: true });

  const device = getAdbDevice();
  if (!device) {
    console.error('FAIL: no ADB device in "device" state');
    process.exit(1);
  }

  const auth = await resolvePlastyPesaAuth(getConfig());
  if (!auth.authHeaders) {
    console.error('FAIL: no JWT — set PLASTYPESA_TEST_EMAIL/PASSWORD or USER_JWT');
    process.exit(1);
  }

  const api = await fetchApiNumbers(auth.authHeaders);
  console.log('[api]', api);

  // Bring app forward; do not force login (owner device session).
  adb(['shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1']);
  await sleep(4000);
  // Scroll to top — pulse alive strip is above-fold
  for (let i = 0; i < 3; i += 1) {
    adb(['shell', 'input', 'swipe', '360', '400', '360', '1200', '350']);
    await sleep(400);
  }
  await sleep(1200);

  let dump = dumpUiHierarchy(device, 'number-sync-home-top');
  let text = allVisibleText(dump.xml);
  fs.writeFileSync(path.join(OUT, 'home-top-text.txt'), text, 'utf8');

  const uiPulseMembers = extractPulseMembers(text);

  // Scroll + dump each step so we don't skip past the mission strip
  let combined = text;
  let uiLearners = extractLearnersInKenya(combined);
  let uiSlash = extractMembersSlashTarget(combined);
  for (let i = 0; i < 8 && uiLearners == null; i += 1) {
    await swipeUp({ deviceId: device, afterMs: 800 });
    dump = dumpUiHierarchy(device, `number-sync-home-scroll-${i}`);
    const chunk = allVisibleText(dump.xml);
    combined += `\n${chunk}`;
    uiLearners = extractLearnersInKenya(combined);
    uiSlash = extractMembersSlashTarget(combined) ?? uiSlash;
    if (/building this together|learners in Kenya/i.test(chunk)) {
      fs.writeFileSync(path.join(OUT, 'home-text.txt'), chunk, 'utf8');
    }
  }
  fs.writeFileSync(path.join(OUT, 'home-combined.txt'), combined, 'utf8');

  const checks = [];
  const push = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  push(
    'api_mission_equals_pulse',
    api.missionMembers === api.pulseMembers,
    `${api.missionMembers} vs ${api.pulseMembers}`,
  );
  if (Number.isInteger(api.milestoneMembers) && !Number.isNaN(api.milestoneMembers)) {
    push(
      'api_milestone_equals_pulse',
      api.milestoneMembers === api.pulseMembers,
      `${api.milestoneMembers} vs ${api.pulseMembers}`,
    );
  }

  push(
    'ui_pulse_members_visible',
    uiPulseMembers != null,
    uiPulseMembers == null ? 'no "N members" on Home top' : `UI=${uiPulseMembers}`,
  );
  if (uiPulseMembers != null) {
    push(
      'ui_pulse_equals_api_pulse',
      uiPulseMembers === api.pulseMembers,
      `UI ${uiPulseMembers} vs API ${api.pulseMembers}`,
    );
  }

  push(
    'ui_learners_chip_visible',
    uiLearners != null,
    uiLearners == null ? 'no "N learners in Kenya" after scroll' : `UI=${uiLearners}`,
  );
  if (uiLearners != null) {
    push(
      'ui_learners_equals_api_mission',
      uiLearners === api.missionMembers,
      `UI ${uiLearners} vs API ${api.missionMembers}`,
    );
    push(
      'ui_learners_equals_api_pulse',
      uiLearners === api.pulseMembers,
      `UI ${uiLearners} vs pulse ${api.pulseMembers}`,
    );
  }

  if (uiSlash != null) {
    push(
      'ui_500_bar_equals_api_pulse',
      uiSlash === api.pulseMembers,
      `UI ${uiSlash}/500 vs pulse ${api.pulseMembers}`,
    );
  } else {
    console.log('SKIP  ui_500_bar (pattern not on current viewport — scroll/locale)');
  }

  fs.writeFileSync(
    path.join(OUT, 'result.json'),
    JSON.stringify({ api, uiPulseMembers, uiLearners, uiSlash, checks }, null, 2),
  );

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed. Artifacts: ${OUT}`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
