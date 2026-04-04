import { createHash } from 'crypto';
import type { Verdict } from '../../core/verdict.js';

/** Stable fingerprint for issue clustering (§9). */
export function computeFailureFingerprint(
  verdict: Verdict,
  opts?: { projectSlug?: string; environmentProfileId?: string },
): string | null {
  if (verdict.verdict === 'PASS') return null;
  const topLog = (verdict.logExcerpts ?? []).join('\n').slice(0, 2000);
  const payload = [
    verdict.failingStage ?? '',
    verdict.failingFlow ?? '',
    String(verdict.failingStep ?? 0),
    topLog,
    opts?.projectSlug ?? '',
    opts?.environmentProfileId ?? '',
  ].join('\x1e');
  return createHash('sha256').update(payload).digest('hex');
}
