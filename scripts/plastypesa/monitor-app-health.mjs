/**
 * PlastyPesa app health monitor for Cursor agents + owner.
 *
 * Layers:
 *  1) Play Android Publisher — production track / live versionCodes
 *  2) Play Developer Reporting — crash + ANR vitals (needs Reporting API + console permission)
 *  3) Product KPIs — optional Mongo (PLASTYPESA_MONGO_URI) or skip cleanly
 *
 * Usage (NeoXten root):
 *   npm run monitor:plastypesa
 *
 * Env (optional overrides):
 *   PLASTYPESA_PLAY_SA_JSON  — path to Play service-account JSON
 *   PLASTYPESA_PACKAGE_NAME  — default com.app.plasty_pesa
 *   PLASTYPESA_MONGO_URI     — optional product KPIs
 *   PLASTYPESA_MONITOR_OUT   — write JSON report path
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = path.resolve(__dirname, "../..");

const PACKAGE =
  process.env.PLASTYPESA_PACKAGE_NAME || "com.app.plasty_pesa";

const DEFAULT_SA = path.join(
  "C:",
  "Users",
  "Bobby",
  "Documents",
  "plastypesa-admin-dashboard",
  "ALL CREDENTIALS FOR PLASTYPESA 15-03-2026",
  "Play Console API - created 16-07-2026",
  "play-publisher-plastypesa-f5274-16-07-2026.json"
);

const SA_PATH = process.env.PLASTYPESA_PLAY_SA_JSON || DEFAULT_SA;

const OUT_PATH =
  process.env.PLASTYPESA_MONITOR_OUT ||
  path.join(NEOXTEN_ROOT, ".neoxten", "plastypesa-monitor-latest.json");

const SCOPES = [
  "https://www.googleapis.com/auth/androidpublisher",
  "https://www.googleapis.com/auth/playdeveloperreporting",
];

function line(s = "") {
  console.log(s);
}

function section(title) {
  line();
  line(`══ ${title} ══`);
}

function ok(msg) {
  line(`  ✓ ${msg}`);
}

function warn(msg) {
  line(`  ⚠ ${msg}`);
}

function bad(msg) {
  line(`  ✗ ${msg}`);
}

function info(msg) {
  line(`  · ${msg}`);
}

async function getAuth() {
  if (!fs.existsSync(SA_PATH)) {
    throw new Error(
      `Play service-account JSON not found: ${SA_PATH}\nSet PLASTYPESA_PLAY_SA_JSON`
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: SA_PATH,
    scopes: SCOPES,
  });
  return auth.getClient();
}

async function readProductionTrack(auth) {
  const androidpublisher = google.androidpublisher({
    version: "v3",
    auth,
  });
  const edit = await androidpublisher.edits.insert({
    packageName: PACKAGE,
    requestBody: {},
  });
  const editId = edit.data.id;
  try {
    const track = await androidpublisher.edits.tracks.get({
      packageName: PACKAGE,
      editId,
      track: "production",
    });
    return track.data;
  } finally {
    try {
      await androidpublisher.edits.delete({ packageName: PACKAGE, editId });
    } catch {
      /* ignore */
    }
  }
}

function summarizeTrack(track) {
  const releases = track?.releases || [];
  const completed = releases.filter((r) => r.status === "completed");
  const drafts = releases.filter((r) => r.status === "draft");
  const inProgress = releases.filter((r) => r.status === "inProgress");
  const live = completed[0] || inProgress[0] || null;
  const versionCodes = (live?.versionCodes || []).map(String);
  return { releases, completed, drafts, inProgress, live, versionCodes };
}

function calendarDaysAgoUtc(daysAgo) {
  // Play vitals daily freshness is typically through "yesterday" (America/Los_Angeles).
  // Never ask for "today" — Reporting API rejects end_date beyond freshness.
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

async function queryVitals(auth, metricSet, metrics) {
  // playdeveloperreporting is under google.playdeveloperreporting
  const reporting = google.playdeveloperreporting({
    version: "v1beta1",
    auth,
  });
  const name = `apps/${PACKAGE}/${metricSet}`;
  // End = yesterday; start = 7 days before that end.
  const endTime = calendarDaysAgoUtc(1);
  const startTime = calendarDaysAgoUtc(8);
  const body = {
    timelineSpec: {
      aggregationPeriod: "DAILY",
      startTime,
      endTime,
    },
    metrics,
  };

  if (metricSet === "crashRateMetricSet") {
    const res = await reporting.vitals.crashrate.query({ name, requestBody: body });
    return res.data;
  }
  if (metricSet === "anrRateMetricSet") {
    const res = await reporting.vitals.anrrate.query({ name, requestBody: body });
    return res.data;
  }
  throw new Error(`Unknown metric set ${metricSet}`);
}

function pickLatestRow(data) {
  const rows = data?.rows || [];
  if (!rows.length) return null;
  return rows[rows.length - 1];
}

function metricValue(row, key) {
  const m = (row?.metrics || []).find((x) => x.metric === key);
  const d = m?.decimalValue?.value ?? m?.decimalValue;
  if (d == null) return null;
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
}

async function productKpis() {
  const uri = process.env.PLASTYPESA_MONGO_URI;
  if (!uri) {
    return {
      skipped: true,
      reason:
        "PLASTYPESA_MONGO_URI not set — product KPIs skipped (Play vitals still run)",
    };
  }
  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const db = client.db();
    const users = db.collection("users");
    const sorts = db.collection("sort_proofs");
    const claims = db.collection("reward_claims");

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const kenyaFilter = {
      $or: [
        { countryCode: "KE" },
        { country: "KE" },
        { "market.marketCode": "KE" },
        { marketCode: "KE" },
      ],
    };

    const [
      kenyaUsers,
      kenyaUsers7d,
      sorts7d,
      claimsOpen,
      claimsPaid,
    ] = await Promise.all([
      users.countDocuments(kenyaFilter).catch(() => null),
      users
        .countDocuments({
          ...kenyaFilter,
          createdAt: { $gte: since7d },
        })
        .catch(() => null),
      sorts
        .countDocuments({ createdAt: { $gte: since7d } })
        .catch(() =>
          sorts.countDocuments({ submittedAt: { $gte: since7d } }).catch(() => null)
        ),
      claims
        .countDocuments({
          status: { $in: ["PROVISIONAL", "SUBMITTED", "VERIFIED"] },
        })
        .catch(() => null),
      claims.countDocuments({ status: "PAID" }).catch(() => null),
    ]);

    await client.close();
    return {
      skipped: false,
      kenyaUsers,
      kenyaUsersCreated7d: kenyaUsers7d,
      sortProofsApprox7d: sorts7d,
      claimsOpenish: claimsOpen,
      claimsPaid,
    };
  } catch (e) {
    return { skipped: true, reason: `Mongo error: ${e.message}` };
  }
}

function crashlyticsHint() {
  return {
    note: "Firebase Crashlytics is already in the Flutter app. Agents: open Firebase Console → Crashlytics for stack traces. Optional later: add a Firebase service-account read into this script.",
    consoleHint:
      "https://console.firebase.google.com/ → project → Crashlytics → filter version 1.0.21 / 32",
  };
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    package: PACKAGE,
    play: {},
    vitals: {},
    product: {},
    crashlytics: crashlyticsHint(),
    manualChecklist: [],
    exitHints: [],
  };

  line("PlastyPesa app health monitor");
  line(`Package: ${PACKAGE}`);
  line(`SA: ${SA_PATH}`);
  line(`Time: ${report.generatedAt}`);

  let auth;
  try {
    auth = await getAuth();
    ok("Play service account loaded");
  } catch (e) {
    bad(e.message);
    report.exitHints.push("Fix PLASTYPESA_PLAY_SA_JSON path");
    writeReport(report);
    process.exitCode = 2;
    return;
  }

  // --- Production track ---
  section("Play production track");
  try {
    const track = await readProductionTrack(auth);
    const sum = summarizeTrack(track);
    report.play = {
      liveStatus: sum.live?.status || null,
      liveName: sum.live?.name || null,
      versionCodes: sum.versionCodes,
      draftCount: sum.drafts.length,
      releaseCount: sum.releases.length,
    };
    if (sum.versionCodes.length) {
      ok(
        `Live/active release: ${sum.live?.name || "(unnamed)"} · status=${sum.live?.status} · versionCode(s)=${sum.versionCodes.join(",")}`
      );
    } else {
      warn("No versionCodes on completed/inProgress production release");
    }
    if (sum.drafts.length) {
      warn(
        `${sum.drafts.length} draft release(s) still on production track (clean up in Console if empty)`
      );
    }
  } catch (e) {
    bad(`Publisher API failed: ${e.message}`);
    report.play.error = e.message;
    report.manualChecklist.push(
      "Confirm service account is invited in Play Console with Release access"
    );
    report.exitHints.push("Play Publisher API access");
  }

  // --- Vitals ---
  section("Android vitals (Play Developer Reporting API)");
  try {
    const crash = await queryVitals(auth, "crashRateMetricSet", [
      "crashRate",
      "userPerceivedCrashRate",
      "distinctUsers",
    ]);
    const anr = await queryVitals(auth, "anrRateMetricSet", [
      "anrRate",
      "userPerceivedAnrRate",
      "distinctUsers",
    ]);
    const crashRow = pickLatestRow(crash);
    const anrRow = pickLatestRow(anr);
    report.vitals = {
      crashRate: metricValue(crashRow, "crashRate"),
      userPerceivedCrashRate: metricValue(crashRow, "userPerceivedCrashRate"),
      anrRate: metricValue(anrRow, "anrRate"),
      userPerceivedAnrRate: metricValue(anrRow, "userPerceivedAnrRate"),
      distinctUsersCrash: metricValue(crashRow, "distinctUsers"),
      distinctUsersAnr: metricValue(anrRow, "distinctUsers"),
      rowsCrash: (crash?.rows || []).length,
      rowsAnr: (anr?.rows || []).length,
    };

    if (!report.vitals.rowsCrash && !report.vitals.rowsAnr) {
      warn(
        "Reporting API OK but no vitals rows yet (normal with very low installs / new release)"
      );
    } else {
      ok(
        `Crash rate (latest day): ${fmtPct(report.vitals.crashRate)} · user-perceived ${fmtPct(report.vitals.userPerceivedCrashRate)}`
      );
      ok(
        `ANR rate (latest day): ${fmtPct(report.vitals.anrRate)} · user-perceived ${fmtPct(report.vitals.userPerceivedAnrRate)}`
      );
      info(
        `Distinct users (crash norm): ${report.vitals.distinctUsersCrash ?? "n/a"}`
      );
    }
  } catch (e) {
    const msg = e.message || String(e);
    bad(`Reporting API failed: ${msg}`);
    report.vitals.error = msg;
    if (/has not been used|is disabled|Enable it by visiting/i.test(msg)) {
      report.manualChecklist.push(
        "Enable Google Play Developer Reporting API on GCP project plastypesa-f5274"
      );
    }
    if (/PERMISSION|permission|403|ACCESS|not authorized|forbidden/i.test(msg)) {
      report.manualChecklist.push(
        "Play Console → Users and permissions → play-publisher@… → grant View app information / Android vitals (or Admin)"
      );
    }
    if (/freshness|end_date|timeline/i.test(msg)) {
      report.manualChecklist.push(
        "Vitals date range issue — re-run after agent fixes monitor script (or wait for Play data freshness)"
      );
    }
    if (!report.manualChecklist.length) {
      report.manualChecklist.push(
        "Play Console → Users and permissions → play-publisher@… → grant View app information / Android vitals (or Admin)"
      );
    }
    report.exitHints.push("Play Reporting API / vitals");
  }

  // --- Product ---
  section("Product KPIs (Mongo optional)");
  report.product = await productKpis();
  if (report.product.skipped) {
    warn(report.product.reason);
    report.manualChecklist.push(
      "Optional: set PLASTYPESA_MONGO_URI for Kenya user / sort / claim counts in this monitor"
    );
  } else {
    ok(`Kenya users (approx filter): ${report.product.kenyaUsers}`);
    ok(`Kenya users created 7d: ${report.product.kenyaUsersCreated7d}`);
    ok(`Sort proofs ~7d: ${report.product.sortProofsApprox7d}`);
    ok(
      `Claims openish: ${report.product.claimsOpenish} · paid: ${report.product.claimsPaid}`
    );
  }

  // --- Crashlytics pointer ---
  section("Crashlytics (Firebase — already in app)");
  info(report.crashlytics.note);
  info(report.crashlytics.consoleHint);

  // --- Agent verdict ---
  section("Agent verdict");
  const blockers = report.exitHints.length;
  if (blockers === 0 && report.play.versionCodes?.length) {
    ok(
      `Production serving versionCode ${report.play.versionCodes.join(",")}. Run this before declaring a release healthy.`
    );
  } else if (blockers) {
    warn(`Incomplete monitor (${blockers} access gap(s)) — see manual checklist`);
  }

  if (report.manualChecklist.length) {
    section("Owner manual checklist (remaining)");
    for (const item of report.manualChecklist) {
      line(`  [ ] ${item}`);
    }
  }

  writeReport(report);
  ok(`Report written: ${OUT_PATH}`);
  line();
}

function fmtPct(v) {
  if (v == null) return "n/a";
  // API returns fraction 0–1 or already percent depending on set — show both-friendly
  if (v <= 1) return `${(v * 100).toFixed(3)}%`;
  return `${Number(v).toFixed(3)}%`;
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), "utf8");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
