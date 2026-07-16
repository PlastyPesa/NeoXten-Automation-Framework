#!/usr/bin/env node
/**
 * Operational recovery for the launch-blocking zero-active-daily-quiz state.
 * Uses the real admin generation -> Content Queue approval -> app API path.
 * Credentials and tokens remain local and are never printed.
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
    throw new Error(`${path}: non-JSON response (${response.status})`);
  }
  if (!response.ok || body.type === 'error') {
    throw new Error(
      `${path}: HTTP ${response.status} — ${body.message || 'request failed'}`,
    );
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
const adminHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`,
};

const startedAt = Date.now();
let quizDraft;
const pendingBeforeRun = await json('/admin/automation/drafts', {
  headers: adminHeaders,
});
quizDraft = (pendingBeforeRun?.data?.drafts || [])
  .filter(
    (draft) =>
      draft?.type === 'quiz' &&
      draft?.status === 'pending' &&
      new Date(draft.createdAt || 0).getTime() >= startedAt - 15 * 60_000,
  )
  .sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() -
      new Date(a.createdAt || 0).getTime(),
  )[0];

if (!quizDraft) {
  console.log('Generating a fresh translated daily quiz through admin automation...');
  const runResponse = await fetch(`${API}/admin/automation/run`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ task: 'dailyQuiz' }),
  });
  if (!runResponse.ok && runResponse.status !== 504) {
    const body = await runResponse.text();
    throw new Error(
      `/admin/automation/run: HTTP ${runResponse.status} — ${body.slice(0, 200)}`,
    );
  }
  if (runResponse.status === 504) {
    console.log(
      'API Gateway timed out while the Lambda continued; waiting for its draft...',
    );
  }
} else {
  console.log('Using the recent pending quiz draft from the timed-out run.');
}

for (let attempt = 0; attempt < 18 && !quizDraft; attempt += 1) {
  const draftPayload = await json('/admin/automation/drafts', {
    headers: adminHeaders,
  });
  const drafts = Array.isArray(draftPayload?.data?.drafts)
    ? draftPayload.data.drafts
    : [];
  quizDraft = drafts
    .filter(
      (draft) =>
        draft?.type === 'quiz' &&
        draft?.status === 'pending' &&
        new Date(draft.createdAt || 0).getTime() >= startedAt - 60_000,
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime(),
    )[0];
  if (!quizDraft) await new Promise((resolve) => setTimeout(resolve, 10_000));
}
if (!quizDraft?.id) throw new Error('No pending quiz draft was generated');

await json(`/admin/automation/drafts/${encodeURIComponent(quizDraft.id)}`, {
  method: 'PUT',
  headers: adminHeaders,
  body: JSON.stringify({ action: 'approve' }),
});
console.log('Fresh daily quiz approved and published through Content Queue.');
