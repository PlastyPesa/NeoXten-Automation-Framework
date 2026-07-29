/**
 * Kenya weekly cash integrity gate.
 *
 * Proves the numbers that decide M-Pesa top-10 cannot silently drift:
 *   1) Live Master point rules match Kenya UI claims
 *   2) KE market_registry ladder = 4500/2500/1600/200
 *   3) Code gates: sort default 4000, quiz award bands, vault active_daily
 *   4) API: test Kenya user weekly points = ledger recompute (CREDIT×3)
 *   5) earn-hub claims match Master
 *
 * Run from NeoXten root:
 *   npm run test:plastypesa-kenya-weekly-points
 *
 * Auth: PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL/PASSWORD
 *       or .neoxten/plastypesa-token-cache.json
 * Mongo: PLASTYPESA_MONGO_URI or backend .local/enable-sort-proof-master.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { MongoClient } = require("mongodb");

const API_BASE =
    process.env.PLASTYPESA_API_BASE ||
    "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";
const BACKEND = "C:/Users/Bobby/Documents/plastypesa-backend-api";
const NEOXTEN = path.join(__dirname, "..");

const WEEKLY_TYPES = new Set([
    "GAME_REWARD",
    "QUIZ_COMPLETION",
    "CREDIT",
    "PLEDGE",
    "SCAN_REWARD",
    "SORT_PROOF",
    "WEEKLY_REWARD",
    "STREAK_BONUS",
    "CHALLENGE_REWARD",
    "COMMUNITY_REWARD",
    "MILESTONE_REWARD",
    "READ_REWARD",
    "ECOSORT_REWARD",
    "REFERRAL",
]);
const CREDIT_MULTIPLIER = 3;

const EXPECT_MASTER = {
    "quiz-completion-points": 1000,
    "sort-proof-points": 4000,
    "max-sort-proofs-per-day": 1,
    "pledge-points": 200,
    "max-pledges-per-day": 3,
    // Base Master (boost may multiply what earn-hub shows — see checkApiKenyaUser).
    "referral-points": 1000,
    "ecosort-points-per-correct": 15,
    "ecosort-daily-cap": 450,
};

function loadMongoUri() {
    if (process.env.PLASTYPESA_MONGO_URI) return process.env.PLASTYPESA_MONGO_URI;
    const p = path.join(BACKEND, ".local/enable-sort-proof-master.js");
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

function weekStartUtc(d = new Date()) {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() - x.getUTCDay());
    x.setUTCHours(0, 0, 0, 0);
    return x;
}

function decodeJwtExp(jwt) {
    try {
        const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
        return JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8")).exp;
    } catch {
        return null;
    }
}

function loadCredsFromLocalFile() {
    const p = path.join(
        "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md"
    );
    if (!fs.existsSync(p)) return null;
    const text = fs.readFileSync(p, "utf8");
    const email = (text.match(/## Production mobile app[\s\S]*?\*\*Email:\*\*\s*(\S+)/) ||
        [])[1];
    const password = (text.match(
        /## Production mobile app[\s\S]*?\*\*Password:\*\*\s*(.+)/
    ) || [])[1];
    if (!email || !password) return null;
    return { email: email.trim(), password: password.trim() };
}

async function resolveToken() {
    if (process.env.PLASTYPESA_USER_JWT) return process.env.PLASTYPESA_USER_JWT;
    const cachePath = path.join(NEOXTEN, ".neoxten/plastypesa-token-cache.json");
    if (fs.existsSync(cachePath)) {
        try {
            const j = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            const t = j.token || j.jwt;
            const exp = decodeJwtExp(t);
            if (t && (!exp || exp > Date.now() / 1000 + 120)) return t;
        } catch {
            /* ignore */
        }
    }
    let email = process.env.PLASTYPESA_TEST_EMAIL;
    let password = process.env.PLASTYPESA_TEST_PASSWORD;
    if (!email || !password) {
        const local = loadCredsFromLocalFile();
        if (local) {
            email = local.email;
            password = local.password;
        }
    }
    if (!email || !password) {
        throw new Error(
            "No JWT/token cache/test credentials for Kenya API integrity check"
        );
    }
    const r = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const body = await r.json().catch(() => ({}));
    const token =
        body?.data?.token ||
        body?.token ||
        body?.data?.accessToken ||
        body?.data?.jwt;
    if (!token) {
        throw new Error(`Login failed HTTP ${r.status}`);
    }
    try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(
            cachePath,
            JSON.stringify(
                { token, savedAt: new Date().toISOString() },
                null,
                2
            )
        );
    } catch {
        /* ignore */
    }
    return token;
}

async function apiGet(token, rel) {
    const r = await fetch(`${API_BASE}/${rel}`, {
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
}

async function apiPost(token, rel, payload) {
    const r = await fetch(`${API_BASE}/${rel}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
}

function weightedWeekly(type, pts) {
    return type === "CREDIT" ? pts * CREDIT_MULTIPLIER : pts;
}

function checkCodeGates(rows, fails) {
    const pointRules = fs.readFileSync(
        path.join(BACKEND, "lib/lambda/backend/services/point-rules.service.js"),
        "utf8"
    );
    const sortOk = /SORT_PROOF_POINTS:\s*4000/.test(pointRules);
    rows.push({
        name: "code SORT_PROOF_POINTS default 4000",
        want: true,
        got: sortOk,
        ok: sortOk,
    });
    if (!sortOk) fails.push("SORT_PROOF_POINTS default is not 4000");

    const gameCtrl = fs.readFileSync(
        path.join(
            BACKEND,
            "lib/lambda/backend/controllers/games/game.controller.js"
        ),
        "utf8"
    );
    const quizGate =
        /awardReason:\s*"active_daily"/.test(gameCtrl) &&
        /awardReason:\s*"previous_daily"/.test(gameCtrl) &&
        /archive_blocked/.test(gameCtrl) &&
        /awardReason,/.test(gameCtrl);
    rows.push({
        name: "code quiz award bands + top-level awardReason write",
        want: true,
        got: quizGate,
        ok: quizGate,
    });
    if (!quizGate) fails.push("quiz award gate / awardReason write missing");

    const vault = fs.readFileSync(
        path.join(
            BACKEND,
            "lib/lambda/backend/controllers/bonus_quiz_vault.controller.js"
        ),
        "utf8"
    );
    const vaultOk =
        /awardReason:\s*"active_daily"/.test(vault) &&
        /getQuizCompletionPoints/.test(vault);
    rows.push({
        name: "code vault unlock requires active daily",
        want: true,
        got: vaultOk,
        ok: vaultOk,
    });
    if (!vaultOk) fails.push("vault unlock gate missing active_daily");

    const lbConst = fs.readFileSync(
        path.join(
            BACKEND,
            "lib/lambda/backend/utils/leaderboard.constants.js"
        ),
        "utf8"
    );
    const weeklyOk =
        /QUIZ_COMPLETION/.test(lbConst) &&
        /SORT_PROOF/.test(lbConst) &&
        /REFERRAL/.test(lbConst) &&
        !/LIFETIME_RECOGNITION/.test(lbConst);
    rows.push({
        name: "WEEKLY_TRANSACTION_TYPES Kenya cash set",
        want: true,
        got: weeklyOk,
        ok: weeklyOk,
    });
    if (!weeklyOk) fails.push("WEEKLY_TRANSACTION_TYPES drifted");

    const reg = fs.readFileSync(
        path.join(
            BACKEND,
            "lib/lambda/backend/services/market_registry.service.js"
        ),
        "utf8"
    );
    const keOk =
        /amount:\s*4500/.test(reg) &&
        /amount:\s*2500/.test(reg) &&
        /amount:\s*1600/.test(reg) &&
        /amount:\s*200/.test(reg) &&
        /cashEnabled:\s*true/.test(reg);
    rows.push({
        name: "KE market_registry top10 ladder + cashEnabled",
        want: true,
        got: keOk,
        ok: keOk,
    });
    if (!keOk) fails.push("KE ladder/cashEnabled missing from market_registry");

    const txnModel = fs.readFileSync(
        path.join(BACKEND, "lib/lambda/backend/models/transaction.js"),
        "utf8"
    );
    const schemaOk = /awardReason:\s*\{\s*type:\s*String/.test(txnModel);
    rows.push({
        name: "transaction schema has awardReason",
        want: true,
        got: schemaOk,
        ok: schemaOk,
    });
    if (!schemaOk) fails.push("transaction.awardReason schema field missing");
}

async function checkMasters(rows, fails) {
    const c = new MongoClient(loadMongoUri(), {
        serverSelectionTimeoutMS: 30000,
    });
    await c.connect();
    const db = c.db("plasty-pesa-prod");
    for (const [name, want] of Object.entries(EXPECT_MASTER)) {
        const doc = await db.collection("masters").findOne({ name });
        const got = masterNumber(doc, null);
        const ok = got === want;
        rows.push({ name: `master:${name}`, want, got, ok });
        if (!ok) fails.push(`${name}: want ${want}, got ${got}`);
    }
    const vaultPts = masterNumber(
        await db.collection("masters").findOne({ name: "bonus-quiz-vault-points" }),
        150
    );
    const vaultMax = masterNumber(
        await db
            .collection("masters")
            .findOne({ name: "bonus-quiz-vault-max-per-day" }),
        5
    );
    const vok = vaultPts === 150 && vaultMax === 5;
    rows.push({
        name: "master:bonus-quiz-vault (defaulted)",
        want: "150/5",
        got: `${vaultPts}/${vaultMax}`,
        ok: vok,
    });
    if (!vok) fails.push(`vault defaults drifted: ${vaultPts}/${vaultMax}`);

    // Kenya quiz truth sample: this week's QUIZ_COMPLETION with points>=900
    // should not also be labeled previous_daily in proofs when points are full.
    const ws = weekStartUtc();
    const quizTx = await db
        .collection("transactions")
        .find({
            type: "QUIZ_COMPLETION",
            status: "COMPLETED",
            createdAt: { $gte: ws },
            points: { $gte: 900 },
        })
        .project({ points: 1, awardReason: 1, proofs: 1, from: 1 })
        .limit(50)
        .toArray();
    let badFull = 0;
    for (const t of quizTx) {
        let reason = t.awardReason || "";
        if (!reason && Array.isArray(t.proofs) && t.proofs[0]) {
            try {
                reason = JSON.parse(t.proofs[0]).awardReason || "";
            } catch {
                /* ignore */
            }
        }
        if (reason === "previous_daily") badFull += 1;
    }
    rows.push({
        name: "live QUIZ_COMPLETION >=900 not previous_daily",
        want: 0,
        got: badFull,
        ok: badFull === 0,
        sampled: quizTx.length,
    });
    if (badFull) fails.push(`${badFull} full-point quiz txs marked previous_daily`);

    await c.close();
}

async function checkApiKenyaUser(rows, fails) {
    const token = await resolveToken();
    const profile = await apiGet(token, "user/my-profile");
    const p = profile.body?.data || {};
    const country = String(p.countryCode || p.country || "").toUpperCase();
    const isKe = country === "KE" || /kenya/i.test(String(p.country || ""));
    rows.push({
        name: "API test user is Kenya market",
        want: "KE",
        got: country || p.country || null,
        ok: isKe,
    });
    if (!isKe) {
        fails.push(`test user not Kenya (got ${country || p.country})`);
        return;
    }

    const earn = await apiGet(token, "home/earn-hub");
    const ed = earn.body?.data || {};
    const masterReferral = EXPECT_MASTER["referral-points"];
    const boostOn = ed.referralBoostActive === true;
    // Live hub shows boosted referral when a campaign is active (through 2026-08-11).
    const referralGot = Number(ed.referralPoints);
    const referralOk = boostOn
        ? referralGot >= masterReferral &&
          !!ed.referralBoostEndsAt &&
          Number.isFinite(referralGot)
        : referralGot === masterReferral;
    rows.push({
        name: "earn-hub.referralPoints",
        want: boostOn
            ? `>=${masterReferral} (boost active → ${referralGot})`
            : masterReferral,
        got: referralGot,
        ok: referralOk,
        boostActive: boostOn,
        boostEndsAt: ed.referralBoostEndsAt || null,
    });
    if (!referralOk) {
        fails.push(
            `earn-hub.referralPoints: boost=${boostOn} want base ${masterReferral}, got ${referralGot}`
        );
    }

    const earnChecks = [
        ["quizCompletionPoints", 1000],
        ["sortProofPoints", 4000],
        ["pledgePoints", 200],
        ["ecosortPointsPerCorrect", 15],
    ];
    for (const [key, want] of earnChecks) {
        const got = Number(ed[key]);
        const ok = got === want;
        rows.push({ name: `earn-hub.${key}`, want, got, ok });
        if (!ok) fails.push(`earn-hub.${key}: want ${want}, got ${got}`);
    }

    const mine = await apiGet(token, "market-rewards/market/mine");
    const md = mine.body?.data || mine.body || {};
    const schedule =
        md.rewardTiers?.schedule ||
        md.schedule ||
        md.market?.rewardTiers?.schedule ||
        [];
    const amounts = schedule.map((s) => Number(s.amount)).filter(Number.isFinite);
    const ladderOk =
        amounts.includes(4500) &&
        amounts.includes(2500) &&
        amounts.includes(1600) &&
        amounts.includes(200);
    rows.push({
        name: "market/mine KE ladder",
        want: "4500/2500/1600/200",
        got: amounts.slice(0, 4).join("/") || amounts.join("/"),
        ok: ladderOk,
    });
    if (!ladderOk) fails.push("market/mine missing KE cash ladder");

    const cashOn =
        md.cashEnabled === true ||
        md.market?.cashEnabled === true ||
        (md.recognitionOnly === false && ladderOk);
    rows.push({
        name: "market/mine cash path available",
        want: true,
        got: Boolean(cashOn),
        ok: Boolean(cashOn) || ladderOk,
    });

    // Ledger recompute vs profile weeklyStats
    const ws = weekStartUtc();
    let page = 1;
    const ledger = [];
    for (;;) {
        const r = await apiPost(token, "transaction/all", {
            page,
            limit: 100,
            transactionType: "all",
        });
        const data = r.body?.data;
        const batch = Array.isArray(data)
            ? data
            : data?.transactions || data?.rows || [];
        ledger.push(...batch);
        if (batch.length < 100 || page > 40) break;
        page += 1;
    }

    let weeklySum = 0;
    const perType = {};
    for (const t of ledger) {
        if (t.status && t.status !== "COMPLETED") continue;
        const type = t.type;
        if (!WEEKLY_TYPES.has(type)) continue;
        const eff = new Date(t.effectiveAt || t.createdAt);
        if (eff < ws) continue;
        const pts = Number(t.points) || 0;
        const w = weightedWeekly(type, pts);
        weeklySum += w;
        perType[type] = (perType[type] || 0) + w;
    }

    const profileWeekly = Number(p.weeklyStats?.totalPoints);
    const weeklyMatch =
        Number.isFinite(profileWeekly) && profileWeekly === weeklySum;
    rows.push({
        name: "profile weeklyStats == ledger recompute (CREDIT×3)",
        want: weeklySum,
        got: profileWeekly,
        ok: weeklyMatch,
        perType,
        weekStart: ws.toISOString(),
    });
    if (!weeklyMatch) {
        fails.push(
            `weekly mismatch profile=${profileWeekly} ledger=${weeklySum}`
        );
    }

    const home = await apiGet(
        token,
        "home/leaderboard?type=weekly&scope=global&limit=50"
    );
    const board =
        home.body?.data?.leaderboard || home.body?.data?.users || [];
    const myId = String(p._id || p.id || "");
    const me =
        board.find((u) => String(u.userId ?? u._id ?? u.id) === myId) ||
        home.body?.data?.currentUser ||
        null;
    const homePts = Number(me?.weeklyPoints ?? me?.points ?? NaN);
    const homeOk = me == null || !Number.isFinite(homePts) || homePts === weeklySum;
    rows.push({
        name: "home leaderboard weekly pts match ledger (if ranked)",
        want: weeklySum,
        got: me == null ? "(not on board)" : homePts,
        ok: homeOk,
    });
    if (!homeOk) {
        fails.push(`home leaderboard pts ${homePts} != ledger ${weeklySum}`);
    }
}

async function main() {
    const rows = [];
    const fails = [];
    checkCodeGates(rows, fails);
    await checkMasters(rows, fails);
    await checkApiKenyaUser(rows, fails);

    console.log(JSON.stringify({ rows, failCount: fails.length, fails }, null, 2));
    if (fails.length) {
        console.error("Kenya weekly points integrity: FAIL");
        process.exit(1);
    }
    console.log("Kenya weekly points integrity: PASS");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
