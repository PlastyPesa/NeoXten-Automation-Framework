/**
 * Generate a valid Evidence Pack zip for testing.
 * Usage: node dist/tools/gen-sample-pack.js [output-path]
 * Default output: %LOCALAPPDATA%\NeoXten\EvidencePacks\neoxtemus\sample-<timestamp>.zip (so watch can auto-ingest)
 */
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { evidencePacksRoot } from '../packs/paths.js';

const REQUIRED = ['meta.json', 'events.ndjson', 'errors.json', 'logs.ndjson', 'network.ndjson', 'ui.json'] as const;

function samplePackFolder(): Map<string, string> {
  const packId = 'sample-' + Date.now();
  const appId = 'neoxtemus';
  const now = new Date().toISOString();
  const files = new Map<string, string>();

  files.set(
    'meta.json',
    JSON.stringify(
      {
        schema_version: '2025.1',
        pack_id: packId,
        app_id: appId,
        created_at: now,
        screen: 'AssistantView',
        summary: 'Sample pack for testing',
      },
      null,
      2
    )
  );

  files.set(
    'events.ndjson',
    [
      JSON.stringify({ ts: now, type: 'nav', label: 'Screen load', data: {} }),
      JSON.stringify({ ts: now, type: 'click', label: 'Button', data: { id: 'btn-1' } }),
    ].join('\n')
  );

  files.set(
    'errors.json',
    JSON.stringify([
      { message: 'Sample error for bug_report', stack: 'Error: Sample', ts: now },
    ])
  );

  files.set(
    'logs.ndjson',
    [
      JSON.stringify({ level: 'info', msg: 'App started', ts: now }),
      JSON.stringify({ level: 'info', msg: 'Token used: sk-abc123def456ghi789jkl012', ts: now }),
    ].join('\n')
  );

  files.set(
    'network.ndjson',
    JSON.stringify({ ts: now, url: '/api/status', method: 'GET', status: 200 }) + '\n'
  );

  files.set('ui.json', JSON.stringify({ screen: 'AssistantView', route: '/' }, null, 2));

  return files;
}

function main(): void {
  const outPath =
    process.argv[2] ??
    path.join(evidencePacksRoot(), 'neoxtemus', `sample-${Date.now()}.zip`);
  const files = samplePackFolder();
  const zip = new AdmZip();
  for (const [name, content] of files) {
    zip.addFile(name, Buffer.from(content, 'utf8'));
  }
  zip.addFile('attachments/.gitkeep', Buffer.from('', 'utf8'));
  const dir = path.dirname(outPath);
  if (dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
  }
  zip.writeZip(outPath);
  console.log('Wrote:', path.resolve(outPath));
}

main();
