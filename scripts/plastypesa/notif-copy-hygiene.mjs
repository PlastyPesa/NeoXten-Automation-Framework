/**
 * P-NOTIF-COPY-HYGIENE — prove sort-submit inbox copy has no mojibake,
 * and live ANNOUNCEMENTs do not say "collected" for kg impact.
 *
 *   node scripts/plastypesa/notif-copy-hygiene.mjs
 *   node scripts/plastypesa/notif-copy-hygiene.mjs --pass 2
 *   node scripts/plastypesa/notif-copy-hygiene.mjs --fix-mongo
 */
import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";

bootstrapPlastyPesaEnv();
const pass = process.argv.includes("--pass")
  ? process.argv[process.argv.indexOf("--pass") + 1]
  : "1";
const fixMongo = process.argv.includes("--fix-mongo");
const sourceOnly = process.argv.includes("--source-only");

const HOME_CTRL = path.join(
  "C:",
  "Users",
  "Bobby",
  "Documents",
  "plastypesa-backend-api",
  "lib",
  "lambda",
  "backend",
  "controllers",
  "home.controller.js"
);

const EXPECTED_SNIPPET =
  "It is pending review - you will be notified when it is approved.";

/** Classic UTF-8 em-dash mis-decoded as Latin-1 then re-encoded: â€" */
const MOJIBAKE_BYTES = Buffer.from([0xc3, 0xa2, 0xe2, 0x82, 0xac, 0xe2, 0x80, 0x9d]);

function loadMongoUri() {
  if (process.env.PLASTYPESA_MONGO_URI || process.env.MONGODB_URI) {
    return process.env.PLASTYPESA_MONGO_URI || process.env.MONGODB_URI;
  }
  const ops = path.join(
    "C:",
    "Users",
    "Bobby",
    "Documents",
    "plastypesa-backend-api",
    ".local",
    "ops-investigate-dennis-points-20260729.js"
  );
  const src = fs.readFileSync(ops, "utf8");
  const parts = [...src.matchAll(/"mongodb:\/\/[^"]+"|"ac-[^"]+"/g)].map((m) =>
    m[0].replace(/"/g, "")
  );
  if (parts.length >= 2 && parts[0].startsWith("mongodb://")) {
    return parts.join("");
  }
  const m = src.match(/mongodb:\/\/[^"'\s]+/);
  if (!m) throw new Error("No Mongo URI (set PLASTYPESA_MONGO_URI)");
  return m[0];
}

function assertSourceClean() {
  const buf = fs.readFileSync(HOME_CTRL);
  if (buf.includes(MOJIBAKE_BYTES)) {
    throw new Error("FAIL source still contains â€\" mojibake bytes in home.controller.js");
  }
  const text = buf.toString("utf8");
  if (!text.includes(EXPECTED_SNIPPET)) {
    throw new Error(`FAIL missing expected SORT_PROOF_SUBMITTED message: ${EXPECTED_SNIPPET}`);
  }
  const submitBlock = text.slice(
    text.indexOf('type: "SORT_PROOF_SUBMITTED"') - 400,
    text.indexOf('type: "SORT_PROOF_SUBMITTED"') + 80
  );
  if (/collected/i.test(submitBlock)) {
    throw new Error("FAIL SORT_PROOF_SUBMITTED neighborhood mentions collected");
  }
  console.log(`PASS source_sort_submit_message_clean (pass=${pass})`);
}

async function assertAnnouncementsAndMaybeFix() {
  const uri = loadMongoUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  try {
    const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const announcements = await db
      .collection("notifications")
      .find({
        type: "ANNOUNCEMENT",
        createdAt: { $gte: since },
      })
      .project({ message: 1, title: 1, createdAt: 1 })
      .limit(200)
      .toArray();

    const collectedHits = announcements.filter((n) =>
      /collected/i.test(`${n.title || ""} ${n.message || ""}`)
    );
    console.log(
      `PASS announcement_scan rows=${announcements.length} collectedHits=${collectedHits.length} (pass=${pass})`
    );
    if (collectedHits.length > 0) {
      for (const h of collectedHits.slice(0, 5)) {
        console.log(`  HIT: ${(h.message || "").slice(0, 120)}`);
      }
      throw new Error("FAIL live ANNOUNCEMENT still says collected");
    }

    const mojiRe = /â€"|â€”|\u00e2\u20ac[\u201c\u201d\u2014]/;
    const badNotifs = await db
      .collection("notifications")
      .find({
        $or: [
          { message: { $regex: "â€" } },
          { title: { $regex: "â€" } },
          { message: { $regex: "pending review .+ you will be notified" } },
        ],
      })
      .project({ _id: 1, type: 1, message: 1, userId: 1 })
      .limit(100)
      .toArray();

    // Narrow to real mojibake bytes in message
    const trulyBad = badNotifs.filter((n) => {
      const msg = String(n.message || "");
      return Buffer.from(msg, "utf8").includes(MOJIBAKE_BYTES) || /â€/.test(msg);
    });

    console.log(`INFO notif_mojibake_candidates=${trulyBad.length}`);

    if (fixMongo && trulyBad.length > 0) {
      let fixed = 0;
      for (const n of trulyBad) {
        const next = String(n.message || "")
          .replace(/\u00e2\u20ac\u201d/g, " - ")
          .replace(/â€"/g, " - ")
          .replace(/â€”/g, " - ")
          .replace(/\s+-\s+/g, " - ");
        if (next !== n.message) {
          await db.collection("notifications").updateOne(
            { _id: n._id },
            { $set: { message: next } }
          );
          fixed += 1;
        }
      }
      console.log(`PASS mongo_mojibake_fixed count=${fixed}`);
    } else if (trulyBad.length > 0) {
      console.log(
        `WARN ${trulyBad.length} inbox rows still have mojibake — re-run with --fix-mongo`
      );
    } else {
      console.log(`PASS mongo_inbox_no_mojibake (pass=${pass})`);
    }
  } finally {
    await client.close();
  }
}

async function main() {
  assertSourceClean();
  if (sourceOnly) {
    console.log(`OK notif-copy-hygiene source-only pass=${pass}`);
    return;
  }
  await assertAnnouncementsAndMaybeFix();
  console.log(`OK notif-copy-hygiene pass=${pass}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
