/**
 * P-CHURN-PROBE — measure-first silent / behind users (ops, no blast).
 *
 *   node scripts/plastypesa/churn-probe.mjs
 *   node scripts/plastypesa/churn-probe.mjs --pass 2
 *
 * Uses admin daily-check (build inventory + update outreach) + Mongo lastAppSeenAt.
 * Does NOT send FCM/WA. Push is SNS via users.deviceToken — "gone" proxy =
 * no recent lastAppSeenAt and/or no deviceToken.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

bootstrapPlastyPesaEnv();
const pass = process.argv.includes("--pass")
  ? process.argv[process.argv.indexOf("--pass") + 1]
  : "1";
const OUT_DIR = join(process.cwd(), ".neoxten", "proof");
mkdirSync(OUT_DIR, { recursive: true });
const OUT = join(OUT_DIR, `churn-probe-pass${pass}-${Date.now()}.json`);

const SILENT_DAYS = 14;
const RECENT_DAYS = 7;

async function adminDailyCheck() {
  const cfg = getConfig();
  const login = await fetch(url(cfg, "/auth/admin-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loadAdminDashboardCredentials()),
  });
  const lj = await login.json();
  const token = lj?.data?.token || lj?.token;
  if (!token) throw new Error(`admin login failed ${login.status}`);
  const r = await fetch(url(cfg, "/admin/ops/daily-check"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await r.json();
  const d = body?.data ?? body;
  if (!d?.generatedAt) throw new Error(`bad daily-check ${r.status}`);
  return d;
}

async function mongoSilentCohorts(liveFloor) {
  const uri = loadBackendMongoEnv();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  try {
    const users = client.db().collection("users");
    const now = Date.now();
    const silentCut = new Date(now - SILENT_DAYS * 864e5);
    const recentCut = new Date(now - RECENT_DAYS * 864e5);
    const base = {
      role: { $nin: ["admin", "ADMIN"] },
      status: "ACTIVE",
      country: { $in: ["KE", "Kenya", "kenya"] },
    };

    const silent = await users
      .find({
        ...base,
        $or: [
          { lastAppSeenAt: { $lt: silentCut } },
          { lastAppSeenAt: { $exists: false } },
          { lastAppSeenAt: null },
        ],
      })
      .project({
        email: 1,
        ecoHandle: 1,
        lastAppSeenAt: 1,
        lastAppVersionCode: 1,
        deviceToken: 1,
      })
      .limit(200)
      .toArray();

    const recentBehind = await users
      .find({
        ...base,
        lastAppSeenAt: { $gte: recentCut },
        lastAppVersionCode: { $lt: liveFloor, $exists: true, $ne: null },
      })
      .project({
        email: 1,
        ecoHandle: 1,
        lastAppSeenAt: 1,
        lastAppVersionCode: 1,
      })
      .sort({ lastAppSeenAt: -1 })
      .limit(50)
      .toArray();

    const withToken = silent.filter(
      (u) => typeof u.deviceToken === "string" && u.deviceToken.trim()
    ).length;
    const noToken = silent.length - withToken;

    return {
      silent14dCount: silent.length,
      silentWithToken: withToken,
      silentNoToken: noToken,
      recentBehindCount: recentBehind.length,
      recentBehindSample: recentBehind.slice(0, 15).map((u) => ({
        eco: u.ecoHandle,
        email: u.email,
        build: u.lastAppVersionCode,
        lastSeen: u.lastAppSeenAt,
      })),
      silentSample: silent.slice(0, 10).map((u) => ({
        eco: u.ecoHandle,
        email: u.email,
        build: u.lastAppVersionCode,
        lastSeen: u.lastAppSeenAt,
        hasToken: !!(u.deviceToken && String(u.deviceToken).trim()),
      })),
    };
  } finally {
    await client.close();
  }
}

async function main() {
  const d = await adminDailyCheck();
  const inv =
    d.appBuildInventory || d.playStore?.appBuildInventory || {};
  const live = Number(
    inv.liveVersionCode || d.playStore?.liveVersionCode || 59
  );
  const outreach =
    d.trustAndUpdates?.updateOutreach?.behindLiveBuild || [];
  const salvageableGuess = outreach.filter(
    (u) =>
      Number(u.weeklyPoints || 0) > 0 &&
      Number(u.lastAppVersionCode) >= live - 3
  );

  let mongo = { error: null };
  try {
    mongo = await mongoSilentCohorts(live);
  } catch (e) {
    mongo = { error: String(e.message || e) };
  }

  const report = {
    pass,
    generatedAt: new Date().toISOString(),
    dailyCheckAt: d.generatedAt,
    liveVersionCode: live,
    inventory: {
      onLive: inv.onLive,
      behindLive: inv.behindLive,
      unknownBuild: inv.unknownBuild,
      withLastSeen: inv.withLastSeen,
    },
    behindOutreachNamed: outreach.length,
    behindTopEarners: outreach.slice(0, 10),
    salvageableGuessCount: salvageableGuess.length,
    salvageableGuess: salvageableGuess.slice(0, 10),
    mongo,
    ownerNext: {
      note: "No WA/FCM blast from this script. Pick: warm Eco-Handle nudge to salvageableGuess OR ignore.",
      expect: "Salvageable usually single digits at current scale.",
    },
  };

  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("══ P-CHURN-PROBE ══");
  console.log(
    `live=${live} onLive/behind/unknown=${inv.onLive}/${inv.behindLive}/${inv.unknownBuild}`
  );
  console.log(
    `behind outreach named=${outreach.length} salvageableGuess=${salvageableGuess.length}`
  );
  if (mongo.error) console.log(`mongo: SKIP/FAIL — ${mongo.error}`);
  else {
    console.log(
      `silent≥${SILENT_DAYS}d=${mongo.silent14dCount} (token ${mongo.silentWithToken} / none ${mongo.silentNoToken}) recentBehind=${mongo.recentBehindCount}`
    );
  }
  console.log("Top behind earners (from Daily Check):");
  for (const u of outreach.slice(0, 8)) {
    console.log(
      `  ${u.eco} build=${u.lastAppVersionCode} weekly=${u.weeklyPoints}`
    );
  }
  console.log("Report:", OUT);
  if (
    typeof salvageableGuess.length === "number" &&
    salvageableGuess.length > 40
  ) {
    throw new Error("unexpected huge salvageableGuess — check data");
  }
  if (inv.onLive == null && inv.behindLive == null) {
    throw new Error("daily-check missing appBuildInventory counts");
  }
  console.log(`OK churn-probe pass=${pass}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
