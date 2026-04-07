import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import type { OperatorDb } from '../db/client.js';
import { issues, issueRuns } from '../db/schema.js';
import type { RunManifest } from '../manifest/schema.js';
import { FindingSchema } from '../findings/schema.js';
import type { Verdict } from '../../core/verdict.js';

function verdictStatus(v: Verdict): 'passed' | 'failed' | 'infra_failed' {
  if (v.exitCode === 0) return 'passed';
  if (v.exitCode === 2) return 'infra_failed';
  return 'failed';
}

/**
 * Optional: auto-open triage issues for proven design-system findings on green runs.
 * Enable with NEOXTEN_AUTO_PROMOTE_PROVEN_DESIGN=1
 */
export function maybeAutoPromoteProvenDesignFindings(
  db: OperatorDb,
  opts: {
    workspaceId: string;
    projectId: string | null;
    manifest: RunManifest;
    runDbId: string;
    now: string;
  },
): void {
  if (process.env.NEOXTEN_AUTO_PROMOTE_PROVEN_DESIGN !== '1') return;
  const verdict = opts.manifest.verdict as Verdict;
  if (verdictStatus(verdict) !== 'passed') return;

  for (const raw of opts.manifest.findings ?? []) {
    const p = FindingSchema.safeParse(raw);
    if (!p.success) continue;
    const f = p.data;
    if (f.kind !== 'design_system' || f.evidence_strength !== 'proven') continue;

    const fp =
      f.fingerprint ??
      `design-prov-${f.title.slice(0, 40)}-${(f.oracle_id ?? 'neo.design').replace(/[^a-z0-9._-]/gi, '')}`;

    const existing = db
      .select()
      .from(issues)
      .where(and(eq(issues.workspaceId, opts.workspaceId), eq(issues.fingerprint, fp)))
      .limit(1)
      .all();

    let issueId: string;
    if (existing.length > 0) {
      issueId = existing[0]!.id;
      db.update(issues)
        .set({ updatedAt: opts.now })
        .where(eq(issues.id, issueId))
        .run();
    } else {
      issueId = randomUUID();
      db.insert(issues)
        .values({
          id: issueId,
          workspaceId: opts.workspaceId,
          projectId: opts.projectId,
          fingerprint: fp,
          status: 'triage',
          severity: f.severity === 'blocker' ? 'high' : 'medium',
          title: `[Design] ${f.title}`,
          classification: 'design_system_auto',
          codeBridgeJson: null,
          createdAt: opts.now,
          updatedAt: opts.now,
        })
        .run();
    }

    const linked = db
      .select()
      .from(issueRuns)
      .where(and(eq(issueRuns.issueId, issueId), eq(issueRuns.runDbId, opts.runDbId)))
      .limit(1)
      .all();
    if (linked.length === 0) {
      db.insert(issueRuns).values({ issueId, runDbId: opts.runDbId }).run();
    }
  }
}
