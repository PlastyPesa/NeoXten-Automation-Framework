/**
 * P-LEARN-CONTENT-LOCALE-MIX — Learn tip/article bodies must localize.
 *
 * Chrome (GetX .tr) can show "Sfatul Zilei" while CMS still serves English
 * tip/article titles. The API overlays translations[lang] when present; this
 * suite fails when ACTIVE tips / learn articles leak English for ro + de.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'learn-content-locale-mix';

function tipList(body) {
  const d = body?.data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.tips)) return d.tips;
  return [];
}

function articleList(body) {
  const d = body?.data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.articles)) return d.articles;
  return [];
}

async function getLang(cfg, path, lang) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(url(cfg, `${path}${sep}lang=${lang}`), {
    headers: { 'X-Language': lang, ...(cfg.authHeaders || {}) },
  });
  const { body, text } = await readJson(r);
  assert(r.status === 200, `${path} lang=${lang} -> ${r.status}: ${text.slice(0, 160)}`);
  return body;
}

function differs(a, b) {
  return String(a || '').trim() !== '' && String(a || '').trim() !== String(b || '').trim();
}

export async function run(cfg, runner) {
  let tipSnapshot = null;
  let artSnapshot = null;

  await runner.test('daily_tips_localize_for_ro_and_de', async () => {
    const enTipsBody = await getLang(cfg, '/home/daily-tips', 'en');
    const roTipsBody = await getLang(cfg, '/home/daily-tips', 'ro');
    const deTipsBody = await getLang(cfg, '/home/daily-tips', 'de');
    // Ignore empty CMS placeholder slots (status ACTIVE but no title).
    const pick = (list) => (list || []).filter((t) => String(t?.name || '').trim());
    const enTips = pick(tipList(enTipsBody));
    const roTips = pick(tipList(roTipsBody));
    const deTips = pick(tipList(deTipsBody));

    assert(enTips.length > 0, 'daily-tips must return at least one tip with a name');
    assert(
      enTips.length === roTips.length && enTips.length === deTips.length,
      `tip list length must match across langs (en=${enTips.length} ro=${roTips.length} de=${deTips.length})`
    );

    let tipRoOk = 0;
    let tipDeOk = 0;
    for (let i = 0; i < enTips.length; i += 1) {
      if (differs(roTips[i]?.name, enTips[i]?.name)) tipRoOk += 1;
      if (differs(deTips[i]?.name, enTips[i]?.name)) tipDeOk += 1;
    }
    tipSnapshot = { tipRoOk, tipDeOk, n: enTips.length, en0: enTips[0]?.name, ro0: roTips[0]?.name };
    console.log(
      `[learn-content-locale-mix] tips localized: ro ${tipRoOk}/${enTips.length}, de ${tipDeOk}/${enTips.length}`
    );
    assert(
      tipRoOk === enTips.length,
      `every named ACTIVE tip must localize for ro (got ${tipRoOk}/${enTips.length}); sample en="${(enTips[0]?.name || '').slice(0, 40)}" ro="${(roTips[0]?.name || '').slice(0, 40)}"`
    );
    assert(
      tipDeOk === enTips.length,
      `every named ACTIVE tip must localize for de (got ${tipDeOk}/${enTips.length})`
    );
  });

  await runner.test('learn_articles_localize_titles_for_ro_and_de', async () => {
    const enLearn = await getLang(cfg, '/home/learn-content', 'en');
    const roLearn = await getLang(cfg, '/home/learn-content', 'ro');
    const deLearn = await getLang(cfg, '/home/learn-content', 'de');
    const enArts = articleList(enLearn).filter((a) => (a.status || 'ACTIVE') === 'ACTIVE');
    const roArts = articleList(roLearn).filter((a) => (a.status || 'ACTIVE') === 'ACTIVE');
    const deArts = articleList(deLearn).filter((a) => (a.status || 'ACTIVE') === 'ACTIVE');

    assert(enArts.length > 0, 'learn-content must return ACTIVE articles');
    assert(
      enArts.length === roArts.length && enArts.length === deArts.length,
      'article list length must match across langs'
    );

    let artRoOk = 0;
    let artDeOk = 0;
    const leaks = [];
    for (let i = 0; i < enArts.length; i += 1) {
      const enT = enArts[i]?.title;
      const roT = roArts[i]?.title;
      const deT = deArts[i]?.title;
      if (differs(roT, enT)) artRoOk += 1;
      else leaks.push(`ro:${enT}`);
      if (differs(deT, enT)) artDeOk += 1;
      else leaks.push(`de:${enT}`);
    }
    artSnapshot = { artRoOk, artDeOk, n: enArts.length, enArts, roArts };
    console.log(
      `[learn-content-locale-mix] articles localized: ro ${artRoOk}/${enArts.length}, de ${artDeOk}/${enArts.length}`
    );
    assert(
      artRoOk === enArts.length,
      `every ACTIVE learn article title must localize for ro (got ${artRoOk}/${enArts.length}); leaks=${leaks.slice(0, 5).join(' | ')}`
    );
    assert(
      artDeOk === enArts.length,
      `every ACTIVE learn article title must localize for de (got ${artDeOk}/${enArts.length}); leaks=${leaks.filter((x) => x.startsWith('de:')).slice(0, 5).join(' | ')}`
    );
  });

  await runner.test('first_learn_article_body_localizes_for_ro', async () => {
    assert(artSnapshot, 'article snapshot missing — prior test failed');
    const en = artSnapshot.enArts[0];
    const ro = artSnapshot.roArts[0];
    assert(
      differs(ro?.content || ro?.description, en?.content || en?.description),
      `first article body/description must localize for ro (en title="${(en?.title || '').slice(0, 40)}")`
    );
  });
}
