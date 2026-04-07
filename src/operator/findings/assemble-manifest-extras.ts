import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Verdict } from '../../core/verdict.js';
import type { EvidenceSummary } from '../../evidence/collector.js';
import {
  FindingSchema,
  type ExploratoryMeta,
  type Finding,
  type FindingDraft,
  type RetestHint,
} from './schema.js';
import { buildFindingsFromEvidenceAndVerdict } from './build-from-evidence.js';
import { buildLayoutFindingsFromSnapshots } from './layout-b1.js';
import { computeValidationClosureSummary } from './closure.js';
import { buildRetestHintsFromFindings } from './retest-hints.js';
import type { ValidationClosureSummary } from './schema.js';
import { randomUUID, createHash } from 'crypto';

interface A11yJson {
  violations?: Array<{ id: string; impact?: string; description?: string }>;
}

interface TokenDiffJson {
  violations?: Array<{
    path?: string;
    message: string;
    expected?: string;
    actual?: string;
    /** When true, treat as pattern-only signal (suggestive). */
    suggestive_only?: boolean;
    /** Optional explicit strength from producer. */
    evidence_strength?: 'proven' | 'likely' | 'suggestive';
  }>;
}

function inferTokenEvidenceStrength(v: {
  expected?: string;
  actual?: string;
  path?: string;
  message: string;
  suggestive_only?: boolean;
  evidence_strength?: 'proven' | 'likely' | 'suggestive';
}): 'proven' | 'likely' | 'suggestive' {
  if (v.evidence_strength) return v.evidence_strength;
  if (v.suggestive_only) return 'suggestive';
  const ex = v.expected != null && String(v.expected).trim().length > 0;
  const ac = v.actual != null && String(v.actual).trim().length > 0;
  if (ex && ac) return 'proven';
  if (v.path && v.message.length > 0) return 'likely';
  return 'suggestive';
}

function fingerprintDesignViolation(v: { path?: string; message: string }): string {
  const h = createHash('sha256');
  h.update('design-token');
  h.update(v.path ?? '');
  h.update(v.message);
  return `neo-fp-${h.digest('hex').slice(0, 24)}`;
}

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function buildA11yFindingsFromArtifact(runDir: string): Finding[] {
  const data = readJsonIfExists<A11yJson>(join(runDir, 'a11y-report.json'));
  if (!data?.violations?.length) return [];
  const drafts: FindingDraft[] = [];
  for (const v of data.violations.slice(0, 50)) {
    drafts.push({
      id: randomUUID(),
      kind: 'a11y',
      origin: 'suite',
      severity: v.impact === 'critical' || v.impact === 'serious' ? 'major' : 'moderate',
      title: `Accessibility: ${v.id}`,
      detail: v.description ?? v.id,
      evidence_refs: [{ relativePath: 'a11y-report.json', numeric_metrics: { impact: String(v.impact ?? '') } }],
      determinism: 'rule',
      oracle_id: `a11y.${v.id}`,
      promotion_state: 'advisory',
      blocks_merge: v.impact === 'critical',
    });
  }
  return drafts.map((d) => FindingSchema.parse(d));
}

export function buildDesignSystemFindingsFromArtifact(runDir: string): Finding[] {
  const data = readJsonIfExists<TokenDiffJson>(join(runDir, 'design-token-diff.json'));
  if (!data?.violations?.length) return [];
  const drafts: FindingDraft[] = data.violations.slice(0, 40).map((violation) => {
    const evidence_strength = inferTokenEvidenceStrength(violation);
    const blocks_merge =
      evidence_strength === 'proven' && process.env.NEOXTEN_DESIGN_PROVEN_BLOCKS_MERGE === '1';
    return {
      id: randomUUID(),
      kind: 'design_system' as const,
      origin: 'suite' as const,
      severity: evidence_strength === 'suggestive' ? ('minor' as const) : ('moderate' as const),
      title: violation.path ? `Design token: ${violation.path}` : 'Design token drift',
      detail: violation.message,
      evidence_refs: [
        {
          relativePath: 'design-token-diff.json',
          numeric_metrics: {
            expected: violation.expected ?? '',
            actual: violation.actual ?? '',
            evidence_strength,
          },
        },
      ],
      evidence_strength,
      confidence: evidence_strength === 'suggestive' ? ('low' as const) : ('medium' as const),
      determinism: evidence_strength === 'proven' ? ('diff' as const) : ('heuristic' as const),
      oracle_id: 'neo.design.tokens',
      promotion_state: 'advisory' as const,
      blocks_merge,
      fingerprint: fingerprintDesignViolation(violation),
    };
  });
  return drafts.map((d) => FindingSchema.parse(d));
}

export function buildVisualBaselineFindings(
  runDir: string,
  finalScreenshotRel: string,
  baselineAbsPath: string,
  currentSha: string,
  baselineSha: string,
): Finding[] {
  if (currentSha === baselineSha) return [];
  const draft: FindingDraft = {
    id: randomUUID(),
    kind: 'visual',
    origin: 'suite',
    severity: 'major',
    title: 'Visual regression vs approved baseline',
    detail: `Screenshot hash differs from baseline (current ${currentSha.slice(0, 12)}… vs baseline ${baselineSha.slice(0, 12)}…).`,
    evidence_refs: [
      { relativePath: finalScreenshotRel },
      { numeric_metrics: { current_sha256: currentSha, baseline_sha256: baselineSha } },
    ],
    determinism: 'diff',
    oracle_id: 'neo.visual.baseline',
    promotion_state: 'run_only',
    blocks_merge: true,
  };
  return [FindingSchema.parse(draft)];
}

/**
 * Collects human-style manifest fields: findings, retest hints, validation closure.
 */
export function assembleHumanStyleManifestExtras(
  verdict: Verdict,
  summary: EvidenceSummary,
  runDir: string,
  exploratoryMeta?: ExploratoryMeta,
  additionalFindings: Finding[] = [],
): {
  findings: Finding[];
  retestHints: RetestHint[];
  validationClosure: ValidationClosureSummary;
  exploratoryMeta?: ExploratoryMeta;
} {
  const findings: Finding[] = [
    ...buildFindingsFromEvidenceAndVerdict(verdict, summary),
    ...buildLayoutFindingsFromSnapshots(summary.observationSnapshots),
    ...buildA11yFindingsFromArtifact(runDir),
    ...buildDesignSystemFindingsFromArtifact(runDir),
    ...additionalFindings,
  ];

  const retestHints = buildRetestHintsFromFindings(findings);
  const verdictPassed = verdict.verdict === 'PASS' && verdict.exitCode === 0;
  const validationClosure = computeValidationClosureSummary({
    verdictPassed,
    findings,
    pendingRequiredRetests: retestHints.filter((h) => h.required).length,
    openPromotedMajorBlockerIssues: 0,
    operatorReviewRequired: false,
    operatorSignoffPresent: false,
  });

  return {
    findings,
    retestHints,
    validationClosure,
    exploratoryMeta,
  };
}
