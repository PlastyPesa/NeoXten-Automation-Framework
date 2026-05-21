/**
 * P5 — Eco Scan client-config suite.
 *
 * Validates `GET /api/eco-scan/config`:
 *   - 401/403 without auth (so we never leak the rollout envelope to
 *     anonymous traffic).
 *   - 200 with canonical shape when authenticated.
 *   - rolloutPercent is one of the canonical 0 / 10 / 50 / 100 buckets.
 *
 * Tolerates a missing route (404) the same way eco-scan and eco-catalog
 * do: the suite passes on prod baselines that pre-date the P5 deploy and
 * starts asserting real behaviour as soon as Supervisor publishes.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'eco-scan-config';

const CANONICAL_PERCENTS = [0, 10, 50, 100];

/**
 * The `/api/eco-scan` router itself was deployed in P3, so an *unauth*
 * request always returns 401 from the JWT middleware — that tells us
 * nothing about whether the new `/config` sub-route exists.
 *
 * Probe deployment with **authenticated** GET instead:
 *   - 200 → route + handler live (we can run the shape assertion).
 *   - 404 → handler not deployed yet (skip both checks; this is the
 *     baseline state on a stage that predates the P5 Lambda).
 *   - 401/403 with valid auth → likely an auth shape mismatch, surface
 *     as a clear failure rather than mask it.
 *
 * When no auth is configured at all, skip the shape check (matches how
 * the eco-scan suite handles missing JWT) but still probe the auth gate.
 */
async function probeRouteDeployedAuthed(cfg) {
    if (!cfg.authHeaders) return null;
    const r = await fetch(url(cfg, '/eco-scan/config'), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', ...cfg.authHeaders },
    });
    return r.status !== 404;
}

export async function run(cfg, runner) {
    // Auth gate is universally safe to assert: middleware rejects every
    // unauthenticated request to /api/eco-scan/* regardless of sub-route.
    await runner.test('eco_scan_config_requires_auth', async () => {
        const r = await fetch(url(cfg, '/eco-scan/config'), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });
        assert(
            r.status === 401 || r.status === 403,
            `unauthenticated GET should be 401/403, got ${r.status}`,
        );
    });

    if (!cfg.authHeaders) {
        runner.skip(
            'eco_scan_config_authenticated_shape',
            'no PLASTYPESA_USER_JWT; skipping authed shape check',
        );
        return;
    }

    const deployed = await probeRouteDeployedAuthed(cfg);
    if (deployed === false) {
        runner.skip(
            'eco_scan_config_authenticated_shape',
            'authed GET returns 404 — P5 Lambda not deployed yet',
        );
        return;
    }

    await runner.test('eco_scan_config_authenticated_shape', async () => {
        const r = await fetch(url(cfg, '/eco-scan/config'), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', ...cfg.authHeaders },
        });
        assert(r.status === 200, `authed GET should be 200, got ${r.status}`);
        const { body } = await readJson(r);
        assert(body && body.type === 'success', 'success envelope');
        const data = body && body.data;
        assert(
            data && typeof data === 'object' && data.onDeviceHint,
            'data.onDeviceHint object present',
        );
        const hint = data.onDeviceHint;
        assert(
            typeof hint.enabled === 'boolean',
            `enabled should be boolean, got ${typeof hint.enabled}`,
        );
        assert(
            CANONICAL_PERCENTS.includes(hint.rolloutPercent),
            `rolloutPercent should be one of ${CANONICAL_PERCENTS.join('/')}, got ${hint.rolloutPercent}`,
        );
    });
}
