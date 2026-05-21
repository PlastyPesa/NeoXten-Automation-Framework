/**
 * P7 — B2B impact API regression.
 *
 * Proves on the live API:
 *   1. GET /api/b2b/impact returns 401 without an Authorization header.
 *   2. GET /api/b2b/impact returns 401 for a clearly bogus bearer token
 *      (so token verification actually runs).
 *   3. (Optional) When PLASTYPESA_B2B_TOKEN is set, GET /api/b2b/impact
 *      returns 200 with an envelope that satisfies the P7 shape
 *      contract — `range`, `totals`, `buckets[]`, `suppressed`, and
 *      `meta.minDistinctUsersPerBucket >= 5` — and never leaks any user
 *      identifier in the response body (no `userId`, no `_id`, no
 *      `email`).
 *
 * This suite is deliberately read-only and safe to run in prod.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'b2b-impact';

const FORBIDDEN_KEYS = ['userId', 'email', '_id', 'phone'];

function deepFindForbidden(node, path = '$') {
    if (node == null) return null;
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
            const hit = deepFindForbidden(node[i], `${path}[${i}]`);
            if (hit) return hit;
        }
        return null;
    }
    if (typeof node === 'object') {
        for (const key of Object.keys(node)) {
            if (FORBIDDEN_KEYS.includes(key)) {
                return `${path}.${key}`;
            }
            const hit = deepFindForbidden(node[key], `${path}.${key}`);
            if (hit) return hit;
        }
    }
    return null;
}

export async function run(cfg, runner) {
    // ---- 1. Unauthenticated → 401 ----------------------------------------
    await runner.test('b2b_impact_requires_bearer_token', async () => {
        const r = await fetch(url(cfg, '/b2b/impact'), { method: 'GET' });
        assert(
            r.status === 401,
            `expected 401 without bearer token, got ${r.status}`,
        );
    });

    // ---- 2. Bogus token → 401 --------------------------------------------
    await runner.test('b2b_impact_rejects_bogus_bearer_token', async () => {
        const r = await fetch(url(cfg, '/b2b/impact'), {
            method: 'GET',
            headers: { Authorization: 'Bearer pp_b2b_not_a_real_token_123456' },
        });
        assert(
            r.status === 401,
            `expected 401 for unknown bearer token, got ${r.status}`,
        );
    });

    // ---- 3. (optional) authenticated shape + privacy ---------------------
    const b2bToken = process.env.PLASTYPESA_B2B_TOKEN;
    if (!b2bToken || b2bToken.trim().length === 0) {
        runner.skip(
            'b2b_impact_authenticated_shape_and_privacy',
            'PLASTYPESA_B2B_TOKEN not set — skipping live envelope check',
        );
        return;
    }

    await runner.test(
        'b2b_impact_authenticated_shape_and_privacy',
        async () => {
            const r = await fetch(url(cfg, '/b2b/impact'), {
                method: 'GET',
                headers: { Authorization: `Bearer ${b2bToken.trim()}` },
            });
            const { body, text } = await readJson(r);
            assert(
                r.status === 200,
                `expected 200 with valid B2B token, got ${r.status}: ${text.slice(0, 300)}`,
            );
            assert(body && body.type === 'success', 'success envelope');
            const data = body && body.data;
            assert(data, 'data must be present');
            assert(
                data.range && data.range.from && data.range.to,
                'range.from + range.to required',
            );
            assert(data.totals, 'totals required');
            assert(
                typeof data.totals.verifiedActions === 'number',
                'totals.verifiedActions must be a number',
            );
            assert(
                typeof data.totals.estimatedKg === 'number',
                'totals.estimatedKg must be a number',
            );
            assert(
                typeof data.totals.contributingUsers === 'number',
                'totals.contributingUsers must be a number',
            );
            assert(Array.isArray(data.buckets), 'buckets must be an array');
            assert(data.suppressed, 'suppressed required');
            assert(
                typeof data.suppressed.buckets === 'number',
                'suppressed.buckets must be a number',
            );
            assert(
                data.meta &&
                    typeof data.meta.minDistinctUsersPerBucket === 'number' &&
                    data.meta.minDistinctUsersPerBucket >= 5,
                'meta.minDistinctUsersPerBucket must be >= 5 (k-anonymity contract)',
            );
            const leaked = deepFindForbidden(data);
            assert(
                !leaked,
                `B2B response must not contain user identifiers; found at ${leaked}`,
            );
        },
    );
}
