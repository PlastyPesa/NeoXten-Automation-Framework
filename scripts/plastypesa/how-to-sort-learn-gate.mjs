/**
 * P-HOW-TO-SORT-VIDEO — EN hosted file + sort-proof config (SW removed 2026-07-29).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");

const EN =
  "https://prod-plasty-pesa-content-imgs.s3.eu-west-2.amazonaws.com/educational-videos/how-to-sort/plastypesa-how-to-sort-en.mp4";

async function headOk(u) {
  const res = await fetch(u, { method: "HEAD" });
  return { url: u, status: res.status, ok: res.status >= 200 && res.status < 400 };
}

async function main() {
  mkdirSync(PROOF, { recursive: true });
  const enHead = await headOk(EN);

  const creds = loadMobileAppUserCredentials();
  const login = await fetch(url(cfg, "/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: creds.email,
      password: creds.password,
    }),
  });
  const loginBody = await login.json();
  const token = loginBody?.data?.token || loginBody?.token;
  if (!token) {
    console.error("LOGIN_FAILED", login.status, loginBody);
    process.exit(1);
  }

  const cfgRes = await fetch(url(cfg, "/home/sort-proof/config"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const cfgBody = await cfgRes.json();
  const data = cfgBody?.data ?? {};
  const videos = data.videos || {};
  const en = String(videos.en || "").trim();
  const sw = String(videos.sw || "").trim();
  const videoUrl = String(data.videoUrl || "").trim();

  const ok =
    enHead.ok &&
    cfgRes.status === 200 &&
    en.startsWith("https://") &&
    !sw &&
    videoUrl.startsWith("https://") &&
    videoUrl === en &&
    typeof data.learnGate === "object";

  const out = {
    ok,
    enHead,
    configStatus: cfgRes.status,
    videos: { en, sw: sw || null },
    videoUrl,
    learnGate: data.learnGate || null,
    defaultLocale: data.defaultLocale || null,
    at: new Date().toISOString(),
  };
  const path = join(PROOF, `how-to-sort-learn-gate-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!ok) {
    console.error("FAIL how-to-sort learn gate (expect EN only, no sw)");
    process.exit(1);
  }
  console.log("PASS", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
