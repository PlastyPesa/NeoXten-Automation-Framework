#!/usr/bin/env node
/**
 * Prepend Week 1 mission learn articles (Kenya founding campaign) to learn-content master.
 * Wife can edit/save further days from Admin → Tips & Learn → Learn Articles.
 *
 *   node scripts/plastypesa/seed-mission-learn-week1.mjs          # dry run
 *   node scripts/plastypesa/seed-mission-learn-week1.mjs --send   # apply
 */
import { readFileSync } from 'node:fs';

const API =
  'https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api';

const MISSION_WEEK1_ARTICLES = [
  {
    _id: 'mission-week1-day1-kenya-pride',
    title: 'Why PlastyPesa chose Kenya first',
    description:
      'Not charity — conviction. We are proving household grade-sorting here first, with real weekly M-Pesa rewards and a published First Eco Guardian path.',
    icon: 'eco',
    status: 'ACTIVE',
    missionWeek: 1,
    missionDay: 1,
    content: `PlastyPesa exists to do something hard: teach millions of us to sort plastic by grade at home — with proof.

We chose Kenya first because household grade-sorting is unsolved globally, and Kenya is where we prove the model — create jobs, connect Africa and Europe, and grow rewards together as more learners join.

Weekly M-Pesa rewards are real today (Top 10 every Monday). First Eco Guardian: KES 20,000 for the first person to 125,000 lifetime points and 30 approved sorts — rules are public in the app.

Invite a friend during our launch boost: you both earn 2000 points once their first sorting photo is approved.`,
    tips: [
      'Sorting proof counts toward First Eco Guardian — 30 approved sorts required.',
      'One clear photo of two or more clean plastics of the same grade can earn up to 4000 points when approved.',
      'When more learners join, we expand weekly rewards together — Top 10, then Top 20.',
    ],
  },
  {
    _id: 'mission-week1-day2-sort-habit',
    title: 'One photo, real proof',
    description:
      'Sort by grade at home. One clear photo of two or more clean items of the same grade — fresh photo every time.',
    icon: 'recycling',
    status: 'ACTIVE',
    missionWeek: 1,
    missionDay: 2,
    content: `Your sort photo is proof that you are building the habit Kenya needs.

Put two or more clean plastics of the same grade in one clear photo. They can sit side by side — a bag is optional. Rinse and dry items first.

Every approved sort earns up to 4000 points and counts toward First Eco Guardian (30 approved sorts). If we ask you to retry, you can submit again the same day with a fresh photo.`,
    tips: [
      'PET bottles, HDPE containers, and PP caps are different grades — keep them separate.',
      'Good lighting and focus help our team approve faster.',
      'Rejected? Fix the issue and resubmit today — no need to wait until tomorrow.',
    ],
  },
  {
    _id: 'mission-week1-day3-community',
    title: 'We are building this together',
    description:
      'Every verified sort this week helps Kenya prove grade-sorting at home. Check live counters on Home.',
    icon: 'public',
    status: 'ACTIVE',
    missionWeek: 1,
    missionDay: 3,
    content: `PlastyPesa is a community proof engine. Every verified sort adds to the story that households can sort plastic by grade.

Open Home to see learners in Kenya, verified sorts this week, and progress toward bigger weekly boards. Your invite helps everyone — launch boost still 2000 + 2000 for both of you, paid on their first approved sort.`,
    tips: [
      'Pull to refresh Home to see the latest community counters.',
      'Share your eco-handle progress — never share private data.',
      'Sorting + learning + invites all stack toward lifetime Eco Guardian progress.',
    ],
  },
  {
    _id: 'mission-week1-day4-eco-guardian',
    title: 'First Eco Guardian — the rules',
    description:
      'KES 20,000 for the first person to 125,000 lifetime points and 30 approved sorts. Learn, sort at home, and track your progress on Home.',
    icon: 'eco',
    status: 'ACTIVE',
    missionWeek: 1,
    missionDay: 4,
    content: `First Eco Guardian is a founding reward for Kenya learners who earn points and prove real sorting at home.

You need 125,000 lifetime points AND 30 approved sort proofs. Rules are fixed and public. Tap First Eco Guardian on Home to track your progress.

When you cross the line, our team verifies and pays.`,
    tips: [
      'Approved sorts are the gate — keep submitting clear grade-sorted photos.',
      'Daily quiz + read-to-earn + EcoSort stack with sorting for lifetime total.',
      'Tie-break: higher approved sort count, then earlier qualifying timestamp.',
    ],
  },
  {
    _id: 'mission-week1-day5-quiz',
    title: 'Learn daily, sort for proof',
    description:
      'Daily quiz earns up to 1000 points once per day. Combine learning with sorting proof for the weekly board.',
    icon: 'energy_savings_leaf',
    status: 'ACTIVE',
    missionWeek: 1,
    missionDay: 5,
    content: `Learning and sorting work together. The daily quiz teaches plastic grades and circular-economy rules — one full quiz per day for up to 1000 points.

Sorting proof is what makes you a builder in Kenya's founding season. Stack quiz points with approved sorts to climb the weekly leaderboard and your lifetime Eco Guardian path.`,
    tips: [
      'Complete one daily quiz per day for the full point band.',
      'Read articles in Learn — earn-by-reading rewards genuine reading time.',
      'EcoSort in Learn reinforces the same grades you sort at home.',
    ],
  },
  {
    _id: 'mission-week1-day6-referral',
    title: 'Invite a friend — both earn',
    description:
      'Launch boost: 2000 + 2000 points when your friend’s first sorting photo is approved. Help us grow the weekly board for everyone.',
    icon: 'public',
    status: 'ACTIVE',
    missionWeek: 1,
    missionDay: 6,
    content: `Growth rewards everyone. During our launch boost, you and your friend each earn 2000 points once their first sorting photo is approved — not when they join with your referral link.

When more people join and sort, PlastyPesa expands weekly rewards — Top 10 today, Top 20 next. Your invite is part of the mission, not a side quest.`,
    tips: [
      'Share your personal referral link from Profile — not a bulk spam blast.',
      'Help friends understand sorting proof — it protects the community.',
      'Referral points count toward lifetime totals and weekly rank during the boost.',
    ],
  },
  {
    _id: 'mission-week1-day7-weekly',
    title: 'Weekly rewards every Monday',
    description:
      'Top learners on the weekly board earn real M-Pesa rewards. Sort, learn, and stay consistent.',
    icon: 'recycling',
    status: 'ACTIVE',
    missionWeek: 1,
    missionDay: 7,
    content: `Every week resets Sunday 00:00 UTC. Climb the board with sorting proof, daily quiz, reading, EcoSort, and community actions.

Top ranks receive real weekly M-Pesa rewards — recognition for effort, not chance. Keep your sort photos clear and your learning streak alive.`,
    tips: [
      'Check Leaderboard for weekly rank and reward tiers.',
      'Approved sorts are among the highest-value actions you can take.',
      'Week 2 mission articles continue in Learn — keep reading.',
    ],
  },
];

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

const existingRes = await json('/admin/learn', { headers });
const existing = existingRes?.data || [];
const existingIds = new Set(existing.map((a) => a._id || a.title));

const toAdd = MISSION_WEEK1_ARTICLES.filter(
  (a) => !existingIds.has(a._id) && !existingIds.has(a.title),
);

console.log(`Existing articles: ${existing.length}`);
console.log(`Week 1 mission articles to prepend: ${toAdd.length}`);
toAdd.forEach((a) => console.log(`  + ${a._id} — ${a.title}`));

if (toAdd.length === 0) {
  console.log('Nothing to add — Week 1 mission articles already present.');
  process.exit(0);
}

const merged = [...toAdd, ...existing];

if (!process.argv.includes('--send')) {
  console.log(`Dry run: would save ${merged.length} articles (${toAdd.length} new at top).`);
  console.log('Pass --send to apply.');
  process.exit(0);
}

await json('/admin/learn', {
  method: 'PUT',
  headers,
  body: JSON.stringify({ articles: merged }),
});

console.log(`Saved ${merged.length} learn articles (${toAdd.length} mission Week 1 prepended).`);
