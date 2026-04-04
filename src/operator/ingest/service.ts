import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import type { OperatorDb } from '../db/client.js';
import {
  runs,
  runArtifacts,
  issues,
  issueRuns,
} from '../db/schema.js';
import { RunManifestSchema, type RunManifest } from '../manifest/schema.js';
import { getDefaultWorkspaceId } from '../db/client.js';
import type { Verdict } from '../../core/verdict.js';
import { computeFailureFingerprint } from './fingerprint.js';
import { getBlobRoot } from '../paths.js';

function verdictStatus(v: Verdict): 'passed' | 'failed' | 'infra_failed' {
  if (v.exitCode === 0) return 'passed';
  if (v.exitCode === 2) return 'infra_failed';
  return 'failed';
}

export interface IngestOptions {
  /** Copy artifact files into content-addressed blob store */
  archiveBlobs?: boolean;
  operatorHome: string;
  projectId?: string | null;
  environmentProfileId?: string | null;
  suiteId?: string | null;
  projectSlug?: string;
}

export function parseManifestFromPath(runDir: string): RunManifest {
  const p = join(runDir, 'run-manifest.json');
  if (!existsSync(p)) {
    throw new Error(`Missing run-manifest.json in ${runDir}. Run neoxten first or build manifest.`);
  }
  const raw = JSON.parse(readFileSync(p, 'utf-8')) as unknown;
  return RunManifestSchema.parse(raw);
}

export function ingestRunManifest(
  db: OperatorDb,
  manifest: RunManifest,
  sourceRunDir: string,
  opts: IngestOptions,
): { runDbId: string; issueId?: string } {
  const workspaceId = getDefaultWorkspaceId(db);
  const verdict = manifest.verdict as Verdict;
  const status = verdictStatus(verdict);
  const fp = computeFailureFingerprint(verdict, {
    projectSlug: opts.projectSlug,
    environmentProfileId: opts.environmentProfileId ?? undefined,
  });

  const runDbId = randomUUID();
  const now = new Date().toISOString();
  const blobRoot = getBlobRoot(opts.operatorHome);
  if (opts.archiveBlobs) {
    mkdirSync(blobRoot, { recursive: true });
  }

  db.insert(runs)
    .values({
      id: runDbId,
      workspaceId,
      projectId: opts.projectId ?? null,
      environmentProfileId: opts.environmentProfileId ?? null,
      suiteId: opts.suiteId ?? manifest.suiteId ?? null,
      neoxtenRunId: manifest.runId,
      status,
      exitCode: verdict.exitCode,
      configPath: manifest.configPath,
      sourceRunDir,
      verdictJson: JSON.stringify(verdict),
      manifestJson: JSON.stringify(manifest),
      evidenceTimelineJson: manifest.evidenceTimeline
        ? JSON.stringify(manifest.evidenceTimeline)
        : null,
      completedAt: manifest.completedAt,
      createdAt: now,
      failureFingerprint: fp,
    })
    .run();

  for (const a of manifest.artifacts) {
    let blobKey: string | null = null;
    if (opts.archiveBlobs && a.sha256 && existsSync(join(sourceRunDir, a.relativePath))) {
      const prefix = a.sha256.slice(0, 2);
      const destDir = join(blobRoot, prefix);
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, a.sha256);
      if (!existsSync(dest)) {
        copyFileSync(join(sourceRunDir, a.relativePath), dest);
      }
      blobKey = a.sha256;
    }

    db.insert(runArtifacts)
      .values({
        id: randomUUID(),
        runDbId,
        relativePath: a.relativePath,
        kind: a.kind,
        sha256: a.sha256 ?? null,
        bytes: a.bytes ?? null,
        blobKey,
      })
      .run();
  }

  let issueId: string | undefined;
  if (status !== 'passed' && fp) {
    const existing = db
      .select()
      .from(issues)
      .where(and(eq(issues.workspaceId, workspaceId), eq(issues.fingerprint, fp)))
      .limit(1)
      .all();

    const title =
      verdict.failingFlow != null
        ? `Failure: ${verdict.failingFlow} (step ${verdict.failingStep})`
        : `Failure: ${verdict.failingStage ?? 'unknown'}`;

    if (existing.length > 0) {
      issueId = existing[0]!.id;
      db.update(issues)
        .set({ updatedAt: now })
        .where(eq(issues.id, issueId))
        .run();
    } else {
      issueId = randomUUID();
      db.insert(issues)
        .values({
          id: issueId,
          workspaceId,
          projectId: opts.projectId ?? null,
          fingerprint: fp,
          status: 'open',
          severity: verdict.exitCode === 2 ? 'high' : 'medium',
          title,
          classification: null,
          codeBridgeJson: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    db.insert(issueRuns)
      .values({ issueId: issueId!, runDbId })
      .run();
  }

  return { runDbId, issueId };
}
