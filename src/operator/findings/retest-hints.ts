import type { Finding, RetestHint } from './schema.js';

/** Emits retest checklist rows from blocking / high-signal findings (plan §5). */
export function buildRetestHintsFromFindings(findings: Finding[]): RetestHint[] {
  const hints: RetestHint[] = [];
  for (const f of findings) {
    if (f.blocks_merge) {
      hints.push({
        check_id: `reverify.${f.oracle_id ?? f.kind}.${f.id.slice(0, 8)}`,
        rationale: `Re-run scenario covering: ${f.title}`,
        required: true,
        related_finding_ids: [f.id],
      });
    }
  }
  for (const f of findings) {
    if (f.kind === 'a11y' && f.severity === 'major' && !f.blocks_merge) {
      hints.push({
        check_id: `a11y.${f.oracle_id ?? f.id.slice(0, 8)}`,
        rationale: `Re-check accessibility rule after fix: ${f.title}`,
        required: false,
        related_finding_ids: [f.id],
      });
    }
  }
  return hints;
}
