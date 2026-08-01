#!/usr/bin/env node
/** Play install / version evidence for integrity checks (aggregate + release timeline). */
import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SA =
  process.env.PLASTYPESA_PLAY_SA_JSON ||
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/ALL CREDENTIALS FOR PLASTYPESA 15-03-2026/Play Console API - created 16-07-2026/play-publisher-plastypesa-f5274-16-07-2026.json";
const PKG = "com.app.plasty_pesa";

function daysAgo(n) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: SA,
    scopes: [
      "https://www.googleapis.com/auth/androidpublisher",
      "https://www.googleapis.com/auth/playdeveloperreporting",
    ],
  });
  const client = await auth.getClient();
  const reporting = google.playdeveloperreporting({ version: "v1beta1", auth: client });
  const publisher = google.androidpublisher({ version: "v3", auth: client });

  const end = daysAgo(1);
  const start = daysAgo(14);

  // Production track history (when v56 went live)
  const edit = await publisher.edits.insert({ packageName: PKG, requestBody: {} });
  const editId = edit.data.id;
  try {
    const track = await publisher.edits.tracks.get({
      packageName: PKG,
      editId,
      track: "production",
    });
    console.log(
      "PRODUCTION_RELEASES",
      JSON.stringify(
        (track.data.releases || []).map((r) => ({
          name: r.name,
          status: r.status,
          versionCodes: r.versionCodes,
          releaseNotes: r.releaseNotes?.slice(0, 1),
        })),
        null,
        2
      )
    );
  } finally {
    await publisher.edits.delete({ packageName: PKG, editId }).catch(() => {});
  }

  // v56 distinct users (cold start) — proves Play users on that build exist
  try {
    const res = await reporting.vitals.slowstartrate.query({
      name: `apps/${PKG}/slowStartRateMetricSet`,
      requestBody: {
        timelineSpec: { aggregationPeriod: "DAILY", startTime: start, endTime: end },
        metrics: ["distinctUsers"],
        dimensions: ["startType", "versionCode"],
        filter: 'versionCode = "56" AND startType = "COLD"',
      },
    });
    const byDay = {};
    for (const r of res.data.rows || []) {
      const day = `${r.startTime?.year}-${String(r.startTime?.month).padStart(2, "0")}-${String(r.startTime?.day).padStart(2, "0")}`;
      const du = Number(
        r.metrics?.find((m) => m.metric === "distinctUsers")?.decimalValue?.value || 0
      );
      byDay[day] = (byDay[day] || 0) + du;
    }
    console.log("V56_COLD_DISTINCT_USERS_BY_DAY", byDay);
  } catch (e) {
    console.log("slowstart err:", e.message?.split("\n")[0]);
  }

  // Kenya + version 56 crash vitals distinct users (if any)
  for (const [api, set, metrics] of [
    ["crashrate", "crashRateMetricSet", ["distinctUsers", "crashRate"]],
    ["anrrate", "anrRateMetricSet", ["distinctUsers", "anrRate"]],
  ]) {
    try {
      const res = await reporting.vitals[api].query({
        name: `apps/${PKG}/${set}`,
        requestBody: {
          timelineSpec: { aggregationPeriod: "DAILY", startTime: start, endTime: end },
          metrics,
          dimensions: ["versionCode", "countryCode"],
          filter: 'countryCode = "KE" AND versionCode = "56"',
        },
      });
      console.log(
        `${api.toUpperCase()}_KE_V56`,
        (res.data.rows || []).length,
        "rows"
      );
      const du = (res.data.rows || []).reduce((a, r) => {
        return (
          a +
          Number(
            r.metrics?.find((m) => m.metric === "distinctUsers")?.decimalValue
              ?.value || 0
          )
        );
      }, 0);
      console.log(`${api.toUpperCase()}_KE_V56_DISTINCT_USERS_SUM`, du);
    } catch (e) {
      console.log(`${api} err:`, e.message?.split("\n")[0]);
    }
  }

  try {
    const rel = await reporting.apps.fetchReleaseFilterOptions({
      name: `apps/${PKG}`,
    });
    console.log(
      "RELEASE_FILTER_OPTIONS",
      JSON.stringify(rel.data, null, 2).slice(0, 1500)
    );
  } catch (e) {
    console.log("releases err:", e.message?.split("\n")[0]);
  }

  const out = path.join(__dirname, "../../.neoxten/plastypesa-play-install-context.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note:
          "Play API cannot map installs to Mongo user IDs. Use aggregate v56 distinctUsers + android FCM on user rows.",
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
