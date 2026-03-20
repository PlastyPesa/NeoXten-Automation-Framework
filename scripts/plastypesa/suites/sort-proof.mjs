import { url } from '../config.mjs';
import { readJson, assert, TINY_PNG_BASE64 } from '../assert.mjs';

export const id = 'sort-proof';

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip('sort_proof_authenticated', 'Set PLASTYPESA_USER_JWT');
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
        streamA: 'PET',
        streamB: 'HDPE',
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
        streamA: 'NOT_A_STREAM',
        streamB: 'PET',
      }),
    });
    const { text } = await readJson(r);
    if (r.status !== 400) {
      throw new Error(`Expected 400 invalid stream, got ${r.status}: ${text.slice(0, 250)}`);
    }
  });

  await runner.test('sort_proof_validation_same_stream_400_when_enabled', async () => {
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
        streamB: 'PET',
      }),
    });
    const { text } = await readJson(r);
    if (r.status !== 400) {
      throw new Error(`Expected 400 same stream, got ${r.status}: ${text.slice(0, 250)}`);
    }
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
      body: JSON.stringify({ streamA: 'PET', streamB: 'HDPE' }),
    });
    const { text } = await readJson(r);
    if (r.status !== 400) {
      throw new Error(`Expected 400 missing image, got ${r.status}: ${text.slice(0, 250)}`);
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
        streamA: 'PET',
        streamB: 'PP',
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
