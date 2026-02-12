import { z } from 'zod';

export const FlowStepSchema = z.object({
  action: z.enum(['click', 'type', 'navigate', 'wait', 'assert']),
  selector: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  type: z.enum(['visible', 'contains', 'timeout']).optional(),
  timeout: z.number().optional(),
});

export const FlowSchema = z.object({
  name: z.string(),
  steps: z.array(FlowStepSchema),
});

export const TauriProjectSchema = z.object({
  binary: z.string().optional(),
  strategy: z.enum(['webdriver', 'cdp', 'harness']).default('harness'),
  devCommand: z.string().default('npm run tauri:dev'),
  devCwd: z.string().optional(),
  devUrl: z.string().default('http://localhost:1420'),
  cdpPort: z.number().default(9222),
});

export const NextJsProjectSchema = z.object({
  script: z.string().default('npm run dev'),
  url: z.string().default('http://localhost:3000'),
  cwd: z.string().optional(),
});

export const ExtensionProjectSchema = z.object({
  path: z.string(),
  manifest: z.string().default('manifest.json'),
});

export const AssistantTestSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  expectContains: z.string().optional(),
  maxLatencyMs: z.number().optional(),
  expectTokens: z.tuple([z.number(), z.number()]).optional(),
});

export const AssistantConfigSchema = z.object({
  enabled: z.boolean().default(true),
  type: z.enum(['http', 'in_app']).default('in_app'),
  endpoint: z.string().optional(),
  tests: z.array(AssistantTestSchema).optional(),
  inferenceAccounting: z.object({
    expectedBackendInvocations: z.number().default(1),
    expectedLlamaSpawns: z.number().default(1),
    maxDuplicateCalls: z.number().default(0),
  }).optional(),
});

export const GatesSchema = z.object({
  startupMaxMs: z.number().default(30000),
  spinnerMaxMs: z.number().default(5000),
  noConsoleErrors: z.boolean().default(true),
  domMutationTimeoutMs: z.number().default(3000),
  networkIdleTimeoutMs: z.number().default(5000),
  visualRegressionThreshold: z.number().default(0.01),
  memoryGrowthMb: z.number().optional(),
  assistantLatencyP95MaxMs: z.number().default(10000),
  assistantReliabilityRuns: z.number().default(1),
  oneSendOneInference: z.boolean().default(true),
});

export const ArtifactsSchema = z.object({
  traceOnFailure: z.boolean().default(true),
  screenshotOnFailure: z.boolean().default(true),
  screenshotFinal: z.boolean().default(true),
  consoleLog: z.boolean().default(true),
  backendLog: z.boolean().default(true),
});

export const WebOnlyProjectSchema = z.object({
  url: z.string(),
});

export const ProjectConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('web'),
    root: z.string().default('.'),
    web: WebOnlyProjectSchema.optional(),
  }),
  z.object({
    type: z.literal('tauri'),
    root: z.string().default('.'),
    tauri: TauriProjectSchema.optional(),
  }),
  z.object({
    type: z.literal('nextjs'),
    root: z.string().default('.'),
    nextjs: NextJsProjectSchema.optional(),
  }),
  z.object({
    type: z.literal('extension'),
    root: z.string().default('.'),
    extension: ExtensionProjectSchema.optional(),
  }),
]);

export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;

export const NeoxtenConfigSchema = z.object({
  project: ProjectConfigSchema,
  flows: z.array(FlowSchema).default([]),
  assistant: AssistantConfigSchema.optional(),
  gates: GatesSchema.optional(),
  artifacts: ArtifactsSchema.optional(),
});

export type NeoxtenConfig = z.infer<typeof NeoxtenConfigSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type GatesConfig = z.infer<typeof GatesSchema>;
