import type { Locator, Page } from 'playwright';

export interface HumanInputLike {
  humanize?: boolean;
  preDelayMs?: number;
  postDelayMs?: number;
  typingDelayMs?: number;
  typingVarianceMs?: number;
  mouseMoveSteps?: number;
  hoverBeforeClickMs?: number;
  scrollStepPx?: number;
  clickDelayMs?: number;
}

interface ResolvedHumanInputOptions {
  humanize: boolean;
  preDelayMs: number;
  postDelayMs: number;
  typingDelayMs: number;
  typingVarianceMs: number;
  mouseMoveSteps: number;
  hoverBeforeClickMs: number;
  scrollStepPx: number;
  clickDelayMs: number;
}

const DEFAULTS: ResolvedHumanInputOptions = {
  humanize: false,
  preDelayMs: 120,
  postDelayMs: 180,
  typingDelayMs: 55,
  typingVarianceMs: 30,
  mouseMoveSteps: 12,
  hoverBeforeClickMs: 90,
  scrollStepPx: 180,
  clickDelayMs: 70,
};

export function resolveHumanInputOptions(
  input: HumanInputLike | undefined,
): ResolvedHumanInputOptions {
  const envHumanize = process.env.NEOXTEN_HUMAN_MODE === '1';
  return {
    humanize: input?.humanize ?? envHumanize ?? DEFAULTS.humanize,
    preDelayMs: input?.preDelayMs ?? DEFAULTS.preDelayMs,
    postDelayMs: input?.postDelayMs ?? DEFAULTS.postDelayMs,
    typingDelayMs: input?.typingDelayMs ?? DEFAULTS.typingDelayMs,
    typingVarianceMs: input?.typingVarianceMs ?? DEFAULTS.typingVarianceMs,
    mouseMoveSteps: input?.mouseMoveSteps ?? DEFAULTS.mouseMoveSteps,
    hoverBeforeClickMs: input?.hoverBeforeClickMs ?? DEFAULTS.hoverBeforeClickMs,
    scrollStepPx: input?.scrollStepPx ?? DEFAULTS.scrollStepPx,
    clickDelayMs: input?.clickDelayMs ?? DEFAULTS.clickDelayMs,
  };
}

export function randomize(base: number, variance = 0): number {
  if (variance <= 0) return Math.max(0, Math.round(base));
  const spread = Math.floor(Math.random() * (variance * 2 + 1)) - variance;
  return Math.max(0, Math.round(base + spread));
}

export async function pause(
  page: Page,
  ms: number,
  variance = 0,
): Promise<void> {
  const delay = randomize(ms, variance);
  if (delay > 0) {
    await page.waitForTimeout(delay);
  }
}

async function moveMouseToLocator(
  page: Page,
  locator: Locator,
  options: ResolvedHumanInputOptions,
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) return;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y, {
    steps: Math.max(2, options.mouseMoveSteps),
  });
}

export async function performClick(
  page: Page,
  locator: Locator,
  optionsLike: HumanInputLike | undefined,
  clickOptions: { timeout?: number; force?: boolean } = {},
): Promise<void> {
  const options = resolveHumanInputOptions(optionsLike);
  const timeout = clickOptions.timeout ?? 10000;
  await locator.waitFor({ state: 'visible', timeout });
  await locator.scrollIntoViewIfNeeded({ timeout });

  if (options.humanize) {
    await pause(page, options.preDelayMs, 40);
    await moveMouseToLocator(page, locator, options);
    await locator.hover({ timeout });
    await pause(page, options.hoverBeforeClickMs, 25);
    await locator.click({
      timeout,
      force: clickOptions.force,
      delay: randomize(options.clickDelayMs, 25),
    });
    await pause(page, options.postDelayMs, 60);
    return;
  }

  await locator.click({
    timeout,
    force: clickOptions.force,
  });
}

export async function performType(
  page: Page,
  locator: Locator,
  text: string,
  optionsLike: HumanInputLike | undefined,
  actionOptions: { timeout?: number; append?: boolean } = {},
): Promise<void> {
  const options = resolveHumanInputOptions(optionsLike);
  const timeout = actionOptions.timeout ?? 10000;
  await locator.waitFor({ state: 'visible', timeout });
  await locator.scrollIntoViewIfNeeded({ timeout });

  if (!options.humanize) {
    if (actionOptions.append) {
      await locator.pressSequentially(text, { delay: 30 });
    } else {
      await locator.fill(text, { timeout });
    }
    return;
  }

  await pause(page, options.preDelayMs, 30);
  await moveMouseToLocator(page, locator, options);
  await locator.click({ timeout, delay: randomize(options.clickDelayMs, 20) });

  if (!actionOptions.append) {
    await locator.fill('', { timeout });
  }

  for (const char of text) {
    await page.keyboard.type(char, { delay: 0 });
    await pause(page, options.typingDelayMs, options.typingVarianceMs);
  }

  await pause(page, options.postDelayMs, 40);
}

export async function performScroll(
  page: Page,
  selector: string | undefined,
  direction: 'up' | 'down',
  pixels: number,
  optionsLike: HumanInputLike | undefined,
): Promise<void> {
  const options = resolveHumanInputOptions(optionsLike);
  if (selector) {
    const locator = page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded();
    if (options.humanize) {
      await pause(page, options.postDelayMs, 40);
    }
    return;
  }

  const target = Math.abs(pixels);
  const stepPx = Math.max(40, options.scrollStepPx);
  const sign = direction === 'up' ? -1 : 1;

  if (!options.humanize) {
    await page.mouse.wheel(0, sign * target);
    await page.waitForTimeout(250);
    return;
  }

  let travelled = 0;
  while (travelled < target) {
    const delta = Math.min(stepPx, target - travelled);
    await page.mouse.wheel(0, sign * delta);
    travelled += delta;
    await pause(page, 110, 35);
  }
  await pause(page, options.postDelayMs, 40);
}
