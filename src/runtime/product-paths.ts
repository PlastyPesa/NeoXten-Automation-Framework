/**
 * NeoXten local product layout (Option C: desktop shell + local service).
 * All paths are on-disk only; no cloud.
 */
import { homedir } from 'os';
import { join, resolve } from 'path';

/** Explicit product data root (config, logs, operator DB parent). */
export function resolveProductDataDir(): string {
  const env = process.env.NEOXTEN_DATA_DIR?.trim();
  if (env) return resolve(env);

  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    return join(base, 'NeoXten');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'NeoXten');
  }
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(xdg, 'neoxten');
}

export function getConfigDir(dataDir: string = resolveProductDataDir()): string {
  return join(dataDir, 'config');
}

export function getLogsDir(dataDir: string = resolveProductDataDir()): string {
  return join(dataDir, 'logs');
}

/** Operator SQLite + blobs live here (passed to openOperatorDb). */
export function getDefaultOperatorHome(dataDir: string = resolveProductDataDir()): string {
  return join(dataDir, 'operator');
}

export interface ProductPathSnapshot {
  productDataDir: string;
  configDir: string;
  logsDir: string;
  operatorHome: string;
  operatorSqlitePath: string;
  operatorBlobsDir: string;
  appConfigPath: string;
  firstRunStatePath: string;
  serviceLockPath: string;
}

export function getProductPathSnapshot(operatorHome: string): ProductPathSnapshot {
  const dataDir = resolveProductDataDir();
  const cfg = getConfigDir(dataDir);
  return {
    productDataDir: dataDir,
    configDir: cfg,
    logsDir: getLogsDir(dataDir),
    operatorHome,
    operatorSqlitePath: join(operatorHome, 'operator.sqlite'),
    operatorBlobsDir: join(operatorHome, 'blobs'),
    appConfigPath: join(cfg, 'app.json'),
    firstRunStatePath: join(cfg, 'first-run.json'),
    serviceLockPath: join(operatorHome, 'service-lock.json'),
  };
}
