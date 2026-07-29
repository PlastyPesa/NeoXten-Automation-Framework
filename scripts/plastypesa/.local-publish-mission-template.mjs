#!/usr/bin/env node
/**
 * Publish one Mission Campaign announcement template (Kenya audience).
 *
 *   node scripts/plastypesa/.local-publish-mission-template.mjs week2_day3_jobs
 *   node scripts/plastypesa/.local-publish-mission-template.mjs week2_day3_jobs --send
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { MISSION_CAMPAIGN_TEMPLATES } from "./mission-campaign-templates.mjs";

const API =
  "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";

const templateId = process.argv[2];
const doSend = process.argv.includes("--send");
if (!templateId || templateId.startsWith("--")) {
  console.error("Usage: .local-publish-mission-template.mjs <templateId> [--send]");
  process.exit(2);
}

const template = MISSION_CAMPAIGN_TEMPLATES[templateId];
if (!template) {
  console.error(`Unknown template: ${templateId}`);
  process.exit(2);
}

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
console.log(`DRY_RUN template=${templateId} kenyaUsers=${kenyaUsers}`);
console.log(`TITLE: ${template.title}`);

const outDir = resolve("C:/Users/Bobby/Documents/NeoXten-Automation-Framework/.neoxten");
mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, `mission-publish-${templateId}-${stamp}.json`);

if (!doSend) {
  writeFileSync(
    reportPath,
    JSON.stringify({ mode: "dry", templateId, kenyaUsers, announcePayload, dry }, null, 2),
  );
  console.log("Dry run only — pass --send to publish.");
  console.log("REPORT", reportPath);
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
const report = {
  mode: "send",
  templateId,
  kenyaUsers,
  announcePayload,
  sent: {
    sentCount: sent?.data?.sentCount,
    totalUsers: sent?.data?.totalUsers,
  },
  at: new Date().toISOString(),
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(
  `SENT ${sent?.data?.sentCount ?? "?"} / ${sent?.data?.totalUsers ?? kenyaUsers}`,
);
console.log(`bannerId: ${announcePayload.bannerId}`);
console.log("REPORT", reportPath);
