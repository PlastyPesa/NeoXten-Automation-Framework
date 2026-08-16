/**
 * P-ECOSORT-DAILY-EXPIRY-LIVE — a Daily round must outlive the member's own day.
 *
 * Why this exists (2026-08-16). Daily rounds were expiring at 01:00 UTC, which
 * is 04:00 in Nairobi — inside the same earn day. A member who opened the Daily
 * after midnight was handed a round that died before breakfast, and because the
 * TTL index the schema declares does not actually exist in Atlas, the dead
 * round was never removed: it was re-served all day and submit answered 410
 * every time. Ten members were locked out on 2026-08-16 alone, fourteen across
 * three days. That is the "couldn't finish the EcoSort" complaint.
 *
 * This proves the fix from the phone's angle: log in as a real Kenya member,
 * ask for the Daily exactly as the app does, and check the deadline the server
 * hands back is past the end of that member's own day.
 *
 * Reading the Daily does not spend anything — only submitting does.
 */
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();

/** End of a Nairobi calendar day, as an instant. Nairobi is UTC+3, no DST. */
function endOfNairobiDay(dayKey) {
  return new Date(`${dayKey}T23:59:59.999+03:00`);
}

async function main() {
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

  const res = await fetch(url(cfg, "/ecosort/round/daily"), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  const d = body?.data ?? {};

  console.log("HTTP", res.status);
  console.log("roundId      ", d.roundId);
  console.log("dailyKey     ", d.dailyKey);
  console.log("challengeType", d.challengeType);
  console.log("expiresAt    ", d.expiresAt);
  console.log("playedToday  ", d.playedToday);
  console.log("items        ", (d.items || []).length);

  if (d.playedToday && !d.roundId) {
    console.log("\nSKIP — this member already submitted today, no round to inspect.");
    process.exit(0);
  }

  const findings = [];
  const check = (label, ok, detail) => {
    findings.push({ label, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  };

  console.log("");
  check("server answered", res.status === 200, `HTTP ${res.status}`);
  check("round has a deadline", Boolean(d.expiresAt), String(d.expiresAt));

  if (d.expiresAt && d.dailyKey) {
    const expires = new Date(d.expiresAt);
    const dayEnd = endOfNairobiDay(d.dailyKey);
    check(
      "deadline is past the end of the member's own day",
      expires > dayEnd,
      `${expires.toISOString()} > ${dayEnd.toISOString()}`
    );
    check(
      "deadline is in the future right now",
      expires > new Date(),
      `${Math.round((expires - Date.now()) / 3600000)}h left`
    );
  }

  check("round carries a challenge type", Boolean(d.challengeType), d.challengeType);
  check("round was dealt items", (d.items || []).length > 0, String((d.items || []).length));

  const failed = findings.filter((f) => !f.ok);
  console.log(`\n${failed.length ? "VERDICT FAIL" : "VERDICT PASS"} — ${findings.length - failed.length}/${findings.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
