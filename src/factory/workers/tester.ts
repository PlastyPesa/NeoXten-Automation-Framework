/**
 * Tester Worker — converts spec journeys to NeoXten flows and runs them.
 * Wraps the existing NeoXten orchestrator for execution.
 * Produces verdicts + evidence per journey.
 */

import type { WorkerContract, WorkerResult } from '../worker-contract.js';
import type { RunState } from '../run-state.js';
import type { EvidenceChain } from '../evidence-chain.js';
import type { FactorySpec } from '../spec/schema.js';

export interface JourneyRunner {
  run(journey: JourneyConfig): Promise<JourneyVerdict>;
}

export interface JourneyConfig {
  journeyId: string;
  name: string;
  steps: Array<{ action: string; selector?: string; value?: string; assertType?: string }>;
  appUrl: string;
}

export interface JourneyVerdict {
  journeyId: string;
  verdict: 'PASS' | 'FAIL';
  durationMs: number;
  screenshotPaths: string[];
  failureReason?: string;
}

export interface TesterDeps {
  runner: JourneyRunner;
  appUrl: string;
}

export function createTesterWorker(deps: TesterDeps): WorkerContract {
  return {
    id: 'tester',
    accepts: 'testing',
    requires: ['buildOutput'],
    produces: ['testResults'],
    timeout: 600_000,

    async execute(_task: unknown, runState: RunState, chain: EvidenceChain): Promise<WorkerResult> {
      const spec = runState.spec;
      const journeys = specToJourneyConfigs(spec, deps.appUrl);
      const artifacts: Array<{ name: string; path: string }> = [];
      let allPassed = true;

      for (const jc of journeys) {
        chain.append({
          type: 'note',
          workerId: 'tester',
          stage: 'testing',
          data: { event: 'journey_start', journeyId: jc.journeyId, stepCount: jc.steps.length },
        });

        const verdict = await deps.runner.run(jc);

        chain.append({
          type: 'note',
          workerId: 'tester',
          stage: 'testing',
          data: {
            event: 'journey_end',
            journeyId: verdict.journeyId,
            verdict: verdict.verdict,
            durationMs: verdict.durationMs,
          },
        });

        runState.addTestResult({
          journeyId: verdict.journeyId,
          verdict: verdict.verdict,
          durationMs: verdict.durationMs,
          screenshotPaths: verdict.screenshotPaths,
          failureReason: verdict.failureReason,
        });

        for (const sp of verdict.screenshotPaths) {
          artifacts.push({ name: `screenshot-${verdict.journeyId}`, path: sp });
        }

        if (verdict.verdict === 'FAIL') allPassed = false;
      }

      if (!allPassed) {
        const failedIds = journeys
          .map(j => j.journeyId)
          .filter(id => runState.getTestResults().find(r => r.journeyId === id)?.verdict === 'FAIL');
        return {
          status: 'failed',
          reason: `journeys failed: ${failedIds.join(', ')}`,
          evidence: [],
        };
      }

      return { status: 'done', artifacts, evidence: [] };
    },
  };
}

function specToJourneyConfigs(spec: FactorySpec, appUrl: string): JourneyConfig[] {
  const journeys = spec.journeys as Array<{
    id: string; name: string;
    steps: Array<{ action: string; selector?: string; value?: string; assertType?: string }>;
  }>;
  return journeys.map(j => ({
    journeyId: j.id,
    name: j.name,
    steps: j.steps,
    appUrl,
  }));
}
