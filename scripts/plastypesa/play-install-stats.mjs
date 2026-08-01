#!/usr/bin/env node
/**
 * Read Play Console install CSV exports from GCS + cache summary in Mongo for Daily Check.
 *
 * Usage (NeoXten root):
 *   npm run play:install-stats
 *
 * Env:
 *   PLASTYPESA_PLAY_STATS_BUCKET  — e.g. pubsite_prod_8780730627387195469
 *   PLASTYPESA_PLAY_SA_JSON       — Play service account (needs storage.objectViewer on bucket)
 *   PLASTYPESA_MONGO_URI          — optional; upserts masters.play-install-daily-summary
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { MongoClient } from "mongodb";
import { loadBackendMongoEnv } from "./mongo-env.mjs";
import { loadPlayLocalEnv } from "./play-local-env.mjs";
import { decodePlayCsvBody, parseCsvLine } from "./play-gcs-csv.mjs";

loadPlayLocalEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = path.resolve(__dirname, "../..");
const PACKAGE = process.env.PLASTYPESA_PACKAGE_NAME || "com.app.plasty_pesa";
const SA =
  process.env.PLASTYPESA_PLAY_SA_JSON ||
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/ALL CREDENTIALS FOR PLASTYPESA 15-03-2026/Play Console API - created 16-07-2026/play-publisher-plastypesa-f5274-16-07-2026.json";
const BUCKET = process.env.PLASTYPESA_PLAY_STATS_BUCKET || "";
const OUT =
  process.env.PLASTYPESA_PLAY_INSTALL_STATS_OUT ||
  path.join(NEOXTEN_ROOT, ".neoxten", "plastypesa-play-install-stats.json");

loadBackendMongoEnv();

let MONGO_URI = process.env.PLASTYPESA_MONGO_URI || process.env.MONGO_URL;
try {
  if (!MONGO_URI) MONGO_URI = loadBackendMongoEnv();
} catch {
  MONGO_URI = null;
}

function line(s = "") {
  console.log(s);
}

function parseOverviewCsv(text) {
  const rows = [];
  let dailyUserIdx = 6;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const cols = rawLine.split(",");
    if (cols[0] === "Date") {
      const headerIdx = cols.findIndex(
        (c) => c.trim().toLowerCase() === "daily user installs"
      );
      if (headerIdx >= 0) dailyUserIdx = headerIdx;
      continue;
    }
    if (cols[0]?.startsWith("#")) continue;
    const date = cols[0]?.trim();
    const dailyUserInstalls = Number.parseInt(cols[dailyUserIdx] || "0", 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(dailyUserInstalls)) continue;
    rows.push({ date, dailyUserInstalls });
  }
  return rows;
}

async function downloadOverviewCsv(storage, bucket, objectName) {
  const res = await storage.objects.get(
    { bucket, object: objectName, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return decodePlayCsvBody(res.data);
}

function parseReviewsCsv(text) {
  const reviews = [];
  let starIdx = 9;
  let titleIdx = 10;
  let textIdx = 11;
  let dateIdx = 5;
  let versionCodeIdx = 1;
  let deviceIdx = 4;
  let langIdx = 3;

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const cols = parseCsvLine(rawLine);
    if (cols[0] === "Package Name") {
      const find = (name) =>
        cols.findIndex((c) => c.trim().toLowerCase() === name.toLowerCase());
      starIdx = find("Star Rating");
      titleIdx = find("Review Title");
      textIdx = find("Review Text");
      dateIdx = find("Review Submit Date and Time");
      versionCodeIdx = find("App Version Code");
      deviceIdx = find("Device");
      langIdx = find("Reviewer Language");
      continue;
    }
    const stars = Number.parseInt(cols[starIdx] || "0", 10);
    if (!Number.isFinite(stars) || stars < 1) continue;
    const submittedAt = cols[dateIdx]?.trim() || null;
    reviews.push({
      stars,
      title: (cols[titleIdx] || "").trim(),
      text: (cols[textIdx] || "").trim(),
      submittedAt,
      appVersionCode: Number.parseInt(cols[versionCodeIdx] || "0", 10) || null,
      device: (cols[deviceIdx] || "").trim() || null,
      language: (cols[langIdx] || "").trim() || null,
    });
  }
  reviews.sort((a, b) =>
    String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""))
  );
  return reviews;
}

async function fetchMergedReviews(storage, bucket, packageName) {
  const prefix = `reviews/reviews_${packageName}_`;
  const res = await storage.objects.list({ bucket, prefix, maxResults: 50 });
  const objects = (res.data.items || [])
    .filter((o) => /\.csv$/i.test(o.name || ""))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const byKey = new Map();
  const sourceObjects = [];
  for (const obj of objects.slice(-3)) {
    const body = await downloadOverviewCsv(storage, bucket, obj.name);
    for (const row of parseReviewsCsv(body)) {
      const key = `${row.submittedAt}|${row.stars}|${row.text}|${row.title}`;
      byKey.set(key, row);
    }
    sourceObjects.push(`gs://${bucket}/${obj.name}`);
  }
  const rows = [...byKey.values()].sort((a, b) =>
    String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""))
  );
  return { rows, sourceObjects };
}

function summarizeReviews(reviews) {
  const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of reviews) {
    if (r.stars >= 1 && r.stars <= 5) {
      ratingCounts[r.stars] += 1;
      sum += r.stars;
    }
  }
  const total = reviews.length;
  return {
    totalReviews: total,
    averageRating: total ? Math.round((sum / total) * 10) / 10 : null,
    ratingCounts,
    recentReviews: reviews.slice(0, 10),
    lowStarReviews: reviews.filter((r) => r.stars <= 3).slice(0, 5),
  };
}

async function upsertMongoSummary(dailyRows, liveVersionCode, reviewsSummary) {
  if (!MONGO_URI) {
    return { skipped: true, reason: "Mongo URI not available" };
  }
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 12000 });
  await client.connect();
  try {
    const db = client.db();
    const now = new Date();
    const last14 = dailyRows.slice(-14);
    await db.collection("masters").updateOne(
      { name: "play-install-daily-summary" },
      {
        $set: {
          name: "play-install-daily-summary",
          metadata: last14,
          description: `Play daily user installs (last ${last14.length} days)`,
          updatedAt: now,
          liveVersionCode: liveVersionCode ?? null,
        },
      },
      { upsert: true }
    );
    if (reviewsSummary) {
      await db.collection("masters").updateOne(
        { name: "play-reviews-summary" },
        {
          $set: {
            name: "play-reviews-summary",
            metadata: reviewsSummary,
            description: `Play reviews (${reviewsSummary.totalReviews} total)`,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    }
    if (liveVersionCode != null) {
      await db.collection("masters").updateOne(
        { name: "play-live-version" },
        {
          $set: {
            name: "play-live-version",
            metadata: [Number(liveVersionCode)],
            description: `versionCode ${liveVersionCode}`,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    }
    return { skipped: false, days: last14.length };
  } finally {
    await client.close();
  }
}

async function fetchLiveVersionCode(auth) {
  const publisher = google.androidpublisher({ version: "v3", auth });
  const edit = await publisher.edits.insert({
    packageName: PACKAGE,
    requestBody: {},
  });
  const editId = edit.data.id;
  try {
    const track = await publisher.edits.tracks.get({
      packageName: PACKAGE,
      editId,
      track: "production",
    });
    const live = (track.data.releases || []).find(
      (r) => r.status === "completed" || r.status === "inProgress"
    );
    return live?.versionCodes?.[0] ? Number(live.versionCodes[0]) : null;
  } finally {
    await publisher.edits.delete({ packageName: PACKAGE, editId }).catch(() => {});
  }
}

async function listOverviewObjects(storage, bucket) {
  // Play GCS paths keep package dots: installs_com.app.plasty_pesa_YYYYMM_overview.csv
  const prefix = `stats/installs/installs_${PACKAGE}_`;
  const res = await storage.objects.list({
    bucket,
    prefix,
    maxResults: 200,
  });
  return (res.data.items || [])
    .filter((o) => /overview\.csv$/i.test(o.name || ""))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

async function fetchMergedDailyInstalls(storage, bucket) {
  const objects = await listOverviewObjects(storage, bucket);
  if (!objects.length) return { rows: [], sourceObjects: [] };

  const byDate = new Map();
  const sourceObjects = [];
  for (const obj of objects.slice(-3)) {
    const text = await downloadOverviewCsv(storage, bucket, obj.name);
    for (const row of parseOverviewCsv(text)) {
      byDate.set(row.date, row.dailyUserInstalls);
    }
    sourceObjects.push(`gs://${bucket}/${obj.name}`);
  }
  const rows = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dailyUserInstalls]) => ({ date, dailyUserInstalls }));
  return { rows, sourceObjects };
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    package: PACKAGE,
    bucket: BUCKET || null,
    liveVersionCode: null,
    dailyUserInstalls: [],
    reviews: null,
    mongo: null,
    manualChecklist: [],
  };

  if (!fs.existsSync(SA)) {
    throw new Error(`Play SA JSON not found: ${SA}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: SA,
    scopes: [
      "https://www.googleapis.com/auth/androidpublisher",
      "https://www.googleapis.com/auth/devstorage.read_only",
    ],
  });
  const client = await auth.getClient();
  report.liveVersionCode = await fetchLiveVersionCode(client);

  if (!BUCKET) {
    report.manualChecklist.push(
      "Copy .local/play-stats.env.example → .local/play-stats.env with your pubsite_prod_rev_* bucket"
    );
    report.manualChecklist.push(
      "Or run: .\\scripts\\plastypesa\\setup-play-install-stats.ps1 -Bucket pubsite_prod_rev_XXXXXXXXX"
    );
    report.manualChecklist.push(
      "Grant play-publisher@plastypesa-f5274.iam.gserviceaccount.com Storage Object Viewer on gs://<bucket>/ (or Play Console bulk-reports permission)"
    );
  } else {
    const storage = google.storage({ version: "v1", auth: client });
    try {
      const { rows, sourceObjects } = await fetchMergedDailyInstalls(storage, BUCKET);
      const reviewFetch = await fetchMergedReviews(storage, BUCKET, PACKAGE);
      if (!rows.length) {
        report.manualChecklist.push(
          `No overview CSV found under gs://${BUCKET}/stats/installs/ yet — Play exports lag ~24–48h`
        );
      } else {
        report.dailyUserInstalls = rows;
        report.sourceObjects = sourceObjects;
        report.sourceObject = sourceObjects[sourceObjects.length - 1];
        line(
          `Parsed ${rows.length} day(s) from ${sourceObjects.length} overview file(s); last14 sum=${rows.slice(-14).reduce((s, r) => s + r.dailyUserInstalls, 0)} installs`
        );
      }
      if (reviewFetch.rows.length) {
        report.reviews = summarizeReviews(reviewFetch.rows);
        report.reviewSourceObjects = reviewFetch.sourceObjects;
        line(
          `Parsed ${reviewFetch.rows.length} review(s); avg ${report.reviews.averageRating}★`
        );
      }
    } catch (e) {
      report.error = e.message;
      report.manualChecklist.push(
        "Grant play-publisher@plastypesa-f5274.iam.gserviceaccount.com roles/storage.objectViewer on the Play stats bucket"
      );
    }
  }

  report.mongo = await upsertMongoSummary(
    report.dailyUserInstalls,
    report.liveVersionCode,
    report.reviews
  );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  line(`Report: ${OUT}`);
  if (report.liveVersionCode) {
    line(`Live versionCode: ${report.liveVersionCode}`);
  }
  if (report.manualChecklist.length) {
    line("\nManual checklist:");
    for (const item of report.manualChecklist) line(`  [ ] ${item}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export { parseOverviewCsv, parseReviewsCsv, summarizeReviews };
