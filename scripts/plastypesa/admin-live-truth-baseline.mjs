/**
 * P-ADMIN-LIVE-TRUTH Phase 1 — live API baseline for claims + sort summary.
 * Run twice. Exit 1 if envelopes fail.
 *
 *   node scripts/plastypesa/admin-live-truth-baseline.mjs
 */
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  console.error(`[${label}] FAIL admin-login ${login.status}`);
  process.exit(1);
}
const { token } = await login.json();
const h = { Authorization: `Bearer ${token}` };

const [dcRes, sumRes, openList] = await Promise.all([
  fetch(url(cfg, "/admin/ops/daily-check"), { headers: h }).then((r) => r.json()),
  fetch(url(cfg, "/admin/sort-proof-reviews/summary"), { headers: h }).then((r) =>
    r.json()
  ),
  fetch(url(cfg, "/admin/sort-proof-reviews?status=OPEN&limit=1"), {
    headers: h,
  }).then((r) => r.json()),
]);

if (dcRes.type !== "success" && !dcRes.rewardsOps && !dcRes.data) {
  console.error(`[${label}] FAIL daily-check envelope`);
  process.exit(1);
}
if (sumRes.type !== "success") {
  console.error(`[${label}] FAIL summary envelope`);
  process.exit(1);
}

const dc = dcRes.data || dcRes;
const claims = dc.rewardsOps?.statusCounts || {};
const openClaims =
  (claims.PROVISIONAL || 0) +
  (claims.CLAIM_SUBMITTED || 0) +
  (claims.VERIFIED || 0);
const sortCockpit = dc.trustAndUpdates?.sortQueueCockpit || {};
const sc = sumRes.data?.statusCounts || {};
const waitingCards = (sc.pendingReview || 0) + (sc.flagged || 0);
const listOpen =
  openList.data?.pagination?.total ??
  (openList.data?.reviews || []).length ??
  -1;

const out = {
  label,
  at: new Date().toISOString(),
  claims: {
    ...claims,
    openSum: openClaims,
    human:
      `${claims.PROVISIONAL || 0} need form · ` +
      `${claims.CLAIM_SUBMITTED || 0} form in · ` +
      `${claims.VERIFIED || 0} verified`,
  },
  dailyCheckSortsWaiting: sortCockpit.openTotal,
  sortSummary: {
    statusCounts: sc,
    waitingCards,
    throughput24h: sumRes.data?.throughput24h,
    generatedAt: sumRes.data?.generatedAt,
  },
  listOpenTotal: listOpen,
  cardsVsListOpen: waitingCards === listOpen,
};

console.log(JSON.stringify(out, null, 2));

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
mkdirSync(join(root, ".neoxten"), { recursive: true });
writeFileSync(
  join(root, ".neoxten/admin-live-truth-baseline-latest.json"),
  JSON.stringify(out, null, 2)
);

if (!out.cardsVsListOpen) {
  console.error(`[${label}] FAIL cards waiting !== list OPEN`);
  process.exit(1);
}
console.error(`[${label}] PASS baseline`);
