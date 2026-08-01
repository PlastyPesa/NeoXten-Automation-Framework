/**
 * Prove GET /home/sort-proof/latest clears prior-day APPROVED when slot open.
 * Prefer DENNIS_EMAIL/DENNIS_PASSWORD env; else uses mobile test credentials
 * if that account also has a prior-day approval.
 */
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";
import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";

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
        "ops-dennis-sort-latest.js"
    );
    const src = fs.readFileSync(ops, "utf8");
    const parts = [...src.matchAll(/"(mongodb:\/\/[^"]+|ac-[^"]+)"/g)].map((m) =>
        m[1]
    );
    if (parts.length) return parts.join("");
    throw new Error("No Mongo URI");
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
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

async function login(email, password) {
    const r = await api("POST", "/auth/login", { body: { email, password } });
    const token = r.json?.data?.token || r.json?.token;
    if (!token) throw new Error(`login failed ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    return token;
}

async function main() {
    const passLabel = process.argv.includes("--pass")
        ? process.argv[process.argv.indexOf("--pass") + 1]
        : "1";

    let email = process.env.DENNIS_EMAIL || process.env.PLASTYPESA_DENNIS_EMAIL;
    let password =
        process.env.DENNIS_PASSWORD || process.env.PLASTYPESA_DENNIS_PASSWORD;
    let who = "dennis-env";
    if (!email || !password) {
        const m = loadMobileAppUserCredentials();
        email = m.email;
        password = m.password;
        who = "mobile-test";
    }

    const token = await login(email, password);
    const latest = await api("GET", "/home/sort-proof/latest", { token });
    const conf = await api("GET", "/home/sort-proof/config", { token });

    const client = new MongoClient(loadMongoUri(), { serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const db = client.db("plasty-pesa-prod");
    const user = await db.collection("users").findOne({ email });
    const uid = String(user._id);
    const last = await db
        .collection("transactions")
        .find({ from: uid, type: "SORT_PROOF" })
        .sort({ createdAt: -1 })
        .limit(1)
        .project({ status: 1, reviewStatus: 1, createdAt: 1, points: 1 })
        .next();
    await client.close();

    const data = latest.json?.data;
    const remaining = conf.json?.data?.remainingToday;
    const canSubmit = conf.json?.data?.canSubmitToday;
    const lastIsPriorApproved =
        last &&
        last.status === "COMPLETED" &&
        (last.reviewStatus === "APPROVED" || last.reviewStatus === "AUTO_APPROVED") &&
        new Date(last.createdAt) < new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

    const ok =
        latest.status === 200 &&
        latest.json?.type === "success" &&
        (lastIsPriorApproved && canSubmit
            ? data == null
            : true);

    console.log(
        JSON.stringify(
            {
                ok,
                pass: passLabel,
                who,
                email,
                remainingToday: remaining,
                canSubmitToday: canSubmit,
                mongoLatest: last
                    ? {
                          status: last.status,
                          reviewStatus: last.reviewStatus,
                          createdAt: last.createdAt,
                          points: last.points,
                          priorDayApproved: lastIsPriorApproved,
                      }
                    : null,
                apiLatestData: data,
            },
            null,
            2
        )
    );
    if (!ok) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
