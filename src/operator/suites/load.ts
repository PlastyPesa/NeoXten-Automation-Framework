import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { GateStep, GateSuiteDefinition } from './types.js';

const GateStepSchema = z.object({
  name: z.string(),
  type: z.enum(['yaml', 'flutter', 'flutter_integration', 'cargo', 'policy']),
  config: z.string().optional(),
  outSubDir: z.string().optional(),
  testPath: z.string().optional(),
  testTarget: z.string().optional(),
  driverPath: z.string().optional(),
  cwd: z.string().optional(),
  policyRoot: z.string().optional(),
  deviceId: z.string().optional(),
});

const GateSuiteFileSchema = z.object({
  schema_version: z.string(),
  suite_id: z.string(),
  display_name: z.string(),
  steps: z.array(GateStepSchema),
});

/** Load `suites/<suiteId>.yaml` from framework root (repo root). */
export function loadGateSuite(frameworkRoot: string, suiteId: string): GateSuiteDefinition {
  const path = join(frameworkRoot, 'suites', `${suiteId}.yaml`);
  if (!existsSync(path)) {
    throw new Error(`Suite file not found: ${path}`);
  }
  const raw = yaml.load(readFileSync(path, 'utf-8')) as unknown;
  const parsed = GateSuiteFileSchema.parse(raw);
  return {
    schemaVersion: parsed.schema_version,
    suiteId: parsed.suite_id,
    displayName: parsed.display_name,
    steps: parsed.steps as GateStep[],
  };
}

export const KNOWN_SUITE_IDS = ['nemyo', 'neoxtemus', 'operator'] as const;
export type KnownSuiteId = (typeof KNOWN_SUITE_IDS)[number];

export function isKnownSuiteId(s: string): s is KnownSuiteId {
  return (KNOWN_SUITE_IDS as readonly string[]).includes(s);
}
