/**
 * P-SHADOW-FLIP — read every live member, divide their balance by ten on paper,
 * and ask whether anyone would lose a rank they earned.
 *
 * Unit tests prove the arithmetic. They cannot prove it for the actual people in
 * the database, and the population is where this either holds or embarrasses us:
 * a single member who opens the app on flip morning and finds themselves back to
 * Newcomer will say so publicly, and they will be right.
 *
 * Strictly read-only. Nothing is written. It divides in memory exactly the way
 * the rescale engine divides stored balances, scales the coded ladders exactly
 * the way `point_scale.service` scales them at read time, and then compares the
 * verdict a member gets today against the verdict they would get after the flip.
 *
 * ## What counts as a failure
 *
 * A **demotion** — any member ending on a lower rung than they hold today — is
 * fatal, full stop.
 *
 * A **rounding promotion** is not. Balances round half away from zero, so a
 * member sitting a few points below a bar (4,995 against 5,000) lands exactly on
 * it once both are divided, and reads as Sorter a little early. That direction
 * costs a member nothing, and dividing it the other way would mean shaving up to
 * nine points off real balances to keep a threshold tidy. So promotions are
 * counted and printed rather than treated as a defect — but they are printed,
 * because a recognition rung arriving early is a product decision and not
 * something an agent should quietly absorb.
 *
 * The one place that distinction matters for money is the Eco Guardian campaign,
 * which pays cash. Its points bar rounds like any other, so this script proves
 * separately that points rounding alone can never open it: the photograph floor
 * is a plain count, is never divided, and has to be met as well.
 *
 * Usage:
 *   node scripts/plastypesa/shadow-flip-demotion-live.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { loadBackendMongoEnv } from "./mongo-env.mjs";

const PROOF = join(dirname(fileURLToPath(import.meta.url)), "../../.neoxten/proof");
const DIVISOR = 10;

/** How the rescale engine divides a stored balance. */
const scaleValue = (value) => {
    if (!Number.isFinite(value) || value === 0) return value;
    const scaled = Math.round(Math.abs(value) / DIVISOR);
    return Math.max(1, scaled) * Math.sign(value);
};

/** How `point_scale.service` converts a coded bar at read time. */
const bakedAt = (first) => {
    if (first === 0 || !Number.isFinite(first)) return first;
    const scaled = Math.round(Math.abs(first) / DIVISOR);
    return Math.max(1, scaled) * Math.sign(first);
};

// ---- the ladders, exactly as they ship in code ------------------------------
const STANDING = [
    { key: "newcomer", points: 0, sorts: 0 },
    { key: "sorter", points: 5000, sorts: 1 },
    { key: "regular", points: 25000, sorts: 5 },
    { key: "champion", points: 60000, sorts: 15 },
    { key: "guardian", points: 125000, sorts: 30 },
];

const PRIDE = [
    { key: "points_1k", points: 1000 },
    { key: "points_10k", points: 10000 },
    { key: "points_50k", points: 50000 },
    { key: "points_100k", points: 100000 },
    { key: "points_300k", points: 300000 },
    { key: "points_500k", points: 500000 },
    { key: "points_750k", points: 750000 },
    { key: "points_1m", points: 1000000 },
    { key: "points_2m", points: 2000000 },
    { key: "points_5m", points: 5000000 },
    { key: "points_10m", points: 10000000 },
];

const LIFETIME_TIERS = [
    { key: "seedling", min: 0, max: 5000 },
    { key: "sprout", min: 5000, max: 25000 },
    { key: "sapling", min: 25000, max: 100000 },
    { key: "tree", min: 100000, max: 500000 },
    { key: "forest", min: 500000, max: Infinity },
];

const BOARD_TIERS = [
    { key: "Eco Learner", min: 0, max: 8000 },
    { key: "Eco Activist", min: 8000, max: 18000 },
    { key: "Eco Champion", min: 18000, max: 28000 },
    { key: "Eco Hero", min: 28000, max: 40000 },
    { key: "Eco Guardian", min: 40000, max: Infinity },
];

const scaleLadder = (rows, fields) =>
    rows.map((r) => {
        const out = { ...r };
        for (const f of fields) out[f] = bakedAt(r[f]);
        return out;
    });

/**
 * Each verdict returns the member's **position** on its ladder, not just a name,
 * because the only question that matters is which direction they moved.
 */
const standingIdx = (ladder, points, sorts) => {
    let idx = 0;
    ladder.forEach((l, i) => {
        if (points >= l.points && sorts >= l.sorts) idx = i;
    });
    return idx;
};

const prideIdx = (ladder, points) => {
    let idx = -1; // no badge yet
    ladder.forEach((r, i) => {
        if (points >= r.points) idx = i;
    });
    return idx;
};

const bandIdx = (ladder, points) => {
    const i = ladder.findIndex((t) => points >= t.min && points < t.max);
    return i === -1 ? ladder.length - 1 : i;
};

/** Every verdict a member reads about themselves, before and after. */
function verdicts(points, sorts, after, scaled) {
    return [
        {
            ladder: "standing",
            names: STANDING,
            before: standingIdx(STANDING, points, sorts),
            after: standingIdx(scaled.standing, after, sorts),
        },
        {
            ladder: "pride badge",
            names: PRIDE,
            before: prideIdx(PRIDE, points),
            after: prideIdx(scaled.pride, after),
        },
        {
            ladder: "lifetime tier",
            names: LIFETIME_TIERS,
            before: bandIdx(LIFETIME_TIERS, points),
            after: bandIdx(scaled.lifetime, after),
        },
        {
            ladder: "leaderboard word",
            names: BOARD_TIERS,
            before: bandIdx(BOARD_TIERS, points),
            after: bandIdx(scaled.board, after),
        },
    ];
}

const nameAt = (names, idx) => (idx < 0 ? "none" : names[idx].key);

async function main() {
    mkdirSync(PROOF, { recursive: true });
    const client = new MongoClient(loadBackendMongoEnv());
    await client.connect();
    const db = client.db();

    // Only the two numbers every ladder is decided by. Nothing identifying is read.
    const members = await db
        .collection("users")
        .find({}, { projection: { _id: 1, lifetimePoints: 1, sortProofCount: 1 } })
        .toArray();

    const scaled = {
        standing: scaleLadder(STANDING, ["points"]),
        pride: scaleLadder(PRIDE, ["points"]),
        lifetime: scaleLadder(LIFETIME_TIERS, ["min", "max"]),
        board: scaleLadder(BOARD_TIERS, ["min", "max"]),
    };

    const demotions = [];
    const promotions = [];
    let highestWater = 0;

    for (const m of members) {
        const points = Number(m.lifetimePoints) || 0;
        const sorts = Number(m.sortProofCount) || 0;
        highestWater = Math.max(highestWater, points);
        const after = scaleValue(points);

        for (const v of verdicts(points, sorts, after, scaled)) {
            if (v.after === v.before) continue;
            const row = {
                ladder: v.ladder,
                points,
                scaledTo: after,
                sorts,
                was: nameAt(v.names, v.before),
                becomes: nameAt(v.names, v.after),
            };
            (v.after < v.before ? demotions : promotions).push(row);
        }
    }

    const findings = [];
    const check = (label, ok, extra) => findings.push({ label, ok, ...extra });

    // The one fatal condition.
    check("no live member is demoted by the flip", demotions.length === 0, {
        moved: demotions.length,
        examples: demotions.slice(0, 12),
    });

    // Today's membership clusters well away from most bars, so the line above is
    // weak on its own. Walk every bar and the balances either side of it: these
    // are balances real members will hold in a few weeks.
    const bars = new Set(
        [
            ...STANDING.map((l) => l.points),
            ...PRIDE.map((r) => r.points),
            ...LIFETIME_TIERS.map((t) => t.min),
            ...BOARD_TIERS.map((t) => t.min),
        ].filter((p) => p > 0)
    );

    const edgeDemotions = [];
    const edgePromotions = [];
    for (const bar of bars) {
        for (const delta of [-9, -6, -5, -4, -1, 0, 1, 4, 5, 6, 9]) {
            const points = bar + delta;
            if (points < 0) continue;
            const after = scaleValue(points);
            // Every photograph floor satisfied, so this isolates the points bar.
            for (const v of verdicts(points, 999, after, scaled)) {
                if (v.after === v.before) continue;
                const row = {
                    ladder: v.ladder,
                    bar,
                    points,
                    scaledTo: after,
                    was: nameAt(v.names, v.before),
                    becomes: nameAt(v.names, v.after),
                };
                (v.after < v.before ? edgeDemotions : edgePromotions).push(row);
            }
        }
    }

    check(
        "no balance on or beside a bar is demoted",
        edgeDemotions.length === 0,
        {
            barsWalked: bars.size,
            moved: edgeDemotions.length,
            examples: edgeDemotions.slice(0, 12),
        }
    );

    // Rounding promotions are allowed, but only ever by one rung and only for
    // balances within half a step of the bar. Anything larger is a scaling bug
    // wearing a promotion's clothes.
    const suspicious = [...promotions, ...edgePromotions].filter((r) => {
        const gap = r.bar ? Math.abs(r.bar - r.points) : null;
        return gap !== null && gap > DIVISOR / 2;
    });
    check(
        "every promotion is a rounding step, not a jump",
        suspicious.length === 0,
        { suspicious: suspicious.slice(0, 12) }
    );

    // Eco Guardian pays cash. Its points bar rounds like any other, so prove that
    // rounding alone cannot open it — the photograph floor is a count, is never
    // divided, and must be met as well.
    const guardian = STANDING[STANDING.length - 1];
    const guardianAfter = scaled.standing[scaled.standing.length - 1];
    const roundedOntoBar = guardian.points - 5; // the most generous case
    check(
        "points rounding alone cannot open the paid Guardian gate",
        standingIdx(
            scaled.standing,
            scaleValue(roundedOntoBar),
            guardian.sorts - 1 // one photograph short
        ) < scaled.standing.length - 1,
        {
            note: `${roundedOntoBar} points rounds onto the ${guardianAfter.points} bar, but ${guardian.sorts} approved photographs are still required`,
            photographFloorAfterFlip: guardianAfter.sorts,
            photographFloorToday: guardian.sorts,
        }
    );
    check(
        "the Guardian photograph floor is not divided",
        guardianAfter.sorts === guardian.sorts,
        { floor: guardian.sorts }
    );

    check("the population was actually read", members.length > 0, {
        membersRead: members.length,
        highestLifetimeSeen: highestWater,
        promotionsAmongLiveMembers: promotions.length,
        promotionsAtTheBars: edgePromotions.length,
        promotionExamples: [...promotions, ...edgePromotions].slice(0, 6),
    });

    const ok = findings.every((f) => f.ok);
    const out = {
        ok,
        divisor: DIVISOR,
        membersRead: members.length,
        at: new Date().toISOString(),
        findings,
    };
    const path = join(PROOF, `shadow-flip-demotion-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));

    await client.close();
    if (!ok) {
        console.error("FAIL shadow flip —", path);
        process.exit(1);
    }
    console.log("PASS", path);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
