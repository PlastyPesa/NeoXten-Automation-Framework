/**
 * Prove admin Classroom Videos API after frontend deploy.
 *   node scripts/plastypesa/admin-educational-videos-live.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../.neoxten/proof",
);
mkdirSync(PROOF, { recursive: true });

async function main() {
  const admin = loadAdminDashboardCredentials();
  const loginRoutes = ["/auth/admin/login", "/auth/login", "/admin/auth/login"];
  let token = null;
  let loginStatus = null;
  for (const route of loginRoutes) {
    const res = await fetch(url(cfg, route), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    });
    loginStatus = res.status;
    const body = await res.json().catch(() => ({}));
    token =
      body?.data?.token ||
      body?.token ||
      body?.data?.accessToken ||
      body?.accessToken ||
      null;
    if (token) break;
  }
  if (!token) {
    console.error("ADMIN_LOGIN_FAILED", loginStatus);
    process.exit(1);
  }

  const list = await fetch(url(cfg, "/admin/educational-videos"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await list.json();
  const clips = body?.data?.clips || [];
  const ok =
    list.status === 200 &&
    body?.type === "success" &&
    clips.length >= 1 &&
    clips.every((c) => String(c.videoUrl || "").startsWith("https://"));

  const out = {
    ok,
    at: new Date().toISOString(),
    listStatus: list.status,
    clipCount: clips.length,
    titles: clips.map((c) => c.title),
  };
  const path = join(PROOF, `admin-educational-videos-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log("proof", path);
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
