/**
 * Operator: run-manifest + SQLite ingest round-trip (isolated temp home).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { openOperatorDb } from '../operator/db/client.js';
import { ingestRunManifest, parseManifestFromPath } from '../operator/ingest/service.js';
import { buildVerdict } from '../core/verdict.js';
import { writeRunManifestToRunDir } from '../operator/manifest/build.js';
import {
  runs as runsTable,
  issues as issuesTable,
  findings as findingsTable,
} from '../operator/db/schema.js';
import { assembleHumanStyleManifestExtras } from '../operator/findings/assemble-manifest-extras.js';
import type { EvidenceSummary } from '../evidence/collector.js';

async function testIngestRoundTrip() {
  const home = mkdtempSync(join(tmpdir(), 'neoxten-op-test-'));
  const runDir = join(home, 'run1', randomUUID());
  mkdirSync(join(runDir, 'screenshots'), { recursive: true });
  writeFileSync(join(runDir, 'screenshots', 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const verdict = buildVerdict({
    verdict: 'FAIL',
    exitCode: 1,
    runId: randomUUID(),
    failingStage: 'ui_flow',
    failingFlow: 'smoke',
    failingStep: 0,
    reproducibleCommand: 'neoxten run --config ./x.yaml',
    logExcerpts: ['selector timeout'],
  });
  writeFileSync(join(runDir, 'verdict.json'), JSON.stringify(verdict), 'utf-8');
  const emptySummary: EvidenceSummary = {
    timeline: [],
    screenshots: [],
    consoleErrors: [],
    actionResults: [],
    notes: [],
    totalActions: 0,
    failedActions: 0,
    totalDurationMs: 0,
    observationSnapshots: [],
  };
  const extras = assembleHumanStyleManifestExtras(verdict, emptySummary, runDir);
  writeRunManifestToRunDir({
    runDir,
    verdict,
    configPath: join(home, 'neoxten.yaml'),
    suiteId: 'operator',
    evidenceTimeline: emptySummary.timeline,
    findings: extras.findings,
    retestHints: extras.retestHints,
    validationClosure: extras.validationClosure,
  });

  const { db } = openOperatorDb(home);
  const manifest = parseManifestFromPath(runDir);
  const { runDbId, issueId } = ingestRunManifest(db, manifest, runDir, {
    operatorHome: home,
    projectSlug: 'neoxtemus',
  });

  if (!runDbId) throw new Error('expected runDbId');
  if (!issueId) throw new Error('expected issue for failed run');

  const rows = db.select().from(runsTable).all();
  if (rows.length !== 1) throw new Error(`expected 1 run, got ${rows.length}`);

  const issuesRows = db.select().from(issuesTable).all();
  if (issuesRows.length !== 1) throw new Error(`expected 1 issue, got ${issuesRows.length}`);

  const findingRows = db.select().from(findingsTable).all();
  if (findingRows.length < 1) throw new Error(`expected ≥1 ingested finding, got ${findingRows.length}`);
}

async function testScanDataTestIds() {
  const { scanDataTestIds } = await import('../operator/code-map/scan.js');
  const dir = mkdtempSync(join(tmpdir(), 'neoxten-scan-'));
  writeFileSync(
    join(dir, 'a.tsx'),
    `export const X = () => <button data-testid="btn-save">OK</button>;`,
    'utf-8',
  );
  const ids = scanDataTestIds(dir);
  if (!ids.includes('btn-save')) throw new Error(`expected btn-save in ${ids.join(',')}`);
}

void (async () => {
  await testIngestRoundTrip();
  await testScanDataTestIds();
  console.log('operator-ingest.test: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
