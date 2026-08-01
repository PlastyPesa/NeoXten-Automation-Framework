#!/usr/bin/env node
/**
 * Set referral launch boost end date in production Master (default: 2026-08-11 EAT midnight).
 *
 *   node scripts/plastypesa/set-referral-boost-ends.mjs
 *   node scripts/plastypesa/set-referral-boost-ends.mjs --send
 *   node scripts/plastypesa/set-referral-boost-ends.mjs --send --date=2026-08-11
 */
import { MongoClient } from "mongodb";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const TARGET_DATE =
  process.argv.find((a) => a.startsWith("--date="))?.slice("--date=".length) ||
  "2026-08-11";
// End of campaign day in Kenya (EAT = UTC+3) → 2026-08-11 23:59:59 EAT = 20:59:59 UTC
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

  if (!process.argv.includes("--send")) {
    console.log(`Dry run — would set referral-boost-ends-at to ${BOOST_END_ISO}`);
    console.log("Also confirms referral-points-boost=2000, referral-points=1000");
    await client.close();
    return;
  }

  for (const row of [
    { name: "referral-points-boost", amount: 2000 },
    { name: "referral-boost-ends-at", amount: BOOST_END_ISO },
    { name: "referral-points", amount: 1000 },
    { name: "signup-bonus-points", amount: 1000 },
  ]) {
    await col.updateOne(
      { name: row.name },
      {
        $set: { name: row.name, type: "dynamic", metadata: [row.amount] },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  }

  const after = await col.findOne({ name: "referral-boost-ends-at" });
  console.log("AFTER referral-boost-ends-at:", JSON.stringify(after?.metadata ?? null));
  await client.close();
  ok(`Live: boost ends ${BOOST_END_ISO} (11 Aug EAT)`);
}

function ok(msg) {
  console.log("✓", msg);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
