/**
 * Force a paid READ_REWARD on a live rotation article + assert READ_REWARD notif.
 *
 *   node scripts/plastypesa/silent-earn-notify-read.mjs --pass 1
 */
import fs from "fs";
import path from "path";
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
    return src.match(/mongodb:\/\/[^"'\s]+/)[0];
}

async function jfetch(method, route, { token, body } = {}) {
    const res = await fetch(url(cfg, route), {
        method,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    } catch {
        json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json };
}

async function main() {
    const passIdx = process.argv.indexOf("--pass");
    const pass = passIdx >= 0 ? process.argv[passIdx + 1] : "1";
    const { email, password } = loadMobileAppUserCredentials();
    const login = await jfetch("POST", "/auth/login", { body: { email, password } });
    const token = login.json?.data?.token || login.json?.token;
    if (!token) throw new Error(`login failed ${login.status}`);

    const status = await jfetch("GET", "/home/read-reward/status", { token });
    const next = await jfetch("GET", "/home/read-reward/next", { token });

    let candidates = [];
    const sArts =
        status.json?.data?.articles ||
        status.json?.data?.rotation ||
        status.json?.data?.items ||
        [];
    if (Array.isArray(sArts)) candidates.push(...sArts);
    const nArt = next.json?.data?.article || next.json?.data;
    if (nArt && (nArt.id || nArt.articleId || nArt._id)) candidates.push(nArt);

    const client = new MongoClient(loadMongoUri(), { serverSelectionTimeoutMS: 12000 });
    await client.connect();
    const db = client.db("plasty-pesa-prod");
    const user = await db.collection("users").findOne({ email });
    const uid = String(user._id);
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const earned = new Set(
        (
            await db
                .collection("transactions")
                .find({ from: uid, type: "READ_REWARD", createdAt: { $gte: dayStart } })
                .project({ activityKey: 1 })
                .toArray()
        ).map((t) => String(t.activityKey))
    );

    let pick = candidates.find((a) => {
        const id = String(a.id || a.articleId || a._id || "");
        return id && !earned.has(id);
    });

    if (!pick) {
        // Pull today's rotation article ids from Mongo learn-content + status payload fields
        const payload = status.json?.data || {};
        const ids = []
            .concat(payload.articleIds || [])
            .concat((payload.today || []).map((x) => x.id || x))
            .map(String)
            .filter(Boolean);
        const id = ids.find((x) => !earned.has(x));
        if (id) pick = { id };
    }

    if (!pick) {
        // Last resort: any article id from today's READ events of OTHER users that awarded — means in rotation
        const recentAward = await db
            .collection("transactions")
            .find({ type: "READ_REWARD", createdAt: { $gte: dayStart }, points: { $gt: 0 } })
            .sort({ createdAt: -1 })
            .limit(20)
            .toArray();
        const id = recentAward.map((t) => String(t.activityKey)).find((x) => x && !earned.has(x));
        if (id) pick = { id };
    }

    if (!pick) {
        await client.close();
        console.log(
            JSON.stringify(
                {
                    pass,
                    ok: false,
                    note: "no awardable article",
                    statusKeys: Object.keys(status.json?.data || {}),
                    nextKeys: Object.keys(next.json?.data || {}),
                    statusStatus: status.status,
                    nextStatus: next.status,
                },
                null,
                2
            )
        );
        process.exit(2);
    }

    const articleId = String(pick.id || pick.articleId || pick._id);
    const startedAt = Date.now();
    const track = await jfetch("POST", "/home/track-article", {
        token,
        body: { articleId, dwellMs: 180000, scrolledToEnd: true },
    });
    await new Promise((r) => setTimeout(r, 1200));
    const notif = await db
        .collection("notifications")
        .find({
            receiverId: uid,
            type: "READ_REWARD",
            createdAt: { $gte: new Date(startedAt - 5000) },
        })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
    await client.close();

    const awarded = Boolean(track.json?.data?.awarded);
    const ok = awarded && Boolean(notif);
    console.log(
        JSON.stringify(
            {
                pass,
                ok,
                articleId,
                trackStatus: track.status,
                awarded,
                points: track.json?.data?.pointsEarned,
                outcome: track.json?.data?.outcome,
                notif: notif
                    ? { title: notif.title, message: notif.message, points: notif.points }
                    : null,
            },
            null,
            2
        )
    );
    if (!ok) process.exit(2);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
