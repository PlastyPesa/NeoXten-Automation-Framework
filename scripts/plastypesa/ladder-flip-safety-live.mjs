/**
 * P-LADDER-FLIP-SAFETY — do the bars a member is measured against speak the same
 * scale as their balance?
 *
 * Five ladders decide what a member is called: standing (Newcomer → Guardian),
 * the all-time pride rungs, the lifetime tier on their profile, the tier word
 * beside their name on the leaderboard, and the Eco Guardian bar. Every one of
 * them is written in code at the first point scale, which means the ÷10 rescale
 * cannot reach any of them — it only divides stored data.
 *
 * Leave them and the arithmetic is brutal: a Champion's 60,000 becomes 6,000
 * while the Champion bar stays at 60,000, so on flip morning the whole
 * population is demoted at once. They are converted when read instead
 * (`point_scale.service`), and this script is the proof from outside the server.
 *
 * The important property is that it does NOT hardcode the bars. It asks the
 * server for its scale and then asks whether the ladders and the member's own
 * standing agree with it. So the same command is the check today (scale 1, bars
 * where they have always been) and the check on flip morning (scale 2, every bar
 * a tenth, same member still a Champion).
 *
 * Usage:
 *   node scripts/plastypesa/ladder-flip-safety-live.mjs
 *   node scripts/plastypesa/ladder-flip-safety-live.mjs --expect 2   # flip morning
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";
import { getConfig, url } from "./config.mjs";
import { loadMobileAppUserCredentials } from "./credential-registry.mjs";

bootstrapPlastyPesaEnv();
const cfg = getConfig();
const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");

const argIdx = process.argv.indexOf("--expect");
const EXPECT_EPOCH = argIdx > -1 ? Number(process.argv[argIdx + 1]) : 1;

/**
 * The bars as they stand at the first scale. Used only to say *which* scale the
 * server is serving — never to assert a fixed number, because on flip morning
 * every one of these is expected to be a tenth.
 */
const FIRST_EPOCH = {
    // Standing bars are not sent to the phone — only the level a member reached
    // and how far the next one is. So they are mirrored here and scaled, which is
    // what makes the demotion check below possible from outside the server.
    standing: [
        { key: "newcomer", points: 0, sorts: 0 },
        { key: "sorter", points: 5000, sorts: 1 },
        { key: "regular", points: 25000, sorts: 5 },
        { key: "champion", points: 60000, sorts: 15 },
        { key: "guardian", points: 125000, sorts: 30 },
    ],
    prideFirstRung: 1000,
    prideTopRung: 10000000,
};

const findings = [];
const check = (label, actual, expected, note) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    findings.push({ label, actual, expected, ok, note });
    return ok;
};
const assertTrue = (label, cond, note) => check(label, Boolean(cond), true, note);

/** What the ÷10 flip does to one bar, matching the server's rounding. */
const bakedAt = (first, divisor) => {
    if (divisor <= 1 || first === 0) return first;
    const scaled = Math.round(Math.abs(first) / divisor);
    return Math.max(1, scaled) * Math.sign(first);
};

async function main() {
    mkdirSync(PROOF, { recursive: true });

    const creds = loadMobileAppUserCredentials();
    const login = await fetch(url(cfg, "/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
    const loginBody = await login.json();
    const token = loginBody?.data?.token || loginBody?.token;
    if (!token) {
        console.error("LOGIN_FAILED", login.status, loginBody);
        process.exit(1);
    }
    const auth = { Authorization: `Bearer ${token}` };

    const hubRes = await fetch(url(cfg, "/home/earn-hub"), { headers: auth });
    const hub = (await hubRes.json())?.data ?? {};
    const boardRes = await fetch(url(cfg, "/home/leaderboard?type=lifetime"), {
        headers: auth,
    });
    const board = (await boardRes.json())?.data ?? {};

    check("earn-hub status", hubRes.status, 200);
    check("leaderboard status", boardRes.status, 200);

    const epoch = hub?.clientConfig?.pointsEpoch;
    check("server states its point scale", epoch, EXPECT_EPOCH);
    const divisor = Math.pow(10, Math.max(0, (epoch ?? 1) - 1));

    const record = hub?.record ?? null;
    if (
        !assertTrue(
            "the record block is served",
            record && typeof record === "object",
            "without it the phone cannot draw either ladder"
        )
    ) {
        return finish();
    }

    // ---- 1. the ladders arrived in the scale the server just claimed ---------
    const standing = record.standing ?? {};
    const pride = record.points?.badges?.ladder ?? [];
    assertTrue("the pride ladder is served", pride.length > 0);
    check(
        "the first pride rung is in the served scale",
        pride[0]?.points,
        bakedAt(FIRST_EPOCH.prideFirstRung, divisor)
    );
    check(
        "the top pride rung is in the served scale",
        pride[pride.length - 1]?.points,
        bakedAt(FIRST_EPOCH.prideTopRung, divisor)
    );

    // ---- 2. nothing between two rungs — no balance can fall out of a ladder --
    const ordered = (rows, label) => {
        const pts = rows.map((r) => r.points);
        assertTrue(
            `${label} is still ordered lowest to highest`,
            pts.every((p, i) => i === 0 || p >= pts[i - 1]),
            "rounding two neighbouring bars onto the same number would swallow a rung"
        );
        assertTrue(
            `${label} has no duplicate bar`,
            new Set(pts).size === pts.length,
            "two rungs on the same number means one of them can never be reached"
        );
    };
    ordered(pride, "the pride ladder");
    ordered(
        FIRST_EPOCH.standing.map((l) => ({ points: bakedAt(l.points, divisor) })),
        "the standing ladder at the served scale"
    );

    const tiers = board?.tierLabels ?? [];
    assertTrue("leaderboard tier words are served", tiers.length > 0);
    for (let i = 1; i < tiers.length; i += 1) {
        assertTrue(
            `leaderboard band ${i} touches the one below it`,
            tiers[i].min === tiers[i - 1].max,
            "a gap here leaves a real balance with no word at all"
        );
    }

    // ---- 3. the member's own verdict agrees with the ladder they were sent ---
    // This is the check that actually catches a demotion. It re-derives the
    // badge and level from the numbers in the payload, so it holds at any scale.
    const lifetime = Number(record.points?.lifetimePoints ?? 0);
    const sorts = Number(record.sorts?.approved ?? 0);

    const earnedPride = pride.filter((r) => lifetime >= r.points).pop() ?? null;
    check(
        "the badge shown is the highest one the balance has earned",
        record.points?.badges?.latestKey ?? null,
        earnedPride?.key ?? null,
        `lifetime ${lifetime} against a ladder starting at ${pride[0]?.points}`
    );

    // Standing needs both floors met — points and approved photographs — and the
    // points floor has to be read at the scale the server is quoting. This is the
    // check that actually catches a demotion: an unscaled bar would push this
    // member down a level while their photograph count never changed.
    const scaledStanding = FIRST_EPOCH.standing.map((l) => ({
        ...l,
        points: bakedAt(l.points, divisor),
    }));
    const earnedLevel = scaledStanding
        .filter((l) => lifetime >= l.points && sorts >= l.sorts)
        .pop();
    check(
        "the standing shown is the highest one both floors allow",
        standing.levelKey ?? null,
        earnedLevel?.key ?? null,
        `lifetime ${lifetime}, approved sorts ${sorts}, at scale ${divisor}`
    );

    // The distance to the next level is the only bar the phone ever prints, so it
    // has to be in the same scale as the balance beside it.
    const nextLevel = scaledStanding[scaledStanding.indexOf(earnedLevel) + 1] ?? null;
    if (nextLevel && standing.next) {
        check(
            "the distance to the next level is in the served scale",
            standing.next.pointsToGo,
            Math.max(0, nextLevel.points - lifetime),
            `next is ${nextLevel.key} at ${nextLevel.points}`
        );
        check(
            "the photographs still owed are a plain count",
            standing.next.sortsToGo,
            Math.max(0, nextLevel.sorts - sorts),
            "counts of photographs, never divided"
        );
    }

    const myTier = board?.currentUserTier ?? null;
    if (myTier && tiers.length) {
        const band = tiers.filter((t) => lifetime >= t.min).pop();
        check(
            "the leaderboard word matches the band the balance sits in",
            myTier.label ?? myTier.key ?? null,
            band?.label ?? null
        );
    }

    return finish({ epoch, divisor, standing, pride, tiers, lifetime, sorts });
}

function finish(extra = {}) {
    const ok = findings.every((f) => f.ok);
    const out = {
        ok,
        expectedEpoch: EXPECT_EPOCH,
        at: new Date().toISOString(),
        findings,
        ...extra,
    };
    const path = join(PROOF, `ladder-flip-safety-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ ok, findings }, null, 2));
    if (!ok) {
        console.error("FAIL ladder flip safety —", path);
        process.exit(1);
    }
    console.log("PASS", path);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
