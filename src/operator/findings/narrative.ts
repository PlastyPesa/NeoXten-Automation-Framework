import type { Finding } from './schema.js';

/**
 * Strict JSON-out narrative: only fields already on the finding (plan §6 interpretation seed).
 */
export function explainFindingStrictJson(finding: Finding): {
  template_slug: string;
  title: string;
  summary: string;
  evidence_cited: string[];
  confidence_note?: string;
} {
  const paths = (finding.evidence_refs ?? [])
    .map((r) => r.relativePath)
    .filter((p): p is string => Boolean(p));
  const summaryParts = [finding.detail, finding.user_impact].filter(Boolean);
  return {
    template_slug: 'finding.strict_json_v1',
    title: finding.title,
    summary: summaryParts.join(' — ') || finding.title,
    evidence_cited: paths,
    confidence_note: finding.confidence
      ? `confidence=${finding.confidence}`
      : finding.evidence_strength
        ? `evidence_strength=${finding.evidence_strength}`
        : undefined,
  };
}
