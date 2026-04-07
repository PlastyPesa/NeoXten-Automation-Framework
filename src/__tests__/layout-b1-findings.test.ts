/**
 * B.1 layout findings: threshold behavior from synthetic snapshots.
 */
import { buildLayoutFindingsFromSnapshots } from '../operator/findings/layout-b1.js';
import type { PageSnapshot } from '../observer/snapshot.js';
import { emptyLayoutMetrics } from '../observer/layout-metrics-types.js';

function baseSnap(over: Partial<PageSnapshot> = {}): PageSnapshot {
  const { layoutMetrics: lmOver, ...rest } = over;
  const m = { ...emptyLayoutMetrics(), ...lmOver };
  return {
    url: 'https://example.test/page',
    title: 't',
    timestamp: new Date().toISOString(),
    viewportSize: { width: 800, height: 600 },
    buttons: [],
    inputs: [],
    links: [],
    headings: [],
    testIds: {},
    visibleText: '',
    hasSpinner: false,
    hasModal: false,
    hasErrorDialog: false,
    consoleErrors: [],
    pendingRequests: 0,
    networkIdle: true,
    layoutMetrics: m,
    ...rest,
  };
}

void (async () => {
  const empty = buildLayoutFindingsFromSnapshots([]);
  if (empty.length !== 0) throw new Error('expected no findings for empty snapshots');

  const clip = buildLayoutFindingsFromSnapshots([
    baseSnap({
      layoutMetrics: {
        ...emptyLayoutMetrics(),
        rootOverflowXHiddenClipRisk: true,
        horizontalOverflowPx: 40,
      },
    }),
  ]);
  if (!clip.some((f) => f.oracle_id === 'neo.b1.clip.horizontal_overflow_hidden')) {
    throw new Error('expected horizontal clip finding');
  }

  const overlap = buildLayoutFindingsFromSnapshots([
    baseSnap({
      layoutMetrics: {
        ...emptyLayoutMetrics(),
        overlapPairCount: 2,
        maxInteractableOverlapRatio: 0.2,
      },
    }),
  ]);
  if (!overlap.some((f) => f.oracle_id === 'neo.b1.overlap.interactables')) {
    throw new Error('expected overlap finding');
  }

  const es = buildLayoutFindingsFromSnapshots([
    baseSnap({ hasSpinner: true, hasErrorDialog: true }),
  ]);
  if (!es.some((f) => f.oracle_id === 'neo.b1.state.error_and_spinner')) {
    throw new Error('expected error+spinner finding');
  }

  console.log('layout-b1-findings.test: OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
