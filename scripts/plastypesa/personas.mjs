import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAdminDashboardCredentials,
  loadMobileAppUserCredentials,
} from './credential-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEOXTEN_ROOT = resolve(__dirname, '../..');
const PERSONA_STATE_PATH = resolve(
  process.env.PLASTYPESA_PERSONA_STATE_PATH ||
    resolve(NEOXTEN_ROOT, '.local', 'plastypesa-persona-state.json'),
);

const PERSONA_DEFINITIONS = {
  admin: {
    id: 'admin',
    label: 'PlastyPesa Admin',
    surface: 'admin-dashboard',
    authenticated: true,
  },
  mobileUser: {
    id: 'mobileUser',
    label: 'PlastyPesa Mobile User',
    surface: 'mobile-app',
    authenticated: true,
  },
  guest: {
    id: 'guest',
    label: 'PlastyPesa Guest',
    surface: 'mobile-app',
    authenticated: false,
  },
};

function defaultPersonaState() {
  return {
    version: 1,
    personas: {},
  };
}

function ensurePersonaStateFile() {
  if (existsSync(PERSONA_STATE_PATH)) {
    return PERSONA_STATE_PATH;
  }
  mkdirSync(dirname(PERSONA_STATE_PATH), { recursive: true });
  writeFileSync(
    PERSONA_STATE_PATH,
    `${JSON.stringify(defaultPersonaState(), null, 2)}\n`,
    'utf8',
  );
  return PERSONA_STATE_PATH;
}

function readPersonaState() {
  const path = ensurePersonaStateFile();
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writePersonaState(payload) {
  ensurePersonaStateFile();
  writeFileSync(PERSONA_STATE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildRuntimePersona(name) {
  const definition = PERSONA_DEFINITIONS[name];
  if (!definition) {
    throw new Error(`Unknown PlastyPesa persona: ${name}`);
  }

  if (name === 'admin') {
    const credentials = loadAdminDashboardCredentials();
    return {
      ...definition,
      credentials,
      email: credentials.email,
      credentialFilePath: credentials.filePath,
    };
  }

  if (name === 'mobileUser') {
    const credentials = loadMobileAppUserCredentials();
    return {
      ...definition,
      credentials,
      email: credentials.email,
      credentialFilePath: credentials.filePath,
    };
  }

  return {
    ...definition,
    credentials: null,
  };
}

export function listPlastypesaPersonas() {
  return Object.keys(PERSONA_DEFINITIONS).map((name) => {
    const persona = buildRuntimePersona(name);
    return {
      id: persona.id,
      label: persona.label,
      surface: persona.surface,
      authenticated: persona.authenticated,
      email: persona.email || null,
      credentialFilePath: persona.credentialFilePath || null,
    };
  });
}

export function getPlastypesaPersona(name) {
  return buildRuntimePersona(name);
}

export function rememberPersonaSession(name, patch = {}) {
  const persona = buildRuntimePersona(name);
  const state = readPersonaState();
  state.personas[name] = {
    ...(state.personas[name] || {}),
    id: persona.id,
    label: persona.label,
    surface: persona.surface,
    authenticated: persona.authenticated,
    email: persona.email || null,
    lastUsedAt: new Date().toISOString(),
    ...patch,
  };
  writePersonaState(state);
  return state.personas[name];
}

export function getRememberedPersonaSession(name) {
  const state = readPersonaState();
  return state.personas?.[name] || null;
}

export function clearPersonaSession(name) {
  const state = readPersonaState();
  if (state.personas?.[name]) {
    delete state.personas[name];
    writePersonaState(state);
  }
}

export function getPersonaStatePath() {
  return PERSONA_STATE_PATH;
}
