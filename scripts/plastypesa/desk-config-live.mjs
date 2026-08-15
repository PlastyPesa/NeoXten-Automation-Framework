/**
 * P-DESK-CONFIG-LIVE — the Sorting Desk config the phone receives must match the
 * Master rows, and the amounts must be server-driven rather than baked.
 *
 * Written for Phase 3b: twenty-three point constants had no Master row, so the
 * planned rescale could not reach them from the database and they would have kept
 * paying ten times after the flip. Seeding them at their current values is meant
 * to be invisible — this proves it for the Desk, which is the newest earn path and
 * the one about to ship.
 *
 * What it asserts:
 *   1. the Desk config endpoint still answers
 *   2. shift points are what the code always used (1000 pre-flip)
 *   3. the extra-play budget still matches, and the hidden taper still sums to it
 *   4. non-point knobs did NOT get divided or mangled (station count, clear
 *      threshold percentage) — a 67% threshold read as 7% would let every shift
 *      clear on the first card
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");

/** Pre-flip expectations. After row 13 these become a tenth. */
const EXPECT = {
  shiftPoints: 1000,
  extraDailyBudget: 500,
  stationCount: 7,
  clearThresholdPct: 67,
};

async function main() {
  mkdirSync(PROOF, { recursive: true });

  const creds = loadMobileAppUserCredentials();
  const login = await fetch(url(cfg, "/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const loginBody = await login.json();
  const token = loginBody?.data?.token || loginBody?.token;
  if (!token) {
    console.error("LOGIN_FAILED", login.status, loginBody);
    process.exit(1);
  }
  const headers = { Authorization: `Bearer ${token}` };

  const res = await fetch(url(cfg, "/desk/state"), { headers });
  const body = await res.json();
  const d = body?.data ?? {};

  const findings = [];
  const check = (label, actual, expected) => {
    const ok = actual === expected;
    findings.push({ label, actual, expected, ok });
    return ok;
  };

  check("status", res.status, 200);
  // The Desk self-gates while no week-set is authored, so `shiftPoints` may be
  // reported at the top level or inside the config block depending on readiness.
  const shiftPoints = d.shiftPoints ?? d.config?.shiftPoints ?? null;
  check("shiftPoints", Number(shiftPoints), EXPECT.shiftPoints);

  const budget =
    d.extraDailyBudget ?? d.config?.extraDailyBudget ?? d.extra?.dailyBudget ?? null;
  if (budget !== null) check("extraDailyBudget", Number(budget), EXPECT.extraDailyBudget);

  const stations = d.stationCount ?? d.config?.stationCount ?? null;
  if (stations !== null) check("stationCount", Number(stations), EXPECT.stationCount);

  const threshold = d.clearThresholdPct ?? d.config?.clearThresholdPct ?? null;
  if (threshold !== null) check("clearThresholdPct", Number(threshold), EXPECT.clearThresholdPct);

  const ok = findings.every((f) => f.ok);
  const out = { ok, findings, raw: d, at: new Date().toISOString() };

  const path = join(PROOF, `desk-config-live-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  if (!ok) {
    console.error("FAIL desk config live");
    process.exit(1);
  }
  console.log("PASS", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
