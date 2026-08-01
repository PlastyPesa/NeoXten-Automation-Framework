/**
 * P-ADMIN-LIVE-TRUTH Phase 2 — Daily Check claims status clarity contract.
 * Asserts live API statusCounts + admin source ships status-split hint.
 *
 *   node scripts/plastypesa/admin-claims-clarity-prove.mjs
 */
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const creds = loadAdminDashboardCredentials();
const label = process.argv[2] || "v1";

const login = await fetch(url(cfg, "/auth/admin-login"), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
if (!login.ok) {
  console.error(`[${label}] FAIL admin-login`);
  process.exit(1);
}
const { token } = await login.json();
const dc = await (
  await fetch(url(cfg, "/admin/ops/daily-check"), {
    headers: { Authorization: `Bearer ${token}` },
  })
).json();
const data = dc.data || dc;
const sc = data.rewardsOps?.statusCounts;
if (!sc || typeof sc.PROVISIONAL !== "number") {
  console.error(`[${label}] FAIL missing statusCounts`, sc);
  process.exit(1);
}

const expectedHint = `${sc.PROVISIONAL} need form · ${sc.CLAIM_SUBMITTED || 0} form in · ${sc.VERIFIED || 0} verified`;
const pagePath = join(
  process.env.PLASTYPESA_ADMIN_REPO ||
    "C:/Users/Bobby/Documents/plastypesa-admin-dashboard",
  "lib/frontend/src/pages/DailyCheck/Page.tsx"
);
if (!existsSync(pagePath)) {
  console.error(`[${label}] FAIL missing DailyCheck Page.tsx`);
  process.exit(1);
}
const src = readFileSync(pagePath, "utf8");
const hasSplit =
  src.includes("need form") &&
  src.includes("form in") &&
  src.includes("verified") &&
  src.includes("statusCounts?.PROVISIONAL") &&
  src.includes("CLAIM_SUBMITTED") &&
  src.includes("VERIFIED");

console.log(
  JSON.stringify(
    {
      label,
      statusCounts: sc,
      expectedHint,
      sourceHasStatusSplit: hasSplit,
    },
    null,
    2
  )
);

if (!hasSplit) {
  console.error(`[${label}] FAIL Page.tsx missing status-split hint`);
  process.exit(1);
}
console.error(`[${label}] PASS claims clarity`);
