import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = resolve(__dirname, '../..');
const DEFAULT_ADMIN_REPO_ROOT = resolve(NEOXTEN_ROOT, '../plastypesa-admin-dashboard');
const DEFAULT_CREDENTIAL_ROOT = resolve(
  DEFAULT_ADMIN_REPO_ROOT,
  'ALL CREDENTIALS FOR PLASTYPESA 15-03-2026',
);

const DEFAULT_ALIAS_PATHS = {
  adminDashboardLogin: 'Admin Dasboard Login.txt',
  mobileAppUserLogin: 'Plastypesa User Login in mobile app.txt',
  awsAccessKey: 'AWS Acces key created 15032026.txt',
  geminiApiKey: 'Gemini Api Key created on 15032026.txt',
  mongoCiRunner: 'MongoDB User ci_runner@admin       password.txt',
  jwtSecret: 'new JWT secret created on 15032026.txt',
  sessionSecret: 'new session secret 15032026  65a686.txt',
  backendGmailAppPassword: 'Plasty Pesa Backend  Gmail app password .txt',
  androidKeystore: 'plastypesa-upload.jks',
  playConsoleAccessCsv: 'PlastyPesa_App_Developer_accessKeys.csv',
  tremendousSandboxApiKey: 'Plasypesa Sandbox API Key Tremendou.txt',
  communityExecutionPlan: 'Full Execution Plan Community Page,.txt',
};

function defaultRegistryPayload() {
  return {
    version: 1,
    credentialRoot: DEFAULT_CREDENTIAL_ROOT.replace(/\\/g, '/'),
    aliases: DEFAULT_ALIAS_PATHS,
  };
}

export function getCredentialRegistryPath() {
  return resolve(
    process.env.PLASTYPESA_CREDENTIAL_REGISTRY ||
      resolve(NEOXTEN_ROOT, '.local', 'plastypesa-credential-registry.json'),
  );
}

export function ensureCredentialRegistry() {
  const registryPath = getCredentialRegistryPath();
  if (existsSync(registryPath)) {
    return registryPath;
  }

  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(
    registryPath,
    `${JSON.stringify(defaultRegistryPayload(), null, 2)}\n`,
    'utf8',
  );
  return registryPath;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadCredentialRegistry() {
  const registryPath = ensureCredentialRegistry();
  const payload = readJson(registryPath);
  const credentialRoot = resolve(
    process.env.PLASTYPESA_CREDENTIALS_DIR ||
      payload.credentialRoot ||
      DEFAULT_CREDENTIAL_ROOT,
  );
  return {
    registryPath,
    credentialRoot,
    aliases: {
      ...DEFAULT_ALIAS_PATHS,
      ...(payload.aliases || {}),
    },
  };
}

export function resolveCredentialAlias(alias) {
  const registry = loadCredentialRegistry();
  const relativeOrAbsolute = registry.aliases?.[alias];
  if (!relativeOrAbsolute) {
    throw new Error(`Unknown PlastyPesa credential alias: ${alias}`);
  }

  const filePath = resolve(registry.credentialRoot, relativeOrAbsolute);
  if (!existsSync(filePath)) {
    throw new Error(
      `Credential file for alias "${alias}" was not found at ${filePath}`,
    );
  }
  return filePath;
}

function extractField(text, label) {
  return (
    text.match(new RegExp(`${label}\\s*:\\s*(.+)`, 'i'))?.[1]?.trim() || ''
  );
}

function stripTrailingNote(value) {
  return value.replace(/\s+\([^)]*\)\s*$/, '').trim();
}

export function loadAdminDashboardCredentials() {
  const filePath = resolveCredentialAlias('adminDashboardLogin');
  const text = readFileSync(filePath, 'utf8');
  const email = extractField(text, 'email');
  const password = stripTrailingNote(extractField(text, 'password'));
  if (!email || !password) {
    throw new Error(`Could not parse admin credentials from ${filePath}`);
  }
  return { email, password, filePath };
}

export function loadMobileAppUserCredentials() {
  const filePath = resolveCredentialAlias('mobileAppUserLogin');
  const text = readFileSync(filePath, 'utf8');
  const email = extractField(text, 'email');
  const password = stripTrailingNote(extractField(text, 'password'));
  if (!email || !password) {
    throw new Error(`Could not parse mobile app credentials from ${filePath}`);
  }
  return { email, password, filePath };
}

export function populateCredentialEnv() {
  if (!process.env.PLASTYPESA_ADMIN_EMAIL || !process.env.PLASTYPESA_ADMIN_PASSWORD) {
    try {
      const admin = loadAdminDashboardCredentials();
      process.env.PLASTYPESA_ADMIN_EMAIL ||= admin.email;
      process.env.PLASTYPESA_ADMIN_PASSWORD ||= admin.password;
    } catch {
      /* keep env-driven behavior if local registry is unavailable */
    }
  }

  if (
    !process.env.PLASTYPESA_MOBILE_USER_EMAIL ||
    !process.env.PLASTYPESA_MOBILE_USER_PASSWORD
  ) {
    try {
      const mobile = loadMobileAppUserCredentials();
      process.env.PLASTYPESA_MOBILE_USER_EMAIL ||= mobile.email;
      process.env.PLASTYPESA_MOBILE_USER_PASSWORD ||= mobile.password;
    } catch {
      /* keep env-driven behavior if local registry is unavailable */
    }
  }
}
