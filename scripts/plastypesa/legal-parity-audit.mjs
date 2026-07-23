/**
 * BUILD 50 — legal parity audit: same Mongo masters served to app + landing (via /api/master).
 * Also spot-checks live plastypesa.com legal routes render (title markers).
 *
 * Run: node scripts/plastypesa/legal-parity-audit.mjs
 */
import crypto from 'crypto';
import { getConfig, url } from './config.mjs';

const cfg = getConfig();

const LANGS = ['en', 'it', 'es', 'de', 'fr', 'pt', 'ro'];
const DOCS = ['privacy-policy', 'terms-of-us', 'gdpr-compliance'];
const LANDING_PATH = {
  'privacy-policy': 'privacy-policy',
  'terms-of-us': 'terms-of-use',
  'gdpr-compliance': 'gdpr-compliance',
};
const UPDATE_LABEL = {
  en: 'Last updated:',
  it: 'Ultimo aggiornamento:',
  es: 'Última actualización:',
  de: 'Zuletzt aktualisiert:',
  fr: 'Dernière mise à jour',
  pt: 'Última atualização:',
  ro: 'Ultima actualizare:',
};
const BRAND_BAD = /\b(prize|prizes|lottery|gambl\w*|winnings)\b/i;
const PRODUCT_MARKERS_TERMS = [
  /read|article|learning/i,
  /quiz/i,
  /EcoSort|eco.?sort|sorting game/i,
  /point/i,
  /reward/i,
  /Ads may be|advertis|AdMob|Google Mobile Ads/i,
];

async function fetchMaster(name, lang) {
  const r = await fetch(url(cfg, `/master?name=${name}&lang=${lang}`), {
    headers: cfg.headersJson,
  });
  const body = await r.json();
  const html = body?.data?.[0]?.metadata?.[0] ?? body?.data?.metadata?.[0] ?? '';
  const metadata = body?.data?.metadata ?? body?.data?.[0]?.metadata ?? [];
  return {
    status: r.status,
    html: typeof html === 'string' ? html : '',
    metadata: Array.isArray(metadata) ? metadata : [],
  };
}

function hash(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

async function fetchLanding(lang, docKey) {
  const path = LANDING_PATH[docKey];
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const pageUrl = `https://plastypesa.com${prefix}/${path}`;
  const r = await fetch(pageUrl, { headers: { 'User-Agent': 'NeoXten-legal-parity/1.0' } });
  const text = await r.text();
  return { status: r.status, text };
}

let fail = 0;
let pass = 0;

function ok(name) {
  pass += 1;
  console.log(`  PASS  ${name}`);
}
function bad(name, detail) {
  fail += 1;
  console.log(`  FAIL  ${name} — ${detail}`);
}

console.log('\n=== Legal parity audit (BUILD 50) ===\n');
console.log(`API: ${cfg.apiBase}\n`);

for (const lang of LANGS) {
  for (const doc of DOCS) {
    const label = UPDATE_LABEL[lang];
    try {
      const { status, html } = await fetchMaster(doc, lang);
      if (status !== 200) {
        bad(`${doc}/${lang} api`, `status ${status}`);
        continue;
      }
      if (html.length < 1000) {
        bad(`${doc}/${lang} api`, `html too short (${html.length})`);
        continue;
      }
      const plain = html.replace(/<[^>]+>/g, ' ');
      if (!plain.includes(label.split(':')[0])) {
        bad(`${doc}/${lang} api`, `missing update label`);
        continue;
      }
      if (BRAND_BAD.test(plain)) {
        bad(`${doc}/${lang} api`, 'brand-violating word');
        continue;
      }
      if (plain.includes('draw entries')) {
        bad(`${doc}/${lang} api`, 'legacy draw entries copy');
        continue;
      }
      if (doc === 'terms-of-us' && lang === 'en') {
        let termsOk = true;
        for (const re of PRODUCT_MARKERS_TERMS) {
          if (!re.test(plain)) {
            bad(`${doc}/${lang} api`, `missing product marker ${re}`);
            termsOk = false;
            break;
          }
        }
        if (!termsOk) continue;
      }
      ok(`${doc}/${lang} api (${html.length} chars, sha ${hash(html)})`);
    } catch (e) {
      bad(`${doc}/${lang} api`, e.message);
    }
  }
}

console.log('\n--- Landing spot-check (EN + RO terms, privacy) ---\n');
for (const [lang, doc] of [
  ['en', 'terms-of-us'],
  ['en', 'privacy-policy'],
  ['ro', 'terms-of-us'],
]) {
  try {
    const { status, text } = await fetchLanding(lang, doc);
    if (status !== 200) {
      bad(`landing ${lang}/${doc}`, `status ${status}`);
      continue;
    }
    if (!text.includes('PlastyPesa') && !text.includes('plastypesa')) {
      bad(`landing ${lang}/${doc}`, 'missing brand');
      continue;
    }
    if (text.includes('draw entries')) {
      bad(`landing ${lang}/${doc}`, 'draw entries in page shell');
      continue;
    }
    ok(`landing ${lang}/${LANDING_PATH[doc]} shell (${text.length} bytes)`);
  } catch (e) {
    bad(`landing ${lang}/${doc}`, e.message);
  }
}

console.log('\n--- In-app help-app FAQ (earn + read cap) ---\n');
try {
  const { metadata } = await fetchMaster('help-app', 'en');
  const earn = metadata.find((e) => /how do i earn points/i.test(e.headerText || ''));
  const earnText = earn?.bodyText || '';
  if (/1,?000|1000/.test(earnText) && /Daily Quiz/i.test(earnText)) {
    ok('help-app/en daily quiz 1000 pts');
  } else {
    bad('help-app/en earn', 'daily quiz not 1000 pts');
  }
  if (/5.*article|up to 5/i.test(earnText)) {
    ok('help-app/en read cap (~5 articles)');
  } else {
    bad('help-app/en earn', 'read-reward cap not found');
  }
  if (/450/.test(earnText)) {
    ok('help-app/en EcoSort 450 cap');
  } else {
    bad('help-app/en earn', 'EcoSort 450 cap not found');
  }
} catch (e) {
  bad('help-app/en', e.message);
}

console.log('\n--- Landing FAQ JSON (no voucher promise in EN) ---\n');
try {
  const r = await fetch('https://plastypesa.com/locales/en/faq.json', {
    headers: { 'User-Agent': 'NeoXten-legal-parity/1.0' },
  });
  const faq = await r.json();
  const reward = (faq.items || []).find((i) => /receive my eco reward/i.test(i.q || ''));
  const bonus = (faq.items || []).find((i) => /bonus quiz/i.test(i.q || ''));
  if (reward && !/digital voucher|24 hours/i.test(reward.a || '')) {
    ok('landing faq/en reward delivery recognition-safe');
  } else {
    bad('landing faq/en reward', 'still promises digital voucher / 24h email');
  }
  if (bonus && /150/.test(bonus.a || '') && /750/.test(bonus.a || '')) {
    ok('landing faq/en bonus vault 150/750');
  } else {
    bad('landing faq/en bonus', 'bonus vault numbers stale');
  }
} catch (e) {
  bad('landing faq/en', e.message);
}

console.log(`\n=== Summary: ${pass} pass, ${fail} fail ===\n`);
process.exit(fail > 0 ? 1 : 0);
