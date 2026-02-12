import type { GatesConfig } from '../config/schema.js';

export interface GateResult {
  name: string;
  passed: boolean;
  measured: number;
  threshold: number;
  message?: string;
}

export interface GateContext {
  startupMs?: number;
  spinnerDetectedMs?: number;
  consoleErrors: number;
  assistantLatencyP95Ms?: number;
  assistantReliabilityPassed?: boolean;
  oneSendOneInference?: boolean;
  backendInvocations?: number;
  llamaSpawns?: number;
  expectedBackendInvocations?: number;
  expectedLlamaSpawns?: number;
}

export function evaluateGates(gates: GatesConfig, ctx: GateContext): GateResult[] {
  const results: GateResult[] = [];

  if (gates.startupMaxMs !== undefined && ctx.startupMs !== undefined) {
    results.push({
      name: 'startup',
      passed: ctx.startupMs <= gates.startupMaxMs,
      measured: ctx.startupMs,
      threshold: gates.startupMaxMs,
      message: ctx.startupMs > gates.startupMaxMs ? `Startup took ${ctx.startupMs}ms (max ${gates.startupMaxMs}ms)` : undefined,
    });
  }

  if (gates.spinnerMaxMs !== undefined && ctx.spinnerDetectedMs !== undefined) {
    results.push({
      name: 'spinner',
      passed: ctx.spinnerDetectedMs <= gates.spinnerMaxMs,
      measured: ctx.spinnerDetectedMs,
      threshold: gates.spinnerMaxMs,
      message: ctx.spinnerDetectedMs > gates.spinnerMaxMs ? `Spinner visible for ${ctx.spinnerDetectedMs}ms` : undefined,
    });
  }

  if (gates.noConsoleErrors && ctx.consoleErrors !== undefined) {
    results.push({
      name: 'console_errors',
      passed: ctx.consoleErrors === 0,
      measured: ctx.consoleErrors,
      threshold: 0,
      message: ctx.consoleErrors > 0 ? `${ctx.consoleErrors} console error(s)` : undefined,
    });
  }

  if (gates.assistantLatencyP95MaxMs !== undefined && ctx.assistantLatencyP95Ms !== undefined) {
    results.push({
      name: 'assistant_latency',
      passed: ctx.assistantLatencyP95Ms <= gates.assistantLatencyP95MaxMs,
      measured: ctx.assistantLatencyP95Ms,
      threshold: gates.assistantLatencyP95MaxMs,
    });
  }

  if (gates.assistantReliabilityRuns !== undefined && ctx.assistantReliabilityPassed !== undefined) {
    results.push({
      name: 'assistant_reliability',
      passed: ctx.assistantReliabilityPassed,
      measured: ctx.assistantReliabilityPassed ? 1 : 0,
      threshold: 1,
    });
  }

  if (gates.oneSendOneInference && ctx.oneSendOneInference !== undefined) {
    results.push({
      name: 'one_send_one_inference',
      passed: ctx.oneSendOneInference,
      measured: ctx.oneSendOneInference ? 1 : 0,
      threshold: 1,
    });
  }

  if (ctx.backendInvocations !== undefined && ctx.expectedBackendInvocations !== undefined) {
    results.push({
      name: 'backend_invocations',
      passed: ctx.backendInvocations === ctx.expectedBackendInvocations,
      measured: ctx.backendInvocations,
      threshold: ctx.expectedBackendInvocations,
      message: ctx.backendInvocations !== ctx.expectedBackendInvocations
        ? `Expected ${ctx.expectedBackendInvocations} backend invocations, got ${ctx.backendInvocations}`
        : undefined,
    });
  }

  if (ctx.llamaSpawns !== undefined && ctx.expectedLlamaSpawns !== undefined) {
    results.push({
      name: 'llama_spawns',
      passed: ctx.llamaSpawns === ctx.expectedLlamaSpawns,
      measured: ctx.llamaSpawns,
      threshold: ctx.expectedLlamaSpawns,
      message: ctx.llamaSpawns !== ctx.expectedLlamaSpawns
        ? `Expected ${ctx.expectedLlamaSpawns} llama-cli spawns, got ${ctx.llamaSpawns}`
        : undefined,
    });
  }

  return results;
}
