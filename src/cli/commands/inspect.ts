/**
 * neoxten inspect — launch (or connect to) an app and report what's on screen.
 *
 * Output: JSON describing visible elements, text, state indicators,
 * console errors, and a screenshot path. This gives the agent "eyes"
 * without running any flows.
 */
import { resolve } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { Session } from '../../session/session.js';
import { loadConfig } from '../../config/loader.js';
import { generateRunId } from '../../utils/run-id.js';

export interface InspectOptions {
  config?: string;
  url?: string;
  outDir?: string;
  wait?: string;
}

export async function inspectCommand(opts: InspectOptions): Promise<void> {
  const runId = generateRunId();
  const outDir = resolve(process.cwd(), opts.outDir ?? '.neoxten-out');
  const screenshotDir = resolve(outDir, runId, 'screenshots');
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

  let session: Session;

  try {
    if (opts.url) {
      /* Connect to an already-running app */
      session = await Session.connect(opts.url, { screenshotDir });
    } else {
      /* Launch from config */
      const configPath = opts.config ?? './neoxten.yaml';
      const config = loadConfig(configPath);
      session = await Session.launch(config, configPath, { screenshotDir });
    }

    /* Wait for the page to settle before observing.
       Default: poll until visible text appears or 5s, whichever comes first. */
    const maxSettleMs = parseInt(opts.wait ?? '5000', 10);
    const settleStart = Date.now();
    let snapshot = await session.observe();

    while (
      snapshot.visibleText.trim().length === 0 &&
      Date.now() - settleStart < maxSettleMs
    ) {
      await session.getPage().waitForTimeout(300);
      snapshot = await session.observe();
    }

    /* Screenshot */
    const screenshotPath = await session.screenshot('inspect');

    /* Infer screen type from content */
    const screenType = inferScreenType(snapshot.visibleText, snapshot);

    /* Build report */
    const report = {
      runId,
      screen: screenType,
      url: snapshot.url,
      title: snapshot.title,
      viewport: snapshot.viewportSize,
      visibleText: snapshot.visibleText.slice(0, 2000),
      buttons: snapshot.buttons.map((b) => b.text).filter(Boolean),
      inputs: snapshot.inputs.map((i) => ({
        type: i.inputType ?? i.tag,
        id: i.id ?? i.testId,
        value: i.value,
      })),
      headings: snapshot.headings.map((h) => h.text),
      testIds: Object.keys(snapshot.testIds),
      hasSpinner: snapshot.hasSpinner,
      hasModal: snapshot.hasModal,
      hasErrorDialog: snapshot.hasErrorDialog,
      consoleErrors: snapshot.consoleErrors,
      networkIdle: snapshot.networkIdle,
      screenshotPath,
      evidence: session.evidence.summarize().timeline,
    };

    console.log(JSON.stringify(report, null, 2));

    await session.close();
    process.exit(0);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const errorReport = {
      runId,
      error: err.message,
      screen: 'error',
    };
    console.log(JSON.stringify(errorReport, null, 2));
    process.exit(2);
  }
}

/* ------------------------------------------------------------------ */
/*  Screen type inference                                              */
/* ------------------------------------------------------------------ */

function inferScreenType(
  text: string,
  snapshot: { hasSpinner: boolean; hasModal: boolean; hasErrorDialog: boolean; testIds: Record<string, unknown> },
): string {
  const lower = text.toLowerCase();

  if (lower.includes('license') || lower.includes('activate')) return 'license_activation';
  if (lower.includes('onboarding') || lower.includes('welcome') && lower.includes('get started')) return 'onboarding';
  if (lower.includes('unlock') || lower.includes('vault') && lower.includes('pin')) return 'vault_lock';
  if (snapshot.testIds['assistant-view'] || lower.includes('assistant')) return 'assistant';
  if (snapshot.hasSpinner) return 'loading';
  if (snapshot.hasErrorDialog) return 'error';
  if (snapshot.hasModal) return 'modal';
  if (text.trim().length === 0) return 'blank';

  return 'unknown';
}
