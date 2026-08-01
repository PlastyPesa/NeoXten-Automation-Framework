/**
 * Prove Sort Review modal UX contract is in the live frontend bundle:
 * - decision note + Reject flow copy (not "send first")
 * - Sent / Not sent send-only feedback
 * - frosted glass class on modal shell
 *
 * Usage: node scripts/plastypesa/admin-sort-review-modal-ux-prove.mjs
 */
import { bootstrapPlastyPesaEnv } from "./env-bootstrap.mjs";

bootstrapPlastyPesaEnv();

const ORIGIN = process.env.PLASTYPESA_ADMIN_ORIGIN || "https://plastypesa.com";

async function fetchText(u) {
  const res = await fetch(u, { redirect: "follow" });
  const text = await res.text();
  return { http: res.status, text, finalUrl: res.url };
}

function extractChunkUrls(html, origin) {
  const urls = [];
  const re = /\/assets\/(?:Page|index|Sort)[^"'\\s>]+\.js/g;
  let m;
  while ((m = re.exec(html))) {
    urls.push(new URL(m[0], origin).href);
  }
  // Also catch hashed SortProofReview chunks referenced as Page-*.js from sort route
  const re2 = /src="(\/assets\/[^"]+\.js)"/g;
  while ((m = re2.exec(html))) {
    urls.push(new URL(m[1], origin).href);
  }
  return [...new Set(urls)];
}

const needles = [
  "Message to user (sent with your decision)",
  "no separate Send first",
  "Advanced: send note only (keep in queue)",
  "Sent ✓",
  "Not sent — retry",
  "pp-admin-glass--primary",
];

const { http, text: html } = await fetchText(`${ORIGIN}/sort-proof-review`);
if (http >= 400) {
  console.error(JSON.stringify({ ok: false, stage: "html", http }, null, 2));
  process.exit(1);
}

const chunkUrls = extractChunkUrls(html, ORIGIN);
let hay = html;
for (const u of chunkUrls) {
  try {
    const { text } = await fetchText(u);
    hay += `\n${text}`;
  } catch {
    /* skip */
  }
}

// Prefer Sort Review lazy chunk if present in asset index
const assetIndex = [...hay.matchAll(/assets\/Page-[A-Za-z0-9_-]+\.js/g)].map(
  (m) => m[0]
);
for (const rel of [...new Set(assetIndex)].slice(0, 40)) {
  const u = new URL(`/${rel}`, ORIGIN).href;
  if (chunkUrls.includes(u)) continue;
  try {
    const { text } = await fetchText(u);
    if (
      text.includes("sort-proof") ||
      text.includes("Review submission") ||
      text.includes("REVIEWER_REJECTED")
    ) {
      hay += `\n${text}`;
    }
  } catch {
    /* skip */
  }
}

const missing = needles.filter((n) => !hay.includes(n));
const present = needles.filter((n) => hay.includes(n));
const ok = missing.length === 0;

console.log(
  JSON.stringify(
    {
      ok,
      origin: ORIGIN,
      chunksTried: chunkUrls.length,
      present,
      missing,
    },
    null,
    2
  )
);
process.exit(ok ? 0 : 2);
