/**
 * Integration test: Simulates ENOENT (invalid cwd) and verifies the framework
 * returns a structured FAIL verdict (exitCode 2) instead of crashing.
 */
import { run } from '../core/orchestrator.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

async function testENOENTReturnsFailVerdict() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'neoxten-enoent-test-'));
  const configPath = join(tmpDir, 'enoent-config.yaml');

  writeFileSync(
    configPath,
    `project:
  type: tauri
  root: ${tmpDir}
  tauri:
    strategy: harness
    devCwd: does-not-exist
    devUrl: http://localhost:1420

flows: []
assistant:
  enabled: false
`,
    'utf-8'
  );

  const outDir = join(tmpDir, 'out');
  const { verdict } = await run({
    configPath,
    outDir,
  });

  if (verdict.verdict !== 'FAIL') {
    throw new Error(`Expected verdict FAIL, got ${verdict.verdict}`);
  }
  if (verdict.exitCode !== 2) {
    throw new Error(`Expected exitCode 2, got ${verdict.exitCode}`);
  }
  if (verdict.failingStage !== 'launch') {
    throw new Error(`Expected failingStage launch, got ${verdict.failingStage}`);
  }
  const hasENOENT = verdict.logExcerpts.some((s) => s.includes('ENOENT') || s.includes('does not exist'));
  if (!hasENOENT) {
    throw new Error(`Expected logExcerpts to mention ENOENT or "does not exist", got: ${JSON.stringify(verdict.logExcerpts)}`);
  }

  console.log('PASS: ENOENT produces FAIL verdict with exitCode 2');
}

testENOENTReturnsFailVerdict().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
