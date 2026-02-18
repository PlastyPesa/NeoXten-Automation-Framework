/**
 * Validate Evidence Pack: required files + schema_version.
 */
export interface PackMeta {
  schema_version?: string;
  pack_id?: string;
  app_id?: string;
  created_at?: string;
  screen?: string;
  summary?: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  meta?: PackMeta;
}

const REQUIRED = ['meta.json', 'events.ndjson', 'errors.json', 'logs.ndjson', 'network.ndjson', 'ui.json'] as const;
const SUPPORTED_VERSION = '2025.1';

export function validatePack(
  readFile: (name: string) => string | null
): ValidationResult {
  for (const name of REQUIRED) {
    if (readFile(name) === null) {
      return { valid: false, reason: `Missing required file: ${name}` };
    }
  }
  const metaStr = readFile('meta.json');
  if (!metaStr) return { valid: false, reason: 'Missing meta.json' };
  let meta: PackMeta;
  try {
    meta = JSON.parse(metaStr) as PackMeta;
  } catch {
    return { valid: false, reason: 'meta.json is not valid JSON' };
  }
  const ver = meta.schema_version;
  if (ver !== SUPPORTED_VERSION) {
    return { valid: false, reason: `Unsupported meta.schema_version: ${ver}. Supported: ${SUPPORTED_VERSION}`, meta };
  }
  if (!meta.pack_id || !meta.app_id || !meta.created_at) {
    return { valid: false, reason: 'meta.json must contain pack_id, app_id, created_at', meta };
  }
  return { valid: true, meta };
}
