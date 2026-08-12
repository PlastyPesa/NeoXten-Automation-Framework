/**
 * Live smoke: mid-session JWT refuses SUSPENDED (Phase 1).
 *   node scripts/plastypesa/jwt-suspended-mid-session-live.mjs
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";

bootstrapPlastyPesaEnv();
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const jwt = require(
  resolve(
    __dirname,
    "../../../plastypesa-backend-api/lib/lambda/backend/node_modules/jsonwebtoken"
  )
);

function loadUri() {
  if (process.env.PLASTYPESA_MONGO_URI) return process.env.PLASTYPESA_MONGO_URI;
  const candidates = [
    resolve(__dirname, "../../.env"),
    resolve(__dirname, "../../../plastypesa-backend-api/.env"),
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
  throw new Error("No mongo URI");
}

function loadJwtSecret() {
  if ((process.env.JWT_SECRET || "").trim()) return process.env.JWT_SECRET.trim();
  if ((process.env.PLASTYPESA_JWT_SECRET || "").trim()) {
    return process.env.PLASTYPESA_JWT_SECRET.trim();
  }
  const candidates = [
    resolve(__dirname, "../../.env"),
    resolve(__dirname, "../../.env.plastypesa"),
    resolve(__dirname, "../../../plastypesa-backend-api/.env"),
    resolve(
      process.env.USERPROFILE || "",
      "Documents/plastypesa-admin-dashboard/ALL CREDENTIALS FOR PLASTYPESA 15-03-2026/new JWT secret created on 15032026.txt"
    ),
  ];
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    const raw = readFileSync(f, "utf8");
    const m =
      raw.match(/PLASTYPESA_JWT_SECRET\s*=\s*["']?([^"'\r\n]+)["']?/) ||
      raw.match(/JWT_SECRET\s*=\s*["']?([^"'\r\n]+)["']?/);
    if (m?.[1]) return m[1].trim();
    // bare secret file
    const line = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && !l.includes("="));
    if (line && line.length > 16) return line;
  }
  return null;
}

const secret = loadJwtSecret();
const mongoUri = loadUri();
if (!secret) {
  console.error("NEED_JWT_SECRET");
  process.exit(1);
}

const cfg = getConfig();
const client = new MongoClient(mongoUri);
await client.connect();
const suspended = await client.db().collection("users").findOne(
  {
    status: "SUSPENDED",
    role: { $nin: ["admin"] },
    staffDisabled: { $ne: true },
  },
  { projection: { _id: 1, ecoHandle: 1, suspensionReason: 1 } }
);
if (!suspended) {
  console.error("NO_SUSPENDED_USER");
  await client.close();
  process.exit(1);
}

const token = jwt.sign(
  { id: String(suspended._id), role: "user" },
  secret,
  { expiresIn: "10m" }
);
const r = await fetch(url(cfg, "/home/earn-hub"), {
  headers: {
    Authorization: `Bearer ${token}`,
    "X-App-Platform": "android",
    "X-App-Version-Code": "77",
  },
});
const body = await r.json().catch(() => ({}));
await client.close();

console.log("══ JWT SUSPENDED MID-SESSION LIVE ══");
console.log("eco:", suspended.ecoHandle || "(none)");
console.log("reason:", suspended.suspensionReason);
console.log("status:", r.status);
console.log("code:", body?.code);

if (r.status !== 403 || body?.code !== "account_suspended") {
  console.error("FAIL", JSON.stringify(body).slice(0, 300));
  process.exit(1);
}
console.log("PASS — mid-session JWT refuses SUSPENDED");
