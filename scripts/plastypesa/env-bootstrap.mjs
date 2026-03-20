/**
 * Load PLASTYPESA_* from NeoXten repo .env (optional, no dependency on dotenv package).
 * Also loads optional `.env.plastypesa` (same repo root) so API/admin/mobile secrets can live
 * beside the main `.env` without mixing with other tooling keys.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function applyPlastypesaLines(raw, overrideExisting) {
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    if (!key.startsWith('PLASTYPESA_')) continue;
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!overrideExisting && process.env[key] !== undefined) continue;
    process.env[key] = val;
  }
}

export function bootstrapPlastyPesaEnv() {
  const neoxtenRoot = resolve(__dirname, '../..');
  const envPath = process.env.PLASTYPESA_ENV_FILE || resolve(neoxtenRoot, '.env');
  if (existsSync(envPath)) {
    try {
      applyPlastypesaLines(readFileSync(envPath, 'utf8'), false);
    } catch {
      /* ignore */
    }
  }
  const extra = resolve(neoxtenRoot, '.env.plastypesa');
  if (existsSync(extra)) {
    try {
      applyPlastypesaLines(readFileSync(extra, 'utf8'), true);
    } catch {
      /* ignore */
    }
  }
}
