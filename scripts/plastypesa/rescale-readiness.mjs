/**
 * P-RESCALE-READINESS — if we flipped tonight, what would still be paying ten times?
 *
 * The ÷10 rescale (Phase 13) divides **Master rows**. It never touches a code
 * constant, and it only visits the names written down in
 * `point_rescale.js`. Both of those facts are quiet failure modes:
 *
 *   - A new award whose Master row was never published keeps its coded default.
 *     The morning after the flip it is the one feature in the product paying ten
 *     times everything else. `plasty-tv-points` was exactly this, caught by hand
 *     on 2026-08-15 with hours to spare.
 *   - A new admin knob nobody classified is not an error anywhere. The dry run
 *     does not divide it and does not complain about it. `ecosort-combo-bonus`
 *     was that, twice over.
 *
 * Neither shows up in a unit test, because both live in the database rather than
 * in the code. So this reads production and answers one question in plain terms:
 * **what would survive the flip at the wrong scale?**
 *
 * Run it whenever an award is added, and again on the morning of the flip.
 * `points-epoch-live.mjs` is the companion — that one asks what the server is
 * paying *now*; this one asks whether the flip can reach everything it must.
 *
 * Read-only. It opens Mongo, reads `masters`, and writes nothing.
 *
 * Usage:
 *   node scripts/plastypesa/rescale-readiness.mjs
 *   npm run test:plastypesa-rescale-ready
 */
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const require = createRequire(import.meta.url);
const BACKEND_ROOT = resolve(
  process.env.PLASTYPESA_BACKEND_DIR ||
    "C:/Users/Bobby/Documents/plastypesa-backend-api",
);
const rescale = require(
  resolve(BACKEND_ROOT, "lib/lambda/backend/services/point_rescale.js"),
);

const {
  MASTER_POINT_NAMES,
  MASTER_POINT_ARRAY_NAMES,
  MASTER_POINT_STRUCTURED,
  MASTER_DENIED_NAMES,
  findUnclassifiedMasters,
} = rescale;

const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");

/**
 * Master names the flip is allowed to skip because the coded default is
 * deliberately the live source today.
 *
 * Anything here has been ruled on out loud. `eco-guardian-lifetime-points-required`
 * is the standing example: no row exists, the coded 125,000 is converted at read
 * time by `point_scale.service`, and publishing the row later is the risk the
 * manifest already names. Absent that ruling a missing row is a blocker, because
 * a missing row is indistinguishable from an award nobody remembered to seed.
 */
const MISSING_ROW_ALLOWED = new Map([
  [
    "eco-guardian-lifetime-points-required",
    "no row live; coded 125,000 is converted at read time by point_scale.service",
  ],
]);

/** Master values that are user-facing copy rather than a number. */
function copyOf(doc) {
  const md = doc?.metadata;
  const raw = Array.isArray(md) ? (md.length === 1 ? md[0] : md) : md;
  return typeof raw === "string" ? raw : null;
}

async function main() {
  mkdirSync(PROOF, { recursive: true });

  const client = new MongoClient(loadBackendMongoEnv());
  await client.connect();
  const docs = await client.db().collection("masters").find({}).toArray();
  await client.close();

  const byName = new Map(docs.map((d) => [String(d.name), d]));
  const blockers = [];
  const warnings = [];

  // ── 1. Anything numeric nobody has ruled on ────────────────────────────────
  // A live row holding a point-shaped number that is on neither list. The flip
  // walks past it in silence, which is the worst possible outcome: no error, no
  // division, and an award at ten times from the next morning.
  for (const hit of findUnclassifiedMasters(docs)) {
    blockers.push({
      kind: "UNCLASSIFIED_MASTER",
      name: hit.name,
      at: hit.at ?? "value",
      value: hit.value,
      why:
        "live Master holds a point-shaped number that is on neither the flip " +
        "list nor the deny list — the run would skip it without complaining",
      fix: "add it to MASTER_POINT_NAMES or MASTER_DENIED_NAMES in point_rescale.js",
    });
  }

  // ── 2. A named award with no row to divide ────────────────────────────────
  // The flip reaches rows, never constants. A name on the flip list with no live
  // row means the coded default (epoch 1) keeps winning after the flip.
  for (const name of MASTER_POINT_NAMES) {
    if (byName.has(name)) continue;
    const allowed = MISSING_ROW_ALLOWED.get(name);
    if (allowed) {
      warnings.push({ kind: "MISSING_ROW_RULED_OK", name, why: allowed });
      continue;
    }
    blockers.push({
      kind: "MISSING_MASTER_ROW",
      name,
      why:
        "named as a point award but no Master row exists — the flip divides " +
        "rows, so the code default would survive at ten times",
      fix: `seed the row (scripts/seed-point-masters.js) before the flip runs`,
    });
  }
  for (const name of MASTER_POINT_ARRAY_NAMES) {
    if (!byName.has(name)) {
      blockers.push({
        kind: "MISSING_MASTER_ROW",
        name,
        why: "named as a point ladder but no Master row exists",
        fix: "seed the row before the flip runs",
      });
    }
  }

  // ── 3. A name on both lists ───────────────────────────────────────────────
  // Two people editing the manifest from opposite ends. Whichever list wins is
  // an accident, and one of the two outcomes is a money field divided by ten.
  const denied = new Set(MASTER_DENIED_NAMES.map((d) => d.name));
  const flipping = new Set([
    ...MASTER_POINT_NAMES,
    ...MASTER_POINT_ARRAY_NAMES,
    ...MASTER_POINT_STRUCTURED.map((s) => s.name),
  ]);
  for (const name of flipping) {
    if (!denied.has(name)) continue;
    blockers.push({
      kind: "MANIFEST_CONTRADICTION",
      name,
      why: "listed as both flippable and denied — the outcome is whichever list is read first",
      fix: "decide once, in point_rescale.js",
    });
  }

  // ── 4. The scale counter, if it is there ──────────────────────────────────
  // Absence is fine and is the normal state today: both the backend default and
  // the runner read a missing row as epoch 1, and the run upserts it on the way
  // past. What is not fine is a row that exists and says something strange — a
  // string, a zero, or a 2 while the ledger is still undivided. Phones divide
  // their own remembered amounts by this counter, so a premature 2 shows every
  // returning member a tenth of a balance we are still paying in full.
  const epochRow = byName.get("points-scale-epoch");
  if (epochRow) {
    const md = epochRow.metadata;
    const raw = Array.isArray(md) ? md[0] : md;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      blockers.push({
        kind: "BAD_EPOCH_VALUE",
        name: "points-scale-epoch",
        value: raw,
        why:
          "the counter phones divide their cached amounts by must be a whole " +
          "number of 1 or more; anything else makes every remembered balance a guess",
        fix: "set metadata[0] to the integer scale currently being paid (1 pre-flip)",
      });
    } else {
      warnings.push({
        kind: "EPOCH_ROW_LIVE",
        name: "points-scale-epoch",
        why: `scale counter reads ${n} — the flip would raise it to ${n + 1}`,
      });
    }
  }

  // ── 5. Copy that quotes an amount ─────────────────────────────────────────
  // Not a blocker: nothing pays wrong. It is the Phase 13 content sweep list, so
  // that no member reads "earn 4,000" beside a tile that now pays 400.
  const liveAwards = new Set();
  for (const name of MASTER_POINT_NAMES) {
    const md = byName.get(name)?.metadata;
    const raw = Array.isArray(md) ? md[0] : md;
    const n = Number(raw);
    if (Number.isFinite(n) && Math.abs(n) >= 100) liveAwards.add(Math.abs(n));
  }
  for (const doc of docs) {
    const text = copyOf(doc);
    if (!text || text.length < 12) continue;
    const quoted = [...text.matchAll(/\b\d[\d,]{2,}\b/g)]
      .map((m) => Number(m[0].replace(/,/g, "")))
      .filter((n) => liveAwards.has(n));
    if (!quoted.length) continue;
    warnings.push({
      kind: "COPY_QUOTES_AN_AWARD",
      name: String(doc.name),
      amounts: [...new Set(quoted)],
      why: "user-facing copy states an award in words; the flip changes the number but not the sentence",
      fix: "rewrite in the Phase 13 content sweep, same train as the flip",
    });
  }

  const ok = blockers.length === 0;
  const out = {
    ok,
    checkedAt: new Date().toISOString(),
    liveMasters: docs.length,
    flipReaches: MASTER_POINT_NAMES.filter((n) => byName.has(n)).length,
    flipNames: MASTER_POINT_NAMES.length,
    blockers,
    warnings,
  };

  const path = join(PROOF, `rescale-readiness-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));

  console.log(
    `masters live: ${out.liveMasters} · flip reaches ${out.flipReaches}/${out.flipNames} named awards`,
  );
  for (const b of blockers) console.log(`BLOCKER ${b.kind} ${b.name}${b.at ? ` @${b.at}` : ""} — ${b.why}`);
  for (const w of warnings) console.log(`note    ${w.kind} ${w.name} — ${w.why}`);

  if (!ok) {
    console.error(`\nFAIL rescale readiness — ${blockers.length} blocker(s). ${path}`);
    process.exit(1);
  }
  console.log(`\nPASS rescale readiness ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
