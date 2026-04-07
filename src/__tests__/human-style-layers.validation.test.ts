/**
 * Validation suite: B.1 layout findings, design_system lifecycle, manifest artifacts.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { buildVerdict } from '../core/verdict.js';
import { buildLayoutFindingsFromSnapshots } from '../operator/findings/layout-b1.js';
import { buildDesignSystemFindingsFromArtifact } from '../operator/findings/assemble-manifest-extras.js';
import { buildRunManifest } from '../operator/manifest/build.js';
import { computeValidationClosureSummary } from '../operator/findings/closure.js';
import { emptyLayoutMetrics } from '../observer/layout-metrics-types.js';
import type { PageSnapshot } from '../observer/snapshot.js';
import { createOperatorApp } from '../operator/api/server.js';
import { ingestRunManifest } from '../operator/ingest/service.js';
import { openOperatorDb } from '../operator/db/client.js';
import { issues as issuesTable } from '../operator/db/schema.js';
import { RunManifestSchema, type RunManifest } from '../operator/manifest/schema.js';

function snap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  const { layoutMetrics: lm, ...rest } = over;
  return {
    url: 'https://example.test/p',
    title: 't',
    timestamp: new Date().toISOString(),
    viewportSize: { width: 800, height: 600 },
    buttons: [],
    inputs: [],
    links: [],
    headings: [],
    testIds: {},
    visibleText: '',
    hasSpinner: false,
    hasModal: false,
    hasErrorDialog: false,
    consoleErrors: [],
    pendingRequests: 0,
    networkIdle: true,
    layoutMetrics: { ...emptyLayoutMetrics(), ...lm },
    ...rest,
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function testB1MetricsAndKinds() {
  const all = buildLayoutFindingsFromSnapshots([
    snap({
      layoutMetrics: {
        ...emptyLayoutMetrics(),
        rootOverflowXHiddenClipRisk: true,
        horizontalOverflowPx: 120,
        scrollOverflowX: 40,
        bodyVerticalClipRisk: true,
        scrollOverflowY: 200,
        overlapPairCount: 2,
        maxInteractableOverlapRatio: 0.2,
        gridMisalignedBlockCount: 5,
        gridDeviationSamplesPx: [3, 4, 3, 4, 5],
      },
    }),
    snap({
      layoutMetrics: {
        ...emptyLayoutMetrics(),
        multipleHeavyH1: true,
        visibleH1Count: 2,
        hierarchyLevelInversion: true,
        weakPrimaryVsSecondary: true,
        noPrimaryControlInFold: true,
        viewportActionableCount: 3,
        competingCtaCount: 2,
        genericErrorBannerText: true,
      },
    }),
    snap({ hasSpinner: true, hasErrorDialog: true, pendingRequests: 8 }),
  ]);
  const oracles = new Set(all.map((f) => f.oracle_id));
  assert(oracles.has('neo.b1.clip.horizontal_overflow_hidden'), 'horizontal clip');
  assert(oracles.has('neo.b1.clip.body_overflow_hidden'), 'body overflow clip');
  assert(oracles.has('neo.b1.overlap.interactables'), 'overlap');
  assert(oracles.has('neo.b1.spacing.grid_deviation'), 'grid finding');
  assert(oracles.has('neo.b1.hierarchy.multi_h1'), 'multi h1');
  assert(oracles.has('neo.b1.hierarchy.inversion'), 'inversion');
  assert(oracles.has('neo.b1.cta.weak_primary'), 'weak primary');
  assert(oracles.has('neo.b1.cta.no_primary_fold'), 'no primary');
  assert(oracles.has('neo.b1.cta.competing'), 'competing cta');
  assert(oracles.has('neo.b1.state.generic_error_copy'), 'generic error');
  assert(oracles.has('neo.b1.state.error_and_spinner'), 'err+spin');
  assert(oracles.has('neo.b1.state.error_with_pending_network'), 'err+net');
  const grid = all.find((f) => f.oracle_id === 'neo.b1.spacing.grid_deviation');
  assert(!!grid, 'grid row');
  const nm = grid!.evidence_refs?.[0]?.numeric_metrics;
  assert(nm?.misaligned_blocks === 5, 'evidence carries grid count');
  assert(typeof nm?.samples === 'string' && nm.samples.includes('3'), 'evidence carries samples');

  for (const f of all) {
    const oid = f.oracle_id ?? '';
    assert(
      f.kind === 'visual' || f.kind === 'ux',
      `B.1 kind must be visual|ux, got ${f.kind} ${oid}`,
    );
    assert(oid.startsWith('neo.b1.'), `oracle prefix ${oid}`);
    assert(f.kind !== 'design_system' && f.kind !== 'a11y', 'no cross-kind wiring');
  }
  const a11y = all.filter((f) => f.kind === 'a11y');
  assert(a11y.length === 0, 'layout builder must not emit a11y');
}

function testDesignStrengthAndBlocks() {
  const d = mkdtempSync(join(tmpdir(), 'neo-design-'));
  const prev = process.env.NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE;
  try {
    writeFileSync(
      join(d, 'design-token-diff.json'),
      JSON.stringify({
        violations: [
          { path: 'colors.brand', message: 'diff', expected: '#fff', actual: '#000' },
          { path: 'spacing.1', message: 'likely only', expected: '', actual: '' },
          { message: 'pattern only' },
          { message: 'x', suggestive_only: true, path: 'p', expected: 'a', actual: 'b' },
        ],
      }),
    );
    let fs = buildDesignSystemFindingsFromArtifact(d);
    assert(fs.length === 4, 'four violations');
    assert(fs[0]!.evidence_strength === 'proven' && fs[0]!.determinism === 'diff', 'proven');
    assert(fs[0]!.blocks_merge === false, 'blocks off by default');
    assert(fs[1]!.evidence_strength === 'likely', 'likely');
    assert(fs[1]!.determinism === 'heuristic', 'likely determinism');
    assert(fs[2]!.evidence_strength === 'suggestive', 'suggestive');
    assert(fs[2]!.severity === 'minor', 'suggestive minor');
    assert(fs[2]!.confidence === 'low' && fs[2]!.determinism === 'heuristic', 'suggestive confidence');
    assert(fs[0]!.confidence === 'medium' && fs[0]!.determinism === 'diff', 'proven confidence');
    assert(fs[3]!.evidence_strength === 'suggestive', 'suggestive_only wins');

    process.env.NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE = '1';
    fs = buildDesignSystemFindingsFromArtifact(d);
    assert(fs[0]!.blocks_merge === true, 'proven blocks with env');
    assert(fs[1]!.blocks_merge === false, 'likely never blocks');
  } finally {
    if (prev === undefined) delete process.env.NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE;
    else process.env.NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE = prev;
  }
}

function testClosureCountsDesignBlocks() {
  const d = mkdtempSync(join(tmpdir(), 'neo-closure-'));
  writeFileSync(
    join(d, 'design-token-diff.json'),
    JSON.stringify({
      violations: [{ path: 'x', message: 'm', expected: '1', actual: '2' }],
    }),
  );
  const prev = process.env.NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE;
  process.env.NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE = '1';
  try {
    const fs = buildDesignSystemFindingsFromArtifact(d);
    const c = computeValidationClosureSummary({
      verdictPassed: true,
      findings: fs,
      pendingRequiredRetests: 0,
      openPromotedMajorBlockerIssues: 0,
      operatorReviewRequired: false,
      operatorSignoffPresent: false,
    });
    assert(c.blocking_findings_count === 1, 'closure sees design block');
  } finally {
    if (prev === undefined) delete process.env.NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE;
    else process.env.NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE = prev;
  }
}

function testLayoutMetricsArtifactKind() {
  const home = mkdtempSync(join(tmpdir(), 'neo-lm-art-'));
  const runDir = join(home, 'r', randomUUID());
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'layout-metrics.json'), JSON.stringify({ ok: true }), 'utf-8');
  const verdict = buildVerdict({ verdict: 'PASS', runId: randomUUID(), exitCode: 0 });
  const m = buildRunManifest({ runDir, verdict, configPath: join(home, 'n.yaml') });
  const lm = m.artifacts.find((a) => a.relativePath === 'layout-metrics.json');
  assert(!!lm && lm.kind === 'layout_metrics', `artifact kind ${lm?.kind}`);
}

async function testIngestAutoPromoteAndPromoteClassification() {
  const home = mkdtempSync(join(tmpdir(), 'neo-ing-'));
  const runDir = join(home, 'run', randomUUID());
  mkdirSync(join(runDir, 'screenshots'), { recursive: true });
  writeFileSync(join(runDir, 'screenshots', 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const runId = randomUUID();
  const verdict = buildVerdict({ verdict: 'PASS', runId, exitCode: 0 });
  writeFileSync(join(runDir, 'verdict.json'), JSON.stringify(verdict), 'utf-8');
  writeFileSync(
    join(runDir, 'design-token-diff.json'),
    JSON.stringify({
      violations: [{ path: 'token.a', message: 'mismatch', expected: '1', actual: '2' }],
    }),
  );
  const designFindings = buildDesignSystemFindingsFromArtifact(runDir);
  assert(designFindings.length === 1 && designFindings[0]!.evidence_strength === 'proven', 'proven row');

  const now = new Date().toISOString();
  const manifest: RunManifest = RunManifestSchema.parse({
    schemaVersion: '2026.2',
    runId,
    ingestedAt: now,
    completedAt: verdict.timestamp,
    configPath: join(home, 'neoxten.yaml'),
    verdict,
    artifacts: [{ relativePath: 'verdict.json', kind: 'verdict' }],
    findings: designFindings,
    validationClosure: {
      verdict_ok: true,
      blocking_findings_count: 0,
      pending_required_retests: 0,
      open_promoted_issues_blockers: 0,
      high_confidence_suspicion_present: false,
      operator_review_satisfied: true,
      advisory_findings_count: 1,
      accepted_debt: false,
    },
  });

  const prevAuto = process.env.NEOXTEN_AUTO_PROMOTE_PROVEN_DESIGN;
  process.env.NEOXTEN_AUTO_PROMOTE_PROVEN_DESIGN = '1';
  try {
    const { db } = openOperatorDb(home);
    const { runDbId } = ingestRunManifest(db, manifest, runDir, { operatorHome: home });
    const autoRows = db.select().from(issuesTable).all();
    const auto = autoRows.filter((r) => r.classification === 'design_system_auto');
    assert(auto.length === 1, `expected 1 auto design issue, got ${auto.length}`);
    assert(auto[0]!.title.startsWith('[Design]'), 'title prefix');
  } finally {
    if (prevAuto === undefined) delete process.env.NEOXTEN_AUTO_PROMOTE_PROVEN_DESIGN;
    else process.env.NEOXTEN_AUTO_PROMOTE_PROVEN_DESIGN = prevAuto;
  }

  /* Manual promote via API — second run home to avoid duplicate runId collision */
  const home2 = mkdtempSync(join(tmpdir(), 'neo-ing2-'));
  const runDir2 = join(home2, 'run', randomUUID());
  mkdirSync(join(runDir2, 'screenshots'), { recursive: true });
  writeFileSync(join(runDir2, 'screenshots', 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const runId2 = randomUUID();
  const verdict2 = buildVerdict({ verdict: 'PASS', runId: runId2, exitCode: 0 });
  writeFileSync(join(runDir2, 'verdict.json'), JSON.stringify(verdict2), 'utf-8');
  writeFileSync(
    join(runDir2, 'design-token-diff.json'),
    JSON.stringify({
      violations: [{ path: 'token.b', message: 'm2', expected: 'a', actual: 'b' }],
    }),
  );
  const df2 = buildDesignSystemFindingsFromArtifact(runDir2);
  const manifest2: RunManifest = RunManifestSchema.parse({
    schemaVersion: '2026.2',
    runId: runId2,
    ingestedAt: now,
    completedAt: verdict2.timestamp,
    configPath: join(home2, 'neoxten.yaml'),
    verdict: verdict2,
    artifacts: [{ relativePath: 'verdict.json', kind: 'verdict' }],
    findings: df2,
    validationClosure: {
      verdict_ok: true,
      blocking_findings_count: 0,
      pending_required_retests: 0,
      open_promoted_issues_blockers: 0,
      high_confidence_suspicion_present: false,
      operator_review_satisfied: true,
      advisory_findings_count: 1,
      accepted_debt: false,
    },
  });
  delete process.env.NEOXTEN_OPERATOR_API_TOKEN;
  const { app } = await createOperatorApp({ operatorHome: home2, port: 0 });
  await app.ready();
  const ing = await app.inject({
    method: 'POST',
    url: '/api/runs/ingest',
    payload: { runDir: runDir2, manifest: manifest2 },
  });
  assert(ing.statusCode === 200, `ingest ${ing.body}`);
  const body = JSON.parse(ing.body) as { runDbId: string };
  const fid = df2[0]!.id;
  const prom = await app.inject({
    method: 'POST',
    url: `/api/runs/${body.runDbId}/findings/${fid}/promote`,
  });
  assert(prom.statusCode === 200, `promote ${prom.body}`);
  const iss = await app.inject({ method: 'GET', url: '/api/issues' });
  const list = JSON.parse(iss.body) as { issues: Array<{ classification: string | null }> };
  const promoted = list.issues.find((i) => i.classification === 'design_system_promoted');
  assert(!!promoted, 'design_system_promoted classification');
  await app.close();
}

void (async () => {
  await testB1MetricsAndKinds();
  testDesignStrengthAndBlocks();
  testClosureCountsDesignBlocks();
  testLayoutMetricsArtifactKind();
  await testIngestAutoPromoteAndPromoteClassification();
  console.log('human-style-layers.validation.test: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
