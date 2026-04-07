import type { Finding, RetestHint } from '../findings/schema.js';

/**
 * Builds a retest checklist from changed paths and known findings (plan §9 step 7).
 */
export function planRetestFromChangedFilesAndFindings(
  changedFiles: string[],
  linkedFindings: Finding[],
): RetestHint[] {
  const hints: RetestHint[] = [];
  const uiTouched = changedFiles.some((f) =>
    /\.(tsx|ts|jsx|js|css|scss|vue|svelte)$/i.test(f),
  );
  if (uiTouched) {
    hints.push({
      check_id: 'regression.ui_smoke',
      rationale: 'UI-related source files changed — re-run primary flows and screenshots.',
      required: true,
    });
  }
  const apiTouched = changedFiles.some((f) => /\.(ts|js|go|rs|py)$/i.test(f) && /api|route|server/i.test(f));
  if (apiTouched) {
    hints.push({
      check_id: 'regression.api_contract',
      rationale: 'API or server paths may have changed — re-run network/console gates.',
      required: false,
    });
  }
  for (const f of linkedFindings) {
    if (f.blocks_merge) {
      hints.push({
        check_id: `finding.${f.id}`,
        rationale: `Verify fix for blocked finding: ${f.title}`,
        required: true,
        related_finding_ids: [f.id],
      });
    }
  }
  return hints;
}
