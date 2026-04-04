import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { getConfigDir, resolveProductDataDir } from './product-paths.js';

export interface AppConfig {
  /** Preferred Control API port (may be adjusted if busy at startup). */
  operatorPort: number;
  /** Operator bind host (always loopback for local product). */
  operatorHost: string;
  /** Last port the service successfully bound (written on listen). */
  lastBoundPort?: number;
}

const DEFAULTS: AppConfig = {
  operatorPort: 8787,
  operatorHost: '127.0.0.1',
};

function configPath(): string {
  return getConfigDir(resolveProductDataDir()) + '/app.json';
}

export function loadAppConfig(): AppConfig {
  const p = configPath();
  if (!existsSync(p)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<AppConfig>;
    return {
      operatorPort: typeof raw.operatorPort === 'number' ? raw.operatorPort : DEFAULTS.operatorPort,
      operatorHost: typeof raw.operatorHost === 'string' ? raw.operatorHost : DEFAULTS.operatorHost,
      lastBoundPort: typeof raw.lastBoundPort === 'number' ? raw.lastBoundPort : undefined,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAppConfig(cfg: AppConfig): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
}

export interface FirstRunState {
  complete: boolean;
  completedAt?: string;
  /** Semver or product version string when completed. */
  productVersion?: string;
}

export function firstRunStatePath(): string {
  return getConfigDir(resolveProductDataDir()) + '/first-run.json';
}

export function loadFirstRunState(): FirstRunState {
  const p = firstRunStatePath();
  if (!existsSync(p)) {
    return { complete: false };
  }
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as FirstRunState;
  } catch {
    return { complete: false };
  }
}

export function saveFirstRunState(state: FirstRunState): void {
  const p = firstRunStatePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}
