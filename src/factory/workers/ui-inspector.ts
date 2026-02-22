/**
 * UIInspector Worker — visual QA against design contract.
 * Measures layout violations, contrast ratios, accessibility.
 * All outputs are numeric (no string opinions). No LLM.
 */

import type { WorkerContract, WorkerResult } from '../worker-contract.js';
import type { RunState } from '../run-state.js';
import type { EvidenceChain } from '../evidence-chain.js';

export interface LayoutCheck { element: string; violation: string; measured: number; threshold: number }
export interface ContrastCheck { element: string; ratio: number; threshold: number; passed: boolean }
export interface A11yCheck { rule: string; passed: boolean }

export interface VisualAnalyzer {
  analyzeLayout(screenshotPaths: string[]): Promise<LayoutCheck[]>;
  analyzeContrast(screenshotPaths: string[], minRatio: number): Promise<ContrastCheck[]>;
  analyzeAccessibility(screenshotPaths: string[]): Promise<A11yCheck[]>;
}

export interface UIInspectorDeps {
  analyzer: VisualAnalyzer;
  contrastThreshold: number;
}

export function createUIInspectorWorker(deps: UIInspectorDeps): WorkerContract {
  return {
    id: 'ui-inspector',
    accepts: 'ui_inspection',
    requires: ['testResults'],
    produces: ['uiInspection'],
    timeout: 120_000,

    async execute(_task: unknown, runState: RunState, chain: EvidenceChain): Promise<WorkerResult> {
      const screenshots = runState.getTestResults().flatMap(r => r.screenshotPaths);

      const [layoutChecks, contrastChecks, a11yChecks] = await Promise.all([
        deps.analyzer.analyzeLayout(screenshots),
        deps.analyzer.analyzeContrast(screenshots, deps.contrastThreshold),
        deps.analyzer.analyzeAccessibility(screenshots),
      ]);

      const layoutViolations = layoutChecks.filter(c => c.measured > c.threshold).length;
      const contrastFails = contrastChecks.filter(c => !c.passed);
      const a11yFails = a11yChecks.filter(c => !c.passed);
      const overallPassed = layoutViolations === 0 && contrastFails.length === 0 && a11yFails.length === 0;

      chain.append({
        type: 'note',
        workerId: 'ui-inspector',
        stage: 'ui_inspection',
        data: {
          event: 'inspection_complete',
          layoutViolations,
          contrastFails: contrastFails.length,
          a11yFails: a11yFails.length,
          overallPassed,
        },
      });

      runState.setUIInspection({
        layoutViolations,
        contrastChecks: contrastChecks.map(c => ({
          element: c.element, ratio: c.ratio, threshold: c.threshold, passed: c.passed,
        })),
        accessibilityChecks: a11yChecks.map(c => ({ rule: c.rule, passed: c.passed })),
        overallPassed,
      });

      if (!overallPassed) {
        const reasons: string[] = [];
        if (layoutViolations > 0) reasons.push(`${layoutViolations} layout violations`);
        if (contrastFails.length > 0) reasons.push(`${contrastFails.length} contrast failures`);
        if (a11yFails.length > 0) reasons.push(`${a11yFails.length} accessibility failures`);
        return { status: 'failed', reason: reasons.join(', '), evidence: [] };
      }

      return { status: 'done', artifacts: [], evidence: [] };
    },
  };
}
