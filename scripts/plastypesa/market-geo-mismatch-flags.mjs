/**
 * P-MARKET-GEO-MISMATCH — Daily Check exposes kenyaGeoMismatchFlags array.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");

async function main() {
    mkdirSync(PROOF, { recursive: true });
    const login = await fetch(url(cfg, "/auth/admin-login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loadAdminDashboardCredentials()),
    });
    const loginBody = await login.json();
    const token = loginBody?.data?.token || loginBody?.token;
    if (!token) {
        console.error("LOGIN_FAILED", login.status);
        process.exit(1);
    }
    const res = await fetch(url(cfg, "/admin/ops/daily-check"), {
        headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const data = body?.data ?? body;
    const flags = data?.integrity?.kenyaGeoMismatchFlags;
    const ok = res.status === 200 && Array.isArray(flags);
    const out = {
        ok,
        status: res.status,
        flagsLen: Array.isArray(flags) ? flags.length : null,
        sample: Array.isArray(flags) ? flags.slice(0, 2) : null,
        at: new Date().toISOString(),
    };
    const path = join(PROOF, `market-geo-flags-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    if (!ok) process.exit(1);
    console.log("PASS", path);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
