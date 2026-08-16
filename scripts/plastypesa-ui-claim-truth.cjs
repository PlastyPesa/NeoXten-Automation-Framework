/**
 * NeoXten gate: live Master / market numbers that the mobile UI claims.
 * Fails if production Master drifts from the documented UI truth table.
 *
 * Run: node scripts/plastypesa-ui-claim-truth.js
 * Optional: PLASTYPESA_MONGO_URI env, else reads backend .local enable-sort-proof-master.js
 */
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const vm = require("vm");

function loadUri() {
    if (process.env.PLASTYPESA_MONGO_URI) return process.env.PLASTYPESA_MONGO_URI;
    const p = path.join(
        "C:/Users/Bobby/Documents/plastypesa-backend-api/.local/enable-sort-proof-master.js"
    );
    const src = fs.readFileSync(p, "utf8");
    return vm.runInNewContext(
        src.match(/const DIRECT_URI\s*=\s*([\s\S]*?);[\r\n]/)[1],
        {}
    );
}

function masterNumber(doc, fallback) {
    if (!doc) return fallback;
    const meta = doc.metadata;
    if (Array.isArray(meta) && meta.length) {
        const n = Number(meta[0]);
        if (Number.isFinite(n)) return n;
    }
    return fallback;
}

async function main() {
    const c = new MongoClient(loadUri(), { serverSelectionTimeoutMS: 30000 });
    await c.connect();
    const db = c.db("plasty-pesa-prod");
    const get = (name) => db.collection("masters").findOne({ name });

    const expect = {
        "quiz-completion-points": 1000,
        "sort-proof-points": 4000, // live Master + code default (Kenya cash truth)
        "max-sort-proofs-per-day": 1,
        "pledge-points": 200,
        "max-pledges-per-day": 3,
        // Base Master. The earn hub can print more than this while a boost
        // campaign is live — that is the boost, not a mismatch.
        "referral-points": 1000,
        "ecosort-points-per-correct": 15,
        "ecosort-daily-cap": 450,
        "signup-bonus-points": 1000,
    };

    const fails = [];
    const rows = [];
    for (const [name, want] of Object.entries(expect)) {
        const doc = await get(name);
        const got = masterNumber(doc, null);
        const ok = got === want;
        rows.push({ name, want, got, ok });
        if (!ok) fails.push(`${name}: want ${want}, got ${got}`);
    }

    // Vault: missing Master → defaults 150/5 must remain the documented UI truth
    const vaultPts = masterNumber(await get("bonus-quiz-vault-points"), 150);
    const vaultMax = masterNumber(await get("bonus-quiz-vault-max-per-day"), 5);
    rows.push({
        name: "bonus-quiz-vault (defaulted)",
        want: "150/5",
        got: `${vaultPts}/${vaultMax}`,
        ok: vaultPts === 150 && vaultMax === 5,
    });
    if (vaultPts !== 150 || vaultMax !== 5) {
        fails.push(`vault defaults drifted: ${vaultPts}/${vaultMax}`);
    }

    // KE weekly ladder. Owner cut over to ladder B on Mon 17 Aug Nairobi:
    // 2600 / 1500 / 1000 / 700x7, same 10 000 pot. Ladder A (4500 / 2500 /
    // 1600 / 200) is retired and must not still be sitting in the registry.
    const regPath = path.join(
        "C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/services/market_registry.service.js"
    );
    const reg = fs.readFileSync(regPath, "utf8");
    const ladderB =
        /amount:\s*2600/.test(reg) &&
        /amount:\s*1500/.test(reg) &&
        /amount:\s*1000/.test(reg) &&
        /amount:\s*700/.test(reg);
    const ladderAGone = !/amount:\s*4500/.test(reg) && !/amount:\s*2500/.test(reg);
    rows.push({ name: "KE market_registry ladder B live", want: true, got: ladderB, ok: ladderB });
    rows.push({ name: "KE market_registry ladder A retired", want: true, got: ladderAGone, ok: ladderAGone });
    if (!ladderB) fails.push("KE ladder B (2600/1500/1000/700) missing from market_registry.service.js");
    if (!ladderAGone) fails.push("retired KE ladder A (4500/2500) still present in market_registry.service.js");

    console.log(JSON.stringify({ rows, failCount: fails.length, fails }, null, 2));
    await c.close();
    if (fails.length) process.exit(1);
    console.log("UI claim truth gate: PASS");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
