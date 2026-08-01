#!/usr/bin/env node
/**
 * A1 — 4s in-app WhatsApp marketing banner (auto-dismiss).
 *
 *   node scripts/plastypesa/publish-whatsapp-marketing-banner.mjs
 *   node scripts/plastypesa/publish-whatsapp-marketing-banner.mjs --send
 *   node scripts/plastypesa/publish-whatsapp-marketing-banner.mjs --send --revision=2
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
const BANNER_ID = `ke-whatsapp-support-2026-07-28${
  revision ? `-r${revision}` : ""
}`;

// 4 seconds ≈ short skim. Exact screen: Profile → WhatsApp support.
const payload = {
  active: true,
  untilAdminDismiss: false,
  durationHours: 168,
  title: "We're on WhatsApp",
  message:
    "Profile → WhatsApp support. Message us anytime. Replies within 24h. We never ask for your M-Pesa PIN or any fee.",
  inAppBanner: {
    bannerId: BANNER_ID,
    bannerScope: "app_wide",
    bannerPosition: "center",
    bannerStyle: "premium",
    bannerDurationSec: 4,
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
  console.log("Dry run — WhatsApp 4s marketing banner:");
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

const config = saved?.data?.config ?? {};
console.log("WhatsApp marketing banner published.");
console.log(
  JSON.stringify(
    {
      bannerId: config?.inAppBanner?.bannerId,
      active: config.active,
      untilAdminDismiss: config.untilAdminDismiss,
      persistOnScreen: config?.inAppBanner?.persistOnScreen,
      bannerDurationSec: config?.inAppBanner?.bannerDurationSec,
      title: config.title,
      message: config.message,
      endsAt: config.endsAt,
      locales: Object.keys(config.translations ?? {}).sort(),
    },
    null,
    2,
  ),
);

if (config.untilAdminDismiss === true || config?.inAppBanner?.persistOnScreen === true) {
  console.error(
    "\nFAIL: server persisted this as an admin-dismissed banner — it will not auto-dismiss.",
  );
  process.exit(1);
}
