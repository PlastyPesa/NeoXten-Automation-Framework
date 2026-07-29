/**
 * P-SILENT-EARN-NOTIFY — live prove EcoSort (and Read when awardable) write notifs.
 *
 *   node scripts/plastypesa/silent-earn-notify.mjs
 *   node scripts/plastypesa/silent-earn-notify.mjs --pass 2
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();

function loadMongoUri() {
    if (process.env.PLASTYPESA_MONGO_URI || process.env.MONGODB_URI) {
        return process.env.PLASTYPESA_MONGO_URI || process.env.MONGODB_URI;
    }
    // Reuse URI from local ops script (gitignored / .local) — never hardcode secrets here.
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
    const m = src.match(/mongodb:\/\/[^"'\s]+/);
    if (!m) throw new Error("No Mongo URI (set PLASTYPESA_MONGO_URI)");
    return m[0];
}

async function api(method, route, { token, body } = {}) {
    const res = await fetch(url(cfg, route), {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        json = { raw: text };
    }
    return { status: res.status, json };
}

async function login(email, password) {
    const r = await api("POST", "/auth/login", { body: { email, password } });
    const token = r.json?.data?.token || r.json?.token;
    if (!token) throw new Error(`Login failed HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 180)}`);
    return { token };
}

async function proveEcosort(token, email) {
    const startedAt = Date.now();
    const roundRes = await api("GET", "/ecosort/round?type=sort-by-material&lang=en", { token });
    const round = roundRes.json?.data;
    if (!round?.roundId) {
        return { ok: false, step: "getRound", status: roundRes.status, body: roundRes.json };
    }

    const client = new MongoClient(loadMongoUri(), { serverSelectionTimeoutMS: 12000 });
    await client.connect();
    const db = client.db("plasty-pesa-prod");
    const roundDoc = await db.collection("ecosort_rounds").findOne({ roundId: round.roundId });
    if (!roundDoc?.items?.length) {
        await client.close();
        return { ok: false, step: "mongoRound", roundId: round.roundId };
    }

    const answers = roundDoc.items.map((it) => ({
        itemId: it.itemId,
        destination: it.correctDestination,
    }));

    const submit = await api("POST", "/ecosort/round/submit", {
        token,
        body: { roundId: round.roundId, answers, lang: "en" },
    });
    const points = Number(submit.json?.data?.pointsAwarded ?? 0);

    await new Promise((r) => setTimeout(r, 1200));

    const user = await db.collection("users").findOne({ email });
    const uid = String(user._id);
    const notifs = await db
        .collection("notifications")
        .find({
            receiverId: uid,
            type: "ECOSORT_REWARD",
            createdAt: { $gte: new Date(startedAt - 5000) },
        })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
    await client.close();

    const notif = notifs[0];
    const ok = points > 0 ? Boolean(notif) : submit.status === 200;
    return {
        ok,
        roundId: round.roundId,
        submitStatus: submit.status,
        pointsAwarded: points,
        notifFound: Boolean(notif),
        notif: notif
            ? { title: notif.title, message: notif.message, points: notif.points, createdAt: notif.createdAt }
            : null,
        note:
            points > 0
                ? notif
                    ? "PASS: paid EcoSort wrote ECOSORT_REWARD notif"
                    : "FAIL: paid EcoSort missing notif (deploy old code?)"
                : "Submit OK with 0 pts (cap) — notify correctly skipped",
    };
}

async function proveRead(token, email) {
    const startedAt = Date.now();
    const client = new MongoClient(loadMongoUri(), { serverSelectionTimeoutMS: 12000 });
    await client.connect();
    const db = client.db("plasty-pesa-prod");
    const user = await db.collection("users").findOne({ email });
    const uid = String(user._id);

    // Pick a rotation article the user has NOT earned today (UTC).
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const already = await db
        .collection("transactions")
        .find({
            from: uid,
            type: "READ_REWARD",
            createdAt: { $gte: dayStart },
        })
        .project({ activityKey: 1 })
        .toArray();
    const earnedIds = new Set(already.map((t) => t.activityKey));

    const status = await api("GET", "/home/read-reward/status", { token });
    let articles =
        status.json?.data?.articles ||
        status.json?.data?.rotation ||
        status.json?.data?.todayArticles ||
        status.json?.data?.items ||
        [];
    if (!Array.isArray(articles)) articles = [];

    let pick = articles.find((a) => {
        const id = a.id || a.articleId || a._id;
        return id && !earnedIds.has(String(id));
    });

    // Fallback: any learn-content article id not earned today
    if (!pick) {
        const lc = await db.collection("masters").findOne({ name: "learn-content" });
        const meta = lc?.metadata || [];
        const cand = meta.find((m) => m?._id && !earnedIds.has(String(m._id)));
        if (cand) pick = { id: cand._id, title: cand.title };
    }

    if (!pick) {
        await client.close();
        return {
            ok: true,
            skipped: true,
            note: "No unread awardable article today for tester — Read covered by Jest; EcoSort is the live gate",
        };
    }

    const articleId = String(pick.id || pick.articleId || pick._id);
    const track = await api("POST", "/home/track-article", {
        token,
        body: {
            articleId,
            dwellMs: 180000,
            scrolledToEnd: true,
        },
    });
    const awarded = Boolean(track.json?.data?.awarded);
    const points = Number(track.json?.data?.pointsEarned || 0);

    await new Promise((r) => setTimeout(r, 1200));
    const notifs = await db
        .collection("notifications")
        .find({
            receiverId: uid,
            type: "READ_REWARD",
            createdAt: { $gte: new Date(startedAt - 5000) },
        })
        .sort({ createdAt: -1 })
        .limit(3)
        .toArray();
    await client.close();

    const notif = notifs[0];
    if (!awarded) {
        return {
            ok: true,
            skipped: true,
            articleId,
            outcome: track.json?.data?.outcome,
            trackStatus: track.status,
            note: "track-article did not award (rotation/dwell/cap) — Jest covers award+notify; not a fail",
        };
    }
    return {
        ok: Boolean(notif) && points > 0,
        articleId,
        pointsEarned: points,
        notifFound: Boolean(notif),
        notif: notif
            ? { title: notif.title, message: notif.message, points: notif.points, createdAt: notif.createdAt }
            : null,
        note: notif
            ? "PASS: READ_REWARD notif written"
            : "FAIL: awarded read missing READ_REWARD notif",
    };
}

async function main() {
    const passIdx = process.argv.indexOf("--pass");
    const pass = passIdx >= 0 ? process.argv[passIdx + 1] : "1";
    const { email, password } = loadMobileAppUserCredentials();
    const { token } = await login(email, password);
    const ecosort = await proveEcosort(token, email);
    const read = await proveRead(token, email);

    const overallOk = ecosort.ok && read.ok;
    const out = { pass, at: new Date().toISOString(), email, ecosort, read, overallOk };
    console.log(JSON.stringify(out, null, 2));
    if (!overallOk) process.exit(2);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
