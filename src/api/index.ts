/**
 * NeoXten Programmatic API — the primary interface for agent use.
 *
 * Usage:
 *
 *   import { createSession, loadConfig } from 'neoxten-automation-framework';
 *
 *   // From config
 *   const config = loadConfig('./neoxten.yaml');
 *   const session = await createSession(config, './neoxten.yaml');
 *
 *   // Or connect to running app
 *   const session = await connect('http://localhost:1420');
 *
 *   // Observe
 *   const snapshot = await session.observe();
 *   console.log(snapshot.buttons, snapshot.visibleText);
 *
 *   // Act
 *   const result = await session.act({ type: 'click', selector: 'button.submit' });
 *   console.log(result.success, result.after.visibleText);
 *
 *   // Conditional
 *   const result = await session.act({
 *     type: 'conditional',
 *     ifVisible: '.license-dialog',
 *     then: [{ type: 'click', selector: 'button:has-text("Import")' }],
 *     otherwise: [{ type: 'wait', selector: '[data-testid="assistant-view"]' }],
 *   });
 *
 *   // Evidence
 *   const evidence = session.evidence.summarize();
 *
 *   // Cleanup
 *   await session.close();
 */

import { Session } from '../session/session.js';
import { loadConfig } from '../config/loader.js';
import type { NeoxtenConfig } from '../config/schema.js';
import type { PageSnapshot } from '../observer/snapshot.js';
import type { Action, ActionResult } from '../actions/types.js';
import type { EvidenceSummary } from '../evidence/collector.js';

/* ------------------------------------------------------------------ */
/*  Factory functions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Create a session by launching from a NeoXten config.
 */
export async function createSession(
  config: NeoxtenConfig,
  configPath: string,
  options?: { screenshotDir?: string },
): Promise<Session> {
  return Session.launch(config, configPath, options);
}

/**
 * Create a session by connecting to an already-running app.
 */
export async function connect(
  url: string,
  options?: { screenshotDir?: string; headless?: boolean },
): Promise<Session> {
  return Session.connect(url, options);
}

/**
 * Create a session via Chrome DevTools Protocol.
 */
export async function connectCDP(
  cdpUrl: string,
  options?: { screenshotDir?: string },
): Promise<Session> {
  return Session.connectCDP(cdpUrl, options);
}

/* ------------------------------------------------------------------ */
/*  Re-exports for convenience                                         */
/* ------------------------------------------------------------------ */

export { Session } from '../session/session.js';
export { loadConfig } from '../config/loader.js';
export { PageObserver, type PageSnapshot, type ElementInfo } from '../observer/index.js';
export { EvidenceCollector, type EvidenceSummary, type TimelineEntry } from '../evidence/collector.js';
export { type Action, type ActionResult } from '../actions/types.js';
export { executeAction } from '../actions/execute.js';
export { buildVerdict, type Verdict } from '../core/verdict.js';
export { run, type RunOptions, type RunResult } from '../core/orchestrator.js';
export type { NeoxtenConfig } from '../config/schema.js';
