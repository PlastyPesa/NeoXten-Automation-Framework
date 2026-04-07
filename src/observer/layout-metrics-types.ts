/**
 * DOM layout / polish metrics collected in-browser (plan §2 B.1).
 * Numeric signals only — findings layer interprets thresholds.
 */
export interface PageLayoutMetrics {
  scrollOverflowX: number;
  scrollOverflowY: number;
  /** documentElement scrollWidth > innerWidth (content wider than layout viewport). */
  horizontalOverflowPx: number;
  /** Risk: wide content with overflow-x hidden on root. */
  rootOverflowXHiddenClipRisk: boolean;
  /** Body overflow hidden with tall document — possible vertical clip. */
  bodyVerticalClipRisk: boolean;
  /** Max intersectionArea / min(areaA, areaB) for visible interactables in viewport. */
  maxInteractableOverlapRatio: number;
  /** Pairs above overlap ratio threshold. */
  overlapPairCount: number;
  /** Block children whose left edge is &gt;2px off an 8px grid (first 16 blocks in main/body). */
  gridMisalignedBlockCount: number;
  /** Sample of px deviation from 8px grid (debug). */
  gridDeviationSamplesPx: number[];
  visibleH1Count: number;
  /** Two or more large H1s — competing primaries. */
  multipleHeavyH1: boolean;
  /** Measured H3 font-size ≥ H2 min in viewport (weak hierarchy). */
  hierarchyLevelInversion: boolean;
  /** Primary-looking control smaller than strongest secondary in fold. */
  weakPrimaryVsSecondary: boolean;
  /** Has buttons in fold but none matched primary heuristics. */
  noPrimaryControlInFold: boolean;
  /** Two or more large similarly-sized controls in fold (competing CTAs). */
  competingCtaCount: number;
  /** Short generic error strings in alert/error nodes. */
  genericErrorBannerText: boolean;
  /** In-fold actionable controls counted for CTA heuristics. */
  viewportActionableCount: number;
}

export function emptyLayoutMetrics(): PageLayoutMetrics {
  return {
    scrollOverflowX: 0,
    scrollOverflowY: 0,
    horizontalOverflowPx: 0,
    rootOverflowXHiddenClipRisk: false,
    bodyVerticalClipRisk: false,
    maxInteractableOverlapRatio: 0,
    overlapPairCount: 0,
    gridMisalignedBlockCount: 0,
    gridDeviationSamplesPx: [],
    visibleH1Count: 0,
    multipleHeavyH1: false,
    hierarchyLevelInversion: false,
    weakPrimaryVsSecondary: false,
    noPrimaryControlInFold: false,
    competingCtaCount: 0,
    genericErrorBannerText: false,
    viewportActionableCount: 0,
  };
}
