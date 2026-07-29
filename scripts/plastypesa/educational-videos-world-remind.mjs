/**
 * P-LEARN-VIDEO-TAB + P-KENYA-FIRST-WORLD-REMIND — live API×2.
 *
 * Asserts:
 * 1) GET /home/educational-videos returns published https clips
 * 2) After clearing kenyaWorldRemindAt, POST .../watched returns worldRemind.show=true for KE user
 * 3) Immediate second watched returns show=false (14d cooldown)
 *
 *   node scripts/plastypesa/educational-videos-world-remind.mjs
 *   node scripts/plastypesa/educational-videos-world-remind.mjs --pass 2
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../.neoxten/proof",
);
mkdirSync(PROOF, { recursive: true });

const passArg = process.argv.includes("--pass")
  ? process.argv[process.argv.indexOf("--pass") + 1]
  : "1";

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

function isKenya(user) {
  const cc = String(user?.countryCode || "").toUpperCase();
  const market = String(user?.market || user?.signupMarket || "").toUpperCase();
  return cc === "KE" || market === "KE" || market === "KENYA";
}

async function main() {
  const creds = loadMobileAppUserCredentials();
  const login = await api("POST", "/auth/login", {
    body: { email: creds.email, password: creds.password },
  });
  const token = login.json?.data?.token || login.json?.token;
  if (!token) {
    console.error("LOGIN_FAILED", login.status, login.json);
    process.exit(1);
  }

  const list = await api("GET", "/home/educational-videos?lang=en", { token });
  const clips = list.json?.data?.clips || [];
  const httpsClips = clips.filter(
    (c) =>
      c &&
      c.published !== false &&
      String(c.videoUrl || "").startsWith("https://"),
  );
  const listOk =
    list.status === 200 &&
    list.json?.type === "success" &&
    httpsClips.length >= 1 &&
    httpsClips.some((c) => /how.to.sort/i.test(String(c.title || c.id || "")));

  const mongoUri = loadBackendMongoEnv();
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db("plasty-pesa-prod");
  const user = await db.collection("users").findOne({ email: creds.email });
  if (!user) {
    await client.close();
    console.error("USER_NOT_FOUND", creds.email);
    process.exit(1);
  }
  const kenya = isKenya(user);
  await db.collection("users").updateOne(
    { _id: user._id },
    { $unset: { kenyaWorldRemindAt: "" } },
  );

  const watched1 = await api("POST", "/home/educational-videos/watched", {
    token,
    body: { finished: true, clipId: httpsClips[0]?.id || "how-to-sort-en" },
  });
  const remind1 = watched1.json?.data?.worldRemind || {};

  const watched2 = await api("POST", "/home/educational-videos/watched", {
    token,
    body: { finished: true, clipId: httpsClips[0]?.id || "how-to-sort-en" },
  });
  const remind2 = watched2.json?.data?.worldRemind || {};

  await client.close();

  const remindOk =
    kenya &&
    watched1.status === 200 &&
    remind1.show === true &&
    typeof remind1.message === "string" &&
    /kenya|world/i.test(remind1.message) &&
    !/collected/i.test(remind1.message) &&
    watched2.status === 200 &&
    remind2.show === false;

  const ok = listOk && remindOk;
  const out = {
    ok,
    pass: passArg,
    at: new Date().toISOString(),
    email: creds.email,
    kenya,
    listStatus: list.status,
    clipCount: clips.length,
    httpsClipCount: httpsClips.length,
    sampleTitles: httpsClips.slice(0, 3).map((c) => c.title),
    watched1: { status: watched1.status, worldRemind: remind1 },
    watched2: { status: watched2.status, worldRemind: remind2 },
    listOk,
    remindOk,
  };
  const path = join(
    PROOF,
    `educational-videos-world-remind-pass${passArg}-${Date.now()}.json`,
  );
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("proof", path);
  if (!ok) {
    console.error("FAIL educational-videos-world-remind");
    process.exit(1);
  }
  console.log("PASS educational-videos-world-remind");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
