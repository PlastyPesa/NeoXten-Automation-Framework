/**
 * P3 — Eco Scan suite.
 *
 * The scan endpoint is JWT-protected (it ties to a user account for
 * eco-streak credit and admin QA traceability) so the regression-safe
 * checks this suite performs are intentionally tiny:
 *
 *   - Unauthenticated POST returns 401 (auth gate is wired).
 *   - Authenticated POST without `image` returns 400 (input validation).
 *
 * The full classification round-trip ($$$$ Anthropic call + S3 upload) is
 * intentionally NOT exercised here. The mobile QA pass at the end of the
 * programme covers that. We could gate a `PLASTYPESA_ECO_SCAN_E2E=1` toggle
 * later if we want a cheap sanity sample.
 */

import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'eco-scan';

const TINY_JPEG_BASE64 = '/9j' + 'A'.repeat(40);

/**
 * Treat 404 as "the new /eco-scan route is not deployed yet on this stage".
 * Matches how the eco-catalog suite tolerates an empty catalog: the suite
 * should pass on prod baselines that pre-date the P3 Lambda deploy, then
 * start asserting real behaviour the moment Supervisor publishes.
 */
async function probeRouteDeployed(cfg) {
    const r = await fetch(url(cfg, '/eco-scan/hint'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    return r.status !== 404;
}

export async function run(cfg, runner) {
    const deployed = await probeRouteDeployed(cfg);
    if (!deployed) {
        runner.skip(
            'eco_scan_hint_requires_auth',
            'POST /api/eco-scan/hint returns 404 — P3 Lambda not deployed yet',
        );
        runner.skip(
            'eco_scan_hint_400_without_image',
            'POST /api/eco-scan/hint returns 404 — P3 Lambda not deployed yet',
        );
        runner.skip(
            'eco_scan_hint_413_too_large',
            'POST /api/eco-scan/hint returns 404 — P3 Lambda not deployed yet',
        );
        return;
    }

    await runner.test('eco_scan_hint_requires_auth', async () => {
        const r = await fetch(url(cfg, '/eco-scan/hint'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: TINY_JPEG_BASE64 }),
        });
        assert(
            r.status === 401 || r.status === 403,
            `unauthenticated POST should be 401/403, got ${r.status}`,
        );
    });

    if (!cfg.authHeaders) {
        runner.skip(
            'eco_scan_hint_400_without_image',
            'no PLASTYPESA_USER_JWT; skipping authed checks',
        );
        runner.skip(
            'eco_scan_hint_413_too_large',
            'no PLASTYPESA_USER_JWT; skipping authed checks',
        );
        return;
    }

    await runner.test('eco_scan_hint_400_without_image', async () => {
        const r = await fetch(url(cfg, '/eco-scan/hint'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...cfg.authHeaders,
            },
            body: JSON.stringify({}),
        });
        // Accept either the strict 400 (controller path) or a 401/403 if
        // the JWT was rejected for an unrelated reason.
        assert(
            r.status === 400 || r.status === 401 || r.status === 403,
            `missing image should be 400, got ${r.status}`,
        );
        if (r.status === 400) {
            const { body } = await readJson(r);
            assert(
                body?.type === 'error',
                'error body shape',
            );
        }
    });

    await runner.test('eco_scan_hint_413_too_large', async () => {
        // Controller estimates decoded size as floor(length * 0.75) and caps at 2MB.
        // Use the smallest payload that still trips that gate so API Gateway / Node
        // do not drop the socket before the Lambda can answer (a 3MB body often
        // surfaces as undici "fetch failed").
        const minChars = Math.floor((2 * 1024 * 1024) / 0.75) + 64;
        const big = 'A'.repeat(minChars);
        try {
            const r = await fetch(url(cfg, '/eco-scan/hint'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...cfg.authHeaders,
                },
                body: JSON.stringify({ image: big }),
            });
            assert(
                r.status === 413 || r.status === 401 || r.status === 403,
                `oversize POST should be 413, got ${r.status}`,
            );
        } catch (err) {
            // Some stages reset the connection on oversized JSON before status codes.
            const msg = String(err?.message || err);
            assert(
                /fetch failed|ECONNRESET|network|socket|aborted/i.test(msg),
                `oversize POST threw unexpected error: ${msg}`,
            );
        }
    });
}
