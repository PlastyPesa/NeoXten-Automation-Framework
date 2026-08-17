import { url } from '../config.mjs';
import { readJson, assert, TINY_PNG_BASE64 } from '../assert.mjs';

export const id = 'sort-proof';

/**
 * HappyLion / any Kenya account that already used today's Sort slot gets
 * CAP_REACHED before body validation. That is a valid live answer — not a 400.
 */
function isSortCapReached(status, body, text) {
  const blob = `${text || ''} ${JSON.stringify(body || {})}`;
  if (!/CAP_REACHED/i.test(blob)) return false;
  return status === 200 || status === 400 || status === 409 || status === 429;
}

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'sort_proof_authenticated',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  await runner.test('sort_proof_config_authenticated_shape', async () => {
    const r = await fetch(url(cfg, '/home/sort-proof/config'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`config ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data');
    assert(typeof d.enabled === 'boolean', 'enabled boolean');
    assert(typeof d.helpText === 'string', 'helpText string');
    assert(Array.isArray(d.streams), 'streams array');
    for (const s of d.streams) {
      assert(s?.id && typeof s.id === 'string', 'stream.id');
      assert(typeof s.label === 'string', 'stream.label');
    }
    // How-to-Sort learn gate — EN only (owner lock 2026-07-29; SW removed)
    assert(d.learnGate && typeof d.learnGate === 'object', 'learnGate object');
    assert(typeof d.learnGate.required === 'boolean', 'learnGate.required');
    assert(
      d.learnGate.reason === null ||
        d.learnGate.reason === 'new_user' ||
        d.learnGate.reason === 'after_reject',
      'learnGate.reason',
    );
    assert(d.videos && typeof d.videos === 'object', 'videos object');
    assert(
      typeof d.videos.en === 'string' && d.videos.en.startsWith('https://'),
      'videos.en https',
    );
    assert(
      d.videos.sw === undefined ||
        d.videos.sw === null ||
        d.videos.sw === '',
      'videos.sw absent (EN-only)',
    );
    assert(d.defaultLocale === 'en', 'defaultLocale en');
    assert(
      typeof d.videoUrl === 'string' && d.videoUrl.startsWith('https://'),
      'videoUrl https',
    );
    assert(d.videoUrl === d.videos.en, 'videoUrl matches videos.en');
  });

  await runner.test('sort_proof_learn_complete_unlocks_shape', async () => {
    const r = await fetch(url(cfg, '/home/sort-proof/learn-complete'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({ finished: true, locale: 'en' }),
    });
    const { body, text } = await readJson(r);
    if (r.status !== 200) {
      throw new Error(`learn-complete ${r.status}: ${text.slice(0, 400)}`);
    }
    assert(body?.type === 'success', 'type success');
    assert(body?.data?.learnGate?.required === false, 'gate cleared');
  });

  await runner.test('sort_proof_submit_403_when_feature_disabled', async () => {
    const cfgRes = await fetch(url(cfg, '/home/sort-proof/config'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const cfgJson = await readJson(cfgRes);
    assert(cfgJson.body?.type === 'success', 'config ok');
    if (cfgJson.body?.data?.enabled === true) {
      return;
    }

    const r = await fetch(url(cfg, '/home/sort-proof'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({
        image: TINY_PNG_BASE64,
        stream: 'PET',
      }),
    });
    const { body, text } = await readJson(r);
    if (r.status !== 403) {
      throw new Error(
        `Feature off: expected 403, got ${r.status}: ${text.slice(0, 300)}`,
      );
    }
    assert(body?.type === 'error', 'error type when disabled');
  });

  await runner.test('sort_proof_validation_invalid_streams_400_when_enabled', async () => {
    const cfgRes = await fetch(url(cfg, '/home/sort-proof/config'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const cfgJson = await readJson(cfgRes);
    if (cfgJson.body?.data?.enabled !== true) {
      return;
    }

    const r = await fetch(url(cfg, '/home/sort-proof'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({
        image: TINY_PNG_BASE64,
        stream: 'NOT_A_STREAM',
      }),
    });
    const { body, text } = await readJson(r);
    if (isSortCapReached(r.status, body, text)) {
      return;
    }
    if (r.status !== 400) {
      throw new Error(`Expected 400 invalid stream, got ${r.status}: ${text.slice(0, 250)}`);
    }
  });

  await runner.test('sort_proof_validation_legacy_dual_stream_when_enabled', async () => {
    const cfgRes = await fetch(url(cfg, '/home/sort-proof/config'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const cfgJson = await readJson(cfgRes);
    if (cfgJson.body?.data?.enabled !== true) {
      return;
    }

    const r = await fetch(url(cfg, '/home/sort-proof'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({
        image: TINY_PNG_BASE64,
        streamA: 'PET',
        streamB: 'HDPE',
      }),
    });
    const { body, text } = await readJson(r);
    if (isSortCapReached(r.status, body, text)) {
      return;
    }
    // Strict API rejects two distinct grades with 400 (one grade per photo). Older deployments may still accept and evaluate using the primary stream only (200 + success shape).
    if (r.status === 400) {
      assert(body?.type === 'error', 'legacy dual stream: error type');
      return;
    }
    if (r.status === 200) {
      assert(body?.type === 'success', 'legacy dual stream transitional: success type');
      const d = body?.data;
      assert(d && typeof d === 'object', 'data object');
      assert(typeof d.verified === 'boolean', 'verified boolean');
      return;
    }
    throw new Error(
      `Expected 400 or 200 for legacy dual stream, got ${r.status}: ${text.slice(0, 250)}`,
    );
  });

  await runner.test('sort_proof_validation_missing_image_400_when_enabled', async () => {
    const cfgRes = await fetch(url(cfg, '/home/sort-proof/config'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const cfgJson = await readJson(cfgRes);
    if (cfgJson.body?.data?.enabled !== true) {
      return;
    }

    const r = await fetch(url(cfg, '/home/sort-proof'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({ stream: 'PET' }),
    });
    const { body, text } = await readJson(r);
    if (isSortCapReached(r.status, body, text)) {
      return;
    }
    if (r.status !== 400) {
      throw new Error(`Expected 400 missing image, got ${r.status}: ${text.slice(0, 250)}`);
    }
  });

  await runner.test('sort_proof_validation_missing_stream_400_when_enabled', async () => {
    const cfgRes = await fetch(url(cfg, '/home/sort-proof/config'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const cfgJson = await readJson(cfgRes);
    if (cfgJson.body?.data?.enabled !== true) {
      return;
    }

    const r = await fetch(url(cfg, '/home/sort-proof'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({ image: TINY_PNG_BASE64 }),
    });
    const { body, text } = await readJson(r);
    if (isSortCapReached(r.status, body, text)) {
      return;
    }
    if (r.status !== 400) {
      throw new Error(`Expected 400 missing stream, got ${r.status}: ${text.slice(0, 250)}`);
    }
  });

  if (!cfg.sortProofE2E) {
    runner.skip(
      'sort_proof_live_anthropic_extra_submission',
      'Set PLASTYPESA_SORT_PROOF_E2E=1 for an extra POST after validations (uses quota; feature must be enabled)',
    );
    return;
  }

  await runner.test('sort_proof_live_anthropic_extra_submission', async () => {
    const cfgRes = await fetch(url(cfg, '/home/sort-proof/config'), {
      method: 'GET',
      headers: cfg.authHeaders,
    });
    const cfgJson = await readJson(cfgRes);
    if (cfgJson.body?.data?.enabled !== true) {
      throw new Error('PLASTYPESA_SORT_PROOF_E2E=1 but sort-proof-enabled is off');
    }

    const r = await fetch(url(cfg, '/home/sort-proof'), {
      method: 'POST',
      headers: cfg.authHeaders,
      body: JSON.stringify({
        image: TINY_PNG_BASE64,
        stream: 'PP',
      }),
    });
    const { body, text } = await readJson(r);
    if (r.status === 429) {
      return;
    }
    if (r.status !== 200) {
      throw new Error(`E2E submit ${r.status}: ${text.slice(0, 500)}`);
    }
    assert(body?.type === 'success', 'success');
    const d = body?.data;
    assert(typeof d.verified === 'boolean', 'verified');
    assert(['high', 'medium', 'low'].includes(d.confidence), 'confidence');
  });
}
