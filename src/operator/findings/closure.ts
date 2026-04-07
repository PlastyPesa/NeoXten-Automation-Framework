import type { Finding } from './schema.js';
import type { ValidationClosureSummary } from './schema.js';

export interface ClosureInput {
  verdictPassed: boolean;
  findings: Finding[];
  pendingRequiredRetests: number;
  openPromotedMajorBlockerIssues: number;
  operatorReviewRequired: boolean;
  operatorSignoffPresent: boolean;
  acceptedDebt?: { findingIds: string[] };
}

/**
 * Aggregated gate for agents and Mission Control (plan §5).
 * Computed post-run from findings + policy inputs; stored on `runs.validation_closure_json`.
 */
export function computeValidationClosureSummary(input: ClosureInput): ValidationClosureSummary {
  const blocking = input.findings.filter((f) => f.blocks_merge);
  const suspicionThreshold = Number(process.env.NEOXTEN_SUSPICION_SCORE_THRESHOLD ?? '0.85');
  const highSuspicion = input.findings.some(
    (f) =>
      f.kind === 'suspicion' &&
      (f.confidence === 'high' ||
        (typeof f.suspicion_score === 'number' && f.suspicion_score >= suspicionThreshold)),
  );

  const advisory = input.findings.filter(
    (f) => f.promotion_state === 'advisory' || f.promotion_state === 'run_only',
  );

  return {
    verdict_ok: input.verdictPassed,
    blocking_findings_count: blocking.length,
    pending_required_retests: input.pendingRequiredRetests,
    open_promoted_issues_blockers: input.openPromotedMajorBlockerIssues,
    high_confidence_suspicion_present: highSuspicion,
    operator_review_satisfied: !input.operatorReviewRequired || input.operatorSignoffPresent,
    advisory_findings_count: advisory.length,
    accepted_debt: Boolean(input.acceptedDebt?.findingIds?.length),
    accepted_debt_finding_ids: input.acceptedDebt?.findingIds,
  };
}
