/**
 * P8 — GDPR self-service API regression.
 *
 * Proves on the live API:
 *   1. Unauthenticated callers cannot reach any GDPR endpoint (401).
 *   2. The four GDPR endpoints all live under /api/user/me/gdpr and
 *      require a Bearer JWT.
 *   3. When authenticated:
 *        a. POST /export-request → 200 (issues a GDPR_EXPORT OTP)
 *        b. POST /export with no OTP → 400 (gate enforced)
 *        c. POST /export with bogus OTP → 400 (gate enforced)
 *        d. POST /delete with no OTP → 400 (gate enforced)
 *        e. POST /delete with bogus OTP → 400 (gate enforced)
 *
 * The destructive `delete` path is NEVER exercised end-to-end against
 * the live API by this suite — that would actually wipe a real test
 * account. The OTP gate is the strongest safety we can verify without
 * a disposable account.
 *
 * Set PLASTYPESA_GDPR_LIVE_EXPORT=1 + supply a fresh OTP via stdin
 * (out of scope for CI) to exercise the success path manually.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'gdpr';

const ENDPOINTS = [
    '/user/me/gdpr/export-request',
    '/user/me/gdpr/export',
    '/user/me/gdpr/delete-request',
    '/user/me/gdpr/delete',
];

export async function run(cfg, runner) {
    // ---- 1. Every endpoint must reject unauthenticated callers --------
    for (const path of ENDPOINTS) {
        await runner.test(`gdpr_${path.replace(/[^a-z0-9]+/gi, '_')}_requires_auth`, async () => {
            const r = await fetch(url(cfg, path), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            assert(
                r.status === 401 || r.status === 403,
                `expected 401/403 unauth for ${path}, got ${r.status}`,
            );
        });
    }

    if (!cfg.authHeaders) {
        runner.skip(
            'gdpr_authenticated_gate_suite',
            'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
        );
        return;
    }

    const jsonHeaders = { ...cfg.authHeaders, 'Content-Type': 'application/json' };

    // ---- 2. export-request issues an OTP -------------------------------
    await runner.test('gdpr_export_request_sends_otp', async () => {
        const r = await fetch(url(cfg, '/user/me/gdpr/export-request'), {
            method: 'POST',
            headers: jsonHeaders,
            body: '{}',
        });
        const { body, text } = await readJson(r);
        assert(
            r.status === 200,
            `expected 200 from export-request, got ${r.status}: ${text.slice(0, 300)}`,
        );
        assert(body?.type === 'success', 'success envelope');
    });

    // ---- 3. export rejects missing / bogus OTP -------------------------
    await runner.test('gdpr_export_rejects_missing_otp', async () => {
        const r = await fetch(url(cfg, '/user/me/gdpr/export'), {
            method: 'POST',
            headers: jsonHeaders,
            body: '{}',
        });
        assert(r.status === 400, `expected 400 when OTP missing, got ${r.status}`);
    });

    await runner.test('gdpr_export_rejects_bogus_otp', async () => {
        const r = await fetch(url(cfg, '/user/me/gdpr/export'), {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({ otp: '000000' }),
        });
        assert(r.status === 400, `expected 400 when OTP bogus, got ${r.status}`);
    });

    // ---- 4. delete rejects missing / bogus OTP -------------------------
    await runner.test('gdpr_delete_rejects_missing_otp', async () => {
        const r = await fetch(url(cfg, '/user/me/gdpr/delete'), {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({
                confirmEmail: 'definitely-not-real@example.com',
                confirmPhrase: 'DELETE_ACCOUNT_PERMANENTLY',
            }),
        });
        assert(r.status === 400, `expected 400 when OTP missing on delete, got ${r.status}`);
    });

    await runner.test('gdpr_delete_rejects_bogus_otp', async () => {
        const r = await fetch(url(cfg, '/user/me/gdpr/delete'), {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({
                otp: '000000',
                confirmEmail: 'definitely-not-real@example.com',
                confirmPhrase: 'DELETE_ACCOUNT_PERMANENTLY',
            }),
        });
        assert(r.status === 400, `expected 400 when OTP bogus on delete, got ${r.status}`);
    });

    // ---- 5. (optional, manual) live export round-trip ------------------
    if (process.env.PLASTYPESA_GDPR_LIVE_EXPORT === '1' && process.env.PLASTYPESA_GDPR_OTP) {
        await runner.test('gdpr_export_live_round_trip', async () => {
            const otp = process.env.PLASTYPESA_GDPR_OTP.trim();
            const r = await fetch(url(cfg, '/user/me/gdpr/export'), {
                method: 'POST',
                headers: jsonHeaders,
                body: JSON.stringify({ otp }),
            });
            const { body, text } = await readJson(r);
            assert(
                r.status === 200,
                `expected 200 from live export, got ${r.status}: ${text.slice(0, 300)}`,
            );
            assert(body?.type === 'success', 'success envelope');
            const data = body?.data;
            assert(data?.meta?.userId, 'meta.userId required');
            assert(data?.profile, 'profile required');
            assert(Array.isArray(data?.transactions), 'transactions[] required');
            assert(
                data.profile.password === undefined,
                'export must redact profile.password',
            );
            assert(
                data.profile.totpSecret === undefined,
                'export must redact profile.totpSecret',
            );
        });
    } else {
        runner.skip(
            'gdpr_export_live_round_trip',
            'PLASTYPESA_GDPR_LIVE_EXPORT/OTP not set — manual OTP path skipped',
        );
    }
}
