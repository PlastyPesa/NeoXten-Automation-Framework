#!/usr/bin/env node
/**
 * Publish Week 1 / Day 1 founding mission announcement (Kenya audience).
 * Dry run by default; pass --send to deliver.
 *
 * Canon: plastypesa-admin-dashboard/DOCS/PLASTYPESA_COMMUNITY_MISSION_CAMPAIGN.md
 */
import { readFileSync } from 'node:fs';

const API =
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

const credentials = readFileSync(
  'C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md',
  'utf8',
);
const adminBlock = credentials.split('## Production mobile app')[0];
const email = adminBlock.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
const password = adminBlock.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();
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

const payload = {
  title: 'We chose Kenya',
  message:
    'PlastyPesa exists to teach millions of us to sort plastic by grade at home — with proof. Weekly M-Pesa rewards are real today (Top 10 every Monday). First Eco Guardian: KES 20,000 for the first person to 125,000 lifetime points and 30 approved sorts — rules are public in the app. Invite a friend: you both earn 2000 pts once their first sorting photo is approved.',
  audience: 'kenya',
  bannerScope: 'main_shell',
  bannerPosition: 'top',
  bannerStyle: 'standard',
  bannerDurationSec: 14,
};

const dry = await json('/admin/announcements', {
  method: 'POST',
  headers,
  body: JSON.stringify({ ...payload, dryRun: true }),
});
const total = dry?.data?.totalUsers ?? 0;
console.log(`Dry run: would reach ${total} Kenya users`);
if (total === 0) {
  console.error('Aborting — zero Kenya users matched.');
  process.exit(1);
}

if (process.argv.includes('--send')) {
  const sent = await json('/admin/announcements', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  console.log(
    `Sent: ${sent?.data?.sentCount ?? '?'} / ${sent?.data?.totalUsers ?? total}`,
  );
} else {
  console.log('Pass --send to publish Week 1 Day 1 announcement.');
}
