/**
 * Chrome Extension Store Pack — deterministic sub-task.
 *
 * Validates manifest.json, resizes icons via ImageMagick,
 * strips dev files, creates store-ready ZIP, generates listing.
 * No LLM. All tools injected.
 */

import { createHash } from 'node:crypto';
import type { EvidenceChain } from '../evidence-chain.js';

export interface ShellExecutor {
  run(command: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface FileSystem {
  exists(path: string): boolean;
  readFile(path: string): Buffer;
  readFileUtf8(path: string): string;
  writeFile(path: string, content: string | Buffer): void;
  mkdir(path: string): void;
  listDir(path: string): string[];
}

export interface ChromePackInput {
  extensionDir: string;
  outputDir: string;
  sourceIconPath: string;
  sourcePromoPath?: string;
  screenshotPaths: string[];
  specMeta: { name: string; version: string; description: string; category?: string; language?: string };
}

export interface ManifestValidation {
  valid: boolean;
  errors: string[];
  manifest: Record<string, unknown> | null;
}

export interface ChromePackOutput {
  artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>;
  manifestValidation: ManifestValidation;
  hashesJson: Record<string, string>;
  storeListingPath: string;
}

export interface ChromePackDeps {
  shell: ShellExecutor;
  fs: FileSystem;
}

const REQUIRED_MANIFEST_FIELDS = ['manifest_version', 'name', 'version', 'description'];
const ICON_SIZES = [16, 32, 48, 128];
const DEV_PATTERNS = ['.map', '.env', 'node_modules', '.test.', '.spec.', '__tests__'];

export async function buildChromePack(
  input: ChromePackInput,
  deps: ChromePackDeps,
  chain: EvidenceChain,
): Promise<ChromePackOutput> {
  const { shell, fs } = deps;
  const outDir = input.outputDir;
  fs.mkdir(outDir);
  fs.mkdir(`${outDir}/icons`);
  fs.mkdir(`${outDir}/screenshots`);

  chain.append({
    type: 'note', workerId: 'release-packager', stage: 'release_package',
    data: { event: 'chrome_pack_start', name: input.specMeta.name },
  });

  const manifestValidation = validateManifest(input.extensionDir, deps.fs);

  for (const size of ICON_SIZES) {
    await shell.run(
      `magick convert "${input.sourceIconPath}" -resize ${size}x${size} "${outDir}/icons/icon-${size}.png"`,
      '.',
    );
  }

  if (input.sourcePromoPath && fs.exists(input.sourcePromoPath)) {
    fs.mkdir(`${outDir}/promo`);
    await shell.run(
      `magick convert "${input.sourcePromoPath}" -resize 440x280 -gravity center -extent 440x280 "${outDir}/promo/small-440x280.png"`,
      '.',
    );
    await shell.run(
      `magick convert "${input.sourcePromoPath}" -resize 920x680 -gravity center -extent 920x680 "${outDir}/promo/large-920x680.png"`,
      '.',
    );
  }

  for (let i = 0; i < input.screenshotPaths.length; i++) {
    const sp = input.screenshotPaths[i];
    if (fs.exists(sp)) {
      const content = fs.readFile(sp);
      fs.writeFile(`${outDir}/screenshots/journey-${i + 1}.png`, content);
    }
  }

  const allFiles = fs.listDir(input.extensionDir);
  const cleanFiles = allFiles.filter(f => !DEV_PATTERNS.some(p => f.includes(p)));

  const zipPath = `${outDir}/extension.zip`;
  const fileList = cleanFiles.join(' ');
  await shell.run(`powershell Compress-Archive -Path ${fileList} -DestinationPath "${zipPath}" -Force`, input.extensionDir);

  const storeListingPath = `${outDir}/store-listing.json`;
  const storeListing = {
    name: input.specMeta.name,
    version: input.specMeta.version,
    description: input.specMeta.description,
    category: input.specMeta.category ?? 'productivity',
    language: input.specMeta.language ?? 'en',
  };
  fs.writeFile(storeListingPath, JSON.stringify(storeListing, null, 2));

  if (manifestValidation.valid && manifestValidation.manifest) {
    fs.writeFile(`${outDir}/manifest-validated.json`, JSON.stringify(manifestValidation.manifest, null, 2));
  }

  const artifacts: ChromePackOutput['artifacts'] = [];
  const hashesJson: Record<string, string> = {};

  const filesToHash = [
    zipPath,
    ...ICON_SIZES.map(s => `${outDir}/icons/icon-${s}.png`),
  ];

  for (const filePath of filesToHash) {
    if (fs.exists(filePath)) {
      const content = fs.readFile(filePath);
      const hash = createHash('sha256').update(content).digest('hex');
      const name = filePath.split('/').pop()!;
      artifacts.push({ path: filePath, sha256: hash, sizeBytes: content.length });
      hashesJson[name] = `sha256:${hash}`;
    }
  }

  const hashesPath = `${outDir}/hashes.json`;
  fs.writeFile(hashesPath, JSON.stringify(hashesJson, null, 2));

  for (const artifact of artifacts) {
    chain.append({
      type: 'artifact_produced', workerId: 'release-packager', stage: 'release_package',
      data: { target: 'chrome_extension', path: artifact.path, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
    });
  }

  chain.append({
    type: 'note', workerId: 'release-packager', stage: 'release_package',
    data: { event: 'chrome_pack_complete', artifactCount: artifacts.length, manifestValid: manifestValidation.valid },
  });

  return { artifacts, manifestValidation, hashesJson, storeListingPath };
}

function validateManifest(extensionDir: string, fs: FileSystem): ManifestValidation {
  const manifestPath = `${extensionDir}/manifest.json`;
  if (!fs.exists(manifestPath)) {
    return { valid: false, errors: ['manifest.json not found'], manifest: null };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileUtf8(manifestPath));
  } catch {
    return { valid: false, errors: ['manifest.json is not valid JSON'], manifest: null };
  }

  const errors: string[] = [];
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in manifest)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (manifest.manifest_version !== 3 && manifest.manifest_version !== 2) {
    errors.push(`manifest_version must be 2 or 3, got ${manifest.manifest_version}`);
  }

  return { valid: errors.length === 0, errors, manifest };
}
