/**
 * Plan §2 B.1 — layout / UI polish findings from measured PageSnapshot.layoutMetrics.
 * All items are heuristic unless paired with baselines elsewhere; confidence explicit.
 */
import { randomUUID, createHash } from 'crypto';
import { FindingSchema, type Finding, type FindingDraft } from './schema.js';
import type { PageSnapshot } from '../../observer/snapshot.js';
import { emptyLayoutMetrics, type PageLayoutMetrics } from '../../observer/layout-metrics-types.js';

const GRID_OFF_BLOCKS_THRESHOLD = 4;
const OVERLAP_RATIO_REPORT = 0.13;

function fpB1(signal: string, url: string, snapshotIndex: number): string {
  const h = createHash('sha256');
  h.update('neo.b1');
  h.update(signal);
  h.update(url);
  h.update(String(snapshotIndex));
  return `neo-fp-${h.digest('hex').slice(0, 24)}`;
}

function metricsOf(s: PageSnapshot): PageLayoutMetrics {
  return s.layoutMetrics ?? emptyLayoutMetrics();
}

function push(
  drafts: FindingDraft[],
  draft: Omit<FindingDraft, 'id'> & { id?: string },
): void {
  drafts.push({ ...draft, id: draft.id ?? randomUUID() });
}

/**
 * Emit findings for each observation snapshot that crosses B.1 thresholds.
 */
export function buildLayoutFindingsFromSnapshots(snapshots: PageSnapshot[]): Finding[] {
  const drafts: FindingDraft[] = [];

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i]!;
    const m = metricsOf(s);
    const url = s.url;
    const idxLabel = `snapshot #${i} (${url})`;

    if (m.rootOverflowXHiddenClipRisk) {
      push(drafts, {
        kind: 'visual',
        origin: 'suite',
        severity: 'moderate',
        title: 'Possible horizontal clip: wide content with overflow hidden',
        detail: `${idxLabel}: document scrollWidth exceeds viewport but root hides overflow-x — content may be clipped without scroll.`,
        evidence_refs: [
          {
            numeric_metrics: {
              horizontal_overflow_px: m.horizontalOverflowPx,
              scroll_overflow_x: m.scrollOverflowX,
              snapshot_index: i,
            },
          },
        ],
        confidence: 'medium',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.clip.horizontal_overflow_hidden',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('clip-h', url, i),
      });
    }

    if (m.bodyVerticalClipRisk) {
      push(drafts, {
        kind: 'visual',
        origin: 'suite',
        severity: 'moderate',
        title: 'Possible vertical clip: tall document with body overflow hidden',
        detail: `${idxLabel}: body uses overflow hidden while document is taller than viewport.`,
        evidence_refs: [
          {
            numeric_metrics: {
              scroll_overflow_y: m.scrollOverflowY,
              snapshot_index: i,
            },
          },
        ],
        confidence: 'medium',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.clip.body_overflow_hidden',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('clip-v', url, i),
      });
    }

    if (m.overlapPairCount > 0 && m.maxInteractableOverlapRatio >= OVERLAP_RATIO_REPORT) {
      push(drafts, {
        kind: 'visual',
        origin: 'suite',
        severity: 'moderate',
        title: 'Overlapping interactive controls in viewport',
        detail: `${idxLabel}: ${m.overlapPairCount} pair(s) with ≥${Math.round(OVERLAP_RATIO_REPORT * 100)}% overlap by area — possible click/tap collision.`,
        evidence_refs: [
          {
            numeric_metrics: {
              overlap_pair_count: m.overlapPairCount,
              max_overlap_ratio: Math.round(m.maxInteractableOverlapRatio * 1000) / 1000,
              snapshot_index: i,
            },
          },
        ],
        confidence: 'medium',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.overlap.interactables',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('overlap', url, i),
      });
    }

    if (m.gridMisalignedBlockCount >= GRID_OFF_BLOCKS_THRESHOLD) {
      push(drafts, {
        kind: 'ux',
        origin: 'suite',
        severity: 'minor',
        title: 'Many major blocks off 8px alignment grid',
        detail: `${idxLabel}: ${m.gridMisalignedBlockCount} block edges &gt;2px off 8px grid (heuristic). Samples (px): ${m.gridDeviationSamplesPx.slice(0, 6).join(', ')}`,
        evidence_refs: [
          {
            numeric_metrics: {
              misaligned_blocks: m.gridMisalignedBlockCount,
              samples: m.gridDeviationSamplesPx.slice(0, 8).join(','),
              snapshot_index: i,
            },
          },
        ],
        confidence: 'low',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.spacing.grid_deviation',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('grid', url, i),
      });
    }

    if (m.multipleHeavyH1) {
      push(drafts, {
        kind: 'ux',
        origin: 'suite',
        severity: 'moderate',
        title: 'Multiple prominent H1-level headings',
        detail: `${idxLabel}: ${m.visibleH1Count} visible H1 elements with large font — competing visual hierarchy.`,
        evidence_refs: [
          {
            numeric_metrics: {
              h1_count: m.visibleH1Count,
              snapshot_index: i,
            },
          },
        ],
        confidence: 'medium',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.hierarchy.multi_h1',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('h1multi', url, i),
      });
    }

    if (m.hierarchyLevelInversion) {
      push(drafts, {
        kind: 'ux',
        origin: 'suite',
        severity: 'moderate',
        title: 'Heading size hierarchy looks inverted (H3 ≥ H2)',
        detail: `${idxLabel}: largest measured H3 font-size meets or exceeds smallest H2 — section titles may read weaker than subsections.`,
        evidence_refs: [{ numeric_metrics: { snapshot_index: i } }],
        confidence: 'medium',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.hierarchy.inversion',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('hinv', url, i),
      });
    }

    if (m.weakPrimaryVsSecondary) {
      push(drafts, {
        kind: 'ux',
        origin: 'suite',
        severity: 'moderate',
        title: 'Primary action visually weaker than secondary in fold',
        detail: `${idxLabel}: submit/primary-styled control area much smaller than largest non-primary button in first screenful.`,
        evidence_refs: [
          {
            numeric_metrics: {
              viewport_actionables: m.viewportActionableCount,
              snapshot_index: i,
            },
          },
        ],
        confidence: 'medium',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.cta.weak_primary',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('ctaw', url, i),
      });
    }

    if (m.noPrimaryControlInFold && m.viewportActionableCount >= 2) {
      push(drafts, {
        kind: 'ux',
        origin: 'suite',
        severity: 'moderate',
        title: 'No obvious primary control in first screenful',
        detail: `${idxLabel}: several actions visible but none matched primary heuristics (submit / data-primary / primary class).`,
        evidence_refs: [
          {
            numeric_metrics: {
              viewport_actionables: m.viewportActionableCount,
              snapshot_index: i,
            },
          },
        ],
        confidence: 'low',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.cta.no_primary_fold',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('ctan', url, i),
      });
    }

    if (m.competingCtaCount >= 2) {
      push(drafts, {
        kind: 'ux',
        origin: 'suite',
        severity: 'minor',
        title: 'Competing call-to-action buttons (similar visual weight)',
        detail: `${idxLabel}: two or more large in-fold buttons with similar area — users may hesitate on the intended action.`,
        evidence_refs: [{ numeric_metrics: { snapshot_index: i } }],
        confidence: 'low',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.cta.competing',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('ctac', url, i),
      });
    }

    if (m.genericErrorBannerText) {
      push(drafts, {
        kind: 'ux',
        origin: 'suite',
        severity: 'moderate',
        title: 'Generic error banner text',
        detail: `${idxLabel}: alert/error region shows a vague message (“Error”, “Something went wrong”, …) — low diagnostic value for users.`,
        evidence_refs: [{ numeric_metrics: { snapshot_index: i } }],
        confidence: 'medium',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.state.generic_error_copy',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('ge', url, i),
      });
    }

    if (s.hasErrorDialog && s.hasSpinner) {
      push(drafts, {
        kind: 'ux',
        origin: 'suite',
        severity: 'moderate',
        title: 'Error dialog and spinner both present',
        detail: `${idxLabel}: simultaneous error UI and loading spinner — possible confused or stuck state.`,
        evidence_refs: [
          {
            numeric_metrics: {
              hasErrorDialog: 1,
              hasSpinner: 1,
              pending_requests: s.pendingRequests,
              snapshot_index: i,
            },
          },
        ],
        confidence: 'medium',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.state.error_and_spinner',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('es', url, i),
      });
    }

    if (s.hasErrorDialog && s.pendingRequests > 6) {
      push(drafts, {
        kind: 'ux',
        origin: 'suite',
        severity: 'moderate',
        title: 'Many in-flight network requests while error UI visible',
        detail: `${idxLabel}: error UI shown with pendingRequests=${s.pendingRequests} — possible stuck retries or noisy failure mode.`,
        evidence_refs: [
          {
            numeric_metrics: {
              pending_requests: s.pendingRequests,
              snapshot_index: i,
            },
          },
        ],
        confidence: 'medium',
        determinism: 'heuristic',
        oracle_id: 'neo.b1.state.error_with_pending_network',
        urls: [url],
        promotion_state: 'advisory',
        blocks_merge: false,
        fingerprint: fpB1('epn', url, i),
      });
    }
  }

  return drafts.map((d) => FindingSchema.parse(d));
}
