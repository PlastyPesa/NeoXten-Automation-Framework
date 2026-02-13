/**
 * Action executor — runs a single action against a Playwright page
 * and returns an ActionResult with before/after snapshots.
 *
 * This is the core of the observation–action loop:
 *   before = observe()
 *   perform action
 *   after = observe()
 *   return { before, after, success, error, durationMs }
 */
import type { Page } from 'playwright';
import { resolve } from 'path';
import type { PageObserver } from '../observer/index.js';
import type {
  Action,
  ActionResult,
  ClickAction,
  TypeAction,
  NavigateAction,
  WaitAction,
  AssertAction,
  ScrollAction,
  ScreenshotAction,
  ConditionalAction,
} from './types.js';

/* ------------------------------------------------------------------ */
/*  Main executor                                                      */
/* ------------------------------------------------------------------ */

export async function executeAction(
  page: Page,
  observer: PageObserver,
  action: Action,
  screenshotDir?: string,
): Promise<ActionResult> {
  const start = Date.now();
  const before = await observer.observe();

  try {
    const error = await performAction(page, observer, action, screenshotDir);
    const after = await observer.observe();

    if (error) {
      return {
        action,
        success: false,
        error,
        before,
        after,
        durationMs: Date.now() - start,
      };
    }

    return {
      action,
      success: true,
      before,
      after,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const after = await observer.observe().catch(() => before);
    return {
      action,
      success: false,
      error: e instanceof Error ? e.message : String(e),
      before,
      after,
      durationMs: Date.now() - start,
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Action dispatch                                                    */
/* ------------------------------------------------------------------ */

async function performAction(
  page: Page,
  observer: PageObserver,
  action: Action,
  screenshotDir?: string,
): Promise<string | undefined> {
  switch (action.type) {
    case 'click':
      return performClick(page, action);
    case 'type':
      return performType(page, action);
    case 'navigate':
      return performNavigate(page, action);
    case 'wait':
      return performWait(page, action);
    case 'assert':
      return performAssert(page, action);
    case 'scroll':
      return performScroll(page, action);
    case 'screenshot':
      return performScreenshot(page, action, screenshotDir);
    case 'conditional':
      return performConditional(page, observer, action, screenshotDir);
    default:
      return `Unknown action type: ${(action as Action).type}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Individual action implementations                                  */
/* ------------------------------------------------------------------ */

async function performClick(page: Page, action: ClickAction): Promise<string | undefined> {
  const timeout = action.timeout ?? 10000;
  const loc = page.locator(action.selector).first();
  await loc.waitFor({ state: 'visible', timeout });
  await loc.click({ timeout, force: action.force });
  return undefined;
}

async function performType(page: Page, action: TypeAction): Promise<string | undefined> {
  const timeout = action.timeout ?? 10000;
  const loc = page.locator(action.selector).first();
  await loc.waitFor({ state: 'visible', timeout });
  if (action.append) {
    await loc.pressSequentially(action.text, { delay: 30 });
  } else {
    await loc.fill(action.text, { timeout });
  }
  return undefined;
}

async function performNavigate(page: Page, action: NavigateAction): Promise<string | undefined> {
  const timeout = action.timeout ?? 30000;
  await page.goto(action.url, {
    waitUntil: action.waitUntil ?? 'domcontentloaded',
    timeout,
  });
  return undefined;
}

async function performWait(page: Page, action: WaitAction): Promise<string | undefined> {
  const timeout = action.timeout ?? 30000;

  if (action.selector) {
    await page.locator(action.selector).first().waitFor({ state: 'visible', timeout });
    return undefined;
  }

  if (action.text) {
    await page.locator(`text=${action.text}`).first().waitFor({ state: 'visible', timeout });
    return undefined;
  }

  // Fixed delay
  await page.waitForTimeout(action.ms ?? 1000);
  return undefined;
}

async function performAssert(page: Page, action: AssertAction): Promise<string | undefined> {
  const timeout = action.timeout ?? 10000;
  const loc = page.locator(action.selector).first();

  switch (action.assertType) {
    case 'visible':
      await loc.waitFor({ state: 'visible', timeout });
      return undefined;

    case 'hidden':
      await loc.waitFor({ state: 'hidden', timeout });
      return undefined;

    case 'exists': {
      const count = await loc.count();
      if (count === 0) return `Element not found: ${action.selector}`;
      return undefined;
    }

    case 'contains': {
      await loc.waitFor({ state: 'visible', timeout });
      const text = await loc.textContent();
      if (!text?.includes(action.text ?? '')) {
        return `Expected "${action.selector}" to contain "${action.text}", got: "${text?.slice(0, 100)}"`;
      }
      return undefined;
    }

    case 'not-contains': {
      await loc.waitFor({ state: 'visible', timeout });
      const text = await loc.textContent();
      if (text?.includes(action.text ?? '')) {
        return `Expected "${action.selector}" NOT to contain "${action.text}"`;
      }
      return undefined;
    }

    default:
      return `Unknown assert type: ${action.assertType}`;
  }
}

async function performScroll(page: Page, action: ScrollAction): Promise<string | undefined> {
  if (action.selector) {
    await page.locator(action.selector).first().scrollIntoViewIfNeeded();
    return undefined;
  }
  const pixels = action.pixels ?? 300;
  const delta = action.direction === 'up' ? -pixels : pixels;
  await page.mouse.wheel(0, delta);
  return undefined;
}

async function performScreenshot(
  page: Page,
  action: ScreenshotAction,
  screenshotDir?: string,
): Promise<string | undefined> {
  const dir = screenshotDir ?? '.';
  const label = action.label ?? `screenshot-${Date.now()}`;
  const path = resolve(dir, `${label}.png`);
  await page.screenshot({ path, fullPage: true });
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Conditional action                                                 */
/* ------------------------------------------------------------------ */

async function performConditional(
  page: Page,
  observer: PageObserver,
  action: ConditionalAction,
  screenshotDir?: string,
): Promise<string | undefined> {
  const timeout = action.timeout ?? 3000;
  let isVisible = false;

  try {
    await page.locator(action.ifVisible).first().waitFor({ state: 'visible', timeout });
    isVisible = true;
  } catch {
    isVisible = false;
  }

  const branch = isVisible ? action.then : (action.otherwise ?? []);
  for (const subAction of branch) {
    const result = await executeAction(page, observer, subAction, screenshotDir);
    if (!result.success) {
      return result.error;
    }
  }
  return undefined;
}
