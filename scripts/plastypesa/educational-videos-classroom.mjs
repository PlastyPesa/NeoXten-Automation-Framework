/**
 * P-LEARN-VIDEO-TAB — live classroom list includes How-to-Sort https clips.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import {
  loadAdminDashboardCredentials,
  loadMobileAppUserCredentials,
} from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");

async function main() {
  mkdirSync(PROOF, { recursive: true });
  const mobile = loadMobileAppUserCredentials();
  const login = await fetch(url(cfg, "/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: mobile.email, password: mobile.password }),
  });
  const loginBody = await login.json();
  const token = loginBody?.data?.token || loginBody?.token;
  if (!token) {
    console.error("LOGIN_FAILED", login.status);
    process.exit(1);
  }

  const res = await fetch(url(cfg, "/home/educational-videos?lang=en"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  const clips = body?.data?.clips;
  const okList =
    res.status === 200 &&
    Array.isArray(clips) &&
    clips.length >= 1 &&
    clips.every(
      (c) =>
        c &&
        String(c.videoUrl || "").startsWith("https://") &&
        String(c.title || "").length > 0,
    );
  const hasHowTo = Array.isArray(clips)
    ? clips.some((c) => String(c.videoUrl || "").includes("how-to-sort"))
    : false;

  const adminCreds = loadAdminDashboardCredentials();
  const adminLogin = await fetch(url(cfg, "/auth/admin-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(adminCreds),
  });
  const adminBody = await adminLogin.json();
  const adminToken = adminBody?.data?.token || adminBody?.token;
  let adminOk = false;
  if (adminToken) {
    const aRes = await fetch(url(cfg, "/admin/educational-videos"), {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const aBody = await aRes.json();
    adminOk =
      aRes.status === 200 && Array.isArray(aBody?.data?.clips || aBody?.clips);
  }

  const ok = okList && hasHowTo && adminOk;
  const out = {
    ok,
    okList,
    hasHowTo,
    adminOk,
    clipsLen: Array.isArray(clips) ? clips.length : null,
    sample: Array.isArray(clips) ? clips.slice(0, 2) : null,
    at: new Date().toISOString(),
  };
  const path = join(PROOF, `educational-videos-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!ok) process.exit(1);
  console.log("PASS", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
