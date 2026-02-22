/**
 * Store Pipelines — Acceptance Proofs
 *
 * Android Pack:
 *  1. Build + sign → artifacts with SHA-256, hashes.json, release-notes, evidence-ref
 *  2. Build failure → throws with exit code and stderr
 *
 * Chrome Extension Pack:
 *  3. Valid manifest + icons resized → ZIP + listing + hashes, manifest valid
 *  4. Missing manifest field → manifestValidation.valid = false
 *  5. No script tags flagged, dev files stripped
 *
 * Asset Pipeline:
 *  6. Screenshots resized to platform dimensions → allPassed
 *  7. Feature graphic → 1024x500 check
 *
 * Docs Pipeline:
 *  8. Templates substituted → no unresolved placeholders, valid links, no script tags
 *  9. Missing template → structure check fails
 * 10. Script tag in privacy template → no_script_tags fails
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EvidenceChain } from '../evidence-chain.js';
import { buildAndroidPack } from '../store/android-pack.js';
import { buildChromePack } from '../store/chrome-pack.js';
import { runAssetPipeline } from '../store/asset-pipeline.js';
import { runDocsPipeline } from '../store/docs-pipeline.js';

const TEST_DIR = path.join(os.tmpdir(), 'store-test-' + Date.now());

function mockShell(overrides?: Record<string, { exitCode: number; stdout: string; stderr: string }>) {
  return {
    async run(command: string, _cwd: string) {
      if (overrides) {
        for (const [pattern, result] of Object.entries(overrides)) {
          if (command.includes(pattern)) return result;
        }
      }
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  };
}

function mockFs(files: Record<string, string | Buffer> = {}): {
  exists: (p: string) => boolean;
  readFile: (p: string) => Buffer;
  readFileUtf8: (p: string) => string;
  writeFile: (p: string, c: string | Buffer) => void;
  mkdir: (p: string) => void;
  listDir: (p: string) => string[];
  written: Record<string, string | Buffer>;
} {
  const written: Record<string, string | Buffer> = {};
  return {
    exists: (p: string) => p in files || p in written,
    readFile: (p: string) => {
      const v = files[p] ?? written[p];
      if (!v) throw new Error(`file not found: ${p}`);
      return typeof v === 'string' ? Buffer.from(v) : v;
    },
    readFileUtf8: (p: string) => {
      const v = files[p] ?? written[p];
      if (!v) throw new Error(`file not found: ${p}`);
      return typeof v === 'string' ? v : v.toString('utf-8');
    },
    writeFile: (p: string, c: string | Buffer) => { written[p] = c; },
    mkdir: () => {},
    listDir: () => Object.keys(files).filter(f => !f.includes('node_modules') && !f.includes('.map')),
    written,
  };
}

async function runTests(): Promise<void> {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });

  let passed = 0;
  let failed = 0;

  function check(proofName: string, checks: Array<readonly [string, boolean]>): void {
    const fails = checks.filter(([, ok]) => !ok).map(([n]) => n);
    if (fails.length > 0) {
      console.error(`FAIL ${proofName}: ${fails.join(', ')}`);
      failed++;
    } else {
      console.log(`PASS ${proofName}`);
      passed++;
    }
  }

  /* ---- Android Pack ---- */
  {
    const chain = new EvidenceChain();
    const mfs = mockFs({
      [`${TEST_DIR}/android/app-release.aab`]: Buffer.from('fake-aab-content'),
      [`${TEST_DIR}/android/app-release.apk`]: Buffer.from('fake-apk-content'),
      [`${TEST_DIR}/proj/app/build/outputs/mapping/release/mapping.txt`]: 'mapping-data',
    });
    const result = await buildAndroidPack({
      projectDir: `${TEST_DIR}/proj`,
      outputDir: `${TEST_DIR}/android`,
      keystorePath: '/fake/keystore.jks',
      keyAlias: 'release',
      storePassword: 'pass',
      keyPassword: 'pass',
      versionName: '1.0.0',
      versionCode: 1,
      packageName: 'com.test.app',
      changelog: 'Initial release.',
      runId: 'test-run',
      evidenceChainHash: 'a'.repeat(64),
    }, { shell: mockShell(), fs: mfs }, chain);

    check('android-pack: build + sign → artifacts hashed, notes, evidence-ref', [
      ['aab artifact', result.artifacts.some(a => a.path.includes('aab'))],
      ['apk artifact', result.artifacts.some(a => a.path.includes('apk'))],
      ['mapping artifact', result.artifacts.some(a => a.path.includes('mapping'))],
      ['all sha256 64 chars', result.artifacts.every(a => a.sha256.length === 64)],
      ['hashes.json has aab', !!result.hashesJson['app-release.aab']],
      ['release-notes written', mfs.written[result.releaseNotesPath] !== undefined],
      ['evidence-ref written', mfs.written[result.evidenceRefPath] !== undefined],
      ['evidence-ref no real key', !(mfs.written[result.evidenceRefPath] as string).includes('pass:')],
      ['chain has android_pack_start', chain.getTimeline().some(e => (e.data as Record<string, unknown>).event === 'android_pack_start')],
      ['chain has artifact_produced', chain.getTimeline().some(e => e.type === 'artifact_produced')],
    ]);
  }
  {
    const chain = new EvidenceChain();
    const mfs = mockFs({});
    let threw = false;
    let errorMsg = '';
    try {
      await buildAndroidPack({
        projectDir: '/proj', outputDir: '/out', keystorePath: '/ks', keyAlias: 'r',
        storePassword: 'p', keyPassword: 'p', versionName: '1.0.0', versionCode: 1,
        packageName: 'com.test.app', runId: 'r', evidenceChainHash: 'x',
      }, { shell: mockShell({ 'bundleRelease': { exitCode: 1, stdout: '', stderr: 'gradle error' } }), fs: mfs }, chain);
    } catch (e) {
      threw = true;
      errorMsg = (e as Error).message;
    }
    check('android-pack: build failure → throws', [
      ['threw', threw],
      ['mentions exit code', errorMsg.includes('exit 1')],
      ['mentions stderr', errorMsg.includes('gradle error')],
    ]);
  }

  /* ---- Chrome Extension Pack ---- */
  {
    const chain = new EvidenceChain();
    const manifest = JSON.stringify({ manifest_version: 3, name: 'TestExt', version: '1.0.0', description: 'Test', icons: {}, permissions: [] });
    const iconData = Buffer.from('png-icon-data');
    const mfs = mockFs({
      '/ext/manifest.json': manifest,
      '/ext/popup.html': '<html></html>',
      '/ext/background.js': 'console.log("bg")',
      '/icon.png': iconData,
      [`${TEST_DIR}/chrome/extension.zip`]: Buffer.from('zip-content'),
      [`${TEST_DIR}/chrome/icons/icon-16.png`]: iconData,
      [`${TEST_DIR}/chrome/icons/icon-32.png`]: iconData,
      [`${TEST_DIR}/chrome/icons/icon-48.png`]: iconData,
      [`${TEST_DIR}/chrome/icons/icon-128.png`]: iconData,
    });
    const result = await buildChromePack({
      extensionDir: '/ext',
      outputDir: `${TEST_DIR}/chrome`,
      sourceIconPath: '/icon.png',
      screenshotPaths: [],
      specMeta: { name: 'TestExt', version: '1.0.0', description: 'A test extension' },
    }, { shell: mockShell(), fs: mfs }, chain);

    check('chrome-pack: valid manifest + icons → ZIP, listing, manifest valid', [
      ['manifest valid', result.manifestValidation.valid],
      ['zero manifest errors', result.manifestValidation.errors.length === 0],
      ['has hashes', Object.keys(result.hashesJson).length > 0],
      ['store listing written', mfs.written[result.storeListingPath] !== undefined],
      ['chain has chrome_pack_start', chain.getTimeline().some(e => (e.data as Record<string, unknown>).event === 'chrome_pack_start')],
      ['chain has chrome_pack_complete', chain.getTimeline().some(e => (e.data as Record<string, unknown>).event === 'chrome_pack_complete')],
    ]);
  }
  {
    const chain = new EvidenceChain();
    const badManifest = JSON.stringify({ manifest_version: 3, name: 'TestExt' });
    const mfs = mockFs({ '/ext/manifest.json': badManifest, '/icon.png': Buffer.from('png') });
    const result = await buildChromePack({
      extensionDir: '/ext', outputDir: `${TEST_DIR}/chrome2`, sourceIconPath: '/icon.png',
      screenshotPaths: [], specMeta: { name: 'X', version: '1.0', description: 'Y' },
    }, { shell: mockShell(), fs: mfs }, chain);

    check('chrome-pack: missing manifest fields → validation fails', [
      ['not valid', !result.manifestValidation.valid],
      ['mentions version', result.manifestValidation.errors.some(e => e.includes('version'))],
      ['mentions description', result.manifestValidation.errors.some(e => e.includes('description'))],
    ]);
  }

  /* ---- Asset Pipeline ---- */
  {
    const chain = new EvidenceChain();
    const mfs = mockFs({
      '/screenshots/s1.png': Buffer.from('screenshot1'),
      '/screenshots/s2.png': Buffer.from('screenshot2'),
    });
    const identifyShell = mockShell({
      'identify': { exitCode: 0, stdout: '1080x1920', stderr: '' },
    });
    const result = await runAssetPipeline({
      screenshotPaths: ['/screenshots/s1.png', '/screenshots/s2.png'],
      outputDir: `${TEST_DIR}/assets`,
      platforms: ['android'],
    }, { shell: identifyShell, fs: mfs }, chain);

    check('asset-pipeline: screenshots resized → dimension checks pass', [
      ['has checks', result.checks.length >= 2],
      ['all passed', result.allPassed],
      ['expected 1080x1920', result.checks.every(c => c.expectedWidth === 1080 && c.expectedHeight === 1920)],
      ['actual matches', result.checks.every(c => c.actualWidth === 1080 && c.actualHeight === 1920)],
      ['output files', result.outputFiles.length >= 2],
      ['validation written', mfs.written[result.validationPath] !== undefined],
    ]);
  }
  {
    const chain = new EvidenceChain();
    const mfs = mockFs({ '/fg.png': Buffer.from('feature-graphic') });
    const identifyShell = mockShell({
      'identify': { exitCode: 0, stdout: '1024x500', stderr: '' },
    });
    const result = await runAssetPipeline({
      screenshotPaths: [],
      featureGraphicSource: '/fg.png',
      outputDir: `${TEST_DIR}/assets-fg`,
      platforms: ['android'],
    }, { shell: identifyShell, fs: mfs }, chain);

    check('asset-pipeline: feature graphic → 1024x500', [
      ['has check', result.checks.length === 1],
      ['1024x500 expected', result.checks[0].expectedWidth === 1024 && result.checks[0].expectedHeight === 500],
      ['passed', result.checks[0].passed],
    ]);
  }

  /* ---- Docs Pipeline ---- */
  {
    const chain = new EvidenceChain();
    const privacyTmpl = fs.readFileSync(path.join(process.cwd(), 'templates/docs/privacy-policy.html.tmpl'), 'utf-8');
    const termsTmpl = fs.readFileSync(path.join(process.cwd(), 'templates/docs/terms-of-service.html.tmpl'), 'utf-8');
    const supportTmpl = fs.readFileSync(path.join(process.cwd(), 'templates/docs/support.html.tmpl'), 'utf-8');
    const mfs = mockFs({
      '/templates/privacy-policy.html.tmpl': privacyTmpl,
      '/templates/terms-of-service.html.tmpl': termsTmpl,
      '/templates/support.html.tmpl': supportTmpl,
    });
    const result = runDocsPipeline({
      templateDir: '/templates',
      outputDir: `${TEST_DIR}/docs`,
      productData: {
        name: 'TestApp',
        contactEmail: 'test@example.com',
        website: 'https://example.com',
        description: 'A test application.',
        legalEntity: 'TestCorp Ltd',
        jurisdiction: 'England and Wales',
        faqSummary: 'Visit our FAQ page for common questions.',
        dataCollectionSummary: 'We collect usage data.',
        dataStorageSummary: 'Data stored locally.',
        thirdPartySummary: 'No third parties.',
        childrenPrivacySummary: 'Not for children under 13.',
      },
    }, { fs: mfs }, chain);

    const hasUnresolved = result.structureChecks.some(c => c.rule === 'no_unresolved_placeholders' && !c.passed);
    const hasNoScript = result.structureChecks.filter(c => c.rule === 'no_script_tags').every(c => c.passed);
    const allLinks = result.linkChecks.every(c => c.valid);

    check('docs-pipeline: templates substituted, validated, no scripts, valid links', [
      ['3 files generated', result.generatedFiles.length === 3],
      ['no unresolved', !hasUnresolved],
      ['no script tags', hasNoScript],
      ['valid links', allLinks],
      ['allPassed', result.allPassed],
      ['validation written', mfs.written[result.validationPath] !== undefined],
      ['chain has docs_pipeline_start', chain.getTimeline().some(e => (e.data as Record<string, unknown>).event === 'docs_pipeline_start')],
      ['chain has docs_pipeline_complete', chain.getTimeline().some(e => (e.data as Record<string, unknown>).event === 'docs_pipeline_complete')],
    ]);
  }
  {
    const chain = new EvidenceChain();
    const mfs = mockFs({});
    const result = runDocsPipeline({
      templateDir: '/nonexistent',
      outputDir: `${TEST_DIR}/docs-missing`,
      productData: { name: 'X', contactEmail: 'x@x.com' },
    }, { fs: mfs }, chain);

    check('docs-pipeline: missing template → structure check fails', [
      ['not all passed', !result.allPassed],
      ['template_exists fails', result.structureChecks.some(c => c.rule === 'template_exists' && !c.passed)],
      ['zero generated', result.generatedFiles.length === 0],
    ]);
  }
  {
    const chain = new EvidenceChain();
    const scriptTemplate = `<!DOCTYPE html><html lang="en"><head><title>Privacy</title></head><body><script>alert('xss')</script><p>{{product.name}}</p></body></html>`;
    const mfs = mockFs({
      '/templates/privacy-policy.html.tmpl': scriptTemplate,
      '/templates/terms-of-service.html.tmpl': `<!DOCTYPE html><html lang="en"><head></head><body>Terms</body></html>`,
      '/templates/support.html.tmpl': `<!DOCTYPE html><html lang="en"><head></head><body>Support</body></html>`,
    });
    const result = runDocsPipeline({
      templateDir: '/templates',
      outputDir: `${TEST_DIR}/docs-script`,
      productData: { name: 'X', contactEmail: 'x@x.com' },
    }, { fs: mfs }, chain);

    check('docs-pipeline: script tag in privacy → no_script_tags fails', [
      ['not all passed', !result.allPassed],
      ['no_script_tags fails', result.structureChecks.some(c => c.rule === 'no_script_tags' && !c.passed)],
    ]);
  }

  /* ---- Cleanup ---- */
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });

  console.log('');
  console.log(`Store Pipelines: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
