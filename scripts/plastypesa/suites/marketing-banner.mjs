/**
 * P-INAPP-MARKETING-BANNER (2026-07-27) — the pinned campaign contract.
 *
 * The first Kenya campaign shipped with five of seven locales silently serving
 * English. Nothing failed: `translateAnnouncementText` ran six Sonnet calls
 * with `max_tokens: 256`, long-form campaign copy overran that, the replies
 * were cut mid-string, `JSON.parse` threw, and the catch substituted the
 * English source. The publish script reported success, the admin API echoed a
 * healthy config, and only a per-language read of the endpoint the app calls
 * showed the fallback. That is precisely the shape of bug a repo test cannot
 * see, because the English source is always present and always valid.
 *
 * So this suite reads `GET /home/active-in-app-banner` once per supported
 * language, as the user's own device would, and asserts:
 *
 *   1. every non-English locale differs from the English source (a real
 *      translation, not a fallback),
 *   2. no locale carries gambling vocabulary — including the words that only
 *      read as gambling in one language, e.g. French "cagnotte",
 *   3. a marketing campaign really is auto-dismiss (`persistOnScreen: false`,
 *      a short `bannerDurationSec`), because the server force-pins anything
 *      published as `untilAdminDismiss` and that combination is what put a
 *      permanent banner on Home once already.
 *
 * Mutates the test account's `preferredLanguage` and restores it at the end.
 * Skips cleanly when no campaign is pinned — an empty slot is a normal state,
 * not a failure.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'marketing-banner';

const LANGS = ['en', 'it', 'es', 'pt', 'ro', 'de', 'fr'];

/**
 * Gambling wording per language. Mirrors GAMBLING_TERMS in
 * `announcement-i18n.js`; kept as a copy on purpose so a loosening of the
 * server-side gate cannot quietly loosen the test that guards it.
 *
 * The everyday earn-verbs are deliberately absent: "gagner des points" and
 * "câștigi puncte" are how French and Romanian say earn, and banning them
 * would push correct copy back to English.
 */
const GAMBLING = {
  en: /\b(lotter(?:y|ies)|jackpot|prizes?|sweepstakes?|gambling|winner|winnings)\b/i,
  it: /\b(lotteri[ae]|jackpot|montepremi|sorteggi[oi]|vincitor[ei])\b/i,
  es: /\b(loter[íi]as?|jackpot|sorteos?|bote|ganadores?)\b/i,
  de: /\b(lotterie|jackpot|gewinnspiel|verlosung|gewinner)\b/i,
  fr: /\b(loteries?|jackpot|cagnottes?|tirage au sort|gagnants?)\b/i,
  pt: /\b(lot(?:a|e)rias?|jackpot|sorteios?|vencedor(?:es)?)\b/i,
  ro: /\b(loterie|jackpot|tragere la sor[țt]i|c[âa][șs]tig[ăa]tor)\b/i,
};

/** A banner the user is meant to read in passing, not dismiss. */
const MAX_MARKETING_DURATION_SEC = 30;

async function setLanguage(cfg, language) {
  const r = await fetch(url(cfg, '/user/language'), {
    method: 'PUT',
    headers: { ...cfg.authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  const { text } = await readJson(r);
  assert(r.status === 200, `PUT /user/language ${language} -> ${r.status}: ${text.slice(0, 200)}`);
}

async function fetchBanner(cfg) {
  const r = await fetch(url(cfg, '/home/active-in-app-banner'), {
    headers: cfg.authHeaders,
  });
  const { body, text } = await readJson(r);
  if (r.status !== 200) {
    throw new Error(`home/active-in-app-banner ${r.status}: ${text.slice(0, 200)}`);
  }
  return body?.data?.banner ?? null;
}

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'marketing_banner_contract',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  /** @type {Map<string, object>} */
  const byLang = new Map();
  let pinned = null;
  let originalLanguage = 'en';

  await runner.test('pinned_campaign_resolves_in_every_supported_language', async () => {
    pinned = await fetchBanner(cfg);
    if (!pinned) {
      runner.skip(
        'pinned_campaign_resolves_in_every_supported_language',
        'no campaign pinned right now — nothing to localize',
      );
      return;
    }
    for (const lang of LANGS) {
      await setLanguage(cfg, lang);
      const banner = await fetchBanner(cfg);
      assert(
        banner !== null,
        `banner disappeared for preferredLanguage=${lang} — the campaign is pinned, so every language must resolve it`,
      );
      assert(
        typeof banner.title === 'string' && banner.title.trim().length > 0,
        `banner [${lang}] has an empty title`,
      );
      byLang.set(lang, banner);
    }
    originalLanguage = 'en';
  });

  await runner.test('no_locale_silently_falls_back_to_english', async () => {
    if (!pinned || byLang.size === 0) {
      runner.skip('no_locale_silently_falls_back_to_english', 'no campaign pinned');
      return;
    }
    const english = byLang.get('en');
    const fellBack = LANGS.filter((lang) => lang !== 'en').filter((lang) => {
      const b = byLang.get(lang);
      return b.title === english.title && b.message === english.message;
    });
    assert(
      fellBack.length === 0,
      `campaign copy is still English for [${fellBack.join(', ')}] — translateAnnouncementText fell back for these locales (check the Lambda log for "FELL BACK TO ENGLISH")`,
    );
  });

  await runner.test('campaign_copy_is_brand_safe_in_every_language', async () => {
    if (!pinned || byLang.size === 0) {
      runner.skip('campaign_copy_is_brand_safe_in_every_language', 'no campaign pinned');
      return;
    }
    for (const lang of LANGS) {
      const b = byLang.get(lang);
      const hit = `${b.title} ${b.message}`.match(GAMBLING[lang]);
      assert(
        hit === null,
        `campaign [${lang}] reads as gambling: "${hit?.[0]}" — reward/earn wording only`,
      );
    }
  });

  await runner.test('auto_dismiss_campaign_is_not_pinned_until_admin_clears_it', async () => {
    if (!pinned) {
      runner.skip('auto_dismiss_campaign_is_not_pinned_until_admin_clears_it', 'no campaign pinned');
      return;
    }
    const ib = pinned.inAppBanner ?? {};
    if (pinned.untilAdminDismiss === true) {
      // An operational notice — persistence is correct for it. Assert the
      // server really did force the flag, since the client reads that, not
      // the campaign-level switch.
      assert(
        ib.persistOnScreen === true,
        'untilAdminDismiss campaign must carry persistOnScreen: true or the client will auto-hide an outage notice',
      );
      return;
    }
    assert(
      ib.persistOnScreen === false,
      'a marketing campaign must not set persistOnScreen — it would sit on Home until tapped away',
    );
    assert(
      Number.isInteger(ib.bannerDurationSec) &&
        ib.bannerDurationSec >= 1 &&
        ib.bannerDurationSec <= MAX_MARKETING_DURATION_SEC,
      `marketing bannerDurationSec should be a short read, got ${JSON.stringify(ib.bannerDurationSec)}`,
    );
    assert(
      typeof ib.bannerId === 'string' && ib.bannerId.length > 0,
      'campaign needs a bannerId — the client caps one impression per id per day and an empty id disables the cap',
    );
  });

  await runner.test('test_account_language_is_restored', async () => {
    await setLanguage(cfg, originalLanguage);
    const banner = await fetchBanner(cfg);
    if (pinned) {
      assert(
        banner === null || typeof banner.title === 'string',
        'banner endpoint broke after restoring the language',
      );
    }
  });
}
