#!/usr/bin/env node
/**
 * Stage the Home "Today's focus" day identity (P-TODAYS-FOCUS, glance Phase D).
 *
 * Same co-pilot habit as the daily quiz: the owner/agent stages a rotating
 * calendar in Mongo masters; nothing publishes itself and admin Automation AI is
 * NOT involved. The app reads today's row via `GET /api/home/earn-hub`
 * (`todaysFocus`) and self-hides when the day has no row.
 *
 * Stage a week from a file (the normal Sunday habit):
 *   node scripts/plastypesa/.local-stage-daily-focus.mjs --file focus-week.json
 *
 * Stage one day inline:
 *   node scripts/plastypesa/.local-stage-daily-focus.mjs \
 *     --date 2026-08-04 --name "Bottle Caps Day" \
 *     --line "Small caps, big pile - today's quiz and tip are about caps."
 *
 * See what the next 7 days look like (staged vs empty):
 *   node scripts/plastypesa/.local-stage-daily-focus.mjs --show
 *
 * Pull a day back off the calendar:
 *   node scripts/plastypesa/.local-stage-daily-focus.mjs --clear 2026-08-04
 *
 * Add --dry to any write to preview without touching Mongo.
 *
 * FILE SHAPE (dates are the caller's earn day: Africa/Nairobi for Kenya):
 * {
 *   "2026-08-04": {
 *     "name": "Bottle Caps Day",
 *     "line": "Small caps, big pile - today's quiz and tip are about caps.",
 *     "translations": { "ro": { "name": "Ziua capacelor", "line": "..." } }
 *   }
 * }
 *
 * Brand-safe copy only: earn / learn / reward. Never prize, lottery, win.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const require = createRequire(
  resolve("C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/package.json"),
);
const { MongoClient } = require("mongodb");

const MASTER_NAME = "daily-focus";
const BANNED = /\b(prize|prizes|lottery|gambl|jackpot|winnings|betting)\b/i;

function argValue(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) {
    return process.argv[i + 1];
  }
  return fallback;
}

const dry = process.argv.includes("--dry");
const show = process.argv.includes("--show");
const clearDate = argValue("--clear");
const filePath = argValue("--file");
const oneDate = argValue("--date");
const oneName = argValue("--name");
const oneLine = argValue("--line");

/** Kenya earn-day keys, so a staged date means what ops thinks it means. */
function nairobiDayKey(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function validate(date, entry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad date key ${date}`);
  const name = String(entry?.name || "").trim();
  const line = String(entry?.line || entry?.description || "").trim();
  if (!name || !line) {
    throw new Error(`${date}: needs BOTH name and line (the app hides half a theme)`);
  }
  if (name.length > 28) throw new Error(`${date}: name > 28 chars will clip on 360px`);
  if (line.length > 90) throw new Error(`${date}: line > 90 chars will clip to 2 rows`);
  for (const [field, value] of [["name", name], ["line", line]]) {
    if (BANNED.test(value)) throw new Error(`${date}: brand-unsafe word in ${field}`);
  }
  return {
    status: "ACTIVE",
    name,
    line,
    ...(entry.translations ? { translations: entry.translations } : {}),
    stagedAt: new Date().toISOString(),
    stagedBy: "owner-agent-copilot",
  };
}

async function withMongo(fn) {
  const client = new MongoClient(loadBackendMongoEnv());
  await client.connect();
  try {
    return await fn(client.db());
  } finally {
    await client.close();
  }
}

async function readByDate(db) {
  const existing = await db.collection("masters").findOne({ name: MASTER_NAME });
  return existing?.metadata?.byDate && typeof existing.metadata.byDate === "object"
    ? { ...existing.metadata.byDate }
    : {};
}

async function writeByDate(db, byDate) {
  await db.collection("masters").updateOne(
    { name: MASTER_NAME },
    {
      $set: {
        metadata: { byDate },
        updatedAt: new Date(),
        type: "dynamic",
        placeholder: "",
        data: [],
        name: MASTER_NAME,
      },
    },
    { upsert: true },
  );
}

function printWeek(byDate) {
  console.log("NEXT 7 DAYS (Africa/Nairobi)");
  for (let i = 0; i < 7; i += 1) {
    const key = nairobiDayKey(i);
    const entry = byDate[key];
    const state = !entry
      ? "— empty (app shows plain TODAY header)"
      : String(entry.status || "ACTIVE").toUpperCase() !== "ACTIVE"
        ? `${entry.status} (hidden)`
        : `${entry.name} · ${entry.line}`;
    console.log(`${key}  ${state}`);
  }
}

if (show) {
  await withMongo(async (db) => printWeek(await readByDate(db)));
  process.exit(0);
}

if (clearDate) {
  await withMongo(async (db) => {
    const byDate = await readByDate(db);
    if (!byDate[clearDate]) {
      console.log(`NOTHING_STAGED date=${clearDate}`);
      return;
    }
    delete byDate[clearDate];
    if (dry) {
      console.log(`Dry — would clear ${clearDate}.`);
      return;
    }
    await writeByDate(db, byDate);
    console.log(`MONGO_CLEARED date=${clearDate}`);
  });
  process.exit(0);
}

let staged = {};
if (filePath) {
  const parsed = JSON.parse(readFileSync(resolve(filePath), "utf8"));
  for (const [date, entry] of Object.entries(parsed)) {
    staged[date] = validate(date, entry);
  }
} else if (oneDate && oneName && oneLine) {
  staged[oneDate] = validate(oneDate, { name: oneName, line: oneLine });
} else {
  console.error(
    [
      "Usage:",
      "  --file <week.json> [--dry]",
      '  --date YYYY-MM-DD --name "Day Name" --line "One sentence." [--dry]',
      "  --show",
      "  --clear YYYY-MM-DD [--dry]",
    ].join("\n"),
  );
  process.exit(2);
}

const outDir = resolve("C:/Users/Bobby/Documents/NeoXten-Automation-Framework/.neoxten");
mkdirSync(outDir, { recursive: true });
const reportPath = resolve(outDir, `stage-daily-focus-${nairobiDayKey(0)}.json`);
writeFileSync(reportPath, JSON.stringify(staged, null, 2));
console.log("STAGED_PREVIEW", reportPath);
for (const [date, entry] of Object.entries(staged)) {
  console.log(`${date}  ${entry.name} · ${entry.line}`);
}

if (dry) {
  console.log("Dry — Mongo not written.");
  process.exit(0);
}

await withMongo(async (db) => {
  const byDate = await readByDate(db);
  Object.assign(byDate, staged);
  await writeByDate(db, byDate);
  console.log(`MONGO_STAGED days=${Object.keys(staged).length}`);
  printWeek(byDate);
});
