/**
 * Forever assert: Sort Review summary cards ≡ list totals, and send-message
 * persists REVIEWER_MESSAGE in the decision log (not a silent 200).
 *
 *   node scripts/plastypesa/sort-review-queue-sync-prove.mjs
 *   npm run test:plastypesa-sort-review-sync
 *
 * Run twice. Exit 1 on any mismatch.
 */
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

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
  console.error(`[${label}] FAIL admin-login HTTP ${login.status}`);
  process.exit(1);
}
const { token } = await login.json();
if (!token) {
  console.error(`[${label}] FAIL no token`);
  process.exit(1);
}
const h = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function listTotal(status) {
  const j = await (
    await fetch(url(cfg, `/admin/sort-proof-reviews?status=${status}&limit=50`), {
      headers: h,
    })
  ).json();
  if (j.type !== "success") {
    throw new Error(`list ${status} bad envelope`);
  }
  const pag = j.data?.pagination || {};
  const reviews = j.data?.reviews || [];
  return typeof pag.total === "number" ? pag.total : reviews.length;
}

const [openT, pendingT, flaggedT, sumRes] = await Promise.all([
  listTotal("OPEN"),
  listTotal("PENDING_REVIEW"),
  listTotal("FLAGGED"),
  fetch(url(cfg, "/admin/sort-proof-reviews/summary"), { headers: h }).then((r) =>
    r.json()
  ),
]);

if (sumRes.type !== "success") {
  console.error(`[${label}] FAIL summary envelope`, sumRes);
  process.exit(1);
}
const sc = sumRes.data?.statusCounts || {};
const pending = sc.pendingReview ?? -1;
const flagged = sc.flagged ?? -1;
const waiting = pending + flagged;

const syncOk =
  openT === waiting && pendingT === pending && flaggedT === flagged;

console.log(
  JSON.stringify(
    {
      label,
      list: { open: openT, pending: pendingT, flagged: flaggedT },
      cards: { pending, flagged, waiting },
      syncOk,
    },
    null,
    2
  )
);

if (!syncOk) {
  console.error(`[${label}] FAIL summary !== list`);
  process.exit(1);
}

// Prefer an OPEN txn for send-message; else any recent ALL row.
const openList = await (
  await fetch(url(cfg, "/admin/sort-proof-reviews?status=OPEN&limit=5"), {
    headers: h,
  })
).json();
let targetId = (openList.data?.reviews || [])[0]?._id;
if (!targetId) {
  const all = await (
    await fetch(url(cfg, "/admin/sort-proof-reviews?status=ALL&limit=5"), {
      headers: h,
    })
  ).json();
  targetId = (all.data?.reviews || [])[0]?._id;
}
if (!targetId) {
  console.error(`[${label}] FAIL no transaction to send-message`);
  process.exit(1);
}

const probe = `SORT_REVIEW_SYNC_PROVE_${label}_${Date.now()}`;
const sm = await fetch(
  url(cfg, `/admin/sort-proof-reviews/${targetId}/send-message`),
  {
    method: "POST",
    headers: h,
    body: JSON.stringify({ message: probe }),
  }
);
const smBody = await sm.json();
if (sm.status !== 200 || smBody.type !== "success") {
  console.error(`[${label}] FAIL send-message`, sm.status, smBody);
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 700));
const detail = await (
  await fetch(url(cfg, `/admin/sort-proof-reviews/${targetId}/detail`), {
    headers: { Authorization: `Bearer ${token}` },
  })
).json();
const hit = (detail.data?.decisionLog || []).some(
  (e) =>
    e.action === "REVIEWER_MESSAGE" &&
    e.details?.personalNote === probe
);

console.log(
  JSON.stringify(
    {
      label,
      sendMessage: { http: sm.status, targetId: String(targetId), probe, logHit: hit },
    },
    null,
    2
  )
);

if (!hit) {
  console.error(
    `[${label}] FAIL decision log missing REVIEWER_MESSAGE (silent drop regression)`
  );
  process.exit(1);
}

console.log(`[${label}] PASS sort-review queue sync + send-message log`);
process.exit(0);
