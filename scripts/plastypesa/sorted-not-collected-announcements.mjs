/**
 * P-COPY-SORTED-NOT-COLLECTED — prove:
 * 1) earn-hub verifiedSortsThisWeek is live
 * 2) recent impact announcements use "sorted" not "collected"
 * 3) this-week impact copy matches sort count (≈0.5kg each)
 *
 *   node scripts/plastypesa/sorted-not-collected-announcements.mjs
 *   node scripts/plastypesa/sorted-not-collected-announcements.mjs --pass 2
 */
import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const pass = process.argv.includes("--pass")
    ? process.argv[process.argv.indexOf("--pass") + 1]
    : "1";

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
    // URI may be string-concatenated across lines in the ops file.
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

async function main() {
    const { email, password } = loadMobileAppUserCredentials();
    const login = await api("POST", "/auth/login", { body: { email, password } });
    const token = login.json?.data?.token || login.json?.token;
    if (!token) throw new Error(`login failed ${login.status}`);

    const hub = await api("GET", "/home/earn-hub", { token });
    const progress =
        hub.json?.data?.communityProgress ||
        hub.json?.data?.community ||
        hub.json?.data?.progress ||
        {};
    const verified = Number(progress.verifiedSortsThisWeek);
    if (!Number.isFinite(verified) || verified < 0) {
        throw new Error(
            `earn-hub missing verifiedSortsThisWeek: ${JSON.stringify(hub.json?.data).slice(0, 400)}`
        );
    }
    const approxKg = Math.round((verified * 500) / 100) / 10;

    const client = new MongoClient(loadMongoUri(), { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const col = client.db("plasty-pesa-prod").collection("notifications");

    const collectedHits = await col.countDocuments({
        type: "ANNOUNCEMENT",
        $or: [
            { title: /\bcollected\b/i },
            { message: /\bcollected\b/i },
            { title: /\bcollecting\b/i },
            { message: /\bcollecting\b/i },
        ],
    });

    const weekImpact = await col
        .find({
            type: "ANNOUNCEMENT",
            $or: [{ title: /sorted this week/i }, { title: /Impact This Week/i }],
        })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(3)
        .project({ title: 1, message: 1 })
        .toArray();

    await client.close();

    if (collectedHits > 0) {
        throw new Error(`ANNOUNCEMENT rows still contain collected/collecting: ${collectedHits}`);
    }

    const sample = weekImpact[0];
    if (sample) {
        const blob = `${sample.title || ""} ${sample.message || ""}`;
        if (/\bcollected\b/i.test(blob)) {
            throw new Error(`week impact sample still says collected: ${blob.slice(0, 160)}`);
        }
        // Synced copy should mention exact sort count when sorts > 0
        if (verified > 0 && !blob.includes(String(verified))) {
            throw new Error(
                `week impact sample missing verifiedSortsThisWeek=${verified}: ${blob.slice(0, 200)}`
            );
        }
        if (verified > 0 && !blob.includes(String(approxKg))) {
            throw new Error(
                `week impact sample missing approxKg=${approxKg}: ${blob.slice(0, 200)}`
            );
        }
    }

    console.log(
        JSON.stringify(
            {
                ok: true,
                pass,
                verifiedSortsThisWeek: verified,
                approxKgSortedThisWeek: approxKg,
                collectedHits: 0,
                weekImpactSample: sample
                    ? { title: sample.title, message: String(sample.message || "").slice(0, 220) }
                    : null,
            },
            null,
            2
        )
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
