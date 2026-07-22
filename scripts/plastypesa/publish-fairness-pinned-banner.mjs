#!/usr/bin/env node
/**
 * Publish fixed fairness pinned banner (until admin clears in dashboard).
 *
 *   node scripts/plastypesa/publish-fairness-pinned-banner.mjs
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

const BANNER_ID = "fairness-freshkoala971-suspended-2026-07-22";

const payload = {
  active: true,
  untilAdminDismiss: true,
  title: "Fair play on PlastyPesa",
  message:
    "Eco-handle FreshKoala971 is suspended while we review similar-email referral activity. Farmed points were removed and the account is off this week's leaderboard. If you believe this is wrong, email support@plastypesa.com with details about your invites.",
  inAppBanner: {
    bannerId: BANNER_ID,
    bannerScope: "app_wide",
    bannerPosition: "top",
    bannerStyle: "premium",
    bannerDurationSec: 30,
    persistOnScreen: true,
  },
};

const saved = await json("/admin/active-in-app-banner", {
  method: "PUT",
  headers,
  body: JSON.stringify(payload),
});

console.log("Pinned fairness banner published.");
console.log(
  JSON.stringify(
    {
      bannerId: BANNER_ID,
      untilAdminDismiss: true,
      active: saved?.data?.config?.active,
      title: saved?.data?.config?.title,
    },
    null,
    2,
  ),
);
console.log(
  "Clear from Admin → Announcements → Pinned in-app banner → Clear pinned.",
);
