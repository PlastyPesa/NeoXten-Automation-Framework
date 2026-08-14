/**
 * The published Terms must state the ladder that is actually paying.
 *
 * Two independent live sources are compared, and neither is my own source file:
 *   1. the public market contract  (/api/market-rewards/public/markets/KE)
 *   2. the published legal masters (/api/master?name=terms-of-us*)
 *
 * If a referendum is applied and the legal pack is not re-published, source 1
 * moves and source 2 does not — this fails, loudly, in all seven languages.
 * That is the exact drift that would otherwise be discovered by a member
 * reading Terms that promise a number we no longer pay.
 *
 *   node scripts/plastypesa/terms-ladder-matches-live-market.mjs
 */
const API = "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";

/** Thousands separator per published locale (mirrors the legal pack). */
const GROUP = { en: ",", it: ".", es: ".", de: ".", fr: " ", pt: " ", ro: "." };

/** Ladder amounts retired by the Aug-2026 referendum. Must not survive anywhere. */
const RETIRED = [4500, 2500, 1600, 200];

const money = (lang, amount) =>
    String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP[lang]);

async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.json();
}

async function liveLadder() {
    const body = await getJson(`${API}/market-rewards/public/markets/KE`);
    const tiers = body?.data?.rewardTiers;
    const schedule = tiers?.schedule;
    if (!Array.isArray(schedule) || schedule.length === 0) {
        throw new Error("Live KE market returned no reward schedule");
    }
    const paidOut = schedule.reduce(
        (sum, t) => sum + Number(t.amount) * (Number(t.rankTo) - Number(t.rankFrom) + 1),
        0
    );
    return {
        amounts: schedule.map((t) => Number(t.amount)),
        declaredTotal: Number(tiers.weeklyTotal),
        paidOut,
    };
}

async function termsHtml(lang) {
    const name = lang === "en" ? "terms-of-us" : `terms-of-us-${lang}`;
    const body = await getJson(`${API}/master?name=${name}`);
    const row = Array.isArray(body?.data) ? body.data[0] : body?.data;
    // Master rows are not uniform: some keep the page in `metadata[0]` as raw
    // HTML, others wrap it in `{ content }`, others use `data`. Read them all
    // rather than assume, so a shape change surfaces as a real mismatch.
    const candidates = [row?.metadata, row?.data].flatMap((field) =>
        Array.isArray(field) ? field : [field]
    );
    const html = candidates
        .map((c) => (typeof c === "string" ? c : c?.content))
        .find((c) => typeof c === "string" && c.length > 0);
    if (!html || typeof html !== "string") {
        throw new Error(`Published master "${name}" has no readable content`);
    }
    return html;
}

async function main() {
    const ladder = await liveLadder();
    console.log(`Live KE ladder : ${ladder.amounts.join(" · ")}`);
    console.log(`Declared pot   : ${ladder.declaredTotal}`);
    console.log(`Tiers sum to   : ${ladder.paidOut}\n`);

    const failures = [];

    // The pot is a promise in its own right; a ladder that does not add up to it
    // is a broken promise even if every tier is individually "new".
    if (ladder.paidOut !== ladder.declaredTotal) {
        failures.push(
            `Ladder sums to ${ladder.paidOut} but the market declares ${ladder.declaredTotal}`
        );
    }

    for (const lang of Object.keys(GROUP)) {
        const html = await termsHtml(lang);
        const problems = [];

        for (const amount of ladder.amounts) {
            if (!html.includes(money(lang, amount))) {
                problems.push(`missing live tier ${money(lang, amount)}`);
            }
        }
        if (!html.includes(money(lang, ladder.declaredTotal))) {
            problems.push(`missing pot ${money(lang, ladder.declaredTotal)}`);
        }
        for (const old of RETIRED) {
            if (ladder.amounts.includes(old)) continue; // still live — not stale
            if (html.includes(money(lang, old))) {
                problems.push(`still advertises retired ${money(lang, old)}`);
            }
        }

        if (problems.length === 0) {
            console.log(`  OK   terms ${lang}`);
        } else {
            console.log(`  FAIL terms ${lang} — ${problems.join("; ")}`);
            failures.push(`${lang}: ${problems.join("; ")}`);
        }
    }

    if (failures.length > 0) {
        console.error(
            `\nFAIL — published Terms disagree with the live market in ${failures.length} place(s).` +
                `\nRe-publish the legal pack (scripts/publish-legal-to-master.js) so Terms state ` +
                `what the weekly close actually pays.`
        );
        process.exit(1);
    }

    console.log("\nPASS — all 7 Terms locales state the live ladder, and no retired amount survives.");
}

main().catch((err) => {
    console.error(`ERROR — ${err.message}`);
    process.exit(1);
});
