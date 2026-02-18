/**
 * Watch EvidencePacks root for new *.zip; debounce and ingest.
 */
import path from 'node:path';
import fs from 'node:fs';
import chokidar from 'chokidar';
import { evidencePacksRoot, ensureDir } from './paths.js';
import { ingestZip } from './ingest.js';
import { loadState, getCaseIdForPack } from './state.js';
import AdmZip from 'adm-zip';

const DEBOUNCE_MS = 2000;
const cwd = process.cwd();

function getPackIdFromZip(zipPath: string): string | null {
  try {
    const zip = new AdmZip(zipPath);
    const metaEntry = zip.getEntry('meta.json');
    if (!metaEntry || metaEntry.isDirectory) return null;
    const buf = zip.readFile(metaEntry);
    if (!buf) return null;
    const meta = JSON.parse(buf.toString('utf8')) as { pack_id?: string };
    return meta.pack_id ?? null;
  } catch {
    return null;
  }
}

export function startWatch(): void {
  const root = evidencePacksRoot();
  ensureDir(root);
  const pending = new Map<string, NodeJS.Timeout>();

  const processZip = (zipPath: string) => {
    const packId = getPackIdFromZip(zipPath);
    if (packId && getCaseIdForPack(packId, cwd)) {
      return;
    }
    const result = ingestZip(zipPath, cwd);
    if (result.success && result.caseId) {
      console.log(`Ingested: ${zipPath} -> ${result.caseId}`);
    } else if (!result.success && result.reason) {
      console.error(`Quarantined: ${zipPath} - ${result.reason}`);
    }
  };

  const schedule = (zipPath: string) => {
    const key = path.resolve(zipPath);
    if (pending.has(key)) {
      clearTimeout(pending.get(key)!);
    }
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        if (fs.existsSync(zipPath)) processZip(zipPath);
      }, DEBOUNCE_MS)
    );
  };

  const watcher = chokidar.watch(path.join(root, '**', '*.zip'), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });
  watcher.on('add', (p) => schedule(p));
  console.log(`Watching for *.zip under ${root} (debounce ${DEBOUNCE_MS}ms). Press Ctrl+C to stop.`);
}
