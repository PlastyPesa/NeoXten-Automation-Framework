/**
 * Resolve Bearer JWT for PlastyPesa API tests without committing secrets.
 *
 * Priority:
 *   1) PLASTYPESA_USER_JWT — inject a token (CI secret, short-lived OK)
 *   2) Token cache file — reuse if JWT `exp` still valid (skips login / rate limits)
 *   3) PLASTYPESA_TEST_EMAIL + PLASTYPESA_TEST_PASSWORD — POST /auth/login
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { url } from './config.mjs';

const SKEW_SEC = 120;

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = resolve(__dirname, '../..');
const DEFAULT_CACHE_PATH = resolve(NEOXTEN_ROOT, '.neoxten/plastypesa-token-cache.json');

function decodeJwtExp(jwt) {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8'));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

function tokenStillValid(jwt) {
  const exp = decodeJwtExp(jwt);
  if (exp == null) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp > now + SKEW_SEC;
}

function readCache(cachePath) {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, 'utf8');
    const j = JSON.parse(raw);
    if (j?.token && typeof j.token === 'string' && tokenStillValid(j.token)) {
      return j.token;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCache(cachePath, token) {
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const exp = decodeJwtExp(token);
    writeFileSync(
      cachePath,
      JSON.stringify(
        { token, exp: exp ?? null, savedAt: new Date().toISOString() },
        null,
        2,
      ),
      'utf8',
    );
  } catch (e) {
    console.warn('[plastypesa-auth] Could not write token cache:', e.message);
  }
}

function authHeadersFromToken(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/**
 * @param {import('./config.mjs').PlastyPesaConfig} cfg
 * @returns {Promise<{ authHeaders: object | null, authSource: string, authError?: string }>}
 */
export async function resolvePlastyPesaAuth(cfg) {
  if (cfg.authOnly) {
    return { authHeaders: null, authSource: 'skipped (PLASTYPESA_AUTH_ONLY=1)' };
  }

  const injected = (cfg.userJwt || '').trim();
  if (injected) {
    return {
      authHeaders: authHeadersFromToken(injected),
      authSource: 'PLASTYPESA_USER_JWT',
    };
  }

  const email = (cfg.testEmail || '').trim();
  const password = cfg.testPassword || '';
  const partial =
    (email && !password) || (!email && password);
  if (partial) {
    const msg =
      'Set both PLASTYPESA_TEST_EMAIL and PLASTYPESA_TEST_PASSWORD (or use PLASTYPESA_USER_JWT only).';
    return { authHeaders: null, authSource: 'misconfigured', authError: msg };
  }

  if (!email && !password) {
    return {
      authHeaders: null,
      authSource: 'none (authenticated suites will SKIP)',
    };
  }

  const cachePath =
    (process.env.PLASTYPESA_TOKEN_CACHE_PATH || '').trim() || DEFAULT_CACHE_PATH;
  const cacheDisabled = process.env.PLASTYPESA_TOKEN_CACHE === '0';

  if (!cacheDisabled) {
    const cached = readCache(cachePath);
    if (cached) {
      return {
        authHeaders: authHeadersFromToken(cached),
        authSource: `token cache (${cachePath})`,
      };
    }
  }

  const body = {
    email,
    password,
  };
  const deviceId = (cfg.testDeviceId || '').trim();
  if (deviceId) body.deviceId = deviceId;

  const r = await fetch(url(cfg, '/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }

  if (r.status !== 200 || json.type !== 'success' || !json.token) {
    const hint = json.message || text.slice(0, 200);
    return {
      authHeaders: null,
      authSource: 'login failed',
      authError: `POST /auth/login failed: HTTP ${r.status} — ${hint}`,
    };
  }

  const token = json.token;
  if (!cacheDisabled) {
    writeCache(cachePath, token);
  }

  return {
    authHeaders: authHeadersFromToken(token),
    authSource: 'PLASTYPESA_TEST_EMAIL / password login',
  };
}
