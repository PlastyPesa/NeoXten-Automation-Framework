import { z } from 'zod';

export const FlowStepSchema = z.object({
  action: z.enum([
    'click',
    'type',
    'navigate',
    'wait',
    'assert',
    'setInputFiles',
    'evaluate',
    'selectOption',
    'sendToBackground',
    'bringToForeground',
    'getTestState',
  ]),
  selector: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  type: z.enum(['visible', 'hidden', 'contains', 'not-contains', 'css', 'attribute', 'count', 'timeout']).optional(),
  timeout: z.number().optional(),
  /** File paths for setInputFiles (relative to cwd or absolute) */
  files: z.array(z.string()).optional(),
  /** JS expression for evaluate (run in page context) */
  expression: z.string().optional(),
  /** For action selectOption: match by option label text */
  optionLabel: z.string().optional(),
  /** For action selectOption: match by option value attribute */
  optionValue: z.string().optional(),
  /** For action selectOption: zero-based index among all option elements */
  optionIndex: z.number().int().nonnegative().optional(),
  /** CSS property name for type: 'css' assertions */
  property: z.string().optional(),
  /** Expected value for css/attribute assertions */
  value: z.string().optional(),
  /** HTML attribute name for type: 'attribute' assertions */
  attribute: z.string().optional(),
  /** Expected element count for type: 'count' assertions */
  count: z.number().optional(),
});

export const FlowSchema = z.object({
  name: z.string(),
  steps: z.array(FlowStepSchema),
});

export const TauriProjectSchema = z.object({
  binary: z.string().optional(),
  strategy: z.enum(['webdriver', 'cdp', 'harness']).default('harness'),
  /** Full Tauri dev command (used by CDP strategy). */
  devCommand: z.string().default('npm run tauri:dev'),
  /** Frontend-only dev command (used by harness strategy). Defaults to 'npm run dev'. */
  harnessCommand: z.string().default('npm run dev'),
  devCwd: z.string().optional(),
  devUrl: z.string().default('http://localhost:1420'),
  cdpPort: z.number().default(9222),
  /** Max ms to wait for CDP to be available (default 60000). */
  startupTimeoutMs: z.number().optional(),
});

export const NextJsProjectSchema = z.object({
  script: z.string().default('npm run dev'),
  url: z.string().default('http://localhost:3000'),
  cwd: z.string().optional(),
});

export const ExtensionProjectSchema = z.object({
  path: z.string(),
  manifest: z.string().default('manifest.json'),
  /** Pre-seed chrome.storage.local before flows (e.g. { nemyo_state_v1: { kidMode: true, ageBand: '6_8' } }) */
  storageSeed: z.record(z.string(), z.unknown()).optional(),
});

/** Android app testing (emulator + APK, optional CDP to WebView). */
export const AndroidProjectSchema = z.object({
  /** Path to APK (relative to config dir or absolute). */
  apkPath: z.string(),
  /** AVD name (e.g. Medium_Phone). If set, emulator is started before install. */
  avd: z.string().optional(),
  /** CDP port for WebView debugging. App must enable WebView.setWebContentsDebuggingEnabled(true). */
  cdpPort: z.number().default(9222),
  /** App package (e.g. com.neoxtemus.app). Required for launch. */
  package: z.string(),
  /** Main activity (e.g. .MainActivity). Required for launch. */
  activity: z.string(),
  /** Max ms to wait for emulator boot (if avd set). */
  emulatorBootTimeoutMs: z.number().default(120000),
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
  z.object({
    type: z.literal('android'),
    root: z.string().default('.'),
    android: AndroidProjectSchema,
  }),
]);

export type AssistantConfig = z.infer<typeof AssistantConfigSchema>;

export const VisualBaselineConfigSchema = z.object({
  /** Stable id for reporting (e.g. marketing-home). */
  id: z.string(),
  /** PNG path relative to the neoxten config file directory. */
  baselineImagePath: z.string(),
});

export const NeoxtenConfigSchema = z.object({
  project: ProjectConfigSchema,
  flows: z.array(FlowSchema).default([]),
  assistant: AssistantConfigSchema.optional(),
  gates: GatesSchema.optional(),
  artifacts: ArtifactsSchema.optional(),
  /** Command to run before launch (e.g. node scripts/clean-neoxtemus-state.js). Runs with cwd = config dir. */
  preRun: z.string().optional(),
  /** Optional exploratory charter YAML path (relative to config dir). */
  exploratoryCharter: z.string().optional(),
  /** Compare final screenshot hash to an approved golden PNG in the repo. */
  visualBaseline: VisualBaselineConfigSchema.optional(),
});

export type NeoxtenConfig = z.infer<typeof NeoxtenConfigSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type GatesConfig = z.infer<typeof GatesSchema>;
