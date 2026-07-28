#!/usr/bin/env node
/**
 * Soft "keep PlastyPesa updated" glass banner (~4s). Not scare copy.
 *
 *   node scripts/plastypesa/publish-soft-update-pinned-banner.mjs
 *   node scripts/plastypesa/publish-soft-update-pinned-banner.mjs --send
 *   node scripts/plastypesa/publish-soft-update-pinned-banner.mjs --send --revision=2
 */
import { readFileSync } from "node:fs";

const API = "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";

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
    throw new Error(
      `${path}: HTTP ${response.status} — ${body.message || "failed"}`,
    );
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

const revision = process.argv
  .find((arg) => arg.startsWith("--revision="))
  ?.split("=")[1];
const BANNER_ID = `soft-keep-updated-2026-07-28${
  revision ? `-r${revision}` : ""
}`;

const payload = {
  active: true,
  untilAdminDismiss: false,
  durationHours: 72,
  title: "Please keep PlastyPesa updated",
  message:
    "Make sure you are on the latest build from Google Play. Your points stay safe. Open Play → PlastyPesa → Update if one is waiting.",
  inAppBanner: {
    bannerId: BANNER_ID,
    bannerScope: "app_wide",
    // Top toast (M-Pesa / Sendwave style) — center is easy to miss under Home cards.
    bannerPosition: "top",
    bannerStyle: "premium",
    bannerDurationSec: 20,
    persistOnScreen: false,
  },
};

const BRAND_BANNED = /\b(prize|prizes|lottery|gambl|win|winner|winnings)\b/i;
for (const [field, value] of Object.entries({
  title: payload.title,
  message: payload.message,
})) {
  const hit = value.match(BRAND_BANNED);
  if (hit) throw new Error(`Brand-unsafe wording in ${field}: "${hit[0]}"`);
}

if (!process.argv.includes("--send")) {
  const current = await json("/admin/active-in-app-banner", { headers });
  console.log("Dry run — soft keep-updated 4s glass banner:");
  console.log(JSON.stringify(payload, null, 2));
  console.log(
    "Current pinned:",
    JSON.stringify(current?.data?.config ?? null, null, 2),
  );
  console.log("Pass --send to publish on production.");
  process.exit(0);
}

const saved = await json("/admin/active-in-app-banner", {
  method: "PUT",
  headers,
  body: JSON.stringify(payload),
});

console.log("Pinned soft keep-updated banner published.");
console.log(
  JSON.stringify(
    {
      bannerId: BANNER_ID,
      active: saved?.data?.config?.active,
      title: saved?.data?.config?.title,
      message: saved?.data?.config?.message,
      endsAt: saved?.data?.config?.endsAt,
      inAppBanner: saved?.data?.config?.inAppBanner,
    },
    null,
    2,
  ),
);
