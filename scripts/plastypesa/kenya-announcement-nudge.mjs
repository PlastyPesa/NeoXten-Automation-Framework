#!/usr/bin/env node
/** Kenya-only announcement dry-run then send. Credentials stay local. */
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
  title: 'Confirm Kenya for M-Pesa',
  message:
    'After opening the app, tap "I live in Kenya — earn M-Pesa" so you see the correct weekly rewards.',
  audience: 'kenya',
  bannerScope: 'screen',
  bannerPosition: 'top',
  bannerStyle: 'standard',
  bannerDurationSec: 12,
};

const dry = await json('/admin/announcements', {
  method: 'POST',
  headers,
  body: JSON.stringify({ ...payload, dryRun: true }),
});
const total = dry?.data?.totalUsers ?? 0;
console.log(`Dry run: would reach ${total} Kenya users (countryCode=KE)`);
if (total === 0) {
  console.error('Aborting send — zero users matched Kenya audience.');
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
} else {
  console.log('Pass --send to deliver (dry run passed).');
}
