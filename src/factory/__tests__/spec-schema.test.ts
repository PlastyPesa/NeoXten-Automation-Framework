/**
 * Spec Schema — Acceptance Proofs
 *
 * Proof 1: Valid spec (3 features, 3 journeys, full coverage) validates.
 * Proof 2: Feature with no journey coverage rejected.
 * Proof 3: Journey with no assertions rejected.
 * Proof 4: Non-numeric quality value rejected.
 * Proof 5: Unsupported schema_version rejected.
 * Proof 6: Extensions namespace passthrough accepted.
 * Proof 7: Validated spec is deep-frozen (mutation throws).
 */

import { validateSpec } from '../spec/validator.js';
import type { SpecError } from '../spec/validator.js';

function makeValidSpec(): Record<string, unknown> {
  return {
    schema_version: '2026.1',
    product: {
      name: 'TestApp',
      version: '1.0.0',
      description: 'A test application for proof validation',
      platforms: ['web'],
    },
    features: [
      { id: 'auth', description: 'User authentication', acceptanceCriteria: ['User can log in'] },
      { id: 'dashboard', description: 'Dashboard view', acceptanceCriteria: ['Dashboard loads'] },
      { id: 'settings', description: 'User settings', acceptanceCriteria: ['Settings are editable'] },
    ],
    journeys: [
      {
        id: 'login_flow',
        name: 'Login Flow',
        exercisesFeatures: ['auth'],
        steps: [
          { action: 'navigate', url: '/login' },
          { action: 'type', selector: '#email', text: 'test@test.com' },
          { action: 'type', selector: '#password', text: 'password123' },
          { action: 'click', selector: '#submit' },
          { action: 'assert', assertType: 'url_matches', assertValue: '/dashboard' },
        ],
      },
      {
        id: 'dashboard_load',
        name: 'Dashboard Load',
        exercisesFeatures: ['dashboard'],
        steps: [
          { action: 'navigate', url: '/dashboard' },
          { action: 'assert', assertType: 'visible', selector: '.dashboard-container' },
        ],
      },
      {
        id: 'settings_edit',
        name: 'Settings Edit',
        exercisesFeatures: ['settings'],
        steps: [
          { action: 'navigate', url: '/settings' },
          { action: 'type', selector: '#display-name', text: 'New Name' },
          { action: 'click', selector: '#save' },
          { action: 'assert', assertType: 'contains', selector: '.toast', assertValue: 'Saved' },
        ],
      },
    ],
    quality: {
      startupMaxMs: 3000,
      bundleSizeMaxKb: 500,
    },
    delivery: {
      targets: ['web'],
      web: { buildCommand: 'npm run build', outputDir: 'dist' },
    },
  };
}

function hasErrorMatching(errors: SpecError[], pathSubstr: string, msgSubstr: string): boolean {
  return errors.some(e => e.path.includes(pathSubstr) && e.message.includes(msgSubstr));
}

function runTests(): void {
  let passed = 0;
  let failed = 0;

  /* ---------------------------------------------------------------- */
  /* Proof 1: Valid spec validates successfully                        */
  /* ---------------------------------------------------------------- */
  {
    const result = validateSpec(makeValidSpec());
    if (!result.valid) {
      console.error('FAIL proof-1: valid spec rejected:', result.errors);
      failed++;
    } else {
      const spec = result.spec;
      if (spec.features.length !== 3 || spec.journeys.length !== 3) {
        console.error('FAIL proof-1: unexpected counts', spec.features.length, spec.journeys.length);
        failed++;
      } else {
        console.log('PASS proof-1: valid spec (3 features, 3 journeys, full coverage) validates');
        passed++;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 2: Feature with no journey coverage rejected                */
  /* ---------------------------------------------------------------- */
  {
    const spec = makeValidSpec();
    (spec.features as Array<Record<string, unknown>>).push({
      id: 'orphan_feature',
      description: 'Feature with no journey',
      acceptanceCriteria: ['Never tested'],
    });

    const result = validateSpec(spec);
    if (result.valid) {
      console.error('FAIL proof-2: spec with uncovered feature should be rejected');
      failed++;
    } else if (!hasErrorMatching(result.errors, 'orphan_feature', 'has no journey coverage')) {
      console.error('FAIL proof-2: expected journey coverage error for orphan_feature, got:', result.errors);
      failed++;
    } else {
      console.log(`PASS proof-2: feature 'orphan_feature' rejected — "${result.errors.find(e => e.message.includes('orphan_feature'))?.message}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 3: Journey with no assertions rejected                      */
  /* ---------------------------------------------------------------- */
  {
    const spec = makeValidSpec();
    const journeys = spec.journeys as Array<Record<string, unknown>>;
    journeys[0] = {
      id: 'no_assert_journey',
      name: 'No Assert Journey',
      exercisesFeatures: ['auth'],
      steps: [
        { action: 'navigate', url: '/login' },
        { action: 'click', selector: '#submit' },
      ],
    };

    const result = validateSpec(spec);
    if (result.valid) {
      console.error('FAIL proof-3: journey with no assertions should be rejected');
      failed++;
    } else if (!hasErrorMatching(result.errors, 'no_assert_journey', 'has no assertions')) {
      console.error('FAIL proof-3: expected assertion error, got:', result.errors);
      failed++;
    } else {
      console.log(`PASS proof-3: journey 'no_assert_journey' rejected — "${result.errors.find(e => e.message.includes('no assertions'))?.message}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 4: Non-numeric quality value rejected                       */
  /* ---------------------------------------------------------------- */
  {
    const spec = makeValidSpec();
    (spec.quality as Record<string, unknown>).startupMaxMs = 'fast';

    const result = validateSpec(spec);
    if (result.valid) {
      console.error('FAIL proof-4: non-numeric quality value should be rejected');
      failed++;
    } else {
      const qualityError = result.errors.find(e => e.path.includes('quality'));
      if (!qualityError) {
        console.error('FAIL proof-4: expected error at quality path, got:', result.errors);
        failed++;
      } else {
        console.log(`PASS proof-4: quality.startupMaxMs="fast" rejected — path="${qualityError.path}" message="${qualityError.message}"`);
        passed++;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 5: Unsupported schema_version rejected                      */
  /* ---------------------------------------------------------------- */
  {
    const spec = makeValidSpec();
    spec.schema_version = '9999.1';

    const result = validateSpec(spec);
    if (result.valid) {
      console.error('FAIL proof-5: unsupported schema_version should be rejected');
      failed++;
    } else if (!hasErrorMatching(result.errors, 'schema_version', 'unsupported schema version')) {
      console.error('FAIL proof-5: expected schema_version error, got:', result.errors);
      failed++;
    } else {
      console.log(`PASS proof-5: schema_version '9999.1' rejected — "${result.errors[0].message}"`);
      passed++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 6: Extensions namespace passthrough accepted                 */
  /* ---------------------------------------------------------------- */
  {
    const spec = makeValidSpec();
    spec.extensions = {
      assets: { icons: ['icon-16.png', 'icon-48.png', 'icon-128.png'] },
      localization: { languages: ['en', 'sw', 'fr'] },
      custom_plugin: { enabled: true, config: { nested: { deep: 42 } } },
    };

    const result = validateSpec(spec);
    if (!result.valid) {
      console.error('FAIL proof-6: extensions passthrough should be accepted, got:', result.errors);
      failed++;
    } else {
      const ext = result.spec.extensions as Record<string, unknown>;
      const hasAssets = ext && 'assets' in ext;
      const hasLocalization = ext && 'localization' in ext;
      const hasCustom = ext && 'custom_plugin' in ext;
      if (!hasAssets || !hasLocalization || !hasCustom) {
        console.error('FAIL proof-6: extensions data not preserved');
        failed++;
      } else {
        console.log('PASS proof-6: extensions namespace (assets, localization, custom_plugin) accepted and preserved');
        passed++;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Proof 7: Validated spec is deep-frozen (mutation throws)          */
  /* ---------------------------------------------------------------- */
  {
    const result = validateSpec(makeValidSpec());
    if (!result.valid) {
      console.error('FAIL proof-7: valid spec should validate');
      failed++;
    } else {
      let threw = false;
      try {
        (result.spec as Record<string, unknown>).product = { name: 'HACKED' };
      } catch (e) {
        threw = true;
      }
      if (!threw) {
        console.error('FAIL proof-7: mutating frozen spec.product should throw');
        failed++;
      } else {
        let deepThrew = false;
        try {
          (result.spec.product as Record<string, unknown>).name = 'HACKED';
        } catch (e) {
          deepThrew = true;
        }
        if (!deepThrew) {
          console.error('FAIL proof-7: mutating frozen spec.product.name should throw');
          failed++;
        } else {
          let arrayThrew = false;
          try {
            (result.spec.features as unknown[]).push({ id: 'injected' });
          } catch (e) {
            arrayThrew = true;
          }
          if (!arrayThrew) {
            console.error('FAIL proof-7: pushing to frozen spec.features should throw');
            failed++;
          } else {
            console.log('PASS proof-7: deep-frozen — top-level, nested object, and array mutations all throw');
            passed++;
          }
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Report                                                            */
  /* ---------------------------------------------------------------- */
  console.log('');
  console.log(`Spec Schema: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
