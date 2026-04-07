import { z } from 'zod';

/** Evidence pointer attached to a finding (screenshot path, bbox, metrics). */
export const EvidenceRefSchema = z.object({
  relativePath: z.string().optional(),
  bbox: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .optional(),
  selector: z.string().optional(),
  numeric_metrics: z.record(z.union([z.number(), z.string(), z.boolean()])).optional(),
});

export const FindingKindSchema = z.enum([
  'functional',
  'visual',
  'ux',
  'consistency',
  'suspicion',
  'a11y',
  'performance',
  'design_system',
]);

export const FindingOriginSchema = z.enum(['suite', 'exploratory', 'manual']);

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const EvidenceStrengthSchema = z.enum(['proven', 'likely', 'suggestive']);
export const DeterminismSchema = z.enum(['rule', 'diff', 'heuristic', 'model']);
export const PromotionStateSchema = z.enum(['run_only', 'advisory', 'promoted', 'dismissed']);

const FindingSchemaRaw = z.object({
  id: z.string(),
  kind: FindingKindSchema,
  origin: FindingOriginSchema.optional(),
  charter_id: z.string().optional(),
  severity: z.enum(['blocker', 'major', 'moderate', 'minor', 'polish']).optional(),
  user_impact: z.string().optional(),
  title: z.string(),
  detail: z.string().optional(),
  evidence_refs: z.array(EvidenceRefSchema).optional(),
  confidence: ConfidenceSchema.optional(),
  evidence_strength: EvidenceStrengthSchema.optional(),
  determinism: DeterminismSchema,
  oracle_id: z.string().optional(),
  related_testids: z.array(z.string()).optional(),
  urls: z.array(z.string()).optional(),
  fingerprint: z.string().optional(),
  promotion_state: PromotionStateSchema.optional(),
  blocks_merge: z.boolean().optional(),
  hypothesis: z.string().optional(),
  sub_signals: z.array(z.string()).optional(),
  suspicion_score: z.number().optional(),
});

/** Normalizes optional list defaults for manifest + DB round-trip. */
export const FindingSchema = FindingSchemaRaw.transform((f) => ({
  ...f,
  origin: f.origin ?? 'suite',
  evidence_refs: f.evidence_refs ?? [],
  related_testids: f.related_testids ?? [],
  urls: f.urls ?? [],
  promotion_state: f.promotion_state ?? 'run_only',
  blocks_merge: f.blocks_merge ?? false,
}));

export const RetestHintSchema = z.object({
  check_id: z.string(),
  rationale: z.string(),
  required: z.boolean().default(true),
  related_finding_ids: z.array(z.string()).optional(),
});

export const ExploratoryMetaSchema = z.object({
  charter_id: z.string(),
  goal: z.string().optional(),
  time_budget_minutes: z.number().optional(),
  coverage_pct: z.number().min(0).max(100).optional(),
  must_touch_pending: z.array(z.string()).optional(),
  exploration_map_path: z.string().optional(),
});

export const ValidationClosureSummarySchema = z.object({
  verdict_ok: z.boolean(),
  blocking_findings_count: z.number(),
  pending_required_retests: z.number(),
  open_promoted_issues_blockers: z.number(),
  high_confidence_suspicion_present: z.boolean(),
  operator_review_satisfied: z.boolean(),
  advisory_findings_count: z.number(),
  accepted_debt: z.boolean(),
  accepted_debt_finding_ids: z.array(z.string()).optional(),
});

export type FindingDraft = z.infer<typeof FindingSchemaRaw>;
export type Finding = z.output<typeof FindingSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type RetestHint = z.infer<typeof RetestHintSchema>;
export type ExploratoryMeta = z.infer<typeof ExploratoryMetaSchema>;
export type ValidationClosureSummary = z.infer<typeof ValidationClosureSummarySchema>;
