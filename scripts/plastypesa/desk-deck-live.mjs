/**
 * P-DESK-DECK-LIVE — the Sorting Desk now has two decks, and this proves the live
 * API still serves the household one and only its own reject vocabulary.
 *
 * Written for the eco-action deck (2026-08-15). The change is meant to be invisible:
 * the schedule Master row defaults to household sorting every day, so a member must
 * see exactly what they saw yesterday. Two ways that could have broken silently:
 *
 *   1. Week-set serving started filtering on `deckType`, and every set authored before
 *      decks existed has no such field. A filter that missed them would have emptied
 *      the live deck and shown every Kenyan member an empty Desk.
 *   2. The reject picker is now deck-scoped. If the wrong deck's list were served, the
 *      member would be offered reasons that cannot answer the photo in front of them.
 *
 * What it asserts:
 *   1. the shift endpoint still answers
 *   2. it reports the household deck
 *   3. the picker holds the household reasons
 *   4. no eco-action code has leaked into a household picker
 *   5. the deck did not empty — a shift or a stated reason for having none
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

/** Live Sort Review chips — must match `HOME_SORT_REASONS` / wife buttons. */
const HOME_SORT_CODES = [
  "BLURRY",
  "WRONG_GRADE",
  "NOT_HOUSEHOLD",
  "DUPLICATE",
  "REPOSTED",
  "TOO_FEW_ITEMS",
  "NOT_CLEAN",
  "OTHER",
];

/** Desk-only fan-fiction — must never appear on the live picker. */
const FORBIDDEN_HOME_CODES = ["NOT_SEPARATED", "MISSING_YESTERDAY"];

/** Must never appear while the schedule says household sorting. */
const ECO_ACTION_CODES = ["NOT_OUTDOORS", "LOOKS_LIKE_HOME_SORT", "UNCLEAR_OR_SPAM"];

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

  const res = await fetch(url(cfg, "/desk/shift"), { headers });
  const body = await res.json();
  const d = body?.data ?? {};

  const findings = [];
  const check = (label, actual, expected) => {
    findings.push({ label, actual, expected, ok: actual === expected });
  };

  check("status", res.status, 200);

  // The Desk self-gates while no week-set is authored, so a shift is not guaranteed.
  // Either way it must not claim a deck it cannot serve.
  const hasShift = Boolean(d.sessionId);
  findings.push({
    label: "shift served or a stated reason for none",
    actual: hasShift ? "shift" : d.reason || d.code || "none, unexplained",
    expected: "shift or explanation",
    ok: hasShift || Boolean(d.reason || d.code),
  });

  if (hasShift) {
    check("deckType", d.deckType, "home-sort");

    const served = (d.rejectReasons || []).map((r) => r.code);
    check("picker size", served.length, HOME_SORT_CODES.length);

    const missing = HOME_SORT_CODES.filter((c) => !served.includes(c));
    findings.push({
      label: "every household reason offered",
      actual: missing.length === 0 ? "all present" : `missing ${missing.join(", ")}`,
      expected: "all present",
      ok: missing.length === 0,
    });

    const leaked = served.filter((c) => ECO_ACTION_CODES.includes(c));
    findings.push({
      label: "no eco-action code in a household picker",
      actual: leaked.length === 0 ? "clean" : `leaked ${leaked.join(", ")}`,
      expected: "clean",
      ok: leaked.length === 0,
    });

    const forbidden = served.filter((c) => FORBIDDEN_HOME_CODES.includes(c));
    findings.push({
      label: "no Desk-only reasons on the live picker",
      actual: forbidden.length === 0 ? "clean" : `still teaching ${forbidden.join(", ")}`,
      expected: "clean",
      ok: forbidden.length === 0,
    });

    const unlabelled = (d.rejectReasons || []).filter((r) => !String(r.label || "").trim());
    findings.push({
      label: "every offered reason carries a label",
      actual: unlabelled.length === 0 ? "all labelled" : `${unlabelled.length} blank`,
      expected: "all labelled",
      ok: unlabelled.length === 0,
    });
  }

  const ok = findings.every((f) => f.ok);
  const out = {
    ok,
    findings,
    deckType: d.deckType ?? null,
    rejectReasons: (d.rejectReasons || []).map((r) => r.code),
    at: new Date().toISOString(),
  };

  const path = join(PROOF, `desk-deck-live-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  if (!ok) {
    console.error("FAIL desk deck live");
    process.exit(1);
  }
  console.log("PASS", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
