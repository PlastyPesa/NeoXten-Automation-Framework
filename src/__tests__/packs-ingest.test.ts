/**
 * Evidence Pack ingestion tests: valid pack -> case; invalid -> quarantine; redaction.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { ingestZip } from '../packs/ingest.js';

const TEST_DIR = path.join(os.tmpdir(), 'neoxten-pack-test-' + Date.now());

function setup(): void {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function teardown(): void {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
}

function createValidZip(outPath: string): void {
  const now = new Date().toISOString();
  const zip = new AdmZip();
  zip.addFile(
    'meta.json',
    Buffer.from(
      JSON.stringify({
        schema_version: '2025.1',
        pack_id: 'test-' + Date.now(),
        app_id: 'testapp',
        created_at: now,
      }),
      'utf8'
    )
  );
  zip.addFile('events.ndjson', Buffer.from(JSON.stringify({ ts: now, type: 'test' }) + '\n', 'utf8'));
  zip.addFile('errors.json', Buffer.from(JSON.stringify([{ message: 'err' }]), 'utf8'));
  zip.addFile('logs.ndjson', Buffer.from(JSON.stringify({ msg: 'log', ts: now }) + '\n', 'utf8'));
  zip.addFile('network.ndjson', Buffer.from(JSON.stringify({ url: '/', ts: now }) + '\n', 'utf8'));
  zip.addFile('ui.json', Buffer.from(JSON.stringify({ screen: 'Test' }), 'utf8'));
  zip.writeZip(outPath);
}

function createInvalidZip(outPath: string): void {
  const zip = new AdmZip();
  zip.addFile('meta.json', Buffer.from(JSON.stringify({ schema_version: '1999.0', pack_id: 'x' }), 'utf8'));
  zip.addFile('events.ndjson', Buffer.from('{}', 'utf8'));
  zip.addFile('errors.json', Buffer.from('[]', 'utf8'));
  zip.addFile('logs.ndjson', Buffer.from('', 'utf8'));
  zip.addFile('network.ndjson', Buffer.from('', 'utf8'));
  zip.addFile('ui.json', Buffer.from('{}', 'utf8'));
  zip.writeZip(outPath);
}

function createZipWithToken(outPath: string): void {
  const now = new Date().toISOString();
  const zip = new AdmZip();
  zip.addFile(
    'meta.json',
    Buffer.from(
      JSON.stringify({
        schema_version: '2025.1',
        pack_id: 'redact-test-' + Date.now(),
        app_id: 'testapp',
        created_at: now,
      }),
      'utf8'
    )
  );
  zip.addFile('events.ndjson', Buffer.from(JSON.stringify({ ts: now, type: 'test' }) + '\n', 'utf8'));
  zip.addFile('errors.json', Buffer.from(JSON.stringify([]), 'utf8'));
  zip.addFile(
    'logs.ndjson',
    Buffer.from(JSON.stringify({ msg: 'Secret: sk-abc123def456ghi789jkl012xyz', ts: now }) + '\n', 'utf8')
  );
  zip.addFile('network.ndjson', Buffer.from(JSON.stringify({ url: '/', ts: now }) + '\n', 'utf8'));
  zip.addFile('ui.json', Buffer.from(JSON.stringify({}), 'utf8'));
  zip.writeZip(outPath);
}

function runTests(): void {
  setup();
  const specsDir = path.resolve(process.cwd(), 'specs');
  let passed = 0;
  let failed = 0;

  // 1) Ingest valid pack -> case folder exists + required outputs exist
  const validZip = path.join(TEST_DIR, 'valid.zip');
  createValidZip(validZip);
  const result1 = ingestZip(validZip, TEST_DIR);
  if (!result1.success || !result1.casePath) {
    console.error('FAIL: ingest valid pack - expected success and casePath');
    failed++;
  } else {
    const outDir = path.join(result1.casePath!, 'output');
    const required = ['bug_report.md', 'agent_prompt.md', 'signals.json', 'events_excerpt.ndjson', 'logs_excerpt.ndjson'];
    const missing = required.filter((f) => !fs.existsSync(path.join(outDir, f)));
    if (missing.length > 0) {
      console.error('FAIL: missing outputs:', missing);
      failed++;
    } else {
      console.log('PASS: ingest valid pack -> case + outputs');
      passed++;
    }
  }

  // 2) Ingest invalid pack -> goes to quarantine with reason
  const invalidZip = path.join(TEST_DIR, 'invalid.zip');
  createInvalidZip(invalidZip);
  const result2 = ingestZip(invalidZip, TEST_DIR);
  if (result2.success) {
    console.error('FAIL: ingest invalid pack - expected failure');
    failed++;
  } else if (!result2.reason) {
    console.error('FAIL: expected reason');
    failed++;
  } else {
    console.log('PASS: ingest invalid pack -> quarantine with reason');
    passed++;
  }

  // 3) Redaction removes known token patterns from outputs
  const tokenZip = path.join(TEST_DIR, 'token.zip');
  createZipWithToken(tokenZip);
  const result3 = ingestZip(tokenZip, TEST_DIR);
  if (!result3.success || !result3.casePath) {
    console.error('FAIL: ingest token pack');
    failed++;
  } else {
    const bugReport = fs.readFileSync(path.join(result3.casePath, 'output', 'bug_report.md'), 'utf8');
    const logsExcerpt = fs.readFileSync(path.join(result3.casePath, 'output', 'logs_excerpt.ndjson'), 'utf8');
    const hasSecret = bugReport.includes('sk-abc') || logsExcerpt.includes('sk-abc');
    const hasRedacted = bugReport.includes('[REDACTED') || logsExcerpt.includes('[REDACTED');
    if (hasSecret || !hasRedacted) {
      console.error('FAIL: redaction - token should be redacted. hasSecret=', hasSecret, 'hasRedacted=', hasRedacted);
      failed++;
    } else {
      console.log('PASS: redaction removes token pattern from outputs');
      passed++;
    }
  }

  teardown();
  console.log('');
  console.log('Result:', passed, 'passed', failed, 'failed');
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
