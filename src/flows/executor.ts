import type { Flow, FlowStep } from '../config/schema.js';
import type { UIDriver, StepResult } from '../drivers/base.js';

export interface FlowResult {
  flowName: string;
  passed: boolean;
  failedStepIndex: number;
  error?: string;
  stepResults: StepResult[];
}

export async function executeFlow(
  driver: UIDriver,
  flow: Flow,
  onStepComplete?: (index: number, result: StepResult) => void
): Promise<FlowResult> {
  const stepResults: StepResult[] = [];

  for (let i = 0; i < flow.steps.length; i++) {
    const step = flow.steps[i];
    const result = await driver.executeStep(step);
    stepResults.push(result);
    onStepComplete?.(i, result);

    if (!result.success) {
      return {
        flowName: flow.name,
        passed: false,
        failedStepIndex: i,
        error: result.error,
        stepResults,
      };
    }
  }

  return {
    flowName: flow.name,
    passed: true,
    failedStepIndex: -1,
    stepResults,
  };
}
