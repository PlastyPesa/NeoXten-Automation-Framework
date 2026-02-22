/**
 * Store Asset Pipeline — deterministic screenshot/graphic resizing.
 *
 * Resizes screenshots to platform dimensions via ImageMagick.
 * Validates all output dimensions exactly. Produces validation report.
 * No LLM.
 */

import type { EvidenceChain } from '../evidence-chain.js';

export interface ShellExecutor {
  run(command: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface FileSystem {
  exists(path: string): boolean;
  writeFile(path: string, content: string | Buffer): void;
  mkdir(path: string): void;
}

export interface DimensionCheck {
  file: string;
  expectedWidth: number;
  expectedHeight: number;
  actualWidth: number;
  actualHeight: number;
  passed: boolean;
}

export interface AssetPipelineInput {
  screenshotPaths: string[];
  featureGraphicSource?: string;
  outputDir: string;
  platforms: string[];
}

export interface AssetPipelineOutput {
  checks: DimensionCheck[];
  allPassed: boolean;
  outputFiles: string[];
  validationPath: string;
}

export interface AssetPipelineDeps {
  shell: ShellExecutor;
  fs: FileSystem;
}

interface ResizeTarget {
  width: number;
  height: number;
  prefix: string;
  subDir: string;
}

const PLAY_STORE_TARGETS: ResizeTarget[] = [
  { width: 1080, height: 1920, prefix: 'phone', subDir: 'play-store/screenshots' },
];

const CHROME_STORE_TARGETS: ResizeTarget[] = [
  { width: 1280, height: 800, prefix: 'screenshot', subDir: 'chrome-store' },
  { width: 640, height: 400, prefix: 'screenshot', subDir: 'chrome-store' },
];

export async function runAssetPipeline(
  input: AssetPipelineInput,
  deps: AssetPipelineDeps,
  chain: EvidenceChain,
): Promise<AssetPipelineOutput> {
  const { shell, fs } = deps;
  const outDir = input.outputDir;
  fs.mkdir(outDir);

  chain.append({
    type: 'note', workerId: 'release-packager', stage: 'release_package',
    data: { event: 'asset_pipeline_start', screenshotCount: input.screenshotPaths.length, platforms: input.platforms },
  });

  const checks: DimensionCheck[] = [];
  const outputFiles: string[] = [];

  const targets: ResizeTarget[] = [];
  if (input.platforms.includes('android')) targets.push(...PLAY_STORE_TARGETS);
  if (input.platforms.includes('chrome_extension')) targets.push(...CHROME_STORE_TARGETS);

  for (const target of targets) {
    const dir = `${outDir}/${target.subDir}`;
    fs.mkdir(dir);

    for (let i = 0; i < input.screenshotPaths.length; i++) {
      const src = input.screenshotPaths[i];
      const outFile = `${dir}/${target.prefix}-${target.width}x${target.height}-${i + 1}.png`;

      await shell.run(
        `magick convert "${src}" -resize ${target.width}x${target.height}! "${outFile}"`,
        '.',
      );

      const identifyResult = await shell.run(`magick identify -format "%wx%h" "${outFile}"`, '.');
      const [w, h] = identifyResult.stdout.trim().replace(/"/g, '').split('x').map(Number);

      const passed = w === target.width && h === target.height;
      checks.push({
        file: outFile,
        expectedWidth: target.width,
        expectedHeight: target.height,
        actualWidth: w || 0,
        actualHeight: h || 0,
        passed,
      });
      outputFiles.push(outFile);
    }
  }

  if (input.featureGraphicSource && input.platforms.includes('android')) {
    const fgDir = `${outDir}/play-store`;
    fs.mkdir(fgDir);
    const fgOut = `${fgDir}/feature-graphic-1024x500.png`;

    await shell.run(
      `magick convert "${input.featureGraphicSource}" -resize 1024x500! "${fgOut}"`,
      '.',
    );

    const identifyResult = await shell.run(`magick identify -format "%wx%h" "${fgOut}"`, '.');
    const [w, h] = identifyResult.stdout.trim().replace(/"/g, '').split('x').map(Number);

    checks.push({
      file: fgOut,
      expectedWidth: 1024, expectedHeight: 500,
      actualWidth: w || 0, actualHeight: h || 0,
      passed: w === 1024 && h === 500,
    });
    outputFiles.push(fgOut);
  }

  const allPassed = checks.every(c => c.passed);
  const validationPath = `${outDir}/validation.json`;
  fs.writeFile(validationPath, JSON.stringify({ checks, allPassed }, null, 2));

  chain.append({
    type: 'note', workerId: 'release-packager', stage: 'release_package',
    data: { event: 'asset_pipeline_complete', checksCount: checks.length, allPassed },
  });

  return { checks, allPassed, outputFiles, validationPath };
}
