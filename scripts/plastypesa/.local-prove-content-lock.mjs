/**
 * Live prove Phase 0 content lock on production API.
 *   node scripts/plastypesa/.local-prove-content-lock.mjs
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
if (!email || !password) throw new Error("admin credentials missing");

async function json(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body };
}

const login = await json("/auth/admin-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const token = login.body?.data?.token || login.body?.token;
if (!token) throw new Error("login failed: " + JSON.stringify(login.body).slice(0, 200));

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};

const settings = await json("/admin/automation-settings", { headers });
const s = settings.body?.data || {};
const locked = ["dailyQuiz", "dailyTips", "dailyAnnouncement", "contentPipeline"];
const settingsReport = {};
for (const k of locked) {
  settingsReport[k] = {
    enabled: s[k]?.enabled,
    ownerLocked: s[k]?.ownerLocked,
  };
}

const runNow = await json("/admin/automation/run", {
  method: "POST",
  headers,
  body: JSON.stringify({ task: "dailyQuiz" }),
});

const runTips = await json("/admin/automation/run", {
  method: "POST",
  headers,
  body: JSON.stringify({ task: "dailyTips" }),
});

const out = {
  at: new Date().toISOString(),
  settingsStatus: settings.status,
  settingsReport,
  runDailyQuiz: { status: runNow.status, code: runNow.body?.code, message: runNow.body?.message },
  runDailyTips: { status: runTips.status, code: runTips.body?.code, message: runTips.body?.message },
};

const ok =
  runNow.status === 403 &&
  runTips.status === 403 &&
  locked.every((k) => s[k]?.enabled === false && s[k]?.ownerLocked === true);

console.log(JSON.stringify(out, null, 2));
console.log(ok ? "PROVE_OK" : "PROVE_FAIL");
process.exit(ok ? 0 : 1);
