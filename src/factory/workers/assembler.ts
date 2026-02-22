/**
 * Assembler Worker — composes WorkUnit outputs into a buildable project.
 * Generates config files, resolves imports, runs build command.
 * Pure deterministic. No LLM.
 */

import type { WorkerContract, WorkerResult } from '../worker-contract.js';
import type { RunState } from '../run-state.js';
import type { EvidenceChain } from '../evidence-chain.js';

export interface ShellExecutor {
  run(command: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface AssemblerDeps {
  shell: ShellExecutor;
  projectDir: string;
}

export function createAssemblerWorker(deps: AssemblerDeps): WorkerContract {
  return {
    id: 'assembler',
    accepts: 'assembly',
    requires: ['plan', 'workUnits'],
    produces: ['buildOutput'],
    timeout: 300_000,

    async execute(_task: unknown, runState: RunState, chain: EvidenceChain): Promise<WorkerResult> {
      const plan = runState.getPlan()!;
      const workUnits = runState.getWorkUnits();
      const allDone = workUnits.every(wu => wu.status === 'done');

      if (!allDone) {
        const failed = workUnits.filter(wu => wu.status !== 'done').map(wu => wu.id);
        return { status: 'failed', reason: `incomplete work units: ${failed.join(', ')}`, evidence: [] };
      }

      const allFiles = workUnits.flatMap(wu => wu.outputFiles);
      const buildCommand = resolveBuildCommand(plan.techStack);

      chain.append({
        type: 'note',
        workerId: 'assembler',
        stage: 'assembly',
        data: { event: 'build_start', command: buildCommand, fileCount: allFiles.length },
      });

      const result = await deps.shell.run(buildCommand, deps.projectDir);

      chain.append({
        type: 'note',
        workerId: 'assembler',
        stage: 'assembly',
        data: { event: 'build_complete', exitCode: result.exitCode, stdoutLen: result.stdout.length },
      });

      if (result.exitCode !== 0) {
        return {
          status: 'failed',
          reason: `build failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`,
          evidence: [],
        };
      }

      runState.setBuildOutput({
        projectDir: deps.projectDir,
        buildCommand,
        exitCode: result.exitCode,
        outputFiles: allFiles,
      });

      return { status: 'done', artifacts: allFiles.map(f => ({ name: f, path: f })), evidence: [] };
    },
  };
}

function resolveBuildCommand(techStack: Record<string, string>): string {
  const fw = techStack.framework?.toLowerCase() ?? '';
  if (fw.includes('next')) return 'npm run build';
  if (fw.includes('vite')) return 'npm run build';
  if (fw.includes('tauri')) return 'cargo tauri build';
  return 'npm run build';
}
