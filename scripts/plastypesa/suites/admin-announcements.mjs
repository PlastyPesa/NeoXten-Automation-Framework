import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'admin-announcements';

function adminHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export async function run(cfg, runner) {
  const adminJwt = (process.env.PLASTYPESA_ADMIN_JWT || '').trim();

  if (!adminJwt) {
    runner.skip(
      'admin_announcements_suite',
      'Set PLASTYPESA_ADMIN_JWT to run admin announcement API checks',
    );
    return;
  }

  await runner.test('admin_get_announcements_ok', async () => {
    const r = await fetch(url(cfg, '/admin/announcements?page=1&limit=5'), {
      method: 'GET',
      headers: adminHeaders(adminJwt),
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`GET /admin/announcements ${r.status}: ${text.slice(0, 500)}`);
    }
    assert(body?.type === 'success', 'type success');
    assert(body?.data && Array.isArray(body.data), 'data array');
    assert(body?.pagination && typeof body.pagination === 'object', 'pagination');
  });

  const phase1Deployed = process.env.PLASTYPESA_PHASE1_ANNOUNCEMENT_API === '1';
  if (!phase1Deployed) {
    runner.skip(
      'admin_post_announcement_dry_run_returns_in_app_banner_meta',
      'Set PLASTYPESA_PHASE1_ANNOUNCEMENT_API=1 after deploying backend Phase 1 (dryRun avoids real sends on old API)',
    );
    return;
  }

  await runner.test('admin_post_announcement_dry_run_returns_in_app_banner_meta', async () => {
    const payload = {
      dryRun: true,
      title: 'NeoXten phase1 banner test',
      message: 'No users notified (dry run).',
      inAppBanner: {
        bannerDurationSec: 12,
        bannerScope: 'app_wide',
        bannerPosition: 'bottom',
        bannerStyle: 'premium',
        bannerId: `neoxten-${Date.now()}`,
      },
    };

    const r = await fetch(url(cfg, '/admin/announcements'), {
      method: 'POST',
      headers: adminHeaders(adminJwt),
      body: JSON.stringify(payload),
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`POST /admin/announcements ${r.status}: ${text.slice(0, 500)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data object');
    assert(d.dryRun === true, 'dryRun');
    assert(typeof d.totalUsers === 'number', 'totalUsers number');
    const ib = d.inAppBanner;
    assert(ib && typeof ib === 'object', 'inAppBanner object');
    assert(ib.bannerDurationSec === 12, 'duration');
    assert(ib.bannerScope === 'app_wide', 'scope');
    assert(ib.bannerPosition === 'bottom', 'position');
    assert(ib.bannerStyle === 'premium', 'style');
    assert(typeof ib.bannerId === 'string' && ib.bannerId.length > 0, 'bannerId');
  });
}
