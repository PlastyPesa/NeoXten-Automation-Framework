import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';

const ExploratoryCharterFileSchema = z.object({
  charter_id: z.string(),
  goal: z.string().optional(),
  in_scope: z.array(z.string()).optional(),
  out_of_scope: z.array(z.string()).optional(),
  time_budget_minutes: z.number().optional(),
  must_touch: z.array(z.string()).default([]),
  stop_conditions: z.array(z.string()).optional(),
});

export type ExploratoryCharterFile = z.infer<typeof ExploratoryCharterFileSchema>;

export function loadExploratoryCharter(
  configPath: string,
  charterRelativePath: string | undefined,
): ExploratoryCharterFile | null {
  if (!charterRelativePath?.trim()) return null;
  const abs = join(dirname(configPath), charterRelativePath);
  if (!existsSync(abs)) return null;
  try {
    const raw = readFileSync(abs, 'utf-8');
    const parsed = yaml.load(raw) as unknown;
    return ExploratoryCharterFileSchema.parse(parsed);
  } catch {
    return null;
  }
}

export function buildExploratoryMetaFromCharter(
  charter: ExploratoryCharterFile,
  visitedPathnames: string[],
  explorationMapRelPath?: string,
): import('../findings/schema.js').ExploratoryMeta {
  const must = charter.must_touch ?? [];
  const pending = must.filter((m) => !visitedPathnames.some((v) => v === m || v.includes(m) || m.includes(v)));
  const covered = must.length === 0 ? 100 : Math.round(((must.length - pending.length) / must.length) * 100);
  return {
    charter_id: charter.charter_id,
    goal: charter.goal,
    time_budget_minutes: charter.time_budget_minutes,
    coverage_pct: covered,
    must_touch_pending: pending,
    exploration_map_path: explorationMapRelPath,
  };
}
