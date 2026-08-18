#!/usr/bin/env node
/**
 * Set referral launch boost end date in production Master (date only).
 * Never rewrite referral-points-boost / referral-points / signup-bonus-points
 * (those were ÷10 already — writing 2000/1000 would 10× pay).
 *
 *   node scripts/plastypesa/set-referral-boost-ends.mjs --date=2026-09-21
 *   node scripts/plastypesa/set-referral-boost-ends.mjs --send --date=2026-09-21
 */
import { MongoClient } from "mongodb";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const TARGET_DATE = process.argv
  .find((a) => a.startsWith("--date="))
  ?.slice("--date=".length);
if (!TARGET_DATE || !/^\d{4}-\d{2}-\d{2}$/.test(TARGET_DATE)) {
  console.error("Required: --date=YYYY-MM-DD (Kenya calendar day). Example: --date=2026-09-21");
  process.exit(1);
}
// End of that Kenya day (EAT = UTC+3) → 20:59:59 UTC
const BOOST_END_ISO = `${TARGET_DATE}T20:59:59.000Z`;

async function main() {
  const uri = loadBackendMongoEnv();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const colName = (await db.collection("masters").findOne({ name: "referral-points" }))
    ? "masters"
    : "master";
  const col = db.collection(colName);

  const before = await col.findOne({ name: "referral-boost-ends-at" });
  console.log("BEFORE referral-boost-ends-at:", JSON.stringify(before?.metadata ?? null));

  const boostPts = await col.findOne({ name: "referral-points-boost" });
  const basePts = await col.findOne({ name: "referral-points" });
  const signupPts = await col.findOne({ name: "signup-bonus-points" });
  console.log("LIVE referral-points-boost:", JSON.stringify(boostPts?.metadata ?? null));
  console.log("LIVE referral-points:", JSON.stringify(basePts?.metadata ?? null));
  console.log("LIVE signup-bonus-points:", JSON.stringify(signupPts?.metadata ?? null));

  if (!process.argv.includes("--send")) {
    console.log(`Dry run — would set referral-boost-ends-at to ${BOOST_END_ISO}`);
    console.log("Will NOT rewrite boost/base/signup amounts (÷10 already live).");
    await client.close();
    return;
  }

  await col.updateOne(
    { name: "referral-boost-ends-at" },
    {
      $set: {
        name: "referral-boost-ends-at",
        type: "dynamic",
        metadata: [BOOST_END_ISO],
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );

  const after = await col.findOne({ name: "referral-boost-ends-at" });
  const boostAfter = await col.findOne({ name: "referral-points-boost" });
  const baseAfter = await col.findOne({ name: "referral-points" });
  console.log("AFTER referral-boost-ends-at:", JSON.stringify(after?.metadata ?? null));
  console.log("UNCHANGED referral-points-boost:", JSON.stringify(boostAfter?.metadata ?? null));
  console.log("UNCHANGED referral-points:", JSON.stringify(baseAfter?.metadata ?? null));
  await client.close();
  ok(`Live: boost ends ${BOOST_END_ISO} (date only; amounts untouched)`);
}

function ok(msg) {
  console.log("✓", msg);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
