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
 *      while it is still DRAFT (claims may exist only after Confirm).
 *   3. Any live close created from the cutover onward carries the
 *      machine-checkable evidence artifact with a PASSING dual recompute.
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
    if (close.status === 'DRAFT') {
      const r = await fetch(
        url(cfg, `/market-rewards/admin/claims?closeId=${close._id}`),
        { headers: adminHeaders },
      );
      const { body, text } = await readJson(r);
      if (r.status !== 200) {
        throw new Error(`admin claims list ${r.status}: ${text.slice(0, 300)}`);
      }
      const claims = Array.isArray(body?.data) ? body.data : [];
      assert(
        claims.length === 0,
        `DRAFT cutover close must have ZERO claims before Confirm (got ${claims.length})`,
      );
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
