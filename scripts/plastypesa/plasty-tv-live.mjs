/**
 * P-PLASTY-TV-LIVE — proves the new Plasty TV lane is reachable, DORMANT, and honest.
 *
 * Written the day the lane shipped (2026-08-15). It ships switched off, and "off"
 * has a specific meaning that is easy to get wrong in a way nobody notices until a
 * member sees it:
 *
 *   - OFF must mean a calm `enabled: false` with a sentence a screen can show.
 *   - OFF must NOT mean 404 (route never mounted) or 500 (service throwing on a
 *     missing Master row). The Home tile reads this endpoint to decide whether to
 *     draw itself at all, so an error here paints a broken card for a feature that
 *     simply is not airing yet.
 *
 * It also proves the money door is shut: a well-formed claim against a dormant lane
 * must award nothing. That is the assertion worth having — a feature that is "off"
 * on the series screen but still pays on a direct POST is not off.
 *
 * What it asserts:
 *   1. /series answers 200 (mounted, not throwing)
 *   2. it reports the lane as not airing, with a message
 *   3. it offers no episodes while off
 *   4. an episode fetch is refused politely, not with an error status
 *   5. a claim against the dormant lane awards zero
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
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  const findings = [];
  const check = (label, actual, expected) => {
    findings.push({ label, actual, expected, ok: actual === expected });
  };

  /* 1-3 — the series screen */
  const seriesRes = await fetch(url(cfg, "/plasty-tv/series"), { headers });
  const seriesBody = await seriesRes.json();
  const series = seriesBody?.data ?? {};

  check("series status", seriesRes.status, 200);
  check("lane reports itself off", series.enabled, false);
  findings.push({
    label: "off comes with a sentence a screen can show",
    actual: series.message || "none",
    expected: "a message",
    ok: Boolean(String(series.message || "").trim()),
  });
  check("no episodes offered while off", (series.episodes || []).length, 0);

  /* 4 — an episode fetch */
  const epRes = await fetch(url(cfg, "/plasty-tv/episode/1"), { headers });
  const epBody = await epRes.json();
  const ep = epBody?.data ?? {};
  check("episode status", epRes.status, 200);
  check("episode refused", ep.available, false);
  check("refusal names the reason", ep.code, "TV_OFF");

  /* 5 — the money door */
  const claimRes = await fetch(url(cfg, "/plasty-tv/claim"), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ episodeNumber: 1 }),
  });
  const claimBody = await claimRes.json();
  const claim = claimBody?.data ?? {};
  check("claim status", claimRes.status, 200);
  check("dormant lane awards nothing", claim.awarded, 0);
  check("claim refusal names the reason", claim.code, "TV_OFF");

  const ok = findings.every((f) => f.ok);
  const out = {
    ok,
    findings,
    series: { enabled: series.enabled ?? null, reason: series.reason ?? null },
    at: new Date().toISOString(),
  };

  const path = join(PROOF, `plasty-tv-live-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  if (!ok) {
    console.error("FAIL plasty tv live");
    process.exit(1);
  }
  console.log("PASS", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
