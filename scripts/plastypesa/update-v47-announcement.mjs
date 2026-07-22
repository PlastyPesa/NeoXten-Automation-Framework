#!/usr/bin/env node
/**
 * Global in-app announcement: invite users to update to Play build 47 (1.0.34).
 * Dry run by default; pass --send to deliver.
 */
import { readFileSync } from 'node:fs';

const API =
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

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

const stamp = new Date().toISOString().slice(0, 10);
const payload = {
  title: 'Update PlastyPesa on Google Play',
  message:
    'Version 1.0.34 is live — smoother community stats, privacy-safe Paid Rewards Proof, and Kenya founding season rewards. Update on Google Play now, then open Leaderboard.',
  bannerScope: 'app_wide',
  bannerPosition: 'center',
  bannerStyle: 'premium',
  bannerDurationSec: 20,
  bannerId: `update-v47-${stamp}`,
};

const dry = await json('/admin/announcements', {
  method: 'POST',
  headers,
  body: JSON.stringify({ ...payload, dryRun: true }),
});
const total = dry?.data?.totalUsers ?? 0;
console.log(`Dry run: would reach ${total} users (all audiences)`);
if (total === 0) {
  console.error('Aborting — zero users matched.');
  process.exit(1);
}

if (process.argv.includes('--send')) {
  const sent = await json('/admin/announcements', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  console.log(
    `Sent: ${sent?.data?.sentCount ?? '?'} / ${sent?.data?.totalUsers ?? total} users`,
  );
  console.log(`bannerId: ${payload.bannerId}`);
} else {
  console.log('Pass --send to deliver update announcement.');
}
