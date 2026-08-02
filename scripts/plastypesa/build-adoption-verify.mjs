/**
 * P-BUILD-ADOPTION-VERIFY — prove force-update wall vs Daily Check "behind".
 *
 *   node scripts/plastypesa/build-adoption-verify.mjs
 *   node scripts/plastypesa/build-adoption-verify.mjs --pass 2
 *
 * Flags behind users who still have high weekly points (possible gate hole vs
 * inventory lag). Does NOT disarm the gate. No AAB.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
const OUT = join(OUT_DIR, `build-adoption-pass${pass}-${Date.now()}.json`);

async function mongoBehindRecent(live) {
  const uri = loadBackendMongoEnv();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  await client.connect();
  try {
    const users = client.db().collection("users");
    const since24h = new Date(Date.now() - 864e5);
    const base = {
      role: { $nin: ["admin", "ADMIN"] },
      status: "ACTIVE",
      country: { $in: ["KE", "Kenya", "kenya"] },
      lastAppVersionCode: { $lt: live, $exists: true, $ne: null },
    };
    const seen24h = await users
      .find({ ...base, lastAppSeenAt: { $gte: since24h } })
      .project({
        ecoHandle: 1,
        email: 1,
        lastAppVersionCode: 1,
        lastAppSeenAt: 1,
      })
      .sort({ lastAppSeenAt: -1 })
      .limit(25)
      .toArray();
    return {
      behindSeenLast24h: seen24h.length,
      sample: seen24h.slice(0, 12).map((u) => ({
        eco: u.ecoHandle,
        build: u.lastAppVersionCode,
        lastSeen: u.lastAppSeenAt,
      })),
    };
  } finally {
    await client.close();
  }
}

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

function releaseGateStatus() {
  const r = spawnSync(
    process.execPath,
    [join("scripts", "plastypesa", "release-gate.mjs"), "status"],
    { encoding: "utf8", cwd: process.cwd() }
  );
  return {
    exit: r.status,
    stdout: (r.stdout || "").slice(0, 4000),
    stderr: (r.stderr || "").slice(0, 1000),
  };
}

async function main() {
  const d = await adminDailyCheck();
  const inv = d.appBuildInventory || d.playStore?.appBuildInventory || {};
  const live = Number(
    inv.liveVersionCode || d.playStore?.liveVersionCode || 59
  );
  const behind = d.trustAndUpdates?.updateOutreach?.behindLiveBuild || [];
  const stillScoring = behind.filter((u) => Number(u.weeklyPoints || 0) >= 1000);
  const topStillScoring = stillScoring
    .slice()
    .sort((a, b) => Number(b.weeklyPoints) - Number(a.weeklyPoints))
    .slice(0, 15);

  const gate = releaseGateStatus();
  let mongo = { error: null };
  try {
    mongo = await mongoBehindRecent(live);
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
    },
    behindNamed: behind.length,
    behindWithWeeklyPtsGte1000: stillScoring.length,
    topBehindStillScoring: topStillScoring,
    mongoBehindRecent: mongo,
    interpretation: {
      inventoryLag:
        "Behind + high weeklyPoints often = points earned earlier this week before wall, or lastAppVersionCode lag.",
      gateHoleSuspect:
        mongo.behindSeenLast24h > 0
          ? `${mongo.behindSeenLast24h} behind users stamped lastAppSeenAt in last 24h — they reached an API path that stamps presence; confirm force-update middleware still 426s earn routes. Do NOT disarm.`
          : stillScoring.length > 0
            ? "High weeklyPoints on behind list but no 24h lastSeen — likely pre-wall earn / not opened since arm."
            : "No high-point behind users in outreach list.",
      noAabLevers: [
        "SES/email",
        "FCM soft banner (owner GO)",
        "WA Eco Handle one-by-one",
      ],
      gateArmedExpected: true,
    },
    releaseGateStatus: gate,
  };

  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("══ P-BUILD-ADOPTION-VERIFY ══");
  console.log(
    `live=${live} on/behind/unknown=${inv.onLive}/${inv.behindLive}/${inv.unknownBuild}`
  );
  console.log(
    `behind named=${behind.length} with weekly≥1000=${stillScoring.length}`
  );
  for (const u of topStillScoring.slice(0, 8)) {
    console.log(
      `  ${u.eco} build=${u.lastAppVersionCode} weekly=${u.weeklyPoints}`
    );
  }
  if (mongo.error) console.log(`mongo 24h behind: SKIP — ${mongo.error}`);
  else
    console.log(
      `behind seen last 24h=${mongo.behindSeenLast24h} (presence stamp on old build)`
    );
  console.log(`release-gate status exit=${gate.exit}`);
  console.log("Report:", OUT);
  if (
    gate.exit !== 0 &&
    !/disarmed|FORCE|minVersion|floor/i.test(gate.stdout + gate.stderr)
  ) {
    console.warn("WARN release-gate status non-zero — read stdout in report");
  }
  if (!/GATE IS ARMED|floor\s*:\s*59|android floor/i.test(gate.stdout)) {
    throw new Error("expected armed gate floor 59 in release-gate status");
  }
  console.log(`OK build-adoption-verify pass=${pass}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
