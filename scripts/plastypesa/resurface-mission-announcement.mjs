#!/usr/bin/env node
/**
 * Re-send Week 1 Day 1 mission announcement with a fresh bannerId so
 * unread notifications surface on next cold start.
 *
 *   node scripts/plastypesa/resurface-mission-announcement.mjs --send
 */
import { readFileSync } from 'node:fs';
import { MISSION_CAMPAIGN_TEMPLATES } from './mission-campaign-templates.mjs';

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

const template =
  MISSION_CAMPAIGN_TEMPLATES.week1_day1_kenya_pride ||
  MISSION_CAMPAIGN_TEMPLATES.eco_guardian_rules_reminder;

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
  title: template.title,
  message: template.message,
  audience: template.audience,
  bannerScope: 'main_shell',
  bannerPosition: 'top',
  bannerStyle: 'standard',
  bannerDurationSec: 20,
  bannerId: `mission-${template.id}-resurface-${stamp}`,
};

const dry = await json('/admin/announcements', {
  method: 'POST',
  headers,
  body: JSON.stringify({ ...payload, dryRun: true }),
});
console.log(`Dry run: would reach ${dry?.data?.totalUsers ?? 0} Kenya users`);

if (process.argv.includes('--send')) {
  const sent = await json('/admin/announcements', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  console.log(
    `Resurfaced: ${sent?.data?.sentCount ?? '?'} / ${sent?.data?.totalUsers ?? dry?.data?.totalUsers ?? '?'}`,
  );
  console.log(`bannerId: ${payload.bannerId}`);
} else {
  console.log('Pass --send to deliver fresh unread announcements.');
}
