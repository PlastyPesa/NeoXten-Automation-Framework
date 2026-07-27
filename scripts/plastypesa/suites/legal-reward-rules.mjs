/**
 * P-MARKET-GEO-MISMATCH legal bullets / Fable Verdict 2+3 (2026-07-27).
 *
 * The Terms are the only place a user can read what happens to their reward,
 * and they are served from Mongo (`masters`) rather than shipped in the AAB —
 * so a publish that silently misses a locale is invisible to every repo test.
 * The July pack shipped with three claims that no longer matched the product:
 * a Sunday weekly reset (the server moved to Monday 00:00 UTC), a cascade
 * described as automatic (it is a discretionary one-hop admin action), and no
 * statement at all about a non-Kenyan account reaching the Kenya pool.
 *
 * This suite reads the exact endpoint the mobile app calls —
 * `GET /master?name=terms-of-us` with `X-Language` — for every supported
 * locale, and asserts the four promises are actually being served:
 *
 *   1. Monday 00:00 UTC weekly reset, and no surviving Sunday reset sentence.
 *   2. A 7-day claim window whose lapse forfeits the slot (not paid, not
 *      carried over).
 *   3. A cascade that is explicitly discretionary and single-hop.
 *   4. Fake-Kenya: we *may* void the week's points and reject the claim, with
 *      no promise of automatic geo enforcement.
 *
 * Plus the brand scan, in every locale, because a translator reaching for a
 * local word for "prize" is exactly how Play policy trouble starts.
 *
 * Unauthenticated on purpose: `/master` is public (the register screen links
 * the Terms before an account exists), so this runs even without a JWT.
 */
import { url } from '../config.mjs';
import { readJson, assert } from '../assert.mjs';

export const id = 'legal-reward-rules';

/**
 * Per-locale phrases. Written as the published wording rather than a loose
 * keyword so a machine-translation regression that drops the qualifier
 * ("may — but is not required to") fails instead of passing on a stem match.
 */
const LOCALES = [
  {
    lang: 'en',
    mondayReset: /Monday at 00:00 UTC/,
    forfeit: /forfeited/i,
    notCarried: /not held over to a later week/i,
    discretionary: /is not required to/i,
    singleHop: /limited to a single pass/i,
    geoVoid: /void that week’s points/i,
    noAutoGeo: /do not promise automatic or exhaustive location enforcement/i,
  },
  {
    lang: 'it',
    mondayReset: /lunedì alle 00:00 UTC/,
    forfeit: /decade/i,
    notCarried: /non passa a una settimana successiva/i,
    discretionary: /non è obbligata a/i,
    singleHop: /limitata a un solo passaggio/i,
    geoVoid: /annullare i punti/i,
    noAutoGeo: /non promettiamo un controllo della posizione automatico/i,
  },
  {
    lang: 'es',
    mondayReset: /lunes a las 00:00 UTC/,
    forfeit: /caduca/i,
    notCarried: /no se traslada a una semana posterior/i,
    discretionary: /sin estar obligada/i,
    singleHop: /limitada a un único traspaso/i,
    geoVoid: /anular los puntos/i,
    noAutoGeo: /No prometemos un control de ubicación automático/i,
  },
  {
    lang: 'de',
    mondayReset: /montags 00:00 UTC/,
    forfeit: /verfällt/i,
    notCarried: /nicht in eine spätere Woche übertragen/i,
    discretionary: /ohne dazu verpflichtet zu sein/i,
    singleHop: /auf eine einzige Weitergabe begrenzt/i,
    geoVoid: /für ungültig erklären/i,
    noAutoGeo: /versprechen keine automatische oder vollständige Standortprüfung/i,
  },
  {
    lang: 'fr',
    mondayReset: /lundi 00:00 UTC/,
    forfeit: /forclos/i,
    notCarried: /n’est pas reporté sur une semaine ultérieure/i,
    discretionary: /sans y être tenue/i,
    singleHop: /limitée à un seul report/i,
    geoVoid: /annuler les points/i,
    noAutoGeo: /ne promettons aucun contrôle de localisation automatique/i,
  },
  {
    lang: 'pt',
    mondayReset: /segunda-feira às 00:00 UTC/,
    forfeit: /caduca/i,
    notCarried: /não passa para uma semana seguinte/i,
    discretionary: /sem ser obrigada/i,
    singleHop: /limitada a uma única passagem/i,
    geoVoid: /anular os pontos/i,
    noAutoGeo: /Não prometemos verificação de localização automática/i,
  },
  {
    lang: 'ro',
    mondayReset: /luni la 00:00 UTC/,
    forfeit: /se pierde/i,
    notCarried: /nu se reportează într‑o săptămână următoare/i,
    discretionary: /fără a fi obligată/i,
    singleHop: /limitată la un singur transfer/i,
    geoVoid: /anula punctele/i,
    noAutoGeo: /Nu promitem o verificare automată sau completă a locației/i,
  },
];

/**
 * Localised gambling vocabulary. `win`/`won` are deliberately absent for the
 * Latin locales: "vince"/"gana" share stems with ordinary verbs, and the
 * English `\bwin\b` would false-positive on German "Gewinn"-free text anyway.
 * These are the words Play reviewers and Kenyan regulators actually look for.
 */
const BANNED = [
  /\bprize[sd]?\b/i,
  /\blotter(?:y|ies)\b/i,
  /\bgambling\b/i,
  /\bwinnings\b/i,
  /\bpremi[oi]\b/i,
  /\blotteri[ae]\b/i,
  /\bloteri[ae]s?\b/i,
  /\bloteri[ae]\b/i,
  /\bgewinnspiel\b/i,
  /\blotterie\b/i,
  /\bloterie\b/i,
  /\bpremiu\b/i,
  /\bloterie\b/i,
];

/** Reads a legal master in one language, the way the mobile client does. */
async function fetchLegal(cfg, name, lang) {
  const r = await fetch(url(cfg, `/master?name=${name}`), {
    headers: { 'X-Language': lang },
  });
  const { body, text } = await readJson(r);
  if (r.status !== 200) {
    throw new Error(`master?name=${name} [${lang}] ${r.status}: ${text.slice(0, 200)}`);
  }
  const html = String(body?.data?.metadata?.[0] || '');
  assert(
    html.length > 1000,
    `${name} [${lang}] served ${html.length} chars — a truncated or missing legal master`,
  );
  return html;
}

export async function run(cfg, runner) {
  /** @type {Map<string, string>} */
  const terms = new Map();

  await runner.test('terms_are_served_in_every_supported_locale', async () => {
    for (const locale of LOCALES) {
      terms.set(locale.lang, await fetchLegal(cfg, 'terms-of-us', locale.lang));
    }
    // English fallback would make a missing locale look healthy, so compare.
    const english = terms.get('en');
    for (const locale of LOCALES.filter((l) => l.lang !== 'en')) {
      assert(
        terms.get(locale.lang) !== english,
        `terms-of-us [${locale.lang}] is byte-identical to English — the locale row is missing from masters and the app is silently falling back`,
      );
    }
  });

  await runner.test('weekly_reset_matches_the_monday_server_week', async () => {
    for (const locale of LOCALES) {
      const html = terms.get(locale.lang);
      assert(
        locale.mondayReset.test(html),
        `terms-of-us [${locale.lang}] does not state the Monday 00:00 UTC reset — published rules would contradict the live close`,
      );
      assert(
        !/(Sunday|domenica|domingo|Sonntag|dimanche|duminică)\s+(at\s+|alle\s+|a las\s+|às\s+|la\s+)?00:00\s*UTC/u.test(
          html,
        ),
        `terms-of-us [${locale.lang}] still publishes a Sunday 00:00 UTC reset`,
      );
    }
  });

  await runner.test('unclaimed_slot_is_forfeited_not_paid_and_not_carried_over', async () => {
    for (const locale of LOCALES) {
      const html = terms.get(locale.lang);
      assert(
        /\b7\b/.test(html),
        `terms-of-us [${locale.lang}] does not state the 7-day claim window`,
      );
      assert(
        locale.forfeit.test(html),
        `terms-of-us [${locale.lang}] never says an unclaimed slot is forfeited`,
      );
      assert(
        locale.notCarried.test(html),
        `terms-of-us [${locale.lang}] does not rule out carrying a forfeited slot into a later week — that reads as an accruing debt`,
      );
    }
  });

  await runner.test('cascade_is_published_as_discretionary_and_single_hop', async () => {
    for (const locale of LOCALES) {
      const html = terms.get(locale.lang);
      assert(
        locale.discretionary.test(html),
        `terms-of-us [${locale.lang}] does not mark the cascade discretionary — the shipped backend only cascades when an admin triggers it`,
      );
      assert(
        locale.singleHop.test(html),
        `terms-of-us [${locale.lang}] does not limit the cascade to one hop — cascadeDeadClaim passes a slot exactly once`,
      );
    }
  });

  await runner.test('fake_kenya_may_void_the_week_without_promising_a_geo_gate', async () => {
    for (const locale of LOCALES) {
      const html = terms.get(locale.lang);
      assert(
        locale.geoVoid.test(html),
        `terms-of-us [${locale.lang}] does not reserve the right to void a fake-Kenya week — the hard geo gate is deferred, so this sentence is the only enforcement basis`,
      );
      assert(
        locale.noAutoGeo.test(html),
        `terms-of-us [${locale.lang}] is missing the "no automatic location enforcement" disclaimer — we must not promise a gate we did not build`,
      );
    }
  });

  await runner.test('published_legal_pack_is_brand_safe_in_every_locale', async () => {
    for (const name of ['terms-of-us', 'privacy-policy', 'gdpr-compliance']) {
      for (const locale of LOCALES) {
        const html =
          name === 'terms-of-us'
            ? terms.get(locale.lang)
            : await fetchLegal(cfg, name, locale.lang);
        for (const pattern of BANNED) {
          const hit = html.match(pattern);
          assert(
            hit === null,
            `${name} [${locale.lang}] contains banned gambling wording "${hit?.[0]}" — reward/earn only`,
          );
        }
      }
    }
  });
}
