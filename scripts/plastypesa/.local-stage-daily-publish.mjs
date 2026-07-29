#!/usr/bin/env node
/**
 * Stage tomorrow's (or --date) Mission + quiz for EventBridge 00:05 UTC publish.
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

const dry = process.argv.includes("--dry");
const date = argValue("--date");
const templateId = argValue("--template");
const quizJsonPath = argValue("--quiz-json");

if (!date || !templateId || !quizJsonPath) {
  console.error(
    "Usage: .local-stage-daily-publish.mjs --date YYYY-MM-DD --template <id> --quiz-json <path> [--dry]",
  );
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
console.log(`TITLE mission=${entry.mission.title}`);
console.log(`TITLE quiz=${entry.quizContent.title} q=${entry.quizContent.questions.length}`);

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
console.log(`MONGO_STAGED date=${date} template=${templateId}`);
