import fs from 'node:fs';
import path from 'node:path';
import { packsStatePath } from './paths.js';

export function loadState(cwd: string = process.cwd()): Record<string, string> {
  const p = packsStatePath(cwd);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveState(state: Record<string, string>, cwd: string = process.cwd()): void {
  const p = packsStatePath(cwd);
  const dir = path.dirname(p);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

export function getCaseIdForPack(packId: string, cwd: string = process.cwd()): string | null {
  return loadState(cwd)[packId] ?? null;
}

export function recordIngested(packId: string, caseId: string, cwd: string = process.cwd()): void {
  const state = loadState(cwd);
  state[packId] = caseId;
  saveState(state, cwd);
}
