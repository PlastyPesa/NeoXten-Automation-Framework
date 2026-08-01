#!/usr/bin/env node
/**
 * PlastyPesa daily ops digest — one command for owner + agents in chat.
 *
 * Usage (NeoXten root):
 *   npm run digest:plastypesa
 *
 * Writes JSON: .neoxten/plastypesa-daily-digest-latest.json
 * For Play vitals + versionCode also run: npm run monitor:plastypesa
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { loadBackendMongoEnv } from "./mongo-env.mjs";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";
import {
  buildIntegrityDigest,
  buildIntegrityActionItems,
} from "./plastypesa-integrity-digest.mjs";

const CREDENTIALS_MD =
  process.env.PLASTYPESA_TEST_CREDENTIALS_MD ||
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = path.resolve(__dirname, "../..");
const API =
  process.env.PLASTYPESA_API_BASE ||
  "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";
const OUT_PATH =
  process.env.PLASTYPESA_DIGEST_OUT ||
  path.join(NEOXTEN_ROOT, ".neoxten", "plastypesa-daily-digest-latest.json");

bootstrapPlastyPesaEnv();

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
function info(msg) {
  line(`  · ${msg}`);
}

const USER_BASE = {
  staffDisabled: { $ne: true },
  role: { $nin: ["admin"] },
};
const KENYA_FILTER = {
  $or: [
    { countryCode: "KE" },
    { country: "Kenya" },
    { marketRegion: "kenya" },
    { country: "KE" },
  ],
};

async function adminFetch(path, token, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path}: non-JSON (${res.status})`);
  }
  if (!res.ok || body.type === "Error" || body.type === "error") {
    throw new Error(`${path}: HTTP ${res.status} — ${body.message || "failed"}`);
  }
  return body;
}

async function getAdminToken() {
  let email;
  let password;
  if (fs.existsSync(CREDENTIALS_MD)) {
    const md = fs.readFileSync(CREDENTIALS_MD, "utf8");
    const adminBlock = md.split("## Production mobile app")[0];
    email = adminBlock.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
    password = adminBlock.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();
  }
  if (!email || !password) {
    email = process.env.PLASTYPESA_ADMIN_EMAIL;
    password = process.env.PLASTYPESA_ADMIN_PASSWORD;
  }
  if (!email || !password) {
    try {
      const admin = loadAdminDashboardCredentials();
      email ||= admin.email;
      password ||= admin.password;
    } catch {
      /* ignore */
    }
  }
  if (!email || !password) throw new Error("Admin credentials unavailable");
  const login = await fetch(`${API}/auth/admin-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await login.json();
  const token = body?.data?.token || body?.token;
  if (!token) throw new Error("Admin login failed — no token");
  return token;
}

function readMasterAmount(doc) {
  if (!doc?.metadata) return null;
  const m = doc.metadata;
  if (Array.isArray(m)) return m[0];
  if (typeof m === "number" || typeof m === "string") return m;
  return null;
}

async function mongoDigest() {
  const uri = loadBackendMongoEnv();
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 12000 });
  await client.connect();
  const db = client.db();
  const users = db.collection("users");
  const now = Date.now();
  const d1 = new Date(now - 86400000);
  const d7 = new Date(now - 7 * 86400000);

  const mastersCol =
    (await db.collection("masters").findOne({ name: "referral-points" }))
      ? "masters"
      : "master";

  const gameCol = (await db.collection("games").findOne({ status: "ACTIVE", dailyQuiz: true }))
    ? "games"
    : "game";

  const [
    totalUsers,
    kenyaUsers,
    new24h,
    new7d,
    sortPending,
    sortFlagged,
    sortAudit,
    posts7d,
    flaggedPosts,
    openDisputes,
    referrals7d,
    masters,
    pinnedBanner,
    activeQuiz,
  ] = await Promise.all([
    users.countDocuments(USER_BASE),
    users.countDocuments({ ...USER_BASE, ...KENYA_FILTER }),
    users.countDocuments({ ...USER_BASE, createdAt: { $gte: d1 } }),
    users.countDocuments({ ...USER_BASE, createdAt: { $gte: d7 } }),
    db.collection("sort_proof_images").countDocuments({ status: "PENDING_REVIEW" }).catch(() => null),
    db.collection("sort_proof_images").countDocuments({ status: "FLAGGED" }).catch(() => null),
    db.collection("sort_proof_images").countDocuments({ status: "AUDIT" }).catch(() => null),
    db.collection("community_posts").countDocuments({ createdAt: { $gte: d7 } }).catch(() => null),
    db.collection("community_posts").countDocuments({ status: "flagged" }).catch(() => null),
    db
      .collection("reward_disputes")
      .countDocuments({ status: { $in: ["OPEN", "SUBMITTED", "UNDER_REVIEW"] } })
      .catch(() => null),
    db
      .collection("users")
      .countDocuments({
        ...USER_BASE,
        referredBy: { $exists: true, $ne: null, $ne: "" },
        createdAt: { $gte: d7 },
      })
      .catch(() => null),
    db
      .collection(mastersCol)
      .find({
        name: {
          $in: [
            "referral-points-boost",
            "referral-boost-ends-at",
            "referral-points",
            "signup-bonus-points",
          ],
        },
      })
      .toArray(),
    db.collection("active_in_app_banners").findOne({ key: "singleton" }).catch(() => null),
    db
      .collection(gameCol)
      .findOne(
        { status: "ACTIVE", gameType: "QUIZ", dailyQuiz: true },
        { sort: { createdAt: -1 } },
      )
      .catch(() => null),
  ]);

  const masterMap = Object.fromEntries(
    (masters || []).map((m) => [m.name, readMasterAmount(m)]),
  );
  const boostEndsRaw = masterMap["referral-boost-ends-at"];
  const boostEndsAt = boostEndsRaw ? new Date(boostEndsRaw) : null;
  const boostActive =
    boostEndsAt && !Number.isNaN(boostEndsAt.getTime())
      ? boostEndsAt.getTime() > Date.now()
      : null;

  const recentKenya = await users
    .find({ ...USER_BASE, ...KENYA_FILTER, createdAt: { $gte: d7 } })
    .sort({ createdAt: -1 })
    .limit(8)
    .project({ ecoHandle: 1, createdAt: 1 })
    .toArray();

  let integrity = null;
  try {
    integrity = await buildIntegrityDigest(db);
  } catch (e) {
    integrity = { error: e.message };
  }

  await client.close();

  return {
    users: { totalUsers, kenyaUsers, new24h, new7d, referrals7d },
    sortQueue: {
      pending: sortPending,
      flagged: sortFlagged,
      audit: sortAudit,
      openTotal: (sortPending || 0) + (sortFlagged || 0) + (sortAudit || 0),
    },
    community: { posts7d, flaggedPosts },
    disputes: { open: openDisputes },
    referralBoost: {
      pointsBoost: masterMap["referral-points-boost"],
      standardReferral: masterMap["referral-points"],
      signupBonus: masterMap["signup-bonus-points"],
      endsAt: boostEndsAt?.toISOString?.() || boostEndsRaw || null,
      active: boostActive,
    },
    pinnedBanner: pinnedBanner
      ? {
          bannerId: pinnedBanner.inAppBanner?.bannerId || pinnedBanner.bannerId,
          title: pinnedBanner.title,
          active: pinnedBanner.active !== false,
        }
      : null,
    dailyQuiz: activeQuiz
      ? {
          gameId: String(activeQuiz._id),
          title: activeQuiz.title || activeQuiz.name,
          dailyQuiz: !!activeQuiz.dailyQuiz,
        }
      : null,
    recentKenyaSignups7d: recentKenya.map((u) => ({
      eco: u.ecoHandle,
      at: u.createdAt,
    })),
    integrity,
  };
}

function buildActionItems(digest, adminAlerts) {
  const items = [];
  const q = digest.sortQueue?.openTotal ?? 0;
  if (q > 0) items.push(`Sort queue: ${q} open (pending/flagged/audit) — wife review`);
  if ((digest.community?.flaggedPosts ?? 0) > 0) {
    items.push(`Community: ${digest.community.flaggedPosts} flagged post(s)`);
  }
  if ((digest.disputes?.open ?? 0) > 0) {
    items.push(`Disputes: ${digest.disputes.open} open`);
  }
  if ((adminAlerts?.undismissed ?? 0) > 0) {
    items.push(`Admin alerts: ${adminAlerts.undismissed} undismissed`);
  }
  const ends = digest.referralBoost?.endsAt;
  if (ends) {
    const daysLeft = Math.ceil(
      (new Date(ends).getTime() - Date.now()) / (86400000),
    );
    if (daysLeft <= 7 && daysLeft >= 0) {
      items.push(`Referral boost ends in ~${daysLeft} day(s) (${ends.slice(0, 10)})`);
    }
  }
  if (!digest.dailyQuiz) items.push("No ACTIVE daily quiz game — check Content Queue");
  items.push(...buildIntegrityActionItems(digest.integrity));
  return items;
}

async function main() {
  const report = {
    generatedAt: new Date().toISOString(),
    digest: null,
    adminAlerts: null,
    actionItems: [],
    companionCommands: [
      "npm run monitor:plastypesa  # Play versionCode + crash/ANR vitals",
      "npm run play:install-stats  # Play install CSV + Mongo masters for Daily Check",
    ],
  };

  line("PlastyPesa daily digest");
  line(`Time: ${report.generatedAt}`);

  section("Product KPIs (Mongo)");
  try {
    report.digest = await mongoDigest();
    const d = report.digest;
    ok(`Users ${d.users.totalUsers} · Kenya ${d.users.kenyaUsers}`);
    ok(`Signups 24h ${d.users.new24h} · 7d ${d.users.new7d} · referrals 7d ${d.users.referrals7d ?? "?"}`);
    ok(
      `Sort queue open ${d.sortQueue.openTotal} (P${d.sortQueue.pending}/F${d.sortQueue.flagged}/A${d.sortQueue.audit})`,
    );
    ok(`Community posts 7d ${d.community.posts7d} · flagged ${d.community.flaggedPosts}`);
    ok(`Open disputes ${d.disputes.open ?? "?"}`);
    const rb = d.referralBoost;
    info(
      `Referral boost ${rb.pointsBoost} pts · ends ${rb.endsAt?.slice?.(0, 10) || "?"} · active=${rb.active}`,
    );
    if (d.pinnedBanner?.bannerId) {
      info(`Pinned banner: ${d.pinnedBanner.bannerId}`);
    }
    if (d.dailyQuiz?.title) {
      info(`Daily quiz: ${d.dailyQuiz.title}`);
    }
    const ig = d.integrity;
    if (ig && !ig.error) {
      const top = ig.leaderboardTop10?.[0];
      ok(
        `Weekly #1: ${top?.eco || "?"} · ${top?.weeklyPoints ?? "?"} pts · ${top?.referralSharePct ?? "?"}% referral`,
      );
      if (ig.lastWeekWinner?.note) info(ig.lastWeekWinner.note);
      if ((ig.farmingSignals || []).length) {
        warn(`${ig.farmingSignals.length} fair-play signal(s) — see integrity section in JSON`);
      }
      if ((ig.signupWatch?.similarEmailClusters || []).length) {
        warn(
          `Similar-email clusters (7d): ${ig.signupWatch.similarEmailClusters.length}`,
        );
      }
    } else if (ig?.error) {
      warn(`Integrity digest: ${ig.error}`);
    }
  } catch (e) {
    badMsg(e.message);
    report.digest = { error: e.message };
  }

  section("Fair-play & leaderboard");
  const ig = report.digest?.integrity;
  if (ig && !ig.error) {
    for (const row of (ig.leaderboardTop10 || []).slice(0, 5)) {
      info(
        `#${row.rank} ${row.eco} · ${row.weeklyPoints} pts · sorts ${row.approvedSorts} · referral ${row.referralSharePct}% · age ${row.accountAgeDays}d`,
      );
    }
    for (const mix of ig.top3ActivityMix || []) {
      const acts = (mix.topActivities || [])
        .slice(0, 3)
        .map((a) => `${a.type}:${a.sharePct}%`)
        .join(", ");
      info(`Top-${mix.rank} activity: ${acts || "?"}`);
    }
    if (ig.lastWeekWinner?.note) info(ig.lastWeekWinner.note);
    for (const s of (ig.topSortersWeek || []).slice(0, 3)) {
      info(`Sort leader #${s.rank} ${s.eco}: ${s.approvedSorts} approved`);
    }
    for (const s of (ig.farmingSignals || []).slice(0, 4)) {
      warn(`[${s.severity}] ${s.summary}`);
    }
  } else if (ig?.error) {
    warn(`Integrity: ${ig.error}`);
  }

  section("Admin API snapshot");
  try {
    const token = await getAdminToken();
    const alerts = await adminFetch("/admin/alerts", token).catch(() => null);
    if (alerts?.data) {
      const list = Array.isArray(alerts.data) ? alerts.data : alerts.data.alerts || [];
      const undismissed = list.filter((a) => a && !a.dismissed).length;
      report.adminAlerts = { undismissed, total: list.length };
      ok(`Admin alerts undismissed: ${undismissed}`);
    } else {
      info("Admin alerts endpoint skipped or empty");
    }
  } catch (e) {
    warn(`Admin API: ${e.message}`);
    report.adminAlerts = { error: e.message };
  }

  report.actionItems = buildActionItems(report.digest || {}, report.adminAlerts || {});

  section("Action items");
  if (report.actionItems.length === 0) {
    ok("Nothing urgent in automated checks — still run monitor:plastypesa after releases");
  } else {
    for (const item of report.actionItems) {
      warn(item);
    }
  }

  section("Companion");
  for (const cmd of report.companionCommands) {
    info(cmd);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), "utf8");
  line();
  ok(`Report written: ${OUT_PATH}`);
}

function badMsg(msg) {
  line(`  ✗ ${msg}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
