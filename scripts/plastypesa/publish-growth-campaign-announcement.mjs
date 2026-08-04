#!/usr/bin/env node
/**
 * Kenya growth announcement — invite boost until 11 Aug + First Eco Guardian reminder.
 * Does NOT replace the pinned v56 update banner (separate top shell announcement).
 *
 *   node scripts/plastypesa/publish-growth-campaign-announcement.mjs
 *   node scripts/plastypesa/publish-growth-campaign-announcement.mjs --send
 */
import { readFileSync } from "node:fs";

const API =
  "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";

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
  title: "Invite friends — boost until 11 August",
  // P-INVITE-COPY-SWEEP: points land on the invitee's first APPROVED sort,
  // not at signup. The boost only freezes the amount.
  message:
    "Invite a friend from Profile before 11 August — you both earn 2000 bonus points once their first sorting photo is approved, not when they join. First Eco Guardian: KES 20,000 for the first person at 125,000 lifetime points and 30 approved sorts. Tap the home card for your progress.",
  audience: "kenya",
  bannerScope: "main_shell",
  bannerPosition: "top",
  bannerStyle: "standard",
  bannerDurationSec: 22,
  bannerId: `growth-invite-eco-${stamp}`,
};

const dry = await json("/admin/announcements", {
  method: "POST",
  headers,
  body: JSON.stringify({ ...announcePayload, dryRun: true }),
});
const kenyaUsers = dry?.data?.totalUsers ?? 0;
console.log(`Announcement dry run: ${kenyaUsers} Kenya users`);
console.log(JSON.stringify(announcePayload, null, 2));

if (!process.argv.includes("--send")) {
  console.log("Pass --send to publish Kenya announcement (does not replace pinned update banner).");
  process.exit(kenyaUsers > 0 ? 0 : 1);
}

if (kenyaUsers === 0) {
  console.error("Aborting — zero Kenya users.");
  process.exit(1);
}

const sent = await json("/admin/announcements", {
  method: "POST",
  headers,
  body: JSON.stringify(announcePayload),
});
console.log(
  `Sent: ${sent?.data?.sentCount ?? "?"} / ${sent?.data?.totalUsers ?? kenyaUsers}`,
);
console.log(`bannerId: ${announcePayload.bannerId}`);
