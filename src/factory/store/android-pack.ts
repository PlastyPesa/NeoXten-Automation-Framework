/**
 * Android Store Pack — deterministic sub-task.
 *
 * Builds signed AAB/APK, extracts mapping, computes hashes,
 * generates release notes from spec, bundles evidence references.
 * No LLM. All tool calls via injected ShellExecutor.
 */

import { createHash } from 'node:crypto';
import type { EvidenceChain } from '../evidence-chain.js';

export interface ShellExecutor {
  run(command: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface FileSystem {
  exists(path: string): boolean;
  readFile(path: string): Buffer;
  writeFile(path: string, content: string | Buffer): void;
  mkdir(path: string): void;
}

export interface AndroidPackInput {
  projectDir: string;
  outputDir: string;
  keystorePath: string;
  keyAlias: string;
  storePassword: string;
  keyPassword: string;
  versionName: string;
  versionCode: number;
  packageName: string;
  changelog?: string;
  runId: string;
  evidenceChainHash: string;
}

export interface AndroidPackOutput {
  artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>;
  hashesJson: Record<string, string>;
  releaseNotesPath: string;
  evidenceRefPath: string;
}

export interface AndroidPackDeps {
  shell: ShellExecutor;
  fs: FileSystem;
}

export async function buildAndroidPack(
  input: AndroidPackInput,
  deps: AndroidPackDeps,
  chain: EvidenceChain,
): Promise<AndroidPackOutput> {
  const { shell, fs } = deps;
  const outDir = input.outputDir;
  fs.mkdir(outDir);

  chain.append({
    type: 'note', workerId: 'release-packager', stage: 'release_package',
    data: { event: 'android_pack_start', packageName: input.packageName, versionName: input.versionName },
  });

  const bundleResult = await shell.run(
    `./gradlew bundleRelease -PversionName=${input.versionName} -PversionCode=${input.versionCode}`,
    input.projectDir,
  );
  if (bundleResult.exitCode !== 0) {
    throw new Error(`bundleRelease failed (exit ${bundleResult.exitCode}): ${bundleResult.stderr.slice(0, 500)}`);
  }

  const apkResult = await shell.run(
    `./gradlew assembleRelease -PversionName=${input.versionName} -PversionCode=${input.versionCode}`,
    input.projectDir,
  );

  const signResult = await shell.run(
    `apksigner sign --ks "${input.keystorePath}" --ks-key-alias "${input.keyAlias}" --ks-pass "pass:${input.storePassword}" --key-pass "pass:${input.keyPassword}" "${outDir}/app-release.aab"`,
    input.projectDir,
  );

  const artifacts: AndroidPackOutput['artifacts'] = [];
  const hashesJson: Record<string, string> = {};

  const aabPath = `${outDir}/app-release.aab`;
  if (fs.exists(aabPath)) {
    const content = fs.readFile(aabPath);
    const hash = createHash('sha256').update(content).digest('hex');
    artifacts.push({ path: aabPath, sha256: hash, sizeBytes: content.length });
    hashesJson['app-release.aab'] = `sha256:${hash}`;
  }

  const apkPath = `${outDir}/app-release.apk`;
  if (apkResult.exitCode === 0 && fs.exists(apkPath)) {
    const content = fs.readFile(apkPath);
    const hash = createHash('sha256').update(content).digest('hex');
    artifacts.push({ path: apkPath, sha256: hash, sizeBytes: content.length });
    hashesJson['app-release.apk'] = `sha256:${hash}`;
  }

  const mappingPath = `${input.projectDir}/app/build/outputs/mapping/release/mapping.txt`;
  if (fs.exists(mappingPath)) {
    const content = fs.readFile(mappingPath);
    const mappingOut = `${outDir}/mapping.txt`;
    fs.writeFile(mappingOut, content);
    const hash = createHash('sha256').update(content).digest('hex');
    artifacts.push({ path: mappingOut, sha256: hash, sizeBytes: content.length });
    hashesJson['mapping.txt'] = `sha256:${hash}`;
  }

  const releaseNotesPath = `${outDir}/release-notes.md`;
  const releaseNotes = `# ${input.packageName} v${input.versionName} (${input.versionCode})\n\n${input.changelog ?? 'No changelog provided.'}\n`;
  fs.writeFile(releaseNotesPath, releaseNotes);

  const evidenceRefPath = `${outDir}/evidence-ref.json`;
  const evidenceRef = JSON.stringify({
    runId: input.runId,
    evidenceChainHash: input.evidenceChainHash,
    signedWith: '[REDACTED]',
    signResult: { exitCode: signResult.exitCode },
  }, null, 2);
  fs.writeFile(evidenceRefPath, evidenceRef);

  const hashesPath = `${outDir}/hashes.json`;
  fs.writeFile(hashesPath, JSON.stringify(hashesJson, null, 2));

  for (const artifact of artifacts) {
    chain.append({
      type: 'artifact_produced', workerId: 'release-packager', stage: 'release_package',
      data: { target: 'android', path: artifact.path, sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
    });
  }

  chain.append({
    type: 'note', workerId: 'release-packager', stage: 'release_package',
    data: { event: 'android_pack_complete', artifactCount: artifacts.length },
  });

  return { artifacts, hashesJson, releaseNotesPath, evidenceRefPath };
}
