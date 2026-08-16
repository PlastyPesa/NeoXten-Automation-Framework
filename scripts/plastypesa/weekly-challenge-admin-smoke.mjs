/**
 * Weekly challenge admin — live proof against production.
 *
 * Reads the week's config through the dashboard's own endpoint, writes the
 * "coming soon" state the owner asked for, reads it back, and opens the judging
 * queue. If this passes, a new week costs a form submit and never a Play release.
 *
 *   node scripts/plastypesa/weekly-challenge-admin-smoke.mjs
 */
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadAdminDashboardCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();

async function adminToken() {
  const login = await fetch(url(cfg, "/auth/admin-login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loadAdminDashboardCredentials()),
  });
  const body = await login.json();
  const token = body?.data?.token || body?.token;
  if (!token) throw new Error(`LOGIN_FAILED ${login.status} ${body?.message || ""}`);
  return token;
}

const token = await adminToken();
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const rows = [];
const fails = [];

const check = (name, ok, got) => {
  rows.push({ name, ok, got });
  if (!ok) fails.push(`${name} — got ${JSON.stringify(got)}`);
};

// 1. The route exists and answers. A 404 here means the deploy did not land.
const readRes = await fetch(url(cfg, "/admin/weekly-challenge"), { headers: auth });
const read = await readRes.json().catch(() => ({}));
check("GET /admin/weekly-challenge answers 200", readRes.status === 200, readRes.status);
check(
  "config carries a state the app can render",
  ["off", "coming", "open"].includes(read?.data?.config?.state),
  read?.data?.config?.state,
);

// 2. A state the app cannot draw must be refused, not stored.
const badRes = await fetch(url(cfg, "/admin/weekly-challenge"), {
  method: "PUT",
  headers: auth,
  body: JSON.stringify({ state: "live" }),
});
check("a bogus state is refused", badRes.status === 400, badRes.status);

// 3. Owner instruction 2026-08-16: the card says coming soon until he and his
//    wife pick the task. Write exactly that.
const saveRes = await fetch(url(cfg, "/admin/weekly-challenge"), {
  method: "PUT",
  headers: auth,
  body: JSON.stringify({ state: "coming" }),
});
const saved = await saveRes.json().catch(() => ({}));
check("save 'coming' accepted", saveRes.status === 200, saveRes.status);
check("saved state reads back as coming", saved?.data?.config?.state === "coming", saved?.data?.config?.state);

// 4. Second read — proves it persisted, not just echoed.
const reRead = await (await fetch(url(cfg, "/admin/weekly-challenge"), { headers: auth })).json();
check("state persisted in Mongo", reRead?.data?.config?.state === "coming", reRead?.data?.config?.state);

// 5. The judging queue opens even with no week set.
const entriesRes = await fetch(url(cfg, "/admin/weekly-challenge/entries"), { headers: auth });
const entries = await entriesRes.json().catch(() => ({}));
check("entries queue answers 200", entriesRes.status === 200, entriesRes.status);
check("entries is a list", Array.isArray(entries?.data?.entries), typeof entries?.data?.entries);

// 6. What the phone sees right now.
const phoneRes = await fetch(url(cfg, "/home/weekly-challenge"), { headers: auth });
const phone = await phoneRes.json().catch(() => ({}));
check("app endpoint answers 200", phoneRes.status === 200, phoneRes.status);
// The app reads `{ config, open, entry }` — `open` must stay false while the
// card only says "coming soon", or a member could post work nobody judges.
check("app is told 'coming'", phone?.data?.config?.state === "coming", phone?.data?.config?.state);
check("app is not accepting entries yet", phone?.data?.open === false, phone?.data?.open);

for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${JSON.stringify(r.got)})`);
console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} passed`);
if (fails.length) {
  console.error("\nFAILURES:\n" + fails.join("\n"));
  process.exit(1);
}
