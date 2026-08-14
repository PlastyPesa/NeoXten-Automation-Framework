/**
 * P-SHARE-LINK-HYGIENE (2026-08-14) — what a member forwards must actually open.
 *
 * Two defects shipped in `GET /home/share-card/:type` and the impact report, and
 * neither was visible from inside the app, because the damage only ever appeared
 * in somebody else's WhatsApp:
 *
 *   * Both hardcoded the Play id `com.plastypesa.plastypesa`. It reads correct and
 *     returns 404. The real id is `com.app.plasty_pesa`. So every quiz-result,
 *     Plastic IQ, pledge and badge share pointed a friend who was curious enough
 *     to tap at a dead listing — the most expensive place in the funnel to lose
 *     an install.
 *   * The same strings were written UTF-8 and re-read Latin-1, so "CO2" arrived as
 *     accented junk and the globe/recycle emoji as garbage.
 *
 * A unit test guards the source string. It cannot tell you that a link 404s, and
 * it cannot tell you the deployed Lambda is actually serving the fix — the whole
 * class of bug here was "the code looks right and the member's friend still hits
 * a wall". So this suite reads the live share text and then resolves the Play URL
 * over the network.
 *
 * Reads only, as our own test member. Nothing a real person wrote is touched.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'share-link-live';

/** The Play `applicationId`. Anything else 404s. */
const CORRECT_ID = 'com.app.plasty_pesa';

/** Ids that read plausible and are dead. Both have been in the codebase. */
const DEAD_IDS = ['com.plastypesa.plastypesa', 'com.plastypesa.app'];

/** Lead bytes of UTF-8 sequences misread as Latin-1. */
const MOJIBAKE = /[\u00c2\u00c3\u00e2\u00f0]/;

/** Never in anything a member forwards. */
const BANNED_WORDING = /\b(prize|prizes|lottery|jackpot|gambl\w*|raffle|winnings)\b/i;

const PLAY_URL = /https:\/\/play\.google\.com\/store\/apps\/details\?id=[\w.]+/g;

/** Every share string a member can send, and where it lives in the response. */
const SHARE_SOURCES = [
  { name: 'quiz-result', path: '/home/share-card/quiz-result', pick: (j) => j?.data?.text },
  { name: 'plastic-iq', path: '/home/share-card/plastic-iq', pick: (j) => j?.data?.text },
  { name: 'pledge-impact', path: '/home/share-card/pledge-impact', pick: (j) => j?.data?.text },
  {
    name: 'badge-earned',
    path: '/home/share-card/badge-earned?badgeName=Sorter',
    pick: (j) => j?.data?.text,
  },
  { name: 'impact-report', path: '/home/impact-report', pick: (j) => j?.data?.shareText },
];

export async function run(cfg, runner) {
  if (!cfg.authHeaders) {
    runner.skip(
      'share_link_hygiene',
      'No JWT — set PLASTYPESA_USER_JWT or PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD',
    );
    return;
  }

  /** Collected across sources so we can assert they all agree on one listing. */
  const seenLinks = new Set();

  for (const src of SHARE_SOURCES) {
    await runner.test(`share_text_is_safe_to_forward_${src.name}`, async () => {
      const res = await fetch(url(cfg, src.path), { headers: cfg.authHeaders });
      const { body } = await readJson(res);

      assert(res.status === 200, `${src.path} returned ${res.status}`);

      const text = src.pick(body);
      assert(
        typeof text === 'string' && text.trim().length > 0,
        `${src.path} returned no share text — the phone would forward an empty message`,
      );

      const dead = DEAD_IDS.filter((d) => text.includes(d));
      assert(
        dead.length === 0,
        `${src.name} still points at ${dead.join(', ')} — that Play listing 404s, so the friend who taps gets "not found" instead of the app`,
      );

      assert(
        text.includes(CORRECT_ID),
        `${src.name} carries no Play link with the real id ${CORRECT_ID}: ${text.slice(0, 120)}`,
      );

      assert(
        !MOJIBAKE.test(text),
        `${src.name} would arrive garbled in WhatsApp: ${text.slice(0, 120)}`,
      );

      const banned = text.match(BANNED_WORDING);
      assert(
        !banned,
        `${src.name} uses banned wording "${banned?.[0]}" — forwarded copy must stay earn/reward`,
      );

      for (const m of text.match(PLAY_URL) || []) seenLinks.add(m);
    });
  }

  await runner.test('share_link_all_sources_agree_on_one_listing', async () => {
    assert(seenLinks.size > 0, 'no Play link found in any share text');
    assert(
      seenLinks.size === 1,
      `share copy points at ${seenLinks.size} different listings, so at least one is wrong: ${[...seenLinks].join(' | ')}`,
    );
  });

  // The point of the whole suite: prove the link opens, not that it looks right.
  await runner.test('share_link_resolves_on_play', async () => {
    for (const link of seenLinks) {
      const res = await fetch(link, { redirect: 'follow' });
      assert(
        res.status === 200,
        `${link} returned ${res.status} — a member forwarding this sends their friend to a dead Play listing`,
      );
    }
  });
}
