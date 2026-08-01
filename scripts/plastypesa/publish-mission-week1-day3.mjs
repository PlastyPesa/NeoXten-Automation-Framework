#!/usr/bin/env node
/**
 * Week 1 Day 3 — Kenya mission announcement + Learn article (if missing).
 *
 *   node scripts/plastypesa/publish-mission-week1-day3.mjs
 *   node scripts/plastypesa/publish-mission-week1-day3.mjs --send
 */
import { readFileSync } from "node:fs";
import { MISSION_CAMPAIGN_TEMPLATES } from "./mission-campaign-templates.mjs";

const API =
  "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";

const DAY3_LEARN = {
  _id: "mission-week1-day3-community",
  title: "We are building this together",
  description:
    "Every verified sort this week helps Kenya prove grade-sorting at home. Check live counters on Home.",
  icon: "public",
  status: "ACTIVE",
  missionWeek: 1,
  missionDay: 3,
  content: `PlastyPesa is a community proof engine. Every verified sort adds to the story that households can sort plastic by grade.

Open Home to see learners in Kenya, verified sorts this week, and progress toward bigger weekly boards. Your invite helps everyone — launch boost still 2000 + 2000 for both of you.`,
  tips: [
    "Pull to refresh Home to see the latest community counters.",
    "Share your eco-handle progress — never share private data.",
    "Sorting + learning + invites all stack toward lifetime Eco Guardian progress.",
  ],
};

const credentials = readFileSync(
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md",
  "utf8",
);
const adminBlock = credentials.split("## Production mobile app")[0];
const email = adminBlock.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
const password = adminBlock.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();
if (!email || !password) throw new Error("Local admin credentials unavailable");

async function json(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path}: non-JSON (${response.status})`);
  }
  if (!response.ok || body.type === "Error" || body.type === "error") {
    throw new Error(`${path}: HTTP ${response.status} — ${body.message || "failed"}`);
  }
  return body;
}

const template = MISSION_CAMPAIGN_TEMPLATES.week1_day3_community;
if (!template) throw new Error("week1_day3_community template missing");

const login = await json("/auth/admin-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const token = login?.data?.token || login?.token;
if (!token) throw new Error("Admin login returned no token");

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};

const stamp = new Date().toISOString().slice(0, 10);
const announcePayload = {
  title: template.title,
  message: template.message,
  audience: template.audience,
  bannerScope: "main_shell",
  bannerPosition: "top",
  bannerStyle: "standard",
  bannerDurationSec: 20,
  bannerId: `mission-${template.id}-${stamp}`,
};

const dry = await json("/admin/announcements", {
  method: "POST",
  headers,
  body: JSON.stringify({ ...announcePayload, dryRun: true }),
});
const kenyaUsers = dry?.data?.totalUsers ?? 0;
console.log(`Announcement dry run: ${kenyaUsers} Kenya users`);

const existingRes = await json("/admin/learn", { headers });
const existing = existingRes?.data || [];
const hasDay3 = existing.some(
  (a) =>
    a._id === DAY3_LEARN._id ||
    a.title === DAY3_LEARN.title ||
    (a.missionWeek === 1 && a.missionDay === 3),
);
console.log(`Learn articles: ${existing.length}; day3 present: ${hasDay3}`);

if (!process.argv.includes("--send")) {
  console.log("Dry run only.");
  console.log("Announcement:", JSON.stringify(announcePayload, null, 2));
  if (!hasDay3) console.log("Would prepend learn article:", DAY3_LEARN._id);
  console.log("Pass --send to publish.");
  process.exit(kenyaUsers > 0 ? 0 : 1);
}

if (kenyaUsers === 0) {
  console.error("Aborting announcement — zero Kenya users.");
  process.exit(1);
}

const sent = await json("/admin/announcements", {
  method: "POST",
  headers,
  body: JSON.stringify(announcePayload),
});
console.log(
  `Announcement sent: ${sent?.data?.sentCount ?? "?"} / ${sent?.data?.totalUsers ?? kenyaUsers}`,
);
console.log(`bannerId: ${announcePayload.bannerId}`);

if (!hasDay3) {
  await json("/admin/learn", {
    method: "PUT",
    headers,
    body: JSON.stringify({ articles: [DAY3_LEARN, ...existing] }),
  });
  console.log(`Learn article added: ${DAY3_LEARN._id}`);
} else {
  console.log("Learn day 3 already present — skipped.");
}
