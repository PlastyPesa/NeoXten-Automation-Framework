/**
 * P1 — Eco catalog suite.
 *
 * The catalog endpoint is public (no JWT), language-aware, and serves a
 * short cache header so CloudFront stays cheap. This suite proves:
 *   - GET /api/eco-catalog returns 200 + the documented shape
 *   - lang query param is honoured for at least 3 of the 7 locales
 *   - Cache-Control header is present
 *   - rows never carry brand-forbidden words (prize/lottery/win)
 *
 * Skipped tests are tolerated when the catalog is empty (the publish
 * script has not been run on this environment yet). The suite still
 * passes — emptiness is a deployment state, not a bug.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'eco-catalog';

const FORBIDDEN = /\b(prize|lottery|gambling|win|winning|winnings)\b/i;

function assertCatalogShape(body) {
    assert(body?.type === 'success', 'type success');
    const d = body?.data;
    assert(d && typeof d === 'object', 'data');
    assert(typeof d.lang === 'string', 'lang string');
    assert(Array.isArray(d.materials), 'materials array');
    assert(Array.isArray(d.actionTypes), 'actionTypes array');
    assert(
        Array.isArray(d.activeLaunchScopeFlags),
        'activeLaunchScopeFlags array',
    );
    return d;
}

function assertMaterialRow(m) {
    assert(typeof m.code === 'string' && m.code.length > 0, 'material.code');
    assert(typeof m.family === 'string', 'material.family');
    assert(typeof m.name === 'string', 'material.name');
    assert(
        Array.isArray(m.launchScopeFlags),
        'material.launchScopeFlags',
    );
    assert(typeof m.version === 'number', 'material.version');
    assert(
        typeof m.publishedVersion === 'number',
        'material.publishedVersion',
    );
    assert(
        !FORBIDDEN.test(m.name || ''),
        `material name has forbidden word: ${m.name}`,
    );
    assert(
        !FORBIDDEN.test(m.shortName || ''),
        `material shortName has forbidden word: ${m.shortName}`,
    );
    assert(
        !FORBIDDEN.test(m.tagline || ''),
        `material tagline has forbidden word: ${m.tagline}`,
    );
}

function assertActionTypeRow(a) {
    assert(typeof a.code === 'string' && a.code.length > 0, 'action.code');
    assert(typeof a.family === 'string', 'action.family');
    assert(typeof a.name === 'string', 'action.name');
    assert(typeof a.groupActionCounts === 'boolean', 'action.groupActionCounts');
    assert(typeof a.version === 'number', 'action.version');
    assert(typeof a.publishedVersion === 'number', 'action.publishedVersion');
    assert(
        !FORBIDDEN.test(a.name || ''),
        `action name has forbidden word: ${a.name}`,
    );
    assert(
        !FORBIDDEN.test(a.description || ''),
        `action description has forbidden word: ${a.description}`,
    );
    assert(
        !FORBIDDEN.test(a.callToAction || ''),
        `action callToAction has forbidden word: ${a.callToAction}`,
    );
}

export async function run(cfg, runner) {
    await runner.test('eco_catalog_get_default_shape', async () => {
        const r = await fetch(url(cfg, '/eco-catalog'), { method: 'GET' });
        const { body, text } = await readJson(r);
        if (r.status !== 200) {
            throw new Error(`eco-catalog ${r.status}: ${text.slice(0, 300)}`);
        }
        const data = assertCatalogShape(body);
        for (const m of data.materials) assertMaterialRow(m);
        for (const a of data.actionTypes) assertActionTypeRow(a);
        const cache = r.headers.get('cache-control') || '';
        assert(/max-age/.test(cache), 'cache-control header present');
    });

    await runner.test('eco_catalog_lang_honoured_for_en_it_ro', async () => {
        for (const lang of ['en', 'it', 'ro']) {
            const r = await fetch(url(cfg, `/eco-catalog?lang=${lang}`), {
                method: 'GET',
            });
            const { body, text } = await readJson(r);
            if (r.status !== 200) {
                throw new Error(
                    `eco-catalog?lang=${lang} ${r.status}: ${text.slice(0, 300)}`,
                );
            }
            const data = assertCatalogShape(body);
            assert(
                data.lang === lang,
                `expected lang=${lang}, got ${data.lang}`,
            );
        }
    });

    await runner.test('eco_catalog_x_language_header_honoured', async () => {
        const r = await fetch(url(cfg, '/eco-catalog'), {
            method: 'GET',
            headers: { 'X-Language': 'fr' },
        });
        const { body, text } = await readJson(r);
        if (r.status !== 200) {
            throw new Error(
                `eco-catalog X-Language=fr ${r.status}: ${text.slice(0, 300)}`,
            );
        }
        const data = assertCatalogShape(body);
        assert(data.lang === 'fr', `expected lang=fr, got ${data.lang}`);
    });

    await runner.test('eco_catalog_invalid_lang_falls_back_to_en', async () => {
        const r = await fetch(url(cfg, '/eco-catalog?lang=zz'), {
            method: 'GET',
        });
        const { body, text } = await readJson(r);
        if (r.status !== 200) {
            throw new Error(
                `eco-catalog?lang=zz ${r.status}: ${text.slice(0, 300)}`,
            );
        }
        const data = assertCatalogShape(body);
        assert(data.lang === 'en', `expected fallback en, got ${data.lang}`);
    });
}
