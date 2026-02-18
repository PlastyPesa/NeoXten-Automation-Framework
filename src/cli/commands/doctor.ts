/**
 * nx doctor — check Evidence Pack environment and paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import { opsBugsRoot, casesDir, evidencePacksRoot, quarantineDir } from '../../packs/paths.js';

export function doctorCommand(cwd: string = process.cwd()): void {
  const issues: string[] = [];
  const ok: string[] = [];

  const nodeVer = process.version;
  if (nodeVer) ok.push(`Node ${nodeVer}`);
  else issues.push('Node version unknown');

  const opsRoot = opsBugsRoot(cwd);
  if (fs.existsSync(opsRoot)) {
    ok.push(`ops/bugs: ${path.resolve(cwd, 'ops', 'bugs')}`);
  } else {
    issues.push('ops/bugs missing — run: nx init');
  }

  const cases = casesDir(cwd);
  if (fs.existsSync(cases)) ok.push(`cases dir exists`);
  else issues.push('cases dir missing — run: nx init');

  const packsRoot = evidencePacksRoot();
  if (fs.existsSync(packsRoot)) {
    ok.push(`EvidencePacks root: ${packsRoot}`);
  } else {
    issues.push('EvidencePacks root missing — run: nx init');
  }

  const quarantine = quarantineDir();
  if (fs.existsSync(quarantine)) ok.push('quarantine dir exists');
  else issues.push('quarantine dir missing — run: nx init');

  if (ok.length) {
    console.log('OK');
    ok.forEach((line) => console.log('  ' + line));
  }
  if (issues.length) {
    console.log('Issues');
    issues.forEach((line) => console.log('  ' + line));
    process.exit(1);
  }
}
