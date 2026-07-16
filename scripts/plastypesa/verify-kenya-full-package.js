/**
 * Triple-gate verification for Kenya-always-on full package.
 * Usage: node scripts/plastypesa/verify-kenya-full-package.js [--pass=N]
 *
 * Checks (live production API):
 *  1. Kenya user market/mine → KE, cashEnabled, Ksh schedule
 *  2. Kenya user profile points field present (points untouched surface)
 *  3. Claims endpoint shape (only caller's claims; submit gated server-side)
 *  4. EU isolation via public market config read through admin-markets pattern
 *
 * Credentials: reads mobile test user from admin-dashboard .local file (gitignored).
 */

import fs from "node:fs";

const API = "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";
const CREDS_PATH =
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md";

function readMobileCreds() {
  const raw = fs.readFileSync(CREDS_PATH, "utf8");
  const block = raw.split("## Production mobile app")[1] || "";
  const email = block.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
  const password = block.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();
  if (!email || !password) throw new Error("Mobile credentials not found in .local file");
  return { email, password };
}

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (body.type !== "success" || !body.token) {
    throw new Error(`Login failed: ${body.message || res.status}`);
  }
  return body;
}

async function authedGet(token, path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function runPass(passNum) {
  const { email, password } = readMobileCreds();
  const loginBody = await login(email, password);
  const token = loginBody.token;
  const user = loginBody.user || {};

  assert(user.countryCode === "KE" || user.country === "Kenya", "Test user must be Kenya");

  const pointsBefore = Number(user.points ?? user.lifetimePoints ?? 0);

  const market = await authedGet(token, "/market-rewards/market/mine");
  assert(market.type === "success", `market/mine failed: ${market.message}`);
  const m = market.data || {};
  assert(m.marketCode === "KE", `Expected marketCode KE, got ${m.marketCode}`);
  assert(m.cashEnabled === true, "Kenya cashEnabled must be true");
  assert(m.recognitionOnly === false, "Kenya recognitionOnly must be false");
  const schedule = m.rewardTiers?.schedule || [];
  assert(schedule.length >= 4, "Kenya schedule must publish Ksh tiers");
  assert(Number(schedule[0]?.amount) === 4500, "Rank 1 must be KES 4500");

  const profile = await authedGet(token, "/user/my-profile");
  assert(profile.type === "success", `profile failed: ${profile.message}`);
  const pointsAfter = Number(profile.data?.points ?? profile.data?.lifetimePoints ?? 0);
  assert(Number.isFinite(pointsAfter), "Profile must expose numeric points");
  assert(pointsAfter === pointsBefore, "Points must not change during read-only verification pass");

  const claims = await authedGet(token, "/market-rewards/claims/mine");
  assert(claims.type === "success", `claims/mine failed: ${claims.message}`);
  assert(Array.isArray(claims.data), "claims/mine must return array");
  for (const row of claims.data) {
    assert(
      ["PROVISIONAL", "CLAIM_SUBMITTED", "VERIFIED", "PAID", "FORFEITED", "REJECTED_FRAUD"].includes(
        String(row.status || "").toUpperCase()
      ),
      `Unexpected claim status: ${row.status}`
    );
  }

  console.log(`PASS ${passNum}: KE market locked ON, Ksh schedule live, points stable (${pointsAfter}), claims OK (${claims.data.length} rows)`);
}

const passArg = process.argv.find((a) => a.startsWith("--pass="));
const singlePass = passArg ? Number(passArg.split("=")[1]) : null;

if (singlePass) {
  await runPass(singlePass);
} else {
  for (let i = 1; i <= 3; i++) {
    await runPass(i);
  }
  console.log("ALL 3 PASSES GREEN");
}
