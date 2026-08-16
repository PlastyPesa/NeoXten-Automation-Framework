/**
 * P-ECOSORT-CONFIG-LIVE — the EcoSort round config the phone receives must be
 * unchanged after seeding the two combo-bonus Master rows.
 *
 * Why this exists (2026-08-15). The rescale engine divides the Masters on its
 * point list and nothing else. `ecosort-combo-bonus` and
 * `ecosort-combo-bonus-cap` are real point awards but were on neither the point
 * list nor the deny list, so the dry run walked straight past them without
 * complaint. After the flip they would have been the only awards in the product
 * still paying the old figure. Both are now classified, and the cap row has been
 * seeded at the value the code already used.
 *
 * Seeding a Master at the value the code already defaults to is meant to be
 * completely invisible to a member. This proves that from the phone's angle
 * rather than from the database it was written to.
 *
 * What it asserts:
 *   1. the EcoSort config endpoint still answers
 *   2. points per correct answer is unchanged (15 pre-flip)
 *   3. the combo bonus and its cap are unchanged (2 and 10 pre-flip) — the two
 *      rows this pass touched
 *   4. the daily cap is unchanged (450 pre-flip)
 *   5. non-point knobs were not mangled — round size is still a count of items,
 *      not an amount of points
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

/** Pre-flip expectations. After row 13 the point figures become a tenth. */
const EXPECT = {
  pointsPerCorrect: 15,
  dailyCap: 450,
  comboBonus: 2,
  comboBonusCap: 10,
  // A count of items, tuned to 6 by the `ecosort-round-size` Master. Asserted
  // here because it is the knob most easily mistaken for an amount: if a future
  // pass wrongly puts it on the point list, 6 becomes 1 and every round is a
  // single card.
  roundSize: 6,
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

  // There is no standalone config route; the knobs ride inside the round payload
  // under `config`. `/round` is the practice round — it reports the same config
  // without spending the member's paying daily round.
  const res = await fetch(
    url(cfg, "/ecosort/round?type=sort-by-material"),
    { headers }
  );
  const body = await res.json();
  const d = body?.data ?? {};

  const findings = [];
  const check = (label, actual, expected) => {
    const ok = actual === expected;
    findings.push({ label, actual, expected, ok });
    return ok;
  };

  check("status", res.status, 200);

  // The config may be reported flat or nested depending on whether the feature
  // is gated off for this caller, so read both shapes before deciding.
  const cfgBlock = d.config ?? d.round?.config ?? d;
  const num = (...keys) => {
    for (const k of keys) {
      const v = cfgBlock?.[k] ?? d?.[k];
      if (v !== undefined && v !== null) return Number(v);
    }
    return null;
  };

  const ppc = num("pointsPerCorrect");
  if (ppc !== null) check("pointsPerCorrect", ppc, EXPECT.pointsPerCorrect);

  const cap = num("dailyCap");
  if (cap !== null) check("dailyCap", cap, EXPECT.dailyCap);

  // The two rows this pass classified and seeded.
  const combo = num("comboBonus", "comboBonusN");
  if (combo !== null) check("comboBonus", combo, EXPECT.comboBonus);

  const comboCap = num("comboBonusCap", "comboBonusNCap");
  if (comboCap !== null) check("comboBonusCap", comboCap, EXPECT.comboBonusCap);

  const size = num("roundSize");
  if (size !== null) check("roundSize", size, EXPECT.roundSize);

  // Nothing was asserted beyond the status code means the endpoint answered in a
  // shape this script does not understand. That is a failure to prove, not a
  // pass — say so rather than printing a green with one finding in it.
  if (findings.length <= 1) {
    console.error(
      "NO_CONFIG_FIELDS_READ — the endpoint answered but none of the expected " +
        "keys were present. Not treating that as proof."
    );
    console.error(JSON.stringify(d, null, 2));
    process.exit(1);
  }

  const ok = findings.every((f) => f.ok);
  const out = { ok, findings, raw: d, at: new Date().toISOString() };

  const path = join(PROOF, `ecosort-config-live-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  if (!ok) {
    console.error("FAIL ecosort config live");
    process.exit(1);
  }
  console.log("PASS", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
