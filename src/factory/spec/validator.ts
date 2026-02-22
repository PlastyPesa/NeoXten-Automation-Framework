/**
 * Spec Validator — structural (Zod) + semantic validation.
 *
 * Semantic invariants enforced beyond Zod:
 *  - schema_version must be supported
 *  - Feature IDs must be unique
 *  - Every feature must be exercised by at least one journey
 *  - Every journey must contain at least one assertion step
 *
 * Returns a deep-frozen spec on success (no runtime mutation possible).
 */

import { FactorySpecSchema, SUPPORTED_SCHEMA_VERSIONS } from './schema.js';
import type { FactorySpec } from './schema.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SpecError {
  path: string;
  message: string;
}

export type ValidateResult =
  | { valid: true; spec: Readonly<FactorySpec> }
  | { valid: false; errors: SpecError[] };

/* ------------------------------------------------------------------ */
/*  Deep freeze                                                        */
/* ------------------------------------------------------------------ */

export function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const val of Object.values(obj)) {
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val as object);
    }
  }
  return obj;
}

/* ------------------------------------------------------------------ */
/*  validateSpec                                                       */
/* ------------------------------------------------------------------ */

export function validateSpec(input: unknown): ValidateResult {
  const errors: SpecError[] = [];

  /* ---- Zod structural validation ---- */
  const parsed = FactorySpecSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        path: issue.path.join('.'),
        message: issue.message,
      });
    }
    return { valid: false, errors };
  }

  const spec = parsed.data;

  /* ---- Schema version ---- */
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(spec.schema_version)) {
    errors.push({
      path: 'schema_version',
      message: `unsupported schema version '${spec.schema_version}'`,
    });
  }

  /* ---- Feature ID uniqueness ---- */
  const featureIds = new Set<string>();
  for (const feature of spec.features) {
    if (featureIds.has(feature.id)) {
      errors.push({
        path: `features`,
        message: `duplicate feature id '${feature.id}'`,
      });
    }
    featureIds.add(feature.id);
  }

  /* ---- Journey ID uniqueness ---- */
  const journeyIds = new Set<string>();
  for (const journey of spec.journeys) {
    if (journeyIds.has(journey.id)) {
      errors.push({
        path: 'journeys',
        message: `duplicate journey id '${journey.id}'`,
      });
    }
    journeyIds.add(journey.id);
  }

  /* ---- Feature-journey coverage ---- */
  const coveredFeatures = new Set<string>();
  for (const journey of spec.journeys) {
    for (const featureId of journey.exercisesFeatures) {
      coveredFeatures.add(featureId);
      if (!featureIds.has(featureId)) {
        errors.push({
          path: `journeys.${journey.id}.exercisesFeatures`,
          message: `journey '${journey.id}' references unknown feature '${featureId}'`,
        });
      }
    }
  }
  for (const featureId of featureIds) {
    if (!coveredFeatures.has(featureId)) {
      errors.push({
        path: `features.${featureId}`,
        message: `feature '${featureId}' has no journey coverage`,
      });
    }
  }

  /* ---- Every journey must have at least one assertion ---- */
  for (const journey of spec.journeys) {
    const hasAssertion = journey.steps.some(s => s.action === 'assert');
    if (!hasAssertion) {
      errors.push({
        path: `journeys.${journey.id}`,
        message: `journey '${journey.id}' has no assertions`,
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, spec: deepFreeze(spec) as Readonly<FactorySpec> };
}
