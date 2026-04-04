/**
 * Operator dogfood: Fastify inject API, evidence-pack meta contract, git patch sandbox.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { execSync } from 'node:child_process';
import { createOperatorApp } from '../operator/api/server.js';
import { buildVerdict } from '../core/verdict.js';
import { writeRunManifestToRunDir } from '../operator/manifest/build.js';
import AdmZip from 'adm-zip';
import { ingestZip } from '../packs/ingest.js';

function hasGit(): boolean {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function assertEvidencePackMetaValid(meta: unknown): void {
  if (!meta || typeof meta !== 'object') throw new Error('meta not object');
  const m = meta as Record<string, unknown>;
  if (m.schema_version !== '2025.1') throw new Error('schema_version');
  if (typeof m.pack_id !== 'string' || !m.pack_id) throw new Error('pack_id');
  if (typeof m.app_id !== 'string' || !m.app_id) throw new Error('app_id');
  if (typeof m.created_at !== 'string' || !m.created_at) throw new Error('created_at');
}

async function testApiInjectIngest() {
  const home = mkdtempSync(join(tmpdir(), 'neoxten-dogfood-api-'));
  process.env.NEOXTEN_FRAMEWORK_ROOT = process.cwd();
  delete process.env.NEOXTEN_OPERATOR_API_TOKEN;
  const { app } = await createOperatorApp({ operatorHome: home, port: 0 });
  await app.ready();

  const h = await app.inject({ method: 'GET', url: '/api/health' });
  if (h.statusCode !== 200) throw new Error(`health ${h.statusCode}`);

  const runDir = join(home, 'run1', randomUUID());
  mkdirSync(join(runDir, 'screenshots'), { recursive: true });
  writeFileSync(join(runDir, 'screenshots', 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const verdict = buildVerdict({
    verdict: 'PASS',
    exitCode: 0,
    runId: randomUUID(),
  });
  writeFileSync(join(runDir, 'verdict.json'), JSON.stringify(verdict), 'utf-8');
  writeRunManifestToRunDir({
    runDir,
    verdict,
    configPath: join(home, 'neoxten.yaml'),
    suiteId: 'operator',
  });

  const ing = await app.inject({
    method: 'POST',
    url: '/api/runs/ingest',
    payload: { runDir },
  });
  if (ing.statusCode !== 200) throw new Error(`ingest ${ing.statusCode} ${ing.body}`);

  const list = await app.inject({ method: 'GET', url: '/api/runs' });
  if (list.statusCode !== 200) throw new Error(`runs ${list.statusCode}`);
  const body = JSON.parse(list.body) as { runs: unknown[] };
  if (body.runs.length !== 1) throw new Error(`expected 1 run, got ${body.runs.length}`);

  const ex = await app.inject({ method: 'GET', url: '/api/explain/failed_step' });
  if (ex.statusCode !== 200) throw new Error(`explain ${ex.statusCode}`);

  await app.close();
}

async function testEvidencePackZipRoundTrip() {
  const outDir = mkdtempSync(join(tmpdir(), 'neoxten-dogfood-pack-'));
  const zipPath = join(outDir, 'pack.zip');
  const now = new Date().toISOString();
  const zip = new AdmZip();
  zip.addFile(
    'meta.json',
    Buffer.from(
      JSON.stringify({
        schema_version: '2025.1',
        pack_id: 'dogfood-' + randomUUID(),
        app_id: 'neoxten-operator-dogfood',
        created_at: now,
      }),
      'utf8',
    ),
  );
  zip.addFile('events.ndjson', Buffer.from(JSON.stringify({ ts: now, type: 'noop' }) + '\n', 'utf8'));
  zip.addFile('errors.json', Buffer.from(JSON.stringify([]), 'utf8'));
  zip.addFile('logs.ndjson', Buffer.from('', 'utf8'));
  zip.addFile('network.ndjson', Buffer.from('', 'utf8'));
  zip.addFile('ui.json', Buffer.from(JSON.stringify({}), 'utf8'));
  zip.writeZip(zipPath);

  const zread = new AdmZip(zipPath);
  const metaEnt = zread.getEntry('meta.json');
  if (!metaEnt || metaEnt.isDirectory) throw new Error('zip missing meta.json');
  const metaBuf = zread.readFile(metaEnt);
  if (!metaBuf) throw new Error('zip read meta');
  const metaRaw = metaBuf.toString('utf8');
  const metaParsed = JSON.parse(metaRaw) as Record<string, unknown>;
  assertEvidencePackMetaValid(metaParsed);

  const schemaPath = join(process.cwd(), 'specs', 'evidence-pack.schema.json');
  if (existsSync(schemaPath)) {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as {
      required?: string[];
    };
    for (const k of schema.required ?? []) {
      if (!(k in metaParsed)) throw new Error(`meta missing ${k}`);
    }
  }

  const ing = ingestZip(zipPath, outDir);
  if (!ing.success || !ing.casePath) throw new Error(`ingestZip failed: ${ing.reason ?? 'no casePath'}`);
  const signalsPath = join(ing.casePath, 'output', 'signals.json');
  const signals = JSON.parse(readFileSync(signalsPath, 'utf-8')) as { pack_id?: string };
  if (signals.pack_id !== metaParsed.pack_id) throw new Error('signals.pack_id mismatch');
}

function testGitPatchSandbox(): void {
  if (!hasGit()) {
    console.warn('operator-dogfood: skip git patch sandbox (git not available)');
    return;
  }
  const repo = mkdtempSync(join(tmpdir(), 'neoxten-patch-sandbox-'));
  execSync('git init', { cwd: repo, stdio: 'ignore' });
  execSync('git config user.email dogfood@neoxten.local', { cwd: repo, stdio: 'ignore' });
  execSync('git config user.name NeoXten Dogfood', { cwd: repo, stdio: 'ignore' });
  writeFileSync(join(repo, 'hello.txt'), 'a\n', 'utf-8');
  execSync('git add hello.txt', { cwd: repo, stdio: 'ignore' });
  execSync('git commit -m base', { cwd: repo, stdio: 'ignore' });
  const diff = `--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-a\n+b\n`;
  writeFileSync(join(repo, 'p.patch'), diff, 'utf-8');
  execSync('git apply p.patch', { cwd: repo, stdio: 'ignore' });
  const after = readFileSync(join(repo, 'hello.txt'), 'utf-8');
  if (after.trim() !== 'b') throw new Error(`expected b, got ${JSON.stringify(after)}`);
  execSync('git checkout -- hello.txt', { cwd: repo, stdio: 'ignore' });
  const rolled = readFileSync(join(repo, 'hello.txt'), 'utf-8');
  if (rolled.trim() !== 'a') throw new Error('rollback failed');
}

void (async () => {
  await testApiInjectIngest();
  await testEvidencePackZipRoundTrip();
  testGitPatchSandbox();
  console.log('operator-dogfood.test: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
