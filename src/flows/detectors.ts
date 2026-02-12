import type { Page } from 'playwright';

export interface SpinnerDetectionResult {
  detected: boolean;
  durationMs: number;
  message?: string;
}

export interface HangDetectionConfig {
  spinnerSelector: string;
  spinnerMaxMs: number;
  domMutationTimeoutMs: number;
  networkIdleTimeoutMs: number;
}

/**
 * Check if spinner element is visible for too long.
 * Call periodically during flow execution.
 */
export async function checkSpinnerVisibility(
  page: Page,
  selector: string,
  maxMs: number,
  visibleSince: number | null
): Promise<{ detected: boolean; durationMs: number; newVisibleSince: number | null }> {
  try {
    const el = page.locator(selector).first();
    const count = await el.count();
    const visible = count > 0 && (await el.isVisible());
    const now = Date.now();

    if (visible) {
      const since = visibleSince ?? now;
      const duration = now - since;
      if (duration >= maxMs) {
        return { detected: true, durationMs: duration, newVisibleSince: since };
      }
      return { detected: false, durationMs: 0, newVisibleSince: since };
    }
    return { detected: false, durationMs: 0, newVisibleSince: null };
  } catch {
    return { detected: false, durationMs: 0, newVisibleSince: visibleSince };
  }
}

/**
 * Poll for spinner/hang during a bounded wait.
 * Combines DOM visibility + no network progress.
 */
export async function waitForSpinnerOrHang(
  page: Page,
  config: HangDetectionConfig,
  signal?: { aborted: boolean }
): Promise<SpinnerDetectionResult> {
  const start = Date.now();
  let lastNetwork = Date.now();
  let spinnerVisibleSince: number | null = null;

  page.on('request', () => { lastNetwork = Date.now(); });
  page.on('response', () => { lastNetwork = Date.now(); });

  const maxWait = Math.max(config.spinnerMaxMs, config.domMutationTimeoutMs, config.networkIdleTimeoutMs) * 2;
  const checkInterval = 300;

  while (Date.now() - start < maxWait) {
    if (signal?.aborted) break;

    const result = await checkSpinnerVisibility(
      page,
      config.spinnerSelector,
      config.spinnerMaxMs,
      spinnerVisibleSince
    );
    spinnerVisibleSince = result.newVisibleSince;

    if (result.detected) {
      return {
        detected: true,
        durationMs: result.durationMs,
        message: `Spinner visible for ${result.durationMs}ms (max ${config.spinnerMaxMs}ms)`,
      };
    }

    const noNetwork = Date.now() - lastNetwork > config.networkIdleTimeoutMs;
    if (noNetwork && Date.now() - start > config.domMutationTimeoutMs) {
      return {
        detected: true,
        durationMs: Date.now() - start,
        message: `Stall: no network progress for ${config.networkIdleTimeoutMs}ms`,
      };
    }

    await new Promise((r) => setTimeout(r, checkInterval));
  }

  return { detected: false, durationMs: 0 };
}
