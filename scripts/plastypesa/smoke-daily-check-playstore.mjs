#!/usr/bin/env node
/**
 * Live smoke: GET /api/admin/ops/daily-check includes playStore + app build fields.
 */
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();

async function adminLogin() {
  const credentials = loadAdminDashboardCredentials();
  const response = await fetch(url(cfg, "/auth/admin-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`admin login failed: ${response.status}`);
  }
  const token = body?.data?.token || body?.token;
  if (!token) throw new Error("admin login missing token");
  return { Authorization: `Bearer ${token}` };
}

async function main() {
  const headers = await adminLogin();
  const response = await fetch(url(cfg, "/admin/ops/daily-check"), { headers });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`daily-check failed: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  const data = body?.data ?? body;
  const playStore = data?.playStore;
  const row = data?.integrity?.leaderboardTop10?.[0];
  const requiredKeys = [
    "liveVersionCode",
    "top10WithReportedBuild",
    "top10UnknownBuild",
    "top10BehindLiveBuild",
  ];
  for (const key of requiredKeys) {
    if (!(key in (playStore || {}))) {
      throw new Error(`playStore.${key} missing`);
    }
  }
  const phaseKeys = [
    ["trustAndUpdates", "genuineInstalls"],
    ["trustAndUpdates", "sortQueueCockpit"],
    ["motivationSegments", "counters"],
    ["contentEngagement", "rates"],
    ["alwaysOnOps", "dailyQuiz"],
  ];
  for (const path of phaseKeys) {
    let node = data;
    for (const p of path) {
      node = node?.[p];
    }
    if (node == null || typeof node !== "object") {
      throw new Error(`${path.join(".")} missing`);
    }
  }
  const rowKeys = ["lastAppVersionCode", "lastInstallSource", "lastAppPlatform"];
  for (const key of rowKeys) {
    if (!(key in (row || {}))) {
      throw new Error(`leaderboard[0].${key} missing`);
    }
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        liveVersionCode: playStore.liveVersionCode,
        top10WithReportedBuild: playStore.top10WithReportedBuild,
        top10UnknownBuild: playStore.top10UnknownBuild,
        top10BehindLiveBuild: playStore.top10BehindLiveBuild?.length ?? 0,
        trustInstalls7d: data.trustAndUpdates?.genuineInstalls?.playInstalls7d,
        motivationCounters: data.motivationSegments?.counters,
        contentActiveKenya7d: data.contentEngagement?.kenyaActiveUsers7d,
        dailyQuizLive: data.alwaysOnOps?.dailyQuiz?.live,
        actionItems: data.actionItems?.length ?? 0,
        sampleRow: row
          ? {
              eco: row.eco,
              lastAppVersionCode: row.lastAppVersionCode,
              lastInstallSource: row.lastInstallSource,
            }
          : null,
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
