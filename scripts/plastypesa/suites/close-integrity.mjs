/**
 * P-WEEKLY-CLOSE-AUTO (2026-07-26) — weekly close integrity regression.
 *
 * Read-only assertions against the production close/claims state:
 *   1. At most ONE non-VOID close per (marketCode, weekStart) — the partial
 *      unique index invariant that keeps EventBridge retries from
 *      double-creating closes (and therefore double-creating claim forms).
 *   2. The Jul 19–25 close (weekStart 2026-07-19) stays un-CONFIRMED with
 *      ZERO claims until the owner explicitly presses Confirm — the auto job
 *      must never reach back to it.
 *   3. Any close created from 2026-07-26 onward carries the machine-checkable
 *      evidence artifact with a PASSING dual recompute (evidence gate).
 *
 * Needs an admin token: PLASTYPESA_ADMIN_JWT, or the admin-dashboard
 * credentials from the local credential registry (skips without either).
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'close-integrity';

const JUL19_WEEK_START = '2026-07-19T00:00:00.000Z';
const EVIDENCE_REQUIRED_FROM_MS = Date.UTC(2026, 6, 26); // auto job ships 2026-07-26

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

  await runner.test('jul19_close_not_confirmed_zero_claims', async () => {
    const jul19 = closes.filter(
      (c) =>
        c.marketCode === 'KE' &&
        new Date(c.weekStart).toISOString() === JUL19_WEEK_START &&
        c.status !== 'VOID',
    );
    assert(jul19.length === 1, `exactly one live Jul 19–25 KE close (got ${jul19.length})`);
    const close = jul19[0];
    assert(
      close.status === 'DRAFT',
      `Jul 19–25 close must stay DRAFT until the owner confirms (got ${close.status})`,
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
    assert(
      claims.length === 0,
      `Jul 19–25 close must have ZERO claims before owner confirm (got ${claims.length})`,
    );
  });

  await runner.test('post_jul26_closes_carry_passing_evidence', async () => {
    const recent = closes.filter(
      (c) =>
        c.status !== 'VOID' &&
        new Date(c.createdAt || c.snapshotAt).getTime() >= EVIDENCE_REQUIRED_FROM_MS &&
        new Date(c.weekStart).getTime() >= EVIDENCE_REQUIRED_FROM_MS,
    );
    // No such close yet (before the first Aug 3 auto run) — vacuously green.
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
