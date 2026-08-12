/**
 * P-DAILY-CHECK-ADMIN-EXPANSION + P-ECO-GUARDIAN-ALERT-FORM (2026-07-26) —
 * Daily Check as the same-day action inbox.
 *
 * Daily Check is the one page the owner's wife opens each morning, so its
 * failure mode is not a crash: it is a queue that quietly reports zero. The
 * page is built from ~10 independent loaders that each swallow their own errors
 * so one dead collection cannot blank the report — which is right for
 * availability and dangerous for trust, because a swallowed failure and a
 * genuinely empty queue look identical in the UI.
 *
 * These assertions therefore check the *shape* of every new section (present,
 * an object, with its list and count fields), not the counts themselves:
 *
 *   * a missing section means the loader threw or was dropped from the report,
 *     and the admin page renders "—" forever with nobody noticing;
 *   * `disputeQueue` also guards a real regression fixed the same day: the
 *     service filtered disputes on ["OPEN","SUBMITTED","UNDER_REVIEW"] while
 *     the model only allows OPEN / IN_REVIEW / RESOLVED / DISMISSED, so every
 *     dispute an admin had picked up vanished from the queue;
 *   * `presence.onlineNow` here is the RAW count, deliberately unlike the
 *     user-facing pulse card which hides anything below 3 — ops needs the true
 *     number, so this suite proves the two are allowed to differ while both
 *     stay honest;
 *   * `ecoGuardian.alertActive` must be a real boolean derived from open claims
 *     or unclaimed qualifiers, because a founding qualifier who is never
 *     surfaced is a person owed KES 20,000 that nobody knows about.
 *
 * Nothing here mutates a claim. Verify / reject / record-payout are money-side
 * decisions and are only exercised by Jest against fixtures.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'daily-check-inbox';

/** Mirrors DISPUTE_STATUSES in models/reward_dispute.js. */
const OPEN_DISPUTE_STATUSES = ['OPEN', 'IN_REVIEW'];
const CLOSED_DISPUTE_STATUSES = ['RESOLVED', 'DISMISSED'];

/** Mirrors ECO_CLAIM_OPEN_STATUSES in models/eco_guardian_claim.js. */
const ECO_OPEN_STATUSES = ['PROVISIONAL', 'CLAIM_SUBMITTED', 'VERIFIED'];
const ECO_TERMINAL_STATUSES = ['PAID', 'REJECTED_FRAUD'];

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

function isCountOrNull(value) {
  return value === null || (Number.isInteger(value) && value >= 0);
}

export async function run(cfg, runner) {
  const adminHeaders = await resolveAdminHeaders(cfg);
  if (!adminHeaders) {
    runner.skip(
      'daily_check_inbox',
      'No admin token — set PLASTYPESA_ADMIN_JWT or provide admin-dashboard credentials',
    );
    return;
  }

  await runner.test('daily_check_is_admin_only', async () => {
    // The report carries account emails, payout names and M-Pesa numbers.
    const r = await fetch(url(cfg, '/admin/ops/daily-check'));
    assert(
      r.status === 401 || r.status === 403,
      `unauthenticated daily-check should be rejected, got ${r.status}`,
    );
  });

  let report = null;

  await runner.test('daily_check_loads_with_every_action_queue_present', async () => {
    const r = await fetch(url(cfg, '/admin/ops/daily-check'), { headers: adminHeaders });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`daily-check ${r.status}: ${text.slice(0, 300)}`);
    }
    report = body?.data ?? body;
    assert(report?.generatedAt, 'generatedAt missing — the page treats this as an invalid report');

    // Each of these is an independent loader. A missing key means it threw
    // outside its own try/catch or was dropped from buildDailyCheckReport.
    for (const section of ['communityModeration', 'disputeQueue', 'presence', 'ecoGuardian', 'retention']) {
      assert(
        report[section] && typeof report[section] === 'object',
        `${section} missing from daily-check — the admin queue renders empty forever`,
      );
    }
    assert(Array.isArray(report.actionItems), 'actionItems must be an array');
  });

  await runner.test('retention_cohorts_are_true_habit_not_signup_windows', async () => {
    if (!report) return;
    const ret = report.retention;
    assert(ret && typeof ret === 'object', 'retention section missing');
    assert(ret.d1 && typeof ret.d1 === 'object', 'retention.d1 missing');
    assert(ret.d7 && typeof ret.d7 === 'object', 'retention.d7 missing');
    assert(ret.d7Rolling && typeof ret.d7Rolling === 'object', 'retention.d7Rolling missing');
    assert(ret.daily && typeof ret.daily === 'object', 'retention.daily missing');
    assert(isCountOrNull(ret.d1.cohortSize), `d1.cohortSize bad: ${ret.d1.cohortSize}`);
    assert(isCountOrNull(ret.d1.returned), `d1.returned bad: ${ret.d1.returned}`);
    assert(isCountOrNull(ret.d7.cohortSize), `d7.cohortSize bad: ${ret.d7.cohortSize}`);
    assert(isCountOrNull(ret.d7.with2SortsByD7), `d7.with2SortsByD7 (north-star) bad: ${ret.d7.with2SortsByD7}`);
    assert(isCountOrNull(ret.daily.kenyaApprovedSortsToday), `daily Kenya sorts bad: ${ret.daily.kenyaApprovedSortsToday}`);
    // Signup windows must stay labeled separately — never pretend new7d is D7 return.
    assert(
      typeof ret.note === 'string' && /cohort|north-star|not signup/i.test(ret.note),
      'retention.note must explain these are true cohorts, not signup windows',
    );
  });

  await runner.test('flagged_comments_are_counted_not_only_flagged_posts', async () => {
    if (!report) return;
    const mod = report.communityModeration;
    // Before this shot only flaggedPosts existed, so a reported comment could
    // sit unreviewed indefinitely even though moderation already handles both.
    assert(isCountOrNull(mod.flaggedPosts), `flaggedPosts must be a count or null, got ${JSON.stringify(mod.flaggedPosts)}`);
    assert(isCountOrNull(mod.flaggedComments), `flaggedComments must be a count or null, got ${JSON.stringify(mod.flaggedComments)}`);
    assert(Array.isArray(mod.posts) && Array.isArray(mod.comments),
      'posts and comments must be arrays so the inbox can list them');
    if (mod.flaggedPosts !== null && mod.flaggedComments !== null) {
      assert(mod.openTotal === mod.flaggedPosts + mod.flaggedComments,
        `openTotal (${mod.openTotal}) != posts + comments (${mod.flaggedPosts} + ${mod.flaggedComments})`);
    }
    assert(typeof mod.moderationPath === 'string' && mod.moderationPath.startsWith('/'),
      'moderationPath must be a dashboard route — Daily Check links, it does not moderate');
    assert(mod.posts.length <= 10 && mod.comments.length <= 10,
      'the inbox shows a capped preview; unbounded lists would make the report huge');
  });

  await runner.test('dispute_queue_asks_the_model_for_open_statuses', async () => {
    if (!report) return;
    const q = report.disputeQueue;
    assert(isCountOrNull(q.openTotal), `openTotal must be a count or null, got ${JSON.stringify(q.openTotal)}`);
    assert(Array.isArray(q.rows), 'rows must be an array');
    assert(typeof q.disputesPath === 'string' && q.disputesPath.startsWith('/'),
      'disputesPath must deep-link the existing Disputes & reconciliation workbench');

    for (const row of q.rows) {
      // The bug this guards: a status the model never issues was being queried,
      // so IN_REVIEW disputes silently disappeared from the morning check.
      assert(OPEN_DISPUTE_STATUSES.includes(row.status),
        `dispute ${row.disputeId} has status ${row.status}; the queue must contain exactly ` +
          `${OPEN_DISPUTE_STATUSES.join(' / ')} — a closed dispute here means the filter drifted`);
      assert(!CLOSED_DISPUTE_STATUSES.includes(row.status),
        `resolved dispute ${row.disputeId} is still in the open queue`);
      assert(row.hoursWaiting === null || Number.isFinite(row.hoursWaiting),
        `dispute ${row.disputeId} hoursWaiting must be a number or null — ops triages on age`);
    }
    if (q.rows.length > 1) {
      // Oldest first, so the person who has waited longest is at the top.
      const ages = q.rows.map((r) => r.hoursWaiting ?? -1);
      const sorted = [...ages].sort((a, b) => b - a);
      assert(JSON.stringify(ages) === JSON.stringify(sorted),
        `dispute rows are not oldest-first (${ages.join(', ')})`);
    }
    if (Number.isInteger(q.openTotal) && q.openTotal > 0) {
      assert(Number.isFinite(q.oldestHoursWaiting),
        'openTotal > 0 but oldestHoursWaiting is null — the age headline would read "—"');
    }
  });

  await runner.test('admin_presence_is_the_raw_count_users_never_see', async () => {
    if (!report) return;
    const p = report.presence;
    assert(isCountOrNull(p.members), `members must be a count or null, got ${JSON.stringify(p.members)}`);
    assert(isCountOrNull(p.weeklyActive), `weeklyActive must be a count or null, got ${JSON.stringify(p.weeklyActive)}`);
    assert(isCountOrNull(p.onlineNow), `onlineNow must be a count or null, got ${JSON.stringify(p.onlineNow)}`);
    assert(Number.isInteger(p.userFacingOnlineFloor) && p.userFacingOnlineFloor >= 3,
      `userFacingOnlineFloor must stay >= 3 (got ${JSON.stringify(p.userFacingOnlineFloor)}) — ` +
        'it is the rule that stops the app printing "1 online"');

    if (Number.isInteger(p.members) && Number.isInteger(p.weeklyActive)) {
      assert(p.weeklyActive <= p.members,
        `weeklyActive (${p.weeklyActive}) > members (${p.members}) — two populations again`);
    }
    if (Number.isInteger(p.onlineNow)) {
      // Deliberately unlike the user card: ops is allowed to see 0, 1 or 2.
      assert(p.shownToUsers === p.onlineNow >= p.userFacingOnlineFloor,
        `shownToUsers (${p.shownToUsers}) disagrees with onlineNow ${p.onlineNow} vs floor ` +
          `${p.userFacingOnlineFloor} — admin would misjudge what users are being shown`);
    }
  });

  await runner.test('eco_guardian_alert_matches_its_own_queues', async () => {
    if (!report) return;
    const eco = report.ecoGuardian;
    assert(typeof eco.alertActive === 'boolean', 'alertActive must be a boolean');
    assert(Array.isArray(eco.openClaims) && Array.isArray(eco.qualifiedWithoutClaim),
      'openClaims and qualifiedWithoutClaim must be arrays');
    assert(typeof eco.payoutNote === 'string' && eco.payoutNote.length > 0,
      'payoutNote must state that nothing is paid automatically');

    const expected = eco.openClaims.length > 0 || eco.qualifiedWithoutClaim.length > 0;
    assert(eco.alertActive === expected,
      `alertActive (${eco.alertActive}) disagrees with ${eco.openClaims.length} open claim(s) and ` +
        `${eco.qualifiedWithoutClaim.length} unclaimed qualifier(s) — either the banner cries wolf ` +
        'or somebody owed the founding reward is invisible');

    for (const claim of eco.openClaims) {
      assert(ECO_OPEN_STATUSES.includes(claim.status),
        `open claim ${claim.claimId} has status ${claim.status}; only ${ECO_OPEN_STATUSES.join(' / ')} stay open`);
      assert(claim.grossAmount > 0 && typeof claim.currency === 'string',
        `claim ${claim.claimId} must carry the amount ops has to send by hand`);
    }
    for (const claim of eco.resolvedClaims || []) {
      assert(ECO_TERMINAL_STATUSES.includes(claim.status),
        `resolved claim ${claim.claimId} has non-terminal status ${claim.status}`);
    }

    if (eco.campaign) {
      // The thresholds the app's progress bar promises. If these drift the app
      // and the admin queue disagree about who qualified.
      assert(eco.campaign.lifetimePointsRequired > 0 && eco.campaign.approvedSortProofsRequired > 0,
        'campaign thresholds must be positive');
      assert(eco.campaign.rewardAmount > 0,
        'campaign rewardAmount must be positive — it is the sum ops sends by M-Pesa');
    }
  });

  await runner.test('eco_guardian_admin_queue_endpoint_agrees_with_daily_check', async () => {
    const unauth = await fetch(url(cfg, '/eco-guardian/admin/claims'));
    assert(unauth.status === 401 || unauth.status === 403,
      `unauthenticated eco-guardian admin queue should be rejected, got ${unauth.status}`);

    const r = await fetch(url(cfg, '/eco-guardian/admin/claims'), { headers: adminHeaders });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`eco-guardian admin claims ${r.status}: ${text.slice(0, 300)}`);
    }
    const data = body?.data;
    assert(data && Array.isArray(data.openClaims),
      'eco-guardian admin queue must return the same shape Daily Check embeds');
    if (report?.ecoGuardian) {
      assert(data.openClaims.length === report.ecoGuardian.openClaims.length,
        `standalone queue shows ${data.openClaims.length} open claim(s) but Daily Check shows ` +
          `${report.ecoGuardian.openClaims.length} — the two views read different data`);
    }
  });

  await runner.test('sort_queue_agrees_with_the_header_strip_ops_actually_sees', async () => {
    if (!report) return;
    // Found live 2026-07-27: the header strip said "7 sort photos waiting for
    // review" while Daily Check said 0, because Daily Check counted
    // sort_proof_images by status and those docs carry no status field at all.
    // One photo had been waiting 59h with nobody told. Both surfaces now call
    // one counter, so this asserts they can never drift apart again.
    const r = await fetch(url(cfg, '/admin/ops/summary'), { headers: adminHeaders });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`ops/summary ${r.status}: ${text.slice(0, 300)}`);
    }
    const strip = (body?.data ?? body)?.sortProof;
    assert(strip && Number.isInteger(strip.openTotal),
      'ops/summary must report sortProof.openTotal — it drives the header banner');

    const kpi = report.kpis?.sortQueue;
    const cockpit = report.trustAndUpdates?.sortQueueCockpit;
    assert(kpi && Number.isInteger(kpi.openTotal), 'daily-check kpis.sortQueue.openTotal missing');
    assert(kpi.openTotal === strip.openTotal,
      `Daily Check says ${kpi.openTotal} sort photo(s) open but the header strip says ` +
        `${strip.openTotal} — ops trusts whichever number is smaller and users wait`);
    assert(kpi.pending === strip.pendingReview && kpi.flagged === strip.flagged,
      `bucket mismatch: daily-check ${kpi.pending}/${kpi.flagged} vs strip ` +
        `${strip.pendingReview}/${strip.flagged}`);

    if (cockpit) {
      assert(cockpit.openTotal === kpi.openTotal,
        `cockpit openTotal ${cockpit.openTotal} != kpi ${kpi.openTotal}`);
      // The self-contradiction that exposed the bug: a listed oldest item while
      // the same card claimed the queue was empty.
      if (cockpit.oldestPending) {
        assert(cockpit.openTotal > 0,
          `cockpit lists an oldest pending sort (${cockpit.oldestPending.hoursWaiting}h) while ` +
            'reporting an empty queue — one of the two is lying');
      }
    }

    if (kpi.openTotal > 0) {
      const joined = (report.actionItems || []).join(' \n ');
      assert(/sort photo\(s\) waiting for review/.test(joined),
        `${kpi.openTotal} sort photo(s) are open but no action item tells anyone to review them: ` +
          joined.slice(0, 300));
    }
  });

  await runner.test('action_items_never_use_prize_language', async () => {
    if (!report) return;
    // Brand rule: earn / reward / learn. A Play reviewer reading "prize" or
    // "lottery" in a screenshot is a store-listing risk, and these strings are
    // generated server-side where no translator ever reviews them.
    const joined = (report.actionItems || []).join(' \n ');
    const banned = /\b(prize|prizes|lottery|jackpot|winnings|gambl)/i;
    assert(!banned.test(joined),
      `action items contain prize/lottery language: ${joined.slice(0, 300)}`);
  });
}
