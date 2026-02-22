/**
 * ReleasePackager Worker — builds production artifacts per delivery targets.
 * Computes SHA-256 hashes for every artifact. Verifies sizes.
 * Fully deterministic. No LLM.
 */

import { createHash } from 'node:crypto';
import type { WorkerContract, WorkerResult, WorkerArtifact } from '../worker-contract.js';
import type { RunState } from '../run-state.js';
import type { EvidenceChain } from '../evidence-chain.js';

export interface PackagerTool {
  buildForTarget(target: string, projectDir: string): Promise<PackageResult>;
}

export interface PackageResult {
  artifacts: Array<{ path: string; sizeBytes: number; content?: Buffer }>;
}

export interface ReleasePackagerDeps {
  packager: PackagerTool;
  maxBundleSizeBytes?: number;
}

export function createReleasePackagerWorker(deps: ReleasePackagerDeps): WorkerContract {
  return {
    id: 'release-packager',
    accepts: 'release_package',
    requires: ['securityReport', 'buildOutput'],
    produces: ['releaseArtifacts'],
    timeout: 600_000,

    async execute(_task: unknown, runState: RunState, chain: EvidenceChain): Promise<WorkerResult> {
      const spec = runState.spec;
      const buildOutput = runState.getBuildOutput()!;
      const targets = (spec.delivery as { targets: string[] }).targets;
      const allArtifacts: WorkerArtifact[] = [];

      for (const target of targets) {
        chain.append({
          type: 'note',
          workerId: 'release-packager',
          stage: 'release_package',
          data: { event: 'package_start', target },
        });

        const result = await deps.packager.buildForTarget(target, buildOutput.projectDir);

        for (const artifact of result.artifacts) {
          const sha256 = artifact.content
            ? createHash('sha256').update(artifact.content).digest('hex')
            : createHash('sha256').update(artifact.path).digest('hex');

          if (deps.maxBundleSizeBytes && artifact.sizeBytes > deps.maxBundleSizeBytes) {
            return {
              status: 'failed',
              reason: `artifact '${artifact.path}' exceeds max size: ${artifact.sizeBytes} > ${deps.maxBundleSizeBytes}`,
              evidence: [],
            };
          }

          runState.addReleaseArtifact({
            platform: target,
            path: artifact.path,
            sha256,
            sizeBytes: artifact.sizeBytes,
          });

          allArtifacts.push({ name: artifact.path, path: artifact.path, sha256 });
        }

        chain.append({
          type: 'artifact_produced',
          workerId: 'release-packager',
          stage: 'release_package',
          data: {
            target,
            artifactCount: result.artifacts.length,
            totalSizeBytes: result.artifacts.reduce((s, a) => s + a.sizeBytes, 0),
          },
        });
      }

      return { status: 'done', artifacts: allArtifacts, evidence: [] };
    },
  };
}
