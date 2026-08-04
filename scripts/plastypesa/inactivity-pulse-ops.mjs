#!/usr/bin/env node
/**
 * P-INACTIVE-PULSE — the one lever for the earn pause.
 *
 * The policy ships switched OFF. Nothing warns and nothing pauses until this
 * script arms it, and one flag here undoes the whole thing. That is deliberate:
 * a rule that can take away someone's ability to earn must be as easy to stop
 * as it was to start.
 *
 * Read the state:
 *   node scripts/plastypesa/inactivity-pulse-ops.mjs --show
 *
 * Arm warnings only (nobody is paused; already-idle people get the nudge):
 *   node scripts/plastypesa/inactivity-pulse-ops.mjs --arm-warnings
 *
 * Arm pausing too, once the warnings have had at least a day to land:
 *   node scripts/plastypesa/inactivity-pulse-ops.mjs --arm-pausing
 *
 * Stop everything (does not unpause anyone by itself):
 *   node scripts/plastypesa/inactivity-pulse-ops.mjs --off
 *
 * Undo — lift every live pause and switch the policy off:
 *   node scripts/plastypesa/inactivity-pulse-ops.mjs --undo-everything
 *
 * Change a number without touching the switches:
 *   node scripts/plastypesa/inactivity-pulse-ops.mjs --set idleDays=5 --set warnAfterDays=4
 *
 * Preview who the next run would touch, writing nothing:
 *   node scripts/plastypesa/inactivity-pulse-ops.mjs --preview
 *
 * Every write prints before/after so the change is provable in the DONE file.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const require = createRequire(
  resolve("C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/package.json"),
);
const { MongoClient } = require("mongodb");

const MASTER_NAME = "inactivity-pulse";

/** Mirrors DEFAULTS in inactivity_pulse.service.js. Keep the two in step. */
const SHIPPED_POLICY = {
  enabled: false,
  warningsEnabled: false,
  idleDays: 5,
  warnAfterDays: 4,
  newMemberGraceDays: 7,
  minWarnNoticeHours: 24,
  provisionalRestoreHours: 48,
  strikesBeforeTerminateCandidate: 3,
  strikeWindowDays: 90,
  waveFilter: "NEVER_PROVED_AND_ABSENT_14D",
  markets: ["KE"],
  maxPausesPerRun: 50,
  maxWarningsPerRun: 500,
};

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

function setPairs() {
  const out = {};
  argv.forEach((token, i) => {
    if (token !== "--set") return;
    const pair = argv[i + 1];
    if (!pair || !pair.includes("=")) return;
    const [key, raw] = pair.split(/=(.*)/);
    if (!(key in SHIPPED_POLICY)) {
      throw new Error(`Unknown config key "${key}". Known: ${Object.keys(SHIPPED_POLICY).join(", ")}`);
    }
    if (typeof SHIPPED_POLICY[key] === "boolean") out[key] = raw === "true";
    else if (typeof SHIPPED_POLICY[key] === "number") out[key] = Number(raw);
    else if (Array.isArray(SHIPPED_POLICY[key])) out[key] = raw.split(",").map((s) => s.trim());
    else out[key] = raw;
  });
  return out;
}

function readConfig(doc) {
  if (!doc) return { ...SHIPPED_POLICY, configPresent: false };
  let raw = Array.isArray(doc.metadata) && doc.metadata.length ? doc.metadata[0] : null;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (_) {
      raw = null;
    }
  }
  return { ...SHIPPED_POLICY, ...(raw && typeof raw === "object" ? raw : {}), configPresent: true };
}

function nairobiDayKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function idleDays(lastAt, now) {
  if (!lastAt) return null;
  const toMidnight = (key) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.max(
    0,
    Math.round((toMidnight(nairobiDayKey(now)) - toMidnight(nairobiDayKey(new Date(lastAt)))) / 86400000),
  );
}

/**
 * Same arithmetic the Lambda runs, read-only. This exists so the owner can see
 * the size of a wave before it happens rather than after.
 */
async function preview(db, config, now) {
  const users = await db
    .collection("users")
    .find(
      {
        role: { $nin: ["ADMIN", "OPERATOR"] },
        status: "ACTIVE",
        internalTester: { $ne: true },
        ...(config.markets?.length ? { countryCode: { $in: config.markets } } : {}),
      },
      {
        projection: {
          ecoHandle: 1,
          createdAt: 1,
          sortProofCount: 1,
          lastAppSeenAt: 1,
          earnPause: 1,
        },
      },
    )
    .toArray();

  const graceMs = config.newMemberGraceDays * 86400000;
  const rows = [];
  for (const user of users) {
    const pause = user.earnPause || {};
    if (pause.active === true) continue;

    let lastQualifyingAt = pause.lastQualifyingAt ? new Date(pause.lastQualifyingAt) : null;
    if (!lastQualifyingAt) {
      const [sort] = await db
        .collection("sort_proof_images")
        .find({ userId: String(user._id) }, { projection: { createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      const [eco] = await db
        .collection("eco_action_proofs")
        .find({ userId: String(user._id) }, { projection: { createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      const stamps = [sort?.createdAt, eco?.createdAt].filter(Boolean).map((d) => new Date(d));
      lastQualifyingAt = stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null;
    }

    const graceEndsAt = user.createdAt ? new Date(new Date(user.createdAt).getTime() + graceMs) : null;
    const clockStart =
      lastQualifyingAt && graceEndsAt
        ? new Date(Math.max(lastQualifyingAt.getTime(), graceEndsAt.getTime()))
        : lastQualifyingAt || graceEndsAt;
    if (!clockStart) continue;

    const idle = idleDays(clockStart, now);
    if (idle === null || idle < config.warnAfterDays) continue;

    rows.push({
      ecoHandle: user.ecoHandle || String(user._id),
      idle,
      everSubmitted: Boolean(lastQualifyingAt),
      alreadyWarned: Boolean(pause.warnedAt),
      wouldWarn: !pause.warnedAt,
      wouldPause:
        idle >= config.idleDays &&
        Boolean(pause.warnedAt) &&
        now.getTime() - new Date(pause.warnedAt).getTime() >= config.minWarnNoticeHours * 3600000,
    });
  }
  rows.sort((a, b) => b.idle - a.idle);
  return rows;
}

async function main() {
  const uri = loadBackendMongoEnv();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const now = new Date();

  try {
    const before = await db.collection("masters").findOne({ name: MASTER_NAME });
    const current = readConfig(before);

    const patch = setPairs();
    if (has("--arm-warnings")) {
      patch.warningsEnabled = true;
      patch.enabled = false;
    }
    if (has("--arm-pausing")) {
      patch.warningsEnabled = true;
      patch.enabled = true;
    }
    if (has("--off") || has("--undo-everything")) {
      patch.warningsEnabled = false;
      patch.enabled = false;
    }

    const pausedNow = await db.collection("users").countDocuments({ "earnPause.active": true });
    const warnedNow = await db
      .collection("users")
      .countDocuments({ "earnPause.active": { $ne: true }, "earnPause.warnedAt": { $ne: null } });

    console.log("=== P-INACTIVE-PULSE — current state ===");
    console.log(`master document present : ${current.configPresent ? "yes" : "no (shipped defaults apply)"}`);
    console.log(`warnings armed          : ${current.warningsEnabled === true ? "YES" : "no"}`);
    console.log(`pausing armed           : ${current.enabled === true ? "YES" : "no"}`);
    console.log(`idle days -> pause      : ${current.idleDays}`);
    console.log(`idle days -> warning    : ${current.warnAfterDays}`);
    console.log(`new-member grace (days) : ${current.newMemberGraceDays}`);
    console.log(`min notice before pause : ${current.minWarnNoticeHours}h`);
    console.log(`wave filter             : ${current.waveFilter}`);
    console.log(`markets                 : ${(current.markets || []).join(", ") || "(all)"}`);
    console.log(`accounts paused right now : ${pausedNow}`);
    console.log(`accounts warned, not paused : ${warnedNow}`);

    if (has("--preview")) {
      const rows = await preview(db, current, now);
      console.log("");
      console.log(`=== Preview — ${rows.length} account(s) at or past the warning line ===`);
      console.log(`would be warned on the next run : ${rows.filter((r) => r.wouldWarn).length}`);
      console.log(`could be paused on the next run : ${rows.filter((r) => r.wouldPause).length}`);
      console.log(`never submitted anything        : ${rows.filter((r) => !r.everSubmitted).length}`);
      for (const row of rows.slice(0, 40)) {
        console.log(
          `  ${row.ecoHandle.padEnd(18)} idle ${String(row.idle).padStart(3)}d  ` +
            `${row.everSubmitted ? "has submitted before" : "never submitted   "}  ` +
            `${row.alreadyWarned ? "warned" : "not warned"}` +
            `${row.wouldPause ? "  -> PAUSE" : row.wouldWarn ? "  -> warn" : ""}`,
        );
      }
      if (rows.length > 40) console.log(`  ... and ${rows.length - 40} more`);
    }

    if (has("--undo-everything")) {
      const paused = await db
        .collection("users")
        .find({ "earnPause.active": true }, { projection: { ecoHandle: 1 } })
        .toArray();
      for (const user of paused) {
        await db.collection("users").updateOne(
          { _id: user._id },
          {
            $set: {
              "earnPause.active": false,
              "earnPause.reason": null,
              "earnPause.pausedAt": null,
              "earnPause.warnedAt": null,
              "earnPause.provisionalUntil": null,
              "earnPause.restoredAt": now,
            },
          },
        );
      }
      console.log("");
      console.log(`UNDO: lifted ${paused.length} pause(s) and switching the policy off.`);
    }

    if (!Object.keys(patch).length) {
      if (!has("--preview")) {
        console.log("");
        console.log("No change requested. Use --arm-warnings / --arm-pausing / --off / --undo-everything / --set k=v.");
      }
      return;
    }

    const next = { ...current, ...patch };
    delete next.configPresent;
    if (patch.enabled === true && !next.enforcementStartedAt) {
      next.enforcementStartedAt = now.toISOString();
    }

    await db.collection("masters").updateOne(
      { name: MASTER_NAME },
      {
        $set: {
          name: MASTER_NAME,
          type: "CONFIG",
          metadata: [next],
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    const after = readConfig(await db.collection("masters").findOne({ name: MASTER_NAME }));
    console.log("");
    console.log("=== Written ===");
    for (const key of Object.keys(patch)) {
      console.log(`  ${key}: ${JSON.stringify(current[key])} -> ${JSON.stringify(after[key])}`);
    }
    if (after.enabled === true) {
      console.log("");
      console.log("PAUSING IS NOW ARMED. The daily run at 03:00 UTC (06:00 Nairobi) can pause accounts.");
      console.log("To stop it: node scripts/plastypesa/inactivity-pulse-ops.mjs --undo-everything");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
