/**
 * Every Live Dials key must have a real reader.
 *
 * The failure this exists to prevent: a dial in the admin UI that writes a
 * Master row nothing ever reads. It saves, it shows a green toast, and the
 * number on the phone does not move. That is worse than having no dial at all,
 * because it looks like it worked — Bobby would "fix" a wrong figure, believe it
 * was fixed, and find out from a member.
 *
 * So this walks the key list out of `pages/LiveDials/Page.tsx` (via
 * `constants.ts`, which is where the strings actually live) and proves each one
 * appears in backend or mobile source as something that is *read*. A typo in
 * either repo fails here rather than in Kenya.
 *
 *   node scripts/plastypesa/live-dials-keys-have-readers.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ADMIN = "C:/Users/Bobby/Documents/plastypesa-admin-dashboard";
const BACKEND = "C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend";
const MOBILE = "C:/Users/Bobby/Documents/plastypesa-mobile-app/lib";

const DIALS_PAGE = join(ADMIN, "lib/frontend/src/pages/LiveDials/Page.tsx");
const CONSTANTS = join(ADMIN, "lib/frontend/src/constants.ts");

/** MASTER_KEYS constant name → wire string. */
function loadMasterKeys() {
    const src = readFileSync(CONSTANTS, "utf8");
    const out = new Map();
    for (const m of src.matchAll(/^\s*([A-Z0-9_]+):\s*"([^"]+)",?\s*$/gm)) {
        out.set(m[1], m[2]);
    }
    return out;
}

/** Which MASTER_KEYS the Live Dials page offers, plus any bare-string keys. */
function loadDialKeys(masterKeys) {
    const src = readFileSync(DIALS_PAGE, "utf8");
    const keys = new Set();

    for (const m of src.matchAll(/MASTER_KEYS\.([A-Z0-9_]+)/g)) {
        const wire = masterKeys.get(m[1]);
        if (!wire) {
            throw new Error(
                `LiveDials references MASTER_KEYS.${m[1]}, which is not defined in constants.ts`
            );
        }
        keys.add(wire);
    }
    // Feature flags are declared as literals in the FLAGS array.
    const flagBlock = src.match(/const FLAGS = \[([\s\S]*?)\n\];/);
    if (flagBlock) {
        for (const m of flagBlock[1].matchAll(/key:\s*"([^"]+)"/g)) keys.add(m[1]);
    }
    return [...keys];
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "coverage"]);
const CODE_EXT = new Set([".js", ".dart", ".mjs", ".cjs"]);

function collect(root) {
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

/**
 * A test fixture mentioning a key does not prove production reads it, so
 * `__tests__` and `*_test.dart` are excluded from what counts as a reader.
 */
function isProduction(path) {
    const p = path.replace(/\\/g, "/");
    return !p.includes("/__tests__/") && !p.endsWith("_test.dart");
}

function main() {
    const masterKeys = loadMasterKeys();
    const dialKeys = loadDialKeys(masterKeys);

    const sources = [
        ...collect(BACKEND).map((f) => ["backend", f]),
        ...collect(MOBILE).map((f) => ["mobile", f]),
    ].filter(([, f]) => isProduction(f));

    const loaded = sources.map(([repo, f]) => [repo, f, readFileSync(f, "utf8")]);

    const orphans = [];
    const found = [];
    for (const key of dialKeys) {
        const hits = loaded
            .filter(([, , text]) => text.includes(key))
            .map(([repo, f]) => `${repo}:${f.replace(/\\/g, "/").split("/").pop()}`);
        if (hits.length === 0) orphans.push(key);
        else found.push({ key, hits: [...new Set(hits)] });
    }

    console.log(`Live Dials keys checked: ${dialKeys.length}\n`);
    for (const { key, hits } of found.sort((a, b) => a.key.localeCompare(b.key))) {
        console.log(`  OK   ${key.padEnd(42)} ${hits.slice(0, 3).join(", ")}`);
    }

    if (orphans.length > 0) {
        console.error(`\nFAIL — ${orphans.length} dial(s) write a key nothing reads:`);
        for (const key of orphans) console.error(`  ${key}`);
        console.error(
            "\nEither the reader is missing or the string is a typo. A dial that " +
                "saves without changing anything must not ship."
        );
        process.exit(1);
    }

    console.log("\nPASS — every Live Dials key has a production reader.");
}

main();
