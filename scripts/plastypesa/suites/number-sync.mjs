/**
 * Cross-endpoint number sync (owner 2026-07-27).
 *
 * Home shows the same Kenya population in two cards fed by two endpoints.
 * When they diverged (earn-hub communityMembers=51 vs pulse members=38), the
 * product looked like a lie. This suite fails if those trust numbers disagree.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'number-sync';

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'number_sync_home_cards',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  let earnHub = null;
  let pulse = null;
  let leaderboard = null;
  let profile = null;

  await runner.test('number_sync_fetch_home_payloads', async () => {
    const [ehRes, pulseRes, lbRes, profRes] = await Promise.all([
      fetch(url(cfg, '/home/earn-hub'), { headers: cfg.authHeaders }),
      fetch(url(cfg, '/community/pulse'), { headers: cfg.authHeaders }),
      fetch(url(cfg, '/home/leaderboard?type=weekly&scope=global'), {
        headers: cfg.authHeaders,
      }),
      fetch(url(cfg, '/user/my-profile'), { headers: cfg.authHeaders }),
    ]);

    const eh = await readJson(ehRes);
    const pu = await readJson(pulseRes);
    const lb = await readJson(lbRes);
    const pr = await readJson(profRes);

    assert(ehRes.status === 200, `earn-hub ${ehRes.status}: ${eh.text.slice(0, 200)}`);
    assert(pulseRes.status === 200, `pulse ${pulseRes.status}: ${pu.text.slice(0, 200)}`);
    assert(lbRes.status === 200, `leaderboard ${lbRes.status}: ${lb.text.slice(0, 200)}`);
    assert(profRes.status === 200, `profile ${profRes.status}: ${pr.text.slice(0, 200)}`);

    earnHub = eh.body?.data ?? null;
    pulse = pu.body?.data ?? null;
    leaderboard = lb.body?.data ?? null;
    profile = pr.body?.data ?? pr.body?.user ?? null;
  });

  await runner.test('mission_strip_members_equals_pulse_members', async () => {
    if (!earnHub || !pulse) return;
    const mission = Number(earnHub.communityProgress?.communityMembers);
    const members = Number(pulse.members);
    const milestone = Number(pulse.milestone?.currentKeMembers);

    assert(Number.isInteger(mission) && mission >= 0,
      `communityProgress.communityMembers must be int, got ${mission}`);
    assert(Number.isInteger(members) && members >= 0,
      `pulse.members must be int, got ${members}`);

    assert(
      mission === members,
      `Home mission strip (${mission}) ≠ pulse.members (${members}) — dual Kenya population on one screen`,
    );

    // Milestone is KE-only; when present it must be the same integer.
    if (Number.isInteger(milestone) && !Number.isNaN(milestone)) {
      assert(
        milestone === members,
        `milestone.currentKeMembers (${milestone}) ≠ pulse.members (${members})`,
      );
      assert(
        milestone === mission,
        `milestone.currentKeMembers (${milestone}) ≠ mission communityMembers (${mission})`,
      );
    }

    const remaining = Number(earnHub.communityProgress?.membersToTop20Unlock);
    const target = Number(earnHub.communityProgress?.top20UnlockThreshold) || 500;
    if (Number.isInteger(remaining)) {
      assert(
        remaining === Math.max(0, target - mission),
        `membersToTop20Unlock (${remaining}) != ${target}-${mission}`,
      );
    }
  });

  await runner.test('current_user_lifetime_matches_profile_and_board', async () => {
    if (!leaderboard || !profile) return;
    const cu = leaderboard.currentUser;
    if (!cu) return;

    const boardLife = Number(cu.lifetimePoints ?? cu.lifetimeStats?.totalPoints);
    const profileLife = Number(
      profile.lifetimePoints ??
        profile.lifetimeStats?.totalPoints ??
        profile.points,
    );

    assert(Number.isFinite(boardLife), `board lifetime not a number: ${boardLife}`);
    assert(Number.isFinite(profileLife), `profile lifetime not a number: ${profileLife}`);
    assert(
      boardLife === profileLife,
      `leaderboard currentUser.lifetimePoints (${boardLife}) ≠ profile (${profileLife})`,
    );
  });

  await runner.test('board_weekly_points_are_non_negative_integers', async () => {
    if (!leaderboard) return;
    const rows = leaderboard.leaderboard || [];
    for (const row of rows.slice(0, 20)) {
      const w = Number(row.weeklyPoints);
      const life = Number(row.lifetimePoints);
      assert(Number.isFinite(w) && w >= 0,
        `weeklyPoints bad for ${row.ecoHandle}: ${row.weeklyPoints}`);
      assert(Number.isFinite(life) && life >= 0,
        `lifetimePoints bad for ${row.ecoHandle}: ${row.lifetimePoints}`);
      // Lifetime must cover weekly contribution (same user, lifetime never resets).
      assert(
        life >= w,
        `${row.ecoHandle}: lifetime (${life}) < weekly (${w}) — impossible if lifetime never resets`,
      );
    }
  });
}
