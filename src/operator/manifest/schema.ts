import { z } from 'zod';

/** Canonical run manifest — wraps verdict + artifact inventory + env snapshot for Control Plane ingest. */
export const ArtifactEntrySchema = z.object({
  relativePath: z.string(),
  kind: z.enum([
    'verdict',
    'evidence_timeline',
    'console_log',
    'screenshot',
    'trace',
    'har',
    'video',
    'other',
  ]),
  bytes: z.number().optional(),
  sha256: z.string().optional(),
});

export const EnvironmentSnapshotSchema = z.object({
  profileId: z.string().optional(),
  nodeVersion: z.string().optional(),
  platform: z.string().optional(),
  envVarsNonSecret: z.record(z.string()).optional(),
});

export const RunManifestSchema = z.object({
  schemaVersion: z.literal('2026.1'),
  runId: z.string(),
  ingestedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  configPath: z.string(),
  projectId: z.string().optional(),
  suiteId: z.string().optional(),
  environment: EnvironmentSnapshotSchema.optional(),
  verdict: z.unknown(),
  evidenceTimeline: z.unknown().optional(),
  artifacts: z.array(ArtifactEntrySchema),
  reproducibleCommand: z.string().optional(),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;
export type ArtifactEntry = z.infer<typeof ArtifactEntrySchema>;
