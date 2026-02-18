/**
 * nx init — bootstrap ops/bugs and EvidencePacks root.
 */
import { opsBugsRoot, casesDir, evidencePacksRoot, quarantineDir, ensureDir } from '../../packs/paths.js';

export function initCommand(cwd: string = process.cwd()): void {
  ensureDir(opsBugsRoot(cwd));
  ensureDir(casesDir(cwd));
  ensureDir(evidencePacksRoot());
  ensureDir(quarantineDir());
  console.log('Initialized:');
  console.log('  ops/bugs/ (cases)');
  console.log('  ' + evidencePacksRoot() + ' (EvidencePacks root)');
}
