import type { Page } from 'playwright';
import type { AssistantConfig } from '../config/schema.js';
import { callAssistant } from './http-adapter.js';

export interface AssistantTestResult {
  name: string;
  passed: boolean;
  error?: string;
  latencyMs?: number;
  tokensUsed?: number;
  contentExcerpt?: string;
  oneSendOneInference?: boolean;
  backendInvocations?: number;
  llamaSpawns?: number;
  llamaEvidenceExcerpt?: string;
}

export interface AssistantMetrics {
  coldStartMs?: number;
  warmStartMs?: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
  throughputTokensPerSec?: number;
  latencySamples: number[];
  testResults: AssistantTestResult[];
}

/**
 * Test assistant via HTTP endpoint.
 */
export async function testAssistantHttp(
  config: NonNullable<AssistantConfig['tests']>,
  endpoint: string,
  inferenceAccounting?: AssistantConfig['inferenceAccounting']
): Promise<AssistantMetrics> {
  const latencySamples: number[] = [];
  const testResults: AssistantTestResult[] = [];

  for (const test of config) {
    try {
      const result = await callAssistant(endpoint, test.prompt, {
        timeoutMs: test.maxLatencyMs ?? 60000,
      });
      latencySamples.push(result.latencyMs);

      let passed = true;
      let error: string | undefined;

      if (test.expectContains && !result.content?.toLowerCase().includes(test.expectContains.toLowerCase())) {
        passed = false;
        error = `Expected response to contain "${test.expectContains}"`;
      }
      if (test.maxLatencyMs && result.latencyMs > test.maxLatencyMs) {
        passed = false;
        error = `Latency ${result.latencyMs}ms exceeded max ${test.maxLatencyMs}ms`;
      }
      if (test.expectTokens && result.tokensUsed !== undefined) {
        const [min, max] = test.expectTokens;
        if (result.tokensUsed < min || result.tokensUsed > max) {
          passed = false;
          error = `Expected tokens in [${min},${max}], got ${result.tokensUsed}`;
        }
      }

      testResults.push({
        name: test.name,
        passed,
        latencyMs: result.latencyMs,
        tokensUsed: result.tokensUsed,
        contentExcerpt: result.content?.slice(0, 200),
        error: passed ? undefined : error,
      });
    } catch (e) {
      testResults.push({
        name: test.name,
        passed: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const sorted = [...latencySamples].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];

  return {
    coldStartMs: latencySamples[0],
    warmStartMs: latencySamples[1],
    p50Ms: p50,
    p95Ms: p95,
    p99Ms: p99,
    latencySamples,
    testResults,
  };
}

/**
 * Test in-app assistant via UI (type prompt, click send, wait for response).
 */
export async function testAssistantInApp(
  page: Page,
  prompt: string,
  options: {
    inputSelector: string;
    sendSelector: string;
    responseSelector: string;
    timeoutMs?: number;
  }
): Promise<AssistantTestResult> {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? 60000;

  try {
    await page.locator(options.inputSelector).first().waitFor({ state: 'visible', timeout: 15000 });
    await page.locator(options.sendSelector).first().waitFor({ state: 'visible', timeout: 5000 });
    await new Promise((r) => setTimeout(r, 3000));
    await page.locator(options.inputSelector).first().fill(prompt, { timeout: 5000 });
    await page.locator(options.sendSelector).first().click({ timeout: 5000, force: true });
    await page.locator(options.responseSelector).last().waitFor({ state: 'visible', timeout: timeoutMs });

    const latencyMs = Date.now() - start;
    const content = await page.locator(options.responseSelector).last().textContent();

    return {
      name: 'in_app_prompt',
      passed: true,
      latencyMs,
      contentExcerpt: content?.slice(0, 200),
    };
  } catch (e) {
    return {
      name: 'in_app_prompt',
      passed: false,
      error: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - start,
    };
  }
}
