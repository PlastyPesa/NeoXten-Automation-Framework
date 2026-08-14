/**
 * P-WEEKLY-CLOSE-AUTO + P-AAB-WEEKLY-CONTINUITY (2026-07-26) — weekly close
 * integrity regression.
 *
 * Read-only assertions against the production close/claims state:
 *   1. At most ONE non-VOID close per (marketCode, weekStart) — the partial
 *      unique index invariant that keeps EventBridge retries from
 *      double-creating closes (and therefore double-creating claim forms).
 *   2. weekStart 2026-07-19 is the one-time EXTENDED CUTOVER WEEK
 *      (Jul 19 → Jul 27; owner cutover lock 2026-07-26). The two superseded
 *      Sunday-labeled snapshots (pre-clamp + re-snapshot) are VOID. Any live
 *      close for that weekStart must be the auto job's extended-week close:
 *      weekEnd Jul 26 23:59:59.999 UTC, passing evidence, and ZERO claims
 *      while it is still DRAFT. After the Mon Jul 27 00:02 UTC auto run
 *      (auto-confirm ON — owner lock ~16:20) the close should be CONFIRMED
 *      with one PROVISIONAL claim per winner slot.
 *   3. Any live close created from the cutover onward carries the
 *      machine-checkable evidence artifact with a PASSING dual recompute.
 *   4. Live KE market config has weeklyCloseAutoConfirm === true (owner lock
 *      2026-07-26 ~16:20: forms create automatically on evidence pass; the
 *      only remaining manual step is the M-Pesa payout).
 *   5. P-CLAIM-CASCADE-ONE-HOP invariants (Fable Verdict 3, 2026-07-26):
 *      a dead claim (FORFEITED / REJECTED_FRAUD) has at most ONE inherited
 *      child; a child is never itself a parent (one hop total); the child
 *      keeps the dead slot + tier amount + weekStart; no user holds two
 *      claims for one close; at most one LIVE claim per (closeId, slot)
 *      so a slot can never be double-paid.
 *
 * Needs an admin token: PLASTYPESA_ADMIN_JWT, or the admin-dashboard
 * credentials from the local credential registry (skips without either).
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'close-integrity';

const JUL19_WEEK_START = '2026-07-19T00:00:00.000Z';
const EXTENDED_WEEK_END = '2026-07-26T23:59:59.999Z'; // weekEndExclusive Jul 27 00:00
const EVIDENCE_REQUIRED_FROM_MS = Date.UTC(2026, 6, 26, 15, 0, 0); // cutover deploy instant

async function resolveAdminHeaders(cfg) {
  const injected = (process.env.PLASTYPESA_ADMIN_JWT || '').trim();
  if (injected) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${injected}` };
  }
  try {
    const { loadAdminDashboardCredentials } = await import('../credential-registry.mjs');
    const credentials = loadAdminDashboardCredentials();
    const r = await fetch(url(cfg, '/auth/admin-login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!r.ok) return null;
    const body = await r.json().catch(() => null);
    const token = body?.data?.token || body?.token;
    if (!token) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  } catch {
    return null;
  }
}

export async function run(cfg, runner) {
  const adminHeaders = await resolveAdminHeaders(cfg);
  if (!adminHeaders) {
    runner.skip(
      'close_integrity',
      'No admin token — set PLASTYPESA_ADMIN_JWT or provide admin-dashboard credentials',
    );
    return;
  }

  await runner.test('ke_auto_confirm_flag_live', async () => {
    const r = await fetch(url(cfg, '/market-rewards/admin/markets'), {
      headers: adminHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`admin markets ${r.status}: ${text.slice(0, 300)}`);
    }
    const markets = Array.isArray(body?.data) ? body.data : [];
    const ke = markets.find((m) => m.marketCode === 'KE');
    assert(ke, 'KE market config present');
    assert(
      ke.weeklyCloseAutoConfirm === true,
      `KE weeklyCloseAutoConfirm must be true (owner lock 2026-07-26 ~16:20), got ${JSON.stringify(ke.weeklyCloseAutoConfirm)}`,
    );
  });

  let closes = [];
  await runner.test('admin_close_list_readable', async () => {
    const r = await fetch(url(cfg, '/market-rewards/admin/close'), {
      headers: adminHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`admin close list ${r.status}: ${text.slice(0, 300)}`);
    }
    closes = Array.isArray(body?.data) ? body.data : [];
    assert(closes.length > 0, 'at least one close exists');
  });

  await runner.test('one_live_close_per_market_week', async () => {
    const seen = new Map();
    for (const close of closes) {
      if (close.status === 'VOID') continue;
      const key = `${close.marketCode}:${new Date(close.weekStart).toISOString()}`;
      assert(
        !seen.has(key),
        `duplicate non-VOID close for ${key} (ids ${seen.get(key)} and ${close._id}) — retry-storm invariant broken`,
      );
      seen.set(key, String(close._id));
    }
  });

  await runner.test('jul19_extended_cutover_week_close_state', async () => {
    const jul19 = closes.filter(
      (c) =>
        c.marketCode === 'KE' &&
        new Date(c.weekStart).toISOString() === JUL19_WEEK_START &&
        c.status !== 'VOID',
    );
    assert(
      jul19.length <= 1,
      `at most one live KE close for the cutover week (got ${jul19.length})`,
    );
    if (jul19.length === 0) {
      // Before the Mon Jul 27 00:02 UTC auto run: both superseded Sunday
      // snapshots are VOID and the extended-week close doesn't exist yet.
      return;
    }
    const close = jul19[0];
    assert(
      new Date(close.weekEnd).toISOString() === EXTENDED_WEEK_END,
      `live Jul 19 close must be the EXTENDED week (weekEnd ${EXTENDED_WEEK_END}, got ${new Date(close.weekEnd).toISOString()}) — a Sunday-labeled Jul 19–25 snapshot must stay VOID`,
    );
    assert(
      close.evidence && close.evidence.recompute && close.evidence.recompute.match === true,
      `extended cutover close ${close._id} must carry PASSING evidence (auto job artifact)`,
    );
    const r = await fetch(
      url(cfg, `/market-rewards/admin/claims?closeId=${close._id}`),
      { headers: adminHeaders },
    );
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`admin claims list ${r.status}: ${text.slice(0, 300)}`);
    }
    const claims = Array.isArray(body?.data) ? body.data : [];
    if (close.status === 'DRAFT') {
      assert(
        claims.length === 0,
        `DRAFT cutover close must have ZERO claims before Confirm (got ${claims.length})`,
      );
    } else if (close.status === 'CONFIRMED') {
      // Auto-confirm creates one claim per winner slot. A slot can then accumulate
      // MORE claim rows over time, legitimately: the one-hop cascade (locked
      // 2026-07-26) passes a dead reward to the next frozen-eligible member, and
      // the dead claim is kept as an audit record. `reward_claims` enforces this
      // shape with a partial unique index on (closeId, slot) over LIVE statuses
      // only, for exactly that reason.
      //
      // So a raw count of claims against winner slots is not an invariant. It was
      // written before the cascade existed and went red on 19 Jul for a benign
      // reason: slots 7 and 8 forfeited, cascaded to BrightRaven163 and
      // FrostCobra592, and those forfeited too — 12 rows for 10 slots, KES 0
      // moved on the extras.
      //
      // Worse, the old count could not tell that apart from the emergency. Twelve
      // rows where two are PAID duplicates produces the identical message. So
      // assert what actually matters instead: one LIVE claim per slot, and no slot
      // paid twice.
      const winnerCount = Array.isArray(close.winners) ? close.winners.length : 0;
      assert(winnerCount > 0, 'CONFIRMED close must carry winner slots');

      const DEAD = new Set(['FORFEITED', 'REJECTED_FRAUD']);
      const live = claims.filter((c) => !DEAD.has(String(c.status)));

      const liveBySlot = new Map();
      for (const c of live) {
        const slot = Number(c.slot);
        liveBySlot.set(slot, (liveBySlot.get(slot) || 0) + 1);
      }
      const doubleLive = [...liveBySlot.entries()].filter(([, n]) => n > 1);
      assert(
        doubleLive.length === 0,
        `a slot can never hold two live claims — slots ${doubleLive
          .map(([s, n]) => `${s}(${n})`)
          .join(', ')}. Either the confirm job ran twice or a cascade issued a replacement while the original was still alive.`,
      );

      // The money rule, stated directly: nobody is paid twice for one slot.
      const paidBySlot = new Map();
      for (const c of claims.filter((c) => String(c.status) === 'PAID')) {
        const slot = Number(c.slot);
        paidBySlot.set(slot, (paidBySlot.get(slot) || 0) + 1);
      }
      const doublePaid = [...paidBySlot.entries()].filter(([, n]) => n > 1);
      assert(
        doublePaid.length === 0,
        `DOUBLE PAYMENT: slot(s) ${doublePaid
          .map(([s, n]) => `${s} paid ${n}x`)
          .join(', ')} on close ${close._id} — real cash left twice for one reward`,
      );

      // Every slot must have been offered to somebody. A slot with no claim row
      // at all means a winner was never told they won.
      const slotsSeen = new Set(claims.map((c) => Number(c.slot)));
      const missing = [];
      for (let s = 1; s <= winnerCount; s += 1) if (!slotsSeen.has(s)) missing.push(s);
      assert(
        missing.length === 0,
        `slot(s) ${missing.join(', ')} have no claim at all — those winners were never offered their reward`,
      );

      // Cash out can never exceed the pot the close itself declared.
      const pot = (close.winners || []).reduce(
        (n, w) => n + (Number(w.grossAmount ?? w.amount) || 0),
        0,
      );
      const paidOut = claims
        .filter((c) => String(c.status) === 'PAID')
        .reduce((n, c) => n + (Number(c.grossAmount ?? c.amount) || 0), 0);
      assert(
        pot === 0 || paidOut <= pot,
        `paid out ${paidOut} against a declared pot of ${pot} on close ${close._id}`,
      );

      for (const claim of claims) {
        assert(
          new Date(claim.weekStart).toISOString() === JUL19_WEEK_START,
          `claim ${claim._id} must carry the cutover weekStart (got ${new Date(claim.weekStart).toISOString()})`,
        );
      }
    }
  });

  await runner.test('cascade_one_hop_invariants', async () => {
    const r = await fetch(url(cfg, '/market-rewards/admin/claims'), {
      headers: adminHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`admin claims list ${r.status}: ${text.slice(0, 300)}`);
    }
    const claims = Array.isArray(body?.data) ? body.data : [];
    const byId = new Map(claims.map((c) => [String(c._id), c]));
    const LIVE = new Set(['PROVISIONAL', 'CLAIM_SUBMITTED', 'VERIFIED', 'PAID']);

    // One-hop invariants on every inherited claim.
    const seenParents = new Set();
    for (const child of claims.filter((c) => c.inheritedFromClaimId)) {
      const parentId = String(child.inheritedFromClaimId);
      assert(
        !seenParents.has(parentId),
        `dead claim ${parentId} has MULTIPLE inherited children — cascade idempotency broken`,
      );
      seenParents.add(parentId);
      const parent = byId.get(parentId);
      if (parent) {
        assert(
          ['FORFEITED', 'REJECTED_FRAUD'].includes(parent.status),
          `parent ${parentId} of inherited claim ${child._id} must be dead (is ${parent.status})`,
        );
        assert(
          !parent.inheritedFromClaimId,
          `chain detected: parent ${parentId} is itself inherited — max ONE hop`,
        );
        assert(
          child.slot === parent.slot && child.grossAmount === parent.grossAmount,
          `inherited claim ${child._id} must carry the dead slot + tier amount (slot ${parent.slot}/${child.slot}, amount ${parent.grossAmount}/${child.grossAmount})`,
        );
        assert(
          new Date(child.weekStart).toISOString() === new Date(parent.weekStart).toISOString(),
          `inherited claim ${child._id} must stay in the parent's competition week`,
        );
      }
      const sameCloseSameUser = claims.filter(
        (c) =>
          String(c.closeId) === String(child.closeId) &&
          String(c.userId) === String(child.userId),
      );
      assert(
        sameCloseSameUser.length === 1,
        `user ${child.userId} holds ${sameCloseSameUser.length} claims for close ${child.closeId} — max one reward per member per week`,
      );
    }

    // Double-pay guard: at most one LIVE claim per (closeId, slot).
    const liveSlots = new Map();
    for (const claim of claims) {
      if (!LIVE.has(claim.status)) continue;
      const key = `${claim.closeId}:${claim.slot}`;
      assert(
        !liveSlots.has(key),
        `two LIVE claims for slot ${key} (${liveSlots.get(key)} and ${claim._id}) — double-pay risk`,
      );
      liveSlots.set(key, String(claim._id));
    }
  });

  await runner.test('post_cutover_closes_carry_passing_evidence', async () => {
    const recent = closes.filter(
      (c) =>
        c.status !== 'VOID' &&
        new Date(c.createdAt || c.snapshotAt).getTime() >= EVIDENCE_REQUIRED_FROM_MS,
    );
    // No such close yet (before the first Mon Jul 27 auto run) — vacuously green.
    for (const close of recent) {
      assert(
        close.evidence && close.evidence.recompute,
        `close ${close._id} (${close.marketCode} ${close.weekStart}) is missing the evidence artifact`,
      );
      assert(
        close.evidence.recompute.match === true,
        `close ${close._id} evidence recompute must PASS before it may be confirmed (mismatches: ${JSON.stringify(close.evidence.recompute.mismatches || [])})`,
      );
    }
  });
}
