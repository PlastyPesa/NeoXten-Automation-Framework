import { resolve } from 'path';
import { generateRunId } from '../utils/run-id.js';
import { buildVerdict, type Verdict } from './verdict.js';
import { createArtifactDirs, writeJson, appendLog, type ArtifactPaths } from './artifact-manager.js';
import { evaluateGates, type GateContext } from './gate-evaluator.js';
import { executeFlow } from '../flows/executor.js';
import { parseInferenceEvidence } from '../assistant/inference-accounting.js';
import { testAssistantInApp } from '../assistant/tester.js';
import { loadConfig } from '../config/loader.js';
import type { NeoxtenConfig, GatesConfig } from '../config/schema.js';
import type { UIDriver } from '../drivers/base.js';
import { TauriAdapter } from '../adapters/tauri.js';
import { NextJsAdapter } from '../adapters/nextjs.js';
import { WebAdapter } from '../adapters/web.js';

const DEFAULT_OUT_DIR = '.neoxten-out';

function getAdapter(config: NeoxtenConfig) {
  switch (config.project.type) {
    case 'web':
      return new WebAdapter();
    case 'tauri':
      return new TauriAdapter();
    case 'nextjs':
      return new NextJsAdapter();
    default:
      throw new Error(`Unsupported project type: ${(config.project as { type: string }).type}`);
  }
}

export interface RunOptions {
  configPath: string;
  outDir?: string;
  loopUntilPass?: boolean;
  maxLoops?: number;
  retryOnFailure?: boolean;
}

export interface RunResult {
  verdict: Verdict;
  artifacts: ArtifactPaths;
}

export async function run(options: RunOptions): Promise<RunResult> {
  const config = loadConfig(options.configPath);
  const runId = generateRunId();
  const outDir = resolve(process.cwd(), options.outDir ?? DEFAULT_OUT_DIR);
  const artifacts = createArtifactDirs(outDir, runId);

  const gates = config.gates ?? {};
  const gateDefaults: GatesConfig = {
    startupMaxMs: 30000,
    spinnerMaxMs: 5000,
    noConsoleErrors: true,
    domMutationTimeoutMs: 3000,
    networkIdleTimeoutMs: 5000,
    visualRegressionThreshold: 0.01,
    assistantLatencyP95MaxMs: 10000,
    assistantReliabilityRuns: 1,
    oneSendOneInference: true,
  };
  const mergedGates = { ...gateDefaults, ...gates };

  let driver: UIDriver | null = null;
  const logExcerpts: string[] = [];
  const sourceHints: string[] = [];

  const addLog = (msg: string) => {
    logExcerpts.push(msg);
    appendLog(artifacts.consoleLog, `[${new Date().toISOString()}] ${msg}`);
  };

  try {
    const adapter = getAdapter(config);
    driver = adapter.createDriver(config);

    addLog(`Launching project (${config.project.type})...`);
    const launchStart = Date.now();
    await driver.launch();
    const startupMs = Date.now() - launchStart;
    addLog(`Launched in ${startupMs}ms`);

    const page = driver.getPage();

    if (config.flows.length > 0) {
      for (const flow of config.flows) {
        addLog(`Executing flow: ${flow.name}`);
        const flowResult = await executeFlow(driver, flow);
        if (!flowResult.passed) {
          await driver.captureScreenshot(resolve(artifacts.screenshots, `step-${flowResult.failedStepIndex}-fail.png`));
          if (driver.captureTrace) {
            await driver.captureTrace(artifacts.trace);
          }
          const verdict = buildVerdict({
            verdict: 'FAIL',
            exitCode: 1,
            runId,
            failingStage: 'ui_flow',
            failingFlow: flow.name,
            failingStep: flowResult.failedStepIndex,
            measured: { startup_ms: startupMs },
            thresholds: { startup_ms: mergedGates.startupMaxMs ?? 30000 },
            artifactPaths: {
              verdict: artifacts.verdict,
              trace: artifacts.trace,
              screenshots: [resolve(artifacts.screenshots, `step-${flowResult.failedStepIndex}-fail.png`)],
              consoleLog: artifacts.consoleLog,
            },
            logExcerpts: [...logExcerpts, flowResult.error ?? 'Flow step failed'],
            sourceHints,
            reproducibleCommand: `neoxten run --config ${options.configPath}`,
          });
          writeJson(artifacts.verdict, verdict);
          await driver.close();
          return { verdict, artifacts };
        }
      }
      addLog('All flows passed');
    }

    let assistantMetrics: { p95Ms?: number; latencySamples: number[] } | null = null;
    let inferenceAccounting: Verdict['inferenceAccounting'];
    const accounting = config.assistant?.inferenceAccounting;

    if (config.assistant?.enabled && config.project.type === 'tauri') {
      addLog('Running assistant in-app test...');
      const result = await testAssistantInApp(page, 'Hello', {
        inputSelector: '[data-testid="assistant-input"], textarea.message-input',
        sendSelector: '[data-testid="assistant-send"], button.send-btn',
        responseSelector: '[data-testid="assistant-response"], .message-assistant .message-text',
        timeoutMs: 60000,
      });

      assistantMetrics = {
        p95Ms: result.latencyMs,
        latencySamples: result.latencyMs ? [result.latencyMs] : [],
      };

      if (driver.getBackendLog) {
        const backendLog = driver.getBackendLog();
        appendLog(artifacts.backendLog, backendLog);
        const parsed = parseInferenceEvidence(backendLog);
        inferenceAccounting = {
          expectedBackendInvocations: accounting?.expectedBackendInvocations ?? 1,
          actualBackendInvocations: parsed.backendInvocations,
          expectedLlamaSpawns: accounting?.expectedLlamaSpawns ?? 1,
          actualLlamaSpawns: parsed.llamaSpawns,
          llamaCliEvidenceExcerpt: parsed.llamaEvidenceExcerpts[0],
          callCounts: parsed.callCounts,
        };
      }
    }

    if (config.assistant?.enabled && config.assistant.type === 'http' && config.assistant.endpoint) {
      const { testAssistantHttp } = await import('../assistant/tester.js');
      const metrics = await testAssistantHttp(
        config.assistant.tests ?? [],
        config.assistant.endpoint,
        config.assistant.inferenceAccounting
      );
      assistantMetrics = metrics;
      writeJson(artifacts.assistantMetrics, metrics);
    } else if (assistantMetrics) {
      writeJson(artifacts.assistantMetrics, assistantMetrics);
    }

    const consoleErrors = driver.getConsoleErrors();
    const gateContext: GateContext = {
      startupMs,
      consoleErrors: consoleErrors.length,
      assistantLatencyP95Ms: assistantMetrics?.p95Ms,
      assistantReliabilityPassed: true,
      oneSendOneInference: inferenceAccounting
        ? inferenceAccounting.actualBackendInvocations === inferenceAccounting.expectedBackendInvocations
        : undefined,
      backendInvocations: inferenceAccounting?.actualBackendInvocations,
      llamaSpawns: inferenceAccounting?.actualLlamaSpawns,
      expectedBackendInvocations: inferenceAccounting?.expectedBackendInvocations,
      expectedLlamaSpawns: inferenceAccounting?.expectedLlamaSpawns,
    };

    const gateResults = evaluateGates(mergedGates, gateContext);
    const failedGate = gateResults.find((g) => !g.passed);

    if (failedGate) {
      const measured: Record<string, number> = { startup_ms: startupMs };
      const thresholds: Record<string, number> = { startup_ms: mergedGates.startupMaxMs ?? 30000 };
      gateResults.forEach((g) => {
        measured[g.name] = g.measured;
        thresholds[g.name] = g.threshold;
      });
      await driver.captureScreenshot(resolve(artifacts.screenshots, 'gate-fail.png'));
      if (driver.captureTrace) await driver.captureTrace(artifacts.trace);
      const verdict = buildVerdict({
        verdict: 'FAIL',
        exitCode: 1,
        runId,
        failingStage: 'gate',
        failingFlow: null,
        failingStep: 0,
        measured,
        thresholds,
        artifactPaths: {
          verdict: artifacts.verdict,
          trace: artifacts.trace,
          screenshots: [resolve(artifacts.screenshots, 'gate-fail.png')],
          consoleLog: artifacts.consoleLog,
          assistantMetrics: artifacts.assistantMetrics,
        },
        logExcerpts: [...logExcerpts, failedGate.message ?? ''],
        sourceHints,
        reproducibleCommand: `neoxten run --config ${options.configPath}`,
        inferenceAccounting,
      });
      writeJson(artifacts.verdict, verdict);
      await driver.close();
      return { verdict, artifacts };
    }

    if (config.artifacts?.screenshotFinal) {
      await driver.captureScreenshot(resolve(artifacts.screenshots, 'final.png'));
    }
    if (driver.captureTrace) {
      try {
        await driver.captureTrace(artifacts.trace);
      } catch {
        /* trace may not be supported */
      }
    }

    writeJson(artifacts.performance, { startupMs });

    const verdict = buildVerdict({
      verdict: 'PASS',
      exitCode: 0,
      runId,
        failingStage: null,
        failingFlow: null,
        failingStep: 0,
        measured: { startup_ms: startupMs },
        thresholds: { startup_ms: mergedGates.startupMaxMs ?? 30000 },
        artifactPaths: {
          verdict: artifacts.verdict,
          trace: artifacts.trace,
          screenshots: [resolve(artifacts.screenshots, 'final.png')],
          consoleLog: artifacts.consoleLog,
          assistantMetrics: artifacts.assistantMetrics,
          performance: artifacts.performance,
        },
        logExcerpts,
        sourceHints,
        reproducibleCommand: `neoxten run --config ${options.configPath}`,
        inferenceAccounting,
    });
    writeJson(artifacts.verdict, verdict);
    await driver.close();
    return { verdict, artifacts };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    addLog(`Infrastructure failure: ${err.message}`);
    const verdict = buildVerdict({
      verdict: 'FAIL',
      exitCode: 2,
      runId,
      failingStage: 'launch',
      failingFlow: null,
      failingStep: 0,
      logExcerpts,
      sourceHints,
      reproducibleCommand: `neoxten run --config ${options.configPath}`,
    });
    writeJson(artifacts.verdict, verdict);
    if (driver) await driver.close().catch(() => {});
    return { verdict, artifacts };
  }
}
