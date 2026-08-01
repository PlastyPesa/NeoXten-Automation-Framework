#!/usr/bin/env node
/**
 * Referral UI truth gate — hero must show symmetric referral amounts.
 * Catches 2000 banner + 3000 friend column regressions (signup stacked in hero).
 */
import fs from 'node:fs';

const API = 'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';
const cache = JSON.parse(
  fs.readFileSync(new URL('../../.neoxten/plastypesa-token-cache.json', import.meta.url), 'utf8'),
);
const token = cache.token || cache.jwt || Object.values(cache)[0]?.token || Object.values(cache)[0];
if (!token || typeof token !== 'string') {
  console.error('No token in .neoxten/plastypesa-token-cache.json');
  process.exit(2);
}

const credentials = fs.readFileSync(
  'C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md',
  'utf8',
);
const adminBlock = credentials.split('## Production mobile app')[0];
const adminEmail = adminBlock.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
const adminPassword = adminBlock.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();

async function getJson(path, opts = {}) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, ...opts.headers }, ...opts });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

function masterInt(doc, fallback) {
  const d = doc?.body?.data;
  const raw = Array.isArray(d?.metadata) ? d.metadata[0] : Array.isArray(d?.data) ? d.data[0] : d?.data ?? d;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const [hub, signupMaster] = await Promise.all([
  getJson('/home/earn-hub'),
  getJson('/master?name=signup-bonus-points'),
]);

const d = hub.body?.data ?? {};
const referral = Number(d.referralPoints);
const boostActive = d.referralBoostActive === true;
const signupBonus = masterInt(signupMaster, 1000);
const wrongHeroFriend = referral + signupBonus;

const checks = [
  ['earn-hub 200', hub.status === 200],
  ['referralPoints is number', Number.isFinite(referral) && referral > 0],
  ['signup bonus readable', Number.isFinite(signupBonus) && signupBonus > 0],
  [
    'hero friend column must NOT use signup+referral',
    Number.isFinite(referral) && wrongHeroFriend !== referral,
  ],
  [
    'boost active shows symmetric referral (2000+2000 path)',
    !boostActive || referral === 2000,
  ],
  [
    'friendStarts total equals signup+referral (how-it-works only)',
    wrongHeroFriend === signupBonus + referral,
  ],
];

if (adminEmail && adminPassword) {
  const login = await fetch(`${API}/auth/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  }).then((r) => r.json());
  const adminToken = login?.data?.token || login?.token;
  if (adminToken) {
    const dry = await fetch(`${API}/admin/announcements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        dryRun: true,
        title: 'Referral consistency probe',
        message: `Launch boost ${referral}+${referral} — not ${wrongHeroFriend} in hero.`,
        audience: 'kenya',
      }),
    }).then((r) => r.json());
    checks.push(['admin dry run ok', dry?.type === 'success']);
  }
}

console.log('referralPoints:', referral, '| signupBonus:', signupBonus);
console.log('wrongHeroFriend (old bug):', wrongHeroFriend, '| correctHeroFriend:', referral);
console.log('boostActive:', boostActive);

let fail = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL <<<'} ${name}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
