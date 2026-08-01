#!/usr/bin/env node
/**
 * Pinned in-app banner: invite users to update to Play build 56 (1.0.36).
 * Replaces any prior pinned banner (fairness, v47, etc.).
 *
 *   node scripts/plastypesa/publish-v56-update-pinned-banner.mjs
 *   node scripts/plastypesa/publish-v56-update-pinned-banner.mjs --send
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

const BANNER_ID = "update-v56-play-2026-07-24";

const payload = {
  active: true,
  untilAdminDismiss: true,
  title: "Update PlastyPesa on Google Play",
  message:
    "Version 1.0.36 is live on Google Play — smoother ads, bonus quiz archive, and Kenya founding season polish. Open Google Play, tap Update, then come back for Week 1 Day 3 on Home.",
  inAppBanner: {
    bannerId: BANNER_ID,
    bannerScope: "app_wide",
    bannerPosition: "center",
    bannerStyle: "premium",
    bannerDurationSec: 25,
    persistOnScreen: true,
  },
};

if (!process.argv.includes("--send")) {
  const current = await json("/admin/active-in-app-banner", { headers });
  console.log("Dry run — would publish pinned update banner:");
  console.log(JSON.stringify({ bannerId: BANNER_ID, ...payload }, null, 2));
  console.log(
    "Current pinned:",
    JSON.stringify(current?.data?.config ?? null, null, 2),
  );
  console.log("Pass --send to replace pinned banner on production.");
  process.exit(0);
}

const saved = await json("/admin/active-in-app-banner", {
  method: "PUT",
  headers,
  body: JSON.stringify(payload),
});

console.log("Pinned v56 update banner published.");
console.log(
  JSON.stringify(
    {
      bannerId: BANNER_ID,
      active: saved?.data?.config?.active,
      title: saved?.data?.config?.title,
      message: saved?.data?.config?.message,
    },
    null,
    2,
  ),
);
