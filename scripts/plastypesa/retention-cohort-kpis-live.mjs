/**
 * Phase 0 retention KPIs — live consumer proof (admin daily-check).
 * Asserts true cohort fields exist and are distinct from signup windows.
 *
 *   node scripts/plastypesa/retention-cohort-kpis-live.mjs
 */
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";
import { writeFileSync } from "node:fs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();

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

const r = await fetch(url(cfg, "/admin/ops/daily-check"), {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await r.json();
const d = body?.data ?? body;
if (!d?.generatedAt) {
  console.error("BAD_REPORT", r.status, JSON.stringify(body).slice(0, 300));
  process.exit(1);
}

const ret = d.retention;
const fails = [];
if (!ret || typeof ret !== "object") fails.push("retention missing");
if (!ret?.d1 || typeof ret.d1.cohortSize !== "number") fails.push("d1.cohortSize");
if (!ret?.d7 || typeof ret.d7.with2SortsByD7 !== "number") fails.push("d7.with2SortsByD7 north-star");
if (!ret?.d7Rolling || typeof ret.d7Rolling.with2SortsByD7 !== "number") fails.push("d7Rolling");
if (!ret?.daily || typeof ret.daily.kenyaApprovedSortsToday !== "number") fails.push("daily.kenyaApprovedSortsToday");
if (!ret?.note || !/cohort|north-star|not signup/i.test(ret.note)) fails.push("note must label true cohorts");
// Signup windows must still exist separately — prove we did not replace them.
if (typeof d.kpis?.users?.kenyaNew7d !== "number") fails.push("signup window kenyaNew7d still required");

writeFileSync(
  ".neoxten/retention-cohort-kpis-latest.json",
  JSON.stringify(
    {
      generatedAt: d.generatedAt,
      retention: ret,
      signupWindows: {
        kenyaNew24h: d.kpis?.users?.kenyaNew24h,
        kenyaNew7d: d.kpis?.users?.kenyaNew7d,
      },
    },
    null,
    2
  )
);

console.log("══ RETENTION COHORT LIVE ══");
console.log("generatedAt:", d.generatedAt);
console.log("D1:", JSON.stringify(ret?.d1));
console.log("D7:", JSON.stringify(ret?.d7));
console.log("D7 rolling:", JSON.stringify(ret?.d7Rolling));
console.log("daily:", JSON.stringify(ret?.daily));
console.log("signup windows (NOT retention):", d.kpis?.users?.kenyaNew24h, "/", d.kpis?.users?.kenyaNew7d);

if (fails.length) {
  console.error("FAIL", fails.join("; "));
  process.exit(1);
}
console.log("PASS — true cohort retention present; signup windows still separate");
