/**
 * nx bugs list | nx bugs open <caseId|latest> | nx bugs close <caseId|latest> [--note "..."]
 * status.json written on close (status, note, closed_at).
 */
import fs from 'node:fs';
import path from 'node:path';
import { casesDir } from '../../packs/paths.js';

function listCases(cwd: string): string[] {
  const dir = casesDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => {
    const p = path.join(dir, name);
    return fs.statSync(p).isDirectory() && name.startsWith('BUG-');
  });
}

/** Resolve caseId to actual id; "latest" -> most recent case. */
function resolveCaseId(caseId: string, cwd: string): string {
  if (caseId !== 'latest') return caseId;
  const cases = listCases(cwd).sort().reverse();
  if (cases.length === 0) {
    console.error('No cases. "latest" requires at least one case.');
    process.exit(1);
  }
  return cases[0];
}

export function bugsListCommand(cwd: string = process.cwd()): void {
  const cases = listCases(cwd);
  if (cases.length === 0) {
    console.log('No cases.');
    return;
  }
  for (const id of cases.sort()) {
    console.log(id);
  }
}

export function bugsOpenCommand(caseId: string, cwd: string = process.cwd()): void {
  const id = resolveCaseId(caseId, cwd);
  const dir = casesDir(cwd);
  const casePath = path.join(dir, id);
  if (!fs.existsSync(casePath)) {
    console.error('Case not found:', id);
    process.exit(1);
  }
  const promptPath = path.join(casePath, 'output', 'agent_prompt.md');
  if (fs.existsSync(promptPath)) {
    console.log(fs.readFileSync(promptPath, 'utf8'));
  } else {
    console.log('Case path:', casePath);
  }
}

export function bugsCloseCommand(
  caseId: string,
  cwd: string = process.cwd(),
  options?: { note?: string }
): void {
  const id = resolveCaseId(caseId, cwd);
  const dir = casesDir(cwd);
  const casePath = path.join(dir, id);
  if (!fs.existsSync(casePath)) {
    console.error('Case not found:', id);
    process.exit(1);
  }

  const statusPath = path.join(casePath, 'status.json');
  const status = {
    status: 'closed',
    note: options?.note ?? '',
    closed_at: new Date().toISOString(),
  };
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');

  const closedDir = path.join(dir, '_closed');
  try {
    fs.mkdirSync(closedDir, { recursive: true });
  } catch {}
  const dest = path.join(closedDir, id);
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
  }
  fs.renameSync(casePath, dest);
  console.log('Closed:', id, '->', dest);
}
