/**
 * P-DESK-REJECT-MISS-LIVE — Approving a reject card must not clear the station.
 *
 * Phase 2 of the Sorting Desk permanent fix. Play 80 already paints the exam;
 * this proves the live Lambda will not pay a tap-through Approve-all.
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
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const shiftRes = await fetch(url(cfg, "/desk/shift"), { headers });
  const shiftBody = await shiftRes.json();
  const shift = shiftBody?.data ?? {};

  const findings = [];
  const check = (label, actual, expected) => {
    findings.push({ label, actual, expected, ok: actual === expected });
  };

  check("shift status", shiftRes.status, 200);
  check("desk enabled", shift.enabled !== false, true);

  let pathUsed = null;
  let submit = null;

  const station = shift.station;
  const pending = Array.isArray(station?.cards) ? station.cards : [];
  const freshStation =
    Boolean(shift.sessionId) && Boolean(station) && pending.length >= 1;

  if (freshStation) {
    pathUsed = "station";
    const answers = pending.map((c) => ({ variantKey: c.variantKey, verdict: "APPROVE" }));
    const res = await fetch(url(cfg, "/desk/station/submit"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: shift.sessionId,
        station: station.station,
        answers,
      }),
    });
    const body = await res.json();
    submit = body?.data ?? body;
    check("submit status", res.status, 200);
    check("cleared after Approve-all", submit.cleared, false);
    const missedReject = (submit.reveal || []).some(
      (r) => r.expectedVerdict === "REJECT" && r.submittedVerdict === "APPROVE" && r.correct === false
    );
    findings.push({
      label: "reveal shows a missed reject",
      actual: missedReject ? "missed reject" : "no missed reject in reveal",
      expected: "missed reject",
      ok: missedReject,
    });
  } else if (shift.shiftDone && shift.extra && shift.extra.open !== false) {
    const extraRes = await fetch(url(cfg, "/desk/extra"), { headers });
    const extraBody = await extraRes.json();
    const extra = extraBody?.data ?? {};
    check("extra status", extraRes.status, 200);
    if (extra.open && extra.roundKey && Array.isArray(extra.cards) && extra.cards.length >= 2) {
      pathUsed = "extra";
      const answers = extra.cards.map((c) => ({ variantKey: c.variantKey, verdict: "APPROVE" }));
      const res = await fetch(url(cfg, "/desk/extra/submit"), {
        method: "POST",
        headers,
        body: JSON.stringify({
          sessionId: shift.sessionId,
          roundKey: extra.roundKey,
          answers,
        }),
      });
      const body = await res.json();
      submit = body?.data ?? body;
      check("extra submit status", res.status, 200);
      check("cleared after Approve-all", submit.cleared, false);
      check("extra awarded", submit.awarded || 0, 0);
      const missedReject = (submit.reveal || []).some(
        (r) => r.expectedVerdict === "REJECT" && r.submittedVerdict === "APPROVE" && r.correct === false
      );
      findings.push({
        label: "reveal shows a missed reject",
        actual: missedReject ? "missed reject" : "no missed reject in reveal",
        expected: "missed reject",
        ok: missedReject,
      });
    } else {
      findings.push({
        label: "fresh station or extra round available",
        actual: extra.closedCode || extra.reason || "extra not open",
        expected: "fresh cards to Approve-all",
        ok: false,
      });
    }
  } else {
    findings.push({
      label: "fresh station or extra round available",
      actual: `answered=${station?.cardsAnswered ?? "n/a"} shiftDone=${Boolean(shift.shiftDone)}`,
      expected: "fresh cards to Approve-all",
      ok: false,
    });
  }

  const ok = findings.every((f) => f.ok);
  const out = {
    ok,
    pathUsed,
    findings,
    cleared: submit?.cleared ?? null,
    awarded: submit?.awarded ?? null,
    revealMisses: (submit?.reveal || [])
      .filter((r) => r.correct === false)
      .map((r) => ({
        expected: r.expectedVerdict,
        submitted: r.submittedVerdict,
        reason: r.expectedRejectReason,
      })),
    at: new Date().toISOString(),
  };

  const path = join(PROOF, `desk-reject-miss-live-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  if (!ok) {
    console.error("FAIL desk reject-miss live");
    process.exit(1);
  }
  console.log("PASS", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
