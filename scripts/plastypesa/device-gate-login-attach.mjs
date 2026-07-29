/**
 * P-DEVICE-GATE / P-ADMIN-DEVICE-EMAIL-OPS — live Daily Check exposes device cluster arrays.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROOF = join(__dirname, "../../.neoxten/proof");

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
        console.error("LOGIN_FAILED", login.status, loginBody?.message);
        process.exit(1);
    }

    const res = await fetch(url(cfg, "/admin/ops/daily-check"), {
        headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const data = body?.data ?? body;
    const watch = data?.integrity?.signupWatch;

    const hasMulti = Array.isArray(watch?.multiAccountDevices24h);
    const hasCap = Array.isArray(watch?.devicesAtRegistrationCap);
    const hasEmail = Array.isArray(watch?.similarEmailClusters);
    const ok = res.status === 200 && hasMulti && hasCap && hasEmail;

    const out = {
        ok,
        status: res.status,
        new24h: watch?.new24h,
        multiAccountDevices24hLen: watch?.multiAccountDevices24h?.length ?? null,
        devicesAtRegistrationCapLen: watch?.devicesAtRegistrationCap?.length ?? null,
        similarEmailClustersLen: watch?.similarEmailClusters?.length ?? null,
        sampleCap: (watch?.devicesAtRegistrationCap || []).slice(0, 2),
        at: new Date().toISOString(),
    };
    const path = join(PROOF, `device-gate-clusters-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    if (!ok) {
        console.error("FAIL: signupWatch missing device/email cluster arrays");
        process.exit(1);
    }
    console.log("PASS", path);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
