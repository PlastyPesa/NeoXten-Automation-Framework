/**
 * P-POINTS-EPOCH-LIVE — which point scale the server says it is paying in.
 *
 * Written for Phase 8b, and it is the check to run on flip morning.
 *
 * The phone remembers the last point amounts the server stated so a returning
 * member opens on a real figure instead of a guess, and it still bakes a few of
 * its own for a first-ever install. Every one of those numbers belongs to the
 * scale that was live when it was written. The ÷10 rescale makes them all ten
 * times too big at once.
 *
 * `clientConfig.pointsEpoch` is how a phone knows which scale a number it is
 * holding came from. If it is missing or stuck, phones go on trusting old
 * figures: the morning after the flip a member cold-starts on yesterday's
 * balance and watches it fall to a tenth, which reads as points being taken
 * away — on the one day they are watching hardest.
 *
 * Usage:
 *   node scripts/plastypesa/points-epoch-live.mjs          # expect scale 1 (pre-flip)
 *   node scripts/plastypesa/points-epoch-live.mjs --expect 2   # flip morning
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

const argIdx = process.argv.indexOf("--expect");
const EXPECT_EPOCH = argIdx > -1 ? Number(process.argv[argIdx + 1]) : 1;

/**
 * The awards as they stand before the flip. On flip morning re-run with
 * `--expect 2` and these become a tenth; anything that did NOT move is a
 * constant the flip could not reach.
 */
const PRE_FLIP_AWARDS = {
  sortProofPoints: 4000,
  quizCompletionPoints: 1000,
  readRewardPoints: 100,
  pledgePoints: 200,
  communityPostPoints: 100,
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

  const res = await fetch(url(cfg, "/home/earn-hub"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  const d = body?.data ?? {};
  const clientConfig = d.clientConfig ?? null;

  const findings = [];
  const check = (label, actual, expected, note) => {
    findings.push({ label, actual, expected, ok: actual === expected, note });
  };

  check("status", res.status, 200);

  // A phone that receives no epoch at all has no way to tell an old-scale
  // figure from a current one, so its absence is a failure and not a shrug.
  check(
    "clientConfig present",
    clientConfig !== null && typeof clientConfig === "object",
    true,
    "without this block the phone falls back to its own baked constants"
  );
  check(
    "pointsEpoch",
    clientConfig?.pointsEpoch,
    EXPECT_EPOCH,
    "the scale the server is quoting these awards in"
  );

  // The scale and the amounts must tell the same story. An epoch of 2 beside a
  // 4000-point sort means the counter was raised but the ledger was not divided
  // (or the other way round), and phones would be dividing correct numbers.
  const divisor = Math.pow(10, Math.max(0, (clientConfig?.pointsEpoch ?? 1) - 1));
  for (const [field, preFlip] of Object.entries(PRE_FLIP_AWARDS)) {
    if (d[field] === undefined) continue;
    const expected = divisor === 1 ? preFlip : Math.max(1, Math.round(preFlip / divisor));
    check(`${field} agrees with the stated scale`, Number(d[field]), expected);
  }

  const ok = findings.every((f) => f.ok);
  const out = {
    ok,
    expectedEpoch: EXPECT_EPOCH,
    servedEpoch: clientConfig?.pointsEpoch ?? null,
    findings,
    clientConfig,
    at: new Date().toISOString(),
  };

  const path = join(PROOF, `points-epoch-live-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  if (!ok) {
    console.error("FAIL points epoch live");
    process.exit(1);
  }
  console.log("PASS", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
