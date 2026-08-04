/**
 * P-REFERRAL-CODE-SPACE — backfill `referralCodeNormalized`.
 *
 * WHAT THIS DOES AND DOES NOT DO
 * It ADDS a derived lookup field next to every existing `referralCode`. It
 * never touches `referralCode` itself, so no member's Invite screen changes and
 * no WhatsApp or Play link already sent stops working. 66 of 257 live codes
 * contain a space ("EDNA SILA8717"); rewriting those would break links in the
 * wild, which is exactly why we match on a derived key instead.
 *
 * Usage (from NeoXten root):
 *   node scripts/plastypesa/referral-code-normalize-backfill.mjs           # dry run
 *   node scripts/plastypesa/referral-code-normalize-backfill.mjs --apply   # write
 *   node scripts/plastypesa/referral-code-normalize-backfill.mjs --rollback
 *
 * ROLLBACK is a full `$unset` of the derived field plus a drop of its index.
 * The API degrades gracefully to the exact match and the punctuation-tolerant
 * scan, so a rollback loses speed, not correctness.
 *
 * The script refuses to write if two members would normalise onto the same
 * key — that would let one person's link pay another, and no backfill is worth
 * that. Live audit 2026-08-04: zero collisions.
 */
import { MongoClient } from "mongodb";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const FIELD = "referralCodeNormalized";
const INDEX = "referralCodeNormalized_1";

const LIGATURES = {
  ß: "SS", æ: "AE", Æ: "AE", œ: "OE", Œ: "OE",
  ø: "O", Ø: "O", đ: "D", Đ: "D", ł: "L", Ł: "L",
};

/** Must stay byte-identical in behaviour to backend utils/common.js. */
function normalizeReferralCode(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[ßæÆœŒøØđĐłŁ]/g, (ch) => LIGATURES[ch])
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

const apply = process.argv.includes("--apply");
const rollback = process.argv.includes("--rollback");

const client = new MongoClient(loadBackendMongoEnv());

try {
  await client.connect();
  const users = client.db().collection("users");

  if (rollback) {
    if (!apply) {
      const affected = await users.countDocuments({ [FIELD]: { $exists: true } });
      console.log(`DRY RUN rollback — would $unset ${FIELD} on ${affected} docs`);
      console.log("re-run with --rollback --apply to actually roll back");
    } else {
      const res = await users.updateMany({}, { $unset: { [FIELD]: "" } });
      console.log(`rolled back: ${res.modifiedCount} docs cleared`);
      try {
        await users.dropIndex(INDEX);
        console.log(`dropped index ${INDEX}`);
      } catch {
        console.log(`index ${INDEX} not present — nothing to drop`);
      }
    }
    process.exit(0);
  }

  const rows = await users
    .find(
      { referralCode: { $nin: [null, ""] } },
      { projection: { referralCode: 1, [FIELD]: 1, ecoHandle: 1 } },
    )
    .toArray();

  const byKey = new Map();
  const empty = [];
  for (const r of rows) {
    const key = normalizeReferralCode(r.referralCode);
    if (!key) {
      empty.push(r);
      continue;
    }
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  const collisions = [...byKey.entries()].filter(([, v]) => v.length > 1);
  if (collisions.length) {
    console.error(`REFUSING TO WRITE — ${collisions.length} normalised collisions:`);
    for (const [key, v] of collisions) {
      console.error(
        `  ${key}: ${v.map((x) => `${x.ecoHandle}="${x.referralCode}"`).join(" | ")}`,
      );
    }
    process.exit(1);
  }

  const todo = rows.filter(
    (r) => r[FIELD] !== normalizeReferralCode(r.referralCode),
  );
  const spaced = rows.filter((r) => /\s/.test(r.referralCode));

  console.log(`codes on file .............. ${rows.length}`);
  console.log(`  of those, spaced ......... ${spaced.length}`);
  console.log(`  normalise to nothing ..... ${empty.length}`);
  console.log(`docs needing the field ..... ${todo.length}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply.");
    for (const r of todo.slice(0, 10)) {
      console.log(
        `  ${r.ecoHandle}: "${r.referralCode}" -> ${normalizeReferralCode(r.referralCode)}`,
      );
    }
    process.exit(0);
  }

  let written = 0;
  for (const r of todo) {
    const res = await users.updateOne(
      { _id: r._id },
      { $set: { [FIELD]: normalizeReferralCode(r.referralCode) } },
    );
    written += res.modifiedCount;
  }
  await users.createIndex({ [FIELD]: 1 }, { name: INDEX });

  const covered = await users.countDocuments({
    referralCode: { $nin: [null, ""] },
    [FIELD]: { $nin: [null, ""] },
  });
  console.log(`\nwritten .................... ${written}`);
  console.log(`index ...................... ${INDEX} ready`);
  console.log(`codes now resolvable ....... ${covered}/${rows.length}`);
} finally {
  await client.close();
}
