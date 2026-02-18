/**
 * nx packs ingest | nx packs watch | nx packs validate <zip>
 */
import path from 'node:path';
import fs from 'node:fs';
import AdmZip from 'adm-zip';
import { ingestZip, ingestFolder } from '../../packs/ingest.js';
import { startWatch } from '../../packs/watch.js';
import { validatePack } from '../../packs/validate.js';

export function packsIngestCommand(target: string, cwd: string = process.cwd()): void {
  const resolved = path.resolve(cwd, target);
  if (!fs.existsSync(resolved)) {
    console.error('Not found:', resolved);
    process.exit(1);
  }
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    const result = ingestFolder(resolved, cwd);
    if (result.success) {
      console.log('Case:', result.caseId);
      console.log('Path:', result.casePath);
    } else {
      console.error('Invalid pack:', result.reason);
      if (result.quarantinedPath) console.error('Quarantined:', result.quarantinedPath);
      process.exit(1);
    }
  } else if (resolved.toLowerCase().endsWith('.zip')) {
    const result = ingestZip(resolved, cwd);
    if (result.success) {
      console.log('Case:', result.caseId);
      console.log('Path:', result.casePath);
    } else {
      console.error('Invalid pack:', result.reason);
      if (result.quarantinedPath) console.error('Quarantined:', result.quarantinedPath);
      process.exit(1);
    }
  } else {
    console.error('Target must be a .zip file or a folder');
    process.exit(1);
  }
}

export function packsWatchCommand(): void {
  startWatch();
}

export function packsValidateCommand(target: string, cwd: string = process.cwd()): void {
  const resolved = path.resolve(cwd, target);
  if (!fs.existsSync(resolved)) {
    console.error('Not found:', resolved);
    process.exit(1);
  }
  if (!resolved.toLowerCase().endsWith('.zip')) {
    console.error('Target must be a .zip file');
    process.exit(1);
  }
  const zip = new AdmZip(resolved);
  const readFile = (name: string): string | null => {
    const entry = zip.getEntry(name);
    if (!entry || entry.isDirectory) return null;
    const buf = zip.readFile(entry);
    return buf ? buf.toString('utf8') : null;
  };
  const result = validatePack(readFile);
  console.log('Validation report');
  console.log('  valid:', result.valid);
  if (result.reason) console.log('  reason:', result.reason);
  if (result.meta) {
    console.log('  meta.pack_id:', result.meta.pack_id);
    console.log('  meta.app_id:', result.meta.app_id);
    console.log('  meta.schema_version:', result.meta.schema_version);
  }
  if (!result.valid) process.exit(1);
}
