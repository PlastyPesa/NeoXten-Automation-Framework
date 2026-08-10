/**
 * Support phone transfer — clear soft deviceId + Advertising ID hash binding.
 *
 * Use when a real person changed phones and the old handset still blocks them
 * (DEVICE_ACCOUNT_LIMIT on soft deviceId and/or lastAdvertisingIdHash).
 *
 * Usage (from NeoXten-Automation-Framework):
 *   node scripts/plastypesa/release-phone-binding.mjs --eco=BoldRhino150 --dry-run
 *   node scripts/plastypesa/release-phone-binding.mjs --email=user@example.com --confirm
 *   node scripts/plastypesa/release-phone-binding.mjs --eco=BoldRhino150 --confirm --note="WA new phone"
 *
 * Never invent Eco Handles. Confirm with live dig before --confirm.
 */
import { MongoClient } from "mongodb";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
}
function flag(name) {
    return process.argv.includes(`--${name}`);
}

function loadUri() {
    if (process.env.PLASTYPESA_MONGO_URI) return process.env.PLASTYPESA_MONGO_URI;
    const candidates = [
        resolve(__dirname, "../../.env"),
        resolve(__dirname, "../../../plastypesa-backend-api/.env"),
        resolve(
            __dirname,
            "../../../plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md"
        ),
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

function maskEmail(email) {
    const s = String(email || "");
    const at = s.indexOf("@");
    if (at < 1) return "***";
    return `${s.slice(0, 2)}…@${s.slice(at + 1)}`;
}

function maskHash(hash) {
    const h = String(hash || "");
    if (h.length <= 10) return h ? "***" : "(none)";
    return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function maskDevice(id) {
    const s = String(id || "");
    if (!s) return "(none)";
    if (s.length <= 10) return s;
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

const eco = (arg("eco") || "").trim();
const email = (arg("email") || "").trim().toLowerCase();
const note = (arg("note") || "").trim();
const dryRun = flag("dry-run") || !flag("confirm");

if (!eco && !email) {
    console.error("Need --eco=EcoHandle or --email=user@domain");
    process.exit(1);
}

const uri = loadUri();
const client = new MongoClient(uri);
await client.connect();
const db = client.db();
const users = db.collection("users");

const query = eco
    ? { ecoHandle: eco }
    : { email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } };

const user = await users.findOne(query, {
    projection: {
        email: 1,
        ecoHandle: 1,
        status: 1,
        deviceId: 1,
        lastAdvertisingIdHash: 1,
        lastAdvertisingIdAt: 1,
        role: 1,
    },
});

if (!user) {
    console.error("No user found for", eco || email);
    await client.close();
    process.exit(2);
}

console.log(
    JSON.stringify(
        {
            mode: dryRun ? "dry-run" : "CONFIRM-WRITE",
            ecoHandle: user.ecoHandle || null,
            emailMasked: maskEmail(user.email),
            status: user.status,
            deviceIdMasked: maskDevice(user.deviceId),
            advertisingHashMasked: maskHash(user.lastAdvertisingIdHash),
            note: note || null,
        },
        null,
        2
    )
);

if (dryRun) {
    console.log(
        "\nDry-run only. Re-run with --confirm to clear deviceId + lastAdvertisingIdHash."
    );
    await client.close();
    process.exit(0);
}

const before = {
    deviceId: user.deviceId || null,
    lastAdvertisingIdHash: user.lastAdvertisingIdHash || null,
};

const result = await users.updateOne(
    { _id: user._id },
    {
        $unset: {
            deviceId: "",
            lastAdvertisingIdHash: "",
            lastAdvertisingIdAt: "",
        },
        $set: {
            phoneBindingReleasedAt: new Date(),
            phoneBindingReleaseNote: note || "support-phone-transfer",
        },
    }
);

const alertId = `phone-release-${String(user._id)}-${Date.now()}`;
let alertsColl = db.collection("masters");
let master = await alertsColl.findOne({ name: "admin-alerts" });
if (!master) {
    alertsColl = db.collection("master");
    master = await alertsColl.findOne({ name: "admin-alerts" });
}
const alerts = Array.isArray(master?.metadata?.alerts)
    ? [...master.metadata.alerts]
    : Array.isArray(master?.metadata)
      ? [...master.metadata]
      : [];
alerts.unshift({
    id: alertId,
    severity: "medium",
    title: `Phone binding released (${user.ecoHandle || maskEmail(user.email)})`,
    description:
        "Support transfer: cleared soft deviceId + Advertising ID hash so a legitimate new phone can sign in. Review if farming.",
    meta: {
        userId: String(user._id),
        ecoHandle: user.ecoHandle || "",
        emailMasked: maskEmail(user.email),
        priorDeviceMasked: maskDevice(before.deviceId),
        priorHashMasked: maskHash(before.lastAdvertisingIdHash),
        note: note || "",
        source: "release-phone-binding.mjs",
    },
    createdAt: new Date().toISOString(),
    dismissed: false,
    source: "release-phone-binding",
});
if (master) {
    await alertsColl.updateOne(
        { _id: master._id },
        { $set: { "metadata.alerts": alerts.slice(0, 200) } }
    );
} else {
    await db.collection("masters").insertOne({
        name: "admin-alerts",
        metadata: { alerts: alerts.slice(0, 200) },
    });
}

console.log(
    JSON.stringify(
        {
            ok: true,
            matched: result.matchedCount,
            modified: result.modifiedCount,
            alertId,
        },
        null,
        2
    )
);

await client.close();
