/**
 * DEVICE FINGERPRINT B2 — cluster dig by hashed Advertising ID.
 *
 * Usage (from NeoXten-Automation-Framework):
 *   node scripts/plastypesa/device-fingerprint-clusters.mjs
 *   node scripts/plastypesa/device-fingerprint-clusters.mjs --min=2
 *
 * Prints ACTIVE users sharing the same lastAdvertisingIdHash (masked).
 * Needs PLASTYPESA_MONGO_URI (or local env loader used by other plastypesa scripts).
 */
import { MongoClient } from "mongodb";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const min = Number(
    (process.argv.find((a) => a.startsWith("--min=")) || "--min=2").split("=")[1]
) || 2;

function loadUri() {
    if (process.env.PLASTYPESA_MONGO_URI) return process.env.PLASTYPESA_MONGO_URI;
    const candidates = [
        resolve(__dirname, "../../.env"),
        resolve(__dirname, "../../../plastypesa-backend-api/.env"),
        resolve(__dirname, "../../../plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md"),
    ];
    for (const f of candidates) {
        if (!existsSync(f)) continue;
        const raw = readFileSync(f, "utf8");
        const m =
            raw.match(/PLASTYPESA_MONGO_URI\s*=\s*["']?([^"'\s]+)["']?/) ||
            raw.match(/MONGO_URI\s*=\s*["']?([^"'\s]+)["']?/) ||
            raw.match(/mongodb(\+srv)?:\/\/[^\s"'`]+/);
        if (m) return m[0].startsWith("mongodb") ? m[0] : m[1];
    }
    throw new Error("No PLASTYPESA_MONGO_URI — set env or .env");
}

function mask(hash) {
    const id = String(hash || "");
    if (id.length <= 10) return "***";
    return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

const uri = loadUri();
const client = new MongoClient(uri);
await client.connect();
const db = client.db();
const rows = await db
    .collection("users")
    .aggregate([
        {
            $match: {
                status: "ACTIVE",
                lastAdvertisingIdHash: { $exists: true, $nin: [null, ""] },
            },
        },
        {
            $group: {
                _id: "$lastAdvertisingIdHash",
                count: { $sum: 1 },
                ecos: { $push: "$ecoHandle" },
                emails: { $push: "$email" },
            },
        },
        { $match: { count: { $gte: min } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
    ])
    .toArray();

const withHash = await db.collection("users").countDocuments({
    status: "ACTIVE",
    lastAdvertisingIdHash: { $exists: true, $nin: [null, ""] },
});
const sessions = await db
    .collection("device_fingerprint_sessions")
    .estimatedDocumentCount()
    .catch(() => 0);

console.log(
    JSON.stringify(
        {
            activeWithHash: withHash,
            fingerprintSessionRowsApprox: sessions,
            clustersGte: min,
            clusters: rows.map((r) => ({
                fingerprint: mask(r._id),
                activeAccounts: r.count,
                ecos: (r.ecos || []).filter(Boolean).slice(0, 8),
            })),
        },
        null,
        2
    )
);
await client.close();
