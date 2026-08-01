/**
 * Fair-play / farming signals for the daily ops digest.
 * Mirrors backend weekly_ranking.service tie-breaks + referral_fraud_guard stems.
 */
import { ObjectId } from "mongodb";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  WEEKLY_TRANSACTION_TYPES,
  COLLECTION_LEADERBOARD_MULTIPLIER,
} = require("../../../plastypesa-backend-api/lib/lambda/backend/utils/leaderboard.constants.js");

const APPROVED_SORT_STATUSES = [
  "APPROVED",
  "AUTO_APPROVED",
  "REVIEWER_APPROVED",
];

const USER_BASE = {
  staffDisabled: { $ne: true },
  role: { $nin: ["admin"] },
};

const ACTIVE_USER = { ...USER_BASE, status: "ACTIVE" };

function getWeekStartUtc(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Same stem logic as referral_fraud_guard.service.js */
export function emailLocalStem(email) {
  if (!email) return "";
  const local = String(email).split("@")[0].toLowerCase();
  const stripped = local.replace(/[\d._+\-]/g, "");
  if (stripped.length >= 4) return stripped.slice(0, 16);
  return local.replace(/\d+/g, "").slice(0, 16);
}

export function maskEmail(email) {
  if (!email) return "";
  const s = String(email);
  const at = s.indexOf("@");
  if (at < 2) return "***";
  return `${s.slice(0, 2)}***${s.slice(at)}`;
}

function maskDeviceId(deviceId) {
  const id = String(deviceId || "").trim();
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function toObjectIds(ids) {
  return ids
    .filter((id) => id && ObjectId.isValid(String(id)))
    .map((id) => new ObjectId(String(id)));
}

async function loadUsersById(db, ids) {
  const objectIds = toObjectIds(ids);
  if (!objectIds.length) return new Map();
  const users = await db
    .collection("users")
    .find({ _id: { $in: objectIds } })
    .project({ ecoHandle: 1, email: 1, status: 1 })
    .toArray();
  return new Map(users.map((u) => [String(u._id), u]));
}

function weeklyTxnLookupStage(weekStart) {
  return {
    $lookup: {
      from: "transactions",
      let: { userId: { $toString: "$_id" } },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                {
                  $or: [
                    { $eq: ["$to", "$$userId"] },
                    { $eq: ["$from", "$$userId"] },
                  ],
                },
                { $in: ["$type", WEEKLY_TRANSACTION_TYPES] },
                { $eq: ["$status", "COMPLETED"] },
                {
                  $gte: [{ $ifNull: ["$effectiveAt", "$createdAt"] }, weekStart],
                },
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            weeklyPoints: {
              $sum: {
                $cond: [
                  { $eq: ["$type", "CREDIT"] },
                  { $multiply: ["$points", COLLECTION_LEADERBOARD_MULTIPLIER] },
                  "$points",
                ],
              },
            },
            approvedSortProofsThisWeek: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$type", "SORT_PROOF"] },
                      { $in: ["$reviewStatus", APPROVED_SORT_STATUSES] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            referralPoints: {
              $sum: {
                $cond: [{ $eq: ["$type", "REFERRAL"] }, "$points", 0],
              },
            },
            _earnDayKeys: {
              $addToSet: {
                $dateToString: {
                  format: "%Y-%m-%d",
                  date: { $ifNull: ["$effectiveAt", "$createdAt"] },
                  timezone: "UTC",
                },
              },
            },
            lastEarnAt: { $max: { $ifNull: ["$effectiveAt", "$createdAt"] } },
          },
        },
      ],
      as: "weeklyTransactions",
    },
  };
}

function weeklyStatsAddFields() {
  return {
    $addFields: {
      weeklyPoints: {
        $ifNull: [{ $arrayElemAt: ["$weeklyTransactions.weeklyPoints", 0] }, 0],
      },
      referralPointsWeek: {
        $ifNull: [{ $arrayElemAt: ["$weeklyTransactions.referralPoints", 0] }, 0],
      },
      approvedSortProofsThisWeek: {
        $ifNull: [
          { $arrayElemAt: ["$weeklyTransactions.approvedSortProofsThisWeek", 0] },
          0,
        ],
      },
      distinctEarnDaysThisWeek: {
        $size: {
          $ifNull: [
            { $arrayElemAt: ["$weeklyTransactions._earnDayKeys", 0] },
            [],
          ],
        },
      },
      lastEarnAt: {
        $ifNull: [
          { $arrayElemAt: ["$weeklyTransactions.lastEarnAt", 0] },
          new Date(0),
        ],
      },
      lifetimePoints: { $ifNull: ["$lifetimePoints", 0] },
      accountAgeDays: {
        $floor: {
          $divide: [{ $subtract: [new Date(), "$createdAt"] }, 86400000],
        },
      },
    },
  };
}

async function computeWeeklyLeaderboard(db, weekStart, limit = 15) {
  const rows = await db
    .collection("users")
    .aggregate([
      { $match: ACTIVE_USER },
      weeklyTxnLookupStage(weekStart),
      weeklyStatsAddFields(),
      { $match: { weeklyPoints: { $gt: 0 } } },
      {
        $sort: {
          weeklyPoints: -1,
          approvedSortProofsThisWeek: -1,
          distinctEarnDaysThisWeek: -1,
          lastEarnAt: 1,
          lifetimePoints: -1,
          _id: 1,
        },
      },
      { $limit: limit },
      {
        $project: {
          userId: { $toString: "$_id" },
          ecoHandle: 1,
          email: 1,
          createdAt: 1,
          countryCode: 1,
          referredBy: 1,
          weeklyPoints: 1,
          referralPointsWeek: 1,
          approvedSortProofsThisWeek: 1,
          distinctEarnDaysThisWeek: 1,
          lifetimePoints: 1,
          accountAgeDays: 1,
        },
      },
    ])
    .toArray();

  return rows.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    eco: r.ecoHandle || maskEmail(r.email),
    weeklyPoints: r.weeklyPoints,
    referralPoints: r.referralPointsWeek,
    referralSharePct:
      r.weeklyPoints > 0
        ? Math.round((100 * r.referralPointsWeek) / r.weeklyPoints)
        : 0,
    approvedSorts: r.approvedSortProofsThisWeek,
    earnDays: r.distinctEarnDaysThisWeek,
    lifetimePoints: r.lifetimePoints,
    accountAgeDays: r.accountAgeDays,
    country: r.countryCode || null,
  }));
}

async function activityMixForUser(db, userId, weekStart) {
  const rows = await db
    .collection("transactions")
    .aggregate([
      {
        $match: {
          $expr: {
            $and: [
              {
                $or: [{ $eq: ["$to", userId] }, { $eq: ["$from", userId] }],
              },
              { $in: ["$type", WEEKLY_TRANSACTION_TYPES] },
              { $eq: ["$status", "COMPLETED"] },
              {
                $gte: [{ $ifNull: ["$effectiveAt", "$createdAt"] }, weekStart],
              },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$type",
          points: {
            $sum: {
              $cond: [
                { $eq: ["$type", "CREDIT"] },
                { $multiply: ["$points", COLLECTION_LEADERBOARD_MULTIPLIER] },
                "$points",
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { points: -1 } },
    ])
    .toArray();

  const total = rows.reduce((s, r) => s + (r.points || 0), 0);
  return rows.map((r) => ({
    type: r._id,
    points: r.points,
    count: r.count,
    sharePct: total > 0 ? Math.round((100 * r.points) / total) : 0,
  }));
}

async function topSortersWeek(db, weekStart) {
  const fromTx = await db
    .collection("transactions")
    .aggregate([
      {
        $match: {
          type: "SORT_PROOF",
          status: "COMPLETED",
          reviewStatus: { $in: APPROVED_SORT_STATUSES },
          $or: [
            { effectiveAt: { $gte: weekStart } },
            { effectiveAt: null, createdAt: { $gte: weekStart } },
          ],
        },
      },
      {
        $group: {
          _id: "$to",
          approvedSorts: { $sum: 1 },
          points: { $sum: "$points" },
        },
      },
      { $sort: { approvedSorts: -1, points: -1 } },
      { $limit: 8 },
    ])
    .toArray();

  const userIds = fromTx.map((r) => r._id).filter(Boolean);
  const byId = await loadUsersById(db, userIds);

  return fromTx.map((r, i) => {
    const u = byId.get(String(r._id));
    return {
      rank: i + 1,
      eco: u?.ecoHandle || maskEmail(u?.email) || String(r._id).slice(-6),
      approvedSorts: r.approvedSorts,
      sortPoints: r.points,
    };
  });
}

async function signupWatch(db, d1, d7) {
  const recent7d = await db
    .collection("users")
    .find({ ...USER_BASE, createdAt: { $gte: d7 } })
    .project({
      email: 1,
      ecoHandle: 1,
      deviceId: 1,
      referredBy: 1,
      createdAt: 1,
      status: 1,
    })
    .toArray();

  const recent24h = recent7d.filter((u) => u.createdAt >= d1);
  const suspended7d = recent7d.filter((u) => u.status === "SUSPENDED").length;
  const referralSignups7d = recent7d.filter((u) => u.referredBy).length;

  const stemMap = new Map();
  for (const u of recent7d) {
    const stem = emailLocalStem(u.email);
    if (!stem || stem.length < 4) continue;
    if (!stemMap.has(stem)) stemMap.set(stem, []);
    stemMap.get(stem).push(u);
  }
  const similarEmailClusters = [...stemMap.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([stem, list]) => ({
      stem,
      count: list.length,
      ecos: list.slice(0, 6).map((u) => u.ecoHandle || maskEmail(u.email)),
      emailsMasked: list.slice(0, 4).map((u) => maskEmail(u.email)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const deviceMap = new Map();
  for (const u of recent7d) {
    const dev = String(u.deviceId || "").trim();
    if (!dev) continue;
    if (!deviceMap.has(dev)) deviceMap.set(dev, []);
    deviceMap.get(dev).push(u);
  }
  const multiAccountDevices24h = [...deviceMap.entries()]
    .filter(([, list]) => list.filter((u) => u.createdAt >= d1).length >= 2)
    .map(([deviceId, list]) => ({
      device: maskDeviceId(deviceId),
      signups24h: list.filter((u) => u.createdAt >= d1).length,
      ecos: list.slice(0, 4).map((u) => u.ecoHandle || maskEmail(u.email)),
    }))
    .slice(0, 6);

  const deviceCapHits = await db
    .collection("users")
    .aggregate([
      {
        $match: {
          ...ACTIVE_USER,
          deviceId: { $exists: true, $nin: [null, ""] },
        },
      },
      {
        $group: {
          _id: "$deviceId",
          count: { $sum: 1 },
          ecos: { $push: "$ecoHandle" },
        },
      },
      { $match: { count: { $gte: 2 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ])
    .toArray();

  return {
    new24h: recent24h.length,
    new7d: recent7d.length,
    suspended7d,
    referralSignups7d,
    similarEmailClusters,
    multiAccountDevices24h,
    devicesAtRegistrationCap: deviceCapHits.map((d) => ({
      device: maskDeviceId(d._id),
      activeAccounts: d.count,
      ecos: (d.ecos || []).filter(Boolean).slice(0, 4),
    })),
  };
}

async function referralBursts24h(db, since) {
  const rows = await db
    .collection("transactions")
    .aggregate([
      {
        $match: {
          type: "REFERRAL",
          status: "COMPLETED",
          createdAt: { $gte: since },
        },
      },
      { $group: { _id: "$to", count: { $sum: 1 }, points: { $sum: "$points" } } },
      { $match: { count: { $gte: 3 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ])
    .toArray();

  const byId = await loadUsersById(
    db,
    rows.map((r) => r._id),
  );

  return rows.map((r) => {
    const u = byId.get(String(r._id));
    return {
      eco: u?.ecoHandle || maskEmail(u?.email) || String(r._id).slice(-6),
      status: u?.status || "?",
      referrals24h: r.count,
      referralPoints24h: r.points,
    };
  });
}

async function lastWeekWinnerContext(db, liveBoard, weekStart) {
  const close = await db
    .collection("market_weekly_closes")
    .findOne(
      { marketCode: "KE", status: "CONFIRMED", weekStart: { $lt: weekStart } },
      { sort: { weekStart: -1 } },
    );

  if (!close) return null;

  const winner =
    close.winners?.[0] ||
    close.rankedEntries?.find((e) => e.rank === 1) ||
    close.rankedEntries?.[0];
  if (!winner?.userId) return null;

  const winnerUser = ObjectId.isValid(String(winner.userId))
    ? await db
        .collection("users")
        .findOne(
          { _id: new ObjectId(String(winner.userId)) },
          { projection: { ecoHandle: 1, createdAt: 1 } },
        )
        .catch(() => null)
    : null;

  const winnerEco =
    winnerUser?.ecoHandle ||
    winner.ecoHandle ||
    String(winner.userId).slice(-6);
  const closeEco = winner.ecoHandle || null;
  const ecoChanged =
    closeEco && winnerEco && closeEco !== winnerEco
      ? { was: closeEco, now: winnerEco }
      : null;

  const current = liveBoard.find((r) => r.userId === String(winner.userId));
  const leader = liveBoard[0] || null;
  const gapToLeader =
    leader && current
      ? leader.weeklyPoints - current.weeklyPoints
      : leader && !current
        ? leader.weeklyPoints
        : null;

  let note;
  if (current?.rank === 1) {
    note = `Last week's #1 (${winnerEco}) still leads this week.`;
  } else if (current?.rank && current.rank <= 3) {
    note = leader
      ? `Last week's #1 (${winnerEco}) is rank ${current.rank}; new leader ${leader.eco} leads by ${gapToLeader} pts this week.`
      : `Last week's #1 (${winnerEco}) is rank ${current.rank} this week.`;
  } else if (current?.rank) {
    note = `Last week's #1 (${winnerEco}) dropped to rank ${current.rank} — new leader ${leader?.eco || "?"} (+${gapToLeader ?? "?"} pts).`;
  } else {
    note = `Last week's #1 (${winnerEco}) has 0 weekly points this week — ${leader?.eco || "someone else"} took the lead.`;
  }

  return {
    weekStart: close.weekStart,
    eco: winnerEco,
    closeEco: closeEco || null,
    ecoChanged,
    lastWeekRank: winner.rank || 1,
    lastWeekPoints: winner.weeklyPoints,
    currentRank: current?.rank ?? null,
    currentWeeklyPoints: current?.weeklyPoints ?? 0,
    pointsBehindLeader: gapToLeader,
    newLeaderEco: leader?.rank === 1 ? leader.eco : null,
    newLeaderPoints: leader?.weeklyPoints ?? null,
    note,
  };
}

function detectQuickRisers(liveBoard) {
  return liveBoard
    .filter((r) => r.rank <= 5)
    .filter(
      (r) =>
        (r.rank === 1 && r.accountAgeDays <= 10) ||
        (r.rank <= 3 && r.accountAgeDays <= 5 && r.weeklyPoints >= 8000) ||
        (r.referralSharePct >= 60 && r.rank <= 5),
    )
    .map((r) => ({
      rank: r.rank,
      eco: r.eco,
      accountAgeDays: r.accountAgeDays,
      weeklyPoints: r.weeklyPoints,
      referralSharePct: r.referralSharePct,
      approvedSorts: r.approvedSorts,
      flag:
        r.referralSharePct >= 60
          ? "referral-heavy-top5"
          : r.accountAgeDays <= 5
            ? "very-new-top3"
            : "new-account-at-1",
    }));
}

function detectFarmingSignals(liveBoard, signupWatch, referralBursts) {
  const signals = [];

  for (const c of signupWatch.similarEmailClusters || []) {
    signals.push({
      severity: c.count >= 5 ? "high" : "medium",
      code: "similar-email-cluster",
      summary: `${c.count} signups share email stem "${c.stem}" (${c.ecos.join(", ")})`,
    });
  }

  for (const r of liveBoard.filter((x) => x.rank <= 3 && x.referralSharePct >= 50)) {
    signals.push({
      severity: r.referralSharePct >= 70 ? "high" : "medium",
      code: "referral-heavy-leaderboard",
      summary: `#${r.rank} ${r.eco}: ${r.referralSharePct}% of weekly points from referrals (${r.approvedSorts} approved sorts)`,
    });
  }

  for (const r of liveBoard.filter((x) => x.rank <= 5 && x.approvedSorts === 0 && x.weeklyPoints >= 5000)) {
    signals.push({
      severity: "medium",
      code: "high-points-no-sorts",
      summary: `#${r.rank} ${r.eco}: ${r.weeklyPoints} pts with 0 approved sorts this week`,
    });
  }

  for (const b of referralBursts || []) {
    if (b.referrals24h >= 5) {
      signals.push({
        severity: b.referrals24h >= 8 ? "high" : "medium",
        code: "referral-burst",
        summary: `${b.eco}: ${b.referrals24h} referral credits in 24h`,
      });
    }
  }

  return signals.slice(0, 12);
}

async function openFraudAlerts(db) {
  const mastersCol = (await db.collection("masters").findOne({ name: "admin-alerts" }))
    ? "masters"
    : "master";
  const master = await db.collection(mastersCol).findOne({ name: "admin-alerts" });
  const alerts = master?.metadata?.alerts || master?.metadata || [];
  if (!Array.isArray(alerts)) return [];
  return alerts
    .filter((a) => a && !a.dismissed)
    .filter(
      (a) =>
        a.source === "referral_fraud_guard" ||
        /similar email|referral burst|cluster|farm/i.test(`${a.title} ${a.description}`),
    )
    .slice(0, 8)
    .map((a) => ({
      id: a.id,
      severity: a.severity,
      title: a.title,
      createdAt: a.createdAt,
    }));
}

/**
 * @param {import('mongodb').Db} db
 */
export async function buildIntegrityDigest(db) {
  const now = new Date();
  const d1 = new Date(now.getTime() - 86400000);
  const d7 = new Date(now.getTime() - 7 * 86400000);
  const weekStart = getWeekStartUtc(now);

  const [liveBoard, signupWatchData, referralBursts, topSorters, fraudAlerts] =
    await Promise.all([
      computeWeeklyLeaderboard(db, weekStart, 15),
      signupWatch(db, d1, d7),
      referralBursts24h(db, d1),
      topSortersWeek(db, weekStart),
      openFraudAlerts(db),
    ]);

  const top3 = liveBoard.slice(0, 3);
  const top3ActivityMix = [];
  for (const row of top3) {
    const mix = await activityMixForUser(db, row.userId, weekStart);
    top3ActivityMix.push({
      rank: row.rank,
      eco: row.eco,
      weeklyPoints: row.weeklyPoints,
      topActivities: mix.slice(0, 5),
      dominantType: mix[0]?.type || null,
      dominantSharePct: mix[0]?.sharePct || 0,
    });
  }

  const lastWeekWinner = await lastWeekWinnerContext(db, liveBoard, weekStart);
  const quickRisers = detectQuickRisers(liveBoard);
  const farmingSignals = detectFarmingSignals(
    liveBoard,
    signupWatchData,
    referralBursts,
  );

  return {
    weekStartUtc: weekStart.toISOString(),
    leaderboardTop10: liveBoard.slice(0, 10),
    top3ActivityMix,
    lastWeekWinner,
    quickRisers,
    topSortersWeek: topSorters,
    signupWatch: signupWatchData,
    referralBursts24h: referralBursts,
    farmingSignals,
    openFraudAlerts: fraudAlerts,
  };
}

export function buildIntegrityActionItems(integrity) {
  if (!integrity || integrity.error) return [];
  const items = [];
  for (const s of integrity.farmingSignals || []) {
    if (s.severity === "high") items.push(`Fair-play HIGH: ${s.summary}`);
  }
  for (const c of integrity.signupWatch?.similarEmailClusters || []) {
    if (c.count >= 4) {
      items.push(`Similar-email cluster (${c.count}): stem "${c.stem}" — ${c.ecos.slice(0, 3).join(", ")}`);
    }
  }
  const lw = integrity.lastWeekWinner;
  if (lw?.currentRank && lw.currentRank > 1 && lw.lastWeekRank === 1 && lw.newLeaderEco) {
    items.push(
      `Leaderboard shift: last week's #1 (${lw.eco}) now rank ${lw.currentRank}; ${lw.newLeaderEco} leads by ${lw.pointsBehindLeader} pts`,
    );
  }
  for (const r of integrity.quickRisers || []) {
    if (r.flag === "referral-heavy-top5" && r.rank <= 3) {
      items.push(`Quick riser #${r.rank} ${r.eco}: ${r.referralSharePct}% referral-driven`);
    }
  }
  if ((integrity.openFraudAlerts || []).length > 0) {
    items.push(`${integrity.openFraudAlerts.length} open fraud alert(s) in admin master`);
  }
  return items;
}
