#!/usr/bin/env node
/**
 * Read / flip the `ads-config` master — PlastyPesa's remote ad kill-switches.
 *
 * The phone reads this document on every shell start and foreground resume
 * (`AdsRemoteConfig`, mobile app P2 2026-08-03). It is the only way to stop an
 * ad surface misbehaving without cutting a Play release, so it must stay easy
 * to flip and hard to get wrong.
 *
 * Fail-safe is OFF: a phone that has never read this document shows no ads at
 * all. Deleting the document therefore kills every surface everywhere within
 * one refresh, which is the intended panic button.
 *
 * Show current state:
 *   node scripts/plastypesa/ads-config.mjs
 *
 * Flip one or more switches (only the flags you pass change):
 *   node scripts/plastypesa/ads-config.mjs --set bannerEnabled=false
 *   node scripts/plastypesa/ads-config.mjs --set appOpenEnabled=true --set minAppVersionForAds=60
 *
 * Kill everything at once (leaves the document in place, all surfaces off):
 *   node scripts/plastypesa/ads-config.mjs --panic
 *
 * Add --dry to print the resulting document without writing it.
 *
 * Fields
 *   adsEnabled              master switch; false = no ads anywhere
 *   appOpenEnabled          AdMob app-open (suspended account — keep false until ~Aug 22)
 *   quizInterstitialEnabled LevelPlay interstitial at the quiz / EcoSort gate
 *   bannerEnabled           LevelPlay banner on allowlisted passive screens
 *   rewardedEnabled         LevelPlay rewarded — Reveal answer only, never points
 *   minAppVersionForAds     builds below this versionCode show nothing (0 = no floor)
 */
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const require = createRequire(
  resolve("C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/package.json"),
);
const { MongoClient } = require("mongodb");

const MASTER_NAME = "ads-config";

const BOOLEAN_FIELDS = [
  "adsEnabled",
  "appOpenEnabled",
  "quizInterstitialEnabled",
  "bannerEnabled",
  "rewardedEnabled",
];
const NUMBER_FIELDS = ["minAppVersionForAds"];

const dry = process.argv.includes("--dry");
const panic = process.argv.includes("--panic");

const overrides = {};
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] !== "--set") continue;
  const pair = process.argv[i + 1];
  if (!pair || !pair.includes("=")) {
    console.error(`--set needs field=value (got ${pair ?? "nothing"})`);
    process.exit(2);
  }
  const [field, raw] = pair.split("=");
  if (BOOLEAN_FIELDS.includes(field)) {
    if (raw !== "true" && raw !== "false") {
      console.error(`${field} is a boolean — pass true or false, not ${raw}`);
      process.exit(2);
    }
    overrides[field] = raw === "true";
  } else if (NUMBER_FIELDS.includes(field)) {
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 0) {
      console.error(`${field} must be a non-negative integer (got ${raw})`);
      process.exit(2);
    }
    overrides[field] = value;
  } else {
    console.error(
      `Unknown field ${field}. Known: ${[...BOOLEAN_FIELDS, ...NUMBER_FIELDS].join(", ")}`,
    );
    process.exit(2);
  }
}

const client = new MongoClient(loadBackendMongoEnv());
await client.connect();
const masters = client.db().collection("masters");
const existing = await masters.findOne({ name: MASTER_NAME });

// Absent document means "no ads": start any first write from all-off so a typo
// in one flag cannot accidentally switch on a surface nobody asked for.
const current = {
  adsEnabled: false,
  appOpenEnabled: false,
  quizInterstitialEnabled: false,
  bannerEnabled: false,
  rewardedEnabled: false,
  minAppVersionForAds: 0,
  ...(existing?.metadata ?? {}),
};

if (!panic && Object.keys(overrides).length === 0) {
  console.log(existing ? "CURRENT" : "ABSENT (phones show no ads)");
  console.log(JSON.stringify(current, null, 2));
  await client.close();
  process.exit(0);
}

const next = panic
  ? {
      adsEnabled: false,
      appOpenEnabled: false,
      quizInterstitialEnabled: false,
      bannerEnabled: false,
      rewardedEnabled: false,
      minAppVersionForAds: current.minAppVersionForAds,
    }
  : { ...current, ...overrides };

console.log("NEXT");
console.log(JSON.stringify(next, null, 2));

if (dry) {
  console.log("Dry — Mongo not written.");
  await client.close();
  process.exit(0);
}

await masters.updateOne(
  { name: MASTER_NAME },
  {
    $set: {
      name: MASTER_NAME,
      type: "dynamic",
      placeholder: "",
      data: [],
      metadata: next,
      updatedAt: new Date(),
      updatedAt_EP: Math.floor(Date.now() / 1000),
    },
    $setOnInsert: {
      createdAt: new Date(),
      createdAt_EP: Math.floor(Date.now() / 1000),
    },
  },
  { upsert: true },
);
await client.close();
console.log(`MONGO_WRITTEN master=${MASTER_NAME}`);
console.log("Phones pick this up on their next shell start or foreground resume.");
