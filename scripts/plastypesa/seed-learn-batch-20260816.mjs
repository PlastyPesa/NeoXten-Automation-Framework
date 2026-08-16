/**
 * Seed the 2026-08-16 Kenya Learn batch into master `learn-content`.
 *
 *   node scripts/plastypesa/seed-learn-batch-20260816.mjs           # validate only
 *   node scripts/plastypesa/seed-learn-batch-20260816.mjs --translate --send
 *
 * --translate  fills all 7 locales via content-i18n (needs ANTHROPIC_API_KEY)
 * --send       PUT /admin/learn (append; never drops existing rows)
 * --limit=N    first N new articles (for a short i18n smoke)
 *
 * Hard rule: refuse to seed if any new body contains a point amount, KES/KSh
 * figure, cap, pool, or tier. Resin codes (grade 1 / 2 / 5) are allowed.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEARN_BATCH_20260816 } from "./content-banks/learn/ke-batch-20260816.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  resolve("C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/package.json"),
);

const API = "https://qdvaw2vpck.execute-api.eu-west-2.amazonaws.com/prod/api";
const TRANSLATE = process.argv.includes("--translate");
const SEND = process.argv.includes("--send");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) || Infinity : Infinity;

const BANNED =
  /\b(KES|KSh|Ksh|ksh)\b|\b(1[\s,.]?000|2[\s,.]?000|4[\s,.]?000|10[\s,.]?000|20[\s,.]?000|125[\s,.]?000)\b|\bTop\s*10\b|\bTop\s*20\b|\bweekly pot\b|\b10,000 pot\b/i;

function countWords(article) {
  const tips = Array.isArray(article.tips) ? article.tips.join(" ") : "";
  const text = [article.content || "", tips]
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.split(" ").filter(Boolean).length : 0;
}

function haystack(article) {
  return [article.title, article.description, article.content, ...(article.tips || [])].join(
    "\n",
  );
}

function loadAnthropicKey() {
  if (process.env.ANTHROPIC_API_KEY) return;
  const p =
    "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/ALL CREDENTIALS FOR PLASTYPESA 15-03-2026/Anthropic Api Key (backend + Bet Performance).txt";
  if (!existsSync(p)) return;
  const m = readFileSync(p, "utf8").match(/ANTHROPIC_API_KEY=(sk-ant-\S+)/);
  if (m) process.env.ANTHROPIC_API_KEY = m[1];
}

function validate(batch) {
  const errors = [];
  for (const a of batch) {
    const n = countWords(a);
    if (n < 250) errors.push(`${a._id} words=${n} (floor 250)`);
    if (BANNED.test(haystack(a))) errors.push(`${a._id} BANNED amount/KES/tier`);
    if (!a.title || !a.content || !Array.isArray(a.tips) || a.tips.length < 3) {
      errors.push(`${a._id} missing title/content/3 tips`);
    }
  }
  return errors;
}

const errors = validate(LEARN_BATCH_20260816);
console.log(`BATCH ${LEARN_BATCH_20260816.length} articles`);
for (const a of LEARN_BATCH_20260816) {
  console.log(`  ${countWords(a).toString().padStart(3)}w  ${a._id}  ${a.title}`);
}
if (errors.length) {
  console.error("VALIDATE_FAIL");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log("VALIDATE_OK no amounts, all >= 250 words");

if (!TRANSLATE && !SEND) process.exit(0);

const credentials = readFileSync(
  "C:/Users/Bobby/Documents/plastypesa-admin-dashboard/.local/plastypesa-test-credentials.md",
  "utf8",
);
const adminBlock = credentials.split("## Production mobile app")[0];
const email = adminBlock.match(/\*\*Email:\*\*\s*(\S+)/)?.[1];
const password = adminBlock.match(/\*\*Password:\*\*\s*(.+)/)?.[1]?.trim();
if (!email || !password) throw new Error("Local admin credentials unavailable");

async function json(path, options = {}) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${path}: non-JSON (${response.status})`);
  }
  if (!response.ok || body.type === "Error" || body.type === "error") {
    throw new Error(`${path}: HTTP ${response.status} — ${body.message || "failed"}`);
  }
  return body;
}

const login = await json("/auth/admin-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
const token = login?.data?.token || login?.token;
if (!token) throw new Error("Admin login returned no token");
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

const existingRes = await json("/admin/learn", { headers });
const existing = existingRes?.data || [];
const existingIds = new Set(existing.map((a) => String(a._id || a.id || a.title)));
let toAdd = LEARN_BATCH_20260816.filter(
  (a) => !existingIds.has(a._id) && !existingIds.has(a.title),
);
if (Number.isFinite(LIMIT)) toAdd = toAdd.slice(0, LIMIT);
console.log(`EXISTING ${existing.length}  NEW ${toAdd.length}`);

const cachePath = resolve(__dirname, "../../.neoxten/learn-batch-20260816-i18n-cache.json");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

if (TRANSLATE) {
  loadAnthropicKey();
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY missing — will not seed English into other locales");
  }
  const { translateContentFields } = require(
    "C:/Users/Bobby/Documents/plastypesa-backend-api/lib/lambda/backend/services/content-i18n.js",
  );
  for (let i = 0; i < toAdd.length; i += 1) {
    const a = toAdd[i];
    const cached = cache[a._id];
    const haveAll =
      cached?.en && cached?.it && cached?.es && cached?.de && cached?.fr && cached?.pt && cached?.ro;
    if (haveAll) {
      a.translations = cached;
      console.log(`TRANSLATE_CACHE ${i + 1}/${toAdd.length} ${a._id}`);
    } else {
      let translations = null;
      let lastErr = null;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          console.log(`TRANSLATE ${i + 1}/${toAdd.length} ${a._id} attempt ${attempt}`);
          translations = await translateContentFields({
            title: a.title,
            description: a.description,
            content: a.content,
            tips: a.tips,
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.warn(`TRANSLATE_RETRY ${a._id} ${err.message}`);
          await new Promise((r) => setTimeout(r, 4000 * attempt));
        }
      }
      if (!translations) throw lastErr;
      cache[a._id] = translations;
      mkdirSync(resolve(__dirname, "../../.neoxten"), { recursive: true });
      writeFileSync(cachePath, JSON.stringify(cache));
      a.translations = translations;
    }
    const en = a.translations.en || {};
    a.title = en.title || a.title;
    a.description = en.description || a.description;
    a.content = en.content || a.content;
    a.tips = en.tips || a.tips;
  }
} else {
  for (const a of toAdd) {
    a.translations = {
      en: {
        title: a.title,
        description: a.description,
        content: a.content,
        tips: a.tips,
      },
    };
  }
}

const outDir = resolve(__dirname, "../../.neoxten");
mkdirSync(outDir, { recursive: true });
const previewPath = resolve(outDir, "learn-batch-20260816-preview.json");
writeFileSync(
  previewPath,
  JSON.stringify(
    toAdd.map((a) => ({
      _id: a._id,
      title: a.title,
      locales: Object.keys(a.translations || {}),
      words: countWords(a),
    })),
    null,
    2,
  ),
);
console.log("PREVIEW", previewPath);

if (!SEND) {
  console.log("Dry — Mongo not written. Pass --send to apply.");
  process.exit(0);
}

const merged = [...existing, ...toAdd];
await json("/admin/learn", {
  method: "PUT",
  headers,
  body: JSON.stringify({ articles: merged }),
});
console.log(`SAVED ${merged.length} learn articles (${toAdd.length} new).`);
