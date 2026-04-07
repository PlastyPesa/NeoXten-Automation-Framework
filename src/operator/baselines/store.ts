import { eq, and } from 'drizzle-orm';
import type { OperatorDb } from '../db/client.js';
import { visualBaselines } from '../db/schema.js';
import { getDefaultWorkspaceId } from '../db/client.js';
import { randomUUID } from 'crypto';

export function recordVisualBaseline(
  db: OperatorDb,
  opts: {
    baselineKey: string;
    contentSha256: string;
    projectId?: string | null;
    approvedRunDbId?: string | null;
  },
): string {
  const workspaceId = getDefaultWorkspaceId(db);
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(visualBaselines)
    .where(
      and(
        eq(visualBaselines.workspaceId, workspaceId),
        eq(visualBaselines.baselineKey, opts.baselineKey),
      ),
    )
    .limit(1)
    .all();
  if (existing.length > 0) {
    const id = existing[0]!.id;
    db.update(visualBaselines)
      .set({
        contentSha256: opts.contentSha256,
        approvedRunDbId: opts.approvedRunDbId ?? null,
        projectId: opts.projectId ?? null,
        updatedAt: now,
      })
      .where(eq(visualBaselines.id, id))
      .run();
    return id;
  }
  const id = randomUUID();
  db.insert(visualBaselines)
    .values({
      id,
      workspaceId,
      projectId: opts.projectId ?? null,
      baselineKey: opts.baselineKey,
      contentSha256: opts.contentSha256,
      approvedRunDbId: opts.approvedRunDbId ?? null,
      updatedAt: now,
    })
    .run();
  return id;
}

export function getVisualBaselineSha256(
  db: OperatorDb,
  baselineKey: string,
): string | undefined {
  const workspaceId = getDefaultWorkspaceId(db);
  const rows = db
    .select()
    .from(visualBaselines)
    .where(
      and(
        eq(visualBaselines.workspaceId, workspaceId),
        eq(visualBaselines.baselineKey, baselineKey),
      ),
    )
    .limit(1)
    .all();
  return rows[0]?.contentSha256;
}
