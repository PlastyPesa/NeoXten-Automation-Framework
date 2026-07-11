/**
 * Live EcoSort localization smoke test.
 *
 * Exercises the production API exactly as the mobile app does: authenticated
 * round requests for every supported locale and every challenge type.
 */
import { bootstrapPlastyPesaEnv } from './env-bootstrap.mjs';
import { getConfig, url } from './config.mjs';
import { resolvePlastyPesaAuth } from './auth-bootstrap.mjs';

bootstrapPlastyPesaEnv();
process.env.PLASTYPESA_TEST_EMAIL ||= process.env.PLASTYPESA_MOBILE_USER_EMAIL || '';
process.env.PLASTYPESA_TEST_PASSWORD ||= process.env.PLASTYPESA_MOBILE_USER_PASSWORD || '';

const cfg = getConfig();
const languages = ['en', 'it', 'es', 'de', 'fr', 'pt', 'ro'];
const challengeTypes = ['sort-by-material', 'recyclable-or-not', 'where-it-goes'];
const visibleFields = ['prompt', 'altText'];
const mojibakePattern = /[Γ├─╚�]/u;
const knownLeakagePattern = /\b(?:drop-off electronics|wearables|flat-pack)\b/i;
const failures = [];
const evidence = [];

const { authHeaders, authSource } = await resolvePlastyPesaAuth(cfg);
console.log(`[auth] ${authSource}`);

for (const language of languages) {
  for (const challengeType of challengeTypes) {
    const endpoint = `/ecosort/round?type=${challengeType}&lang=${language}`;
    const response = await fetch(url(cfg, endpoint), { headers: authHeaders });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    const data = body?.data;
    const items = Array.isArray(data?.items) ? data.items : [];
    const row = {
      language,
      challengeType,
      status: response.status,
      itemCount: items.length,
      sample: items[0]
        ? {
            code: items[0].code,
            prompt: items[0].prompt,
            altText: items[0].altText,
          }
        : null,
    };
    evidence.push(row);

    if (response.status !== 200) {
      failures.push(`${language}/${challengeType}: HTTP ${response.status}: ${text.slice(0, 200)}`);
      continue;
    }
    if (items.length !== 6) {
      failures.push(`${language}/${challengeType}: expected 6 items, received ${items.length}`);
    }
    if (/correctDestination/i.test(JSON.stringify(data))) {
      failures.push(`${language}/${challengeType}: answer key leaked to client`);
    }
    for (const item of items) {
      for (const field of visibleFields) {
        const value = item[field];
        if (typeof value !== 'string' || !value.trim()) {
          failures.push(`${language}/${challengeType}/${item.code}: missing ${field}`);
          continue;
        }
        if (mojibakePattern.test(value)) {
          failures.push(`${language}/${challengeType}/${item.code}.${field}: mojibake`);
        }
        if (language !== 'en' && knownLeakagePattern.test(value)) {
          failures.push(`${language}/${challengeType}/${item.code}.${field}: English leakage "${value}"`);
        }
      }
    }
  }
}

console.log(JSON.stringify({ checks: evidence.length, failures, evidence }, null, 2));
if (failures.length) process.exit(1);
