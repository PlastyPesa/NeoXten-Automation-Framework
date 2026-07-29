#!/usr/bin/env node
/**
 * Wait until target UTC day (default: next UTC midnight), then publish:
 *   1) Mission Campaign daily announcement
 *   2) Owner daily quiz (visual-verified payload in .local-publish-owner-daily-quiz.mjs)
 *
 * Usage:
 *   node scripts/plastypesa/.local-schedule-utc-midnight-daily.mjs
 *   node scripts/plastypesa/.local-schedule-utc-midnight-daily.mjs --date 2026-07-30
 *   node scripts/plastypesa/.local-schedule-utc-midnight-daily.mjs --template week2_day3_jobs
 *   node scripts/plastypesa/.local-schedule-utc-midnight-daily.mjs --dry-wait   # print wait only
 *   node scripts/plastypesa/.local-schedule-utc-midnight-daily.mjs --now        # skip wait (DANGER)
 *
 * Owner GO 2026-07-29 night: arm for UTC 2026-07-30 so Kenya 00:00–03:00 trap is avoided.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LOG_DIR = resolve(ROOT, ".neoxten");
mkdirSync(LOG_DIR, { recursive: true });

function argValue(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return fallback;
}

const dryWait = process.argv.includes("--dry-wait");
const forceNow = process.argv.includes("--now");
const templateId = argValue("--template", "week2_day3_jobs");
const dateArg = argValue("--date", null);

function nextUtcMidnight(from = new Date()) {
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0),
  );
}

function utcMidnightForDate(yyyyMmDd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) throw new Error(`Bad --date ${yyyyMmDd}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0));
}

const now = new Date();
let target = dateArg ? utcMidnightForDate(dateArg) : nextUtcMidnight(now);
// If --date is today UTC and already past midnight, target stays that midnight (may be in past → publish immediately).
if (!dateArg && forceNow) {
  target = now;
}

const logPath = resolve(
  LOG_DIR,
  `utc-midnight-daily-${target.toISOString().slice(0, 10)}.log`,
);
const resultPath = resolve(
  LOG_DIR,
  `utc-midnight-daily-${target.toISOString().slice(0, 10)}.json`,
);

function log(line) {
  const row = `[${new Date().toISOString()}] ${line}`;
  console.log(row);
  appendFileSync(logPath, row + "\n");
}

const waitMs = Math.max(0, target.getTime() - Date.now());
log(`TARGET_UTC ${target.toISOString()}`);
log(`NOW_UTC ${now.toISOString()}`);
log(`WAIT_MS ${waitMs} (~${Math.round(waitMs / 60000)} min)`);
log(`TEMPLATE ${templateId}`);
log(`FORCE_NOW ${forceNow} DRY_WAIT ${dryWait}`);

if (dryWait) {
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        mode: "dry-wait",
        targetUtc: target.toISOString(),
        waitMs,
        templateId,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!forceNow && waitMs > 0) {
  log("SLEEPING until UTC target…");
  // Chunked sleep so process stays alive and logs heartbeats
  const chunk = 60_000;
  let left = waitMs;
  while (left > 0) {
    const slice = Math.min(chunk, left);
    await new Promise((r) => setTimeout(r, slice));
    left = target.getTime() - Date.now();
    if (left > 0) log(`HEARTBEAT left_ms=${left}`);
  }
}

log("WAKE — publishing mission then quiz");

function runNode(scriptRel, args = []) {
  return new Promise((resolvePromise, reject) => {
    const script = resolve(ROOT, scriptRel);
    log(`RUN node ${scriptRel} ${args.join(" ")}`);
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      out += s;
      process.stdout.write(s);
      appendFileSync(logPath, s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      err += s;
      process.stderr.write(s);
      appendFileSync(logPath, s);
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ code, out, err });
      else reject(new Error(`${scriptRel} exited ${code}\n${err || out}`));
    });
  });
}

const report = {
  targetUtc: target.toISOString(),
  publishedAt: null,
  templateId,
  mission: null,
  quiz: null,
  ok: false,
};

try {
  // Extra 5s cushion past midnight for clock skew
  if (!forceNow) await new Promise((r) => setTimeout(r, 5000));
  log(`UTC_DAY_NOW ${new Date().toISOString().slice(0, 10)}`);

  report.mission = await runNode(
    "scripts/plastypesa/.local-publish-mission-template.mjs",
    [templateId, "--send"],
  );
  report.quiz = await runNode(
    "scripts/plastypesa/.local-publish-owner-daily-quiz.mjs",
    [],
  );
  report.publishedAt = new Date().toISOString();
  report.ok = true;
  log("DONE ok=true");
} catch (e) {
  report.error = String(e?.message || e);
  log(`FAIL ${report.error}`);
  writeFileSync(resultPath, JSON.stringify(report, null, 2));
  process.exit(1);
}

writeFileSync(resultPath, JSON.stringify(report, null, 2));
log(`RESULT ${resultPath}`);
process.exit(0);
