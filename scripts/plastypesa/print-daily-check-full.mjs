/**
 * Full Daily Check printout (admin API shape) — what "daily check" must report.
 *   node scripts/plastypesa/print-daily-check-full.mjs
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
  console.error("LOGIN_FAILED", login.status, loginBody?.message);
  process.exit(1);
}
const r = await fetch(url(cfg, "/admin/ops/daily-check"), {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await r.json();
const d = body?.data ?? body;
if (!d?.generatedAt) {
  console.error("BAD_REPORT", r.status, JSON.stringify(body).slice(0, 400));
  process.exit(1);
}
writeFileSync(".neoxten/daily-check-full-latest.json", JSON.stringify(d, null, 2));

const line = (k, v) => console.log(`  ${k}: ${v}`);
console.log("══ DAILY CHECK (full) ══");
console.log("generatedAt:", d.generatedAt);
console.log("\n── Today's action inbox ──");
for (const a of d.actionItems || []) console.log("  •", a);

console.log("\n── Queues ──");
line("Sorts waiting", d.kpis?.sortQueue?.openTotal ?? d.trustAndUpdates?.sortQueueCockpit?.openTotal);
line("Flagged posts+comments", d.communityModeration?.openTotal);
line("Open disputes", d.disputeQueue?.openTotal);
line("Low-star reviews unanswered", d.trustAndUpdates?.reviewsAlert?.unansweredLowStar?.length);
line("Device multi-account clusters 24h", d.integrity?.signupWatch?.multiAccountDevices24h?.length);
line("Similar email clusters", d.integrity?.signupWatch?.similarEmailClusters?.length);
line("Advertising-ID hash clusters (B2)", d.integrity?.signupWatch?.advertisingIdClusters?.length);

console.log("\n── Presence (raw) ──");
line("Members", d.presence?.members);
line("Weekly active", d.presence?.weeklyActive);
line("Online now (raw)", d.presence?.onlineNow);
line("Shown to users", d.presence?.shownToUsers);

console.log("\n── Eco Guardian ──");
line("Alert active", d.ecoGuardian?.alertActive);
line("Open claims", d.ecoGuardian?.openClaims?.length);
line("Qualified without claim", d.ecoGuardian?.qualifiedWithoutClaim?.length);

console.log("\n── Inactivity pulse (earn pause) ──");
const ip = d.inactivityPulse || {};
line("Pausing switch ON", ip.killSwitch?.pausingEnabled);
line("Warnings switch ON", ip.killSwitch?.warningsEnabled);
line("Wave", ip.killSwitch?.waveFilter);
line("Rule (idle / warn) days", [ip.killSwitch?.idleDays, ip.killSwitch?.warnAfterDays].join(" / "));
line("Paused right now", ip.pausedNow);
line("Warned, not yet paused", ip.warnedAwaitingAction);
line("Paused last 24h", ip.pausedLast24h);
line("Came back last 24h", ip.restoredLast24h);
line("On 48h provisional", ip.provisionalActive);
line("Repeat-pause candidates", ip.terminateCandidates);
if (ip.note) console.log("  note:", ip.note);

console.log("\n── Retention cohorts (TRUE — not signup windows) ──");
const ret = d.retention || {};
if (ret.note) console.log("  note:", ret.note);
line("Earn day (Nairobi)", ret.earnDayKey);
line("Kenya approved sorts today", ret.daily?.kenyaApprovedSortsToday);
line("Floor vc", ret.daily?.floorVersionCode);
line("On floor / with sort / zero-sort", [
  ret.daily?.activeOnFloor,
  ret.daily?.onFloorWithApprovedSort,
  ret.daily?.onFloorZeroSort,
].join(" / "));
const d1 = ret.d1 || {};
line("D1 cohort size / returned / rate%", [d1.cohortSize, d1.returned, d1.returnRate].join(" / "));
const d7 = ret.d7 || {};
line("D7 cohort size / returned / rate%", [d7.cohortSize, d7.returned, d7.returnRate].join(" / "));
line("D7 ≥1 sort by D3 / rate%", [d7.with1SortByD3, d7.with1SortByD3Rate].join(" / "));
line("D7 ≥1 sort by D7 / rate%", [d7.with1SortByD7, d7.with1SortByD7Rate].join(" / "));
line("D7 ≥2 sorts by D7 (NORTH-STAR) / rate%", [d7.with2SortsByD7, d7.with2SortsByD7Rate].join(" / "));
const roll = ret.d7Rolling || {};
line("D7 rolling (7d matured) size / ≥2 sorts / rate%", [
  roll.cohortSize,
  roll.with2SortsByD7,
  roll.with2SortsByD7Rate,
].join(" / "));

console.log("\n── Weekly reward claims ──");
console.log(JSON.stringify(d.rewardsOps?.statusCounts || d.rewardsOps, null, 2));

console.log("\n── Play / builds ──");
const ps = d.playStore || {};
line("Live versionCode", ps.liveVersionCode ?? ps.live?.versionCode);
line("Installs 7d", ps.installs7d ?? ps.installs?.last7d);
line("On live / behind / unknown", [
  ps.appBuildInventory?.onLive ?? d.appBuildInventory?.onLive,
  ps.appBuildInventory?.behindLive ?? d.appBuildInventory?.behindLive,
  ps.appBuildInventory?.unknownBuild ?? d.appBuildInventory?.unknownBuild,
].join(" / "));

console.log("\n── Fair-play / top board (if present) ──");
const top = d.integrity?.weeklyTop10 || d.weeklyTop10 || [];
for (const row of top.slice(0, 10)) {
  console.log(
    `  #${row.rank} ${row.ecoHandle || row.eco} · ${row.weeklyPoints} pts · sorts ${row.approvedSorts ?? "?"} · ref ${row.referralSharePct ?? "?"} · build ${row.lastAppVersionCode ?? row.appBuild ?? "?"}`
  );
}

console.log("\nReport file: .neoxten/daily-check-full-latest.json");
