import { resolve, join } from 'path';
import { resolveProductDataDir, getDefaultOperatorHome } from '../runtime/product-paths.js';

/**
 * Operator SQLite + blob store root.
 *
 * Resolution order:
 * 1. `NEOXTEN_OPERATOR_HOME` — explicit override (tests, dev repo layout).
 * 2. `NEOXTEN_USE_CWD_OPERATOR_HOME=1` — legacy `<cwd>/.neoxten-operator` (contributor workflows).
 * 3. Product layout: `<NEOXTEN_DATA_DIR or OS data dir>/operator`.
 */
export function getOperatorHome(cwd: string = process.cwd()): string {
  if (process.env.NEOXTEN_OPERATOR_HOME?.trim()) {
    return resolve(process.env.NEOXTEN_OPERATOR_HOME.trim());
  }
  if (process.env.NEOXTEN_USE_CWD_OPERATOR_HOME === '1') {
    return join(cwd, '.neoxten-operator');
  }
  return getDefaultOperatorHome(resolveProductDataDir());
}

export function getBlobRoot(operatorHome: string): string {
  return join(operatorHome, 'blobs');
}
