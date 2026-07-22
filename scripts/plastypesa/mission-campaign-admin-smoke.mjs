#!/usr/bin/env node
/**
 * Smoke-test Mission Campaign admin: login, dry-run publish, live bundle check.
 */
import { readFileSync } from 'node:fs';
import { MISSION_CAMPAIGN_TEMPLATES } from './mission-campaign-templates.mjs';

const API =
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';
const ADMIN_ORIGIN = 'https://plastypesa.com';

const credentials = readFileSync(
  'C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md',
  'utf8',
);
const adminBlock = credentials.split('## Production mobile app')[0];
const email = adminBlock.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
const password = adminBlock.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();
if (!email || !password) throw new Error('Local admin credentials unavailable');

const templateCount = Object.keys(MISSION_CAMPAIGN_TEMPLATES).length;
const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function json(path, options = {}) {
  const response = await fetch(`${path.startsWith('http') ? '' : API}${path}`, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path}: non-JSON (${response.status})`);
  }
  return { status: response.status, body, text };
}

// 1) Template pack count
record('template pack has 35 entries', templateCount === 35, `count=${templateCount}`);

// 2) Live admin bundle includes Mission Campaign route
const indexRes = await fetch(`${ADMIN_ORIGIN}/`);
const indexHtml = await indexRes.text();
const jsMatch = indexHtml.match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
record('live admin index loads', indexRes.ok);
let missionInBundle = false;
if (jsMatch) {
  const bundleUrl = `${ADMIN_ORIGIN}/assets/index-${jsMatch[1]}.js`;
  const bundleRes = await fetch(bundleUrl);
  const bundleText = await bundleRes.text();
  missionInBundle =
    /mission-campaign|MissionCampaign|missionCampaignTemplates/i.test(bundleText);
  record('live admin bundle references Mission Campaign', missionInBundle, bundleUrl);
} else {
  record('live admin bundle references Mission Campaign', false, 'no index js hash');
}

// 3) Admin login + dry run
const login = await json('/auth/admin-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const token = login.body?.data?.token || login.body?.token;
record('admin login', login.status === 200 && !!token);

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
};

const sample = MISSION_CAMPAIGN_TEMPLATES.week3_day1_referral_boost;
const dry = await json('/admin/announcements', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    title: sample.title,
    message: sample.message,
    audience: sample.audience,
    dryRun: true,
    bannerScope: 'main_shell',
    bannerPosition: 'top',
    bannerStyle: 'standard',
    bannerDurationSec: 14,
    bannerId: `mission-smoke-${Date.now()}`,
  }),
});
const dryData = dry.body?.data;
record(
  'mission template dry run',
  dry.status === 200 && dry.body?.type === 'success' && dryData?.dryRun === true,
  dryData ? `would reach ${dryData.totalUsers ?? dryData.sentCount ?? '?'} users` : dry.body?.message,
);

const failed = results.filter((r) => !r.pass);
console.log(`\n[mission-campaign-admin-smoke] ${results.length - failed.length} pass, ${failed.length} fail`);
process.exit(failed.length ? 1 : 0);
