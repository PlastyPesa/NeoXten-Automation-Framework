/**
 * P-PLASTY-TV-LIVE — proves the Plasty TV lane is reachable and honest.
 *
 * Owner GO 2026-08-18 turned the lane ON (`plasty-tv-enabled` + air-start).
 * This script follows the live switch:
 *
 *   OFF — 200 + enabled:false + TV_OFF + claim awards 0 (never 404/500).
 *   ON  — 200 + enabled:true + episode 1 available. Does **not** claim
 *         (that would pay the test account).
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
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-App-Platform": "android",
    "X-App-Version-Code": "80",
  };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  const findings = [];
  const check = (label, actual, expected) => {
    findings.push({ label, actual, expected, ok: actual === expected });
  };

  const seriesRes = await fetch(url(cfg, "/plasty-tv/series"), { headers });
  const seriesBody = await seriesRes.json();
  const series = seriesBody?.data ?? {};

  check("series status", seriesRes.status, 200);

  const epRes = await fetch(url(cfg, "/plasty-tv/episode/1"), { headers });
  const epBody = await epRes.json();
  const ep = epBody?.data ?? {};
  check("episode status", epRes.status, 200);

  if (series.enabled === true) {
    const available = (series.episodes || []).filter((row) => row.available);
    check("lane reports itself on", series.enabled, true);
    findings.push({
      label: "at least one episode on the series",
      actual: (series.episodes || []).length,
      expected: ">=1",
      ok: (series.episodes || []).length >= 1,
    });
    check("today has aired through episode 1", series.airedThrough, 1);
    check("next episode is 1", series.nextEpisodeNumber, 1);
    check("exactly one available episode", available.length, 1);
    check("that available episode is 1", available[0]?.episodeNumber, 1);
    check("episode 1 is open", ep.available, true);
  } else {
    check("lane reports itself off", series.enabled, false);
    findings.push({
      label: "off comes with a sentence a screen can show",
      actual: series.message || "none",
      expected: "a message",
      ok: Boolean(String(series.message || "").trim()),
    });
    check("no episodes offered while off", (series.episodes || []).length, 0);
    check("episode refused", ep.available, false);
    check("refusal names the reason", ep.code, "TV_OFF");

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
  }

  const ok = findings.every((f) => f.ok);
  const out = {
    ok,
    findings,
    series: {
      enabled: series.enabled ?? null,
      reason: series.reason ?? null,
      airedThrough: series.airedThrough ?? null,
      nextEpisodeNumber: series.nextEpisodeNumber ?? null,
      episodeCount: (series.episodes || []).length,
    },
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
