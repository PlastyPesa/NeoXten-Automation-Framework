#!/usr/bin/env node
/**
 * Kenya viral in-app announcements — same delivery path as update-v47-announcement.mjs:
 * POST /admin/announcements → premium center app_wide card on next cold start.
 *
 *   1) Referral launch boost — 2000 + 2000 until 2026-08-11
 *   2) First Eco Guardian — KES 20,000 (125k lifetime + 30 approved sorts)
 *
 *   node scripts/plastypesa/viral-campaign-announcements.mjs            # dry run
 *   node scripts/plastypesa/viral-campaign-announcements.mjs --send     # deliver both
 *   node scripts/plastypesa/viral-campaign-announcements.mjs --send --clear-pinned
 *
 * Optional (different UX — pinned singleton, not the update-announcement path):
 *   --pin-cold-start --pin-only
 */
import { readFileSync } from 'node:fs';

const API =
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

const BOOST_END_LABEL = '11 August 2026';
const BOOST_END_ISO = '2026-08-11T23:59:59.000Z';
const stamp = new Date().toISOString().slice(0, 10);

const ANNOUNCEMENTS = [
  {
    key: 'referral-boost',
    audience: 'kenya',
    title: 'Launch boost — invite a friend',
    // P-INVITE-COPY-SWEEP: the boost freezes the AMOUNT at signup; the points
    // are paid on the friend's first approved sort. Never publish the amount
    // without that condition.
    message: `Limited time until ${BOOST_END_LABEL}: invite a friend from Profile and you both earn 2000 bonus points once their first sorting photo is approved — not when they join. Referral points count toward your weekly board. After the boost, referral rewards stay 1000 + 1000.`,
    bannerScope: 'app_wide',
    bannerPosition: 'center',
    bannerStyle: 'premium',
    bannerDurationSec: 20,
    bannerId: `viral-referral-boost-${stamp}`,
  },
  {
    key: 'eco-guardian',
    audience: 'kenya',
    title: 'First Eco Guardian — KES 20,000',
    message:
      'Be the first Kenya learner to reach 125,000 lifetime points and 30 approved sort-at-home photos. Learn daily, sort for proof, and track your progress — tap First Eco Guardian on Home.',
    bannerScope: 'app_wide',
    bannerPosition: 'center',
    bannerStyle: 'premium',
    bannerDurationSec: 20,
    bannerId: `viral-eco-guardian-${stamp}`,
  },
];

const PINNED_REFERRAL = {
  active: true,
  title: 'Invite a friend — 2000 on first approved sort',
  message: `Launch boost ends ${BOOST_END_LABEL}. Share your link from Profile — you and your friend each earn 2000 bonus points once their first sorting photo is approved, not when they join. Invite during the boost and the 2000 is locked in even if they sort later.`,
  endsAt: BOOST_END_ISO,
  inAppBanner: {
    bannerDurationSec: 25,
    bannerScope: 'app_wide',
    bannerPosition: 'center',
    bannerStyle: 'premium',
    bannerId: 'pinned-referral-boost-2026-08-11',
  },
};

const PINNED_COLD_START = {
  active: true,
  title: 'Kenya founding season — two ways to earn big',
  message: `Invite a friend before ${BOOST_END_LABEL} — you both earn 2000 bonus points once their first sorting photo is approved (Profile → share your link).\n\nFirst Eco Guardian: KES 20,000 for the first learner to reach 125,000 lifetime points and 30 approved sort-at-home photos. Tap First Eco Guardian on Home for your progress.`,
  endsAt: BOOST_END_ISO,
  inAppBanner: {
    bannerDurationSec: 30,
    bannerScope: 'app_wide',
    bannerPosition: 'center',
    bannerStyle: 'premium',
    bannerId: `pinned-viral-kenya-founding-${stamp}`,
  },
};

const credentials = readFileSync(
  'C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md',
  'utf8',
);
const adminSec =
  credentials.split('## Production admin web')[1]?.split('##')[0] || '';
const email = adminSec.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
const password = adminSec.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();
if (!email || !password) throw new Error('Local admin credentials unavailable');

async function json(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path}: non-JSON (${response.status})`);
  }
  if (!response.ok || body.type === 'Error' || body.type === 'error') {
    throw new Error(`${path}: HTTP ${response.status} — ${body.message || 'failed'}`);
  }
  return body;
}

const login = await json('/auth/admin-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const token = login?.data?.token || login?.token;
if (!token) throw new Error('Admin login returned no token');

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
};

const send = process.argv.includes('--send');
const pinOnly = process.argv.includes('--pin-only');
const clearPinned = process.argv.includes('--clear-pinned');
const pinReferral = process.argv.includes('--pin-referral');
const pinColdStart = process.argv.includes('--pin-cold-start');

console.log(`Mode: ${send ? 'SEND' : 'dry run'}`);
console.log(`Stamp: ${stamp}`);
console.log(
  `Pinned: ${pinColdStart ? 'cold-start (both)' : pinReferral ? 'referral only' : 'no (update-style announcements)'}\n`,
);

if (send && clearPinned) {
  await json('/admin/active-in-app-banner', { method: 'DELETE', headers });
  console.log('[clear-pinned] removed active pinned banner\n');
}

if (!pinOnly) {
  for (const ann of ANNOUNCEMENTS) {
    const dry = await json('/admin/announcements', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...ann, dryRun: true }),
    });
    const total = dry?.data?.totalUsers ?? 0;
    console.log(`[${ann.key}] dry run → ${total} Kenya users`);
    if (total === 0) {
      console.warn(`  ⚠ zero users — check audience filter`);
    }
    if (send && total > 0) {
      const sent = await json('/admin/announcements', {
        method: 'POST',
        headers,
        body: JSON.stringify(ann),
      });
      console.log(
        `  sent ${sent?.data?.sentCount ?? '?'} / ${sent?.data?.totalUsers ?? total} (bannerId: ${ann.bannerId})`,
      );
    }
  }
}

async function savePinned(label, payload) {
  if (!send) {
    console.log(`\n[${label}] dry run — would set pinned banner until`, BOOST_END_ISO);
    console.log('  title:', payload.title);
    console.log('  message:', payload.message);
    return;
  }
  const pinned = await json('/admin/active-in-app-banner', {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  console.log(`\n[${label}] saved pinned banner until`, BOOST_END_ISO);
  console.log('  active:', pinned?.data?.active ?? pinned?.active ?? true);
  console.log('  bannerId:', payload.inAppBanner.bannerId);
}

if (pinColdStart) {
  await savePinned('pinned-cold-start', PINNED_COLD_START);
} else if (pinReferral) {
  await savePinned('pinned-referral', PINNED_REFERRAL);
}

if (!send) {
  console.log('\nPass --send to deliver both announcements (same path as update-v47).');
  console.log('Add --clear-pinned to remove any pinned banner first.');
}
