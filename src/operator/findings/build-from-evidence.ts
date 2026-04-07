import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import type { Verdict } from '../../core/verdict.js';
import type { EvidenceSummary } from '../../evidence/collector.js';
import { FindingSchema, type Finding, type FindingDraft } from './schema.js';

function fpConsoleOnPass(runId: string, errors: string[]): string {
  const h = createHash('sha256');
  h.update('console-on-pass');
  h.update(runId);
  for (const e of errors.slice(0, 20)) h.update(e);
  return `neo-fp-${h.digest('hex').slice(0, 24)}`;
}

function fpUiFlow(runId: string, flow: string | null, step: number): string {
  const h = createHash('sha256');
  h.update('ui-flow');
  h.update(runId);
  h.update(flow ?? '');
  h.update(String(step));
  return `neo-fp-${h.digest('hex').slice(0, 24)}`;
}

/**
 * Deterministic human-style findings from orchestrator evidence (plan §3 oracles v1).
 */
export function buildFindingsFromEvidenceAndVerdict(
  verdict: Verdict,
  summary: EvidenceSummary,
): Finding[] {
  const drafts: FindingDraft[] = [];
  const passed = verdict.verdict === 'PASS' && verdict.exitCode === 0;

  if (passed && summary.consoleErrors.length > 0) {
    drafts.push({
      id: randomUUID(),
      kind: 'suspicion',
      origin: 'suite',
      severity: 'moderate',
      user_impact: 'Console errors appeared while the run was marked passed — may indicate hidden defects.',
      title: 'Console errors on passed run',
      detail: summary.consoleErrors.slice(0, 15).join('\n'),
      evidence_refs: [{ relativePath: 'console.log', numeric_metrics: { count: summary.consoleErrors.length } }],
      confidence: 'high',
      determinism: 'rule',
      oracle_id: 'neo.console.clean_on_pass',
      promotion_state: 'advisory',
      blocks_merge: false,
      fingerprint: fpConsoleOnPass(verdict.runId, summary.consoleErrors),
    });
  }

  if (!passed && verdict.failingStage === 'gate') {
    const lastLog = verdict.logExcerpts?.filter(Boolean).slice(-1)[0];
    drafts.push({
      id: randomUUID(),
      kind: 'functional',
      origin: 'suite',
      severity: 'major',
      title: lastLog ? `Gate failure: ${lastLog}` : 'Gate check failed',
      detail: verdict.logExcerpts?.slice(-5).join(' | ') ?? 'Gate threshold exceeded',
      evidence_refs: [{ relativePath: 'verdict.json' }],
      determinism: 'rule',
      oracle_id: 'neo.gates',
      promotion_state: 'run_only',
      blocks_merge: true,
    });
  }

  if (!passed && verdict.failingStage === 'ui_flow') {
    drafts.push({
      id: randomUUID(),
      kind: 'functional',
      origin: 'suite',
      severity: 'major',
      title: verdict.failingFlow
        ? `UI flow failed: ${verdict.failingFlow} (step ${verdict.failingStep})`
        : 'UI flow step failed',
      detail: verdict.logExcerpts?.slice(-5).join(' | ') ?? 'Flow step did not succeed',
      evidence_refs: [{ relativePath: 'verdict.json' }],
      determinism: 'rule',
      oracle_id: 'neo.ui_flow',
      promotion_state: 'run_only',
      blocks_merge: true,
      fingerprint: fpUiFlow(verdict.runId, verdict.failingFlow, verdict.failingStep),
    });
  }

  if (!passed && verdict.failingStage === 'launch') {
    drafts.push({
      id: randomUUID(),
      kind: 'functional',
      origin: 'suite',
      severity: 'blocker',
      title: 'Launch / infrastructure failure',
      detail: verdict.logExcerpts?.slice(-5).join(' | ') ?? verdict.failingStage ?? 'infra',
      evidence_refs: [{ relativePath: 'verdict.json' }],
      determinism: 'rule',
      oracle_id: 'neo.launch',
      promotion_state: 'run_only',
      blocks_merge: true,
    });
  }

  return drafts.map((d) => FindingSchema.parse(d));
}
