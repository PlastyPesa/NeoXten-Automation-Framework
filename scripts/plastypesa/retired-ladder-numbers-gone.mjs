/**
 * No surface may still advertise the retired KE ladder.
 *
 * Retired by the Aug-2026 referendum: 4500 / 2500 / 1600 / 200 (per-tier).
 * The live ladder is 2600 / 1500 / 1000 / 700 on the same 10,000 pot.
 *
 * This sweeps source *and* the built admin/landing bundle, because a number can
 * be fixed in a `.tsx` and still be live in `dist/` until a deploy — and the
 * bundle is what a visitor actually reads. Hits are reported with their line so
 * each one can be judged rather than blanket-suppressed: `200` in particular is
 * a legitimate HTTP status and a common point value, so only ladder-shaped
 * context counts.
 *
 *   node scripts/plastypesa/retired-ladder-numbers-gone.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = [
    ["landing+admin src", "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/lib/frontend/src"],
    ["admin dist", "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/lib/frontend/dist"],
    ["backend", "C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend"],
    ["backend scripts", "C:/Users/Bobby/Documents/plastypesa-backend-api/scripts"],
    ["mobile", "C:/Users/Bobby/Documents/plastypesa-mobile-app/lib"],
];

const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "__tests__"]);
const CODE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".dart", ".mjs", ".cjs", ".html", ".json"]);

/**
 * Retired amounts, written the way a ladder claim writes them. Bare `200` and
 * bare `1600` are excluded: unseparated they collide with HTTP codes, pixel
 * sizes and unrelated point values, which would bury the real hits in noise.
 * The separated forms below are what a money claim looks like on a surface.
 */
const RETIRED_PATTERNS = [
    /\b4[,.\s]500\b/,
    /\b2[,.\s]500\b/,
    /\b1[,.\s]600\b/,
    /\b4500\b/,
    /\b2500\b/,
];

/** A hit only matters where money/ladder words are nearby. */
const MONEY_CONTEXT = /KES|ksh|ladder|tier|rank|weekly|pot|reward|prize|top\s*10|schedule/i;

/**
 * A comment that names the retired ladder in order to warn against it is the
 * opposite of a stale claim — it is the guardrail. Nothing renders from it.
 */
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|\/\/\/)/;

/**
 * Deliberate, reviewed exceptions. Each needs a reason, so this stays a judgement
 * that was made rather than a blanket mute. Anything not listed here fails.
 */
const ALLOWED = [
    {
        file: "lib/lambda/backend/services/reward_referendum.service.js",
        reason:
            "Historical ballot record: option A IS the retired ladder — that is what " +
            "Kenya was asked about. It is never paid from, and stampCurrentOption() " +
            "re-derives the 'current' badge from the live market, so the seeded " +
            "isCurrent:true on A cannot advertise itself as today's offer.",
    },
];

function allowanceFor(file) {
    return ALLOWED.find((a) => file.endsWith(a.file));
}

function collect(root) {
    if (!existsSync(root)) return [];
    const files = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            if (SKIP_DIRS.has(entry)) continue;
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (CODE_EXT.has(extname(entry))) files.push(full);
        }
    };
    walk(root);
    return files;
}

function main() {
    const hits = [];
    const excused = [];

    for (const [label, root] of ROOTS) {
        for (const file of collect(root)) {
            const text = readFileSync(file, "utf8");
            const posix = file.replace(/\\/g, "/");
            const allowance = allowanceFor(posix);
            // Minified bundles have no useful lines; window around the match instead.
            const lines = text.split("\n");
            lines.forEach((line, i) => {
                for (const pattern of RETIRED_PATTERNS) {
                    const m = line.match(pattern);
                    if (!m) continue;
                    const from = Math.max(0, m.index - 120);
                    const window = line.slice(from, m.index + 120);
                    if (!MONEY_CONTEXT.test(window)) continue;

                    const record = {
                        label,
                        file: posix,
                        line: i + 1,
                        match: m[0],
                        window: window.trim().slice(0, 200),
                    };
                    if (COMMENT_LINE.test(line)) {
                        excused.push({ ...record, why: "warning comment, renders nothing" });
                    } else if (allowance) {
                        excused.push({ ...record, why: allowance.reason });
                    } else {
                        hits.push(record);
                    }
                }
            });
        }
    }

    if (excused.length > 0) {
        console.log(`Reviewed and allowed (${excused.length}):`);
        for (const e of excused) {
            console.log(`  ${e.file}:${e.line} "${e.match}" — ${e.why.split(".")[0]}.`);
        }
        console.log("");
    }

    if (hits.length === 0) {
        console.log("PASS — no surface advertises a retired KE ladder amount as a live claim.");
        return;
    }

    console.error(`FAIL — ${hits.length} retired-ladder claim(s) still present:\n`);
    for (const h of hits) {
        console.error(`  [${h.label}] ${h.file}:${h.line}  "${h.match}"`);
        console.error(`      …${h.window}…\n`);
    }
    console.error(
        "Each hit is either a stale claim to fix, or historical/audit text that must " +
            "be scoped so it cannot read as the current offer."
    );
    process.exit(1);
}

main();
