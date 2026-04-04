import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const EXCLUDE = new Set([
  'node_modules',
  'dist',
  '.git',
  'target',
  '.neoxten-out',
  '.neoxten-operator',
]);

/** Lightweight static scan: collect `data-testid="..."` strings under repo (best-effort). */
export function scanDataTestIds(repoRoot: string, maxFiles = 800): string[] {
  const root = repoRoot;
  if (!existsSync(root)) return [];
  const found = new Set<string>();
  let fileCount = 0;

  function walk(dir: string): void {
    if (fileCount >= maxFiles) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (fileCount >= maxFiles) return;
      if (EXCLUDE.has(name)) continue;
      const full = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else {
        const ext = extname(name).toLowerCase();
        if (!['.tsx', '.ts', '.jsx', '.js', '.vue', '.svelte'].includes(ext)) continue;
        if (st.size > 400_000) continue;
        fileCount += 1;
        try {
          const src = readFileSync(full, 'utf-8');
          const re = /data-testid\s*=\s*["']([^"']+)["']/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(src)) !== null) {
            found.add(m[1]!);
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  walk(root);
  return [...found].sort();
}
