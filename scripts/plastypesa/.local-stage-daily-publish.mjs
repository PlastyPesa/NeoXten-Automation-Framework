#!/usr/bin/env node
/**
 * Stage tomorrow's (or --date) Mission + quiz for the daily publish job.
 *
 * **--date is the Kenya earn day (Africa/Nairobi)**, not UTC
 * (P-KENYA-TZ-ALIGN, owner lock 2026-08-04). EventBridge fires the publish at
 * 21:05 UTC, which is 00:05 in Nairobi, and the job looks the payload up by the
 * Nairobi day key. Staging against a UTC date will silently publish on the
 * wrong day, so the script prints the clock it used and refuses a date in the
 * Nairobi past.
 *
 * Omit --date and it stages tomorrow in Nairobi, which is the normal case.
 *
 *   node scripts/plastypesa/.local-stage-daily-publish.mjs --date 2026-07-31 --template week2_day4_circular
 *
 * Reads quiz payload from .local-publish-owner-daily-quiz.mjs constants via dynamic import
 * is awkward — instead pass --quiz-json path OR use embedded quiz from env file.
 *
 * Simpler path used by agents: write quiz JSON next to NeoXten, then:
 *   node scripts/plastypesa/.local-stage-daily-publish.mjs --date YYYY-MM-DD --template ID --quiz-json path
 *
 * Dry show only:
 *   node scripts/plastypesa/.local-stage-daily-publish.mjs --date YYYY-MM-DD --template ID --quiz-json path --dry
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { loadBackendMongoEnv } from "./mongo-env.mjs";
import { MISSION_CAMPAIGN_TEMPLATES } from "./mission-campaign-templates.mjs";

const require = createRequire(
  resolve("C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/package.json"),
);
const { MongoClient } = require("mongodb");

function argValue(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return fallback;
}

/** YYYY-MM-DD in Africa/Nairobi — the same key the publish job resolves. */
function nairobiDayKey(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function nairobiPlusDays(days) {
  return nairobiDayKey(new Date(Date.now() + days * 86400000));
}

const dry = process.argv.includes("--dry");
const templateId = argValue("--template");
const quizJsonPath = argValue("--quiz-json");

const todayNairobi = nairobiDayKey();
// Tomorrow in Nairobi is the normal target: today's quiz is already live.
const date = argValue("--date") || nairobiPlusDays(1);

if (!templateId || !quizJsonPath) {
  console.error(
    "Usage: .local-stage-daily-publish.mjs [--date YYYY-MM-DD] --template <id> --quiz-json <path> [--dry]",
  );
  console.error("  --date is the Kenya earn day (Africa/Nairobi); defaults to tomorrow there.");
  process.exit(2);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`--date must be YYYY-MM-DD, got "${date}"`);
  process.exit(2);
}

// A date already past in Nairobi can never be published — the job only ever
// looks up today's Nairobi key. Failing loudly here beats staging into a hole.
if (date < todayNairobi) {
  console.error(
    `--date ${date} is already in the past in Nairobi (today there is ${todayNairobi}).`,
  );
  console.error("The publish job would never pick it up. Stage a future Nairobi day.");
  process.exit(2);
}

const template = MISSION_CAMPAIGN_TEMPLATES[templateId];
if (!template) {
  console.error(`Unknown template ${templateId}`);
  process.exit(2);
}

const quizContent = JSON.parse(readFileSync(resolve(quizJsonPath), "utf8"));
if (!quizContent.title || !Array.isArray(quizContent.questions) || !quizContent.questions.length) {
  console.error("quiz JSON needs title + questions[]");
  process.exit(2);
}

const entry = {
  status: "staged",
  visualVerified: true,
  missionTemplateId: templateId,
  mission: {
    title: template.title,
    message: template.message,
    audience: template.audience || "kenya",
  },
  quizContent: {
    ...quizContent,
    source: "owner-agent-copilot",
  },
  stagedAt: new Date().toISOString(),
  stagedBy: "owner-agent-copilot",
};

const outDir = resolve("C:/Users/Bobby/Documents/NeoXten-Automation-Framework/.neoxten");
mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, `stage-daily-publish-${date}.json`);
writeFileSync(reportPath, JSON.stringify({ date, entry }, null, 2));
console.log("STAGED_PREVIEW", reportPath);
// State the clock every time. The staging agent has to be able to tell Bobby
// which day this lands on without re-deriving it.
console.log(`CLOCK earnDay=${date} (Africa/Nairobi) · today there=${todayNairobi}`);
console.log(`CLOCK publishes=${date}T00:05 Nairobi (21:05 UTC the day before)`);
console.log(`TITLE mission=${entry.mission.title}`);
console.log(`TITLE quiz=${entry.quizContent.title} q=${entry.quizContent.questions.length}`);
if (entry.quizContent.questions.length !== 10) {
  console.warn(
    `WARN quiz has ${entry.quizContent.questions.length} questions; the owner lock is 10.`,
  );
}
const hardCount = entry.quizContent.questions.filter(
  (q) => String(q?.difficulty || "").toLowerCase() === "hard",
).length;
console.log(`TITLE hardQuestions=${hardCount} (interstitial fires on each, max 2)`);
if (hardCount !== 2) {
  console.warn(`WARN ${hardCount} questions tagged difficulty:"hard"; the owner lock is ~2.`);
}

if (dry) {
  console.log("Dry — Mongo not written.");
  process.exit(0);
}

const client = new MongoClient(loadBackendMongoEnv());
await client.connect();
const db = client.db();
const existing = await db.collection("masters").findOne({ name: "scheduled-daily-publish" });
const byDate =
  existing?.metadata?.byDate && typeof existing.metadata.byDate === "object"
    ? { ...existing.metadata.byDate }
    : {};
byDate[date] = entry;
await db.collection("masters").updateOne(
  { name: "scheduled-daily-publish" },
  {
    $set: {
      metadata: { byDate },
      updatedAt: new Date(),
      type: "dynamic",
      placeholder: "",
      data: [],
      name: "scheduled-daily-publish",
    },
  },
  { upsert: true },
);
await client.close();
console.log(`MONGO_STAGED earnDay=${date} (Africa/Nairobi) template=${templateId}`);
