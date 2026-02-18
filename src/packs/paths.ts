/**
 * Evidence Pack paths — Windows LOCALAPPDATA, framework repo root.
 */
import path from 'node:path';
import fs from 'node:fs';

const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');

/** Default root for Evidence Packs (watch root). */
export function evidencePacksRoot(): string {
  return path.join(LOCALAPPDATA, 'NeoXten', 'EvidencePacks');
}

/** Quarantine directory for invalid packs. */
export function quarantineDir(): string {
  return path.join(evidencePacksRoot(), '_quarantine');
}

/** Resolve ops/bugs root (cwd or explicit). */
export function opsBugsRoot(cwd: string = process.cwd()): string {
  return path.join(cwd, 'ops', 'bugs');
}

/** Cases directory under ops/bugs. */
export function casesDir(cwd: string = process.cwd()): string {
  return path.join(opsBugsRoot(cwd), 'cases');
}

/** State DB path for ingested pack_id -> caseId. */
export function packsStatePath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.neoxten', 'packs-ingested.json');
}

/** Ensure directory exists. */
export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export const REQUIRED_FILES = ['meta.json', 'events.ndjson', 'errors.json', 'logs.ndjson', 'network.ndjson', 'ui.json'] as const;
export const SUPPORTED_SCHEMA_VERSION = '2025.1';
