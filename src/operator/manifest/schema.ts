import { z } from 'zod';
import {
  ExploratoryMetaSchema,
  FindingSchema,
  RetestHintSchema,
  ValidationClosureSummarySchema,
} from '../findings/schema.js';

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
    'dom_snapshot',
    'a11y_report',
    'visual_diff',
    'layout_metrics',
    'navigation_graph',
    'exploration_map',
    'ux_report',
    'design_token_diff',
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
  schemaVersion: z.enum(['2026.1', '2026.2']),
  runId: z.string(),
  /** ISO-8601 timestamps from runners (Zod datetime is strict; keep string for ingest tolerance). */
  ingestedAt: z.string(),
  completedAt: z.string(),
  configPath: z.string(),
  projectId: z.string().optional(),
  suiteId: z.string().optional(),
  environment: EnvironmentSnapshotSchema.optional(),
  verdict: z.unknown(),
  evidenceTimeline: z.unknown().optional(),
  artifacts: z.array(ArtifactEntrySchema),
  reproducibleCommand: z.string().optional(),
  findings: z.array(FindingSchema).optional(),
  retestHints: z.array(RetestHintSchema).optional(),
  exploratoryMeta: ExploratoryMetaSchema.optional(),
  validationClosure: ValidationClosureSummarySchema.optional(),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;
export type ArtifactEntry = z.infer<typeof ArtifactEntrySchema>;
