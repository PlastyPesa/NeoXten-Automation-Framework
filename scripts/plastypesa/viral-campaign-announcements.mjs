#!/usr/bin/env node
/**
 * Send two Kenya viral in-app announcements (no AAB):
 *   1) Referral launch boost — 2000 + 2000 until 2026-08-11
 *   2) First Eco Guardian — KES 20,000 (125k lifetime + 30 approved sorts)
 *
 * Optional: --pin-referral sets the singleton pinned banner (referral countdown)
 * until 2026-08-11 23:59:59 UTC (only ONE pinned banner at a time in the app).
 *
 *   node scripts/plastypesa/viral-campaign-announcements.mjs           # dry run
 *   node scripts/plastypesa/viral-campaign-announcements.mjs --send    # deliver blasts
 *   node scripts/plastypesa/viral-campaign-announcements.mjs --send --pin-referral
 */
import { readFileSync } from 'node:fs';

const API =
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

const BOOST_END_LABEL = '11 August 2026';
const BOOST_END_ISO = '2026-08-11T23:59:59.000Z';

const ANNOUNCEMENTS = [
  {
    key: 'referral-boost',
    audience: 'kenya',
    title: 'Launch boost — invite a friend',
    message: `Limited time until ${BOOST_END_LABEL}: invite a friend from Profile and you both earn 2000 bonus points. Referral points count toward your weekly board. After the boost, referral rewards stay 1000 + 1000.`,
    bannerScope: 'app_wide',
    bannerPosition: 'center',
    bannerStyle: 'premium',
    bannerDurationSec: 18,
    bannerId: 'viral-referral-boost-2026-08-11',
  },
  {
    key: 'eco-guardian',
    audience: 'kenya',
    title: 'First Eco Guardian — KES 20,000',
    message:
      'Be the first Kenya learner to reach 125,000 lifetime points and 30 approved sort-at-home photos. Sorting proof matters — not quiz-only farming. Rules are fixed in the app: tap First Eco Guardian on Home for your progress.',
    bannerScope: 'app_wide',
    bannerPosition: 'center',
    bannerStyle: 'premium',
    bannerDurationSec: 20,
    bannerId: 'viral-eco-guardian-founding',
  },
];

const PINNED_REFERRAL = {
  active: true,
  title: 'Invite a friend — both earn 2000',
  message: `Launch boost ends ${BOOST_END_LABEL}. Share your link from Profile — you and your friend each earn 2000 bonus points while the boost is live.`,
  endsAt: BOOST_END_ISO,
  inAppBanner: {
    bannerDurationSec: 25,
    bannerScope: 'app_wide',
    bannerPosition: 'center',
    bannerStyle: 'premium',
    bannerId: 'pinned-referral-boost-2026-08-11',
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
const pinReferral = process.argv.includes('--pin-referral');

console.log(`Mode: ${send ? 'SEND' : 'dry run'}`);
console.log(`Pinned referral banner: ${pinReferral ? 'yes (if --send)' : 'no'}\n`);

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

if (pinReferral) {
  if (!send) {
    console.log('\n[pinned-referral] dry run — would set pinned banner until', BOOST_END_ISO);
  } else {
    const pinned = await json('/admin/active-in-app-banner', {
      method: 'PUT',
      headers,
      body: JSON.stringify(PINNED_REFERRAL),
    });
    console.log('\n[pinned-referral] saved pinned banner until', BOOST_END_ISO);
    console.log('  active:', pinned?.data?.active ?? pinned?.active ?? true);
  }
}

if (!send) {
  console.log('\nPass --send to deliver announcement blasts.');
  console.log('Add --pin-referral to also set the countdown pinned banner (singleton — replaces any other pin).');
}
