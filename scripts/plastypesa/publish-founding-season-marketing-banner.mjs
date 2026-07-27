#!/usr/bin/env node
/**
 * First KE marketing campaign on the auto-dismiss banner path.
 *
 * Every pinned banner shipped so far was an operational notice published with
 * `untilAdminDismiss: true` — and the server force-sets `persistOnScreen: true`
 * for those, so they sit on the user's Home until an admin clears them. That is
 * right for an outage or a fairness notice and wrong for marketing: a campaign
 * that has to be tapped away is an interruption, not a message.
 *
 * So this publishes with `untilAdminDismiss: false` plus a short
 * `bannerDurationSec`, which is the combination that exercises the client's
 * auto-dismiss timer. It is deliberately the *only* difference from the
 * operational scripts.
 *
 * Copy notes:
 *  - No member count. The banner is a static string; the live count belongs to
 *    the pulse card on Home, which re-fetches. Putting "38 members" here would
 *    be wrong within a day and would contradict the card on the same screen.
 *  - Short on purpose. Four seconds is roughly twenty words of skim-reading; a
 *    paragraph would auto-dismiss before it could be read.
 *  - Brand-safe: reward / earn / grow. Never prize, win or lottery.
 *  - ×7 is automatic — `upsertSingleton` runs the copy through
 *    `translateAnnouncementText` and `getPublicForUser` resolves against the
 *    user's `preferredLanguage`, so RO/DE users get their own locale.
 *
 *   node scripts/plastypesa/publish-founding-season-marketing-banner.mjs
 *   node scripts/plastypesa/publish-founding-season-marketing-banner.mjs --send
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

// The client caps one impression per banner id per UTC day, so re-publishing
// under the same id will not re-show today. Pass --revision=<n> to cut a new id
// when the copy changes mid-day or when a device run needs a fresh impression.
const revision = process.argv
  .find((arg) => arg.startsWith("--revision="))
  ?.split("=")[1];
const BANNER_ID = `ke-founding-season-15k-2026-07-27${
  revision ? `-r${revision}` : ""
}`;

const payload = {
  active: true,
  // The whole point of this campaign: not an admin-dismissed notice.
  untilAdminDismiss: false,
  durationHours: 168,
  title: "Kenya founding season",
  message:
    "At 500 members the weekly reward pool grows to KES 15,000. Keep sorting and learning — your progress is on Home.",
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
  console.log("Dry run — would publish auto-dismiss marketing campaign:");
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
console.log("Marketing campaign published.");
console.log(
  JSON.stringify(
    {
      bannerId: config?.inAppBanner?.bannerId,
      active: config.active,
      untilAdminDismiss: config.untilAdminDismiss,
      persistOnScreen: config?.inAppBanner?.persistOnScreen,
      bannerDurationSec: config?.inAppBanner?.bannerDurationSec,
      endsAt: config.endsAt,
      locales: Object.keys(config.translations ?? {}).sort(),
      ro: config?.translations?.ro ?? null,
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
