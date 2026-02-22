/**
 * Factory Spec Schema — Zod schema for product specifications.
 *
 * The Spec is the single source of truth for a Factory Run.
 * It declares WHAT to build and WHAT quality to achieve, never HOW.
 *
 * Namespaces: product, features, journeys, design, quality,
 *             delivery, dependencies, extensions.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const SUPPORTED_SCHEMA_VERSIONS = ['2026.1'] as const;

export const PLATFORMS = ['web', 'desktop', 'android', 'chrome_extension', 'unity'] as const;
export const PlatformSchema = z.enum(PLATFORMS);

/* ------------------------------------------------------------------ */
/*  Product                                                            */
/* ------------------------------------------------------------------ */

export const ProductSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  platforms: z.array(PlatformSchema).min(1),
  contactEmail: z.string().email().optional(),
  website: z.string().url().optional(),
  legalEntity: z.string().optional(),
  jurisdiction: z.string().optional(),
  detailedDescription: z.string().optional(),
  dataCollectionSummary: z.string().optional(),
  dataStorageSummary: z.string().optional(),
  thirdPartySummary: z.string().optional(),
  childrenPrivacySummary: z.string().optional(),
  faqSummary: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/*  Features                                                           */
/* ------------------------------------------------------------------ */

export const FeatureSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
});

/* ------------------------------------------------------------------ */
/*  Journeys                                                           */
/* ------------------------------------------------------------------ */

export const JourneyStepSchema = z.object({
  action: z.enum(['navigate', 'click', 'type', 'wait', 'scroll', 'assert', 'screenshot']),
  selector: z.string().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  timeout: z.number().optional(),
  assertType: z.enum(['visible', 'contains', 'not_visible', 'url_matches', 'element_count']).optional(),
  assertValue: z.union([z.string(), z.number()]).optional(),
});

export const JourneySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  exercisesFeatures: z.array(z.string().min(1)).min(1),
  steps: z.array(JourneyStepSchema).min(1),
});

/* ------------------------------------------------------------------ */
/*  Design                                                             */
/* ------------------------------------------------------------------ */

export const DesignTokensSchema = z.object({
  colors: z.record(z.string()).optional(),
  typography: z.record(z.string()).optional(),
  spacing: z.record(z.union([z.string(), z.number()])).optional(),
});

export const StoreAssetsDesignSchema = z.object({
  iconSource: z.string().optional(),
  promoSource: z.string().optional(),
  featureGraphicSource: z.string().optional(),
});

export const DesignSchema = z.object({
  tokens: DesignTokensSchema.optional(),
  layoutRules: z.array(z.string()).optional(),
  breakpoints: z.record(z.number()).optional(),
  componentInventory: z.array(z.string()).optional(),
  storeAssets: StoreAssetsDesignSchema.optional(),
});

/* ------------------------------------------------------------------ */
/*  Quality — all values MUST be numeric                               */
/* ------------------------------------------------------------------ */

export const QualitySchema = z.object({
  startupMaxMs: z.number().optional(),
  bundleSizeMaxKb: z.number().optional(),
  lighthouseMinScore: z.number().optional(),
  memoryMaxMb: z.number().optional(),
  fpsMin: z.number().optional(),
  ttfbMaxMs: z.number().optional(),
  lcpMaxMs: z.number().optional(),
}).catchall(z.number());

/* ------------------------------------------------------------------ */
/*  Delivery                                                           */
/* ------------------------------------------------------------------ */

export const AndroidDeliverySchema = z.object({
  packageName: z.string(),
  versionCode: z.number().int(),
  versionName: z.string(),
  category: z.string().optional(),
  contentRating: z.string().optional(),
  language: z.string().default('en-US'),
  privacyPolicyUrl: z.string().url().optional(),
  supportUrl: z.string().url().optional(),
  buildCommand: z.string().default('./gradlew bundleRelease'),
});

export const ChromeDeliverySchema = z.object({
  version: z.string().optional(),
  category: z.string().optional(),
  language: z.string().default('en'),
  privacyPolicyUrl: z.string().url().optional(),
  supportUrl: z.string().url().optional(),
});

export const WebDeliverySchema = z.object({
  buildCommand: z.string().default('npm run build'),
  outputDir: z.string().default('dist'),
});

export const DocsDeliverySchema = z.object({
  privacyPolicy: z.boolean().default(true),
  termsOfService: z.boolean().default(true),
  support: z.boolean().default(true),
});

export const DeliverySchema = z.object({
  targets: z.array(PlatformSchema).min(1),
  android: AndroidDeliverySchema.optional(),
  chrome: ChromeDeliverySchema.optional(),
  web: WebDeliverySchema.optional(),
  docs: DocsDeliverySchema.optional(),
  changelog: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/*  Dependencies                                                       */
/* ------------------------------------------------------------------ */

export const DependenciesSchema = z.object({
  services: z.array(z.string()).optional(),
  apis: z.array(z.string()).optional(),
  envVars: z.array(z.string()).optional(),
  systemPrerequisites: z.array(z.string()).optional(),
});

/* ------------------------------------------------------------------ */
/*  Root Spec                                                          */
/* ------------------------------------------------------------------ */

export const FactorySpecSchema = z.object({
  schema_version: z.string(),
  product: ProductSchema,
  features: z.array(FeatureSchema).min(1),
  journeys: z.array(JourneySchema).min(1),
  design: DesignSchema.optional(),
  quality: QualitySchema,
  delivery: DeliverySchema,
  dependencies: DependenciesSchema.optional(),
  extensions: z.record(z.unknown()).optional(),
});

/* ------------------------------------------------------------------ */
/*  Type exports                                                       */
/* ------------------------------------------------------------------ */

export type FactorySpec = z.infer<typeof FactorySpecSchema>;
export type Platform = z.infer<typeof PlatformSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Journey = z.infer<typeof JourneySchema>;
export type JourneyStep = z.infer<typeof JourneyStepSchema>;
export type Quality = z.infer<typeof QualitySchema>;
export type Delivery = z.infer<typeof DeliverySchema>;
export type Dependencies = z.infer<typeof DependenciesSchema>;
