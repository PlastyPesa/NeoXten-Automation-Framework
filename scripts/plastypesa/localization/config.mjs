import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const NEOXTEN_ROOT = resolve(__dirname, '../../..');

export const SUPPORTED_WEB_LANGUAGES = ['en', 'it', 'es', 'de', 'fr', 'pt', 'ro'];
export const SUPPORTED_MOBILE_LOCALES = [
  'en_US',
  'it_IT',
  'es_ES',
  'de_DE',
  'fr_FR',
  'pt_PT',
  'ro_RO',
];

export const PUBLIC_WEB_ROUTES = [
  { id: 'landing', path: '/', localized: true },
  { id: 'privacy-policy', path: '/privacy-policy', localized: true },
  { id: 'terms-of-use', path: '/terms-of-use', localized: true },
  { id: 'gdpr-compliance', path: '/gdpr-compliance', localized: true },
  { id: 'account-deletion', path: '/account-deletion', localized: true },
  { id: 'collector-signup', path: '/collector-signup', localized: false },
];

export const LOCALIZATION_GLOSSARY = {
  forbiddenBrandTerms: [
    'prize',
    'prizes',
    'prize draw',
  ],
  suspiciousEnglishTerms: [
    'community discussions',
    'eco streak',
    'eco streaks',
    'all-time',
    'this week',
    'reward lines',
    'like',
    'deep learning',
  ],
  preferredConcepts: {
    rewards: ['reward', 'rewards', 'eco reward', 'digital voucher', 'voucher'],
    sorting: ['sort by grade', 'sort by type'],
    learning: ['learning modules', 'eco lessons'],
    leaderboard: ['weekly leaderboard', 'top 20'],
  },
};

export function defaultAdminRepoRoot() {
  return resolve(NEOXTEN_ROOT, '../plastypesa-admin-dashboard');
}

export function defaultAdminFrontendRoot() {
  const env = process.env.PLASTYPESA_ADMIN_ROOT;
  if (env) return resolve(env);
  return resolve(defaultAdminRepoRoot(), 'lib/frontend');
}

export function defaultMobileRoot() {
  const env = process.env.PLASTYPESA_MOBILE_ROOT;
  if (env) return resolve(env);
  return resolve(NEOXTEN_ROOT, '../plastypesa-mobile-app');
}

export function getLocalizationOutDir() {
  const explicit = process.env.PLASTYPESA_LOCALIZATION_OUTDIR;
  const outDir = explicit
    ? resolve(explicit)
    : resolve(NEOXTEN_ROOT, '.neoxten-out', 'plastypesa-localization');
  mkdirSync(outDir, { recursive: true });
  return outDir;
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function writeJson(filePath, value) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(filePath, value) {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

export function pathForLocale(route, lang) {
  if (!route.localized || lang === 'en') return route.path;
  return `/${lang}${route.path}`;
}

export function fileExists(path) {
  return existsSync(path);
}
