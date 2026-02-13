/**
 * DOM Snapshot — structured extraction of what is visible on screen.
 *
 * Runs page.evaluate() to catalog interactive elements, visible text,
 * state indicators (spinners, modals, errors), and data-testid elements.
 * Designed to be cheap enough to call before/after every action.
 */
import type { Page } from 'playwright';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ElementInfo {
  tag: string;
  id?: string;
  testId?: string;
  classes: string[];
  text: string;
  visible: boolean;
  interactable: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  role?: string;
  /** Only present for <input> */
  inputType?: string;
  /** Current value for inputs/textareas/selects */
  value?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  timestamp: string;
  viewportSize: { width: number; height: number };

  /* Categorised interactive elements */
  buttons: ElementInfo[];
  inputs: ElementInfo[];
  links: ElementInfo[];
  headings: ElementInfo[];

  /* data-testid map */
  testIds: Record<string, ElementInfo>;

  /* Full visible text (truncated to 5 000 chars) */
  visibleText: string;

  /* State indicators */
  hasSpinner: boolean;
  hasModal: boolean;
  hasErrorDialog: boolean;

  /* Console / network state (injected by PageObserver) */
  consoleErrors: string[];
  pendingRequests: number;
  networkIdle: boolean;
}

/* ------------------------------------------------------------------ */
/*  Core snapshot function                                             */
/* ------------------------------------------------------------------ */

export async function takeSnapshot(
  page: Page,
  extra?: { consoleErrors?: string[]; pendingRequests?: number },
): Promise<PageSnapshot> {
  const [url, title, viewport] = await Promise.all([
    Promise.resolve(page.url()),
    page.title().catch(() => ''),
    Promise.resolve(page.viewportSize() ?? { width: 0, height: 0 }),
  ]);

  const domData = await page.evaluate(() => {
    /* ---- helpers (run inside browser context) ---- */
    const isVisible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    };

    const toInfo = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const isInput = el instanceof HTMLInputElement;
      const isTextarea = el instanceof HTMLTextAreaElement;
      const isSelect = el instanceof HTMLSelectElement;
      return {
        tag,
        id: el.id || undefined,
        testId: el.getAttribute('data-testid') || undefined,
        classes: Array.from(el.classList),
        text: (el.textContent || '').trim().slice(0, 200),
        visible: isVisible(el),
        interactable:
          el instanceof HTMLButtonElement ||
          isInput ||
          isTextarea ||
          isSelect ||
          el instanceof HTMLAnchorElement ||
          el.getAttribute('role') === 'button' ||
          el.getAttribute('tabindex') !== null,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        role: el.getAttribute('role') || undefined,
        inputType: isInput ? el.type : undefined,
        value: isInput ? el.value : isTextarea ? (el as HTMLTextAreaElement).value : isSelect ? (el as HTMLSelectElement).value : undefined,
      };
    };

    /* ---- collect categorised elements ---- */
    const visible = (sel: string) =>
      Array.from(document.querySelectorAll(sel)).filter(isVisible).map(toInfo);

    const buttons = visible('button, [role="button"], input[type="submit"], input[type="button"]');
    const inputs = visible('input:not([type="hidden"]), textarea, select');
    const links = visible('a[href]');
    const headings = visible('h1, h2, h3, h4, h5, h6');

    /* ---- test-id map ---- */
    const testIds: Record<string, ReturnType<typeof toInfo>> = {};
    document.querySelectorAll('[data-testid]').forEach((el) => {
      const tid = el.getAttribute('data-testid');
      if (tid) testIds[tid] = toInfo(el);
    });

    /* ---- state indicators ---- */
    const spinnerSels =
      '.loading-spinner, .spinner, [class*="loading"], [class*="spinner"], [role="progressbar"]';
    const modalSels =
      '[role="dialog"], .modal, .dialog, [class*="modal"], [class*="dialog"]';
    const errorSels =
      '.error-dialog, [role="alert"], .error-banner, [class*="error-alert"]';

    const hasSpinner = !!document.querySelector(spinnerSels);
    const hasModal = !!document.querySelector(modalSels);
    const hasErrorDialog = !!document.querySelector(errorSels);

    /* ---- visible text ---- */
    const visibleText = (document.body?.innerText ?? '').trim().slice(0, 5000);

    return {
      buttons,
      inputs,
      links,
      headings,
      testIds,
      hasSpinner,
      hasModal,
      hasErrorDialog,
      visibleText,
    };
  }).catch(() => ({
    buttons: [] as ReturnType<typeof Array.from>,
    inputs: [] as ReturnType<typeof Array.from>,
    links: [] as ReturnType<typeof Array.from>,
    headings: [] as ReturnType<typeof Array.from>,
    testIds: {} as Record<string, unknown>,
    hasSpinner: false,
    hasModal: false,
    hasErrorDialog: false,
    visibleText: '',
  }));

  return {
    url,
    title,
    timestamp: new Date().toISOString(),
    viewportSize: viewport,
    buttons: domData.buttons as ElementInfo[],
    inputs: domData.inputs as ElementInfo[],
    links: domData.links as ElementInfo[],
    headings: domData.headings as ElementInfo[],
    testIds: domData.testIds as Record<string, ElementInfo>,
    visibleText: domData.visibleText as string,
    hasSpinner: domData.hasSpinner as boolean,
    hasModal: domData.hasModal as boolean,
    hasErrorDialog: domData.hasErrorDialog as boolean,
    consoleErrors: extra?.consoleErrors ?? [],
    pendingRequests: extra?.pendingRequests ?? 0,
    networkIdle: (extra?.pendingRequests ?? 0) === 0,
  };
}
